import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Alert, Field, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { maskPhone } from '../../lib/format';
import { useTitle } from '../../lib/hooks';

export function Lookup() {
  useTitle('Meus agendamentos');
  const navigate = useNavigate();
  const [mode, setMode] = useState<'phone' | 'email'>('phone');
  const [code, setCode] = useState('');
  const [contact, setContact] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (code.replace(/[^0-9a-z]/gi, '').length < 8) return setError('Informe o número do agendamento (8 letras/números).');
    if (!contact.trim()) return setError(mode === 'phone' ? 'Informe o telefone usado no agendamento.' : 'Informe o e-mail usado no agendamento.');
    setBusy(true);
    try {
      const r = await api.post<{ id: string; accessToken: string }>('/api/appointments/lookup', { code, contact });
      navigate(`/agendamento/${r.id}?t=${encodeURIComponent(r.accessToken)}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap wrap-narrow booking stack-lg">
      <div>
        <span className="kicker">Consultar, remarcar ou cancelar</span>
        <h1 className="step-title display">Meus agendamentos</h1>
        <p className="step-sub">Use o número do agendamento que você recebeu na confirmação.</p>
      </div>
      <form className="form-card" onSubmit={submit} noValidate>
        <Field label="Número do agendamento" hint="Exemplo: K7P2-Q9MX">
          {(id, d) => (
            <input
              id={id}
              className="input"
              value={code}
              aria-describedby={d}
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={12}
              style={{ textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          )}
        </Field>
        <div role="radiogroup" aria-label="Confirmar identidade por" style={{ display: 'flex', gap: 8 }}>
          {(['phone', 'email'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={`btn btn-sm ${mode === m ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => {
                setMode(m);
                setContact('');
              }}
            >
              {m === 'phone' ? 'Telefone' : 'E-mail'}
            </button>
          ))}
        </div>
        <Field label={mode === 'phone' ? 'Telefone usado no agendamento' : 'E-mail usado no agendamento'}>
          {(id, d) => (
            <input
              id={id}
              className="input"
              type={mode === 'phone' ? 'tel' : 'email'}
              inputMode={mode === 'phone' ? 'tel' : 'email'}
              autoComplete={mode === 'phone' ? 'tel-national' : 'email'}
              placeholder={mode === 'phone' ? '(91) 98888-7777' : 'seu@email.com'}
              value={contact}
              aria-describedby={d}
              onChange={(e) => setContact(mode === 'phone' ? maskPhone(e.target.value) : e.target.value)}
            />
          )}
        </Field>
        {error && <Alert kind="error">{error}</Alert>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? <Spinner /> : <Icon name="search" size={20} />} Ver meu agendamento
        </button>
        <p className="muted" style={{ margin: 0, fontSize: '0.92rem' }}>
          <Icon name="lock" size={14} /> Por segurança, só mostramos o agendamento quando o número e o contato conferem.
        </p>
      </form>
    </div>
  );
}
