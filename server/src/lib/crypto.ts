import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Hash do IP com segredo — permite detectar abuso sem armazenar o IP (LGPD). */
export function hashIp(ip: string): string {
  return createHmac('sha256', config().APP_SECRET).update(`ip:${ip}`).digest('hex').slice(0, 32);
}

// Alfabeto sem caracteres ambíguos (0/O, 1/I/L) — fácil de ditar por telefone.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Código do agendamento, ex.: "K7P2-Q9MX". */
export function appointmentCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function normalizeCode(input: string): string {
  const clean = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

/**
 * Token temporário assinado (HMAC) que dá acesso a UM agendamento.
 * Emitido após a consulta por telefone/e-mail + código.
 */
export function signAccessToken(appointmentId: string, ttlSeconds = 2 * 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${appointmentId}.${exp}`;
  const sig = createHmac('sha256', config().APP_SECRET).update(`appt:${payload}`).digest('base64url');
  return `s.${exp}.${sig}`;
}

export function verifySignedAccessToken(appointmentId: string, token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 's') return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac('sha256', config().APP_SECRET).update(`appt:${appointmentId}.${exp}`).digest('base64url');
  return safeEqual(expected, parts[2]);
}
