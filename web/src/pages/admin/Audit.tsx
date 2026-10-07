import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { EmptyState, ErrorState, Loading } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useAsync, useTitle } from '../../lib/hooks';
import { useAdmin } from './context';

type Log = {
  id: number;
  at: string;
  userLabel: string;
  action: string;
  resourceType: string;
  resourceId: string;
  result: 'SUCCESS' | 'FAILURE' | 'DENIED';
  ip: string;
  details: Record<string, unknown>;
};

const ACTION_LABEL: Record<string, string> = {
  LOGIN_SUCCESS: 'Login',
  LOGIN_FAILED: 'Login recusado',
  LOGIN_BLOCKED: 'Login bloqueado (muitas tentativas)',
  LOGOUT: 'Logout',
  PASSWORD_CHANGED: 'Senha alterada',
  PASSWORD_CHANGE_FAILED: 'Troca de senha recusada',
  USER_CREATED: 'Usuário criado',
  USER_UPDATED: 'Usuário alterado',
  USER_ROLE_CHANGED: 'Permissão alterada',
  USER_DEACTIVATED: 'Usuário desativado',
  USER_PASSWORD_RESET: 'Senha redefinida',
  PERMISSION_DENIED: 'Acesso negado',
  CSRF_REJECTED: 'Requisição suspeita recusada',
  PROFESSIONAL_CREATED: 'Profissional criado',
  PROFESSIONAL_UPDATED: 'Profissional alterado',
  PROFESSIONAL_DEACTIVATED: 'Profissional desativado',
  SCHEDULE_UPDATED: 'Horários alterados',
  SCHEDULE_OVERRIDE_CREATED: 'Horário especial criado',
  SCHEDULE_OVERRIDE_DELETED: 'Horário especial removido',
  SERVICE_CREATED: 'Serviço criado',
  SERVICE_UPDATED: 'Serviço alterado',
  SERVICE_DEACTIVATED: 'Serviço desativado',
  APPOINTMENT_CREATED: 'Agendamento criado (recepção)',
  APPOINTMENT_CANCELLED: 'Agendamento cancelado (equipe)',
  APPOINTMENT_CANCELLED_BY_PATIENT: 'Agendamento cancelado (paciente)',
  APPOINTMENT_RESCHEDULED: 'Agendamento remarcado (equipe)',
  APPOINTMENT_RESCHEDULED_BY_PATIENT: 'Agendamento remarcado (paciente)',
  APPOINTMENT_STATUS_CHANGED: 'Status alterado',
  APPOINTMENT_NOTES_UPDATED: 'Anotação alterada',
  APPOINTMENT_ACCESS_DENIED: 'Acesso a agendamento negado',
  APPOINTMENT_LOOKUP_FAILED: 'Consulta de agendamento sem sucesso',
  TIME_BLOCKED: 'Horário bloqueado',
  TIME_UNBLOCKED: 'Bloqueio removido',
  HOLIDAY_CREATED: 'Feriado criado',
  HOLIDAY_DELETED: 'Feriado removido',
  SETTINGS_UPDATED: 'Configurações alteradas',
  TEMPLATE_UPDATED: 'Modelo de mensagem alterado',
  BOOKING_BOT_DETECTED: 'Robô bloqueado no agendamento',
  BOOKING_IP_LIMIT: 'Limite de agendamentos por conexão',
  PATIENT_VIEWED: 'Paciente visualizado',
  PATIENT_DATA_EXPORTED: 'Dados do paciente exportados',
  PATIENT_ANONYMIZED: 'Paciente anonimizado',
  MESSAGE_SENT_MANUALLY: 'Mensagem enviada (manual)',
};

export function Audit() {
  useTitle('Auditoria');
  const { timezone } = useAdmin();
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useAsync(
    (signal) =>
      api.get<{ logs: Log[]; hasMore: boolean; actions: string[] }>(`/api/admin/audit-logs${qs({ action: action || null, result: result || null, q: search || null, page })}`, {
        signal,
      }),
    [action, result, search, page],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Auditoria</h1>
          <p>Registro das ações importantes: quem fez, o quê, quando e o resultado. Senhas e dados sensíveis nunca são gravados.</p>
        </div>
      </div>
      <div className="toolbar">
        <select className="select" value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} aria-label="Ação">
          <option value="">Todas as ações</option>
          {(q.data?.actions ?? []).map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a] ?? a}
            </option>
          ))}
        </select>
        <select className="select" value={result} onChange={(e) => (setResult(e.target.value), setPage(1))} aria-label="Resultado">
          <option value="">Todos os resultados</option>
          <option value="SUCCESS">Sucesso</option>
          <option value="FAILURE">Falha</option>
          <option value="DENIED">Negado</option>
        </select>
        <input className="input" type="search" placeholder="Usuário ou ID do recurso" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} aria-label="Buscar" />
      </div>
      <div className="panel table-wrap">
        {q.loading ? (
          <Loading />
        ) : q.error ? (
          <div className="panel-body">
            <ErrorState error={q.error} />
          </div>
        ) : !q.data!.logs.length ? (
          <EmptyState icon="shield" title="Nenhum registro" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Usuário</th>
                <th>Ação</th>
                <th>Recurso</th>
                <th>Resultado</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.logs.map((l) => (
                <tr key={l.id}>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    {fmtDateTime(l.at, timezone)}
                  </td>
                  <td>{l.userLabel || '—'}</td>
                  <td>
                    {ACTION_LABEL[l.action] ?? l.action}
                    {Object.keys(l.details ?? {}).length > 0 && (
                      <div className="muted" style={{ fontSize: '0.78rem', maxWidth: 360, overflowWrap: 'anywhere' }}>
                        {Object.entries(l.details)
                          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                          .join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: '0.8rem' }}>
                    {l.resourceType} {l.resourceId && <span className="code">{l.resourceId.slice(0, 8)}</span>}
                  </td>
                  <td>
                    <span className={`pill ${l.result === 'SUCCESS' ? 'ok' : l.result === 'DENIED' ? 'bad' : 'warn'}`}>
                      {l.result === 'SUCCESS' ? 'Sucesso' : l.result === 'DENIED' ? 'Negado' : 'Falha'}
                    </span>
                  </td>
                  <td className="num muted" style={{ fontSize: '0.8rem' }}>
                    {l.ip}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          <Icon name="chevronLeft" size={16} /> Anterior
        </button>
        <span className="muted" style={{ alignSelf: 'center' }}>
          Página {page}
        </span>
        <button className="btn btn-outline btn-sm" disabled={!q.data?.hasMore} onClick={() => setPage(page + 1)}>
          Próxima <Icon name="chevronRight" size={16} />
        </button>
      </div>
    </>
  );
}
