import { DateTime } from 'luxon';
import { config } from '../../config.js';
import { getPool, type Queryable } from '../../db/pool.js';
import { signAccessToken } from '../../lib/crypto.js';
import { fmtDate, fmtTime, weekdayName } from '../../lib/time.js';
import { formatPhone } from '../../lib/validation.js';
import { getAppointment, professionalLabel, type AppointmentFull } from '../appointmentRepo.js';
import { cancellationPolicyText, getSettings, type ClinicSettings } from '../settings.js';
import { renderTemplate, type Channel, type NotificationType } from './defaults.js';
import { sendEmail, sendSms, sendWhatsApp, type SendResult } from './providers.js';

export type NotificationRow = {
  id: string;
  appointment_id: string | null;
  professional_id: string | null;
  type: NotificationType;
  channel: Channel;
  audience: 'PATIENT' | 'CLINIC' | 'PROFESSIONAL';
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduled_for: Date;
  attempts: number;
  context: Record<string, unknown>;
};

const MAX_ATTEMPTS = 5;

/** Link seguro (assinado) para o paciente gerenciar o agendamento. */
export function appointmentLink(appt: Pick<AppointmentFull, 'id' | 'end_at'>): string {
  const untilEnd = Math.floor((new Date(appt.end_at).getTime() - Date.now()) / 1000) + 30 * 86400;
  const ttl = Math.max(7 * 86400, untilEnd);
  return `${config().PUBLIC_URL}/agendamento/${appt.id}?t=${signAccessToken(appt.id, ttl)}`;
}

export function appointmentVars(appt: AppointmentFull, settings: ClinicSettings, channel: Channel): Record<string, string> {
  const tz = settings.timezone;
  const plain = channel !== 'WHATSAPP';
  return {
    paciente: appt.patient_name,
    primeiro_nome: appt.patient_name.split(' ')[0] ?? appt.patient_name,
    clinica: settings.short_name || settings.name,
    servico: appt.service_name,
    profissional: professionalLabel(appt),
    data: fmtDate(appt.start_at, tz),
    dia_semana: weekdayName(appt.start_at, tz),
    hora: fmtTime(appt.start_at, tz),
    endereco: settings.address,
    telefone_clinica: settings.phone,
    whatsapp_clinica: settings.whatsapp,
    codigo: appt.code,
    link: appointmentLink(appt),
    link_agendar: `${config().PUBLIC_URL}/agendar`,
    preparo: appt.service_preparation ? `${plain ? '' : 'ℹ️ '}Preparo: ${appt.service_preparation}` : '',
    politica_cancelamento: cancellationPolicyText(settings),
    motivo: appt.cancel_reason ? `Motivo: ${appt.cancel_reason}` : '',
    avaliacao_link: settings.review_url ? `⭐ Conte como foi sua experiência: ${settings.review_url}` : '',
    telefone_paciente: formatPhone(appt.contact_phone),
  };
}

async function dailyAgendaVars(db: Queryable, n: NotificationRow, settings: ClinicSettings) {
  const date = String(n.context.date ?? '');
  const tz = settings.timezone;
  const dayStart = DateTime.fromISO(date, { zone: tz }).startOf('day');
  const { rows } = await db.query<{ start_at: Date; patient_name: string; service_name: string; status: string }>(
    `SELECT a.start_at, a.patient_name, s.name AS service_name, a.status
       FROM appointments a JOIN services s ON s.id = a.service_id
      WHERE a.professional_id = $1 AND a.status IN ('PENDING', 'CONFIRMED')
        AND a.start_at >= $2 AND a.start_at < $3 ORDER BY a.start_at`,
    [n.professional_id, dayStart.toJSDate(), dayStart.plus({ days: 1 }).toJSDate()],
  );
  const { rows: prof } = await db.query<{ name: string; title: string }>('SELECT name, title FROM professionals WHERE id = $1', [
    n.professional_id,
  ]);
  const agenda = rows
    .map((r) => `${fmtTime(r.start_at, tz)} — ${r.patient_name} (${r.service_name})${r.status === 'PENDING' ? ' · a confirmar' : ''}`)
    .join('\n');
  return {
    vars: {
      profissional: prof[0] ? [prof[0].title, prof[0].name].filter(Boolean).join(' ') : '',
      data: dayStart.toFormat('dd/LL/yyyy'),
      total: String(rows.length),
      agenda,
      clinica: settings.short_name || settings.name,
    },
    count: rows.length,
  };
}

