import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { ownProfessionalScope, requirePermission } from '../../auth/guards.js';
import { hasPermission } from '../../auth/rbac.js';
import { getPool } from '../../db/pool.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { fmtDate, fmtTime } from '../../lib/time.js';
import {
  emailSchema,
  isValidCpf,
  isoDate,
  parse,
  phoneSchema,
  requiredText,
  text,
  uuid,
} from '../../lib/validation.js';
import { audit } from '../../services/audit.js';
import { loadContext, slotsForDay } from '../../services/availability.js';
import {
  cancelAppointment,
  changeStatus,
  createAppointment,
  rescheduleAppointment,
  updateInternalNotes,
} from '../../services/appointments.js';
import { APPOINTMENT_SELECT, getAppointment, type AppointmentFull } from '../../services/appointmentRepo.js';
import { appointmentLink } from '../../services/notifications/worker.js';
import { getSettings } from '../../services/settings.js';
import { adminAppointmentView } from './dashboard.js';

const STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;

function maskCpf(cpf: string | null) {
  if (!cpf) return null;
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}

export async function appointmentAdminRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------- listar (agenda)
  app.get('/appointments', { preHandler: requirePermission('appointments:read') }, async (req) => {
    const q = parse(
      z.object({
        from: isoDate.optional(),
        to: isoDate.optional(),
        professionalId: uuid.optional(),
        serviceId: uuid.optional(),
        status: z.enum(STATUSES).optional(),
        q: z.string().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(300),
      }),
      req.query,
    );
    const scope = ownProfessionalScope(req);
    const settings = await getSettings(getPool());
    const tz = settings.timezone;
    const today = DateTime.now().setZone(tz).toISODate()!;
    const from = DateTime.fromISO(q.from ?? today, { zone: tz }).startOf('day');
    const to = DateTime.fromISO(q.to ?? q.from ?? today, { zone: tz }).endOf('day');
    if (to < from) throw badRequest('Período inválido.');
    if (to.diff(from, 'days').days > 92) throw badRequest('Período máximo de 3 meses.');

    const search = q.q?.trim();
    const digits = search?.replace(/\D/g, '') ?? '';
    const { rows } = await getPool().query<AppointmentFull>(
      `${APPOINTMENT_SELECT}
        WHERE ($10::boolean OR (a.start_at >= $1 AND a.start_at <= $2)) AND ($3::uuid IS NULL OR a.professional_id = $3::uuid)
          AND ($4::uuid IS NULL OR a.professional_id = $4::uuid)
          AND ($5::uuid IS NULL OR a.service_id = $5::uuid)
          AND ($6::text IS NULL OR a.status = $6)
          AND ($7::text IS NULL OR a.patient_name ILIKE '%' || $7 || '%' OR a.code ILIKE '%' || $7 || '%'
               OR ($8::text <> '' AND a.contact_phone LIKE '%' || $8 || '%'))
        ORDER BY a.start_at ${search ? 'DESC' : 'ASC'}
        LIMIT $9`,
      [from.toJSDate(), to.toJSDate(), scope, q.professionalId ?? null, q.serviceId ?? null, q.status ?? null,
        search || null, digits.length >= 4 ? digits : '', q.limit, !!search],
    );
    return { appointments: rows.map((a) => adminAppointmentView(a, tz)) };
  });

  // ------------------------------------------------------------- detalhes
  app.get('/appointments/:id', { preHandler: requirePermission('appointments:read') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const scope = ownProfessionalScope(req);
    const db = getPool();
    const a = await getAppointment(db, id);
    if (!a || (scope && a.professional_id !== scope)) throw notFound('Agendamento não encontrado.');
    const settings = await getSettings(db);
    const [events, notifications, patient] = await Promise.all([
      db.query(
        `SELECT e.at, e.actor_type AS "actorType", u.name AS "actorName", e.action, e.from_status AS "fromStatus",
                e.to_status AS "toStatus", e.details
           FROM appointment_events e LEFT JOIN users u ON u.id = e.actor_user_id
          WHERE e.appointment_id = $1 ORDER BY e.at`,
        [id],
      ),
      db.query(
        `SELECT id, type, channel, audience, status, scheduled_for AS "scheduledFor", sent_at AS "sentAt", last_error AS "lastError", attempts
           FROM notifications WHERE appointment_id = $1 ORDER BY scheduled_for`,
        [id],
      ),
      db.query<{ cpf: string | null; birth_date: string | null }>('SELECT cpf, birth_date FROM patients WHERE id = $1', [a.patient_id]),
    ]);
    const fullCpf = hasPermission(req.user!.role, 'patients:anonymize');
    return {
      appointment: {
        ...adminAppointmentView(a, settings.timezone),
        patientCpf: fullCpf ? patient.rows[0]?.cpf ?? null : maskCpf(patient.rows[0]?.cpf ?? null),
        patientBirthDate: patient.rows[0]?.birth_date ?? null,
        manageLink: appointmentLink(a),
      },
      events: events.rows,
      notifications: notifications.rows,
    };
  });

  // ------------------------------------------------------------- horários livres (equipe)
  app.get('/availability', { preHandler: requirePermission('appointments:read') }, async (req) => {
    const q = parse(z.object({ professionalId: uuid, serviceId: uuid, date: isoDate }), req.query);
    const db = getPool();
    const settings = await getSettings(db);
    const { rows } = await db.query<{ duration: number }>(
      `SELECT COALESCE(ps.duration_minutes, s.duration_minutes) AS duration
         FROM professional_services ps JOIN services s ON s.id = ps.service_id
        WHERE ps.professional_id = $1 AND ps.service_id = $2`,
      [q.professionalId, q.serviceId],
    );
    if (!rows[0]) return { slots: [], linked: false };
    const ctx = await loadContext(db, settings, [q.professionalId], q.date, q.date, { ignoreRules: true });
    const now = Date.now();
    const slots = slotsForDay(ctx, q.professionalId, q.date, rows[0].duration)
      .filter((s) => s.start.toMillis() >= now)
      .map((s) => ({ time: s.start.toFormat('HH:mm'), start: s.start.toISO({ suppressMilliseconds: true }) }));
    return { slots, linked: true, duration: rows[0].duration };
  });

  // ------------------------------------------------------------- criar (recepção)
  const createSchema = z.object({
    serviceId: uuid,
    professionalId: uuid,
    date: isoDate,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.'),
    name: requiredText(3, 120, 'Informe o nome do paciente.'),
    phone: phoneSchema,
    email: z.union([z.literal(''), emailSchema]).nullish(),
    cpf: z.string().max(20).nullish(),
    birthDate: z.union([z.literal(''), isoDate]).nullish(),
    notes: text(500).optional(),
    internalNotes: text(1000).optional(),
    outsideSchedule: z.boolean().optional(),
  });

  app.post('/appointments', { preHandler: requirePermission('appointments:write') }, async (req, reply) => {
    const b = parse(createSchema, req.body);
    if (b.cpf && b.cpf.trim() && !isValidCpf(b.cpf)) throw badRequest('CPF inválido.', 'VALIDATION_ERROR', { fields: { cpf: 'CPF inválido.' } });
    const settings = await getSettings(getPool());
    const start = DateTime.fromISO(`${b.date}T${b.time}`, { zone: settings.timezone });
    const { appointment } = await createAppointment({
      serviceId: b.serviceId,
      professionalId: b.professionalId,
      start: start.toISO()!,
      patient: { name: b.name, phone: b.phone, email: b.email || null, cpf: b.cpf ? b.cpf.replace(/\D/g, '') : null, birthDate: b.birthDate || null },
      notes: b.notes ?? '',
      internalNotes: b.internalNotes ?? '',
      source: 'ADMIN',
      allowOutsideSchedule: !!b.outsideSchedule,
      actor: { type: 'STAFF', userId: req.user!.id },
    });
    await audit(req, {
      action: 'APPOINTMENT_CREATED',
      resourceType: 'appointment',
      resourceId: appointment.id,
      details: { code: appointment.code, start: appointment.start_at.toISOString(), outsideSchedule: !!b.outsideSchedule },
    });
    reply.code(201);
    return { appointment: adminAppointmentView(appointment, settings.timezone) };
  });

  // ------------------------------------------------------------- alterar status
  app.post('/appointments/:id/status', { preHandler: requirePermission('appointments:status') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ status: z.enum(STATUSES), reason: text(300).optional() }), req.body);
    const scope = ownProfessionalScope(req);
    // profissional só pode marcar concluído/falta nos próprios atendimentos
    if (scope && !['COMPLETED', 'NO_SHOW'].includes(b.status)) {
      await audit(req, { action: 'PERMISSION_DENIED', result: 'DENIED', resourceType: 'appointment', resourceId: id, details: { status: b.status } });
      throw badRequest('Profissionais podem marcar apenas "Concluído" ou "Não compareceu".');
    }
    if (b.status === 'CANCELLED' && !hasPermission(req.user!.role, 'appointments:write')) {
      throw badRequest('Sem permissão para cancelar.');
    }
    const before = await getAppointment(getPool(), id);
    if (!before || (scope && before.professional_id !== scope)) throw notFound('Agendamento não encontrado.');
    const updated = await changeStatus(id, b.status, { type: 'STAFF', userId: req.user!.id }, { reason: b.reason, professionalScope: scope });
    await audit(req, {
      action: b.status === 'CANCELLED' ? 'APPOINTMENT_CANCELLED' : 'APPOINTMENT_STATUS_CHANGED',
      resourceType: 'appointment',
      resourceId: id,
      details: { from: before.status, to: b.status, reason: b.reason },
    });
    const settings = await getSettings(getPool());
    return { appointment: adminAppointmentView(updated, settings.timezone) };
  });

  app.post('/appointments/:id/cancel', { preHandler: requirePermission('appointments:write') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ reason: text(300).optional() }), req.body ?? {});
    const updated = await cancelAppointment(id, { type: 'STAFF', userId: req.user!.id }, b.reason ?? '', { enforcePolicy: false });
    await audit(req, { action: 'APPOINTMENT_CANCELLED', resourceType: 'appointment', resourceId: id, details: { reason: b.reason } });
    const settings = await getSettings(getPool());
    return { appointment: adminAppointmentView(updated, settings.timezone) };
  });

  // ------------------------------------------------------------- remarcar
  app.post('/appointments/:id/reschedule', { preHandler: requirePermission('appointments:write') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(
      z.object({
        date: isoDate,
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.'),
        professionalId: uuid.optional(),
        outsideSchedule: z.boolean().optional(),
      }),
      req.body,
    );
    const settings = await getSettings(getPool());
    const before = await getAppointment(getPool(), id);
    if (!before) throw notFound('Agendamento não encontrado.');
    const start = DateTime.fromISO(`${b.date}T${b.time}`, { zone: settings.timezone });
    const updated = await rescheduleAppointment({
      id,
      start: start.toISO()!,
      professionalId: b.professionalId,
      actor: { type: 'STAFF', userId: req.user!.id },
      enforcePolicy: false,
      allowOutsideSchedule: !!b.outsideSchedule,
    });
    await audit(req, {
      action: 'APPOINTMENT_RESCHEDULED',
      resourceType: 'appointment',
      resourceId: id,
      details: {
        from: `${fmtDate(before.start_at, settings.timezone)} ${fmtTime(before.start_at, settings.timezone)}`,
        to: `${fmtDate(updated.start_at, settings.timezone)} ${fmtTime(updated.start_at, settings.timezone)}`,
      },
    });
    return { appointment: adminAppointmentView(updated, settings.timezone) };
  });

  // ------------------------------------------------------------- observações internas
  app.patch('/appointments/:id/notes', { preHandler: requirePermission('appointments:write') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ internalNotes: text(1000) }), req.body);
    await updateInternalNotes(getPool(), id, b.internalNotes);
    await audit(req, { action: 'APPOINTMENT_NOTES_UPDATED', resourceType: 'appointment', resourceId: id });
    return { ok: true };
  });
}
