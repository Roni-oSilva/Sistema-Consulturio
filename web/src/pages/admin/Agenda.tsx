import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { EmptyState, ErrorState, Loading, StatusBadge } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { MONTHS, WEEKDAYS_SHORT, addDays, fmtDateBR, fmtDateLong, isoDateTz, isoWeekday, parseDate, todayTz } from '../../lib/format';
import { useAsync, useTitle } from '../../lib/hooks';
import { useAppointments } from './AppointmentPanel';
import { useAdmin, useCatalog } from './context';
import { BLOCK_REASON, type AdminAppointment, type AdminProfessional } from './types';

type View = 'dia' | 'semana' | 'mes' | 'lista';
type Block = { id: string; professionalId: string | null; professionalName: string | null; start: string; end: string; reasonType: string; description: string };

const PX_PER_MIN = 1.15;

function startOfWeek(iso: string) {
  return addDays(iso, -(isoWeekday(iso) - 1));
}
function minutesOf(time: string) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}
function hhmm(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function Agenda() {
  useTitle('Agenda');
  const { timezone, can, me } = useAdmin();
  const { professionals } = useCatalog();
  const { open, openNew, version } = useAppointments();
  const [params, setParams] = useSearchParams();
  const today = todayTz(timezone);
  const view = (params.get('visao') as View) || (window.innerWidth < 720 ? 'lista' : 'dia');
  const date = params.get('data') || today;
  const profFilter = me.role === 'PROFESSIONAL' ? (me.professionalId ?? '') : params.get('prof') || '';
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    if (params.get('novo') === '1') {
      openNew({ date });
      const next = new URLSearchParams(params);
      next.delete('novo');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const range = useMemo(() => {
    if (view === 'semana') {
      const s = startOfWeek(date);
      return { from: s, to: addDays(s, 6) };
    }
    if (view === 'mes') {
      const first = `${date.slice(0, 7)}-01`;
      const s = startOfWeek(first);
      const lastDay = addDays(nextMonthFirst(first), -1);
      const e = addDays(startOfWeek(lastDay), 6);
      return { from: s, to: e };
    }
    return { from: date, to: date };
  }, [view, date]);

  const q = useAsync(
    async (signal) => {
      const [a, b] = await Promise.all([
        api.get<{ appointments: AdminAppointment[] }>(
          `/api/admin/appointments${qs({ from: range.from, to: range.to, professionalId: profFilter || null, q: debounced || null })}`,
          { signal },
        ),
        api.get<{ blocks: Block[] }>(`/api/admin/block-times${qs({ from: range.from, to: range.to })}`, { signal }),
      ]);
      return { appointments: a.appointments, blocks: b.blocks };
    },
    [range.from, range.to, profFilter, debounced, version],
  );

  function set(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  }

  function shift(dir: 1 | -1) {
    if (view === 'semana') set({ data: addDays(date, 7 * dir) });
    else if (view === 'mes') {
      const d = parseDate(date);
      d.setDate(1);
      d.setMonth(d.getMonth() + dir);
      set({ data: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` });
    } else set({ data: addDays(date, dir) });
  }

  const title =
    view === 'semana'
      ? `${fmtDateBR(range.from).slice(0, 5)} – ${fmtDateBR(range.to)}`
      : view === 'mes'
        ? `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`
        : fmtDateLong(date);
  const titleCap = title.charAt(0).toUpperCase() + title.slice(1);

  const activePros = professionals.filter((p) => p.active);
  const appts = q.data?.appointments ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Agenda</h1>
        </div>
        <div className="page-actions">
          {can('appointments:write') && (
            <button className="btn btn-primary" onClick={() => openNew({ date, professionalId: profFilter || undefined })}>
              <Icon name="plus" size={18} /> Novo agendamento
            </button>
          )}
        </div>
      </div>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Visualização">
          {(
            [
              ['dia', 'Dia'],
              ['semana', 'Semana'],
              ['mes', 'Mês'],
              ['lista', 'Lista'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} aria-pressed={view === v} onClick={() => set({ visao: v })}>
              {label}
            </button>
          ))}
        </div>
        <div className="agenda-nav">
          <button className="btn btn-outline btn-sm btn-icon" onClick={() => shift(-1)} aria-label="Anterior">
            <Icon name="chevronLeft" size={18} />
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => set({ data: today })}>
            Hoje
          </button>
          <button className="btn btn-outline btn-sm btn-icon" onClick={() => shift(1)} aria-label="Próximo">
            <Icon name="chevronRight" size={18} />
          </button>
          <h2>{titleCap}</h2>
        </div>
        <span style={{ flex: 1 }} />
        <input type="date" className="input" value={date} onChange={(e) => e.target.value && set({ data: e.target.value })} aria-label="Ir para data" style={{ width: 160 }} />
        {me.role !== 'PROFESSIONAL' && (
          <select className="select" value={profFilter} onChange={(e) => set({ prof: e.target.value })} aria-label="Profissional" style={{ width: 210 }}>
            <option value="">Todos os profissionais</option>
            {activePros.map((p) => (
              <option key={p.id} value={p.id}>
                {[p.title, p.name].filter(Boolean).join(' ')}
              </option>
            ))}
          </select>
        )}
        <input
          className="input"
          type="search"
          placeholder="Buscar paciente, telefone ou código"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar agendamento"
          style={{ width: 260 }}
        />
      </div>

      <div className="panel" style={{ overflow: 'hidden' }}>
        {q.error ? (
          <div className="panel-body">
            <ErrorState error={q.error} onRetry={q.reload} />
          </div>
        ) : q.loading && !q.data ? (
          <Loading />
        ) : debounced ? (
          <ListView appts={appts} onOpen={open} grouped />
        ) : view === 'lista' ? (
          <ListView appts={appts} onOpen={open} />
        ) : view === 'mes' ? (
          <MonthView from={range.from} to={range.to} month={date.slice(0, 7)} today={today} appts={appts} onPickDay={(d) => set({ visao: 'dia', data: d })} />
        ) : (
          <TimelineView
            view={view}
            date={date}
            from={range.from}
            today={today}
            timezone={timezone}
            appts={appts}
            blocks={q.data?.blocks ?? []}
            professionals={profFilter ? activePros.filter((p) => p.id === profFilter) : activePros}
            canCreate={can('appointments:write')}
            onOpen={open}
            onCreate={(d, time, professionalId) => openNew({ date: d, time, professionalId })}
          />
        )}
      </div>
      <p className="muted" style={{ fontSize: '0.82rem', marginTop: 10 }}>
        Dica: clique em um espaço vazio da agenda para agendar naquele horário. Áreas listradas = fora do expediente; vermelhas = bloqueadas.
      </p>
    </>
  );
}

function nextMonthFirst(first: string) {
  const [y, m] = first.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

function ListView({ appts, onOpen, grouped }: { appts: AdminAppointment[]; onOpen: (id: string) => void; grouped?: boolean }) {
  if (!appts.length) return <EmptyState title={grouped ? 'Nenhum resultado' : 'Nenhum agendamento neste período'} />;
  const byDate = new Map<string, AdminAppointment[]>();
  for (const a of appts) byDate.set(a.date, [...(byDate.get(a.date) ?? []), a]);
  return (
    <div>
      {[...byDate.entries()].map(([d, list]) => (
        <div key={d}>
          <div className="tl-head" style={{ position: 'static' }}>
            {fmtDateLong(d).charAt(0).toUpperCase() + fmtDateLong(d).slice(1)} · {fmtDateBR(d)}
          </div>
          <ul className="appt-list">
            {list.map((a) => (
              <li
                key={a.id}
                className={`appt-item ${a.status}`}
                tabIndex={0}
                role="button"
                onClick={() => onOpen(a.id)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(a.id)}
              >
                <span className="appt-time">
                  {a.time}
                  <small>{a.endTime}</small>
                </span>
                <span className="appt-who">
                  <strong>{a.patient.name}</strong>
                  <span>
                    <i className="dot" style={{ background: a.professional.color }} />
                    {a.service.name} · {a.professional.name} · {a.patient.phone}
                  </span>
                </span>
                <StatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MonthView({
  from,
  to,
  month,
  today,
  appts,
  onPickDay,
}: {
  from: string;
  to: string;
  month: string;
  today: string;
  appts: AdminAppointment[];
  onPickDay: (d: string) => void;
}) {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const byDate = new Map<string, AdminAppointment[]>();
  for (const a of appts) if (a.status !== 'CANCELLED') byDate.set(a.date, [...(byDate.get(a.date) ?? []), a]);
  return (
    <div className="month-grid">
      {WEEKDAYS_SHORT.map((w) => (
        <div key={w} className="month-dow">
          {w}
        </div>
      ))}
      {days.map((d) => {
        const list = byDate.get(d) ?? [];
        return (
          <button
            key={d}
            className={`month-cell ${d.slice(0, 7) !== month ? 'out' : ''} ${d === today ? 'today' : ''}`}
            onClick={() => onPickDay(d)}
            aria-label={`${fmtDateBR(d)}: ${list.length} agendamento(s)`}
          >
            <span className="num">{parseDate(d).getDate()}</span>
            {list.slice(0, 3).map((a) => (
              <span key={a.id} className="month-chip" style={{ ['--c' as string]: a.professional.color }}>
                {a.time} {a.patient.name.split(' ')[0]}
              </span>
            ))}
            {list.length > 3 && <span className="month-more">+{list.length - 3} mais</span>}
            {list.length > 0 && (
              <span className="month-more" style={{ marginTop: 'auto' }}>
                {list.length} agend.
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

type Column = { key: string; label: string; date: string; pro: AdminProfessional | null; isToday: boolean };

function TimelineView({
  view,
  date,
  from,
  today,
  timezone,
  appts,
  blocks,
  professionals,
  canCreate,
  onOpen,
  onCreate,
}: {
  view: 'dia' | 'semana';
  date: string;
  from: string;
  today: string;
  timezone: string;
  appts: AdminAppointment[];
  blocks: Block[];
  professionals: AdminProfessional[];
  canCreate: boolean;
  onOpen: (id: string) => void;
  onCreate: (date: string, time: string, professionalId?: string) => void;
}) {
  const singlePro = professionals.length === 1 ? professionals[0] : null;
  let columns: Column[];
  if (view === 'semana') {
    columns = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(from, i);
      return { key: d, label: `${WEEKDAYS_SHORT[i]} ${fmtDateBR(d).slice(0, 5)}`, date: d, pro: singlePro, isToday: d === today };
    });
  } else {
    const wd = isoWeekday(date);
    const withActivity = professionals.filter(
      (p) => p.schedules.some((s) => s.weekday === wd) || p.overrides.some((o) => o.date === date) || appts.some((a) => a.professional.id === p.id),
    );
    columns = (withActivity.length ? withActivity : professionals).map((p) => ({
      key: p.id,
      label: [p.title, p.name].filter(Boolean).join(' '),
      date,
      pro: p,
      isToday: date === today,
    }));
  }

  // faixa de horas exibida
  let minStart = 7 * 60;
  let maxEnd = 19 * 60;
  for (const p of professionals)
    for (const s of p.schedules) {
      minStart = Math.min(minStart, minutesOf(s.start));
      maxEnd = Math.max(maxEnd, minutesOf(s.end));
    }
  for (const a of appts) {
    minStart = Math.min(minStart, minutesOf(a.time));
    maxEnd = Math.max(maxEnd, minutesOf(a.endTime) || 24 * 60);
  }
  minStart = Math.floor(minStart / 60) * 60;
  maxEnd = Math.min(24 * 60, Math.ceil(maxEnd / 60) * 60);
  const height = (maxEnd - minStart) * PX_PER_MIN;
  const hours: number[] = [];
  for (let m = minStart; m <= maxEnd; m += 60) hours.push(m);

  const nowMin = (() => {
    const t = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    return minutesOf(t);
  })();

  function columnAppts(c: Column) {
    return appts.filter((a) => a.date === c.date && (!c.pro || a.professional.id === c.pro.id));
  }

  /** Distribui eventos sobrepostos lado a lado. */
  function lanes(list: AdminAppointment[]) {
    const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
    const laneEnds: string[] = [];
    const placed = sorted.map((a) => {
      let lane = laneEnds.findIndex((end) => end <= a.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(a.end);
      } else laneEnds[lane] = a.end;
      return { a, lane };
    });
    return { placed, count: Math.max(1, laneEnds.length) };
  }

  function workingFor(c: Column): { start: number; end: number }[] {
    if (!c.pro) return [{ start: minStart, end: maxEnd }];
    const ov = c.pro.overrides.filter((o) => o.date === c.date);
    if (ov.length) return ov.filter((o) => o.start && o.end).map((o) => ({ start: minutesOf(o.start!), end: minutesOf(o.end!) }));
    const wd = isoWeekday(c.date);
    return c.pro.schedules.filter((s) => s.weekday === wd).map((s) => ({ start: minutesOf(s.start), end: minutesOf(s.end) }));
  }

  function offRanges(c: Column) {
    const work = workingFor(c).sort((a, b) => a.start - b.start);
    const off: { start: number; end: number }[] = [];
    let cur = minStart;
    for (const w of work) {
      if (w.start > cur) off.push({ start: cur, end: w.start });
      cur = Math.max(cur, w.end);
    }
    if (cur < maxEnd) off.push({ start: cur, end: maxEnd });
    return off;
  }

  function blockRanges(c: Column) {
    return blocks
      .filter((b) => !b.professionalId || !c.pro || b.professionalId === c.pro.id)
      .map((b) => {
        const sDate = isoDateTz(b.start, timezone);
        const eDate = isoDateTz(b.end, timezone);
        if (eDate < c.date || sDate > c.date) return null;
        const fmt = (iso: string) =>
          minutesOf(new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));
        const s = sDate < c.date ? minStart : fmt(b.start);
        const e = eDate > c.date ? maxEnd : fmt(b.end) || maxEnd;
        if (e <= s) return null;
        return { id: b.id, start: Math.max(s, minStart), end: Math.min(e, maxEnd), label: `${BLOCK_REASON[b.reasonType] ?? 'Bloqueado'}${b.description ? ` — ${b.description}` : ''}` };
      })
      .filter(Boolean) as { id: string; start: number; end: number; label: string }[];
  }

  if (!columns.length) return <EmptyState title="Nenhum profissional ativo">Cadastre profissionais para ver a agenda.</EmptyState>;

  return (
    <div className="timeline" style={{ gridTemplateColumns: `52px repeat(${columns.length}, minmax(${view === 'semana' ? 110 : 150}px, 1fr))` }}>
      <div className="tl-head" />
      {columns.map((c) => (
        <div key={c.key} className={`tl-head ${c.isToday ? 'today' : ''}`} title={c.label}>
          {c.pro && view === 'dia' && <i className="dot" style={{ background: c.pro.color }} />}
          {c.label}
        </div>
      ))}
      <div className="tl-hours" style={{ height }}>
        {hours.map((m) => (
          <span key={m} className="tl-hour" style={{ top: (m - minStart) * PX_PER_MIN }}>
            {m > minStart && m < maxEnd ? hhmm(m) : ''}
          </span>
        ))}
      </div>
      {columns.map((c) => {
        const { placed, count } = lanes(columnAppts(c));
        const slots: number[] = [];
        for (let m = minStart; m < maxEnd; m += 30) slots.push(m);
        return (
          <div key={c.key} className="tl-col" style={{ height, backgroundSize: `100% ${60 * PX_PER_MIN}px` }}>
            {offRanges(c).map((r, i) => (
              <div key={`off${i}`} className="tl-off" style={{ top: (r.start - minStart) * PX_PER_MIN, height: (r.end - r.start) * PX_PER_MIN }} />
            ))}
            {canCreate &&
              slots.map((m) => (
                <button
                  key={m}
                  className="tl-slot-btn"
                  style={{ top: (m - minStart) * PX_PER_MIN, height: 30 * PX_PER_MIN }}
                  aria-label={`Agendar ${hhmm(m)} ${c.label}`}
                  tabIndex={-1}
                  onClick={() => onCreate(c.date, hhmm(m), c.pro?.id)}
                />
              ))}
            {blockRanges(c).map((b) => (
              <div key={b.id} className="tl-block" style={{ top: (b.start - minStart) * PX_PER_MIN, height: (b.end - b.start) * PX_PER_MIN }}>
                {b.label}
              </div>
            ))}
            {placed.map(({ a, lane }) => {
              const top = (minutesOf(a.time) - minStart) * PX_PER_MIN;
              const h = Math.max(22, (minutesOf(a.endTime) - minutesOf(a.time)) * PX_PER_MIN - 2);
              return (
                <button
                  key={a.id}
                  className={`tl-event ${a.status}`}
                  style={{
                    top,
                    height: h,
                    left: `calc(${(lane / count) * 100}% + 3px)`,
                    width: `calc(${100 / count}% - 6px)`,
                    right: 'auto',
                    ['--c' as string]: a.professional.color,
                  }}
                  onClick={() => onOpen(a.id)}
                  title={`${a.time} ${a.patient.name} — ${a.service.name}`}
                >
                  <strong>
                    {a.time} {a.patient.name}
                  </strong>
                  {h > 34 && <span>{view === 'semana' && !c.pro ? a.professional.name : a.service.name}</span>}
                </button>
              );
            })}
            {c.isToday && nowMin >= minStart && nowMin <= maxEnd && <div className="tl-now" style={{ top: (nowMin - minStart) * PX_PER_MIN }} />}
          </div>
        );
      })}
    </div>
  );
}
