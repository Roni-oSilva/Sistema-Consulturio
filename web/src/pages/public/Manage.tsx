import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Icon, WhatsAppIcon } from '../../components/Icon';
import { Alert, ConfirmDialog, ErrorState, Field, Loading, Spinner, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { waLink } from '../../lib/format';
import { useAsync, useClinic, useTitle } from '../../lib/hooks';
import type { PublicAppointment, Slot } from '../../lib/types';
import { shareText } from './Booking';
import { DateTimePicker } from './shared';

const STATUS_TEXT: Record<string, { text: string; icon: 'clock' | 'checkCircle' | 'xCircle' | 'check' }> = {
  PENDING: { text: 'Agendado — confirme sua presença abaixo', icon: 'clock' },
  CONFIRMED: { text: 'Presença confirmada', icon: 'checkCircle' },
  COMPLETED: { text: 'Atendimento realizado', icon: 'check' },
  CANCELLED: { text: 'Agendamento cancelado', icon: 'xCircle' },
  NO_SHOW: { text: 'Não houve comparecimento', icon: 'xCircle' },
};

export function Manage() {
  useTitle('Meu agendamento');
  const clinic = useClinic()!;
  const toast = useToast();
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const [cancelOpen, setCancelOpen] = useState(params.get('acao') === 'cancelar');
  const [reason, setReason] = useState('');
  const [rescheduling, setRescheduling] = useState(false);
  const [pick, setPick] = useState<{ date: string | null; slot: Slot | null }>({ date: null, slot: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = useAsync(
    (signal) => api.get<{ appointment: PublicAppointment; clinic: { address: string; mapsUrl: string } }>(`/api/appointments/${id}`, { token, signal }),
    [id, token],
  );

  if (q.loading) return <Loading />;
  if (q.error || !q.data) {
    return (
      <div className="wrap wrap-narrow booking stack">
        <ErrorState error={q.error ?? new Error('Agendamento não encontrado.')} />
        <Link to="/meus-agendamentos" className="btn btn-primary">
          <Icon name="search" size={18} /> Buscar pelo código e telefone
        </Link>
      </div>
    );
  }
  const a = q.data.appointment;
  const st = STATUS_TEXT[a.status];

  async function act(fn: () => Promise<{ appointment: PublicAppointment }>, okMsg: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      q.setData({ ...q.data!, appointment: r.appointment });
      toast(okMsg);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap wrap-narrow booking stack-lg">
      <div>
        <span className="kicker">Agendamento {a.code}</span>
        <h1 className="step-title display" style={{ marginTop: 6 }}>
          Olá, {a.patientName.split(' ')[0]}
        </h1>
      </div>

      <div className={`status-banner ${a.status}`} role="status">
        <Icon name={st.icon} size={22} /> {st.text}
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="summary">
        <div className="summary-head">
          <h3>{a.service.name}</h3>
          <Icon name="calendar" size={24} />
        </div>
        <dl>
          <div className="row">
            <dt>Profissional</dt>
            <dd>{a.professional.name}</dd>
          </div>
          <div className="row">
            <dt>Data</dt>
            <dd>
              {a.date} <span className="muted" style={{ fontWeight: 400 }}>({a.weekday})</span>
            </dd>
          </div>
          <div className="row">
            <dt>Horário</dt>
            <dd>{a.time}</dd>
          </div>
          <div className="row">
            <dt>Telefone</dt>
            <dd>{a.phoneMasked}</dd>
          </div>
          {q.data.clinic.address && (
            <div className="row">
              <dt>Endereço</dt>
              <dd style={{ fontWeight: 500 }}>
                {q.data.clinic.address}
                {q.data.clinic.mapsUrl && (
                  <>
                    {' · '}
                    <a href={q.data.clinic.mapsUrl} target="_blank" rel="noopener noreferrer">
                      Como chegar
                    </a>
                  </>
                )}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {a.service.preparation && (a.status === 'PENDING' || a.status === 'CONFIRMED') && (
        <div className="prep">
          <Icon name="info" size={20} />
          <div>
            <strong>Preparo:</strong> {a.service.preparation}
          </div>
        </div>
      )}

      {a.canConfirm && (
        <button
          className="btn btn-gold btn-lg btn-block"
          disabled={busy}
          onClick={() => act(() => api.post(`/api/appointments/${a.id}/confirm`, {}, { token }), 'Presença confirmada. Obrigado!')}
        >
          {busy ? <Spinner /> : <Icon name="check" size={22} />} CONFIRMAR MINHA PRESENÇA
        </button>
      )}

      {(a.status === 'PENDING' || a.status === 'CONFIRMED') && !rescheduling && (
        <div className="action-grid">
          <a className="btn btn-outline btn-lg" href={`/api/appointments/${a.id}/calendar.ics?t=${encodeURIComponent(token)}`} download>
            <Icon name="calendar" size={20} /> Adicionar ao calendário
          </a>
          {clinic.whatsapp && (
            <a className="btn btn-whatsapp btn-lg" href={waLink(clinic.whatsapp, `Olá! Sobre meu agendamento:\n${shareText(a, clinic)}`)} target="_blank" rel="noopener noreferrer">
              <WhatsAppIcon size={20} /> Falar com a clínica
            </a>
          )}
          {a.canReschedule && (
            <button className="btn btn-outline btn-lg" onClick={() => setRescheduling(true)}>
              <Icon name="refresh" size={20} /> Remarcar
            </button>
          )}
          {a.canCancel && (
            <button className="btn btn-danger-outline btn-lg" onClick={() => setCancelOpen(true)}>
              <Icon name="xCircle" size={20} /> Cancelar agendamento
            </button>
          )}
        </div>
      )}

      {a.changeBlockedReason && (a.status === 'PENDING' || a.status === 'CONFIRMED') && <Alert kind="info">{a.changeBlockedReason}</Alert>}

      {rescheduling && (
        <section className="stack" aria-labelledby="t-resched">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <h2 id="t-resched" className="display" style={{ margin: 0, fontSize: '1.9rem' }}>
              Escolha o novo horário
            </h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setRescheduling(false)}>
              Desistir
            </button>
          </div>
          <DateTimePicker
            serviceId={a.service.id}
            professionalId={a.professional.id}
            value={{ date: pick.date, start: pick.slot?.start ?? null }}
            onPick={(date, slot) => setPick({ date, slot })}
          />
          {pick.slot && (
            <div className="sticky-actions">
              <button
                className="btn btn-primary btn-lg btn-block"
                disabled={busy}
                onClick={async () => {
                  const ok = await act(() => api.post(`/api/appointments/${a.id}/reschedule`, { start: pick.slot!.start }, { token }), 'Agendamento remarcado!');
                  if (ok) {
                    setRescheduling(false);
                    setPick({ date: null, slot: null });
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
              >
                {busy ? <Spinner /> : <Icon name="check" size={20} />} Confirmar novo horário ({pick.slot.time})
              </button>
            </div>
          )}
        </section>
      )}

      {a.status === 'CANCELLED' && (
        <Link to={`/agendar?servico=${a.service.id}`} className="btn btn-primary btn-lg btn-block">
          <Icon name="calendar" size={20} /> Fazer novo agendamento
        </Link>
      )}

      <p className="muted" style={{ fontSize: '0.92rem' }}>
        {a.cancellationPolicy}
      </p>

      {cancelOpen && a.canCancel && (
        <ConfirmDialog
          title="Cancelar agendamento?"
          danger
          confirmLabel="Sim, cancelar"
          message={
            <span>
              Você está cancelando <strong>{a.service.name}</strong> em <strong>{a.date}</strong> às <strong>{a.time}</strong>. O horário será liberado para outra
              pessoa.
            </span>
          }
          onClose={() => setCancelOpen(false)}
          onConfirm={async () => {
            const r = await api.post<{ appointment: PublicAppointment }>(`/api/appointments/${a.id}/cancel`, { reason: reason.trim() || undefined }, { token });
            q.setData({ ...q.data!, appointment: r.appointment });
            setCancelOpen(false);
            toast('Agendamento cancelado.');
          }}
        >
          <Field label="Motivo" optional>
            {(fid) => <input id={fid} className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </ConfirmDialog>
      )}
    </div>
  );
}
