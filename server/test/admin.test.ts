import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../src/db/pool.js';
import { sha256 } from '../src/lib/crypto.js';
import {
  ADMIN,
  adminReq,
  book,
  bookingBody,
  createFixture,
  createUser,
  freshIp,
  futureDate,
  login,
  setupApp,
  type Fixture,
} from './helpers.js';

let app: FastifyInstance;
let f: Fixture;

beforeAll(async () => {
  app = await setupApp();
  f = await createFixture('admin');
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('7. Login administrativo', () => {
  it('login correto cria sessão segura (HttpOnly, SameSite=Strict) e registra auditoria', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/login', payload: ADMIN, remoteAddress: freshIp() });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name.endsWith('jrs_sid'))!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Strict');
    expect(cookie.path).toBe('/');
    expect(res.json().user.role).toBe('SUPER_ADMIN');
    expect(res.json().user).not.toHaveProperty('password_hash');
    // o token do cookie não é guardado no banco, só o hash
    const { rows } = await getPool().query('SELECT 1 FROM sessions WHERE id = $1', [cookie.value]);
    expect(rows).toHaveLength(0);
    const { rows: hashed } = await getPool().query('SELECT 1 FROM sessions WHERE id = $1', [sha256(cookie.value)]);
    expect(hashed).toHaveLength(1);
    const { rows: logs } = await getPool().query(`SELECT 1 FROM audit_logs WHERE action = 'LOGIN_SUCCESS'`);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('senha nunca é armazenada em texto puro', async () => {
    const { rows } = await getPool().query('SELECT password_hash FROM users WHERE email = $1', [ADMIN.email]);
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0].password_hash).not.toContain(ADMIN.password);
  });

  it('senha errada e e-mail inexistente recebem a mesma resposta (sem enumeração)', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { email: ADMIN.email, password: 'errada-123' }, remoteAddress: freshIp() });
    const b = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { email: 'nao@existe.com', password: 'errada-123' }, remoteAddress: freshIp() });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json().error).toBe(b.json().error);
  });

  it('força bruta: conta é bloqueada temporariamente após 5 falhas', async () => {
    const u = await createUser('RECEPTION');
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { email: u.email, password: 'tentativa-' + i }, remoteAddress: freshIp() });
      expect(r.statusCode).toBe(401);
    }
    // mesmo com a senha CORRETA, de outro IP, continua bloqueado
    const blocked = await app.inject({ method: 'POST', url: '/api/admin/login', payload: u, remoteAddress: freshIp() });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('LOGIN_LOCKED');
  });

  it('logout encerra a sessão no servidor', async () => {
    const s = await login(app);
    const out = await app.inject(adminReq(s, 'POST', '/api/admin/logout'));
    expect(out.statusCode).toBe(200);
    const me = await app.inject(adminReq(s, 'GET', '/api/admin/me'));
    expect(me.statusCode).toBe(401);
  });

  it('senha temporária obriga a troca antes de usar o painel', async () => {
    const s = await login(app);
    const created = await app.inject(adminReq(s, 'POST', '/api/admin/users', { name: 'Nova Recepção', email: 'nova.recepcao@test.com', role: 'RECEPTION' }));
    expect(created.statusCode).toBe(201);
    const temp = created.json().temporaryPassword;
    const r = await login(app, 'nova.recepcao@test.com', temp);
    const blocked = await app.inject(adminReq(r, 'GET', '/api/admin/dashboard'));
    expect(blocked.statusCode).toBe(403);
    const weak = await app.inject(adminReq(r, 'POST', '/api/admin/me/password', { currentPassword: temp, newPassword: '123' }));
    expect(weak.statusCode).toBe(400);
    const ok = await app.inject(adminReq(r, 'POST', '/api/admin/me/password', { currentPassword: temp, newPassword: 'NovaSenha-2026' }));
    expect(ok.statusCode).toBe(200);
    const after = await app.inject(adminReq(r, 'GET', '/api/admin/dashboard'));
    expect(after.statusCode).toBe(200);
  });
});

