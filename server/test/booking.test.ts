import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../src/db/pool.js';
import { invalidateSettings } from '../src/services/settings.js';
import { processDueNotifications } from '../src/services/notifications/worker.js';
import {
  adminReq,
  book,
  bookingBody,
  createFixture,
  freshIp,
  freshPhone,
  futureDate,
  login,
  setupApp,
  slotIso,
  type Fixture,
} from './helpers.js';

let app: FastifyInstance;
let f: Fixture;

beforeAll(async () => {
  app = await setupApp();
  f = await createFixture('booking');
});

afterAll(async () => {
  await app.close();
  await closePool();
});

async function slots(date: string, professionalId: string | null = f.professionalId) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/availability?serviceId=${f.serviceId}&date=${date}${professionalId ? `&professionalId=${professionalId}` : ''}`,
    remoteAddress: freshIp(),
  });
  expect(res.statusCode).toBe(200);
  return (res.json().slots as { time: string }[]).map((s) => s.time);
}

describe('1. Agendamento normal', () => {
  it('lista horários, agenda e enfileira mensagens automáticas', async () => {
    const date = futureDate(3);
    const free = await slots(date);
    expect(free).toContain('09:00');
    expect(free).not.toContain('12:00'); // intervalo de almoço
    expect(free[0]).toBe('08:00');

    const res = await book(app, bookingBody(f, date, '09:00'));
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.appointment.code).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    expect(body.appointment.status).toBe('PENDING');
    expect(body.appointment.time).toBe('09:00');
    expect(body.appointment.phoneMasked).toMatch(/\*\*\*\*/);
    expect(body.accessToken).toBeTruthy();

    // dados pessoais completos nunca voltam na resposta pública
    expect(JSON.stringify(body)).not.toContain('maria@example.com');

    const { rows } = await getPool().query('SELECT type, channel, status FROM notifications WHERE appointment_id = $1 ORDER BY type, channel', [
      body.appointment.id,
    ]);
    const kinds = rows.map((r) => `${r.type}/${r.channel}`);
    expect(kinds).toEqual(
      expect.arrayContaining(['BOOKING_CREATED/WHATSAPP', 'BOOKING_CREATED/EMAIL', 'REMINDER/WHATSAPP', 'REMINDER_SHORT/WHATSAPP']),
    );

    // horário some da disponibilidade
    expect(await slots(date)).not.toContain('09:00');

    // paciente consegue ver pelo link seguro
    const view = await app.inject({
      method: 'GET',
      url: `/api/appointments/${body.appointment.id}`,
      headers: { 'x-access-token': body.accessToken },
    });
    expect(view.statusCode).toBe(200);
    expect(view.json().appointment.code).toBe(body.appointment.code);

    // .ics para adicionar ao calendário
    const ics = await app.inject({ method: 'GET', url: `/api/appointments/${body.appointment.id}/calendar.ics?t=${body.accessToken}` });
    expect(ics.statusCode).toBe(200);
    expect(ics.body).toContain('BEGIN:VEVENT');
  });

  it('serviço sem escolha de profissional: o sistema escolhe e distribui', async () => {
    const g = await createFixture('auto', { allowChoose: false });
    const date = futureDate(4);
    const a = await book(app, { ...bookingBody(g, date, '10:00'), professionalId: null });
    const b = await book(app, { ...bookingBody(g, date, '10:00'), professionalId: null });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(a.json().appointment.professional.id).not.toBe(b.json().appointment.professional.id);
    const c = await book(app, { ...bookingBody(g, date, '10:00'), professionalId: null });
    expect(c.statusCode).toBe(409); // os dois estão ocupados
  });

  it('mensagens: sem API de WhatsApp ficam na fila manual; e-mail é enviado', async () => {
    const date = futureDate(5);
    const res = await book(app, bookingBody(f, date, '15:00'));
    const id = res.json().appointment.id;
    await processDueNotifications(100);
    const { rows } = await getPool().query(
      `SELECT channel, status, body FROM notifications WHERE appointment_id = $1 AND type = 'BOOKING_CREATED' ORDER BY channel`,
      [id],
    );
    const wa = rows.find((r) => r.channel === 'WHATSAPP');
    const em = rows.find((r) => r.channel === 'EMAIL');
    expect(wa.status).toBe('MANUAL');
    expect(wa.body).toContain('Maria');
    expect(wa.body).toContain('/agendamento/');
    expect(em.status).toBe('SENT');
  });
});

describe('2. Horário ocupado', () => {
  it('recusa o mesmo horário com mensagem clara', async () => {
    const date = futureDate(6);
    expect((await book(app, bookingBody(f, date, '10:30'))).statusCode).toBe(201);
    const dup = await book(app, bookingBody(f, date, '10:30'));
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('Esse horário acabou de ser reservado. Escolha outro horário.');
  });

  it('nunca confia no horário enviado pelo navegador (fora da grade / passado / fora do expediente)', async () => {
    const date = futureDate(6);
    expect((await book(app, bookingBody(f, date, '10:07'))).statusCode).toBe(409); // não alinhado à grade
    expect((await book(app, bookingBody(f, date, '12:30'))).statusCode).toBe(409); // almoço
    expect((await book(app, bookingBody(f, date, '19:00'))).statusCode).toBe(409); // após expediente
    const past = await book(app, bookingBody(f, futureDate(-1), '10:00'));
    expect(past.statusCode).toBe(400);
    const far = await book(app, bookingBody(f, futureDate(90), '10:00'));
    expect(far.statusCode).toBe(400);
  });

  it('a constraint do banco impede sobreposição mesmo por SQL direto', async () => {
    const date = futureDate(6);
    const { rows } = await getPool().query(`SELECT * FROM appointments WHERE professional_id = $1 AND status <> 'CANCELLED' LIMIT 1`, [
      f.professionalId,
    ]);
    const a = rows[0];
    await expect(
      getPool().query(
        `INSERT INTO appointments (code, access_token_hash, service_id, professional_id, patient_id, patient_name, contact_phone, start_at, end_at)
         VALUES ('ZZZZ-ZZZZ', 'x', $1, $2, $3, 'X', '0', $4, $5)`,
        [a.service_id, a.professional_id, a.patient_id, a.start_at, a.end_at],
      ),
    ).rejects.toMatchObject({ code: '23P01' });
    void date;
  });
});

describe('3. Dois usuários reservando simultaneamente', () => {
  it('somente um consegue; os outros recebem 409', async () => {
    const date = futureDate(7);
    const attempts = await Promise.all(Array.from({ length: 12 }, () => book(app, bookingBody(f, date, '16:00'))));
    const codes = attempts.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(11);
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS n FROM appointments WHERE professional_id = $1 AND start_at = $2 AND status <> 'CANCELLED'`,
      [f.professionalId, slotIso(date, '16:00')],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe('4. Cancelamento', () => {
  it('paciente cancela pelo link, horário é liberado e histórico é mantido', async () => {
    const date = futureDate(8);
    const res = await book(app, bookingBody(f, date, '11:00'));
    const { appointment, accessToken } = res.json();
    expect(await slots(date)).not.toContain('11:00');

    const c = await app.inject({
      method: 'POST',
      url: `/api/appointments/${appointment.id}/cancel`,
      headers: { 'x-access-token': accessToken },
      payload: { reason: 'Imprevisto' },
    });
    expect(c.statusCode).toBe(200);
    expect(c.json().appointment.status).toBe('CANCELLED');
    expect(await slots(date)).toContain('11:00');

    const { rows } = await getPool().query('SELECT status FROM appointments WHERE id = $1', [appointment.id]);
    expect(rows[0].status).toBe('CANCELLED'); // não é apagado
    const ev = await getPool().query('SELECT action FROM appointment_events WHERE appointment_id = $1 ORDER BY at', [appointment.id]);
    expect(ev.rows.map((r) => r.action)).toEqual(['CREATED', 'CANCELLED']);
    const n = await getPool().query(
      `SELECT type, status FROM notifications WHERE appointment_id = $1 AND type IN ('REMINDER', 'CANCELLED')`,
      [appointment.id],
    );
    expect(n.rows.filter((r) => r.type === 'REMINDER').every((r) => r.status === 'CANCELLED')).toBe(true);
    expect(n.rows.some((r) => r.type === 'CANCELLED' && r.status === 'PENDING')).toBe(true);

    // pode reagendar o mesmo horário depois
    expect((await book(app, bookingBody(f, date, '11:00'))).statusCode).toBe(201);
  });

  it('respeita a regra de antecedência configurada pela clínica', async () => {
    await getPool().query('UPDATE clinic_settings SET cancel_min_hours = 1000');
    invalidateSettings();
    const res = await book(app, bookingBody(f, futureDate(9), '08:30'));
    const { appointment, accessToken } = res.json();
    expect(appointment.canCancel).toBe(false);
    const c = await app.inject({
      method: 'POST',
      url: `/api/appointments/${appointment.id}/cancel`,
      headers: { 'x-access-token': accessToken },
      payload: {},
    });
    expect(c.statusCode).toBe(403);
    await getPool().query('UPDATE clinic_settings SET cancel_min_hours = 2');
    invalidateSettings();
  });

  it('consulta por telefone + código e não acessa agendamento de outro paciente (IDOR)', async () => {
    const date = futureDate(10);
    const phone = freshPhone();
    const a = (await book(app, bookingBody(f, date, '08:00', { phone }))).json();
    const b = (await book(app, bookingBody(f, date, '08:30'))).json();

    const ok = await app.inject({
      method: 'POST',
      url: '/api/appointments/lookup',
      payload: { code: a.appointment.code.toLowerCase().replace('-', ''), contact: phone },
      remoteAddress: freshIp(),
    });
    expect(ok.statusCode).toBe(200);
    const token = ok.json().accessToken;

    // token de A não abre B
    const idor = await app.inject({ method: 'GET', url: `/api/appointments/${b.appointment.id}`, headers: { 'x-access-token': token } });
    expect(idor.statusCode).toBe(404);
    const idor2 = await app.inject({
      method: 'POST',
      url: `/api/appointments/${b.appointment.id}/cancel`,
      headers: { 'x-access-token': a.accessToken },
      payload: {},
    });
    expect(idor2.statusCode).toBe(404);
    const noToken = await app.inject({ method: 'GET', url: `/api/appointments/${a.appointment.id}` });
    expect(noToken.statusCode).toBe(401);

    // código certo + telefone errado = mesma resposta de "não encontrado"
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/appointments/lookup',
      payload: { code: a.appointment.code, contact: '(91) 90000-0000' },
      remoteAddress: freshIp(),
    });
    expect(wrong.statusCode).toBe(404);
  });

  it('paciente confirma presença e remarca pelo link', async () => {
    const date = futureDate(11);
    const { appointment, accessToken } = (await book(app, bookingBody(f, date, '09:30'))).json();
    const conf = await app.inject({
      method: 'POST',
      url: `/api/appointments/${appointment.id}/confirm`,
      headers: { 'x-access-token': accessToken },
    });
    expect(conf.json().appointment.status).toBe('CONFIRMED');
    const re = await app.inject({
      method: 'POST',
      url: `/api/appointments/${appointment.id}/reschedule`,
      headers: { 'x-access-token': accessToken },
      payload: { start: slotIso(date, '10:00') },
    });
    expect(re.statusCode).toBe(200);
    expect(re.json().appointment.time).toBe('10:00');
    expect(await slots(date)).toContain('09:30');
    expect(await slots(date)).not.toContain('10:00');
  });
});

