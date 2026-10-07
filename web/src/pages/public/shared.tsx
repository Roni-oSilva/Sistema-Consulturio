import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Alert, Loading } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { MONTHS, WEEKDAYS_SHORT, addDays, fmtDayMonth, initials, isoWeekday, parseDate } from '../../lib/format';
import { useAsync } from '../../lib/hooks';
import type { Slot } from '../../lib/types';

export function ProPhoto({ pro, size }: { pro: { name: string; photoUrl: string | null }; size?: number }) {
  const style = size ? { width: size, height: size * 1.1, fontSize: size / 2.6 } : undefined;
  if (pro.photoUrl) return <img className="pro-photo" src={pro.photoUrl} alt="" style={style} />;
  return (
    <span className="pro-photo" aria-hidden style={style}>
      {initials(pro.name)}
    </span>
  );
}

type DatesResponse = { month: string; today: string; maxDate: string; dates: { date: string; count: number }[] };

/**
 * Seletor de data + horário. Mostra apenas datas com horário livre
 * (o servidor já exclui feriados, folgas, férias, bloqueios e lotação).
 */
export function DateTimePicker({
  serviceId,
  professionalId,
  value,
  onPick,
}: {
  serviceId: string;
  professionalId: string | null;
  value: { date: string | null; start: string | null };
  onPick: (date: string, slot: Slot | null) => void;
}) {
  const [month, setMonth] = useState<string | null>(value.date ? value.date.slice(0, 7) : null);
  const [date, setDate] = useState<string | null>(value.date);
  const slotsRef = useRef<HTMLDivElement>(null);

  const dates = useAsync(
    async (signal) => {
      // primeiro mês com disponibilidade (a partir do mês atual)
      const now = new Date();
      let m = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      let res = await api.get<DatesResponse>(`/api/availability/dates${qs({ serviceId, professionalId, month: m })}`, { signal });
      if (!month) {
        for (let i = 0; i < 3 && res.dates.length === 0 && m < res.maxDate.slice(0, 7); i++) {
          m = nextMonth(m);
          res = await api.get<DatesResponse>(`/api/availability/dates${qs({ serviceId, professionalId, month: m })}`, { signal });
        }
      }
      return res;
    },
    [serviceId, professionalId, month],
  );

  const slots = useAsync(
    async (signal) => (date ? api.get<{ slots: Slot[]; dateLong: string }>(`/api/availability${qs({ serviceId, professionalId, date })}`, { signal }) : null),
    [serviceId, professionalId, date],
  );

  useEffect(() => {
    if (date && slots.data && slotsRef.current) {
      slotsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [date, slots.data]);

  const d = dates.data;
  const available = new Set(d?.dates.map((x) => x.date) ?? []);
  const current = month ?? d?.month;

  function chooseDate(iso: string) {
    setDate(iso);
    onPick(iso, null);
  }

  const morning = (slots.data?.slots ?? []).filter((s) => s.time < '12:00');
  const afternoon = (slots.data?.slots ?? []).filter((s) => s.time >= '12:00' && s.time < '18:00');
  const evening = (slots.data?.slots ?? []).filter((s) => s.time >= '18:00');

  return (
    <div>
      {d && d.dates.length > 0 && (
        <>
          <p style={{ margin: '0 0 8px', fontWeight: 600 }}>Datas mais próximas</p>
          <div className="quick-dates" role="group" aria-label="Datas mais próximas">
            {d.dates.slice(0, 6).map((x) => (
              <button key={x.date} type="button" className="quick-date" aria-pressed={date === x.date} onClick={() => chooseDate(x.date)}>
                <small>{WEEKDAYS_SHORT[isoWeekday(x.date) - 1]}</small>
                <b>{parseDate(x.date).getDate()}</b>
                <small>{MONTHS[parseDate(x.date).getMonth()].slice(0, 3)}</small>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="cal">
        <div className="cal-head">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Mês anterior"
            disabled={!d || !current || current <= d.today.slice(0, 7)}
            onClick={() => current && setMonth(prevMonth(current))}
          >
            <Icon name="chevronLeft" />
          </button>
          <h3 aria-live="polite">{current ? `${MONTHS[Number(current.slice(5)) - 1]} ${current.slice(0, 4)}` : ' '}</h3>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Próximo mês"
            disabled={!d || !current || current >= d.maxDate.slice(0, 7)}
            onClick={() => current && setMonth(nextMonth(current))}
          >
            <Icon name="chevronRight" />
          </button>
        </div>
        {dates.error ? (
          <Alert kind="error">{dates.error.message}</Alert>
        ) : !d || dates.loading ? (
          <div className="skeleton" style={{ height: 300 }} />
        ) : (
          <>
            <div className="cal-grid" role="group" aria-label="Calendário">
              {WEEKDAYS_SHORT.map((w) => (
                <div key={w} className="cal-dow" aria-hidden>
                  {w}
                </div>
              ))}
              {monthCells(current!).map((iso, i) =>
                iso ? (
                  <button
                    key={iso}
                    type="button"
                    className={`cal-day ${available.has(iso) ? 'available' : ''} ${date === iso ? 'selected' : ''} ${iso === d.today ? 'today' : ''}`}
                    disabled={!available.has(iso)}
                    aria-pressed={date === iso}
                    aria-label={`${fmtDayMonth(iso)}${available.has(iso) ? ', disponível' : ', indisponível'}`}
                    onClick={() => chooseDate(iso)}
                  >
                    {parseDate(iso).getDate()}
                  </button>
                ) : (
                  <span key={`e${i}`} />
                ),
              )}
            </div>
            <div className="cal-legend">
              <span>
                <i /> Com horários livres
              </span>
              <span>Datas riscadas: sem atendimento ou lotadas</span>
            </div>
            {d.dates.length === 0 && (
              <div style={{ marginTop: 12 }}>
                <Alert kind="info">Não há horários livres neste mês. Veja o próximo mês ou fale com a clínica.</Alert>
              </div>
            )}
          </>
        )}
      </div>

      {date && (
        <div className="slots-block" ref={slotsRef} aria-live="polite">
          <h3>Horários em {slots.data?.dateLong ?? fmtDayMonth(date)}</h3>
          {slots.loading ? (
            <Loading text="Buscando horários livres..." />
          ) : slots.error ? (
            <Alert kind="error">{slots.error.message}</Alert>
          ) : !slots.data?.slots.length ? (
            <Alert kind="warn">Os horários deste dia acabaram de ser preenchidos. Escolha outra data.</Alert>
          ) : (
            [
              { label: 'Manhã', icon: 'sunrise' as const, list: morning },
              { label: 'Tarde', icon: 'sun' as const, list: afternoon },
              { label: 'Noite', icon: 'moon' as const, list: evening },
            ]
              .filter((p) => p.list.length)
              .map((p) => (
                <div className="slot-period" key={p.label}>
                  <h4>
                    <Icon name={p.icon} size={16} /> {p.label}
                  </h4>
                  <div className="slots" role="group" aria-label={`Horários da ${p.label.toLowerCase()}`}>
                    {p.list.map((s) => (
                      <button
                        key={s.start}
                        type="button"
                        className="slot"
                        aria-pressed={value.start === s.start}
                        onClick={() => onPick(date, s)}
                      >
                        {s.time}
                      </button>
                    ))}
                  </div>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  );
}

function nextMonth(m: string) {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
}
function prevMonth(m: string) {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
}
/** Células do mês começando na segunda-feira. */
function monthCells(m: string): (string | null)[] {
  const first = `${m}-01`;
  const lead = isoWeekday(first) - 1;
  const cells: (string | null)[] = Array(lead).fill(null);
  let d = first;
  while (d.slice(0, 7) === m) {
    cells.push(d);
    d = addDays(d, 1);
  }
  return cells;
}
