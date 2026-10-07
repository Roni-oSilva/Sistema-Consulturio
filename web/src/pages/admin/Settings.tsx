import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { LogoMark } from '../../components/Logo';
import { Alert, ErrorState, Field, Loading, Spinner, useToast } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { useAsync, useTitle } from '../../lib/hooks';

type S = Record<string, string | number | boolean | null>;

export function SettingsPage() {
  useTitle('Configurações');
  const toast = useToast();
  const q = useAsync((signal) => api.get<{ settings: S }>('/api/admin/settings', { signal }), []);
  const [s, setS] = useState<S | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (q.data) setS(q.data.settings);
  }, [q.data]);

  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (q.loading || !s) return <Loading />;

  const str = (k: string) => String(s[k] ?? '');
  const num = (k: string) => Number(s[k] ?? 0);
  const set = (k: string, v: string | number | boolean) => setS({ ...s, [k]: v });

  async function save() {
    setBusy(true);
    setError(null);
    setFields({});
    const keys = [
      'name', 'short_name', 'tagline', 'description', 'phone', 'whatsapp', 'email', 'address', 'maps_url', 'instagram', 'opening_hours', 'timezone',
      'default_duration_minutes', 'min_advance_minutes', 'max_advance_days', 'cancel_min_hours', 'allow_patient_reschedule', 'require_cpf',
      'require_birth_date', 'require_email', 'max_active_per_phone', 'max_bookings_per_ip_day', 'booking_notice', 'privacy_policy', 'privacy_policy_version',
    ];
    try {
      await api.put('/api/admin/settings', Object.fromEntries(keys.map((k) => [k, s![k]])));
      toast('Configurações salvas.');
      q.reload();
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      setFields(err.fields);
    } finally {
      setBusy(false);
    }
  }

  const text = (k: string, label: string, opts: { hint?: string; optional?: boolean; type?: string; placeholder?: string } = {}) => (
    <Field label={label} hint={opts.hint} optional={opts.optional} error={fields[k]}>
      {(id, d) => (
        <input id={id} className="input" type={opts.type ?? 'text'} placeholder={opts.placeholder} aria-describedby={d} value={str(k)} onChange={(e) => set(k, e.target.value)} />
      )}
    </Field>
  );
  const number = (k: string, label: string, hint: string, min = 0) => (
    <Field label={label} hint={hint} error={fields[k]}>
      {(id, d) => <input id={id} className="input" type="number" min={min} aria-describedby={d} value={num(k)} onChange={(e) => set(k, Number(e.target.value))} />}
    </Field>
  );
  const check = (k: string, label: string) => (
    <label className="check">
      <input type="checkbox" checked={!!s[k]} onChange={(e) => set(k, e.target.checked)} />
      <span>{label}</span>
    </label>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Configurações</h1>
          <p>Dados exibidos no site e regras do agendamento online.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : <Icon name="check" size={18} />} Salvar
          </button>
        </div>
      </div>
      {error && (
        <div style={{ marginBottom: 14 }}>
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      <div className="dash-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Clínica</h2>
            </div>
            <div className="panel-body form-stack">
              <div className="photo-edit">
                {s.logo_url ? (
                  <img src={String(s.logo_url)} alt="Logo atual" style={{ height: 64, width: 'auto' }} />
                ) : (
                  <LogoMark size={52} color="var(--blue-700)" accent="var(--lime-500)" />
                )}
                <label className="btn btn-outline btn-sm">
                  <Icon name="upload" size={16} /> {s.logo_url ? 'Trocar logo' : 'Enviar logo próprio'}
                  <input
                    type="file"
                    hidden
                    accept="image/png,image/jpeg,image/webp"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try {
                        const r = await api.upload<{ logoUrl: string }>('/api/admin/settings/logo', f);
                        set('logo_url', r.logoUrl);
                        toast('Logo atualizado.');
                      } catch (err) {
                        toast((err as Error).message, 'error');
                      }
                    }}
                  />
                </label>
                {s.logo_url && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      await api.del('/api/admin/settings/logo');
                      set('logo_url', '');
                      toast('Usando o logo padrão.');
                    }}
                  >
                    Usar logo padrão
                  </button>
                )}
              </div>
              <div className="grid-2">
                {text('name', 'Nome completo')}
                {text('short_name', 'Nome curto', { hint: 'Usado no topo do site e nas mensagens.' })}
              </div>
              {text('tagline', 'Frase de destaque')}
              <Field label="Descrição" error={fields.description}>
                {(id) => <textarea id={id} className="textarea" rows={3} value={str('description')} onChange={(e) => set('description', e.target.value)} />}
              </Field>
              <div className="grid-2">
                {text('phone', 'Telefone', { placeholder: '(91) 3333-4444' })}
                {text('whatsapp', 'WhatsApp', { placeholder: '(91) 98888-7777' })}
              </div>
              <div className="grid-2">
                {text('email', 'E-mail', { optional: true, type: 'email' })}
                {text('instagram', 'Instagram', { optional: true, placeholder: '@jrsaude' })}
              </div>
              {text('address', 'Endereço', { placeholder: 'Rua, número — Bairro, Cidade/UF' })}
              {text('maps_url', 'Link do Google Maps', { optional: true, placeholder: 'https://maps.app.goo.gl/...' })}
              <Field label="Horário de funcionamento" hint="Texto exibido no site (uma linha por período).">
                {(id, d) => <textarea id={id} className="textarea" rows={3} aria-describedby={d} value={str('opening_hours')} onChange={(e) => set('opening_hours', e.target.value)} />}
              </Field>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Privacidade (LGPD)</h2>
            </div>
            <div className="panel-body form-stack">
              <Field label="Política de privacidade" hint="Exibida no site. O paciente aceita esta versão ao agendar.">
                {(id, d) => <textarea id={id} className="textarea" rows={10} aria-describedby={d} value={str('privacy_policy')} onChange={(e) => set('privacy_policy', e.target.value)} />}
              </Field>
              {text('privacy_policy_version', 'Versão', { hint: 'Altere a versão quando mudar o texto (fica registrada no consentimento).' })}
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Regras do agendamento</h2>
            </div>
            <div className="panel-body form-stack">
              <Field label="Duração padrão das consultas" error={fields.default_duration_minutes}>
                {(id) => (
                  <select id={id} className="select" value={num('default_duration_minutes')} onChange={(e) => set('default_duration_minutes', Number(e.target.value))}>
                    {[15, 20, 30, 40, 45, 60].map((m) => (
                      <option key={m} value={m}>
                        {m} minutos
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              {number('min_advance_minutes', 'Antecedência mínima (minutos)', 'Ex.: 60 = não aceita agendar para daqui a menos de 1 hora.')}
              {number('max_advance_days', 'Agenda aberta até (dias)', 'Quantos dias à frente o paciente pode agendar.', 1)}
              {number('cancel_min_hours', 'Cancelar/remarcar online até (horas antes)', 'Ex.: 2 = até 2 horas antes do horário.')}
              {check('allow_patient_reschedule', 'Permitir que o paciente remarque pelo link')}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Dados pedidos ao paciente</h2>
            </div>
            <div className="panel-body form-stack">
              <span className="muted" style={{ fontSize: '0.88rem' }}>
                Nome e telefone são sempre pedidos. Peça outros dados somente se forem realmente necessários (LGPD).
              </span>
              {check('require_email', 'Exigir e-mail')}
              {check('require_cpf', 'Exigir CPF')}
              {check('require_birth_date', 'Exigir data de nascimento')}
              <Field label="Aviso exibido na confirmação" optional>
                {(id) => <input id={id} className="input" value={str('booking_notice')} onChange={(e) => set('booking_notice', e.target.value)} />}
              </Field>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Proteção contra abuso</h2>
            </div>
            <div className="panel-body form-stack">
              {number('max_active_per_phone', 'Agendamentos futuros por telefone', 'Limite de consultas ativas para o mesmo telefone.', 1)}
              {number('max_bookings_per_ip_day', 'Agendamentos por conexão (24h)', 'Acima disso, o sistema bloqueia e registra na auditoria.', 1)}
              <Field label="Fuso horário" error={fields.timezone}>
                {(id) => (
                  <select id={id} className="select" value={str('timezone')} onChange={(e) => set('timezone', e.target.value)}>
                    {['America/Belem', 'America/Sao_Paulo', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Manaus', 'America/Cuiaba', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Araguaina', 'America/Maceio', 'America/Santarem', 'America/Boa_Vista', 'America/Campo_Grande', 'America/Noronha'].map((tz) => (
                      <option key={tz} value={tz}>
                        {tz.replace('America/', '').replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          </section>
          <button className="btn btn-primary btn-lg" onClick={save} disabled={busy}>
            {busy && <Spinner />} Salvar configurações
          </button>
        </div>
      </div>
    </>
  );
}