describe('8. Acesso sem permissão', () => {
  it('rotas administrativas exigem login', async () => {
    for (const url of ['/api/admin/dashboard', '/api/admin/appointments', '/api/admin/settings', '/api/admin/users', '/api/admin/audit-logs']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(401);
    }
    const w = await app.inject({ method: 'POST', url: '/api/admin/professionals', payload: { name: 'Hacker' } });
    expect(w.statusCode).toBe(401);
  });

  it('recepção gerencia agendamentos, mas não configurações críticas', async () => {
    const u = await createUser('RECEPTION');
    const s = await login(app, u.email, u.password);
    expect((await app.inject(adminReq(s, 'GET', '/api/admin/dashboard'))).statusCode).toBe(200);
    expect((await app.inject(adminReq(s, 'GET', `/api/admin/appointments?from=${futureDate(0)}&to=${futureDate(30)}`))).statusCode).toBe(200);
    expect((await app.inject(adminReq(s, 'GET', '/api/admin/settings'))).statusCode).toBe(403);
    expect((await app.inject(adminReq(s, 'PUT', '/api/admin/settings', { name: 'Hack' }))).statusCode).toBe(403);
    expect((await app.inject(adminReq(s, 'GET', '/api/admin/users'))).statusCode).toBe(403);
    expect((await app.inject(adminReq(s, 'GET', '/api/admin/audit-logs'))).statusCode).toBe(403);
    expect((await app.inject(adminReq(s, 'POST', '/api/admin/professionals', { name: 'X' }))).statusCode).toBe(403);
    const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'PERMISSION_DENIED'`);
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it('administrador não consegue criar super administrador (escalada de privilégio)', async () => {
    const u = await createUser('ADMIN');
    const s = await login(app, u.email, u.password);
    const r = await app.inject(adminReq(s, 'POST', '/api/admin/users', { name: 'Xavier Super', email: 'x-super@test.com', role: 'SUPER_ADMIN' }));
    expect(r.statusCode).toBe(403);
    const { rows } = await getPool().query('SELECT id FROM users WHERE email = $1', [ADMIN.email]);
    const r2 = await app.inject(adminReq(s, 'PUT', `/api/admin/users/${rows[0].id}`, { name: 'Xavier Admin', email: ADMIN.email, role: 'RECEPTION', active: false }));
    expect(r2.statusCode).toBe(403);
  });

  it('profissional vê somente a própria agenda', async () => {
    const date = futureDate(5);
    const mine = (await book(app, bookingBody(f, date, '08:00'))).json();
    const other = (await book(app, { ...bookingBody(f, date, '08:00'), professionalId: f.professional2Id })).json();
    const u = await createUser('PROFESSIONAL', f.professionalId);
    const s = await login(app, u.email, u.password);
    const list = await app.inject(adminReq(s, 'GET', `/api/admin/appointments?from=${date}&to=${date}`));
    const ids = list.json().appointments.map((a: { id: string }) => a.id);
    expect(ids).toContain(mine.appointment.id);
    expect(ids).not.toContain(other.appointment.id);
    const detail = await app.inject(adminReq(s, 'GET', `/api/admin/appointments/${other.appointment.id}`));
    expect(detail.statusCode).toBe(404);
    const cancel = await app.inject(adminReq(s, 'POST', `/api/admin/appointments/${mine.appointment.id}/cancel`, {}));
    expect(cancel.statusCode).toBe(403);
  });

  it('CSRF: requisição que altera dados sem o token é recusada', async () => {
    const s = await login(app);
    const r = await app.inject({
      method: 'POST',
      url: '/api/admin/holidays',
      payload: { date: '2030-01-02', name: 'Teste' },
      headers: { cookie: s.cookie },
    });
    expect(r.statusCode).toBe(403);
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/admin/holidays',
      payload: { date: '2030-01-02', name: 'Teste' },
      headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, origin: 'https://site-malicioso.com' },
    });
    expect(r2.statusCode).toBe(403);
  });
});

describe('9. Expiração de sessão', () => {
  it('expira por inatividade', async () => {
    const s = await login(app);
    expect((await app.inject(adminReq(s, 'GET', '/api/admin/me'))).statusCode).toBe(200);
    const token = s.cookie.split('=')[1];
    await getPool().query(`UPDATE sessions SET last_seen_at = now() - interval '31 minutes' WHERE id = $1`, [sha256(token)]);
    const r = await app.inject(adminReq(s, 'GET', '/api/admin/me'));
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe('SESSION_EXPIRED');
  });

  it('expira pelo tempo máximo absoluto', async () => {
    const s = await login(app);
    const token = s.cookie.split('=')[1];
    await getPool().query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = $1`, [sha256(token)]);
    expect((await app.inject(adminReq(s, 'GET', '/api/admin/me'))).statusCode).toBe(401);
  });

  it('desativar usuário encerra as sessões', async () => {
    const admin = await login(app);
    const u = await createUser('RECEPTION');
    const s = await login(app, u.email, u.password);
    const { rows } = await getPool().query('SELECT id FROM users WHERE email = $1', [u.email]);
    const upd = await app.inject(adminReq(admin, 'PUT', `/api/admin/users/${rows[0].id}`, { name: 'Recepção Desativada', email: u.email, role: 'RECEPTION', active: false }));
    expect(upd.statusCode).toBe(200);
    expect((await app.inject(adminReq(s, 'GET', '/api/admin/me'))).statusCode).toBe(401);
  });
});

