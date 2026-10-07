import pg from 'pg';
import { config } from '../config.js';

// timestamptz/date chegam como string — tratamos datas explicitamente com Luxon.
pg.types.setTypeParser(1082, (v) => v); // date -> 'YYYY-MM-DD'
pg.types.setTypeParser(1083, (v) => v.slice(0, 5)); // time -> 'HH:mm'
pg.types.setTypeParser(20, (v) => Number(v)); // bigint/count -> number

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config().DATABASE_URL,
      max: 15,
      idleTimeoutMillis: 30_000,
      statement_timeout: 15_000,
    });
    pool.on('error', (err) => {
      console.error('[db] erro inesperado em conexão ociosa', err.message);
    });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

/** Executa `fn` dentro de uma transação. Faz rollback em qualquer erro. */
export async function withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* conexão pode estar quebrada */
    }
    throw err;
  } finally {
    client.release();
  }
}
