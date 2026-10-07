import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Alert, ConfirmDialog, EmptyState, Field, Loading, Spinner, useToast } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { fmtDateBR, fmtDateTime, todayTz } from '../../lib/format';
import { useAsync, useTitle } from '../../lib/hooks';
import { useAppointments } from './AppointmentPanel';
import { useAdmin, useCatalog } from './context';
import { BLOCK_REASON } from './types';

type Block = {
  id: string;
  professionalId: string | null;
  professionalName: string | null;
  professionalTitle: string | null;
  start: string;
  end: string;
  reasonType: string;
  description: string;
  createdBy: string | null;
};
type Holiday = { id: string; date: string; name: string; recurring: boolean };

export function Blocks() {
  useTitle('Bloqueios e feriados');
  const { timezone, can } = useAdmin();
  const { professionals } = useCatalog();
  const { bump } = useAppointments();
  const toast = useToast();
  const [params] = useSearchParams();
  const today = todayTz(timezone);

  const [professionalId, setProfessionalId] = useState(params.get('prof') ?? '');
  const [reasonType, setReasonType] = useState('MEETING');
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [startTime, setStartTime] = useState('14:00');
  const [endTime, setEndTime] = useState('16:00');
  const [description, setDescription] = useState('');
  const [cancelAppointments, setCancelAppointments] = useState(false);
  const [affected, setAffected] = useState<{ id: string; code: string; patientName: string; start: string; serviceName: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [del, setDel] = useState<Block | null>(null);
  const [delHoliday, setDelHoliday] = useState<Holiday | null>(null);

  const blocks = useAsync((signal) => api.get<{ blocks: Block[] }>(`/api/admin/block-times${qs({ from: today })}`, { signal }), []);
  const holidays = useAsync((signal) => api.get<{ holidays: Holiday[] }>('/api/admin/holidays', { signal }), []);

  const body = () => ({
    professionalId: professionalId || null,
    startDate,
    endDate: endDate < startDate ? startDate : endDate,
    allDay,
    startTime: allDay ? undefined : startTime,
    endTime: allDay ? undefined : endTime,
    reasonType,
    description,
    cancelAppointments,
  });

  async function preview() {
    setError(null);
    try {
      const r = await api.post<{ affected: NonNullable<typeof affected> }>('/api/admin/block-times/preview', body());
      setAffected(r.affected);
      return r.affected;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const list = affected ?? (await preview());
      if (list === null) return;
      if (list.length && affected === null) {
        // mostra a lista de afetados antes de salvar
        return;
      }
      const r = await api.post<{ cancelled: number }>('/api/admin/block-times', body());
      toast(r.cancelled ? `Horário bloqueado. ${r.cancelled} agendamento(s) cancelado(s) e paciente(s) avisado(s).` : 'Horário bloqueado.');
      setAffected(null);
      setDescription('');
      setCancelAppointments(false);
      blocks.reload();
      bump();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const reasonsForAllDay = reasonType === 'VACATION' || reasonType === 'DAY_OFF';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bloqueios e feriados</h1>
          <p>Horários bloqueados nunca aparecem para os pacientes.</p>
        </div>
      </div>

      <div className="dash-grid">
        <section className="panel" aria-labelledby="h-new-block">
          <div className="panel-head">
            <h2 id="h-new-block">Bloquear horário</h2>
          </div>
          <div className="panel-body form-stack">
            <div className="grid-2">
              <Field label="Quem">
                {(id) => (
                  <select id={id} className="select" value={professionalId} onChange={(e) => (setProfessionalId(e.target.value), setAffected(null))}>
                    <option value="">Clínica inteira (todos os profissionais)</option>
                    {professionals
                      .filter((p) => p.active)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {[p.title, p.name].filter(Boolean).join(' ')}
                        </option>
                      ))}
                  </select>
                )}
              </Field>
              <Field label="Motivo">
                {(id) => (
                  <select
                    id={id}
                    className="select"
                    value={reasonType}
                    onChange={(e) => {
                      setReasonType(e.target.value);
                      if (e.target.value === 'VACATION' || e.target.value === 'DAY_OFF') setAllDay(true);
                      setAffected(null);
                    }}
                  >
                    {Object.entries(BLOCK_REASON).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <label className="check">
              <input type="checkbox" checked={allDay} onChange={(e) => (setAllDay(e.target.checked), setAffected(null))} />
              <span>Dia(s) inteiro(s){reasonsForAllDay ? ' — recomendado para férias e folgas' : ''}</span>
            </label>
            <div className="grid-2">
              <Field label={allDay ? 'Primeiro dia' : 'Data de início'}>
                {(id) => (
                  <input
                    id={id}
                    type="date"
                    className="input"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      if (endDate < e.target.value) setEndDate(e.target.value);
                      setAffected(null);
                    }}
                  />
                )}
              </Field>
              <Field label={allDay ? 'Último dia' : 'Data de fim'}>
                {(id) => <input id={id} type="date" className="input" min={startDate} value={endDate} onChange={(e) => (setEndDate(e.target.value), setAffected(null))} />}
              </Field>
            </div>
            {!allDay && (
              <div className="grid-2">
                <Field label="Das">
                  {(id) => <input id={id} type="time" className="input" value={startTime} onChange={(e) => (setStartTime(e.target.value), setAffected(null))} />}
                </Field>
                <Field label="Até">
                  {(id) => <input id={id} type="time" className="input" value={endTime} onChange={(e) => (setEndTime(e.target.value), setAffected(null))} />}
                </Field>
              </div>
            )}
            <Field label="Descrição" optional hint="Uso interno. Ex.: Reunião de equipe, congresso.">
              {(id, d) => <input id={id} className="input" aria-describedby={d} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />}
            </Field>

            {affected && affected.length > 0 && (
              <Alert kind="warn" title={`${affected.length} paciente(s) já agendado(s) neste período`}>
                <ul className="setup-list" style={{ margin: '6px 0' }}>
                  {affected.slice(0, 8).map((a) => (
                    <li key={a.id}>
                      {fmtDateTime(a.start, timezone)} — {a.patientName} ({a.serviceName})
                    </li>
                  ))}
                  {affected.length > 8 && <li>e mais {affected.length - 8}...</li>}
                </ul>
                <label className="check" style={{ marginTop: 8 }}>
                  <input type="checkbox" checked={cancelAppointments} onChange={(e) => setCancelAppointments(e.target.checked)} />
                  <span>
                    <strong>Cancelar esses agendamentos e avisar os pacientes automaticamente</strong> (com link para remarcar). Se não marcar, eles continuam
                    agendados.
                  </span>
                </label>
              </Alert>
            )}
            {affected && affected.length === 0 && <Alert kind="success">Nenhum paciente agendado neste período.</Alert>}
            {error && <Alert kind="error">{error}</Alert>}
            <div className="btn-row">
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                {busy ? <Spinner /> : <Icon name="ban" size={18} />} {affected ? 'Confirmar bloqueio' : 'Bloquear'}
              </button>
              {affected && (
                <button className="btn btn-ghost" onClick={() => setAffected(null)}>
                  Alterar
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="h-holidays">
          <div className="panel-head">
            <h2 id="h-holidays">Feriados</h2>
          </div>
          <div className="panel-body form-stack">
            {can('holidays:write') && <HolidayForm onSaved={holidays.reload} />}
            {holidays.loading ? (
              <Loading />
            ) : (
              <ul className="appt-list">
                {(holidays.data?.holidays ?? []).map((h) => (
                  <li key={h.id} className="appt-item" style={{ gridTemplateColumns: '84px 1fr auto', cursor: 'default', padding: '10px 0' }}>
                    <span className="appt-time" style={{ fontSize: '0.92rem' }}>
                      {h.recurring ? fmtDateBR(h.date).slice(0, 5) : fmtDateBR(h.date)}
                    </span>
                    <span className="appt-who">
                      <strong>{h.name}</strong>
                      <span>{h.recurring ? 'Todo ano' : 'Data única'}</span>
                    </span>
                    {can('holidays:write') && (
                      <button className="btn btn-ghost btn-icon btn-sm" aria-label={`Remover ${h.name}`} onClick={() => setDelHoliday(h)}>
                        <Icon name="trash" size={16} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }} aria-labelledby="h-blocks">
        <div className="panel-head">
          <h2 id="h-blocks">Bloqueios ativos e futuros</h2>
        </div>
        {blocks.loading ? (
          <Loading />
        ) : !blocks.data?.blocks.length ? (
          <EmptyState icon="ban" title="Nenhum bloqueio futuro" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Quem</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th>Motivo</th>
                  <th>Criado por</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {blocks.data.blocks.map((b) => (
                  <tr key={b.id}>
                    <td>{b.professionalName ? [b.professionalTitle, b.professionalName].filter(Boolean).join(' ') : <strong>Clínica inteira</strong>}</td>
                    <td className="num">{fmtDateTime(b.start, timezone)}</td>
                    <td className="num">{fmtDateTime(b.end, timezone)}</td>
                    <td>
                      <span className="pill">{BLOCK_REASON[b.reasonType]}</span> {b.description}
                    </td>
                    <td>{b.createdBy ?? '—'}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => setDel(b)}>
                        <Icon name="trash" size={16} /> Liberar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {del && (
        <ConfirmDialog
          title="Liberar este horário?"
          message="Os horários voltam a ficar disponíveis para agendamento."
          confirmLabel="Liberar"
          onClose={() => setDel(null)}
          onConfirm={async () => {
            await api.del(`/api/admin/block-times/${del.id}`);
            setDel(null);
            blocks.reload();
            bump();
            toast('Bloqueio removido.');
          }}
        />
      )}
      {delHoliday && (
        <ConfirmDialog
          title={`Remover feriado "${delHoliday.name}"?`}
          message="Os profissionais voltam a atender nesta data conforme a grade semanal."
          confirmLabel="Remover"
          danger
          onClose={() => setDelHoliday(null)}
          onConfirm={async () => {
            await api.del(`/api/admin/holidays/${delHoliday.id}`);
            setDelHoliday(null);
            holidays.reload();
            toast('Feriado removido.');
          }}
        />
      )}
    </>
  );
}

function HolidayForm({ onSaved }: { onSaved: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="form-stack" style={{ paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
      <div className="grid-2">
        <Field label="Data">
          {(id) => <input id={id} type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="Nome">
          {(id) => <input id={id} className="input" value={name} placeholder="Ex.: Aniversário da cidade" onChange={(e) => setName(e.target.value)} />}
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
        <span>Repete todo ano</span>
      </label>
      {error && <Alert kind="error">{error}</Alert>}
      <div>
        <button
          className="btn btn-outline btn-sm"
          disabled={!date || name.trim().length < 2}
          onClick={async () => {
            setError(null);
            try {
              await api.post('/api/admin/holidays', { date, name, recurring });
              setDate('');
              setName('');
              onSaved();
              toast('Feriado adicionado.');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <Icon name="plus" size={16} /> Adicionar feriado
        </button>
      </div>
    </div>
  );
}
