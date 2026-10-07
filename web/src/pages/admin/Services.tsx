import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Alert, Dialog, Field, Loading, Spinner, useToast } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { CATEGORY_LABEL, money } from '../../lib/format';
import { useTitle } from '../../lib/hooks';
import { useCatalog } from './context';
import type { AdminService } from './types';

const EMPTY: Omit<AdminService, 'id' | 'slug'> = {
  name: '',
  category: 'CONSULTA',
  description: '',
  preparation: '',
  durationMinutes: 30,
  allowChooseProfessional: true,
  priceCents: null,
  showPrice: false,
  icon: 'stethoscope',
  active: true,
  sortOrder: 0,
  professionalIds: [],
};

export function Services() {
  useTitle('Serviços');
  const { services, professionals, loading } = useCatalog();
  const [editing, setEditing] = useState<AdminService | 'new' | null>(null);
  if (loading && !services.length) return <Loading />;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Serviços</h1>
          <p>Consultas, atendimentos e exames oferecidos no agendamento online.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={18} /> Novo serviço
          </button>
        </div>
      </div>
      <div className="panel table-wrap">
        <table className="table table-click">
          <thead>
            <tr>
              <th>Serviço</th>
              <th>Tipo</th>
              <th className="num">Duração</th>
              <th>Profissionais</th>
              <th>Escolha do profissional</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id} onClick={() => setEditing(s)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEditing(s)}>
                <td>
                  <strong>{s.name}</strong>
                  {s.priceCents != null && s.showPrice && <div className="muted">{money(s.priceCents)}</div>}
                </td>
                <td>{CATEGORY_LABEL[s.category]}</td>
                <td className="num">{s.durationMinutes} min</td>
                <td>
                  {s.professionalIds.length ? (
                    `${professionals.filter((p) => s.professionalIds.includes(p.id) && p.active).length} ativo(s)`
                  ) : (
                    <span className="pill warn">nenhum</span>
                  )}
                </td>
                <td>{s.allowChooseProfessional ? 'Paciente escolhe' : 'Sistema escolhe'}</td>
                <td>{s.active ? <span className="pill ok">Ativo</span> : <span className="pill">Inativo</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <ServiceEditor service={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ServiceEditor({ service, onClose }: { service: AdminService | null; onClose: () => void }) {
  const { professionals, reload } = useCatalog();
  const toast = useToast();
  const [f, setF] = useState(service ? { ...service } : { ...EMPTY });
  const [price, setPrice] = useState(service?.priceCents != null ? (service.priceCents / 100).toFixed(2).replace('.', ',') : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    const priceCents = price.trim() ? Math.round(Number(price.replace(/\./g, '').replace(',', '.')) * 100) : null;
    if (priceCents !== null && !Number.isFinite(priceCents)) {
      setBusy(false);
      return setFields({ priceCents: 'Valor inválido.' });
    }
    const body = {
      name: f.name,
      category: f.category,
      description: f.description,
      preparation: f.preparation,
      durationMinutes: Number(f.durationMinutes),
      allowChooseProfessional: f.allowChooseProfessional,
      priceCents,
      showPrice: f.showPrice,
      icon: f.icon,
      active: f.active,
      sortOrder: Number(f.sortOrder) || 0,
    };
    try {
      let id = service?.id;
      if (service) await api.put(`/api/admin/services/${service.id}`, body);
      else id = (await api.post<{ id: string }>('/api/admin/services', body)).id;
      await api.put(`/api/admin/services/${id}/professionals`, { professionalIds: f.professionalIds });
      toast('Serviço salvo.');
      reload();
      onClose();
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      setFields(err.fields);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={service ? service.name : 'Novo serviço'}
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
      <div className="form-stack">
        <div className="grid-3">
          <Field label="Nome" error={fields.name}>
            {(id) => <input id={id} className="input" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={120} />}
          </Field>
          <Field label="Tipo">
            {(id) => (
              <select id={id} className="select" value={f.category} onChange={(e) => set('category', e.target.value as AdminService['category'])}>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Duração da consulta" error={fields.durationMinutes}>
            {(id) => (
              <select id={id} className="select" value={f.durationMinutes} onChange={(e) => set('durationMinutes', Number(e.target.value))}>
                {[10, 15, 20, 30, 40, 45, 50, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {m} minutos
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Field label="Descrição curta (aparece no site)" optional>
          {(id) => <input id={id} className="input" value={f.description} maxLength={500} onChange={(e) => set('description', e.target.value)} />}
        </Field>
        <Field label="Instruções de preparo" optional hint="Enviadas automaticamente na confirmação e no lembrete. Ex.: jejum de 8 horas.">
          {(id, d) => <textarea id={id} className="textarea" rows={3} aria-describedby={d} value={f.preparation} maxLength={1000} onChange={(e) => set('preparation', e.target.value)} />}
        </Field>
        <div className="grid-2">
          <Field label="Valor" optional error={fields.priceCents} hint="Exibido no site só se marcado abaixo.">
            {(id, d) => <input id={id} className="input" inputMode="decimal" placeholder="0,00" aria-describedby={d} value={price} onChange={(e) => setPrice(e.target.value)} />}
          </Field>
          <Field label="Ordem de exibição">
            {(id) => <input id={id} className="input" type="number" min={0} value={f.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value))} />}
          </Field>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <label className="check">
            <input type="checkbox" checked={f.allowChooseProfessional} onChange={(e) => set('allowChooseProfessional', e.target.checked)} />
            <span>
              <strong>Paciente escolhe o profissional</strong> — desmarque para exames/serviços em que qualquer profissional pode atender (o sistema distribui
              automaticamente e a etapa é pulada).
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={f.showPrice} onChange={(e) => set('showPrice', e.target.checked)} />
            <span>Mostrar valor no site</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />
            <span>
              <strong>Ativo</strong> — serviços inativos não aparecem para os pacientes
            </span>
          </label>
        </div>
        <div>
          <div className="field-label" style={{ marginBottom: 8 }}>
            Profissionais que realizam
          </div>
          <div className="check-grid">
            {professionals
              .filter((p) => p.active || f.professionalIds.includes(p.id))
              .map((p) => (
                <label key={p.id} className="check-card">
                  <input
                    type="checkbox"
                    checked={f.professionalIds.includes(p.id)}
                    onChange={(e) =>
                      set('professionalIds', e.target.checked ? [...f.professionalIds, p.id] : f.professionalIds.filter((x) => x !== p.id))
                    }
                  />
                  <span className="dot" style={{ background: p.color }} />
                  <span>{[p.title, p.name].filter(Boolean).join(' ')}</span>
                </label>
              ))}
          </div>
        </div>
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Dialog>
  );
}
