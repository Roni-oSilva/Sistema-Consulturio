import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Alert, ConfirmDialog, Dialog, ErrorState, Field, Loading, Spinner, copyText, useToast } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useAsync, useTitle } from '../../lib/hooks';
import { useAdmin, useCatalog } from './context';
import { ROLE_LABEL } from './types';

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  professionalId: string | null;
  professionalName: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
};
type Roles = { roles: { code: string; name: string; description: string }[]; manageable: string[] };

export function Users() {
  useTitle('Usuários');
  const { can, me, timezone } = useAdmin();
  const q = useAsync(async (signal) => {
    const [u, r] = await Promise.all([api.get<{ users: User[] }>('/api/admin/users', { signal }), api.get<Roles>('/api/admin/roles', { signal })]);
    return { users: u.users, roles: r };
  }, []);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const [reset, setReset] = useState<User | null>(null);

  if (q.loading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  const { users, roles } = q.data!;
  const canEdit = (u: User) => can('users:write') && (u.id === me.id || roles.manageable.includes(u.role));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Usuários</h1>
          <p>Quem acessa o painel e o que cada função pode fazer.</p>
        </div>
        {can('users:write') && (
          <div className="page-actions">
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Icon name="plus" size={18} /> Novo usuário
            </button>
          </div>
        )}
      </div>
      {temp && (
        <div style={{ marginBottom: 14 }}>
          <Alert kind="success" title="Senha temporária gerada">
            Repasse ao usuário <strong>{temp.email}</strong> por um canal seguro: <span className="code">{temp.password}</span>{' '}
            <button className="btn btn-ghost btn-sm" onClick={() => copyText(temp.password)}>
              <Icon name="copy" size={14} /> Copiar
            </button>
            <div style={{ fontSize: '0.86rem', marginTop: 4 }}>Ela será exibida apenas agora. No primeiro acesso, o sistema exige a troca.</div>
          </Alert>
        </div>
      )}
      <div className="panel table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Função</th>
              <th>Último acesso</th>
              <th>Situação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.name}</strong>
                  <div className="muted">{u.email}</div>
                </td>
                <td>
                  {ROLE_LABEL[u.role]}
                  {u.professionalName && <div className="muted">{u.professionalName}</div>}
                </td>
                <td className="num">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt, timezone) : '—'}</td>
                <td>
                  {u.active ? <span className="pill ok">Ativo</span> : <span className="pill">Inativo</span>}{' '}
                  {u.mustChangePassword && <span className="pill warn">senha temporária</span>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {canEdit(u) && (
                    <>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(u)}>
                        <Icon name="edit" size={15} /> Editar
                      </button>
                      {u.id !== me.id && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setReset(u)}>
                          <Icon name="key" size={15} /> Nova senha
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h2>Funções</h2>
        </div>
        <div className="panel-body">
          <dl className="kv" style={{ gridTemplateColumns: '170px 1fr' }}>
            {roles.roles.map((r) => (
              <div key={r.code} style={{ display: 'contents' }}>
                <dt>
                  <strong style={{ color: 'var(--ink)' }}>{r.name}</strong>
                </dt>
                <dd style={{ fontWeight: 400 }}>{r.description}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {editing && (
        <UserEditor
          user={editing === 'new' ? null : editing}
          manageable={roles.manageable}
          isSelf={editing !== 'new' && editing.id === me.id}
          onClose={() => setEditing(null)}
          onSaved={(t) => {
            setEditing(null);
            if (t) setTemp(t);
            q.reload();
          }}
        />
      )}
      {reset && (
        <ConfirmDialog
          title={`Gerar nova senha para ${reset.name}?`}
          message="A senha atual deixa de funcionar e as sessões abertas desse usuário são encerradas."
          confirmLabel="Gerar senha temporária"
          onClose={() => setReset(null)}
          onConfirm={async () => {
            const r = await api.post<{ temporaryPassword: string }>(`/api/admin/users/${reset.id}/reset-password`);
            setTemp({ email: reset.email, password: r.temporaryPassword });
            setReset(null);
            q.reload();
          }}
        />
      )}
    </>
  );
}

function UserEditor({
  user,
  manageable,
  isSelf,
  onClose,
  onSaved,
}: {
  user: User | null;
  manageable: string[];
  isSelf: boolean;
  onClose: () => void;
  onSaved: (temp: { email: string; password: string } | null) => void;
}) {
  const { professionals } = useCatalog();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState(user?.role ?? manageable[manageable.length - 2] ?? manageable[0] ?? 'RECEPTION');
  const [professionalId, setProfessionalId] = useState(user?.professionalId ?? '');
  const [active, setActive] = useState(user?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const roleOptions = isSelf ? [user!.role] : manageable;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { name, email, role, professionalId: role === 'PROFESSIONAL' ? professionalId || null : null, active };
      if (user) {
        await api.put(`/api/admin/users/${user.id}`, body);
        toast('Usuário atualizado.');
        onSaved(null);
      } else {
        const r = await api.post<{ temporaryPassword: string | null }>('/api/admin/users', body);
        onSaved(r.temporaryPassword ? { email, password: r.temporaryPassword } : null);
      }
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
      title={user ? 'Editar usuário' : 'Novo usuário'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !name || !email}>
            {busy && <Spinner />} Salvar
          </button>
        </>
      }
    >
      <div className="form-stack">
        <Field label="Nome" error={fields.name}>
          {(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="E-mail (login)" error={fields.email}>
          {(id) => <input id={id} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Função">
          {(id) => (
            <select id={id} className="select" value={role} onChange={(e) => setRole(e.target.value)} disabled={isSelf}>
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {role === 'PROFESSIONAL' && (
          <Field label="Profissional vinculado" hint="O usuário verá somente a agenda deste profissional.">
            {(id, d) => (
              <select id={id} className="select" aria-describedby={d} value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
                <option value="">Selecione</option>
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {[p.title, p.name].filter(Boolean).join(' ')}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {!isSelf && (
          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Ativo (desativar encerra as sessões e bloqueia o acesso)</span>
          </label>
        )}
        {!user && <Alert kind="info">Uma senha temporária será gerada e exibida uma única vez. No primeiro acesso, a troca é obrigatória.</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Dialog>
  );
}
