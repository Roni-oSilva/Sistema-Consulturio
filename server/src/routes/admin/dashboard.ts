import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { ownProfessionalScope, requirePermission } from '../../auth/guards.js';
import { getPool } from '../../db/pool.js';
import { loadContext, slotsForDay } from '../../services/availability.js';
import { getSettings } from '../../services/settings.js';
import { APPOINTMENT_SELECT, professionalLabel, type AppointmentFull } from '../../services/appointmentRepo.js';
import { formatPhone } from '../../lib/validation.js';

export function adminAppointmentView(a: AppointmentFull, tz: string) {
  const start = DateTime.fromJSDate(a.start_at).setZone(tz);
  return {
    id: a.id,
    code: a.code,
    status: a.status,
    source: a.source,
    start: a.start_at.toISOString(),
    end: a.end_at.toISOString(),
    date: start.toISODate(),
    time: start.toFormat('HH:mm'),
    endTime: DateTime.fromJSDate(a.end_at).setZone(tz).toFormat('HH:mm'),
    service: { id: a.service_id, name: a.service_name, category: a.service_category },
    professional: { id: a.professional_id, name: professionalLabel(a), color: a.professional_color },
    patient: { id: a.patient_id, name: a.patient_name, phone: formatPhone(a.contact_phone), phoneRaw: a.contact_phone, email: a.contact_email },
    patientNotes: a.patient_notes,
    internalNotes: a.internal_notes,
    rescheduleCount: a.reschedule_count,
    cancelReason: a.cancel_reason,
    cancelledBy: a.cancelled_by,
    createdAt: a.created_at.toISOString(),
  };
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard', { preHandler: requirePermission('dashboard:read') }, async (req) => {
    const db = getPool();
    const scope = ownProfessionalScope(req);
    const settings = await getSettings(db);
    const tz = settings.timezone;
    const now = DateTime.now().setZone(tz);
    const dayStart = now.startOf('day');
    const dayEnd = dayStart.plus({ days: 1 });
    const monthStart = now.startOf('month');

    const [today, upcoming, counts, msgs] = await Promise.all([
      db.query<AppointmentFull>(
        `${APPOINTMENT_SELECT} WHERE a.start_at >= $1 AND a.start_at < $2 AND ($3::uuid IS NULL OR a.professional_id = $3::uuid)
         ORDER BY a.start_at, p.name`,
        [dayStart.toJSDate(), dayEnd.toJSDate(), scope],
      ),
      db.query<AppointmentFull>(
        `${APPOINTMENT_SELECT} WHERE a.start_at >= $1 AND a.status IN ('PENDING', 'CONFIRMED')
           AND ($2::uuid IS NULL OR a.professional_id = $2::uuid) ORDER BY a.start_at LIMIT 12`,
        [dayEnd.toJSDate(), scope],
      ),
      db.query<{ upcoming: number; pending: number; confirmed: number; cancelled_month: number; total: number; created_today: number; no_show_month: number }>(
        `SELECT
           count(*) FILTER (WHERE start_at >= now() AND status IN ('PENDING','CONFIRMED'))::int AS upcoming,
           count(*) FILTER (WHERE start_at >= now() AND status = 'PENDING')::int AS pending,
           count(*) FILTER (WHERE start_at >= now() AND status = 'CONFIRMED')::int AS confirmed,
           count(*) FILTER (WHERE status = 'CANCELLED' AND cancelled_at >= $1)::int AS cancelled_month,
           count(*) FILTER (WHERE status = 'NO_SHOW' AND start_at >= $1)::int AS no_show_month,
           count(*) FILTER (WHERE created_at >= $2)::int AS created_today,
           count(*)::int AS total
         FROM appointments WHERE ($3::uuid IS NULL OR professional_id = $3::uuid)`,
        [monthStart.toJSDate(), dayStart.toJSDate(), scope],
      ),
      db.query<{ manual: number; failed: number }>(
        `SELECT count(*) FILTER (WHERE status = 'MANUAL')::int AS manual,
                count(*) FILTER (WHERE status = 'FAILED' AND updated_at > now() - interval '7 days')::int AS failed
           FROM notifications`,
      ),
    ]);

    // Horários ainda livres hoje (por profissional, usando a menor duração de seus serviços)
    const { rows: profs } = await db.query<{ id: string; duration: number }>(
      `SELECT p.id, COALESCE(min(COALESCE(ps.duration_minutes, s.duration_minutes)), $2) AS duration
         FROM professionals p
         LEFT JOIN professional_services ps ON ps.professional_id = p.id
         LEFT JOIN services s ON s.id = ps.service_id AND s.active
        WHERE p.active AND ($1::uuid IS NULL OR p.id = $1::uuid) GROUP BY p.id`,
      [scope, settings.default_duration_minutes],
    );
    let freeToday = 0;
    if (profs.length) {
      const date = now.toISODate()!;
      const ctx = await loadContext(db, { ...settings, min_advance_minutes: 0 }, profs.map((p) => p.id), date, date);
      for (const p of profs) freeToday += slotsForDay(ctx, p.id, date, p.duration).length;
    }

    const todayRows = today.rows;
    const byStatus = (s: string) => todayRows.filter((a) => a.status === s).length;

    // Checklist de configuração inicial
    const { rows: checks } = await db.query<{ profs: number; without_schedule: number; services_without_prof: number }>(
      `SELECT
         (SELECT count(*)::int FROM professionals WHERE active) AS profs,
         (SELECT count(*)::int FROM professionals p WHERE p.active AND NOT EXISTS (SELECT 1 FROM schedules s WHERE s.professional_id = p.id)) AS without_schedule,
         (SELECT count(*)::int FROM services s WHERE s.active AND NOT EXISTS (
            SELECT 1 FROM professional_services ps JOIN professionals p ON p.id = ps.professional_id AND p.active WHERE ps.service_id = s.id)) AS services_without_prof`,
    );
    const setup: string[] = [];
    if (!settings.address) setup.push('Informe o endereço da clínica em Configurações.');
    if (!settings.phone && !settings.whatsapp) setup.push('Informe o telefone/WhatsApp da clínica em Configurações.');
    if (checks[0].without_schedule) setup.push(`${checks[0].without_schedule} profissional(is) sem horário de atendimento.`);
    if (checks[0].services_without_prof) setup.push(`${checks[0].services_without_prof} serviço(s) sem profissional vinculado (não aparecem horários).`);

    return {
      now: now.toISO(),
      today: {
        date: now.toISODate(),
        total: todayRows.filter((a) => a.status !== 'CANCELLED').length,
        pending: byStatus('PENDING'),
        confirmed: byStatus('CONFIRMED'),
        completed: byStatus('COMPLETED'),
        cancelled: byStatus('CANCELLED'),
        noShow: byStatus('NO_SHOW'),
        freeSlots: freeToday,
        appointments: todayRows.map((a) => adminAppointmentView(a, tz)),
      },
      upcoming: upcoming.rows.map((a) => adminAppointmentView(a, tz)),
      totals: counts.rows[0],
      messages: msgs.rows[0],
      setup: scope ? [] : setup,
    };
  });
}
