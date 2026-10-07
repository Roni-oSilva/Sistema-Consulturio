import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Alert, ConfirmDialog, Dialog, EmptyState, Field, Loading, Spinner, useToast } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { WEEKDAYS, WEEKDAYS_SHORT, fmtDateBR, formatPhoneDigits } from '../../lib/format';
import { useTitle } from '../../lib/hooks';
import { ProPhoto } from '../public/shared';
import { useCatalog } from './context';
import type { AdminProfessional } from './types';

type Sched = { weekday: number; start: string; end: string };

const EMPTY: Omit<AdminProfessional, 'id'> = {
  name: '',
  title: 'Dr.',
  specialty: '',
  registry: '',
  showRegistry: true,
  bio: '',
  photoUrl: null,
  color: '#1B2A47',
  notifyPhone: '',
  notifyEmail: '',
  dailyAgenda: true,
  active: true,
  sortOrder: 0,
  services: [],
  schedules: [],
  overrides: [],
};

const COLORS = ['#1B2A47', '#B23A48', '#C27C5B', '#3D8B6D', '#4A6FA5', '#A0527E', '#8C6D1F', '#5B8C3D', '#6B5B95', '#2E7D8C', '#7A4E9C', '#3A7CA5'];

export function Professionals() {
  useTitle('Profissionais');
  const { professionals, services, loading } = useCatalog();
  const [editing, setEditing] = useState<AdminProfessional | 'new' | null>(null);

  if (loading && !professionals.length) return <Loading />;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Profissionais</h1>
          <p>Dados, serviços atendidos, horários de atendimento, horários especiais e agenda diária automática.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={18} /> Novo profissional
          </button>
        </div>
      </div>
      {professionals.length === 0 ? (
        <div className="panel">
          <EmptyState icon="stethoscope" title="Nenhum profissional cadastrado">
            Cadastre os profissionais para que os horários apareçam aos pacientes.
          </EmptyState>
        </div>
      ) : (
        <div className="panel table-wrap">
          <table className="table table-click">
            <thead>
              <tr>
                <th>Profissional</th>
                <th>Serviços</th>
                <th>Dias de atendimento</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {professionals.map((p) => (
                <tr key={p.id} onClick={() => setEditing(p)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEditing(p)}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <ProPhoto pro={p} size={40} />
                      <div>
                        <strong>{[p.title, p.name].filter(Boolean).join(' ')}</strong>
                        <div className="muted" style={{ fontSize: '0.85rem' }}>
                          {p.specialty} {p.registry && `· ${p.registry}`}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ maxWidth: 260 }}>
                    {p.services
                      .map((s) => services.find((x) => x.id === s.serviceId)?.name)
                      .filter(Boolean)
                      .join(', ') || <span className="pill warn">nenhum</span>}
                  </td>
                  <td>
                    {p.schedules.length ? (
                      [...new Set(p.schedules.map((s) => s.weekday))]
                        .sort()
                        .map((w) => WEEKDAYS_SHORT[w - 1])
                        .join(', ')
                    ) : (
                      <span className="pill warn">sem horário</span>
                    )}
                  </td>
                  <td>{p.active ? <span className="pill ok">Ativo</span> : <span className="pill">Inativo</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ProfessionalEditor pro={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ProfessionalEditor({ pro, onClose }: { pro: AdminProfessional | null; onClose: () => void }) {
  const { services, reload } = useCatalog();
  const toast = useToast();
  const [f, setF] = useState(() => (pro ? { ...pro, notifyPhone: pro.notifyPhone ? formatPhoneDigits(pro.notifyPhone) : '' } : { ...EMPTY }));
  const [tab, setTab] = useState<'dados' | 'servicos' | 'horarios' | 'especiais'>('dados');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState(pro?.photoUrl ?? null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    setFields({});
    const body = {
      name: f.name,
      title: f.title,
      specialty: f.specialty,
      registry: f.registry,
      showRegistry: f.showRegistry,
      bio: f.bio,
      color: f.color,
      notifyPhone: f.notifyPhone,
      notifyEmail: f.notifyEmail,
      dailyAgenda: f.dailyAgenda,
      active: f.active,
      sortOrder: Number(f.sortOrder) || 0,
      serviceIds: f.services.map((s) => s.serviceId),
      serviceDurations: Object.fromEntries(f.services.map((s) => [s.serviceId, s.durationMinutes])),
      schedules: f.schedules,
    };
    try {
      if (pro) await api.put(`/api/admin/professionals/${pro.id}`, body);
      else await api.post('/api/admin/professionals', body);
      toast(pro ? 'Profissional atualizado.' : 'Profissional cadastrado.');
      reload();
      onClose();
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      setFields(err.fields);
      if (Object.keys(err.fields).some((k) => k.startsWith('schedules'))) setTab('horarios');
      else if (Object.keys(err.fields).length) setTab('dados');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={pro ? [pro.title, pro.name].filter(Boolean).join(' ') : 'Novo profissional'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !f.name.trim()}>
            {busy && <Spinner />} Salvar
          </button>
        </>
      }
    >
      <div className="tabs" role="tablist">
        {(
          [
            ['dados', 'Dados'],
            ['servicos', `Serviços (${f.services.length})`],
            ['horarios', 'Horários'],
            ...(pro ? [['especiais', 'Horários especiais']] : []),
          ] as [typeof tab, string][]
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div style={{ marginBottom: 12 }}>
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      {tab === 'dados' && (
        <div className="form-stack">
          {pro && (
            <div className="photo-edit">
              <ProPhoto pro={{ name: f.name, photoUrl: photo }} size={64} />
              <label className="btn btn-outline btn-sm">
                <Icon name="upload" size={16} /> Enviar foto
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const r = await api.upload<{ photoUrl: string }>(`/api/admin/professionals/${pro.id}/photo`, file);
                      setPhoto(r.photoUrl);
                      reload();
                      toast('Foto atualizada.');
                    } catch (err) {
                      toast((err as Error).message, 'error');
                    }
                  }}
                />
              </label>
              {photo && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    await api.del(`/api/admin/professionals/${pro.id}/photo`);
                    setPhoto(null);
                    reload();
                  }}
                >
                  Remover
                </button>
              )}
            </div>
          )}
          <div className="grid-3">
            <Field label="Título">
              {(id) => (
                <select id={id} className="select" value={f.title} onChange={(e) => set('title', e.target.value)}>
                  {['Dr.', 'Dra.', 'Ft.', 'Nutr.', 'Psic.', 'Enf.', ''].map((t) => (
                    <option key={t} value={t}>
                      {t || '(sem título)'}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Nome" error={fields.name} className="span-2">
              {(id) => <input id={id} className="input" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={120} />}
            </Field>
            <Field label="Especialidade">
              {(id) => <input id={id} className="input" value={f.specialty} placeholder="Ex.: Dermatologista" onChange={(e) => set('specialty', e.target.value)} />}
            </Field>
          </div>
          <div className="grid-2">
            <Field label="Registro profissional" optional hint="Ex.: CRM-PA 12345">
              {(id, d) => <input id={id} className="input" aria-describedby={d} value={f.registry} onChange={(e) => set('registry', e.target.value)} />}
            </Field>
            <div className="field" style={{ alignContent: 'end' }}>
              <label className="check">
                <input type="checkbox" checked={f.showRegistry} onChange={(e) => set('showRegistry', e.target.checked)} />
                <span>Exibir registro no site</span>
              </label>
            </div>
          </div>
          <Field label="Apresentação" optional>
            {(id) => <textarea id={id} className="textarea" rows={2} value={f.bio} maxLength={1000} onChange={(e) => set('bio', e.target.value)} />}
          </Field>
          <div className="field">
            <span className="field-label">Cor na agenda</span>
            <div className="btn-row" role="radiogroup" aria-label="Cor na agenda">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={f.color.toLowerCase() === c.toLowerCase()}
                  aria-label={c}
                  onClick={() => set('color', c)}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: c,
                    border: f.color.toLowerCase() === c.toLowerCase() ? '3px solid var(--lime-500)' : '2px solid #fff',
                    boxShadow: '0 0 0 1px var(--line-strong)',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-body form-stack">
              <strong>Agenda do dia automática</strong>
              <span className="muted" style={{ fontSize: '0.88rem' }}>
                Todo dia, no horário configurado, o profissional recebe a lista de pacientes do dia. Estes contatos nunca aparecem no site.
              </span>
              <div className="grid-2">
                <Field label="WhatsApp do profissional" optional error={fields.notifyPhone}>
                  {(id) => <input id={id} className="input" type="tel" value={f.notifyPhone} onChange={(e) => set('notifyPhone', e.target.value)} />}
                </Field>
                <Field label="E-mail do profissional" optional error={fields.notifyEmail}>
                  {(id) => <input id={id} className="input" type="email" value={f.notifyEmail} onChange={(e) => set('notifyEmail', e.target.value)} />}
                </Field>
              </div>
              <label className="check">
                <input type="checkbox" checked={f.dailyAgenda} onChange={(e) => set('dailyAgenda', e.target.checked)} />
                <span>Enviar agenda do dia</span>
              </label>
            </div>
          </div>
          <div className="grid-2">
            <Field label="Ordem de exibição" hint="Menor aparece primeiro.">
              {(id, d) => (
                <input id={id} className="input" type="number" min={0} aria-describedby={d} value={f.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value))} />
              )}
            </Field>
            <div className="field" style={{ alignContent: 'end' }}>
              <label className="check">
                <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />
                <span>
                  <strong>Ativo</strong> — desmarque para desativar (some do site; histórico é mantido)
                </span>
              </label>
            </div>
          </div>
          {pro && (
            <Link to={`/admin/bloqueios?prof=${pro.id}`} className="btn btn-outline">
              <Icon name="ban" size={18} /> Férias, folgas e bloqueios deste profissional
            </Link>
          )}
        </div>
      )}

      {tab === 'servicos' && (
        <div className="form-stack">
          <span className="muted">Marque os serviços que este profissional atende. A duração pode ser diferente da padrão do serviço.</span>
          <div className="stack" style={{ gap: 8 }}>
            {services
              .filter((s) => s.active || f.services.some((x) => x.serviceId === s.id))
              .map((s) => {
                const linked = f.services.find((x) => x.serviceId === s.id);
                return (
                  <div key={s.id} className="check-card" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <label className="check" style={{ alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={!!linked}
                        onChange={(e) =>
                          set(
                            'services',
                            e.target.checked ? [...f.services, { serviceId: s.id, durationMinutes: null }] : f.services.filter((x) => x.serviceId !== s.id),
                          )
                        }
                      />
                      <span>
                        <strong>{s.name}</strong> <span className="muted">· padrão {s.durationMinutes} min</span>
                      </span>
                    </label>
                    {linked && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem' }}>
                        Duração
                        <select
                          className="select"
                          style={{ width: 130, minHeight: 36 }}
                          value={linked.durationMinutes ?? ''}
                          onChange={(e) =>
                            set(
                              'services',
                              f.services.map((x) => (x.serviceId === s.id ? { ...x, durationMinutes: e.target.value ? Number(e.target.value) : null } : x)),
                            )
                          }
                        >
                          <option value="">Padrão</option>
                          {[10, 15, 20, 30, 40, 45, 50, 60, 90, 120].map((m) => (
                            <option key={m} value={m}>
                              {m} min
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {tab === 'horarios' && <WeekEditor value={f.schedules} onChange={(v) => set('schedules', v)} error={fields.schedules} />}

      {tab === 'especiais' && pro && <OverridesEditor pro={pro} />}
    </Dialog>
  );
}

export function WeekEditor({ value, onChange, error }: { value: Sched[]; onChange: (v: Sched[]) => void; error?: string }) {
  function update(wd: number, list: { start: string; end: string }[]) {
    onChange([...value.filter((s) => s.weekday !== wd), ...list.map((x) => ({ weekday: wd, ...x }))].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)));
  }
  const monday = value.filter((s) => s.weekday === 1);
  return (
    <div className="form-stack">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="muted">Defina os períodos de atendimento de cada dia. Ex.: 08:00–12:00 e 14:00–18:00.</span>
        {monday.length > 0 && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() =>
              onChange([
                ...value.filter((s) => s.weekday > 5),
                ...[1, 2, 3, 4, 5].flatMap((wd) => monday.map((m) => ({ weekday: wd, start: m.start, end: m.end }))),
              ].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)))
            }
          >
            <Icon name="copy" size={16} /> Copiar segunda para seg–sex
          </button>
        )}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="week-editor">
        {WEEKDAYS.map((label, i) => {
          const wd = i + 1;
          const list = value.filter((s) => s.weekday === wd);
          return (
            <div className="week-row" key={wd}>
              <div className="day">{label}</div>
              <div className="intervals">
                {list.length === 0 && <span className="muted" style={{ paddingTop: 8 }}>Não atende</span>}
                {list.map((iv, idx) => (
                  <div className="interval" key={idx}>
                    <input
                      type="time"
                      className="input"
                      aria-label={`${label} início ${idx + 1}`}
                      value={iv.start}
                      onChange={(e) => update(wd, list.map((x, j) => (j === idx ? { start: e.target.value, end: x.end } : { start: x.start, end: x.end })))}
                    />
                    <span>às</span>
                    <input
                      type="time"
                      className="input"
                      aria-label={`${label} fim ${idx + 1}`}
                      value={iv.end}
                      onChange={(e) => update(wd, list.map((x, j) => (j === idx ? { start: x.start, end: e.target.value } : { start: x.start, end: x.end })))}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      aria-label="Remover período"
                      onClick={() => update(wd, list.filter((_, j) => j !== idx).map((x) => ({ start: x.start, end: x.end })))}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                ))}
                <div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const last = list[list.length - 1];
                      const next = last ? { start: last.end < '14:00' ? '14:00' : last.end, end: last.end < '14:00' ? '18:00' : '20:00' } : { start: '08:00', end: '12:00' };
                      update(wd, [...list.map((x) => ({ start: x.start, end: x.end })), next]);
                    }}
                  >
                    <Icon name="plus" size={16} /> Adicionar período
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OverridesEditor({ pro }: { pro: AdminProfessional }) {
  const { reload, professionals } = useCatalog();
  const toast = useToast();
  const current = professionals.find((p) => p.id === pro.id) ?? pro;
  const [date, setDate] = useState('');
  const [off, setOff] = useState(false);
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('12:00');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [del, setDel] = useState<string | null>(null);

  return (
    <div className="form-stack">
      <span className="muted">
        Use para um dia com horário diferente do normal (ex.: sábado extra, plantão, saída mais cedo). O horário especial substitui a grade semanal
        naquele dia. Para férias e folgas, use <Link to={`/admin/bloqueios?prof=${pro.id}`}>Bloqueios</Link>.
      </span>
      <div className="panel">
        <div className="panel-body form-stack">
          <div className="grid-3">
            <Field label="Data">
              {(id) => <input id={id} type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
            {!off && (
              <>
                <Field label="Início">
                  {(id) => <input id={id} type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} />}
                </Field>
                <Field label="Fim">
                  {(id) => <input id={id} type="time" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />}
                </Field>
              </>
            )}
          </div>
          <label className="check">
            <input type="checkbox" checked={off} onChange={(e) => setOff(e.target.checked)} />
            <span>Não atende neste dia</span>
          </label>
          <Field label="Observação" optional>
            {(id) => <input id={id} className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />}
          </Field>
          {error && <Alert kind="error">{error}</Alert>}
          <div>
            <button
              className="btn btn-primary btn-sm"
              disabled={!date}
              onClick={async () => {
                setError(null);
                try {
                  await api.post(`/api/admin/professionals/${pro.id}/overrides`, { date, start: off ? null : start, end: off ? null : end, note });
                  toast('Horário especial adicionado.');
                  setDate('');
                  setNote('');
                  reload();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Icon name="plus" size={16} /> Adicionar
            </button>
          </div>
        </div>
      </div>
      {current.overrides.length === 0 ? (
        <p className="muted">Nenhum horário especial futuro.</p>
      ) : (
        <ul className="appt-list panel">
          {current.overrides.map((o) => (
            <li key={o.id} className="appt-item" style={{ gridTemplateColumns: '110px 1fr auto', cursor: 'default' }}>
              <span className="appt-time" style={{ fontSize: '0.95rem' }}>
                {fmtDateBR(o.date)}
              </span>
              <span className="appt-who">
                <strong>{o.start ? `${o.start} às ${o.end}` : 'Não atende'}</strong>
                {o.note && <span>{o.note}</span>}
              </span>
              <button className="btn btn-ghost btn-icon btn-sm" aria-label="Remover" onClick={() => setDel(o.id)}>
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {del && (
        <ConfirmDialog
          title="Remover horário especial?"
          message="O dia volta a seguir a grade semanal normal."
          confirmLabel="Remover"
          danger
          onClose={() => setDel(null)}
          onConfirm={async () => {
            await api.del(`/api/admin/professionals/${pro.id}/overrides/${del}`);
            setDel(null);
            reload();
            toast('Removido.');
          }}
        />
      )}
    </div>
  );
}
