import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { requirePermission } from '../../auth/guards.js';
import { getPool } from '../../db/pool.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { hhmm, isoDate, parse, requiredText, text, uuid } from '../../lib/validation.js';
import { audit } from '../../services/audit.js';
import { cancelAppointment } from '../../services/appointments.js';
import { getSettings } from '../../services/settings.js';

const REASONS = ['VACATION', 'DAY_OFF', 'MEETING', 'MAINTENANCE', 'OTHER'] as const;

const blockSchema = z.object({
  professionalId: uuid.nullable(), // null = clínica inteira
  startDate: isoDate,
  endDate: isoDate,
  allDay: z.boolean().default(false),
  startTime: hhmm.optional(),
  endTime: hhmm.optional(),
  reasonType: z.enum(REASONS),
  description: text(200).default(''),
  // automação: cancela e avisa os pacientes já agendados no período
  cancelAppointments: z.boolean().default(false),
});

function blockRange(b: z.infer<typeof blockSchema>, tz: string) {
  const start = b.allDay
    ? DateTime.fromISO(b.startDate, { zone: tz }).startOf('day')
    : DateTime.fromISO(`${b.startDate}T${b.startTime ?? ''}`, { zone: tz });
  const end = b.allDay
    ? DateTime.fromISO(b.endDate, { zone: tz }).plus({ days: 1 }).startOf('day')
    : DateTime.fromISO(`${b.endDate}T${b.endTime ?? ''}`, { zone: tz });
  if (!start.isValid || !end.isValid) throw badRequest('Informe data e horário de início e fim.');
  if (end <= start) throw badRequest('O fim do bloqueio deve ser depois do início.');
  if (end.diff(start, 'days').days > 366) throw badRequest('Bloqueio máximo de 1 ano.');
  return { start, end };
}

