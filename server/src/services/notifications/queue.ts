import { DateTime } from 'luxon';
import type { Queryable } from '../../db/pool.js';
import { normalizePhone } from '../../lib/validation.js';
import type { AppointmentFull } from '../appointmentRepo.js';
import type { ClinicSettings } from '../settings.js';
import type { Channel, NotificationType } from './defaults.js';

/**
 * Fila de mensagens (padrão "outbox"): as mensagens são gravadas na MESMA
 * transação do agendamento. Um processo em segundo plano envia depois,
 * com novas tentativas automáticas. Assim nenhuma mensagem se perde e
 * nenhuma é enviada para um agendamento que não foi salvo.
 */

type EnqueueInput = {
  appointmentId?: string | null;
  professionalId?: string | null;
  type: NotificationType;
  channel: Channel;
  audience: 'PATIENT' | 'CLINIC' | 'PROFESSIONAL';
  recipient: string;
  scheduledFor?: Date;
  dedupeKey?: string;
  context?: Record<string, unknown>;
};

export async function enqueue(db: Queryable, n: EnqueueInput) {
  await db.query(
    `INSERT INTO notifications (appointment_id, professional_id, type, channel, audience, recipient, scheduled_for, dedupe_key, context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [
      n.appointmentId ?? null,
      n.professionalId ?? null,
      n.type,
      n.channel,
      n.audience,
      n.recipient,
      n.scheduledFor ?? new Date(),
      n.dedupeKey ?? null,
      JSON.stringify(n.context ?? {}),
    ],
  );
}

async function enabledChannels(db: Queryable, type: NotificationType): Promise<Set<Channel>> {
  const { rows } = await db.query<{ channel: Channel }>(
    'SELECT channel FROM message_templates WHERE type = $1 AND enabled',
    [type],
  );
  return new Set(rows.map((r) => r.channel));
}

/** Enfileira uma mensagem ao paciente em todos os canais ativos. */
export async function enqueuePatient(
  db: Queryable,
  appt: Pick<AppointmentFull, 'id' | 'contact_phone' | 'contact_email' | 'start_at'>,
  type: NotificationType,
  settings: ClinicSettings,
  scheduledFor?: Date,
) {
  const channels = await enabledChannels(db, type);
  const startKey = new Date(appt.start_at).toISOString();
  const context = { start_at: startKey };
  const base = { appointmentId: appt.id, type, audience: 'PATIENT' as const, scheduledFor, context };
  if (settings.whatsapp_enabled && channels.has('WHATSAPP') && appt.contact_phone) {
    await enqueue(db, { ...base, channel: 'WHATSAPP', recipient: appt.contact_phone, dedupeKey: `${appt.id}:${type}:WHATSAPP:${startKey}` });
  }
  if (settings.email_enabled && channels.has('EMAIL') && appt.contact_email) {
    await enqueue(db, { ...base, channel: 'EMAIL', recipient: appt.contact_email, dedupeKey: `${appt.id}:${type}:EMAIL:${startKey}` });
  }
  if (settings.sms_enabled && channels.has('SMS') && appt.contact_phone) {
    await enqueue(db, { ...base, channel: 'SMS', recipient: appt.contact_phone, dedupeKey: `${appt.id}:${type}:SMS:${startKey}` });
  }
}

/** Avisa a recepção/clínica (WhatsApp/e-mail internos configurados). */
export async function enqueueClinic(
  db: Queryable,
  appt: Pick<AppointmentFull, 'id' | 'start_at'>,
  type: NotificationType,
  settings: ClinicSettings,
) {
  if (!settings.clinic_notify_enabled) return;
  const channels = await enabledChannels(db, type);
  const key = `${appt.id}:${type}:${new Date(appt.start_at).toISOString()}:${Date.now()}`;
  const phone = settings.clinic_notify_whatsapp ? normalizePhone(settings.clinic_notify_whatsapp) : null;
  if (phone && settings.whatsapp_enabled && channels.has('WHATSAPP')) {
    await enqueue(db, { appointmentId: appt.id, type, channel: 'WHATSAPP', audience: 'CLINIC', recipient: phone, dedupeKey: `${key}:W` });
  }
  if (settings.clinic_notify_email && settings.email_enabled && channels.has('EMAIL')) {
    await enqueue(db, { appointmentId: appt.id, type, channel: 'EMAIL', audience: 'CLINIC', recipient: settings.clinic_notify_email, dedupeKey: `${key}:E` });
  }
}

/** Agenda lembretes automáticos conforme as configurações da clínica. */
export async function scheduleReminders(
  db: Queryable,
  appt: Pick<AppointmentFull, 'id' | 'contact_phone' | 'contact_email' | 'start_at'>,
  settings: ClinicSettings,
) {
  const start = DateTime.fromJSDate(new Date(appt.start_at));
  const minFuture = DateTime.now().plus({ minutes: 30 });
  if (settings.reminder1_hours > 0) {
    const at = start.minus({ hours: settings.reminder1_hours });
    if (at > minFuture) await enqueuePatient(db, appt, 'REMINDER', settings, at.toJSDate());
  }
  if (settings.reminder2_hours > 0) {
    const at = start.minus({ hours: settings.reminder2_hours });
    if (at > minFuture) await enqueuePatient(db, appt, 'REMINDER_SHORT', settings, at.toJSDate());
  }
}

/** Cancela mensagens ainda não enviadas do agendamento (ex.: após cancelar/remarcar). */
export async function cancelPending(db: Queryable, appointmentId: string, reason: string, audience: string[] = ['PATIENT']) {
  await db.query(
    `UPDATE notifications SET status = 'CANCELLED', last_error = $2, updated_at = now()
      WHERE appointment_id = $1 AND status IN ('PENDING', 'MANUAL') AND audience = ANY($3)`,
    [appointmentId, reason, audience],
  );
}
