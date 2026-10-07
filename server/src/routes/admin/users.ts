import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requirePermission } from '../../auth/guards.js';
import { hashPassword, passwordProblems } from '../../auth/password.js';
import { ROLE_DEFS, ROLES, manageableRoles, type Role } from '../../auth/rbac.js';
import { destroyUserSessions } from '../../auth/sessions.js';
import { getPool, withTransaction } from '../../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { emailSchema, formatPhone, isoDate, parse, requiredText, uuid } from '../../lib/validation.js';
import { audit } from '../../services/audit.js';
import { cancelPending } from '../../services/notifications/queue.js';

const roleEnum = z.enum(ROLES as [Role, ...Role[]]);

export async function userRoutes(app: FastifyInstance) {
  // ============================================================ USUÁRIOS
  app.get('/roles', { preHandler: requirePermission('users:read') }, async (req) => ({
    roles: Object.entries(ROLE_DEFS).map(([code, d]) => ({ code, name: d.name, description: d.description, permissions: d.permissions })),
    manageable: manageableRoles(req.user!.role),
  }));

  app.get('/users', { preHandler: requirePermission('users:read') }, async () => {
    const { rows } = await getPool().query(
      `SELECT u.id, u.name, u.email, u.role, u.active, u.professional_id AS "professionalId", p.name AS "professionalName",
              u.must_change_password AS "mustChangePassword", u.last_login_at AS "lastLoginAt", u.created_at AS "createdAt"
         FROM users u LEFT JOIN professionals p ON p.id = u.professional_id
        ORDER BY u.active DESC, u.name`,
    );
    return { users: rows };
  });

  const userSchema = z.object({
    name: requiredText(2, 120, 'Informe o nome.'),
    email: emailSchema,
    role: roleEnum,
    professionalId: uuid.nullish(),
    active: z.boolean().default(true),
    password: z.string().max(128).optional(),
  });

  app.post('/users', { preHandler: requirePermission('users:write') }, async (req, reply) => {
    const b = parse(userSchema, req.body);
    if (!manageableRoles(req.user!.role).includes(b.role)) {
      await audit(req, { action: 'PERMISSION_DENIED', result: 'DENIED', details: { attempt: 'create_user', role: b.role } });
      throw forbidden('Você não pode criar usuários com esta função.');
    }
    if (b.role === 'PROFESSIONAL' && !b.professionalId) throw badRequest('Vincule o usuário a um profissional.');
    const generated = !b.password;
    const password = b.password || randomBytes(9).toString('base64url') + '7a';
    if (!generated) {
      const problem = passwordProblems(password);
      if (problem) throw badRequest(problem, 'VALIDATION_ERROR', { fields: { password: problem } });
    }
    const { rows } = await getPool()
      .query<{ id: string }>(
        `INSERT INTO users (name, email, password_hash, role, professional_id, active, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`,
        [b.name, b.email, await hashPassword(password), b.role, b.role === 'PROFESSIONAL' ? b.professionalId : null, b.active],
      )
      .catch((err) => {
        if (err.code === '23505') throw conflict('Já existe um usuário com este e-mail.');
        throw err;
      });
    await audit(req, { action: 'USER_CREATED', resourceType: 'user', resourceId: rows[0].id, details: { email: b.email, role: b.role } });
    reply.code(201);
    // a senha temporária é exibida UMA vez para ser repassada ao usuário
    return { id: rows[0].id, temporaryPassword: generated ? password : null };
  });

  app.put('/users/:id', { preHandler: requirePermission('users:write') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(userSchema.omit({ password: true }), req.body);
    const actor = req.user!;
    const { rows } = await getPool().query<{ role: Role; active: boolean; email: string }>('SELECT role, active, email FROM users WHERE id = $1', [id]);
    const target = rows[0];
    if (!target) throw notFound('Usuário não encontrado.');
    const allowed = manageableRoles(actor.role);
    if (id !== actor.id && (!allowed.includes(target.role) || !allowed.includes(b.role))) {
      await audit(req, { action: 'PERMISSION_DENIED', result: 'DENIED', resourceType: 'user', resourceId: id, details: { attempt: 'update_user' } });
      throw forbidden('Você não pode alterar este usuário.');
    }
    if (id === actor.id && (b.role !== target.role || !b.active)) {
      throw badRequest('Você não pode alterar a própria função nem desativar a si mesmo.');
    }
    if (b.role === 'PROFESSIONAL' && !b.professionalId) throw badRequest('Vincule o usuário a um profissional.');
    await getPool()
      .query(
        `UPDATE users SET name = $2, email = $3, role = $4, professional_id = $5, active = $6, updated_at = now() WHERE id = $1`,
        [id, b.name, b.email, b.role, b.role === 'PROFESSIONAL' ? b.professionalId : null, b.active],
      )
      .catch((err) => {
        if (err.code === '23505') throw conflict('Já existe um usuário com este e-mail.');
        throw err;
      });
    // mudança de função ou desativação encerra as sessões ativas
    if (b.role !== target.role || !b.active) await destroyUserSessions(id);
    await audit(req, {
      action: b.role !== target.role ? 'USER_ROLE_CHANGED' : !b.active && target.active ? 'USER_DEACTIVATED' : 'USER_UPDATED',
      resourceType: 'user',
      resourceId: id,
      details: { fromRole: target.role, toRole: b.role, active: b.active },
    });
    return { ok: true };
  });

  app.post('/users/:id/reset-password', { preHandler: requirePermission('users:write') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { rows } = await getPool().query<{ role: Role }>('SELECT role FROM users WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('Usuário não encontrado.');
    if (id !== req.user!.id && !manageableRoles(req.user!.role).includes(rows[0].role)) {
      await audit(req, { action: 'PERMISSION_DENIED', result: 'DENIED', resourceType: 'user', resourceId: id, details: { attempt: 'reset_password' } });
      throw forbidden('Você não pode redefinir a senha deste usuário.');
    }
    const password = randomBytes(9).toString('base64url') + '7a';
    await getPool().query(
      `UPDATE users SET password_hash = $2, must_change_password = true, password_changed_at = now(), updated_at = now() WHERE id = $1`,
      [id, await hashPassword(password)],
    );
    await destroyUserSessions(id);
    await audit(req, { action: 'USER_PASSWORD_RESET', resourceType: 'user', resourceId: id });
    return { temporaryPassword: password };
  });

  // ============================================================ AUDITORIA
  app.get('/audit-logs', { preHandler: requirePermission('audit:read') }, async (req) => {
    const q = parse(
      z.object({
        action: z.string().max(60).optional(),
        result: z.enum(['SUCCESS', 'FAILURE', 'DENIED']).optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        q: z.string().max(100).optional(),
        page: z.coerce.number().int().min(1).max(1000).default(1),
      }),
      req.query,
    );
    const size = 50;
    const { rows } = await getPool().query(
      `SELECT id, at, user_label AS "userLabel", action, resource_type AS "resourceType", resource_id AS "resourceId",
              result, ip, details
         FROM audit_logs
        WHERE ($1::text IS NULL OR action = $1) AND ($2::text IS NULL OR result = $2)
          AND ($3::date IS NULL OR at >= $3::date) AND ($4::date IS NULL OR at < $4::date + 1)
          AND ($5::text IS NULL OR user_label ILIKE '%' || $5 || '%' OR resource_id = $5)
        ORDER BY at DESC LIMIT $6 OFFSET $7`,
      [q.action ?? null, q.result ?? null, q.from ?? null, q.to ?? null, q.q?.trim() || null, size + 1, (q.page - 1) * size],
    );
    const { rows: actions } = await getPool().query<{ action: string }>('SELECT DISTINCT action FROM audit_logs ORDER BY action');
    return { logs: rows.slice(0, size), hasMore: rows.length > size, actions: actions.map((a) => a.action) };
  });

  // ============================================================ PACIENTES (LGPD)
  app.get('/patients', { preHandler: requirePermission('patients:read') }, async (req) => {
    const q = parse(z.object({ q: z.string().max(100).default('') }), req.query);
    const term = q.q.trim();
    const digits = term.replace(/\D/g, '');
    const { rows } = await getPool().query(
      `SELECT p.id, p.name, p.phone, p.email, p.created_at AS "createdAt", p.anonymized_at AS "anonymizedAt",
              (SELECT count(*)::int FROM appointments a WHERE a.patient_id = p.id) AS appointments,
              (SELECT max(a.start_at) FROM appointments a WHERE a.patient_id = p.id) AS "lastAppointment"
         FROM patients p
        WHERE ($1 = '' OR p.name ILIKE '%' || $1 || '%' OR ($2 <> '' AND p.phone LIKE '%' || $2 || '%') OR lower(p.email) = lower($1))
        ORDER BY p.updated_at DESC LIMIT 50`,
      [term, digits.length >= 4 ? digits : ''],
    );
    return { patients: rows.map((p) => ({ ...p, phone: formatPhone(p.phone) })) };
  });

  app.get('/patients/:id', { preHandler: requirePermission('patients:read') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const db = getPool();
    const { rows } = await db.query(
      `SELECT id, name, phone, email, cpf, birth_date AS "birthDate", created_at AS "createdAt", anonymized_at AS "anonymizedAt" FROM patients WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw notFound('Paciente não encontrado.');
    const full = req.user!.role === 'SUPER_ADMIN' || req.user!.role === 'ADMIN';
    const p = rows[0];
    const { rows: appts } = await db.query(
      `SELECT a.id, a.code, a.start_at AS "start", a.status, s.name AS "serviceName", pr.title || ' ' || pr.name AS "professionalName"
         FROM appointments a JOIN services s ON s.id = a.service_id JOIN professionals pr ON pr.id = a.professional_id
        WHERE a.patient_id = $1 ORDER BY a.start_at DESC LIMIT 100`,
      [id],
    );
    const { rows: consents } = await db.query(
      `SELECT type, version, granted, created_at AS "createdAt" FROM consents WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [id],
    );
    await audit(req, { action: 'PATIENT_VIEWED', resourceType: 'patient', resourceId: id });
    return {
      patient: { ...p, phone: formatPhone(p.phone), cpf: p.cpf ? (full ? p.cpf : `***.${p.cpf.slice(3, 6)}.${p.cpf.slice(6, 9)}-**`) : null },
      appointments: appts,
      consents,
    };
  });

  /** Exportação dos dados do paciente (direito de acesso — LGPD art. 18). */
  app.get('/patients/:id/export', { preHandler: requirePermission('patients:anonymize') }, async (req, reply) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const db = getPool();
    const { rows } = await db.query('SELECT name, phone, email, cpf, birth_date, created_at FROM patients WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('Paciente não encontrado.');
    const { rows: appts } = await db.query(
      `SELECT a.code, a.start_at, a.status, s.name AS service, pr.name AS professional, a.patient_notes
         FROM appointments a JOIN services s ON s.id = a.service_id JOIN professionals pr ON pr.id = a.professional_id
        WHERE a.patient_id = $1 ORDER BY a.start_at`,
      [id],
    );
    const { rows: consents } = await db.query('SELECT type, version, granted, created_at FROM consents WHERE patient_id = $1', [id]);
    await audit(req, { action: 'PATIENT_DATA_EXPORTED', resourceType: 'patient', resourceId: id });
    reply.header('content-disposition', `attachment; filename="paciente-${id}.json"`);
    return { exportedAt: new Date().toISOString(), patient: rows[0], appointments: appts, consents };
  });

  /** Anonimização (direito de eliminação — LGPD). Mantém estatísticas, remove dados pessoais. */
  app.post('/patients/:id/anonymize', { preHandler: requirePermission('patients:anonymize') }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ confirm: z.literal('ANONIMIZAR', { error: 'Digite ANONIMIZAR para confirmar.' }) }), req.body);
    void b;
    await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT anonymized_at FROM patients WHERE id = $1 FOR UPDATE', [id]);
      if (!rows[0]) throw notFound('Paciente não encontrado.');
      if (rows[0].anonymized_at) throw conflict('Paciente já anonimizado.');
      const { rows: future } = await client.query(
        `SELECT 1 FROM appointments WHERE patient_id = $1 AND status IN ('PENDING','CONFIRMED') AND start_at > now() LIMIT 1`,
        [id],
      );
      if (future.length) throw conflict('O paciente possui agendamentos futuros. Cancele-os antes de anonimizar.');
      const tag = `anon-${id.slice(0, 8)}`;
      await client.query(
        `UPDATE patients SET name = 'Paciente anonimizado', name_key = $2, phone = '0', email = NULL, cpf = NULL, birth_date = NULL,
                anonymized_at = now(), updated_at = now() WHERE id = $1`,
        [id, tag],
      );
      const { rows: appts } = await client.query<{ id: string }>(
        `UPDATE appointments SET patient_name = 'Paciente anonimizado', contact_phone = '0', contact_email = NULL, patient_notes = '',
                internal_notes = '', ip_hash = '' WHERE patient_id = $1 RETURNING id`,
        [id],
      );
      for (const a of appts) {
        await cancelPending(client, a.id, 'Paciente anonimizado', ['PATIENT', 'CLINIC', 'PROFESSIONAL']);
        await client.query(`UPDATE notifications SET recipient = '0', body = '', subject = '' WHERE appointment_id = $1`, [a.id]);
      }
    });
    await audit(req, { action: 'PATIENT_ANONYMIZED', resourceType: 'patient', resourceId: id });
    return { ok: true };
  });
}