describe('5. Bloqueio de horário e feriados', () => {
  it('bloqueio some da agenda do paciente e impede reserva', async () => {
    const s = await login(app);
    const date = futureDate(12);
    expect(await slots(date)).toContain('14:30');
    const res = await app.inject(
      adminReq(s, 'POST', '/api/admin/block-times', {
        professionalId: f.professionalId,
        startDate: date,
        endDate: date,
        startTime: '14:00',
        endTime: '16:00',
        reasonType: 'MEETING',
        description: 'Reunião',
      }),
    );
    expect(res.statusCode).toBe(201);
    const after = await slots(date);
    for (const t of ['14:00', '14:30', '15:00', '15:30']) expect(after).not.toContain(t);
    expect(after).toContain('16:00');
    expect((await book(app, bookingBody(f, date, '14:30'))).statusCode).toBe(409);
    // o outro profissional não é afetado
    expect(await slots(date, f.professional2Id)).toContain('14:30');
  });

  it('bloqueio da clínica inteira e feriado bloqueiam o dia', async () => {
    const s = await login(app);
    const date = futureDate(13);
    await app.inject(
      adminReq(s, 'POST', '/api/admin/block-times', {
        professionalId: null, startDate: date, endDate: date, allDay: true, reasonType: 'MAINTENANCE',
      }),
    );
    expect(await slots(date)).toHaveLength(0);
    expect(await slots(date, f.professional2Id)).toHaveLength(0);

    const hol = futureDate(14);
    const h = await app.inject(adminReq(s, 'POST', '/api/admin/holidays', { date: hol, name: 'Feriado municipal', recurring: false }));
    expect(h.statusCode).toBe(201);
    expect(await slots(hol)).toHaveLength(0);
    const month = hol.slice(0, 7);
    const dates = await app.inject({ method: 'GET', url: `/api/availability/dates?serviceId=${f.serviceId}&month=${month}`, remoteAddress: freshIp() });
    expect(dates.json().dates.map((d: { date: string }) => d.date)).not.toContain(hol);
  });

  it('bloquear e cancelar automaticamente os pacientes afetados', async () => {
    const s = await login(app);
    const date = futureDate(15);
    const a = (await book(app, bookingBody(f, date, '08:00'))).json();
    const prev = await app.inject(
      adminReq(s, 'POST', '/api/admin/block-times/preview', {
        professionalId: f.professionalId, startDate: date, endDate: date, allDay: true, reasonType: 'DAY_OFF',
      }),
    );
    expect(prev.json().affected).toHaveLength(1);
    const res = await app.inject(
      adminReq(s, 'POST', '/api/admin/block-times', {
        professionalId: f.professionalId, startDate: date, endDate: date, allDay: true, reasonType: 'DAY_OFF', cancelAppointments: true,
      }),
    );
    expect(res.json().cancelled).toBe(1);
    const { rows } = await getPool().query('SELECT status FROM appointments WHERE id = $1', [a.appointment.id]);
    expect(rows[0].status).toBe('CANCELLED');
  });
});

