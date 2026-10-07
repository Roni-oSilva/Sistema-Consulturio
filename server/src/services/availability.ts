import { DateTime } from 'luxon';
import type { Queryable } from '../db/pool.js';
import type { ClinicSettings } from './settings.js';

/**
 * Motor de disponibilidade.
 *
 * O servidor é a autoridade final: o mesmo cálculo usado para mostrar os
 * horários ao paciente é refeito DENTRO da transação de agendamento.
 *
 * Um horário só é oferecido se:
 *  - a data não é passada e respeita a antecedência mínima/máxima;
 *  - não é feriado;
 *  - está dentro do expediente do profissional (grade semanal ou horário
 *    especial daquele dia);
 *  - não colide com bloqueios (férias, folgas, reuniões, manutenção...) do
 *    profissional ou da clínica inteira;
 *  - não colide com outro agendamento ativo do profissional.
 */

type Range = { start: number; end: number }; // epoch ms

export type AvailabilityContext = {
  tz: string;
  nowMs: number;
  earliestMs: number;
  latestDate: string; // último dia (inclusive) aberto para agendamento
  holidays: { date: string; recurring: boolean }[];
  clinicBlocks: Range[];
  profBlocks: Map<string, Range[]>;
  busy: Map<string, Range[]>;
  weekly: Map<string, { weekday: number; start: string; end: string }[]>;
  overrides: Map<string, Map<string, { start: string | null; end: string | null }[]>>;
};

export type LoadOptions = {
  ignoreRules?: boolean; // encaixe administrativo: ignora antecedência mínima/máxima
  excludeAppointmentId?: string; // remarcação: o próprio agendamento não conta como ocupado
};

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export async function loadContext(
  db: Queryable,
  settings: Pick<ClinicSettings, 'timezone' | 'min_advance_minutes' | 'max_advance_days'>,
  professionalIds: string[],
  fromDate: string,
  toDate: string,
  opts: LoadOptions = {},
): Promise<AvailabilityContext> {
  const tz = settings.timezone;
  const rangeStart = DateTime.fromISO(fromDate, { zone: tz }).startOf('day').minus({ days: 1 });
  const rangeEnd = DateTime.fromISO(toDate, { zone: tz }).endOf('day').plus({ days: 1 });
  const now = DateTime.now().setZone(tz);

  // consultas em sequência: podem rodar dentro de uma transação (mesma conexão)
  const holidays = await db.query<{ date: string; recurring: boolean }>('SELECT date, recurring FROM holidays');
  const blocks = await db.query<{ professional_id: string | null; start_at: Date; end_at: Date }>(
    `SELECT professional_id, start_at, end_at FROM blocked_times
      WHERE (professional_id IS NULL OR professional_id = ANY($1))
        AND tstzrange(start_at, end_at, '[)') && tstzrange($2, $3, '[)')`,
    [professionalIds, rangeStart.toJSDate(), rangeEnd.toJSDate()],
  );
  const appts = await db.query<{ professional_id: string; start_at: Date; end_at: Date }>(
    `SELECT professional_id, start_at, end_at FROM appointments
      WHERE professional_id = ANY($1) AND status <> 'CANCELLED'
        AND start_at < $3 AND end_at > $2
        AND ($4::uuid IS NULL OR id <> $4::uuid)`,
    [professionalIds, rangeStart.toJSDate(), rangeEnd.toJSDate(), opts.excludeAppointmentId ?? null],
  );
  const weekly = await db.query<{ professional_id: string; weekday: number; start_time: string; end_time: string }>(
    'SELECT professional_id, weekday, start_time, end_time FROM schedules WHERE professional_id = ANY($1)',
    [professionalIds],
  );
  const overrides = await db.query<{ professional_id: string; date: string; start_time: string | null; end_time: string | null }>(
    `SELECT professional_id, date, start_time, end_time FROM schedule_overrides
      WHERE professional_id = ANY($1) AND date BETWEEN $2 AND $3`,
    [professionalIds, fromDate, toDate],
  );

  const ctx: AvailabilityContext = {
    tz,
    nowMs: now.toMillis(),
    earliestMs: opts.ignoreRules ? -Infinity : now.plus({ minutes: settings.min_advance_minutes }).toMillis(),
    latestDate: opts.ignoreRules ? '9999-12-31' : now.plus({ days: settings.max_advance_days }).toISODate()!,
    holidays: holidays.rows,
    clinicBlocks: [],
    profBlocks: new Map(),
    busy: new Map(),
    weekly: new Map(),
    overrides: new Map(),
  };
  for (const b of blocks.rows) {
    const r = { start: b.start_at.getTime(), end: b.end_at.getTime() };
    if (b.professional_id) push(ctx.profBlocks, b.professional_id, r);
    else ctx.clinicBlocks.push(r);
  }
  for (const a of appts.rows) push(ctx.busy, a.professional_id, { start: a.start_at.getTime(), end: a.end_at.getTime() });
  for (const w of weekly.rows) push(ctx.weekly, w.professional_id, { weekday: w.weekday, start: w.start_time, end: w.end_time });
  for (const o of overrides.rows) {
    let byDate = ctx.overrides.get(o.professional_id);
    if (!byDate) ctx.overrides.set(o.professional_id, (byDate = new Map()));
    push(byDate, o.date, { start: o.start_time, end: o.end_time });
  }
  return ctx;
}

