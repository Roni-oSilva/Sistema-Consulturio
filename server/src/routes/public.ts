import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { config } from '../config.js';
import { getPool } from '../db/pool.js';
import { hashIp, normalizeCode, safeEqual, sha256, signAccessToken, verifySignedAccessToken } from '../lib/crypto.js';
import { badRequest, notFound, tooMany, unauthorized } from '../lib/errors.js';
import { buildIcs } from '../lib/ics.js';
import { fmtDate, fmtTime, longDate, weekdayName } from '../lib/time.js';
import {
  cleanText,
  emailSchema,
  isValidCpf,
  isoDate,
  maskPhone,
  normalizePhone,
  parse,
  phoneSchema,
  requiredText,
  text,
  uuid,
} from '../lib/validation.js';
import { audit } from '../services/audit.js';
import { enumerateDates, loadContext, slotsForDay } from '../services/availability.js';
import {
  cancelAppointment,
  createAppointment,
  patientCanChange,
  patientConfirm,
  rescheduleAppointment,
} from '../services/appointments.js';
import { getAppointment, professionalLabel, type AppointmentFull } from '../services/appointmentRepo.js';
import { cancellationPolicyText, getSettings } from '../services/settings.js';

const rl = (max: number, minutes: number) => ({ rateLimit: { max, timeWindow: minutes * 60_000 } });

async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  const secret = config().TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}

type ServiceCandidate = { id: string; duration: number };

async function professionalsForService(serviceId: string, professionalId: string | null): Promise<ServiceCandidate[]> {
  const { rows } = await getPool().query<ServiceCandidate>(
    `SELECT p.id, COALESCE(ps.duration_minutes, s.duration_minutes) AS duration
       FROM professionals p
       JOIN professional_services ps ON ps.professional_id = p.id
       JOIN services s ON s.id = ps.service_id AND s.active
      WHERE ps.service_id = $1 AND p.active AND ($2::uuid IS NULL OR p.id = $2::uuid)`,
    [serviceId, professionalId],
  );
  return rows;
}

/** Disponibilidade agregada: um horário aparece se ao menos um profissional estiver livre. */
async function availabilityRange(serviceId: string, professionalId: string | null, from: string, to: string) {
  const settings = await getSettings(getPool());
  const cands = await professionalsForService(serviceId, professionalId);
  const result = new Map<string, { time: string; start: string }[]>();
  if (!cands.length || from > to) return { settings, result };
  const ctx = await loadContext(getPool(), settings, cands.map((c) => c.id), from, to);
  for (const date of enumerateDates(from, to)) {
    const byStart = new Map<number, { time: string; start: string }>();
    for (const c of cands) {
      for (const s of slotsForDay(ctx, c.id, date, c.duration)) {
        const ms = s.start.toMillis();
        if (!byStart.has(ms)) byStart.set(ms, { time: s.start.toFormat('HH:mm'), start: s.start.toISO({ suppressMilliseconds: true })! });
      }
    }
    result.set(date, [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v));
  }
  return { settings, result };
}

/** Visão do agendamento para o paciente (sem dados internos). */
function publicView(a: AppointmentFull, settings: Awaited<ReturnType<typeof getSettings>>) {
  const tz = settings.timezone;
  const can = patientCanChange(a, settings);
  return {
    id: a.id,
    code: a.code,
    status: a.status,
    service: { id: a.service_id, name: a.service_name, preparation: a.service_preparation },
    professional: { id: a.professional_id, name: professionalLabel(a), specialty: a.professional_specialty },
    start: a.start_at.toISOString(),
    end: a.end_at.toISOString(),
    date: fmtDate(a.start_at, tz),
    dateLong: longDate(a.start_at, tz),
    weekday: weekdayName(a.start_at, tz),
    time: fmtTime(a.start_at, tz),
    patientName: a.patient_name,
    phoneMasked: maskPhone(a.contact_phone),
    canCancel: can.ok,
    canReschedule: can.ok && settings.allow_patient_reschedule,
    canConfirm: a.status === 'PENDING' && a.start_at.getTime() > Date.now(),
    changeBlockedReason: can.ok ? null : can.reason,
    cancellationPolicy: cancellationPolicyText(settings),
  };
}

function tokenFrom(req: FastifyRequest): string {
  const h = req.headers['x-access-token'];
  const q = (req.query as { t?: string } | undefined)?.t;
  const t = typeof h === 'string' ? h : q;
  if (!t || t.length > 300) throw unauthorized('Link inválido ou expirado.', 'INVALID_TOKEN');
  return t;
}

