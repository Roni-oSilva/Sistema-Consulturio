export const WEEKDAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
export const WEEKDAYS_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Data local AAAA-MM-DD → Date (meio-dia, evita problemas de fuso). */
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(iso: string, n: number): string {
  const d = parseDate(iso);
  d.setDate(d.getDate() + n);
  return toIsoDate(d);
}

/** 1 = segunda ... 7 = domingo */
export function isoWeekday(iso: string): number {
  const wd = parseDate(iso).getDay();
  return wd === 0 ? 7 : wd;
}

export function fmtDateBR(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function fmtDateLong(iso: string) {
  const d = parseDate(iso);
  return `${WEEKDAYS[isoWeekday(iso) - 1].toLowerCase()}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}

export function fmtDayMonth(iso: string) {
  const d = parseDate(iso);
  return `${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}

/** Formata data/hora ISO no fuso informado (padrão: fuso da clínica). */
export function fmtDateTime(iso: string, tz = 'America/Belem') {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

export function fmtTimeTz(iso: string, tz = 'America/Belem') {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function isoDateTz(iso: string, tz = 'America/Belem') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return parts; // AAAA-MM-DD
}

export function todayTz(tz = 'America/Belem') {
  return isoDateTz(new Date().toISOString(), tz);
}

/** Máscara de telefone enquanto digita: (91) 98888-7777 */
export function maskPhone(v: string) {
  const d = v.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function maskCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

export function formatPhoneDigits(digits: string) {
  const d = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits;
}

export function money(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function waLink(phoneDigits: string | null | undefined, text: string) {
  const p = (phoneDigits ?? '').replace(/\D/g, '');
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

export function telLink(phone: string) {
  return `tel:+${phone.replace(/\D/g, '').replace(/^(?!55)/, '55')}`;
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
  NO_SHOW: 'Não compareceu',
};

export const CATEGORY_LABEL: Record<string, string> = {
  CONSULTA: 'Consultas',
  TERAPIA: 'Atendimentos',
  EXAME: 'Exames',
  OUTRO: 'Outros',
};

export function initials(name: string) {
  const parts = name.replace(/^(dr|dra|ft)\.?\s+/i, '').split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
