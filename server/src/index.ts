import { buildApp } from './app.js';
import { config } from './config.js';
import { closePool, getPool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { syncRoles, seedTemplates } from './db/seed.js';
import { startScheduler } from './jobs/scheduler.js';

const c = config();
const app = await buildApp();

// Mantém o banco atualizado a cada inicialização (migrações são idempotentes).
await migrate(getPool(), (m) => app.log.info(m));
await syncRoles(getPool());
await seedTemplates(getPool()); // adiciona modelos novos sem sobrescrever os editados

const stopScheduler = c.DISABLE_JOBS ? () => {} : startScheduler(app.log);

await app.listen({ port: c.PORT, host: c.HOST });
app.log.info(`Sistema de agendamento no ar: ${c.PUBLIC_URL}`);

async function shutdown(signal: string) {
  app.log.info(`${signal} recebido, encerrando...`);
  stopScheduler();
  await app.close();
  await closePool();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
