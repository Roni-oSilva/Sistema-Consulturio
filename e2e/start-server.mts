/**
 * Sobe o servidor para os testes de ponta a ponta com um banco limpo
 * (clinica_e2e), dados base + profissionais de demonstração.
 */
import pg from 'pg';

const url = process.env.DATABASE_URL!;
// proteção: nunca apagar um banco que não seja claramente de teste
const dbName = new URL(url).pathname.slice(1);
if (!/test|e2e/i.test(dbName)) throw new Error(`Recusado: o banco "${dbName}" não parece ser de teste.`);
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('DROP SCHEMA IF EXISTS public CASCADE');
await client.query('CREATE SCHEMA public');
await client.end();

const { getPool } = await import('../server/src/db/pool.js');
const { migrate } = await import('../server/src/db/migrate.js');
const { seedBase, seedDemo } = await import('../server/src/db/seed.js');
await migrate(getPool(), () => {});
await seedBase(getPool(), { adminEmail: 'admin@jrsaude.com.br', adminPassword: 'Admin-E2E-2026', log: () => {} });
await seedDemo(getPool(), () => {});
await getPool().query(
  `UPDATE clinic_settings SET address = 'Av. Exemplo, 1000 — Centro', phone = '(91) 3000-0000', whatsapp = '5591990000000', min_advance_minutes = 0`,
);
await import('../server/src/index.js');
