import { hash, verify } from '@node-rs/argon2';

// Argon2id com parâmetros recomendados pela OWASP (m=19 MiB, t=2, p=1).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

// Hash fixo usado quando o usuário não existe, para que o tempo de resposta
// seja equivalente e não permita descobrir e-mails válidos (enumeration).
let dummyHash: string | null = null;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string | null, password: string): Promise<boolean> {
  if (!passwordHash) {
    dummyHash ??= await hash('senha-inexistente-para-tempo-constante', OPTIONS);
    await verify(dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Política de senha: mínimo 10 caracteres, com letras e números. */
export function passwordProblems(password: string): string | null {
  if (password.length < 10) return 'A senha deve ter pelo menos 10 caracteres.';
  if (password.length > 128) return 'A senha deve ter no máximo 128 caracteres.';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return 'A senha deve conter letras e números.';
  const common = ['1234567890', 'senha12345', 'password123', 'admin12345', 'qwerty1234'];
  if (common.includes(password.toLowerCase())) return 'Senha muito comum. Escolha outra.';
  return null;
}
