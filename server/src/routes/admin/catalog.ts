import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../../auth/guards.js';
import { getPool, withTransaction, type DbClient } from '../../db/pool.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { saveImageUpload } from '../../lib/uploads.js';
import { emailSchema, hhmm, isoDate, normalizePhone, parse, requiredText, text, uuid } from '../../lib/validation.js';
import { audit } from '../../services/audit.js';

const scheduleItem = z
  .object({ weekday: z.number().int().min(1).max(7), start: hhmm, end: hhmm })
  .refine((s) => s.end > s.start, 'O horário final deve ser depois do inicial.');

const schedulesSchema = z.array(scheduleItem).max(70).refine((list) => {
  // sem sobreposição no mesmo dia
  for (let d = 1; d <= 7; d++) {
    const day = list.filter((s) => s.weekday === d).sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < day.length; i++) if (day[i].start < day[i - 1].end) return false;
  }
  return true;
}, 'Existem horários sobrepostos no mesmo dia.');

const professionalSchema = z.object({
  name: requiredText(2, 120, 'Informe o nome.'),
  title: text(20).default(''),
  specialty: text(120).default(''),
  registry: text(60).default(''),
  showRegistry: z.boolean().default(true),
  bio: text(1000).default(''),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida.').default('#1B2A47'),
  notifyPhone: z
    .string()
    .max(30)
    .default('')
    .transform((v, ctx) => {
      if (!v.trim()) return '';
      const p = normalizePhone(v);
      if (!p) {
        ctx.addIssue({ code: 'custom', message: 'WhatsApp inválido.' });
        return z.NEVER;
      }
      return p;
    }),
  notifyEmail: z.union([z.literal(''), emailSchema]).default(''),
  dailyAgenda: z.boolean().default(true),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  serviceIds: z.array(uuid).max(100).default([]),
  serviceDurations: z.record(z.string(), z.number().int().min(5).max(480).nullable()).optional(),
  schedules: schedulesSchema.optional(),
});