describe('6. Alteração de agenda', () => {
  it('remover um dia da grade remove a disponibilidade; horário especial adiciona', async () => {
    const s = await login(app);
    const date = futureDate(16);
    const { DateTime } = await import('luxon');
    const weekday = DateTime.fromISO(date).weekday;
    const schedules = [];
    for (let wd = 1; wd <= 7; wd++) if (wd !== weekday) schedules.push({ weekday: wd, start: '08:00', end: '12:00' });
    const res = await app.inject(adminReq(s, 'PUT', `/api/admin/professionals/${f.professional2Id}/schedule`, { schedules }));
    expect(res.statusCode).toBe(200);
    expect(await slots(date, f.professional2Id)).toHaveLength(0);

    const o = await app.inject(
      adminReq(s, 'POST', `/api/admin/professionals/${f.professional2Id}/overrides`, { date, start: '18:00', end: '20:00', note: 'Plantão' }),
    );
    expect(o.statusCode).toBe(201);
    expect(await slots(date, f.professional2Id)).toEqual(['18:00', '18:30', '19:00', '19:30']);

    // horários sobrepostos são recusados
    const bad = await app.inject(
      adminReq(s, 'PUT', `/api/admin/professionals/${f.professional2Id}/schedule`, {
        schedules: [{ weekday: 1, start: '08:00', end: '12:00' }, { weekday: 1, start: '11:00', end: '13:00' }],
      }),
    );
    expect(bad.statusCode).toBe(400);
  });

  it('recepção remarca e o paciente é avisado', async () => {
    const s = await login(app);
    const date = futureDate(17);
    const a = (await book(app, bookingBody(f, date, '09:00'))).json();
    const res = await app.inject(adminReq(s, 'POST', `/api/admin/appointments/${a.appointment.id}/reschedule`, { date, time: '10:30' }));
    expect(res.statusCode).toBe(200);
    expect(res.json().appointment.time).toBe('10:30');
    const n = await getPool().query(`SELECT 1 FROM notifications WHERE appointment_id = $1 AND type = 'RESCHEDULED'`, [a.appointment.id]);
    expect(n.rowCount).toBeGreaterThan(0);
  });
});

