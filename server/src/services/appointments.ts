import { DateTime } from 'luxon';
import { withTransaction, type DbClient, type Queryable } from '../db/pool.js';
import { appointmentCode, randomToken, sha256 } from '../lib/crypto.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { normalizeNameKey } from '../lib/validation.js';
import { checkSlot, loadContext } from './availability.js';
import { addEvent, getAppointment, type AppointmentFull, type AppointmentStatus } from './appointmentRepo.js';
import { cancelPending, enqueueClinic, enqueuePatient, scheduleReminders } from './notifications/queue.js';
import { getSettings, type ClinicSettings } from './settings.js';

export const SLOT_TAKEN_MSG = 'Esse horário acabou de ser reservado. Escolha outro horário.';

type Actor = { type: 'PATIENT' | 'STAFF' | 'SYSTEM'; userId?: string | null };

export type CreateInput = {
  serviceId: string;
  professionalId?: string | null;
  start: string; // ISO 8601 (o servidor revalida tudo)
  patient: {
    name: string;
    phone: string; // normalizado
    email?: string | null;
    cpf?: string | null;
    birthDate?: string | null;
  };
  notes?: string;
  internalNotes?: string;
  consent?: boolean;
  source: 'ONLINE' | 'ADMIN';
  /** Encaixe (somente equipe): ignora expediente/bloqueios, nunca a sobreposição. */
  allowOutsideSchedule?: boolean;
  ipHash?: string;
  actor: Actor;
};

function isExclusionViolation(err: unknown) {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23P01';
}

/** Trava consultiva dentro da transação (serializa reservas do mesmo recurso). */
async function lock(client: DbClient, key: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}

type Candidate = { id: string; duration: number };

async function candidatesFor(client: DbClient, serviceId: string, professionalId: string | null): Promise<Candidate[]> {
  const { rows } = await client.query<{ id: string; duration: number }>(
    `SELECT p.id, COALESCE(ps.duration_minutes, s.duration_minutes) AS duration
       FROM professionals p
       JOIN professional_services ps ON ps.professional_id = p.id
       JOIN services s ON s.id = ps.service_id
      WHERE ps.service_id = $1 AND p.active AND ($2::uuid IS NULL OR p.id = $2::uuid)
      ORDER BY p.sort_order, p.name`,
    [serviceId, professionalId],
  );
  return rows;
}

function parseStart(start: string, tz: string): DateTime {
  const dt = DateTime.fromISO(start, { setZone: true });
  if (!dt.isValid) throw badRequest('Horário inválido.', 'INVALID_START');
  if (dt.second !== 0 || dt.millisecond !== 0) throw badRequest('Horário inválido.', 'INVALID_START');
  return dt.setZone(tz);
}

function slotError(reason: string): AppError {
  if (reason === 'BUSY') return conflict(SLOT_TAKEN_MSG, 'SLOT_TAKEN');
  if (reason === 'PAST') return badRequest('Não é possível agendar em um horário que já passou.', 'SLOT_PAST');
  if (reason === 'OUT_OF_RANGE') return badRequest('Este horário está fora do período aberto para agendamento.', 'SLOT_OUT_OF_RANGE');
  return conflict('Este horário não está disponível. Escolha outro horário.', 'SLOT_UNAVAILABLE');
}

/**
 * Cria um agendamento com todas as verificações do servidor:
 * 1. dados validados (rota)  2. serviço existe/ativo  3. profissional ativo
 * 4. profissional atende o serviço  5. data válida  6. dentro do expediente
 * 7. não bloqueado  8. disponibilidade reconferida  9. transação  10. sem duplicidade
 */