const serviceSchema = z.object({
  name: requiredText(2, 120, 'Informe o nome do serviço.'),
  category: z.enum(['CONSULTA', 'TERAPIA', 'EXAME', 'OUTRO']),
  description: text(500).default(''),
  preparation: text(1000).default(''),
  durationMinutes: z.number().int().min(5, 'Mínimo 5 minutos.').max(480),
  allowChooseProfessional: z.boolean().default(true),
  priceCents: z.number().int().min(0).nullable().default(null),
  showPrice: z.boolean().default(false),
  icon: z.string().regex(/^[a-z-]{1,30}$/).default('stethoscope'),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

function slugify(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'servico';
}

async function saveProfessionalLinks(client: DbClient, id: string, b: z.infer<typeof professionalSchema>) {
  await client.query('DELETE FROM professional_services WHERE professional_id = $1', [id]);
  for (const sid of new Set(b.serviceIds)) {
    const dur = b.serviceDurations?.[sid] ?? null;
    const r = await client.query(
      'INSERT INTO professional_services (professional_id, service_id, duration_minutes) SELECT $1, id, $3 FROM services WHERE id = $2',
      [id, sid, dur],
    );
    if (!r.rowCount) throw badRequest('Serviço inválido na lista.');
  }
  if (b.schedules) await replaceSchedules(client, id, b.schedules);
}

async function replaceSchedules(client: DbClient, id: string, schedules: z.infer<typeof schedulesSchema>) {
  await client.query('DELETE FROM schedules WHERE professional_id = $1', [id]);
  for (const s of schedules) {
    await client.query('INSERT INTO schedules (professional_id, weekday, start_time, end_time) VALUES ($1, $2, $3, $4)', [
      id, s.weekday, s.start, s.end,
    ]);
  }
}

export async function catalogRoutes(app: FastifyInstance) {
  // ============================================================ PROFISSIONAIS
  app.get('/professionals', { preHandler: requirePermission('appointments:read') }, async () => {
    const db = getPool();
    const { rows } = await db.query(
      `SELECT p.id, p.name, p.title, p.specialty, p.registry, p.show_registry AS "showRegistry", p.bio, p.photo_url AS "photoUrl",
              p.color, p.notify_phone AS "notifyPhone", p.notify_email AS "notifyEmail", p.daily_agenda AS "dailyAgenda",
              p.active, p.sort_order AS "sortOrder",
              COALESCE((SELECT json_agg(json_build_object('serviceId', ps.service_id, 'durationMinutes', ps.duration_minutes))
                          FROM professional_services ps WHERE ps.professional_id = p.id), '[]') AS services,
              COALESCE((SELECT json_agg(json_build_object('weekday', s.weekday, 'start', to_char(s.start_time, 'HH24:MI'), 'end', to_char(s.end_time, 'HH24:MI'))
                                        ORDER BY s.weekday, s.start_time)
                          FROM schedules s WHERE s.professional_id = p.id), '[]') AS schedules,
              COALESCE((SELECT json_agg(json_build_object('id', o.id, 'date', o.date, 'start', to_char(o.start_time, 'HH24:MI'),
                                                          'end', to_char(o.end_time, 'HH24:MI'), 'note', o.note) ORDER BY o.date, o.start_time)
                          FROM schedule_overrides o WHERE o.professional_id = p.id AND o.date >= current_date - 1), '[]') AS overrides
         FROM professionals p ORDER BY p.active DESC, p.sort_order, p.name`,
    );
    return { professionals: rows };
  });

  app.post('/professionals', { preHandler: requirePermission('professionals:write') }, async (req, reply) => {
    const b = parse(professionalSchema, req.body);
    const id = await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO professionals (name, title, specialty, registry, show_registry, bio, color, notify_phone, notify_email, daily_agenda, active, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [b.name, b.title, b.specialty, b.registry, b.showRegistry, b.bio, b.color, b.notifyPhone, b.notifyEmail, b.dailyAgenda, b.active, b.sortOrder],
      );
      await saveProfessionalLinks(client, rows[0].id, b);
      return rows[0].id;
    });
    await audit(req, { action: 'PROFESSIONAL_CREATED', resourceType: 'professional', resourceId: id, details: { name: b.name } });
    reply.code(201);
    return { id };
  });

  app.put('/professionals/:id', { preHandler: requirePermission('professionals:write') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(professionalSchema, req.body);
    await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE professionals SET name = $2, title = $3, specialty = $4, registry = $5, show_registry = $6, bio = $7, color = $8,
                notify_phone = $9, notify_email = $10, daily_agenda = $11, active = $12, sort_order = $13, updated_at = now()
          WHERE id = $1`,
        [id, b.name, b.title, b.specialty, b.registry, b.showRegistry, b.bio, b.color, b.notifyPhone, b.notifyEmail, b.dailyAgenda, b.active, b.sortOrder],
      );
      if (!r.rowCount) throw notFound('Profissional não encontrado.');
      await saveProfessionalLinks(client, id, b);
    });
    await audit(req, {
      action: b.active ? 'PROFESSIONAL_UPDATED' : 'PROFESSIONAL_DEACTIVATED',
      resourceType: 'professional',
      resourceId: id,
      details: { name: b.name, schedulesChanged: !!b.schedules },
    });
    return { ok: true };
  });

  app.put('/professionals/:id/schedule', { preHandler: requirePermission('schedules:write') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ schedules: schedulesSchema }), req.body);
    await withTransaction(async (client) => {
      const r = await client.query('SELECT 1 FROM professionals WHERE id = $1', [id]);
      if (!r.rowCount) throw notFound('Profissional não encontrado.');
      await replaceSchedules(client, id, b.schedules);
    });
    await audit(req, { action: 'SCHEDULE_UPDATED', resourceType: 'professional', resourceId: id, details: { slots: b.schedules.length } });
    return { ok: true };
  });

  // Horários especiais (substituem a grade daquele dia; vazio = não atende)
  app.post('/professionals/:id/overrides', { preHandler: requirePermission('schedules:write') }, async (req, reply) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(
      z
        .object({ date: isoDate, start: hhmm.nullish(), end: hhmm.nullish(), note: text(200).default('') })
        .refine((o) => (!o.start && !o.end) || (o.start && o.end && o.end > o.start), 'Horário inválido.'),
      req.body,
    );
    const { rows } = await getPool().query<{ id: string }>(
      `INSERT INTO schedule_overrides (professional_id, date, start_time, end_time, note) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [id, b.date, b.start || null, b.end || null, b.note],
    ).catch((err) => {
      if (err.code === '23503') throw notFound('Profissional não encontrado.');
      throw err;
    });
    await audit(req, { action: 'SCHEDULE_OVERRIDE_CREATED', resourceType: 'professional', resourceId: id, details: { date: b.date, start: b.start, end: b.end } });
    reply.code(201);
    return { id: rows[0].id };
  });

  app.delete('/professionals/:id/overrides/:oid', { preHandler: requirePermission('schedules:write') }, async (req) => {
    const { id, oid } = parse(z.object({ id: uuid, oid: uuid }), req.params);
    const r = await getPool().query('DELETE FROM schedule_overrides WHERE id = $1 AND professional_id = $2', [oid, id]);
    if (!r.rowCount) throw notFound();
    await audit(req, { action: 'SCHEDULE_OVERRIDE_DELETED', resourceType: 'professional', resourceId: id });
    return { ok: true };
  });

  app.post('/professionals/:id/photo', { preHandler: requirePermission('professionals:write') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const url = await saveImageUpload(req, 'prof');
    const r = await getPool().query('UPDATE professionals SET photo_url = $2, updated_at = now() WHERE id = $1', [id, url]);
    if (!r.rowCount) throw notFound('Profissional não encontrado.');
    await audit(req, { action: 'PROFESSIONAL_PHOTO_UPDATED', resourceType: 'professional', resourceId: id });
    return { photoUrl: url };
  });

  app.delete('/professionals/:id/photo', { preHandler: requirePermission('professionals:write') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    await getPool().query('UPDATE professionals SET photo_url = NULL, updated_at = now() WHERE id = $1', [id]);
    await audit(req, { action: 'PROFESSIONAL_PHOTO_REMOVED', resourceType: 'professional', resourceId: id });
    return { ok: true };
  });

  // ============================================================ SERVIÇOS
  app.get('/services', { preHandler: requirePermission('appointments:read') }, async () => {
    const { rows } = await getPool().query(
      `SELECT s.id, s.name, s.slug, s.category, s.description, s.preparation, s.duration_minutes AS "durationMinutes",
              s.allow_choose_professional AS "allowChooseProfessional", s.price_cents AS "priceCents", s.show_price AS "showPrice",
              s.icon, s.active, s.sort_order AS "sortOrder",
              COALESCE((SELECT array_agg(ps.professional_id) FROM professional_services ps WHERE ps.service_id = s.id), '{}') AS "professionalIds"
         FROM services s ORDER BY s.active DESC, s.sort_order, s.name`,
    );
    return { services: rows };
  });

  app.post('/services', { preHandler: requirePermission('services:write') }, async (req, reply) => {
    const b = parse(serviceSchema, req.body);
    let slug = slugify(b.name);
    const exists = await getPool().query('SELECT 1 FROM services WHERE slug = $1', [slug]);
    if (exists.rowCount) slug = `${slug}-${Date.now().toString(36)}`;
    const { rows } = await getPool().query<{ id: string }>(
      `INSERT INTO services (name, slug, category, description, preparation, duration_minutes, allow_choose_professional, price_cents, show_price, icon, active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [b.name, slug, b.category, b.description, b.preparation, b.durationMinutes, b.allowChooseProfessional, b.priceCents, b.showPrice, b.icon, b.active, b.sortOrder],
    );
    await audit(req, { action: 'SERVICE_CREATED', resourceType: 'service', resourceId: rows[0].id, details: { name: b.name } });
    reply.code(201);
    return { id: rows[0].id };
  });

  app.put('/services/:id', { preHandler: requirePermission('services:write') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(serviceSchema, req.body);
    const r = await getPool().query(
      `UPDATE services SET name = $2, category = $3, description = $4, preparation = $5, duration_minutes = $6,
              allow_choose_professional = $7, price_cents = $8, show_price = $9, icon = $10, active = $11, sort_order = $12, updated_at = now()
        WHERE id = $1`,
      [id, b.name, b.category, b.description, b.preparation, b.durationMinutes, b.allowChooseProfessional, b.priceCents, b.showPrice, b.icon, b.active, b.sortOrder],
    );
    if (!r.rowCount) throw notFound('Serviço não encontrado.');
    await audit(req, { action: b.active ? 'SERVICE_UPDATED' : 'SERVICE_DEACTIVATED', resourceType: 'service', resourceId: id, details: { name: b.name } });
    return { ok: true };
  });

  app.put('/services/:id/professionals', { preHandler: requirePermission('services:write') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ professionalIds: z.array(uuid).max(200) }), req.body);
    await withTransaction(async (client) => {
      const s = await client.query('SELECT 1 FROM services WHERE id = $1', [id]);
      if (!s.rowCount) throw notFound('Serviço não encontrado.');
      await client.query('DELETE FROM professional_services WHERE service_id = $1 AND NOT (professional_id = ANY($2))', [id, b.professionalIds]);
      for (const pid of b.professionalIds) {
        await client.query(
          'INSERT INTO professional_services (professional_id, service_id) SELECT id, $2 FROM professionals WHERE id = $1 ON CONFLICT DO NOTHING',
          [pid, id],
        );
      }
    });
    await audit(req, { action: 'SERVICE_PROFESSIONALS_UPDATED', resourceType: 'service', resourceId: id, details: { count: b.professionalIds.length } });
    return { ok: true };
  });

  app.delete('/services/:id', { preHandler: requirePermission('services:write') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const used = await getPool().query('SELECT 1 FROM appointments WHERE service_id = $1 LIMIT 1', [id]);
    if (used.rowCount) throw conflict('Este serviço possui agendamentos e não pode ser excluído. Desative-o.');
    const r = await getPool().query('DELETE FROM services WHERE id = $1', [id]);
    if (!r.rowCount) throw notFound();
    await audit(req, { action: 'SERVICE_DELETED', resourceType: 'service', resourceId: id });
    return { ok: true };
  });
}
