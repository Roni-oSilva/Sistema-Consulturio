import { DateTime } from 'luxon';
import type { FastifyBaseLogger } from 'fastify';
import { getPool } from '../db/pool.js';
import { purgeExpiredSessions } from '../auth/sessions.js';
import { purgeThrottle } from '../auth/throttle.js';
import { cancelAppointment, changeStatus } from '../services/appointments.js';
import { getAppointment } from '../services/appointmentRepo.js';
import { enqueue } from '../services/notifications/queue.js';
import { processDueNotifications, stillRelevant, type NotificationRow } from '../services/notifications/worker.js';
import { getSettings } from '../services/settings.js';
import { normalizePhone } from '../lib/validation.js';
import { config } from '../config.js';

/**
 * Automação em segundo plano (roda dentro do servidor):
 *  - envia mensagens da fila (confirmação, lembretes, avisos...) com novas tentativas;
 *  - envia a agenda do dia para cada profissional no horário configurado;
 *  - cancela automaticamente agendamentos não confirmados (se ativado);
 *  - conclui automaticamente atendimentos confirmados já passados (se ativado);
 *  - expira mensagens manuais vencidas e limpa sessões expiradas.
 */

export async function enqueueDailyAgendas(now = DateTime.now()) {
  const db = getPool();
  const s = await getSettings(db, true);
  if (!s.daily_agenda_enabled) return 0;
  const local = now.setZone(s.timezone);
  const [h, m] = s.daily_agenda_time.split(':').map(Number);
  const sendAt = local.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  // janela de 3h após o horário configurado (evita enviar agenda à noite após reinício)
  if (local < sendAt || local > sendAt.plus({ hours: 3 })) return 0;
  const date = local.toISODate()!;
  const dayStart = local.startOf('day');
  const { rows } = await db.query<{ id: string; notify_phone: string; notify_email: string }>(
    `SELECT p.id, p.notify_phone, p.notify_email FROM professionals p
      WHERE p.active AND p.daily_agenda AND (p.notify_phone <> '' OR p.notify_email <> '')
        AND EXISTS (SELECT 1 FROM appointments a WHERE a.professional_id = p.id AND a.status IN ('PENDING', 'CONFIRMED')
                    AND a.start_at >= $1 AND a.start_at < $2)`,
    [dayStart.toJSDate(), dayStart.plus({ days: 1 }).toJSDate()],
  );
  let n = 0;
  for (const p of rows) {
    const phone = p.notify_phone ? normalizePhone(p.notify_phone) : null;
    if (phone && s.whatsapp_enabled) {
      await enqueue(db, { professionalId: p.id, type: 'DAILY_AGENDA', channel: 'WHATSAPP', audience: 'PROFESSIONAL',
        recipient: phone, dedupeKey: `DAILY:${p.id}:${date}:W`, context: { date } });
      n++;
    }
    if (p.notify_email && s.email_enabled) {
      await enqueue(db, { professionalId: p.id, type: 'DAILY_AGENDA', channel: 'EMAIL', audience: 'PROFESSIONAL',
        recipient: p.notify_email, dedupeKey: `DAILY:${p.id}:${date}:E`, context: { date } });
      n++;
    }
  }
  return n;
}

/** Cancela PENDENTES que não confirmaram presença após o lembrete (opcional). */
export async function autoCancelUnconfirmed() {
  const db = getPool();
  const s = await getSettings(db, true);
  if (s.auto_cancel_unconfirmed_hours <= 0) return 0;
  const { rows } = await db.query<{ id: string }>(
    `SELECT a.id FROM appointments a
      WHERE a.status = 'PENDING' AND a.start_at > now()
        AND a.start_at <= now() + make_interval(hours => $1)
        AND EXISTS (SELECT 1 FROM notifications n WHERE n.appointment_id = a.id AND n.type = 'REMINDER'
                    AND n.status = 'SENT' AND n.sent_at < now() - interval '2 hours')`,
    [s.auto_cancel_unconfirmed_hours],
  );
  for (const r of rows) {
    await cancelAppointment(r.id, { type: 'SYSTEM' }, 'Presença não confirmada após o lembrete.', { enforcePolicy: false }).catch(() => {});
  }
  return rows.length;
}

/** Marca como CONCLUÍDO o atendimento confirmado já encerrado há X horas (opcional). */
export async function autoComplete() {
  const db = getPool();
  const s = await getSettings(db, true);
  if (s.auto_complete_after_hours <= 0) return 0;
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM appointments WHERE status = 'CONFIRMED' AND end_at < now() - make_interval(hours => $1) LIMIT 200`,
    [s.auto_complete_after_hours],
  );
  for (const r of rows) await changeStatus(r.id, 'COMPLETED', { type: 'SYSTEM' }).catch(() => {});
  return rows.length;
}

/** Mensagens manuais (WhatsApp sem API) que perderam o sentido são retiradas da fila. */
export async function expireManual() {
  const db = getPool();
  const { rows } = await db.query<NotificationRow>(`SELECT * FROM notifications WHERE status = 'MANUAL' LIMIT 500`);
  for (const n of rows) {
    if (!n.appointment_id) {
      if (Date.now() - new Date(n.scheduled_for).getTime() > 24 * 3600_000) {
        await db.query(`UPDATE notifications SET status = 'CANCELLED', last_error = 'Expirada', updated_at = now() WHERE id = $1`, [n.id]);
      }
      continue;
    }
    const appt = await getAppointment(db, n.appointment_id);
    const reason = n.audience === 'PATIENT' ? stillRelevant(n, appt) : null;
    if (reason) {
      await db.query(`UPDATE notifications SET status = 'CANCELLED', last_error = $2, updated_at = now() WHERE id = $1`, [n.id, reason]);
    }
  }
}

export async function housekeeping() {
  const db = getPool();
  // mensagens presas em PROCESSING (ex.: servidor reiniciou no meio do envio)
  await db.query(
    `UPDATE notifications SET status = 'PENDING', updated_at = now() WHERE status = 'PROCESSING' AND updated_at < now() - interval '10 minutes'`,
  );
  await purgeExpiredSessions();
  await purgeThrottle();
}

export function startScheduler(log: FastifyBaseLogger) {
  let running = false;
  let ticks = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await processDueNotifications();
      if (ticks % 4 === 0) {
        await enqueueDailyAgendas();
        await autoCancelUnconfirmed();
        await autoComplete();
        await expireManual();
      }
      if (ticks % 20 === 0) await housekeeping();
    } catch (err) {
      log.error({ err }, '[scheduler] erro na automação');
    } finally {
      ticks++;
      running = false;
    }
  };
  const handle = setInterval(tick, config().JOBS_INTERVAL_MS);
  setTimeout(tick, Math.min(3_000, config().JOBS_INTERVAL_MS));
  return () => clearInterval(handle);
}
