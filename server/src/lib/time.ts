import { DateTime } from 'luxon';

const WEEKDAYS = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function toZone(d: Date | string, tz: string): DateTime {
  const dt = typeof d === 'string' ? DateTime.fromISO(d) : DateTime.fromJSDate(d);
  return dt.setZone(tz);
}

export function fmtDate(d: Date | string, tz: string) {
  return toZone(d, tz).toFormat('dd/LL/yyyy');
}

export function fmtTime(d: Date | string, tz: string) {
  return toZone(d, tz).toFormat('HH:mm');
}

export function weekdayName(d: Date | string, tz: string) {
  return WEEKDAYS[toZone(d, tz).weekday - 1];
}

export function longDate(d: Date | string, tz: string) {
  const z = toZone(d, tz);
  return `${z.day} de ${MONTHS[z.month - 1]} de ${z.year}`;
}

/** Converte data local (AAAA-MM-DD) + hora (HH:mm) no fuso da clínica para DateTime. */
export function localDateTime(date: string, time: string, tz: string): DateTime {
  return DateTime.fromISO(`${date}T${time}`, { zone: tz });
}

export function todayIn(tz: string): string {
  return DateTime.now().setZone(tz).toISODate()!;
}