export async function createAppointment(input: CreateInput): Promise<{ appointment: AppointmentFull; accessToken: string }> {
  try {
    return await withTransaction(async (client) => {
      const settings = await getSettings(client, true);
      const tz = settings.timezone;

      const { rows: svcRows } = await client.query<{ id: string; active: boolean; allow_choose_professional: boolean }>(
        'SELECT id, active, allow_choose_professional FROM services WHERE id = $1',
        [input.serviceId],
      );
      const service = svcRows[0];
      if (!service || !service.active) throw badRequest('Serviço não encontrado ou indisponível.', 'SERVICE_NOT_FOUND');

      // Se o serviço não permite escolha (online), o sistema escolhe o profissional.
      const requestedProf =
        input.source === 'ONLINE' && !service.allow_choose_professional ? null : (input.professionalId ?? null);
      let candidates = await candidatesFor(client, service.id, requestedProf);
      if (requestedProf && candidates.length === 0) {
        throw badRequest('Profissional indisponível para este serviço.', 'PROFESSIONAL_NOT_AVAILABLE');
      }
      if (candidates.length === 0) throw badRequest('Não há profissionais disponíveis para este serviço.', 'NO_PROFESSIONALS');

      const start = parseStart(input.start, tz);
      const date = start.toISODate()!;

      // Travas: primeiro o telefone (limites por paciente), depois os profissionais em ordem fixa (sem deadlock).
      await lock(client, `phone:${input.patient.phone}`);
      for (const c of [...candidates].sort((a, b) => a.id.localeCompare(b.id))) await lock(client, `prof:${c.id}`);

      const ctx = await loadContext(client, settings, candidates.map((c) => c.id), date, date, {
        ignoreRules: input.allowOutsideSchedule,
      });

      // Distribui a carga: profissional com menos atendimentos no dia primeiro.
      if (candidates.length > 1) {
        const load = (id: string) => ctx.busy.get(id)?.length ?? 0;
        candidates = [...candidates].sort((a, b) => load(a.id) - load(b.id));
      }
      let chosen: Candidate | null = null;
      let lastReason = 'UNAVAILABLE';
      for (const c of candidates) {
        const r = checkSlot(ctx, c.id, start, c.duration, { ignoreSchedule: input.allowOutsideSchedule });
        if (r.ok) {
          chosen = c;
          break;
        }
        lastReason = r.reason;
      }
      if (!chosen) throw slotError(candidates.length > 1 && lastReason !== 'PAST' && lastReason !== 'OUT_OF_RANGE' ? 'BUSY' : lastReason);
      const end = start.plus({ minutes: chosen.duration });

      await enforcePatientLimits(client, settings, input.patient.phone, start, end, input.source);

      const patientId = await upsertPatient(client, input.patient);
      const token = randomToken(32);
      const status: AppointmentStatus = input.source === 'ADMIN' ? 'CONFIRMED' : settings.initial_status;

      let id: string | null = null;
      for (let attempt = 0; attempt < 5 && !id; attempt++) {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO appointments (code, access_token_hash, service_id, professional_id, patient_id, patient_name,
              contact_phone, contact_email, start_at, end_at, status, source, patient_notes, internal_notes,
              confirmed_at, created_by, ip_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           ON CONFLICT (code) DO NOTHING RETURNING id`,
          [
            appointmentCode(), sha256(token), service.id, chosen.id, patientId, input.patient.name,
            input.patient.phone, input.patient.email || null, start.toJSDate(), end.toJSDate(), status, input.source,
            input.notes ?? '', input.internalNotes ?? '', status === 'CONFIRMED' ? new Date() : null,
            input.actor.type === 'STAFF' ? input.actor.userId : null, input.ipHash ?? '',
          ],
        );
        id = rows[0]?.id ?? null;
      }
      if (!id) throw new Error('Não foi possível gerar código único do agendamento');

      await addEvent(client, {
        appointmentId: id,
        actorType: input.actor.type,
        actorUserId: input.actor.userId,
        action: 'CREATED',
        toStatus: status,
        details: { source: input.source, outside_schedule: !!input.allowOutsideSchedule },
      });

      if (input.consent) {
        for (const type of ['PRIVACY_POLICY', 'MESSAGES']) {
          await client.query(
            `INSERT INTO consents (patient_id, appointment_id, type, version, granted, ip_hash) VALUES ($1, $2, $3, $4, true, $5)`,
            [patientId, id, type, settings.privacy_policy_version, input.ipHash ?? ''],
          );
        }
      }

      const appointment = (await getAppointment(client, id))!;
      if (appointment.start_at.getTime() > Date.now()) {
        await enqueuePatient(client, appointment, 'BOOKING_CREATED', settings);
        await scheduleReminders(client, appointment, settings);
        if (input.source === 'ONLINE') await enqueueClinic(client, appointment, 'CLINIC_NEW_BOOKING', settings);
      }
      return { appointment, accessToken: token };
    });
  } catch (err) {
    // A constraint de exclusão do banco é a garantia final contra reserva dupla.
    if (isExclusionViolation(err)) throw conflict(SLOT_TAKEN_MSG, 'SLOT_TAKEN');
    throw err;
  }
}

async function enforcePatientLimits(
  client: DbClient,
  settings: ClinicSettings,
  phone: string,
  start: DateTime,
  end: DateTime,
  source: 'ONLINE' | 'ADMIN',
  excludeId?: string,
) {
  const { rows: overlap } = await client.query(
    `SELECT 1 FROM appointments
      WHERE contact_phone = $1 AND status IN ('PENDING', 'CONFIRMED')
        AND start_at < $3 AND end_at > $2 AND ($4::uuid IS NULL OR id <> $4::uuid) LIMIT 1`,
    [phone, start.toJSDate(), end.toJSDate(), excludeId ?? null],
  );
  if (overlap.length) {
    throw conflict('Já existe um agendamento para este telefone neste mesmo horário.', 'PATIENT_OVERLAP');
  }
  if (source === 'ONLINE' && !excludeId) {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM appointments
        WHERE contact_phone = $1 AND status IN ('PENDING', 'CONFIRMED') AND start_at > now()`,
      [phone],
    );
    if (rows[0].n >= settings.max_active_per_phone) {
      throw conflict(
        `Este telefone já possui ${rows[0].n} agendamentos futuros. Para marcar mais, entre em contato com a clínica.`,
        'PATIENT_LIMIT',
      );
    }
  }
}

async function upsertPatient(client: DbClient, p: CreateInput['patient']): Promise<string> {
  const nameKey = normalizeNameKey(p.name);
  // Mesmo telefone pode ser de uma família (ex.: mãe agenda para o filho):
  // identificamos o paciente por telefone + nome.
  const { rows } = await client.query<{ id: string }>(
    'SELECT id FROM patients WHERE phone = $1 AND name_key = $2 AND anonymized_at IS NULL ORDER BY created_at LIMIT 1',
    [p.phone, nameKey],
  );
  if (rows[0]) {
    await client.query(
      `UPDATE patients SET email = COALESCE($2, email), cpf = COALESCE($3, cpf), birth_date = COALESCE($4, birth_date), updated_at = now()
        WHERE id = $1`,
      [rows[0].id, p.email || null, p.cpf || null, p.birthDate || null],
    );
    return rows[0].id;
  }
  const ins = await client.query<{ id: string }>(
    `INSERT INTO patients (name, name_key, phone, email, cpf, birth_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [p.name, nameKey, p.phone, p.email || null, p.cpf || null, p.birthDate || null],
  );
  return ins.rows[0].id;
}

/** Regra de cancelamento/remarcação online definida pela clínica. */
export function patientCanChange(appt: AppointmentFull, settings: ClinicSettings): { ok: boolean; reason?: string } {
  if (appt.status !== 'PENDING' && appt.status !== 'CONFIRMED') {
    return { ok: false, reason: 'Este agendamento não pode mais ser alterado.' };
  }
  const limit = DateTime.fromJSDate(appt.start_at).minus({ hours: settings.cancel_min_hours });
  if (DateTime.now() > limit) {
    return {
      ok: false,
      reason: `Alterações online são permitidas até ${settings.cancel_min_hours} hora(s) antes do horário. Entre em contato com a clínica.`,
    };
  }
  return { ok: true };
}

export async function cancelAppointment(
  id: string,
  actor: Actor,
  reason: string,
  opts: { enforcePolicy: boolean },
): Promise<AppointmentFull> {
  return withTransaction(async (client) => {
    const settings = await getSettings(client, true);
    const appt = await getAppointment(client, id, true);
    if (!appt) throw notFound('Agendamento não encontrado.');
    if (appt.status === 'CANCELLED') throw conflict('Este agendamento já foi cancelado.', 'ALREADY_CANCELLED');
    if (opts.enforcePolicy) {
      const can = patientCanChange(appt, settings);
      if (!can.ok) throw forbidden(can.reason);
    } else if (appt.status !== 'PENDING' && appt.status !== 'CONFIRMED') {
      throw badRequest('Somente agendamentos pendentes ou confirmados podem ser cancelados.');
    }
    await client.query(
      `UPDATE appointments SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3, updated_at = now()
        WHERE id = $1`,
      [id, actor.type, reason],
    );
    await addEvent(client, {
      appointmentId: id, actorType: actor.type, actorUserId: actor.userId, action: 'CANCELLED',
      fromStatus: appt.status, toStatus: 'CANCELLED', details: { reason },
    });
    await cancelPending(client, id, 'Agendamento cancelado');
    const updated = (await getAppointment(client, id))!;
    if (updated.start_at.getTime() > Date.now()) {
      await enqueuePatient(client, updated, 'CANCELLED', settings);
      if (actor.type !== 'STAFF') await enqueueClinic(client, updated, 'CLINIC_CANCELLED', settings);
    }
    return updated;
  });
}

export async function rescheduleAppointment(input: {
  id: string;
  start: string;
  professionalId?: string | null;
  actor: Actor;
  enforcePolicy: boolean;
  allowOutsideSchedule?: boolean;
}): Promise<AppointmentFull> {
  try {
    return await withTransaction(async (client) => {
      const settings = await getSettings(client, true);
      const appt = await getAppointment(client, input.id, true);
      if (!appt) throw notFound('Agendamento não encontrado.');
      if (input.enforcePolicy) {
        if (!settings.allow_patient_reschedule) throw forbidden('A remarcação online não está disponível. Entre em contato com a clínica.');
        const can = patientCanChange(appt, settings);
        if (!can.ok) throw forbidden(can.reason);
      } else if (appt.status !== 'PENDING' && appt.status !== 'CONFIRMED') {
        throw badRequest('Somente agendamentos pendentes ou confirmados podem ser remarcados.');
      }
      const profId = input.professionalId || appt.professional_id;
      const cands = await candidatesFor(client, appt.service_id, profId);
      if (!cands.length) throw badRequest('Profissional indisponível para este serviço.', 'PROFESSIONAL_NOT_AVAILABLE');
      const cand = cands[0];
      const start = parseStart(input.start, settings.timezone);
      await lock(client, `phone:${appt.contact_phone}`);
      await lock(client, `prof:${cand.id}`);
      const date = start.toISODate()!;
      const ctx = await loadContext(client, settings, [cand.id], date, date, {
        ignoreRules: input.allowOutsideSchedule,
        excludeAppointmentId: appt.id,
      });
      const r = checkSlot(ctx, cand.id, start, cand.duration, { ignoreSchedule: input.allowOutsideSchedule });
      if (!r.ok) throw slotError(r.reason);
      const end = start.plus({ minutes: cand.duration });
      await enforcePatientLimits(client, settings, appt.contact_phone, start, end, 'ONLINE', appt.id);

      await client.query(
        `UPDATE appointments SET start_at = $2, end_at = $3, professional_id = $4, reschedule_count = reschedule_count + 1,
            updated_at = now() WHERE id = $1`,
        [appt.id, start.toJSDate(), end.toJSDate(), cand.id],
      );
      await addEvent(client, {
        appointmentId: appt.id, actorType: input.actor.type, actorUserId: input.actor.userId, action: 'RESCHEDULED',
        details: {
          from: appt.start_at.toISOString(), to: start.toISO(),
          from_professional: appt.professional_id, to_professional: cand.id,
        },
      });
      await cancelPending(client, appt.id, 'Agendamento remarcado');
      const updated = (await getAppointment(client, appt.id))!;
      await enqueuePatient(client, updated, 'RESCHEDULED', settings);
      await scheduleReminders(client, updated, settings);
      if (input.actor.type === 'PATIENT') await enqueueClinic(client, updated, 'CLINIC_RESCHEDULED', settings);
      return updated;
    });
  } catch (err) {
    if (isExclusionViolation(err)) throw conflict(SLOT_TAKEN_MSG, 'SLOT_TAKEN');
    throw err;
  }
}

const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING: ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'],
  CONFIRMED: ['PENDING', 'COMPLETED', 'NO_SHOW', 'CANCELLED'],
  COMPLETED: ['CONFIRMED', 'NO_SHOW'],
  NO_SHOW: ['CONFIRMED', 'COMPLETED'],
  CANCELLED: ['CONFIRMED'], // reativar (só se o horário ainda estiver livre)
};

export async function changeStatus(
  id: string,
  to: AppointmentStatus,
  actor: Actor,
  opts: { reason?: string; professionalScope?: string | null } = {},
): Promise<AppointmentFull> {
  if (to === 'CANCELLED') return cancelAppointment(id, actor, opts.reason ?? '', { enforcePolicy: false });
  try {
    return await withTransaction(async (client) => {
      const settings = await getSettings(client, true);
      const appt = await getAppointment(client, id, true);
      if (!appt) throw notFound('Agendamento não encontrado.');
      if (opts.professionalScope && appt.professional_id !== opts.professionalScope) throw notFound('Agendamento não encontrado.');
      if (appt.status === to) return appt;
      if (!TRANSITIONS[appt.status].includes(to)) {
        throw badRequest(`Não é possível mudar de ${appt.status} para ${to}.`, 'INVALID_TRANSITION');
      }
      if ((to === 'COMPLETED' || to === 'NO_SHOW') && appt.start_at.getTime() > Date.now()) {
        throw badRequest('Só é possível marcar como concluído ou falta após o horário do atendimento.', 'NOT_STARTED');
      }
      const sets: Record<AppointmentStatus, string> = {
        CONFIRMED: 'confirmed_at = COALESCE(confirmed_at, now()), cancelled_at = NULL, cancelled_by = NULL, cancel_reason = \'\', completed_at = NULL, no_show_at = NULL',
        PENDING: 'confirmed_at = NULL',
        COMPLETED: 'completed_at = now(), no_show_at = NULL',
        NO_SHOW: 'no_show_at = now(), completed_at = NULL',
        CANCELLED: '',
      };
      await client.query(`UPDATE appointments SET status = $2, ${sets[to]}, updated_at = now() WHERE id = $1`, [id, to]);
      await addEvent(client, {
        appointmentId: id, actorType: actor.type, actorUserId: actor.userId,
        action: appt.status === 'CANCELLED' ? 'REACTIVATED' : 'STATUS_CHANGED',
        fromStatus: appt.status, toStatus: to, details: opts.reason ? { reason: opts.reason } : {},
      });
      const updated = (await getAppointment(client, id))!;
      const future = updated.start_at.getTime() > Date.now();
      if (to === 'CONFIRMED' && future && actor.type === 'STAFF' && appt.status === 'PENDING') {
        await enqueuePatient(client, updated, 'APPOINTMENT_CONFIRMED', settings);
      }
      if (to === 'CONFIRMED' && appt.status === 'CANCELLED' && future) {
        await enqueuePatient(client, updated, 'RESCHEDULED', settings);
        await scheduleReminders(client, updated, settings);
      }
      if (to === 'COMPLETED' && settings.post_visit_enabled) {
        const at = DateTime.max(DateTime.now(), DateTime.fromJSDate(updated.end_at).plus({ hours: settings.post_visit_delay_hours }));
        await enqueuePatient(client, updated, 'POST_VISIT', settings, at.toJSDate());
      }
      if (to === 'NO_SHOW') {
        await cancelPending(client, id, 'Paciente faltou');
        if (settings.no_show_message_enabled) await enqueuePatient(client, updated, 'NO_SHOW', settings);
      }
      if (appt.status === 'COMPLETED' && to !== 'COMPLETED') {
        await client.query(
          `UPDATE notifications SET status = 'CANCELLED', last_error = 'Status alterado', updated_at = now()
            WHERE appointment_id = $1 AND type = 'POST_VISIT' AND status IN ('PENDING', 'MANUAL')`,
          [id],
        );
      }
      return updated;
    });
  } catch (err) {
    if (isExclusionViolation(err)) throw conflict('O horário deste agendamento já foi ocupado por outro paciente.', 'SLOT_TAKEN');
    throw err;
  }
}

/** Paciente confirma presença pelo link recebido. */
export async function patientConfirm(id: string): Promise<AppointmentFull> {
  return withTransaction(async (client) => {
    const appt = await getAppointment(client, id, true);
    if (!appt) throw notFound('Agendamento não encontrado.');
    if (appt.status === 'CONFIRMED') return appt;
    if (appt.status !== 'PENDING') throw badRequest('Este agendamento não pode ser confirmado.');
    if (appt.start_at.getTime() < Date.now()) throw badRequest('O horário deste agendamento já passou.');
    await client.query(`UPDATE appointments SET status = 'CONFIRMED', confirmed_at = now(), updated_at = now() WHERE id = $1`, [id]);
    await addEvent(client, { appointmentId: id, actorType: 'PATIENT', action: 'PATIENT_CONFIRMED', fromStatus: 'PENDING', toStatus: 'CONFIRMED' });
    return (await getAppointment(client, id))!;
  });
}

export async function updateInternalNotes(db: Queryable, id: string, notes: string) {
  const { rowCount } = await db.query('UPDATE appointments SET internal_notes = $2, updated_at = now() WHERE id = $1', [id, notes]);
  if (!rowCount) throw notFound('Agendamento não encontrado.');
}
