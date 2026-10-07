import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../auth/guards.js';
import { hashPassword, passwordProblems, verifyPassword } from '../../auth/password.js';
import { ROLE_DEFS, type Role } from '../../auth/rbac.js';
import { createSession, destroySession, destroyUserSessions } from '../../auth/sessions.js';
import { clearFailures, isLocked, registerFailure } from '../../auth/throttle.js';
import { getPool } from '../../db/pool.js';
import { badRequest, AppError } from '../../lib/errors.js';
import { parse } from '../../lib/validation.js';
import { audit } from '../../services/audit.js';

const loginSchema = z.object({
  email: z.string().max(254).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1, 'Informe a senha.').max(128),
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: 15 * 60_000 } } }, async (req, reply) => {
    const body = parse(loginSchema, req.body);
    const emailKey = `email:${body.email}`;
    const ipKey = `ip:${req.ip}`;

    const locked = await isLocked([emailKey, ipKey]);
    if (locked) {
      await audit(req, { action: 'LOGIN_BLOCKED', result: 'DENIED', userLabel: body.email, details: { until: locked.toISOString() } });
      const minutes = Math.max(1, Math.ceil((locked.getTime() - Date.now()) / 60_000));
      throw new AppError(429, 'LOGIN_LOCKED', `Muitas tentativas de login. Tente novamente em ${minutes} minuto(s).`);
    }

    const { rows } = await getPool().query<{ id: string; password_hash: string; active: boolean; name: string; role: string }>(
      'SELECT id, password_hash, active, name, role FROM users WHERE lower(email) = $1',
      [body.email],
    );
    const user = rows[0];
    const ok = await verifyPassword(user?.active ? user.password_hash : null, body.password);
    if (!user || !user.active || !ok) {
      await registerFailure(emailKey, 'email');
      await registerFailure(ipKey, 'ip');
      await audit(req, {
        action: 'LOGIN_FAILED',
        result: 'FAILURE',
        userId: user?.id ?? null,
        userLabel: body.email,
        details: { reason: !user ? 'unknown_user' : !user.active ? 'inactive' : 'bad_password' },
      });
      // mensagem genérica: não revela se o e-mail existe
      throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.');
    }

    await clearFailures(emailKey);
    const { csrf } = await createSession(req, reply, user.id);
    const { rows: updated } = await getPool().query(
      `UPDATE users SET last_login_at = now() WHERE id = $1 RETURNING id, name, email, role, professional_id, must_change_password`,
      [user.id],
    );
    const u = updated[0];
    await audit(req, { action: 'LOGIN_SUCCESS', userId: u.id, userLabel: `${u.name} <${u.email}>`, resourceType: 'user', resourceId: u.id });
    return {
      user: {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        professionalId: u.professional_id,
        mustChangePassword: u.must_change_password,
        permissions: ROLE_DEFS[u.role as Role]?.permissions ?? [],
      },
      csrfToken: csrf,
    };
  });

  app.post('/logout', { preHandler: requireAuth }, async (req, reply) => {
    await audit(req, { action: 'LOGOUT', resourceType: 'user', resourceId: req.user!.id });
    await destroySession(req, reply);
    return { ok: true };
  });

  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const u = req.user!;
    return {
      user: {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        professionalId: u.professional_id,
        mustChangePassword: u.must_change_password,
        permissions: ROLE_DEFS[u.role as Role]?.permissions ?? [],
      },
      csrfToken: u.csrf_token,
    };
  });

  app.post(
    '/me/password',
    { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: 15 * 60_000 } } },
    async (req) => {
      const body = parse(
        z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(1).max(128) }),
        req.body,
      );
      const u = req.user!;
      const { rows } = await getPool().query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [u.id]);
      if (!(await verifyPassword(rows[0]?.password_hash ?? null, body.currentPassword))) {
        await audit(req, { action: 'PASSWORD_CHANGE_FAILED', result: 'FAILURE', resourceType: 'user', resourceId: u.id });
        throw badRequest('Senha atual incorreta.', 'VALIDATION_ERROR', { fields: { currentPassword: 'Senha atual incorreta.' } });
      }
      const problem = passwordProblems(body.newPassword);
      if (problem) throw badRequest(problem, 'VALIDATION_ERROR', { fields: { newPassword: problem } });
      if (body.newPassword === body.currentPassword) throw badRequest('A nova senha deve ser diferente da atual.');
      await getPool().query(
        `UPDATE users SET password_hash = $2, must_change_password = false, password_changed_at = now(), updated_at = now() WHERE id = $1`,
        [u.id, await hashPassword(body.newPassword)],
      );
      // encerra todas as outras sessões do usuário
      await destroyUserSessions(u.id, u.session_id);
      await audit(req, { action: 'PASSWORD_CHANGED', resourceType: 'user', resourceId: u.id });
      return { ok: true };
    },
  );
}
