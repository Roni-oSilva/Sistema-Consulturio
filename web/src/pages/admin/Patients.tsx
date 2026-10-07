import { useEffect, useState } from 'react';
import { Icon, WhatsAppIcon } from '../../components/Icon';
import { Alert, ConfirmDialog, Dialog, EmptyState, Field, Loading, StatusBadge, useToast } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { fmtDateBR, fmtDateTime, waLink } from '../../lib/format';
import { useAsync, useTitle } from '../../lib/hooks';
import { useAppointments } from './AppointmentPanel';
import { useAdmin } from './context';

type PatientRow = { id: string; name: string; phone: string; email: string | null; createdAt: string; anonymizedAt: string | null; appointments: number; lastAppointment: string | null };
type PatientDetail = {
  patient: { id: string; name: string; phone: string; email: string | null; cpf: string | null; birthDate: string | null; createdAt: string; anonymizedAt: string | null };
  appointments: { id: string; code: string; start: string; status: string; serviceName: string; professionalName: string }[];
  consents: { type: string; version: string; granted: boolean; createdAt: string }[];
};

export function Patients() {
  useTitle('Pacientes');
  const { timezone } = useAdmin();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(t);
  }, [term]);
  const q = useAsync((signal) => api.get<{ patients: PatientRow[] }>(`/api/admin/patients${qs({ q: debounced })}`, { signal }), [debounced]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pacientes</h1>
          <p>Dados mínimos de contato e histórico de agendamentos. Não é prontuário.</p>
        </div>
      </div>
      <div className="toolbar">
        <input
          className="input"
          type="search"
          placeholder="Buscar por nome, telefone ou e-mail"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          aria-label="Buscar paciente"
          style={{ width: 'min(100%, 380px)' }}
        />
      </div>
      <div className="panel table-wrap">
        {q.loading ? (
          <Loading />
        ) : !q.data?.patients.length ? (
          <EmptyState icon="users" title="Nenhum paciente encontrado" />
        ) : (
          <table className="table table-click">
            <thead>
              <tr>
                <th>Paciente</th>
                <th>Telefone</th>
                <th className="num">Agendamentos</th>
                <th>Último</th>
              </tr>
            </thead>
            <tbody>
              {q.data.patients.map((p) => (
                <tr key={p.id} onClick={() => setOpenId(p.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(p.id)}>
                  <td>
                    <strong>{p.name}</strong>
                    {p.email && <div className="muted">{p.email}</div>}
                  </td>
                  <td className="num">{p.anonymizedAt ? '—' : p.phone}</td>
                  <td className="num">{p.appointments}</td>
                  <td className="num">{p.lastAppointment ? fmtDateTime(p.lastAppointment, timezone).slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {openId && <PatientDialog id={openId} onClose={() => setOpenId(null)} onChanged={q.reload} />}
    </>
  );
}

function PatientDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can, timezone } = useAdmin();
  const { open } = useAppointments();
  const toast = useToast();
  const q = useAsync((signal) => api.get<PatientDetail>(`/api/admin/patients/${id}`, { signal }), [id]);
  const [anon, setAnon] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  return (
    <Dialog title={q.data?.patient.name ?? 'Paciente'} onClose={onClose} wide>
      {q.loading ? (
        <Loading />
      ) : q.error ? (
        <Alert kind="error">{q.error.message}</Alert>
      ) : (
        <div className="form-stack">
          {q.data!.patient.anonymizedAt && <Alert kind="info">Dados pessoais anonimizados em {fmtDateTime(q.data!.patient.anonymizedAt, timezone)}.</Alert>}
          <dl className="kv">
            <dt>Telefone</dt>
            <dd>{q.data!.patient.phone}</dd>
            {q.data!.patient.email && (
              <>
                <dt>E-mail</dt>
                <dd>{q.data!.patient.email}</dd>
              </>
            )}
            {q.data!.patient.cpf && (
              <>
                <dt>CPF</dt>
                <dd>{q.data!.patient.cpf}</dd>
              </>
            )}
            {q.data!.patient.birthDate && (
              <>
                <dt>Nascimento</dt>
                <dd>{fmtDateBR(q.data!.patient.birthDate)}</dd>
              </>
            )}
            <dt>Cadastro</dt>
            <dd>{fmtDateTime(q.data!.patient.createdAt, timezone)}</dd>
          </dl>
          {!q.data!.patient.anonymizedAt && (
            <div className="btn-row">
              <a className="btn btn-whatsapp btn-sm" href={waLink(q.data!.patient.phone.replace(/\D/g, '').replace(/^/, '55'), '')} target="_blank" rel="noopener noreferrer">
                <WhatsAppIcon size={16} /> WhatsApp
              </a>
              {can('patients:anonymize') && (
                <>
                  <a className="btn btn-outline btn-sm" href={`/api/admin/patients/${id}/export`} download>
                    <Icon name="download" size={16} /> Exportar dados (LGPD)
                  </a>
                  <button className="btn btn-danger-outline btn-sm" onClick={() => setAnon(true)}>
                    <Icon name="trash" size={16} /> Anonimizar
                  </button>
                </>
              )}
            </div>
          )}
          <div>
            <h3 className="section-title">Agendamentos</h3>
            {q.data!.appointments.length === 0 ? (
              <p className="muted">Nenhum.</p>
            ) : (
              <ul className="appt-list panel">
                {q.data!.appointments.map((a) => (
                  <li
                    key={a.id}
                    className={`appt-item ${a.status}`}
                    style={{ gridTemplateColumns: '120px 1fr auto' }}
                    tabIndex={0}
                    role="button"
                    onClick={() => (onClose(), open(a.id))}
                    onKeyDown={(e) => e.key === 'Enter' && (onClose(), open(a.id))}
                  >
                    <span className="appt-time" style={{ fontSize: '0.88rem' }}>
                      {fmtDateTime(a.start, timezone)}
                    </span>
                    <span className="appt-who">
                      <strong>{a.serviceName}</strong>
                      <span>
                        {a.professionalName} · {a.code}
                      </span>
                    </span>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {q.data!.consents.length > 0 && (
            <div>
              <h3 className="section-title">Consentimentos registrados</h3>
              <ul className="timeline-list">
                {q.data!.consents.map((c, i) => (
                  <li key={i}>
                    <div>
                      {c.type === 'PRIVACY_POLICY' ? 'Política de privacidade' : 'Receber mensagens'} · versão {c.version}
                      <div className="muted">{fmtDateTime(c.createdAt, timezone)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {anon && (
        <ConfirmDialog
          title="Anonimizar paciente?"
          danger
          confirmLabel="Anonimizar definitivamente"
          message="Nome, telefone, e-mail, CPF e observações serão apagados de forma irreversível. O histórico de agendamentos é mantido sem identificação (LGPD)."
          onClose={() => setAnon(false)}
          onConfirm={async () => {
            await api.post(`/api/admin/patients/${id}/anonymize`, { confirm: confirmText });
            setAnon(false);
            toast('Paciente anonimizado.');
            q.reload();
            onChanged();
          }}
        >
          <Field label='Digite "ANONIMIZAR" para confirmar'>
            {(fid) => <input id={fid} className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />}
          </Field>
        </ConfirmDialog>
      )}
    </Dialog>
  );
}
