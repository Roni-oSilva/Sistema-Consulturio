import pg from 'pg';

/** Recria o banco de testes do zero antes da suíte. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://clinica:clinica_dev@localhost:5432/clinica_test';
  // proteção: nunca apagar um banco que não seja claramente de teste
  const dbName = new URL(url).pathname.slice(1);
  if (!/test|e2e/i.test(dbName)) throw new Error(`Recusado: o banco "${dbName}" não parece ser de teste.`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.end();
}
