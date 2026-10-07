import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { getPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { seedBase } from '../src/db/seed.js';
import { invalidateSettings } from '../src/services/settings.js';

export const TZ = 'America/Belem';
export const ADMIN = { email: 'admin@test.com', password: 'Senha-Forte-123' };

export async function setupApp(): Promise<FastifyInstance> {
  const pool = getPool();
  await migrate(pool, () => {});
  await seedBase(pool, { adminEmail: ADMIN.email, adminPassword: ADMIN.password, log: () => {} });
  // feriados são testados explicitamente; removemos para datas previsíveis
  await pool.query('DELETE FROM holidays');
  await pool.query(
    `UPDATE clinic_settings SET min_advance_minutes = 0, max_advance_days = 60, cancel_min_hours = 2,
            max_active_per_phone = 3, max_bookings_per_ip_day = 1000, initial_status = 'PENDING', allow_patient_reschedule = true,
            reminder1_hours = 24, reminder2_hours = 2, whatsapp_enabled = true, email_enabled = true, clinic_notify_enabled = false`,
  );
  invalidateSettings();
  const app = await buildApp({ logger: false });
  await app.ready();
  return app;
}

let ipCounter = 1;
/** IP único por chamada, para que o rate limit de um teste não afete outro. */
export function freshIp() {
  ipCounter++;
  return `10.${Math.floor(ipCounter / 65000) % 250}.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;
}

let phoneCounter = 10_000_000;
export function freshPhone() {
  phoneCounter++;
  return `(91) 9${String(phoneCounter).slice(-8, -4)}-${String(phoneCounter).slice(-4)}`;
}

export type Fixture = { serviceId: string; professionalId: string; professional2Id: string };

/** Serviço de 30 min + 2 profissionais atendendo todos os dias 08–12 e 14–18. */
export async function createFixture(label: string, opts: { allowChoose?: boolean } = {}): Promise<Fixture> {
  const db = getPool();
  const slug = `teste-${label}-${Date.now().toString(36)}`;
  const { rows: s } = await db.query<{ id: string }>(
    `INSERT INTO services (name, slug, category, duration_minutes, allow_choose_professional) VALUES ($1, $2, 'CONSULTA', 30, $3) RETURNING id`,
    [`Serviço ${label}`, slug, opts.allowChoose ?? true],
  );
  const ids: string[] = [];
  for (const n of [1, 2]) {
    const { rows: p } = await db.query<{ id: string }>(`INSERT INTO professionals (name, title) VALUES ($1, 'Dr.') RETURNING id`, [
      `Prof ${label} ${n}`,
    ]);
    ids.push(p[0].id);
    await db.query('INSERT INTO professional_services (professional_id, service_id) VALUES ($1, $2)', [p[0].id, s[0].id]);
    for (let wd = 1; wd <= 7; wd++) {
      await db.query(`INSERT INTO schedules (professional_id, weekday, start_time, end_time) VALUES ($1, $2, '08:00', '12:00'), ($1, $2, '14:00', '18:00')`, [
        p[0].id,
        wd,
      ]);
    }
  }
  return { serviceId: s[0].id, professionalId: ids[0], professional2Id: ids[1] };
}

/** Data local (fuso da clínica) N dias à frente. */
export function futureDate(days: number) {
  return DateTime.now().setZone(TZ).plus({ days }).toISODate()!;
}

export function slotIso(date: string, time: string) {
  return DateTime.fromISO(`${date}T${time}`, { zone: TZ }).toISO({ suppressMilliseconds: true })!;
}

export function bookingBody(f: Fixture, date: string, time: string, extra: Record<string, unknown> = {}) {
  return {
    serviceId: f.serviceId,
    professionalId: f.professionalId,
    start: slotIso(date, time),
    name: 'Maria Teste da Silva',
    phone: freshPhone(),
    email: 'maria@example.com',
    notes: '',
    consent: true,
    ...extra,
  };
}

export async function book(app: FastifyInstance, body: Record<string, unknown>, ip = freshIp()) {
  return app.inject({ method: 'POST', url: '/api/appointments', payload: body, remoteAddress: ip });
}

export type Session = { cookie: string; csrf: string };

export async function login(app: FastifyInstance, email = ADMIN.email, password = ADMIN.password, ip = freshIp()): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { email, password }, remoteAddress: ip });
  if (res.statusCode !== 200) throw new Error(`login falhou: ${res.statusCode} ${res.body}`);
  const c = res.cookies.find((x) => x.name.endsWith('jrs_sid'))!;
  return { cookie: `${c.name}=${c.value}`, csrf: res.json().csrfToken };
}

export async function createUser(role: string, professionalId: string | null = null) {
  const email = `${role.toLowerCase()}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@test.com`;
  const password = 'Senha-Teste-456';
  await getPool().query(
    `INSERT INTO users (name, email, password_hash, role, professional_id) VALUES ($1, $2, $3, $4, $5)`,
    [`Usuário ${role}`, email, await hashPassword(password), role, professionalId],
  );
  return { email, password };
}

export function adminReq(s: Session, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  return {
    method,
    url,
    payload: payload as Record<string, unknown> | undefined,
    headers: { cookie: s.cookie, 'x-csrf-token': s.csrf },
    remoteAddress: freshIp(),
  };
}
