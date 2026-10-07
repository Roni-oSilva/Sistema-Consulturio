import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon, WhatsAppIcon } from '../../components/Icon';
import { Alert, EmptyState, ErrorState, Field, Loading, Spinner, useToast } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { fmtDateTime, formatPhoneDigits } from '../../lib/format';
import { useAsync, useTitle } from '../../lib/hooks';
import { NOTIF_TYPE } from './AppointmentPanel';
import { useAdmin } from './context';

type Tab = 'enviar' | 'historico' | 'automacao' | 'modelos';
type ManualMsg = { id: string; type: string; audience: string; recipient: string; patientName: string | null; code: string | null; scheduledFor: string; body: string; waLink: string };
type Notif = {
  id: string;
  type: string;
  channel: string;
  audience: string;
  recipient: string;
  status: string;
  scheduledFor: string;
  sentAt: string | null;
  attempts: number;
  lastError: string;
  patientName: string | null;
  code: string | null;
};

const STATUS_PILL: Record<string, [string, string]> = {
  PENDING: ['Agendada', 'warn'],
  PROCESSING: ['Enviando', 'warn'],
  SENT: ['Enviada', 'ok'],
  FAILED: ['Falhou', 'bad'],
  CANCELLED: ['Cancelada', ''],
  MANUAL: ['Envio manual', 'warn'],
};
const CHANNEL: Record<string, string> = { WHATSAPP: 'WhatsApp', EMAIL: 'E-mail', SMS: 'SMS' };
const PROVIDER_LABEL: Record<string, string> = {
  manual: 'Manual (1 clique)',
  evolution: 'Evolution API',
  zapi: 'Z-API',
  twilio: 'Twilio',
  meta: 'WhatsApp Cloud API (Meta)',
  webhook: 'Webhook',
  log: 'Teste (log)',
  none: 'Não configurado',
  smtp: 'SMTP',
};

export function Messages({ onChange }: { onChange: () => void }) {
  useTitle('Mensagens');
  const { can } = useAdmin();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('aba') as Tab) || 'enviar';
  const tabs: [Tab, string, boolean][] = [
    ['enviar', 'Para enviar', true],
    ['historico', 'Histórico', true],
    ['automacao', 'Automação', can('settings:write')],
    ['modelos', 'Modelos de mensagem', can('templates:write')],
  ];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mensagens</h1>
          <p>Confirmações, lembretes e avisos são enviados automaticamente.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {tabs
          .filter((t) => t[2])
          .map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams({ aba: k }, { replace: true })}>
              {label}
            </button>
          ))}
      </div>
      {tab === 'enviar' && <ManualQueue onChange={onChange} />}
      {tab === 'historico' && <History />}
      {tab === 'automacao' && can('settings:write') && <Automation />}
      {tab === 'modelos' && can('templates:write') && <Templates />}
    </>
  );
}