describe('10. Validação dos dados', () => {
  it('recusa dados inválidos com mensagens claras', async () => {
    const date = futureDate(18);
    const cases: [Record<string, unknown>, string][] = [
      [{ phone: '123' }, 'phone'],
      [{ name: 'Jo' }, 'name'],
      [{ name: 'Maria' }, 'name'], // sem sobrenome
      [{ consent: false }, 'consent'],
      [{ email: 'nao-e-email' }, 'email'],
      [{ serviceId: 'abc' }, 'serviceId'],
    ];
    for (const [patch, field] of cases) {
      const r = await book(app, bookingBody(f, date, '08:00', patch));
      expect(r.statusCode, JSON.stringify(patch)).toBe(400);
      expect(r.json().details.fields[field], JSON.stringify(r.json())).toBeTruthy();
    }
    const cpf = await book(app, bookingBody(f, date, '08:00', { cpf: '111.111.111-11' }));
    expect(cpf.statusCode).toBe(400);
    const okCpf = await book(app, bookingBody(f, date, '08:00', { cpf: '529.982.247-25' }));
    expect(okCpf.statusCode).toBe(201);
  });

  it('ignora campos extras (mass assignment) e o honeypot barra robôs', async () => {
    const date = futureDate(18);
    const r = await book(app, bookingBody(f, date, '08:30', { status: 'COMPLETED', source: 'ADMIN', internal_notes: 'x' }));
    expect(r.statusCode).toBe(201);
    expect(r.json().appointment.status).toBe('PENDING');
    const bot = await book(app, bookingBody(f, date, '09:00', { website: 'http://spam' }));
    expect(bot.statusCode).toBe(400);
  });

  it('texto com HTML é tratado como texto (XSS) e SQL injection não tem efeito', async () => {
    const date = futureDate(18);
    const r = await book(app, bookingBody(f, date, '09:30', { name: "Robert'); DROP TABLE appointments;-- Silva", notes: '<script>alert(1)</script>' }));
    expect(r.statusCode).toBe(201);
    const { rows } = await getPool().query('SELECT count(*)::int AS n FROM appointments');
    expect(rows[0].n).toBeGreaterThan(0);
  });
});

