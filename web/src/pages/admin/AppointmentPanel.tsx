import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Icon, WhatsAppIcon } from '../../components/Icon';
import { Alert, Dialog, Field, Loading, Spinner, StatusBadge, copyText, useToast } from '../../components/ui';
import { ApiError, api, qs } from '../../lib/api';
import { fmtDateBR, fmtDateTime, maskPhone, telLink, todayTz, waLink } from '../../lib/format';
import { useAsync } from '../../lib/hooks';
import { useAdmin, useCatalog } from './context';
import type { AdminAppointment } from './types';

type Ctx = {
  open: (id: string) => void;
  openNew: (prefill?: { date?: string; time?: string; professionalId?: string }) => void;
  version: number;
  bump: () => void;
};
const ApptCtx = createContext<Ctx>({ open: () => {}, openNew: () => {}, version: 0, bump: () => {} });
export const useAppointments = () => useContext(ApptCtx);

export function AppointmentProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [newPrefill, setNewPrefill] = useState<{ date?: string; time?: string; professionalId?: string } | null>(null);
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  return (
    <ApptCtx.Provider value={{ open: setOpenId, openNew: (p) => setNewPrefill(p ?? {}), version, bump }}>
      {children}
      {openId && <AppointmentPanel id={openId} onClose={() => setOpenId(null)} onChanged={bump} />}
      {newPrefill && (
        <NewAppointmentDialog
          prefill={newPrefill}
          onClose={() => setNewPrefill(null)}
          onCreated={(id) => {
            setNewPrefill(null);
            bump();
            setOpenId(id);
          }}
        />
      )}
    </ApptCtx.Provider>
  );
}

type Detail = {
  appointment: AdminAppointment & { patientCpf: string | null; patientBirthDate: string | null; manageLink: string };
  events: { at: string; actorType: string; actorName: string | null; action: string; fromStatus: string | null; toStatus: string | null; details: Record<string, string> }[];
  notifications: { id: string; type: string; channel: string; audience: string; status: string; scheduledFor: string; sentAt: string | null; lastError: string }[];
};

const EVENT_LABEL: Record<string, string> = {
  CREATED: 'Agendamento criado',
  CANCELLED: 'Cancelado',
  RESCHEDULED: 'Remarcado',
  STATUS_CHANGED: 'Status alterado',
  REACTIVATED: 'Reativado',
  PATIENT_CONFIRMED: 'Paciente confirmou presença',
};
const ACTOR_LABEL: Record<string, string> = { PATIENT: 'Paciente', STAFF: 'Equipe', SYSTEM: 'Sistema (automático)' };
const NOTIF_STATUS: Record<string, string> = {
  PENDING: 'agendada',
  PROCESSING: 'enviando',
  SENT: 'enviada',
  FAILED: 'falhou',
  CANCELLED: 'cancelada',
  MANUAL: 'aguardando envio manual',
};
export const NOTIF_TYPE: Record<string, string> = {
  BOOKING_CREATED: 'Confirmação de agendamento',
  APPOINTMENT_CONFIRMED: 'Consulta confirmada',
  REMINDER: 'Lembrete (véspera)',
  REMINDER_SHORT: 'Lembrete (mesmo dia)',
  RESCHEDULED: 'Remarcação',
  CANCELLED: 'Cancelamento',
  POST_VISIT: 'Pós-atendimento',
  NO_SHOW: 'Falta',
  CLINIC_NEW_BOOKING: 'Aviso à clínica: novo',
  CLINIC_CANCELLED: 'Aviso à clínica: cancelamento',
  CLINIC_RESCHEDULED: 'Aviso à clínica: remarcação',
  DAILY_AGENDA: 'Agenda do dia',
};

function AppointmentPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can, me, timezone } = useAdmin();
  const toast = useToast();
  const q = useAsync((signal) => api.get<Detail>(`/api/admin/appointments/${id}`, { signal }), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [mode, setMode] = useState<'view' | 'reschedule' | 'cancel'>('view');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (q.data) setNotes(q.data.appointment.internalNotes);
  }, [q.data]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function setStatus(status: string, label: string, extra: Record<string, string> = {}) {
    setBusy(status);
    setError(null);
    try {
      await api.post(`/api/admin/appointments/${id}/status`, { status, ...extra });
      toast(label);
      q.reload();
      onChanged();
      setMode('view');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const a = q.data?.appointment;
  const started = a ? new Date(a.start).getTime() <= Date.now() : false;
  const isPro = me.role === 'PROFESSIONAL';
  const greeting = a
    ? `Olá, ${a.patient.name.split(' ')[0]}! Aqui é da JR Saúde, sobre seu agendamento de ${a.service.name} em ${fmtDateBR(a.date)} às ${a.time}.`
    : '';

  return (
    <>
      <div className="side-panel-backdrop" onClick={onClose} />
      <aside className="side-panel" role="dialog" aria-modal="true" aria-label="Detalhes do agendamento">
        <div className="side-head">
          {a ? (
            <div>
              <h2>{a.patient.name}</h2>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                <StatusBadge status={a.status} />
                <span className="code">{a.code}</span>
                {a.source === 'ONLINE' && <span className="pill">online</span>}
              </div>
            </div>
          ) : (
            <h2>Agendamento</h2>
          )}
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Fechar" autoFocus>
            <Icon name="x" />
          </button>
        </div>
        <div className="side-body">
          {q.loading && !a ? (
            <Loading />
          ) : q.error ? (
            <Alert kind="error">{q.error.message}</Alert>
          ) : a ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span className="num-ui" style={{ fontSize: '1.7rem', fontWeight: 700 }}>
                  {a.time}–{a.endTime}
                </span>
                <span className="muted">{fmtDateBR(a.date)}</span>
              </div>

              {error && <Alert kind="error">{error}</Alert>}

              {mode === 'view' && (
                <div className="btn-row">
                  {a.status === 'PENDING' && can('appointments:write') && (
                    <button className="btn btn-primary" disabled={!!busy} onClick={() => setStatus('CONFIRMED', 'Agendamento confirmado — paciente será avisado.')}>
                      {busy === 'CONFIRMED' ? <Spinner /> : <Icon name="check" size={18} />} Confirmar
                    </button>
                  )}
                  {(a.status === 'CONFIRMED' || a.status === 'PENDING') && started && (
                    <>
                      <button className="btn btn-primary" disabled={!!busy} onClick={() => setStatus('COMPLETED', 'Atendimento concluído.')}>
                        {busy === 'COMPLETED' ? <Spinner /> : <Icon name="checkCircle" size={18} />} Concluído
                      </button>
                      <button className="btn btn-danger-outline" disabled={!!busy} onClick={() => setStatus('NO_SHOW', 'Falta registrada.')}>
                        {busy === 'NO_SHOW' ? <Spinner /> : <Icon name="xCircle" size={18} />} Não compareceu
                      </button>
                    </>
                  )}
                  {(a.status === 'PENDING' || a.status === 'CONFIRMED') && can('appointments:write') && (
                    <>
                      <button className="btn btn-outline" onClick={() => setMode('reschedule')}>
                        <Icon name="refresh" size={18} /> Remarcar
                      </button>
                      <button className="btn btn-danger-outline" onClick={() => setMode('cancel')}>
                        <Icon name="x" size={18} /> Cancelar
                      </button>
                    </>
                  )}
                  {(a.status === 'COMPLETED' || a.status === 'NO_SHOW') && !isPro && (
                    <button className="btn btn-outline" disabled={!!busy} onClick={() => setStatus('CONFIRMED', 'Status desfeito.')}>
                      <Icon name="refresh" size={18} /> Desfazer
                    </button>
                  )}
                  {a.status === 'CANCELLED' && can('appointments:write') && new Date(a.start).getTime() > Date.now() && (
                    <button className="btn btn-outline" disabled={!!busy} onClick={() => setStatus('CONFIRMED', 'Agendamento reativado.')}>
                      <Icon name="refresh" size={18} /> Reativar
                    </button>
                  )}
                </div>
              )}

              {mode === 'cancel' && (
                <div className="panel">
                  <div className="panel-body form-stack">
                    <strong>Cancelar este agendamento?</strong>
                    <span className="muted">O horário será liberado e o paciente receberá o aviso automaticamente.</span>
                    <Field label="Motivo (enviado ao paciente)" optional>
                      {(fid) => <input id={fid} className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}
                    </Field>
                    <div className="btn-row">
                      <button className="btn btn-danger" disabled={!!busy} onClick={() => setStatus('CANCELLED', 'Agendamento cancelado.', { reason })}>
                        {busy === 'CANCELLED' && <Spinner />} Confirmar cancelamento
                      </button>
                      <button className="btn btn-ghost" onClick={() => setMode('view')}>
                        Voltar
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {mode === 'reschedule' && (
                <RescheduleForm
                  appt={a}
                  onCancel={() => setMode('view')}
                  onDone={() => {
                    toast('Agendamento remarcado — paciente será avisado.');
                    setMode('view');
                    q.reload();
                    onChanged();
                  }}
                />
              )}

              <section>
                <h3 className="section-title">Contato</h3>
                <div className="btn-row">
                  <a className="btn btn-whatsapp btn-sm" href={waLink(a.patient.phoneRaw, greeting)} target="_blank" rel="noopener noreferrer">
                    <WhatsAppIcon size={16} /> WhatsApp
                  </a>
                  <a className="btn btn-outline btn-sm" href={telLink(a.patient.phoneRaw)}>
                    <Icon name="phone" size={16} /> {a.patient.phone}
                  </a>
                  {a.patient.email && (
                    <a className="btn btn-outline btn-sm" href={`mailto:${a.patient.email}`}>
                      <Icon name="mail" size={16} /> E-mail
                    </a>
                  )}
                </div>
              </section>

              <section>
                <h3 className="section-title">Detalhes</h3>
                <dl className="kv">
                  <dt>Serviço</dt>
                  <dd>{a.service.name}</dd>
                  <dt>Profissional</dt>
                  <dd>
                    <span className="dot" style={{ background: a.professional.color, marginRight: 6 }} />
                    {a.professional.name}
                  </dd>
                  {a.patient.email && (
                    <>
                      <dt>E-mail</dt>
                      <dd>{a.patient.email}</dd>
                    </>
                  )}
                  {a.patientCpf && (
                    <>
                      <dt>CPF</dt>
                      <dd>{a.patientCpf}</dd>
                    </>
                  )}
                  {a.patientBirthDate && (
                    <>
                      <dt>Nascimento</dt>
                      <dd>{fmtDateBR(a.patientBirthDate)}</dd>
                    </>
                  )}
                  <dt>Origem</dt>
                  <dd>{a.source === 'ONLINE' ? 'Agendamento online' : 'Recepção'}</dd>
                  {a.rescheduleCount > 0 && (
                    <>
                      <dt>Remarcações</dt>
                      <dd>{a.rescheduleCount}</dd>
                    </>
                  )}
                  {a.cancelReason && (
                    <>
                      <dt>Motivo</dt>
                      <dd>{a.cancelReason}</dd>
                    </>
                  )}
                  {a.patientNotes && (
                    <>
                      <dt>Observação</dt>
                      <dd style={{ fontWeight: 400 }}>{a.patientNotes}</dd>
                    </>
                  )}
                </dl>
              </section>

              {can('appointments:write') && (
                <section>
                  <h3 className="section-title">Anotação interna (não aparece ao paciente)</h3>
                  <textarea className="textarea" rows={3} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} aria-label="Anotação interna" />
                  {notes !== a.internalNotes && (
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ marginTop: 8 }}
                      onClick={async () => {
                        try {
                          await api.patch(`/api/admin/appointments/${id}/notes`, { internalNotes: notes });
                          toast('Anotação salva.');
                          q.reload();
                        } catch (e) {
                          toast((e as Error).message, 'error');
                        }
                      }}
                    >
                      Salvar anotação
                    </button>
                  )}
                </section>
              )}

              {!isPro && (
                <section>
                  <h3 className="section-title">Link do paciente</h3>
                  <p className="muted" style={{ margin: '0 0 8px', fontSize: '0.86rem' }}>
                    Envie ao paciente para ele confirmar, remarcar ou cancelar sozinho.
                  </p>
                  <div className="btn-row">
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={async () => {
                        await copyText(a.manageLink);
                        toast('Link copiado.');
                      }}
                    >
                      <Icon name="copy" size={16} /> Copiar link
                    </button>
                    <a
                      className="btn btn-outline btn-sm"
                      href={waLink(a.patient.phoneRaw, `${greeting}\nPara confirmar, remarcar ou cancelar: ${a.manageLink}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <WhatsAppIcon size={16} /> Enviar link
                    </a>
                  </div>
                </section>
              )}

              {q.data!.notifications.length > 0 && (
                <section>
                  <h3 className="section-title">Mensagens automáticas</h3>
                  <ul className="timeline-list">
                    {q.data!.notifications.map((n) => (
                      <li key={n.id}>
                        <div>
                          <strong>{NOTIF_TYPE[n.type] ?? n.type}</strong> · {n.channel === 'WHATSAPP' ? 'WhatsApp' : n.channel === 'EMAIL' ? 'E-mail' : 'SMS'}
                          {n.audience !== 'PATIENT' && ' (clínica)'}
                          <div className="muted">
                            {NOTIF_STATUS[n.status] ?? n.status} · {fmtDateTime(n.sentAt ?? n.scheduledFor, timezone)}
                            {n.lastError && n.status !== 'SENT' && ` · ${n.lastError}`}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h3 className="section-title">Histórico</h3>
                <ul className="timeline-list">
                  {q.data!.events.map((e, i) => (
                    <li key={i}>
                      <div>
                        <strong>{EVENT_LABEL[e.action] ?? e.action}</strong>
                        {e.toStatus && e.action === 'STATUS_CHANGED' && ` → ${e.toStatus}`}
                        <div className="muted">
                          {fmtDateTime(e.at, timezone)} · {e.actorName ?? ACTOR_LABEL[e.actorType]}
                          {e.details?.reason ? ` · ${e.details.reason}` : ''}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          ) : null}
        </div>
      </aside>
    </>
  );
}

type SlotsResp = { slots: { time: string; start: string }[]; linked: boolean };

function SlotPicker({
  serviceId,
  professionalId,
  date,
  value,
  onChange,
}: {
  serviceId: string;
  professionalId: string;
  date: string;
  value: string;
  onChange: (t: string) => void;
}) {
  const q = useAsync(
    (signal) =>
      serviceId && professionalId && date
        ? api.get<SlotsResp>(`/api/admin/availability${qs({ serviceId, professionalId, date })}`, { signal })
        : Promise.resolve(null),
    [serviceId, professionalId, date],
  );
  if (!serviceId || !professionalId || !date) return <p className="muted">Escolha serviço, profissional e data.</p>;
  if (q.loading) return <Loading text="Buscando horários..." />;
  if (q.error) return <Alert kind="error">{q.error.message}</Alert>;
  if (!q.data?.linked) return <Alert kind="warn">Este profissional não está vinculado a este serviço.</Alert>;
  if (!q.data.slots.length) return <Alert kind="info">Sem horários livres nesta data. Use o encaixe se necessário.</Alert>;
  return (
    <div className="slots" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 6 }}>
      {q.data.slots.map((s) => (
        <button
          key={s.start}
          type="button"
          className="slot"
          style={{ minHeight: 40, fontSize: '0.95rem' }}
          aria-pressed={value === s.time}
          onClick={() => onChange(s.time)}
        >
          {s.time}
        </button>
      ))}
    </div>
  );
}

function RescheduleForm({ appt, onCancel, onDone }: { appt: AdminAppointment; onCancel: () => void; onDone: () => void }) {
  const { professionals } = useCatalog();
  const [date, setDate] = useState(appt.date);
  const [professionalId, setProfessionalId] = useState(appt.professional.id);
  const [time, setTime] = useState('');
  const [outside, setOutside] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligible = professionals.filter((p) => p.active && p.services.some((s) => s.serviceId === appt.service.id));
  return (
    <div className="panel">
      <div className="panel-body form-stack">
        <strong>Remarcar</strong>
        <div className="grid-2">
          <Field label="Data">
            {(id) => <input id={id} type="date" className="input" value={date} onChange={(e) => (setDate(e.target.value), setTime(''))} />}
          </Field>
          <Field label="Profissional">
            {(id) => (
              <select id={id} className="select" value={professionalId} onChange={(e) => (setProfessionalId(e.target.value), setTime(''))}>
                {eligible.map((p) => (
                  <option key={p.id} value={p.id}>
                    {[p.title, p.name].filter(Boolean).join(' ')}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={outside} onChange={(e) => (setOutside(e.target.checked), setTime(''))} />
          <span>Encaixe (fora do expediente ou em horário bloqueado)</span>
        </label>
        {outside ? (
          <Field label="Horário do encaixe">
            {(id) => <input id={id} type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} style={{ maxWidth: 160 }} />}
          </Field>
        ) : (
          <SlotPicker serviceId={appt.service.id} professionalId={professionalId} date={date} value={time} onChange={setTime} />
        )}
        {error && <Alert kind="error">{error}</Alert>}
        <div className="btn-row">
          <button
            className="btn btn-primary"
            disabled={!time || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api.post(`/api/admin/appointments/${appt.id}/reschedule`, { date, time, professionalId, outsideSchedule: outside });
                onDone();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner />} Salvar novo horário {time && `(${time})`}
          </button>
          <button className="btn btn-ghost" onClick={onCancel}>
            Voltar
          </button>
        </div>
      </div>
    </div>
  );
}

type PatientHit = { id: string; name: string; phone: string; email: string | null; appointments: number };

function NewAppointmentDialog({
  prefill,
  onClose,
  onCreated,
}: {
  prefill: { date?: string; time?: string; professionalId?: string };
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { services, professionals } = useCatalog();
  const { timezone, can } = useAdmin();
  const activeServices = services.filter((s) => s.active);
  const initialService =
    prefill.professionalId ? (professionals.find((p) => p.id === prefill.professionalId)?.services[0]?.serviceId ?? '') : '';
  const [serviceId, setServiceId] = useState(initialService);
  const [professionalId, setProfessionalId] = useState(prefill.professionalId ?? '');
  const [date, setDate] = useState(prefill.date ?? todayTz(timezone));
  const [time, setTime] = useState(prefill.time ?? '');
  const [outside, setOutside] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<PatientHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const eligible = professionals.filter((p) => p.active && (!serviceId || p.services.some((s) => s.serviceId === serviceId)));

  useEffect(() => {
    if (serviceId && professionalId && !eligible.some((p) => p.id === professionalId)) setProfessionalId('');
    if (serviceId && !professionalId && eligible.length === 1) setProfessionalId(eligible[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  useEffect(() => {
    if (!can('patients:read') || search.trim().length < 3) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api
        .get<{ patients: PatientHit[] }>(`/api/admin/patients${qs({ q: search })}`, { signal: ctrl.signal })
        .then((r) => setHits(r.patients.slice(0, 5)))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [search, can]);

  async function save() {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const r = await api.post<{ appointment: AdminAppointment }>('/api/admin/appointments', {
        serviceId,
        professionalId,
        date,
        time,
        name,
        phone,
        email: email || null,
        internalNotes,
        outsideSchedule: outside,
      });
      onCreated(r.appointment.id);
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Novo agendamento"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !serviceId || !professionalId || !time || !name || !phone}>
            {busy ? <Spinner /> : <Icon name="check" size={18} />} Agendar
          </button>
        </>
      }
    >
      <div className="form-stack">
        {can('patients:read') && (
          <Field label="Buscar paciente já cadastrado" optional hint="Digite nome ou telefone para preencher automaticamente.">
            {(id, d) => (
              <div>
                <input id={id} className="input" aria-describedby={d} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ex.: Maria ou 98888" />
                {hits.length > 0 && (
                  <div className="panel" style={{ marginTop: 6 }}>
                    {hits.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        className="appt-item"
                        style={{ gridTemplateColumns: '1fr auto' }}
                        onClick={() => {
                          setName(h.name);
                          setPhone(maskPhone(h.phone));
                          setEmail(h.email ?? '');
                          setSearch('');
                          setHits([]);
                        }}
                      >
                        <span className="appt-who">
                          <strong>{h.name}</strong>
                          <span>{h.phone}</span>
                        </span>
                        <span className="pill">{h.appointments} agend.</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Field>
        )}
        <div className="grid-2">
          <Field label="Nome do paciente" error={fields.name}>
            {(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}
          </Field>
          <Field label="Telefone (WhatsApp)" error={fields.phone}>
            {(id) => <input id={id} className="input" type="tel" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} placeholder="(91) 98888-7777" />}
          </Field>
        </div>
        <Field label="E-mail" optional error={fields.email}>
          {(id) => <input id={id} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <div className="grid-3">
          <Field label="Serviço">
            {(id) => (
              <select id={id} className="select" value={serviceId} onChange={(e) => (setServiceId(e.target.value), setTime(''))}>
                <option value="">Selecione</option>
                {activeServices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Profissional">
            {(id) => (
              <select id={id} className="select" value={professionalId} onChange={(e) => (setProfessionalId(e.target.value), setTime(''))}>
                <option value="">Selecione</option>
                {eligible.map((p) => (
                  <option key={p.id} value={p.id}>
                    {[p.title, p.name].filter(Boolean).join(' ')}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Data">
            {(id) => <input id={id} type="date" className="input" value={date} onChange={(e) => (setDate(e.target.value), setTime(''))} />}
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} />
          <span>Encaixe (fora do expediente ou em horário bloqueado)</span>
        </label>
        {outside ? (
          <Field label="Horário">
            {(id) => <input id={id} type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} style={{ maxWidth: 160 }} />}
          </Field>
        ) : (
          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>
              Horário {time && <span className="pill ok">{time}</span>}
            </div>
            <SlotPicker serviceId={serviceId} professionalId={professionalId} date={date} value={time} onChange={setTime} />
          </div>
        )}
        <Field label="Anotação interna" optional>
          {(id) => <textarea id={id} className="textarea" rows={2} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} maxLength={1000} />}
        </Field>
        {error && <Alert kind="error">{error}</Alert>}
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          O paciente recebe a confirmação e os lembretes automaticamente.
        </p>
      </div>
    </Dialog>
  );
}
