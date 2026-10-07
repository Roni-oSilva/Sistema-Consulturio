import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { getPool } from '../db/pool.js';
import { randomToken, sha256 } from '../lib/crypto.js';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  professional_id: string | null;
  must_change_password: boolean;
  session_id: string;
  csrf_token: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

/**
 * Nome do cookie. Com HTTPS usamos o prefixo __Host- (exige Secure, Path=/
 * e proíbe Domain), o que impede que subdomínios sobrescrevam o cookie.
 */
export function cookieName() {
  return config().cookieSecure ? '__Host-jrs_sid' : 'jrs_sid';
}

function cookieOptions() {
  return {
    httpOnly: true, // inacessível via JavaScript (mitiga roubo por XSS)
    secure: config().cookieSecure, // somente HTTPS em produção
    sameSite: 'strict' as const, // não enviado em requisições de outros sites (CSRF)
    path: '/',
  };
}

export async function createSession(req: FastifyRequest, reply: FastifyReply, userId: string) {
  // evita fixação de sessão: descarta qualquer sessão anterior deste navegador
  const previous = req.cookies[cookieName()];
  if (previous) await getPool().query('DELETE FROM sessions WHERE id = $1', [sha256(previous)]);
  const token = randomToken(32);
  const csrf = randomToken(24);
  const expires = new Date(Date.now() + config().SESSION_ABSOLUTE_HOURS * 3600_000);
  await getPool().query(
    `INSERT INTO sessions (id, user_id, csrf_token, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5, $6)`,
    [sha256(token), userId, csrf, expires, req.ip, String(req.headers['user-agent'] ?? '').slice(0, 300)],
  );
  reply.setCookie(cookieName(), token, { ...cookieOptions(), expires });
  return { csrf };
}

/** Carrega o usuário da sessão, aplicando expiração por inatividade e absoluta. */
export async function loadSession(req: FastifyRequest): Promise<SessionUser | null> {
  const token = req.cookies[cookieName()];
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const idleMinutes = config().SESSION_IDLE_MINUTES;
  const { rows } = await getPool().query(
    `UPDATE sessions s SET last_seen_at = now()
       FROM users u
      WHERE s.id = $1 AND u.id = s.user_id AND u.active
        AND s.expires_at > now()
        AND s.last_seen_at > now() - make_interval(mins => $2)
     RETURNING u.id, u.name, u.email, u.role, u.professional_id, u.must_change_password, s.id AS session_id, s.csrf_token`,
    [id, idleMinutes],
  );
  if (!rows[0]) {
    // sessão expirada ou inválida: remove do banco
    await getPool().query('DELETE FROM sessions WHERE id = $1', [id]);
    return null;
  }
  return rows[0] as SessionUser;
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[cookieName()];
  if (token) await getPool().query('DELETE FROM sessions WHERE id = $1', [sha256(token)]);
  reply.clearCookie(cookieName(), cookieOptions());
}

export async function destroyUserSessions(userId: string, exceptSessionId?: string) {
  await getPool().query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [userId, exceptSessionId ?? '']);
}

export async function purgeExpiredSessions() {
  const idle = config().SESSION_IDLE_MINUTES;
  await getPool().query(
    `DELETE FROM sessions WHERE expires_at < now() OR last_seen_at < now() - make_interval(mins => $1)`,
    [idle],
  );
}
