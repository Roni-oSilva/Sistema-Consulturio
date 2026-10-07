import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../../auth/guards.js';
import { getPool } from '../../db/pool.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { saveImageUpload } from '../../lib/uploads.js';
import { emailSchema, formatPhone, normalizePhone, parse, requiredText, text, uuid } from '../../lib/validation.js';
import { audit } from '../../services/audit.js';
import {
  DEFAULT_TEMPLATES,
  NOTIFICATION_TYPES,
  TEMPLATE_VARIABLES,
  renderTemplate,
  type Channel,
  type NotificationType,
} from '../../services/notifications/defaults.js';
import { providerStatus, sendEmail, sendSms, sendWhatsApp } from '../../services/notifications/providers.js';
import { renderNotification, retryNotification, type NotificationRow } from '../../services/notifications/worker.js';
import { getSettings, invalidateSettings } from '../../services/settings.js';

const optionalPhone = z
  .string()
  .max(30)
  .transform((v, ctx) => {
    if (!v.trim()) return '';
    const p = normalizePhone(v);
    if (!p) {
      ctx.addIssue({ code: 'custom', message: 'Telefone inválido.' });
      return z.NEVER;
    }
    return p;
  });

const urlOrEmpty = z.union([z.literal(''), z.string().max(500).url('URL inválida.').refine((u) => /^https?:\/\//.test(u), 'Use http(s)://')]);

// Lista explícita de campos editáveis (proteção contra mass assignment).
const settingsSchema = z.object({
  name: requiredText(2, 120, 'Informe o nome da clínica.'),
  short_name: text(60),
  tagline: text(200),
  description: text(1000),
  phone: text(40),
  whatsapp: optionalPhone,
  email: z.union([z.literal(''), emailSchema]),
  address: text(300),
  maps_url: urlOrEmpty,
  instagram: text(60),
  opening_hours: z.string().max(500).transform((v) => v.trim()),
  timezone: z.string().max(60).refine((tz) => {
    try {
      new Intl.DateTimeFormat('pt-BR', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Fuso horário inválido.'),
  default_duration_minutes: z.number().int().min(5).max(480),
  min_advance_minutes: z.number().int().min(0).max(10080),
  max_advance_days: z.number().int().min(1).max(365),
  cancel_min_hours: z.number().int().min(0).max(168),
  allow_patient_reschedule: z.boolean(),
  initial_status: z.enum(['PENDING', 'CONFIRMED']),
  require_cpf: z.boolean(),
  require_birth_date: z.boolean(),
  require_email: z.boolean(),
  max_active_per_phone: z.number().int().min(1).max(50),
  max_bookings_per_ip_day: z.number().int().min(1).max(1000),
  booking_notice: text(500),
  privacy_policy: z.string().max(20000).transform((v) => v.trim()),
  privacy_policy_version: text(20),
  whatsapp_enabled: z.boolean(),
  email_enabled: z.boolean(),
  sms_enabled: z.boolean(),
  reminder1_hours: z.number().int().min(0).max(168),
  reminder2_hours: z.number().int().min(0).max(48),
  post_visit_enabled: z.boolean(),
  post_visit_delay_hours: z.number().int().min(0).max(168),
  no_show_message_enabled: z.boolean(),
  review_url: urlOrEmpty,
  clinic_notify_enabled: z.boolean(),
  clinic_notify_whatsapp: optionalPhone,
  clinic_notify_email: z.union([z.literal(''), emailSchema]),
  daily_agenda_enabled: z.boolean(),
  daily_agenda_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.'),
  auto_cancel_unconfirmed_hours: z.number().int().min(0).max(72),
  auto_complete_after_hours: z.number().int().min(0).max(72),
});
type SettingsInput = z.infer<typeof settingsSchema>;
const SETTINGS_KEYS = Object.keys(settingsSchema.shape) as (keyof SettingsInput)[];

export async function settingsRoutes(app: FastifyInstance) {
  // ============================================================ CONFIGURAÇÕES
  app.get('/settings', { preHandler: requirePermission('settings:write') }, async () => {
    const s = await getSettings(getPool(), true);
    return { settings: { ...s, whatsapp: s.whatsapp ? formatPhone(s.whatsapp) : '', clinic_notify_whatsapp: s.clinic_notify_whatsapp ? formatPhone(s.clinic_notify_whatsapp) : '' }, providers: providerStatus() };
  });

  app.put('/settings', { preHandler: requirePermission('settings:write') }, async (req) => {
    const b = parse(settingsSchema.partial(), req.body);
    const keys = SETTINGS_KEYS.filter((k) => b[k] !== undefined);
    if (!keys.length) throw badRequest('Nada para salvar.');
    const before = await getSettings(getPool(), true);
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    await getPool().query(
      `UPDATE clinic_settings SET ${sets}, updated_at = now(), updated_by = $${keys.length + 1} WHERE id = 1`,
      [...keys.map((k) => b[k]), req.user!.id],
    );
    invalidateSettings();
    const changed = keys.filter((k) => JSON.stringify(before[k as keyof typeof before]) !== JSON.stringify(b[k]));
    await audit(req, { action: 'SETTINGS_UPDATED', resourceType: 'settings', resourceId: '1', details: { fields: changed } });
    return { ok: true };
  });

  app.post('/settings/logo', { preHandler: requirePermission('settings:write') }, async (req) => {
    const url = await saveImageUpload(req, 'logo');
    await getPool().query('UPDATE clinic_settings SET logo_url = $1, updated_at = now() WHERE id = 1', [url]);
    invalidateSettings();
    await audit(req, { action: 'LOGO_UPDATED', resourceType: 'settings', resourceId: '1' });
    return { logoUrl: url };
  });

  app.delete('/settings/logo', { preHandler: requirePermission('settings:write') }, async (req) => {
    await getPool().query('UPDATE clinic_settings SET logo_url = NULL, updated_at = now() WHERE id = 1');
    invalidateSettings();
    await audit(req, { action: 'LOGO_REMOVED', resourceType: 'settings', resourceId: '1' });
    return { ok: true };
  });

  // ============================================================ MODELOS DE MENSAGEM
  app.get('/templates', { preHandler: requirePermission('templates:write') }, async () => {
    const { rows } = await getPool().query(
      `SELECT type, channel, subject, body, enabled, updated_at AS "updatedAt" FROM message_templates ORDER BY type, channel`,
    );
    return { templates: rows, types: NOTIFICATION_TYPES, variables: TEMPLATE_VARIABLES, providers: providerStatus() };
  });

  const tplParams = z.object({
    type: z.enum(Object.keys(NOTIFICATION_TYPES) as [NotificationType, ...NotificationType[]]),
    channel: z.enum(['WHATSAPP', 'EMAIL', 'SMS']),
  });

  app.put('/templates/:type/:channel', { preHandler: requirePermission('templates:write') }, async (req) => {
    const p = parse(tplParams, req.params);
    const b = parse(
      z.object({ subject: z.string().max(200).default(''), body: z.string().min(1, 'A mensagem não pode ficar vazia.').max(4000), enabled: z.boolean() }),
      req.body,
    );
    await getPool().query(
      `INSERT INTO message_templates (type, channel, subject, body, enabled) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (type, channel) DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body, enabled = EXCLUDED.enabled, updated_at = now()`,
      [p.type, p.channel, b.subject.trim(), b.body.trim(), b.enabled],
    );
    await audit(req, { action: 'TEMPLATE_UPDATED', resourceType: 'template', resourceId: `${p.type}/${p.channel}`, details: { enabled: b.enabled } });
    return { ok: true };
  });

  app.post('/templates/:type/:channel/reset', { preHandler: requirePermission('templates:write') }, async (req) => {
    const p = parse(tplParams, req.params);
    const def = DEFAULT_TEMPLATES[p.type]?.[p.channel as Channel];
    if (!def) throw notFound('Não há modelo padrão para este canal.');
    await getPool().query(
      `INSERT INTO message_templates (type, channel, subject, body, enabled) VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (type, channel) DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body, updated_at = now()`,
      [p.type, p.channel, def.subject ?? '', def.body],
    );
    await audit(req, { action: 'TEMPLATE_RESET', resourceType: 'template', resourceId: `${p.type}/${p.channel}` });
    return { ok: true };
  });

  /** Pré-visualização com dados de exemplo. */
  app.post('/templates/preview', { preHandler: requirePermission('templates:write') }, async (req) => {
    const b = parse(z.object({ subject: z.string().max(200).default(''), body: z.string().max(4000) }), req.body);
    const s = await getSettings(getPool());
    const vars: Record<string, string> = {
      paciente: 'Maria Oliveira Santos', primeiro_nome: 'Maria', clinica: s.short_name || s.name, servico: 'Cardiologia',
      profissional: 'Dr. Carlos Mendes', data: '15/10/2026', dia_semana: 'quinta-feira', hora: '14:30', endereco: s.address || 'Endereço da clínica',
      telefone_clinica: s.phone, whatsapp_clinica: s.whatsapp, codigo: 'K7P2-Q9MX', link: 'https://.../agendamento/...',
      link_agendar: 'https://.../agendar', preparo: 'ℹ️ Preparo: Traga documento com foto.', politica_cancelamento: 'Cancelamentos até 2 horas antes.',
      motivo: '', avaliacao_link: s.review_url ? `⭐ Conte como foi sua experiência: ${s.review_url}` : '', telefone_paciente: '(91) 98888-7777',
      agenda: '08:00 — Maria O. (Cardiologia)\n08:30 — João S. (Cardiologia)', total: '2',
    };
    return { subject: renderTemplate(b.subject, vars), body: renderTemplate(b.body, vars) };
  });

  /** Envia uma mensagem de teste para verificar a integração. */
  app.post('/templates/test', { preHandler: requirePermission('templates:write'), config: { rateLimit: { max: 10, timeWindow: 15 * 60_000 } } }, async (req) => {
    const b = parse(z.object({ channel: z.enum(['WHATSAPP', 'EMAIL', 'SMS']), recipient: z.string().min(5).max(254) }), req.body);
    const s = await getSettings(getPool());
    const msg = `Mensagem de teste do sistema de agendamento da ${s.short_name || s.name}. Se você recebeu, a integração está funcionando! ✅`;
    try {
      let r;
      if (b.channel === 'EMAIL') {
        const email = parse(emailSchema, b.recipient);
        r = await sendEmail(email, 'Teste de envio', msg, s.short_name || s.name);
      } else {
        const phone = normalizePhone(b.recipient);
        if (!phone) throw badRequest('Telefone inválido.');
        r = b.channel === 'WHATSAPP' ? await sendWhatsApp(phone, msg) : await sendSms(phone, msg);
        if (r.status === 'MANUAL') {
          return { ok: true, manual: true, waLink: `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` };
        }
      }
      await audit(req, { action: 'TEST_MESSAGE_SENT', resourceType: 'notification', details: { channel: b.channel, provider: r.provider } });
      return { ok: true, provider: r.provider };
    } catch (err) {
      if (err instanceof Error && 'statusCode' in err) throw err;
      throw badRequest(`Falha no envio: ${(err as Error).message}`);
    }
  });

  // ============================================================ FILA DE MENSAGENS
  app.get('/notifications', { preHandler: requirePermission('notifications:read') }, async (req) => {
    const q = parse(
      z.object({
        status: z.enum(['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED', 'MANUAL']).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      }),
      req.query,
    );
    const { rows } = await getPool().query(
      `SELECT n.id, n.type, n.channel, n.audience, n.recipient, n.subject, n.body, n.status, n.scheduled_for AS "scheduledFor",
              n.sent_at AS "sentAt", n.attempts, n.last_error AS "lastError", n.provider, n.appointment_id AS "appointmentId",
              a.patient_name AS "patientName", a.code
         FROM notifications n LEFT JOIN appointments a ON a.id = n.appointment_id
        WHERE ($1::text IS NULL OR n.status = $1)
        ORDER BY CASE WHEN n.status IN ('PENDING','MANUAL') THEN n.scheduled_for END ASC NULLS LAST, n.updated_at DESC
        LIMIT $2`,
      [q.status ?? null, q.limit],
    );
    return { notifications: rows, types: NOTIFICATION_TYPES, providers: providerStatus() };
  });

  /** Fila manual: mensagens prontas para enviar com 1 clique pelo WhatsApp. */
  app.get('/notifications/manual', { preHandler: requirePermission('notifications:read') }, async () => {
    const db = getPool();
    const { rows } = await db.query<NotificationRow & { patient_name: string | null; code: string | null }>(
      `SELECT n.*, a.patient_name, a.code FROM notifications n LEFT JOIN appointments a ON a.id = n.appointment_id
        WHERE n.status = 'MANUAL' ORDER BY n.scheduled_for LIMIT 100`,
    );
    const out = [];
    for (const n of rows) {
      const r = await renderNotification(db, n);
      if (r.skip) {
        await db.query(`UPDATE notifications SET status = 'CANCELLED', last_error = $2, updated_at = now() WHERE id = $1`, [n.id, r.skip]);
        continue;
      }
      out.push({
        id: n.id,
        type: n.type,
        audience: n.audience,
        recipient: formatPhone(n.recipient),
        patientName: n.patient_name,
        code: n.code,
        scheduledFor: n.scheduled_for,
        body: r.body,
        waLink: `https://wa.me/${n.recipient}?text=${encodeURIComponent(r.body)}`,
      });
    }
    return { messages: out, types: NOTIFICATION_TYPES };
  });

  app.post('/notifications/:id/mark-sent', { preHandler: requirePermission('notifications:write') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const r = await getPool().query(
      `UPDATE notifications SET status = 'SENT', sent_at = now(), provider = 'manual', updated_at = now() WHERE id = $1 AND status = 'MANUAL'`,
      [id],
    );
    if (!r.rowCount) throw notFound('Mensagem não encontrada na fila manual.');
    await audit(req, { action: 'MESSAGE_SENT_MANUALLY', resourceType: 'notification', resourceId: id });
    return { ok: true };
  });

  app.post('/notifications/:id/cancel', { preHandler: requirePermission('notifications:write') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const r = await getPool().query(
      `UPDATE notifications SET status = 'CANCELLED', last_error = 'Descartada pela equipe', updated_at = now()
        WHERE id = $1 AND status IN ('PENDING', 'MANUAL', 'FAILED')`,
      [id],
    );
    if (!r.rowCount) throw notFound('Mensagem não encontrada.');
    await audit(req, { action: 'MESSAGE_DISCARDED', resourceType: 'notification', resourceId: id });
    return { ok: true };
  });

  app.post('/notifications/:id/retry', { preHandler: requirePermission('notifications:write') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    await retryNotification(id);
    const { rows } = await getPool().query('SELECT status, last_error AS "lastError" FROM notifications WHERE id = $1', [id]);
    if (!rows[0]) throw notFound();
    await audit(req, { action: 'MESSAGE_RETRIED', resourceType: 'notification', resourceId: id, details: { status: rows[0].status } });
    return rows[0];
  });
}