describe('Painel: fluxo do dia a dia', () => {
  it('dashboard, agendamento pela recepção, confirmação, conclusão e auditoria', async () => {
    const s = await login(app);
    const date = futureDate(2);
    const created = await app.inject(
      adminReq(s, 'POST', '/api/admin/appointments', {
        serviceId: f.serviceId, professionalId: f.professionalId, date, time: '15:00', name: 'João Recepção', phone: '(91) 98877-6655',
      }),
    );
    expect(created.statusCode).toBe(201);
    const id = created.json().appointment.id;
    expect(created.json().appointment.status).toBe('CONFIRMED');

    // encaixe fora do expediente (sem sobreposição)
    const encaixe = await app.inject(
      adminReq(s, 'POST', '/api/admin/appointments', {
        serviceId: f.serviceId, professionalId: f.professionalId, date, time: '12:00', name: 'Encaixe Teste', phone: '(91) 98877-1111', outsideSchedule: true,
      }),
    );
    expect(encaixe.statusCode).toBe(201);
    const overlap = await app.inject(
      adminReq(s, 'POST', '/api/admin/appointments', {
        serviceId: f.serviceId, professionalId: f.professionalId, date, time: '12:00', name: 'Encaixe Dois', phone: '(91) 98877-2222', outsideSchedule: true,
      }),
    );
    expect(overlap.statusCode).toBe(409);

    // não pode concluir atendimento futuro
    const early = await app.inject(adminReq(s, 'POST', `/api/admin/appointments/${id}/status`, { status: 'COMPLETED' }));
    expect(early.statusCode).toBe(400);

    const dash = await app.inject(adminReq(s, 'GET', '/api/admin/dashboard'));
    expect(dash.statusCode).toBe(200);
    expect(dash.json().totals.upcoming).toBeGreaterThan(0);

    const detail = await app.inject(adminReq(s, 'GET', `/api/admin/appointments/${id}`));
    expect(detail.json().events[0].action).toBe('CREATED');

    const cancel = await app.inject(adminReq(s, 'POST', `/api/admin/appointments/${id}/status`, { status: 'CANCELLED', reason: 'Paciente ligou' }));
    expect(cancel.json().appointment.status).toBe('CANCELLED');
    const react = await app.inject(adminReq(s, 'POST', `/api/admin/appointments/${id}/status`, { status: 'CONFIRMED' }));
    expect(react.json().appointment.status).toBe('CONFIRMED');

    const logs = await app.inject(adminReq(s, 'GET', '/api/admin/audit-logs?action=APPOINTMENT_CANCELLED'));
    expect(logs.json().logs.length).toBeGreaterThan(0);
    // nenhum log de auditoria contém senhas ou hashes
    const { rows: all } = await getPool().query('SELECT details::text AS d FROM audit_logs');
    for (const r of all) expect(r.d).not.toMatch(/Senha-Forte-123|Senha-Teste-456|argon2/);
  });

  it('fila manual de WhatsApp gera link wa.me pronto e pode ser marcada como enviada', async () => {
    const { processDueNotifications } = await import('../src/services/notifications/worker.js');
    const s = await login(app);
    await book(app, bookingBody(f, futureDate(3), '17:00'));
    await processDueNotifications(200);
    const q = await app.inject(adminReq(s, 'GET', '/api/admin/notifications/manual'));
    expect(q.statusCode).toBe(200);
    const msg = q.json().messages[0];
    expect(msg.waLink).toMatch(/^https:\/\/wa\.me\/55\d{10,11}\?text=/);
    const done = await app.inject(adminReq(s, 'POST', `/api/admin/notifications/${msg.id}/mark-sent`));
    expect(done.statusCode).toBe(200);
  });

  it('configurações: somente campos permitidos são gravados', async () => {
    const s = await login(app);
    const r = await app.inject(adminReq(s, 'PUT', '/api/admin/settings', { address: 'Rua Teste, 100', id: 99, updated_by: null }));
    expect(r.statusCode).toBe(200);
    const { rows } = await getPool().query('SELECT id, address FROM clinic_settings');
    expect(rows).toHaveLength(1);
    expect(rows[0].address).toBe('Rua Teste, 100');
  });

  it('LGPD: anonimização remove dados pessoais e mantém o histórico', async () => {
    const s = await login(app);
    const a = (await book(app, bookingBody(f, futureDate(4), '11:30', { name: 'Paciente Para Anonimizar' }))).json();
    const { rows } = await getPool().query('SELECT patient_id FROM appointments WHERE id = $1', [a.appointment.id]);
    const pid = rows[0].patient_id;
    const blocked = await app.inject(adminReq(s, 'POST', `/api/admin/patients/${pid}/anonymize`, { confirm: 'ANONIMIZAR' }));
    expect(blocked.statusCode).toBe(409); // tem agendamento futuro
    await app.inject(adminReq(s, 'POST', `/api/admin/appointments/${a.appointment.id}/cancel`, {}));
    const ok = await app.inject(adminReq(s, 'POST', `/api/admin/patients/${pid}/anonymize`, { confirm: 'ANONIMIZAR' }));
    expect(ok.statusCode).toBe(200);
    const { rows: after } = await getPool().query('SELECT patient_name, contact_phone, status FROM appointments WHERE id = $1', [a.appointment.id]);
    expect(after[0].patient_name).toBe('Paciente anonimizado');
    expect(after[0].status).toBe('CANCELLED');
  });
});
