import { getPool, closePool } from './pool.js';
import { migrate } from './migrate.js';
import { seedBase, seedDemo } from './seed.js';

// Uso: npm run seed            -> dados base (serviços, feriados, mensagens, admin)
//      npm run seed -- --demo  -> também cria profissionais fictícios de demonstração
const demo = process.argv.includes('--demo');
try {
  const pool = getPool();
  await migrate(pool);
  await seedBase(pool, {
    adminEmail: process.env.INITIAL_ADMIN_EMAIL,
    adminPassword: process.env.INITIAL_ADMIN_PASSWORD,
    adminName: process.env.INITIAL_ADMIN_NAME,
  });
  if (demo) await seedDemo(pool);
  console.log('[seed] concluído');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await closePool();
}
