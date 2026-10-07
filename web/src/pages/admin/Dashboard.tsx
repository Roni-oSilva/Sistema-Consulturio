import { Link } from 'react-router-dom';
import { Icon, WhatsAppIcon } from '../../components/Icon';
import { Alert, EmptyState, ErrorState, Loading, StatusBadge, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { fmtDateBR, fmtDateLong, waLink } from '../../lib/format';
import { useAsync, useTitle } from '../../lib/hooks';
import { useAppointments } from './AppointmentPanel';
import { useAdmin } from './context';
import type { AdminAppointment } from './types';

type DashData = {
  now: string;
  today: {
    date: string;
    total: number;
    pending: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    noShow: number;
    freeSlots: number;
    appointments: AdminAppointment[];
  };
  upcoming: AdminAppointment[];
  totals: { upcoming: number; pending: number; confirmed: number; cancelled_month: number; total: number; created_today: number; no_show_month: number };
  messages: { manual: number; failed: number };
  setup: string[];
};

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

export function Dashboard() {
  useTitle('Hoje');
  const { me, can } = useAdmin();
  const { open, openNew, version, bump } = useAppointments();
  const toast = useToast();
  const q = useAsync((signal) => api.get<DashData>('/api/admin/dashboard', { signal }), [version]);

  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  const d = q.data!;
  const now = Date.now();

  async function quick(a: AdminAppointment, status: string, label: string) {
    try {
      await api.post(`/api/admin/appointments/${a.id}/status`, { status });
      toast(label);
      bump();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            {greeting()}, {me.name.split(' ')[0]}
          </h1>
          <p>{capitalize(fmtDateLong(d.today.date))}</p>
        </div>
        <div className="page-actions">
          {can('appointments:write') && (
            <button className="btn btn-primary" onClick={() => openNew()}>
              <Icon name="plus" size={18} /> Novo agendamento
            </button>
          )}
          {can('blocks:write') && (
            <Link to="/admin/bloqueios" className="btn btn-outline">
              <Icon name="ban" size={18} /> Bloquear horário
            </Link>
          )}
          <Link to="/admin/agenda" className="btn btn-outline">
            <Icon name="calendar" size={18} /> Ver agenda
          </Link>
        </div>
      </div>

      <div className="stack" style={{ marginBottom: 16 }}>
        {d.setup.length > 0 && (
          <Alert kind="warn" title="Complete a configuração da clínica">
            <ul className="setup-list">
              {d.setup.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </Alert>
        )}
        {d.messages.manual > 0 && can('notifications:read') && (
          <Alert kind="info" title={`${d.messages.manual} mensagem(ns) de WhatsApp pronta(s) para enviar`}>
            Sem API de WhatsApp configurada, as mensagens ficam prontas para envio com 1 clique.{' '}
            <Link to="/admin/mensagens">Enviar agora →</Link>
          </Alert>
        )}
        {d.messages.failed > 0 && can('notifications:read') && (
          <Alert kind="error">
            {d.messages.failed} mensagem(ns) falharam nos últimos 7 dias. <Link to="/admin/mensagens?aba=historico">Ver detalhes</Link>
          </Alert>
        )}
      </div>

      <div className="stats">
        <div className="stat accent">
          <span className="label">
            <Icon name="calendar" size={14} /> Consultas hoje
          </span>
          <span className="value">{d.today.total}</span>
        </div>
        <div className="stat">
          <span className="label">Confirmadas hoje</span>
          <span className="value">{d.today.confirmed}</span>
        </div>
        <div className="stat">
          <span className="label">Pendentes hoje</span>
          <span className="value">{d.today.pending}</span>
        </div>
        <div className="stat">
          <span className="label">Horários livres hoje</span>
          <span className="value">{d.today.freeSlots}</span>
        </div>
        <div className="stat">
          <span className="label">Próximas consultas</span>
          <span className="value">{d.totals.upcoming}</span>
        </div>
        <div className="stat">
          <span className="label">Canceladas no mês</span>
          <span className="value">{d.totals.cancelled_month}</span>
        </div>
      </div>

      <div className="dash-grid">
        <section className="panel" aria-labelledby="h-today">
          <div className="panel-head">
            <h2 id="h-today">Agenda de hoje</h2>
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              {d.today.completed} concluída(s) · {d.today.noShow} falta(s) · {d.totals.created_today} agendada(s) hoje · total geral {d.totals.total}
            </span>
          </div>
          {d.today.appointments.length === 0 ? (
            <EmptyState title="Nenhum atendimento hoje">Os agendamentos do dia aparecem aqui.</EmptyState>
          ) : (
            <ul className="appt-list">
              {d.today.appointments.map((a) => {
                const started = new Date(a.start).getTime() <= now;
                const isNow = started && new Date(a.end).getTime() > now && a.status !== 'CANCELLED';
                return (
                  <li
                    key={a.id}
                    className={`appt-item ${a.status} ${isNow ? 'is-now' : ''}`}
                    tabIndex={0}
                    role="button"
                    aria-label={`${a.time} ${a.patient.name}`}
                    onClick={() => open(a.id)}
                    onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && open(a.id)}
                  >
                    <span className="appt-time">
                      {a.time}
                      <small>{a.endTime}</small>
                    </span>
                    <span className="appt-who">
                      <strong>{a.patient.name}</strong>
                      <span>
                        <i className="dot" style={{ background: a.professional.color }} />
                        {a.service.name} · {a.professional.name}
                      </span>
                    </span>
                    <span className="quick-actions" onClick={(e) => e.stopPropagation()}>
                      <StatusBadge status={a.status} />
                      {a.status === 'PENDING' && !started && can('appointments:write') && (
                        <button className="btn btn-outline btn-sm" onClick={() => quick(a, 'CONFIRMED', 'Confirmado.')}>
                          <Icon name="check" size={16} /> Confirmar
                        </button>
                      )}
                      {(a.status === 'CONFIRMED' || a.status === 'PENDING') && started && (
                        <>
                          <button className="btn btn-outline btn-sm" onClick={() => quick(a, 'COMPLETED', 'Concluído.')} title="Marcar como concluído">
                            <Icon name="checkCircle" size={16} /> <span className="hide-sm">Concluído</span>
                          </button>
                          <button className="btn btn-danger-outline btn-sm" onClick={() => quick(a, 'NO_SHOW', 'Falta registrada.')} title="Não compareceu">
                            <Icon name="xCircle" size={16} /> <span className="hide-sm">Faltou</span>
                          </button>
                        </>
                      )}
                      {!started && a.status !== 'CANCELLED' && me.role !== 'PROFESSIONAL' && (
                        <a
                          className="btn btn-ghost btn-sm btn-icon"
                          href={waLink(a.patient.phoneRaw, `Olá, ${a.patient.name.split(' ')[0]}! Aqui é da JR Saúde. Lembrando do seu atendimento hoje às ${a.time}.`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`WhatsApp para ${a.patient.name}`}
                        >
                          <WhatsAppIcon size={18} />
                        </a>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel" aria-labelledby="h-next">
          <div className="panel-head">
            <h2 id="h-next">Próximos agendamentos</h2>
            <Link to="/admin/agenda?visao=semana" className="btn btn-ghost btn-sm">
              Ver semana
            </Link>
          </div>
          {d.upcoming.length === 0 ? (
            <EmptyState title="Nenhum agendamento futuro" />
          ) : (
            <ul className="appt-list">
              {d.upcoming.map((a) => (
                <li
                  key={a.id}
                  className={`appt-item ${a.status}`}
                  tabIndex={0}
                  role="button"
                  onClick={() => open(a.id)}
                  onKeyDown={(e) => e.key === 'Enter' && open(a.id)}
                  style={{ gridTemplateColumns: '78px 1fr auto' }}
                >
                  <span className="appt-time" style={{ fontSize: '0.9rem' }}>
                    {fmtDateBR(a.date).slice(0, 5)}
                    <small>{a.time}</small>
                  </span>
                  <span className="appt-who">
                    <strong>{a.patient.name}</strong>
                    <span>
                      <i className="dot" style={{ background: a.professional.color }} />
                      {a.service.name}
                    </span>
                  </span>
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