export async function blockRoutes(app: FastifyInstance) {
  app.get('/block-times', { preHandler: requirePermission('appointments:read') }, async (req) => {
    const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional(), professionalId: uuid.optional() }), req.query);
    const settings = await getSettings(getPool());
    const tz = settings.timezone;
    const from = DateTime.fromISO(q.from ?? DateTime.now().setZone(tz).toISODate()!, { zone: tz }).startOf('day');
    const to = q.to ? DateTime.fromISO(q.to, { zone: tz }).endOf('day') : from.plus({ years: 1 });
    const { rows } = await getPool().query(
      `SELECT b.id, b.professional_id AS "professionalId", p.name AS "professionalName", p.title AS "professionalTitle",
              b.start_at AS "start", b.end_at AS "end", b.reason_type AS "reasonType", b.description, u.name AS "createdBy", b.created_at AS "createdAt"
         FROM blocked_times b
         LEFT JOIN professionals p ON p.id = b.professional_id
         LEFT JOIN users u ON u.id = b.created_by
        WHERE b.end_at > $1 AND b.start_at < $2 AND ($3::uuid IS NULL OR b.professional_id IS NULL OR b.professional_id = $3::uuid)
        ORDER BY b.start_at`,
      [from.toJSDate(), to.toJSDate(), q.professionalId ?? null],
    );
    return { blocks: rows };
  });

  /** Pré-visualização: quantos agendamentos existem no período que será bloqueado. */
  app.post('/block-times/preview', { preHandler: requirePermission('blocks:write') }, async (req) => {
    const b = parse(blockSchema, req.body);
    const settings = await getSettings(getPool());
    const { start, end } = blockRange(b, settings.timezone);
    const { rows } = await getPool().query(
      `SELECT a.id, a.code, a.patient_name AS "patientName", a.start_at AS "start", s.name AS "serviceName"
         FROM appointments a JOIN services s ON s.id = a.service_id
        WHERE a.status IN ('PENDING', 'CONFIRMED') AND a.start_at < $2 AND a.end_at > $1
          AND ($3::uuid IS NULL OR a.professional_id = $3::uuid) ORDER BY a.start_at`,
      [start.toJSDate(), end.toJSDate(), b.professionalId],
    );
    return { affected: rows };
  });

  app.post('/block-times', { preHandler: requirePermission('blocks:write') }, async (req, reply) => {
    const b = parse(blockSchema, req.body);
    const db = getPool();
    const settings = await getSettings(db);
    const { start, end } = blockRange(b, settings.timezone);
    if (b.professionalId) {
      const p = await db.query('SELECT 1 FROM professionals WHERE id = $1', [b.professionalId]);
      if (!p.rowCount) throw notFound('Profissional não encontrado.');
    }
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO blocked_times (professional_id, start_at, end_at, reason_type, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [b.professionalId, start.toJSDate(), end.toJSDate(), b.reasonType, b.description, req.user!.id],
    );
    let cancelled = 0;
    if (b.cancelAppointments) {
      const { rows: affected } = await db.query<{ id: string }>(
        `SELECT id FROM appointments WHERE status IN ('PENDING', 'CONFIRMED') AND start_at < $2 AND end_at > $1
           AND ($3::uuid IS NULL OR professional_id = $3::uuid)`,
        [start.toJSDate(), end.toJSDate(), b.professionalId],
      );
      const reason = b.description
        ? `Imprevisto na agenda (${b.description}). Pedimos desculpas — por favor, escolha um novo horário.`
        : 'Imprevisto na agenda. Pedimos desculpas — por favor, escolha um novo horário.';
      for (const a of affected) {
        await cancelAppointment(a.id, { type: 'STAFF', userId: req.user!.id }, reason, { enforcePolicy: false });
        cancelled++;
      }
    }
    await audit(req, {
      action: 'TIME_BLOCKED',
      resourceType: 'blocked_time',
      resourceId: rows[0].id,
      details: { professionalId: b.professionalId, start: start.toISO(), end: end.toISO(), reason: b.reasonType, cancelled },
    });
    reply.code(201);
    return { id: rows[0].id, cancelled };
  });

  app.delete('/block-times/:id', { preHandler: requirePermission('blocks:write') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { rows } = await getPool().query(
      'DELETE FROM blocked_times WHERE id = $1 RETURNING professional_id, start_at, end_at, reason_type',
      [id],
    );
    if (!rows[0]) throw notFound('Bloqueio não encontrado.');
    await audit(req, { action: 'TIME_UNBLOCKED', resourceType: 'blocked_time', resourceId: id, details: rows[0] });
    return { ok: true };
  });

  // ============================================================ FERIADOS
  app.get('/holidays', { preHandler: requirePermission('appointments:read') }, async () => {
    const { rows } = await getPool().query(
      `SELECT id, date, name, recurring FROM holidays
        WHERE recurring OR date >= current_date - 30 ORDER BY recurring DESC, to_char(date, 'MM-DD'), date`,
    );
    return { holidays: rows };
  });

  app.post('/holidays', { preHandler: requirePermission('holidays:write') }, async (req, reply) => {
    const b = parse(z.object({ date: isoDate, name: requiredText(2, 100, 'Informe o nome do feriado.'), recurring: z.boolean().default(false) }), req.body);
    const { rows } = await getPool()
      .query<{ id: string }>('INSERT INTO holidays (date, name, recurring) VALUES ($1, $2, $3) RETURNING id', [b.date, b.name, b.recurring])
      .catch((err) => {
        if (err.code === '23505') throw conflict('Já existe um feriado nesta data.');
        throw err;
      });
    await audit(req, { action: 'HOLIDAY_CREATED', resourceType: 'holiday', resourceId: rows[0].id, details: b });
    reply.code(201);
    return { id: rows[0].id };
  });

  app.delete('/holidays/:id', { preHandler: requirePermission('holidays:write') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { rows } = await getPool().query('DELETE FROM holidays WHERE id = $1 RETURNING date, name', [id]);
    if (!rows[0]) throw notFound();
    await audit(req, { action: 'HOLIDAY_DELETED', resourceType: 'holiday', resourceId: id, details: rows[0] });
    return { ok: true };
  });
}
