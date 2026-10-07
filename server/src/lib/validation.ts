import { z } from 'zod';
import { badRequest } from './errors.js';

/** Remove caracteres de controle e espaços extras. */
export function cleanText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').trim();
}

export const text = (max: number) => z.string().max(max * 2).transform(cleanText).pipe(z.string().max(max));
export const requiredText = (min: number, max: number, msg?: string) =>
  z
    .string({ error: msg })
    .max(max * 2)
    .transform(cleanText)
    .pipe(z.string().min(min, msg ?? `Mínimo de ${min} caracteres.`).max(max, `Máximo de ${max} caracteres.`));

export const uuid = z.string().uuid('Identificador inválido.');
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD).');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido (use HH:MM).');

/** Telefone brasileiro → somente dígitos com DDI 55. Retorna null se inválido. */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 12 || d.length === 13) {
    if (!d.startsWith('55')) return null;
    d = d.slice(2);
  }
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  if (d.length === 11 && d[2] !== '9') return null; // celular deve começar com 9
  return `55${d}`;
}

export function formatPhone(digits: string): string {
  const d = digits.startsWith('55') ? digits.slice(2) : digits;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits;
}

/** Máscara para exibição parcial (ex.: confirmações): (91) 9****-1234 */
export function maskPhone(digits: string): string {
  const d = digits.startsWith('55') ? digits.slice(2) : digits;
  if (d.length < 10) return '****';
  return `(${d.slice(0, 2)}) ${d[2]}****-${d.slice(-4)}`;
}

export function isValidCpf(input: string): boolean {
  const cpf = input.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

export function normalizeNameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const phoneSchema = z
  .string({ error: 'Informe o telefone.' })
  .max(30)
  .transform((v, ctx) => {
    const p = normalizePhone(v);
    if (!p) {
      ctx.addIssue({ code: 'custom', message: 'Telefone inválido. Use DDD + número, ex.: (91) 98888-7777.' });
      return z.NEVER;
    }
    return p;
  });

export const emailSchema = z
  .string()
  .max(254)
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.string().email('E-mail inválido.'));

/** Valida com zod e lança 400 com mensagens por campo. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    const first = Object.values(fields)[0] ?? 'Dados inválidos.';
    throw badRequest(first, 'VALIDATION_ERROR', { fields });
  }
  return r.data;
}
