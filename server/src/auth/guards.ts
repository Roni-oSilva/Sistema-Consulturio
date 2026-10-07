import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { forbidden, unauthorized } from '../lib/errors.js';
import { safeEqual } from '../lib/crypto.js';
import { audit } from '../services/audit.js';
import { hasPermission, type Permission } from './rbac.js';
import { loadSession } from './sessions.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Autenticação obrigatória + proteção CSRF para métodos que alteram estado.
 * Aplicado a TODAS as rotas /api/admin (exceto login).
 */
export const requireAuth: preHandlerHookHandler = async (req: FastifyRequest, _reply: FastifyReply) => {
  const user = await loadSession(req);
  if (!user) throw unauthorized('Sua sessão expirou. Faça login novamente.', 'SESSION_EXPIRED');
  req.user = user;

  if (!SAFE_METHODS.has(req.method)) {
    const header = req.headers['x-csrf-token'];
    if (typeof header !== 'string' || !safeEqual(header, user.csrf_token)) {
      await audit(req, { action: 'CSRF_REJECTED', result: 'DENIED', details: { url: req.routeOptions.url } });
      throw forbidden('Requisição recusada (token de segurança inválido). Recarregue a página.');
    }
  }

  // Usuário com senha temporária só pode trocar a senha / sair / ver o próprio perfil.
  if (user.must_change_password) {
    const allowed = ['/api/admin/me', '/api/admin/me/password', '/api/admin/logout'];
    if (!allowed.includes(req.routeOptions.url ?? '')) {
      throw forbidden('Troque sua senha temporária para continuar.');
    }
  }
};

/** Exige uma permissão. Negações ficam registradas na auditoria. */
export function requirePermission(perm: Permission): preHandlerHookHandler {
  return async (req) => {
    const user = req.user;
    if (!user) throw unauthorized();
    if (!hasPermission(user.role, perm)) {
      await audit(req, {
        action: 'PERMISSION_DENIED',
        result: 'DENIED',
        details: { permission: perm, method: req.method, url: req.routeOptions.url },
      });
      throw forbidden();
    }
  };
}

/** Para a função PROFISSIONAL: restringe o acesso aos próprios agendamentos. */
export function ownProfessionalScope(req: FastifyRequest): string | null {
  const u = req.user;
  if (!u) throw unauthorized();
  if (u.role === 'PROFESSIONAL') {
    if (!u.professional_id) throw forbidden('Seu usuário não está vinculado a um profissional.');
    return u.professional_id;
  }
  return null;
}