function ManualQueue({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const q = useAsync((signal) => api.get<{ messages: ManualMsg[] }>('/api/admin/notifications/manual', { signal }), []);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  async function markSent(m: ManualMsg) {
    setHidden((h) => new Set(h).add(m.id));
    try {
      await api.post(`/api/admin/notifications/${m.id}/mark-sent`);
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  async function discard(m: ManualMsg) {
    setHidden((h) => new Set(h).add(m.id));
    await api.post(`/api/admin/notifications/${m.id}/cancel`).catch(() => {});
    onChange();
  }

  if (q.loading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  const list = q.data!.messages.filter((m) => !hidden.has(m.id));
  return (
    <div className="stack">
      <Alert kind="info">
        Sem uma API de WhatsApp contratada, as mensagens automáticas ficam aqui prontas. Clique em <strong>Enviar pelo WhatsApp</strong>: o WhatsApp abre com o texto
        preenchido — é só tocar em enviar. Para envio 100% automático, configure um provedor (veja a aba Automação).
      </Alert>
      {list.length === 0 ? (
        <div className="panel">
          <EmptyState icon="checkCircle" title="Tudo enviado!">
            Nenhuma mensagem aguardando.
          </EmptyState>
        </div>
      ) : (
        list.map((m) => (
          <article key={m.id} className="panel">
            <div className="panel-head" style={{ flexWrap: 'wrap' }}>
              <div>
                <h2>{NOTIF_TYPE[m.type] ?? m.type}</h2>
                <span className="muted" style={{ fontSize: '0.85rem' }}>
                  {m.audience === 'PATIENT' ? `Para ${m.patientName ?? 'paciente'}` : m.audience === 'CLINIC' ? 'Para a clínica' : 'Para o profissional'} · {m.recipient}
                  {m.code && ` · ${m.code}`}
                </span>
              </div>
              <div className="btn-row">
                <a className="btn btn-whatsapp btn-sm" href={m.waLink} target="_blank" rel="noopener noreferrer" onClick={() => markSent(m)}>
                  <WhatsAppIcon size={16} /> Enviar pelo WhatsApp
                </a>
                <button className="btn btn-ghost btn-sm" onClick={() => markSent(m)}>
                  <Icon name="check" size={16} /> Já enviei
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => discard(m)}>
                  Descartar
                </button>
              </div>
            </div>
            <div className="panel-body">
              <div className="wa-preview">
                <div className="wa-bubble">{m.body}</div>
              </div>
            </div>
          </article>
        ))
      )}
    </div>
  );
}

function History() {
  const { timezone, can } = useAdmin();
  const toast = useToast();
  const [params] = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const q = useAsync(
    (signal) => api.get<{ notifications: Notif[]; providers: Record<string, string> }>(`/api/admin/notifications${qs({ status: status || null })}`, { signal }),
    [status],
  );
  return (
    <div className="stack">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por situação">
          <option value="">Todas</option>
          {Object.entries(STATUS_PILL).map(([k, [label]]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <button className="btn btn-outline btn-sm" onClick={q.reload}>
          <Icon name="refresh" size={16} /> Atualizar
        </button>
      </div>
      <div className="panel table-wrap">
        {q.loading ? (
          <Loading />
        ) : q.error ? (
          <div className="panel-body">
            <ErrorState error={q.error} />
          </div>
        ) : !q.data!.notifications.length ? (
          <EmptyState icon="message" title="Nenhuma mensagem" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Mensagem</th>
                <th>Canal</th>
                <th>Para</th>
                <th>Quando</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data!.notifications.map((n) => (
                <tr key={n.id}>
                  <td>
                    <strong>{NOTIF_TYPE[n.type] ?? n.type}</strong>
                    {n.patientName && <div className="muted">{n.patientName}</div>}
                  </td>
                  <td>{CHANNEL[n.channel]}</td>
                  <td className="num">{n.channel === 'EMAIL' ? n.recipient : formatPhoneDigits(n.recipient)}</td>
                  <td className="num">{fmtDateTime(n.sentAt ?? n.scheduledFor, timezone)}</td>
                  <td>
                    <span className={`pill ${STATUS_PILL[n.status]?.[1] ?? ''}`}>{STATUS_PILL[n.status]?.[0] ?? n.status}</span>
                    {n.lastError && n.status !== 'SENT' && (
                      <div className="muted" style={{ fontSize: '0.8rem', maxWidth: 260 }}>
                        {n.lastError}
                      </div>
                    )}
                  </td>
                  <td>
                    {n.status === 'FAILED' && can('notifications:write') && (
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={async () => {
                          const r = await api.post<{ status: string; lastError: string }>(`/api/admin/notifications/${n.id}/retry`);
                          toast(r.status === 'SENT' ? 'Mensagem enviada.' : `Situação: ${STATUS_PILL[r.status]?.[0] ?? r.status}`, r.status === 'FAILED' ? 'error' : 'ok');
                          q.reload();
                        }}
                      >
                        <Icon name="refresh" size={14} /> Tentar de novo
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

type Settings = Record<string, string | number | boolean | null>;

function Automation() {
  const toast = useToast();
  const q = useAsync((signal) => api.get<{ settings: Settings; providers: Record<string, string> }>('/api/admin/settings', { signal }), []);
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState({ channel: 'WHATSAPP', recipient: '' });
  const [testResult, setTestResult] = useState<{ kind: 'success' | 'error'; text: string; link?: string } | null>(null);

  useEffect(() => {
    if (q.data) setS(q.data.settings);
  }, [q.data]);

  if (q.loading || !s) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const providers = q.data!.providers;
  const b = (k: string) => !!s[k];
  const n = (k: string) => Number(s[k] ?? 0);
  const setK = (k: string, v: string | number | boolean) => setS({ ...s, [k]: v });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const keys = [
        'whatsapp_enabled', 'email_enabled', 'sms_enabled', 'reminder1_hours', 'reminder2_hours', 'post_visit_enabled', 'post_visit_delay_hours',
        'no_show_message_enabled', 'review_url', 'clinic_notify_enabled', 'clinic_notify_whatsapp', 'clinic_notify_email', 'daily_agenda_enabled',
        'daily_agenda_time', 'auto_cancel_unconfirmed_hours', 'auto_complete_after_hours', 'initial_status',
      ];
      await api.put('/api/admin/settings', Object.fromEntries(keys.map((k) => [k, s![k]])));
      toast('Automação salva.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (k: string, title: string, desc: string) => (
    <label className="setting-row switch" key={k}>
      <span className="txt">
        <strong>{title}</strong>
        <span>{desc}</span>
      </span>
      <input type="checkbox" checked={b(k)} onChange={(e) => setK(k, e.target.checked)} />
    </label>
  );
  const hours = (k: string, title: string, desc: string, options: number[]) => (
    <div className="setting-row" key={k}>
      <span className="txt">
        <strong>{title}</strong>
        <span>{desc}</span>
      </span>
      <select className="select" value={n(k)} onChange={(e) => setK(k, Number(e.target.value))} aria-label={title}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o === 0 ? 'Desligado' : `${o} h`}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="dash-grid">
      <div className="stack">
        <section className="panel">
          <div className="panel-head">
            <h2>Mensagens ao paciente</h2>
          </div>
          <div className="panel-body">
            <div className="setting-row">
              <span className="txt">
                <strong>Novo agendamento online</strong>
                <span>Pendente = aguarda o paciente confirmar presença pelo lembrete. Confirmado = já entra confirmado.</span>
              </span>
              <select className="select" style={{ width: 150 }} value={String(s.initial_status)} onChange={(e) => setK('initial_status', e.target.value)} aria-label="Status inicial">
                <option value="PENDING">Pendente</option>
                <option value="CONFIRMED">Confirmado</option>
              </select>
            </div>
            <div className="setting-row" style={{ display: 'block' }}>
              <strong>Confirmação</strong>
              <div className="muted" style={{ fontSize: '0.86rem' }}>
                Enviada sempre, na hora do agendamento, com código, endereço, preparo e link para confirmar/remarcar/cancelar.
              </div>
            </div>
            {hours('reminder1_hours', 'Lembrete com confirmação de presença', 'Quantas horas antes do atendimento.', [0, 12, 24, 36, 48, 72])}
            {hours('reminder2_hours', 'Lembrete de última hora', 'Ex.: 2 horas antes.', [0, 1, 2, 3, 4, 6])}
            {toggle('post_visit_enabled', 'Agradecimento pós-atendimento', 'Enviado após marcar como concluído, com link de avaliação.')}
            {b('post_visit_enabled') && hours('post_visit_delay_hours', 'Enviar agradecimento após', 'Horas depois do fim do atendimento.', [0, 1, 2, 3, 6, 24])}
            {toggle('no_show_message_enabled', 'Mensagem de falta', 'Convida o paciente que faltou a remarcar.')}
            <div className="setting-row" style={{ display: 'grid', gap: 6 }}>
              <span className="txt">
                <strong>Link de avaliação (Google)</strong>
                <span>Usado na mensagem pós-atendimento.</span>
              </span>
              <input className="input" style={{ width: '100%' }} value={String(s.review_url ?? '')} placeholder="https://g.page/r/..." onChange={(e) => setK('review_url', e.target.value)} />
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Automação da agenda</h2>
          </div>
          <div className="panel-body">
            {hours('auto_cancel_unconfirmed_hours', 'Liberar horário de quem não confirmou', 'Cancela PENDENTES que não confirmaram presença após o lembrete, quando faltarem estas horas. O paciente é avisado.', [0, 2, 4, 6, 12, 24])}
            {hours('auto_complete_after_hours', 'Concluir atendimentos automaticamente', 'Marca como concluídos os CONFIRMADOS após o horário (faltas precisam ser marcadas antes).', [0, 1, 2, 4, 12, 24])}
            {toggle('daily_agenda_enabled', 'Agenda do dia para os profissionais', 'Envia a lista de pacientes do dia (configure o contato em cada profissional).')}
            {b('daily_agenda_enabled') && (
              <div className="setting-row">
                <span className="txt">
                  <strong>Horário de envio</strong>
                </span>
                <input type="time" className="input" value={String(s.daily_agenda_time)} onChange={(e) => setK('daily_agenda_time', e.target.value)} aria-label="Horário de envio" />
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="stack">
        <section className="panel">
          <div className="panel-head">
            <h2>Canais</h2>
          </div>
          <div className="panel-body">
            {(
              [
                ['whatsapp_enabled', 'WhatsApp', providers.whatsapp],
                ['email_enabled', 'E-mail', providers.email],
                ['sms_enabled', 'SMS', providers.sms],
              ] as const
            ).map(([k, label, prov]) => (
              <label key={k} className="setting-row switch">
                <span className="txt">
                  <strong>{label}</strong>
                  <span>
                    Provedor: <span className={`pill ${prov === 'none' ? 'bad' : prov === 'manual' ? 'warn' : 'ok'}`}>{PROVIDER_LABEL[prov] ?? prov}</span>
                  </span>
                </span>
                <input type="checkbox" checked={b(k)} onChange={(e) => setK(k, e.target.checked)} />
              </label>
            ))}
            <p className="muted" style={{ fontSize: '0.84rem' }}>
              Provedores e chaves de API são configurados no servidor (arquivo <span className="code">.env</span>) por segurança — veja o README.
            </p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Avisos para a recepção</h2>
          </div>
          <div className="panel-body form-stack">
            {toggle('clinic_notify_enabled', 'Avisar a clínica', 'Novo agendamento online, cancelamento e remarcação feitos pelo paciente.')}
            <Field label="WhatsApp da recepção" optional>
              {(id) => <input id={id} className="input" value={String(s.clinic_notify_whatsapp ?? '')} onChange={(e) => setK('clinic_notify_whatsapp', e.target.value)} />}
            </Field>
            <Field label="E-mail da recepção" optional>
              {(id) => <input id={id} className="input" type="email" value={String(s.clinic_notify_email ?? '')} onChange={(e) => setK('clinic_notify_email', e.target.value)} />}
            </Field>
          </div>
        </section>

        {error && <Alert kind="error">{error}</Alert>}
        <button className="btn btn-primary btn-lg" onClick={save} disabled={busy}>
          {busy && <Spinner />} Salvar automação
        </button>

        <section className="panel">
          <div className="panel-head">
            <h2>Testar envio</h2>
          </div>
          <div className="panel-body form-stack">
            <div className="grid-2">
              <Field label="Canal">
                {(id) => (
                  <select id={id} className="select" value={test.channel} onChange={(e) => setTest({ ...test, channel: e.target.value })}>
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="EMAIL">E-mail</option>
                    <option value="SMS">SMS</option>
                  </select>
                )}
              </Field>
              <Field label={test.channel === 'EMAIL' ? 'E-mail' : 'Telefone'}>
                {(id) => <input id={id} className="input" value={test.recipient} onChange={(e) => setTest({ ...test, recipient: e.target.value })} />}
              </Field>
            </div>
            {testResult && (
              <Alert kind={testResult.kind}>
                {testResult.text}{' '}
                {testResult.link && (
                  <a href={testResult.link} target="_blank" rel="noopener noreferrer">
                    Abrir WhatsApp
                  </a>
                )}
              </Alert>
            )}
            <div>
              <button
                className="btn btn-outline btn-sm"
                disabled={!test.recipient}
                onClick={async () => {
                  setTestResult(null);
                  try {
                    const r = await api.post<{ ok: boolean; manual?: boolean; waLink?: string; provider?: string }>('/api/admin/templates/test', test);
                    setTestResult(
                      r.manual
                        ? { kind: 'success', text: 'Modo manual: o envio é feito com 1 clique.', link: r.waLink }
                        : { kind: 'success', text: `Enviado via ${PROVIDER_LABEL[r.provider ?? ''] ?? r.provider}.` },
                    );
                  } catch (e) {
                    setTestResult({ kind: 'error', text: (e as Error).message });
                  }
                }}
              >
                <Icon name="send" size={16} /> Enviar teste
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

type Template = { type: string; channel: string; subject: string; body: string; enabled: boolean };

function Templates() {
  const toast = useToast();
  const q = useAsync(
    (signal) => api.get<{ templates: Template[]; types: Record<string, { label: string; audience: string }>; variables: Record<string, string> }>('/api/admin/templates', { signal }),
    [],
  );
  const [sel, setSel] = useState<{ type: string; channel: string } | null>(null);
  const [draft, setDraft] = useState<Template | null>(null);
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.data || !sel) return;
    const t = q.data.templates.find((x) => x.type === sel.type && x.channel === sel.channel);
    setDraft(t ? { ...t } : { type: sel.type, channel: sel.channel, subject: '', body: '', enabled: true });
  }, [sel, q.data]);

  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(() => {
      api
        .post<{ subject: string; body: string }>('/api/admin/templates/preview', { subject: draft.subject, body: draft.body })
        .then(setPreview)
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [draft?.body, draft?.subject]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.loading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const { templates, types, variables } = q.data!;

  return (
    <div className="dash-grid" style={{ gridTemplateColumns: undefined }}>
      <section className="panel">
        <div className="panel-head">
          <h2>Modelos</h2>
        </div>
        <ul className="appt-list">
          {Object.entries(types).map(([type, info]) => (
            <li key={type} style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <strong>{info.label}</strong>
              <div className="btn-row" style={{ marginTop: 6 }}>
                {['WHATSAPP', 'EMAIL', 'SMS'].map((ch) => {
                  const t = templates.find((x) => x.type === type && x.channel === ch);
                  if (!t) return null;
                  const active = sel?.type === type && sel.channel === ch;
                  return (
                    <button key={ch} className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline'}`} onClick={() => setSel({ type, channel: ch })}>
                      {CHANNEL[ch]} {!t.enabled && <span className="pill">off</span>}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>{sel ? `${types[sel.type]?.label} · ${CHANNEL[sel.channel]}` : 'Selecione um modelo'}</h2>
        </div>
        <div className="panel-body form-stack">
          {!draft ? (
            <p className="muted">Escolha um modelo à esquerda para editar o texto.</p>
          ) : (
            <>
              <label className="check">
                <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                <span>Enviar esta mensagem automaticamente</span>
              </label>
              {draft.channel === 'EMAIL' && (
                <Field label="Assunto">
                  {(id) => <input id={id} className="input" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />}
                </Field>
              )}
              <Field label="Texto">
                {(id) => (
                  <textarea id={id} className="textarea" rows={12} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} style={{ fontFamily: 'inherit' }} />
                )}
              </Field>
              <div>
                <div className="field-label" style={{ marginBottom: 6 }}>
                  Variáveis (clique para inserir)
                </div>
                <div className="var-chips">
                  {Object.entries(variables).map(([k, desc]) => (
                    <button key={k} type="button" className="var-chip" title={desc} onClick={() => setDraft({ ...draft, body: `${draft.body}{{${k}}}` })}>
                      {`{{${k}}}`}
                    </button>
                  ))}
                </div>
              </div>
              {preview && (
                <div>
                  <div className="field-label" style={{ marginBottom: 6 }}>
                    Pré-visualização
                  </div>
                  <div className="wa-preview">
                    {draft.channel === 'EMAIL' && preview.subject && (
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>{preview.subject}</div>
                    )}
                    <div className="wa-bubble">{preview.body}</div>
                  </div>
                </div>
              )}
              <div className="btn-row">
                <button
                  className="btn btn-primary"
                  disabled={busy || !draft.body.trim()}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api.put(`/api/admin/templates/${draft.type}/${draft.channel}`, { subject: draft.subject, body: draft.body, enabled: draft.enabled });
                      toast('Modelo salvo.');
                      q.reload();
                    } catch (e) {
                      toast((e as Error).message, 'error');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy && <Spinner />} Salvar modelo
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={async () => {
                    await api.post(`/api/admin/templates/${draft.type}/${draft.channel}/reset`);
                    toast('Texto padrão restaurado.');
                    q.reload();
                  }}
                >
                  Restaurar padrão
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