describe('11. Limites contra abuso', () => {
  it('limite de agendamentos futuros por telefone', async () => {
    const phone = freshPhone();
    const date = futureDate(19);
    for (const t of ['08:00', '08:30', '09:00']) expect((await book(app, bookingBody(f, date, t, { phone }))).statusCode).toBe(201);
    const fourth = await book(app, bookingBody(f, date, '09:30', { phone }));
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json().code).toBe('PATIENT_LIMIT');
  });

  it('mesmo telefone não pode ter dois horários sobrepostos', async () => {
    const phone = freshPhone();
    const date = futureDate(20);
    expect((await book(app, bookingBody(f, date, '10:00', { phone }))).statusCode).toBe(201);
    const other = await book(app, { ...bookingBody(f, date, '10:00', { phone }), professionalId: f.professional2Id });
    expect(other.statusCode).toBe(409);
  });

  it('rate limit por IP na criação e na consulta de agendamentos', async () => {
    const ip = freshIp();
    const date = futureDate(21);
    const results = [];
    for (let i = 0; i < 10; i++) results.push((await book(app, bookingBody(f, date, '17:30'), ip)).statusCode);
    expect(results).toContain(429);

    const ip2 = freshIp();
    const lookups = [];
    for (let i = 0; i < 12; i++) {
      lookups.push(
        (await app.inject({ method: 'POST', url: '/api/appointments/lookup', payload: { code: 'AAAA-BBBB', contact: '(91) 99999-0000' }, remoteAddress: ip2 }))
          .statusCode,
      );
    }
    expect(lookups.slice(0, 10).every((c) => c === 404)).toBe(true);
    expect(lookups[11]).toBe(429);
  });

  it('limite diário por IP (comportamento suspeito) é registrado na auditoria', async () => {
    await getPool().query('UPDATE clinic_settings SET max_bookings_per_ip_day = 1');
    invalidateSettings();
    const ip = freshIp();
    const date = futureDate(22);
    expect((await book(app, bookingBody(f, date, '08:00'), ip)).statusCode).toBe(201);
    expect((await book(app, bookingBody(f, date, '08:30'), ip)).statusCode).toBe(429);
    const { rows } = await getPool().query(`SELECT 1 FROM audit_logs WHERE action = 'BOOKING_IP_LIMIT'`);
    expect(rows.length).toBeGreaterThan(0);
    await getPool().query('UPDATE clinic_settings SET max_bookings_per_ip_day = 1000');
    invalidateSettings();
  });
});