export function isHoliday(ctx: AvailabilityContext, date: string): boolean {
  const md = date.slice(5);
  return ctx.holidays.some((h) => (h.recurring ? h.date.slice(5) === md : h.date === date));
}

const overlaps = (a: Range, b: Range) => a.start < b.end && b.start < a.end;

/** Expediente do profissional naquela data (horário especial tem prioridade). */
export function workingIntervals(ctx: AvailabilityContext, professionalId: string, date: string) {
  const special = ctx.overrides.get(professionalId)?.get(date);
  if (special && special.length) {
    return special.filter((s) => s.start && s.end).map((s) => ({ start: s.start!, end: s.end! }));
  }
  const weekday = DateTime.fromISO(date, { zone: ctx.tz }).weekday;
  return (ctx.weekly.get(professionalId) ?? []).filter((w) => w.weekday === weekday);
}

export type Slot = { start: DateTime; end: DateTime };

/** Horários livres de um profissional em uma data (no fuso da clínica). */
export function slotsForDay(
  ctx: AvailabilityContext,
  professionalId: string,
  date: string,
  durationMinutes: number,
  opts: { ignoreSchedule?: boolean } = {},
): Slot[] {
  if (date > ctx.latestDate) return [];
  if (!opts.ignoreSchedule && isHoliday(ctx, date)) return [];
  const intervals = workingIntervals(ctx, professionalId, date).sort((a, b) => a.start.localeCompare(b.start));
  const blocks = [...ctx.clinicBlocks, ...(ctx.profBlocks.get(professionalId) ?? [])];
  const busy = ctx.busy.get(professionalId) ?? [];
  const out: Slot[] = [];
  const seen = new Set<number>();
  for (const iv of intervals) {
    const ivStart = DateTime.fromISO(`${date}T${iv.start}`, { zone: ctx.tz });
    const ivEnd = DateTime.fromISO(`${date}T${iv.end}`, { zone: ctx.tz });
    for (let t = ivStart; t.plus({ minutes: durationMinutes }) <= ivEnd; t = t.plus({ minutes: durationMinutes })) {
      const r = { start: t.toMillis(), end: t.plus({ minutes: durationMinutes }).toMillis() };
      if (r.start < ctx.earliestMs || seen.has(r.start)) continue;
      if (blocks.some((b) => overlaps(r, b))) continue;
      if (busy.some((b) => overlaps(r, b))) continue;
      seen.add(r.start);
      out.push({ start: t, end: t.plus({ minutes: durationMinutes }) });
    }
  }
  return out;
}

/**
 * Verifica um horário específico para o profissional. Usado na criação e
 * remarcação (dentro da transação). Em "encaixe" (admin), ignora o
 * expediente/bloqueios mas NUNCA permite sobreposição de agendamentos.
 */
export function checkSlot(
  ctx: AvailabilityContext,
  professionalId: string,
  start: DateTime,
  durationMinutes: number,
  opts: { ignoreSchedule?: boolean } = {},
): { ok: true } | { ok: false; reason: 'PAST' | 'OUT_OF_RANGE' | 'UNAVAILABLE' | 'BUSY' } {
  const r = { start: start.toMillis(), end: start.plus({ minutes: durationMinutes }).toMillis() };
  const busy = ctx.busy.get(professionalId) ?? [];
  if (busy.some((b) => overlaps(r, b))) return { ok: false, reason: 'BUSY' };
  if (opts.ignoreSchedule) return { ok: true };
  if (r.start < ctx.nowMs) return { ok: false, reason: 'PAST' };
  if (r.start < ctx.earliestMs) return { ok: false, reason: 'OUT_OF_RANGE' };
  const date = start.setZone(ctx.tz).toISODate()!;
  if (date > ctx.latestDate) return { ok: false, reason: 'OUT_OF_RANGE' };
  const slots = slotsForDay(ctx, professionalId, date, durationMinutes);
  return slots.some((s) => s.start.toMillis() === r.start) ? { ok: true } : { ok: false, reason: 'UNAVAILABLE' };
}

export function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(from);
  const end = DateTime.fromISO(to);
  while (d <= end) {
    out.push(d.toISODate()!);
    d = d.plus({ days: 1 });
  }
  return out;
}
