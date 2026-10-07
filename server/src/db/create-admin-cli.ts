import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { getPool, closePool } from './pool.js';
import { hashPassword, passwordProblems } from '../auth/password.js';
import { isRole } from './seed.js';

// Cria (ou redefine a senha de) um usuário administrativo pelo terminal.
// Uso: npm run create-admin -- email@clinica.com SUPER_ADMIN "Nome"
const [email, role = 'SUPER_ADMIN', name = 'Administrador'] = process.argv.slice(2);
if (!email || !isRole(role)) {
  console.error('Uso: npm run create-admin -- <email> [SUPER_ADMIN|ADMIN|RECEPTION|PROFESSIONAL] [nome]');
  process.exit(1);
}
const rl = createInterface({ input: stdin, output: stdout });
const password = process.env.ADMIN_PASSWORD || (await rl.question('Senha (mín. 10 caracteres, letras e números): '));
rl.close();
const problem = passwordProblems(password);
if (problem) {
  console.error(problem);
  process.exit(1);
}
try {
  const hash = await hashPassword(password);
  await getPool().query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, lower($2), $3, $4)
     ON CONFLICT ((lower(email))) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
       active = true, must_change_password = false, password_changed_at = now(), updated_at = now()`,
    [name, email, hash, role],
  );
  await getPool().query('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE lower(email) = lower($1))', [email]);
  console.log(`Usuário ${email} (${role}) salvo.`);
} finally {
  await closePool();
}