/** A mensagem ainda faz sentido? (ex.: lembrete de consulta cancelada não deve sair) */
export function stillRelevant(n: Pick<NotificationRow, 'type' | 'context'>, appt: AppointmentFull | null): string | null {
  if (!appt) return null;
  const active = appt.status === 'PENDING' || appt.status === 'CONFIRMED';
  const future = appt.start_at.getTime() > Date.now();
  const sameTime = !n.context.start_at || n.context.start_at === appt.start_at.toISOString();
  switch (n.type) {
    case 'REMINDER':
    case 'REMINDER_SHORT':
    case 'BOOKING_CREATED':
    case 'APPOINTMENT_CONFIRMED':
    case 'RESCHEDULED':
      if (!active) return 'Agendamento não está mais ativo';
      if (!future) return 'Horário do agendamento já passou';
      if (!sameTime) return 'Agendamento foi remarcado';
      return null;
    case 'CANCELLED':
      return appt.status === 'CANCELLED' ? null : 'Agendamento foi reativado';
    case 'POST_VISIT':
      return appt.status === 'COMPLETED' ? null : 'Atendimento não está concluído';
    case 'NO_SHOW':
      return appt.status === 'NO_SHOW' ? null : 'Status não é mais "falta"';
    default:
      return null;
  }
}

/** Monta assunto e texto finais da mensagem a partir do modelo atual. */
export async function renderNotification(
  db: Queryable,
  n: NotificationRow,
): Promise<{ subject: string; body: string; skip?: string }> {
  const settings = await getSettings(db);
  const { rows } = await db.query<{ subject: string; body: string; enabled: boolean }>(
    'SELECT subject, body, enabled FROM message_templates WHERE type = $1 AND channel = $2',
    [n.type, n.channel],
  );
  const tpl = rows[0];
  if (!tpl || !tpl.enabled) return { subject: '', body: '', skip: 'Modelo de mensagem desativado' };

  let vars: Record<string, string>;
  if (n.type === 'DAILY_AGENDA') {
    const r = await dailyAgendaVars(db, n, settings);
    if (r.count === 0) return { subject: '', body: '', skip: 'Sem atendimentos no dia' };
    vars = r.vars;
  } else {
    const appt = n.appointment_id ? await getAppointment(db, n.appointment_id) : null;
    if (!appt) return { subject: '', body: '', skip: 'Agendamento não encontrado' };
    const reason = stillRelevant(n, appt);
    if (reason) return { subject: '', body: '', skip: reason };
    vars = appointmentVars(appt, settings, n.channel);
  }
  return { subject: renderTemplate(tpl.subject, vars), body: renderTemplate(tpl.body, vars) };
}

async function deliver(n: NotificationRow, subject: string, body: string): Promise<SendResult> {
  const settings = await getSettings(getPool());
  if (n.channel === 'WHATSAPP') return sendWhatsApp(n.recipient, body);
  if (n.channel === 'EMAIL') return sendEmail(n.recipient, subject, body, settings.short_name || settings.name);
  return sendSms(n.recipient, body);
}

async function processOne(n: NotificationRow) {
  const db = getPool();
  try {
    const r = await renderNotification(db, n);
    if (r.skip) {
      await db.query(`UPDATE notifications SET status = 'CANCELLED', last_error = $2, updated_at = now() WHERE id = $1`, [n.id, r.skip]);
      return;
    }
    const result = await deliver(n, r.subject, r.body);
    await db.query(
      `UPDATE notifications SET status = $2, subject = $3, body = $4, provider = $5, provider_message_id = $6,
              sent_at = CASE WHEN $2 = 'SENT' THEN now() ELSE NULL END, last_error = '', updated_at = now()
        WHERE id = $1`,
      [n.id, result.status, r.subject, r.body, result.provider, result.providerMessageId ?? ''],
    );
  } catch (err) {
    const msg = (err as Error).message.slice(0, 500);
    const failed = n.attempts >= MAX_ATTEMPTS;
    // nova tentativa com espera exponencial: 2, 4, 8, 16 minutos...
    await db.query(
      `UPDATE notifications SET status = $2, last_error = $3,
              scheduled_for = CASE WHEN $2 = 'PENDING' THEN now() + make_interval(mins => $4) ELSE scheduled_for END,
              updated_at = now()
        WHERE id = $1`,
      [n.id, failed ? 'FAILED' : 'PENDING', msg, 2 ** n.attempts],
    );
  }
}

/** Processa as mensagens vencidas. Seguro com várias instâncias (SKIP LOCKED). */
export async function processDueNotifications(limit = 25): Promise<number> {
  const { rows } = await getPool().query<NotificationRow>(
    `UPDATE notifications SET status = 'PROCESSING', attempts = attempts + 1, updated_at = now()
      WHERE id IN (
        SELECT id FROM notifications WHERE status = 'PENDING' AND scheduled_for <= now()
         ORDER BY scheduled_for LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [limit],
  );
  for (const n of rows) await processOne(n);
  return rows.length;
}

/** Reenvia imediatamente (botão "Tentar de novo" no painel). */
export async function retryNotification(id: string) {
  const { rows } = await getPool().query<NotificationRow>(
    `UPDATE notifications SET status = 'PROCESSING', attempts = 1, updated_at = now()
      WHERE id = $1 AND status IN ('FAILED', 'CANCELLED', 'MANUAL', 'PENDING') RETURNING *`,
    [id],
  );
  if (rows[0]) await processOne(rows[0]);
}