/** Proteção contra IDOR: o agendamento só é acessível com o token correto. */
async function authorizedAppointment(req: FastifyRequest, id: string): Promise<AppointmentFull> {
  parse(uuid, id);
  const token = tokenFrom(req);
  const appt = await getAppointment(getPool(), id);
  const valid =
    !!appt &&
    (token.startsWith('s.') ? verifySignedAccessToken(appt.id, token) : safeEqual(sha256(token), appt.access_token_hash));
  if (!appt || !valid) {
    await audit(req, { action: 'APPOINTMENT_ACCESS_DENIED', resourceType: 'appointment', resourceId: id, result: 'DENIED' });
    throw notFound('Agendamento não encontrado ou link expirado.');
  }
  return appt;
}

export async function publicRoutes(app: FastifyInstance) {
  // ----------------------------------------------------------- dados da clínica
  app.get('/public/clinic', { config: rl(120, 1) }, async () => {
    const s = await getSettings(getPool());
    return {
      name: s.name,
      shortName: s.short_name,
      tagline: s.tagline,
      description: s.description,
      logoUrl: s.logo_url,
      phone: s.phone,
      whatsapp: s.whatsapp,
      email: s.email,
      address: s.address,
      mapsUrl: s.maps_url,
      instagram: s.instagram,
      openingHours: s.opening_hours,
      bookingNotice: s.booking_notice,
      cancellationPolicy: cancellationPolicyText(s),
      privacyPolicy: s.privacy_policy,
      privacyPolicyVersion: s.privacy_policy_version,
      requireCpf: s.require_cpf,
      requireBirthDate: s.require_birth_date,
      requireEmail: s.require_email,
      maxAdvanceDays: s.max_advance_days,
      timezone: s.timezone,
      turnstileSiteKey: config().TURNSTILE_SITE_KEY || null,
    };
  });

  // ----------------------------------------------------------- serviços
  app.get('/services', { config: rl(120, 1) }, async () => {
    const { rows } = await getPool().query(
      `SELECT s.id, s.name, s.slug, s.category, s.description, s.preparation, s.duration_minutes AS "durationMinutes",
              s.allow_choose_professional AS "allowChooseProfessional", s.icon,
              CASE WHEN s.show_price THEN s.price_cents END AS "priceCents",
              (SELECT count(*)::int FROM professional_services ps JOIN professionals p ON p.id = ps.professional_id AND p.active
                WHERE ps.service_id = s.id) AS "professionalCount"
         FROM services s WHERE s.active ORDER BY s.sort_order, s.name`,
    );
    return rows;
  });

  // ----------------------------------------------------------- profissionais
  app.get('/professionals', { config: rl(120, 1) }, async (req) => {
    const q = parse(z.object({ serviceId: uuid.optional() }), req.query);
    const { rows } = await getPool().query(
      `SELECT p.id, p.name, p.title, p.specialty, CASE WHEN p.show_registry THEN p.registry ELSE '' END AS registry,
              p.bio, p.photo_url AS "photoUrl", p.color,
              COALESCE((SELECT array_agg(DISTINCT sc.weekday ORDER BY sc.weekday) FROM schedules sc WHERE sc.professional_id = p.id), '{}') AS weekdays,
              COALESCE((SELECT array_agg(ps.service_id) FROM professional_services ps JOIN services s ON s.id = ps.service_id AND s.active
                         WHERE ps.professional_id = p.id), '{}') AS "serviceIds"
         FROM professionals p
        WHERE p.active AND ($1::uuid IS NULL OR EXISTS (
              SELECT 1 FROM professional_services ps WHERE ps.professional_id = p.id AND ps.service_id = $1::uuid))
        ORDER BY p.sort_order, p.name`,
      [q.serviceId ?? null],
    );
    return rows;
  });

  // ----------------------------------------------------------- disponibilidade
  app.get('/availability/dates', { config: rl(90, 1) }, async (req) => {
    const q = parse(
      z.object({ serviceId: uuid, professionalId: uuid.optional(), month: z.string().regex(/^\d{4}-\d{2}$/, 'Mês inválido.') }),
      req.query,
    );
    const settings = await getSettings(getPool());
    const tz = settings.timezone;
    const today = DateTime.now().setZone(tz).startOf('day');
    const monthStart = DateTime.fromISO(`${q.month}-01`, { zone: tz });
    if (!monthStart.isValid) throw badRequest('Mês inválido.');
    const from = DateTime.max(monthStart, today).toISODate()!;
    const to = DateTime.min(monthStart.endOf('month'), today.plus({ days: settings.max_advance_days })).toISODate()!;
    const { result } = await availabilityRange(q.serviceId, q.professionalId ?? null, from, to);
    return {
      month: q.month,
      today: today.toISODate(),
      maxDate: today.plus({ days: settings.max_advance_days }).toISODate(),
      dates: [...result.entries()].filter(([, slots]) => slots.length > 0).map(([date, slots]) => ({ date, count: slots.length })),
    };
  });

  app.get('/availability', { config: rl(120, 1) }, async (req) => {
    const q = parse(z.object({ serviceId: uuid, professionalId: uuid.optional(), date: isoDate }), req.query);
    const { result, settings } = await availabilityRange(q.serviceId, q.professionalId ?? null, q.date, q.date);
    return {
      date: q.date,
      dateLong: longDate(DateTime.fromISO(q.date, { zone: settings.timezone }).toJSDate(), settings.timezone),
      slots: result.get(q.date) ?? [],
    };
  });

  // ----------------------------------------------------------- criar agendamento
  const createSchema = z.object({
    serviceId: uuid,
    professionalId: uuid.nullish(),
    start: z.string().max(40),
    name: requiredText(3, 120, 'Informe o nome completo.').refine((v) => v.includes(' '), 'Informe nome e sobrenome.'),
    phone: phoneSchema,
    email: z.union([z.literal(''), emailSchema]).nullish(),
    cpf: z.string().max(20).nullish(),
    birthDate: z.union([z.literal(''), isoDate]).nullish(),
    notes: text(500).optional(),
    consent: z.literal(true, { error: 'É necessário aceitar a política de privacidade.' }),
    website: z.string().max(200).optional(), // honeypot (campo invisível para robôs)
    turnstileToken: z.string().max(4096).optional(),
  });

  app.post('/appointments', { config: rl(8, 10) }, async (req, reply) => {
    const body = parse(createSchema, req.body);
    const ipHash = hashIp(req.ip);
    const db = getPool();
    const settings = await getSettings(db);

    if (body.website) {
      await audit(req, { action: 'BOOKING_BOT_DETECTED', resourceType: 'appointment', result: 'DENIED', details: { reason: 'honeypot' } });
      throw badRequest('Não foi possível concluir o agendamento.');
    }
    if (!(await verifyTurnstile(body.turnstileToken, req.ip))) {
      throw badRequest('Confirme que você não é um robô e tente novamente.', 'CAPTCHA_FAILED');
    }
    // detecção de comportamento suspeito: muitos agendamentos do mesmo IP
    const { rows: ipCount } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM appointments WHERE ip_hash = $1 AND created_at > now() - interval '24 hours'`,
      [ipHash],
    );
    if (ipCount[0].n >= settings.max_bookings_per_ip_day) {
      await audit(req, { action: 'BOOKING_IP_LIMIT', resourceType: 'appointment', result: 'DENIED', details: { count: ipCount[0].n } });
      throw tooMany('Limite de agendamentos atingido. Para marcar mais, entre em contato com a clínica.');
    }

    let cpf: string | null = null;
    if (body.cpf && body.cpf.trim()) {
      if (!isValidCpf(body.cpf)) throw badRequest('CPF inválido.', 'VALIDATION_ERROR', { fields: { cpf: 'CPF inválido.' } });
      cpf = body.cpf.replace(/\D/g, '');
    } else if (settings.require_cpf) {
      throw badRequest('Informe o CPF.', 'VALIDATION_ERROR', { fields: { cpf: 'Informe o CPF.' } });
    }
    if (settings.require_email && !body.email) {
      throw badRequest('Informe o e-mail.', 'VALIDATION_ERROR', { fields: { email: 'Informe o e-mail.' } });
    }
    let birthDate: string | null = null;
    if (body.birthDate) {
      const bd = DateTime.fromISO(body.birthDate);
      if (!bd.isValid || bd > DateTime.now() || bd.year < 1900) {
        throw badRequest('Data de nascimento inválida.', 'VALIDATION_ERROR', { fields: { birthDate: 'Data de nascimento inválida.' } });
      }
      birthDate = body.birthDate;
    } else if (settings.require_birth_date) {
      throw badRequest('Informe a data de nascimento.', 'VALIDATION_ERROR', { fields: { birthDate: 'Informe a data de nascimento.' } });
    }

    const { appointment, accessToken } = await createAppointment({
      serviceId: body.serviceId,
      professionalId: body.professionalId ?? null,
      start: body.start,
      patient: { name: body.name, phone: body.phone, email: body.email || null, cpf, birthDate },
      notes: body.notes ?? '',
      consent: true,
      source: 'ONLINE',
      ipHash,
      actor: { type: 'PATIENT' },
    });
    reply.code(201);
    return { appointment: publicView(appointment, settings), accessToken };
  });

  // ----------------------------------------------------------- consultar (telefone/e-mail + código)
  app.post('/appointments/lookup', { config: rl(10, 15) }, async (req) => {
    const body = parse(
      z.object({ code: z.string().min(4).max(20), contact: z.string().min(5).max(254) }),
      req.body,
    );
    const code = normalizeCode(body.code);
    const contact = cleanText(body.contact);
    const phone = contact.includes('@') ? null : normalizePhone(contact);
    const email = contact.includes('@') ? contact.toLowerCase() : null;
    const { rows } = await getPool().query<{ id: string }>(
      `SELECT id FROM appointments WHERE code = $1 AND (($2::text IS NOT NULL AND contact_phone = $2) OR ($3::text IS NOT NULL AND lower(contact_email) = $3))`,
      [code, phone, email],
    );
    if (!rows[0]) {
      // mesma resposta para código ou contato errado (evita enumeração)
      await audit(req, { action: 'APPOINTMENT_LOOKUP_FAILED', resourceType: 'appointment', result: 'FAILURE' });
      throw notFound('Não encontramos um agendamento com esses dados. Confira o código e o telefone/e-mail.');
    }
    return { id: rows[0].id, accessToken: signAccessToken(rows[0].id) };
  });

  // ----------------------------------------------------------- ver / confirmar / cancelar / remarcar
  app.get('/appointments/:id', { config: rl(60, 1) }, async (req) => {
    const { id } = req.params as { id: string };
    const appt = await authorizedAppointment(req, id);
    const settings = await getSettings(getPool());
    return {
      appointment: publicView(appt, settings),
      clinic: { name: settings.name, address: settings.address, mapsUrl: settings.maps_url, phone: settings.phone, whatsapp: settings.whatsapp },
    };
  });

  app.post('/appointments/:id/confirm', { config: rl(20, 15) }, async (req) => {
    const { id } = req.params as { id: string };
    await authorizedAppointment(req, id);
    const updated = await patientConfirm(id);
    return { appointment: publicView(updated, await getSettings(getPool())) };
  });

  app.post('/appointments/:id/cancel', { config: rl(20, 15) }, async (req) => {
    const { id } = req.params as { id: string };
    await authorizedAppointment(req, id);
    const body = parse(z.object({ reason: text(300).optional() }), req.body ?? {});
    const updated = await cancelAppointment(id, { type: 'PATIENT' }, body.reason || 'Cancelado pelo paciente', { enforcePolicy: true });
    await audit(req, { action: 'APPOINTMENT_CANCELLED_BY_PATIENT', resourceType: 'appointment', resourceId: id, userLabel: 'Paciente' });
    return { appointment: publicView(updated, await getSettings(getPool())) };
  });

  app.post('/appointments/:id/reschedule', { config: rl(15, 15) }, async (req) => {
    const { id } = req.params as { id: string };
    await authorizedAppointment(req, id);
    const body = parse(z.object({ start: z.string().max(40) }), req.body);
    const updated = await rescheduleAppointment({ id, start: body.start, actor: { type: 'PATIENT' }, enforcePolicy: true });
    await audit(req, { action: 'APPOINTMENT_RESCHEDULED_BY_PATIENT', resourceType: 'appointment', resourceId: id, userLabel: 'Paciente' });
    return { appointment: publicView(updated, await getSettings(getPool())) };
  });

  app.get('/appointments/:id/calendar.ics', { config: rl(30, 1) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const appt = await authorizedAppointment(req, id);
    const settings = await getSettings(getPool());
    const ics = buildIcs({
      uid: `${appt.id}@jrsaude`,
      start: appt.start_at,
      end: appt.end_at,
      summary: `${appt.service_name} — ${settings.short_name || settings.name}`,
      description: `Profissional: ${professionalLabel(appt)}\nCódigo: ${appt.code}${appt.service_preparation ? `\nPreparo: ${appt.service_preparation}` : ''}`,
      location: settings.address,
    });
    reply
      .header('content-type', 'text/calendar; charset=utf-8')
      .header('content-disposition', `attachment; filename="agendamento-${appt.code}.ics"`)
      .header('cache-control', 'no-store');
    return ics;
  });
}
