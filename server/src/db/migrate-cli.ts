import { getPool, closePool } from './pool.js';
import { migrate } from './migrate.js';

try {
  await migrate(getPool());
  console.log('[migrate] banco atualizado');
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
