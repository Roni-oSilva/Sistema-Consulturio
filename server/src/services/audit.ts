import type { FastifyRequest } from 'fastify';
import { getPool, type Queryable } from '../db/pool.js';

export type AuditResult = 'SUCCESS' | 'FAILURE' | 'DENIED';

export type AuditEntry = {
  action: string;
  resourceType?: string;
  resourceId?: string | null;
  result?: AuditResult;
  details?: Record<string, unknown>;
  userId?: string | null;
  userLabel?: string;
};

// Chaves que jamais devem ir para o log de auditoria.
const SENSITIVE = /pass|senha|token|secret|hash|cpf|cookie|authorization/i;

function scrub(details: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (SENSITIVE.test(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = scrub(v as Record<string, unknown>);
    else if (typeof v === 'string') out[k] = v.slice(0, 500);
    else out[k] = v;
  }
  return out;
}

/** Registra uma ação no log de auditoria. Nunca lança erro (não pode derrubar a requisição). */
export async function audit(req: FastifyRequest | null, entry: AuditEntry, db: Queryable = getPool()) {
  const user = req?.user;
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, user_label, action, resource_type, resource_id, result, ip, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.userId !== undefined ? entry.userId : (user?.id ?? null),
        entry.userLabel ?? (user ? `${user.name} <${user.email}>` : ''),
        entry.action,
        entry.resourceType ?? '',
        entry.resourceId ?? '',
        entry.result ?? 'SUCCESS',
        req?.ip ?? '',
        String(req?.headers['user-agent'] ?? '').slice(0, 300),
        JSON.stringify(scrub(entry.details)),
      ],
    );
  } catch (err) {
    req?.log.error({ err }, 'falha ao gravar auditoria');
  }
}
