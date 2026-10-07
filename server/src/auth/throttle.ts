import { getPool } from '../db/pool.js';

/**
 * Proteção contra força bruta e credential stuffing no login.
 * Contamos falhas por e-mail e por IP; após o limite, bloqueamos por um
 * período que cresce a cada novo bloqueio (backoff progressivo).
 */
const WINDOW_MIN = 15;
const LIMITS = { email: 5, ip: 20 } as const;

export async function isLocked(keys: string[]): Promise<Date | null> {
  const { rows } = await getPool().query<{ locked_until: Date }>(
    `SELECT max(locked_until) AS locked_until FROM auth_throttle WHERE key = ANY($1) AND locked_until > now()`,
    [keys],
  );
  return rows[0]?.locked_until ?? null;
}

export async function registerFailure(key: string, kind: keyof typeof LIMITS) {
  const limit = LIMITS[kind];
  // janela deslizante: zera a contagem se a primeira falha for antiga
  await getPool().query(
    `INSERT INTO auth_throttle (key, failures, first_failure_at) VALUES ($1, 1, now())
     ON CONFLICT (key) DO UPDATE SET
       failures = CASE WHEN auth_throttle.first_failure_at < now() - make_interval(mins => $2) THEN 1 ELSE auth_throttle.failures + 1 END,
       first_failure_at = CASE WHEN auth_throttle.first_failure_at < now() - make_interval(mins => $2) THEN now() ELSE auth_throttle.first_failure_at END,
       locked_until = CASE
         WHEN auth_throttle.first_failure_at >= now() - make_interval(mins => $2) AND auth_throttle.failures + 1 >= $3
         THEN now() + make_interval(mins => LEAST(60, $2 * GREATEST(1, (auth_throttle.failures + 1) / $3)))
         ELSE auth_throttle.locked_until END`,
    [key, WINDOW_MIN, limit],
  );
}

export async function clearFailures(key: string) {
  await getPool().query('DELETE FROM auth_throttle WHERE key = $1', [key]);
}

export async function purgeThrottle() {
  await getPool().query(
    `DELETE FROM auth_throttle WHERE (locked_until IS NULL OR locked_until < now()) AND first_failure_at < now() - interval '1 day'`,
  );
}
