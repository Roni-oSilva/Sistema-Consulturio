import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../../components/Icon';
import { LogoMark } from '../../components/Logo';
import { Alert, Field, Loading, Spinner } from '../../components/ui';
import { api, setCsrfToken } from '../../lib/api';
import { useAsync, useTitle } from '../../lib/hooks';
import { AdminContext, CatalogProvider, useAdmin } from './context';
import { ROLE_LABEL, type Me } from './types';
import { Dashboard } from './Dashboard';
import { Agenda } from './Agenda';
import { Professionals } from './Professionals';
import { Services } from './Services';
import { Blocks } from './Blocks';
import { Messages } from './Messages';
import { SettingsPage } from './Settings';
import { Users } from './Users';
import { Audit } from './Audit';
import { Patients } from './Patients';
import { AppointmentProvider } from './AppointmentPanel';

export default function AdminApp() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [timezone, setTimezone] = useState('America/Belem');

  useEffect(() => {
    api
      .get<{ timezone: string }>('/api/public/clinic')
      .then((c) => setTimezone(c.timezone))
      .catch(() => {});
    api
      .get<{ user: Me; csrfToken: string }>('/api/admin/me')
      .then((r) => {
        setCsrfToken(r.csrfToken);
        setMe(r.user);
      })
      .catch(() => setMe(null));
    const onUnauthorized = (e: Event) => {
      setCsrfToken(null);
      setMe((prev) => {
        if (prev) setNotice((e as CustomEvent).detail ?? 'Sua sessão expirou. Faça login novamente.');
        return null;
      });
    };
    window.addEventListener('admin:unauthorized', onUnauthorized);
    return () => window.removeEventListener('admin:unauthorized', onUnauthorized);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/admin/logout');
    } finally {
      setCsrfToken(null);
      setMe(null);
      setNotice('Você saiu do painel com segurança.');
    }
  }, []);

  if (me === undefined) {
    return (
      <div className="admin">
        <Loading text="Verificando acesso..." />
      </div>
    );
  }
  if (!me) {
    return (
      <Login
        notice={notice}
        onLogin={(u, csrf) => {
          setCsrfToken(csrf);
          setNotice(null);
          setMe(u);
        }}
      />
    );
  }
  if (me.mustChangePassword) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <ChangePasswordForm forced onDone={() => setMe({ ...me, mustChangePassword: false })} onLogout={logout} />
        </div>
      </div>
    );
  }

  const can = (p: string) => me.permissions.includes(p);
  return (
    <AdminContext.Provider value={{ me, can, logout, timezone }}>
      <CatalogProvider>
        <AppointmentProvider>
          <Shell />
        </AppointmentProvider>
      </CatalogProvider>
    </AdminContext.Provider>
  );
}

type NavItem = { to: string; label: string; icon: IconName; perm: string; section?: string };
const NAV: NavItem[] = [
  { to: '/admin', label: 'Hoje', icon: 'home', perm: 'dashboard:read' },
  { to: '/admin/agenda', label: 'Agenda', icon: 'calendar', perm: 'appointments:read' },
  { to: '/admin/pacientes', label: 'Pacientes', icon: 'users', perm: 'patients:read' },
  { to: '/admin/mensagens', label: 'Mensagens', icon: 'message', perm: 'notifications:read' },
  { to: '/admin/bloqueios', label: 'Bloqueios e feriados', icon: 'ban', perm: 'blocks:write', section: 'Agenda da clínica' },
  { to: '/admin/profissionais', label: 'Profissionais', icon: 'stethoscope', perm: 'professionals:write' },
  { to: '/admin/servicos', label: 'Serviços', icon: 'list', perm: 'services:write' },
  { to: '/admin/configuracoes', label: 'Configurações', icon: 'settings', perm: 'settings:write', section: 'Administração' },
  { to: '/admin/usuarios', label: 'Usuários', icon: 'key', perm: 'users:read' },
  { to: '/admin/auditoria', label: 'Auditoria', icon: 'shield', perm: 'audit:read' },
];

function Shell() {
  const { me, can, logout } = useAdmin();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const items = NAV.filter((n) => can(n.perm));
  const manual = useAsync(
    (signal) => (can('notifications:read') ? api.get<{ messages: unknown[] }>('/api/admin/notifications/manual', { signal }) : Promise.resolve({ messages: [] })),
    [location.pathname],
  );
  const pendingMessages = manual.data?.messages.length ?? 0;

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const sidebar = (extra = '') => (
    <aside className={`sidebar ${extra}`} aria-label="Menu do painel">
      <NavLink to="/admin" className="sidebar-brand">
        <LogoMark size={34} color="var(--cream-0)" accent="var(--gold-400)" />
        <div>
          <span className="wordmark wordmark-sm">JR SAÚDE</span>
          <small>Painel da clínica</small>
        </div>
      </NavLink>
      <hr className="led" />
      {items.map((n) => (
        <div key={n.to}>
          {n.section && <div className="nav-section">{n.section}</div>}
          <NavLink to={n.to} end={n.to === '/admin'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Icon name={n.icon} size={19} />
            {n.label}
            {n.to === '/admin/mensagens' && pendingMessages > 0 && <span className="nav-count">{pendingMessages}</span>}
          </NavLink>
        </div>
      ))}
      <div className="sidebar-user">
        <div>
          <strong>{me.name}</strong>
          {ROLE_LABEL[me.role]}
        </div>
        <NavLink to="/admin/conta" className="btn btn-ghost btn-sm">
          <Icon name="lock" size={16} /> Minha senha
        </NavLink>
        <a href="/" target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
          <Icon name="external" size={16} /> Ver site do paciente
        </a>
        <button className="btn btn-ghost btn-sm" onClick={logout}>
          <Icon name="logout" size={16} /> Sair
        </button>
      </div>
    </aside>
  );

  return (
    <div className="admin">
      <a className="skip-link" href="#painel">
        Pular para o conteúdo
      </a>
      <div className="admin-shell">
        {sidebar()}
        <div style={{ minWidth: 0 }}>
          <div className="mobile-top">
            <button className="btn btn-ghost btn-icon btn-sm" aria-label="Abrir menu" onClick={() => setMenuOpen(true)}>
              <Icon name="menu" />
            </button>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <LogoMark size={22} color="var(--cream-0)" accent="var(--gold-400)" />
              <span className="wordmark wordmark-sm">JR SAÚDE</span>
            </span>
            <button className="btn btn-ghost btn-icon btn-sm" aria-label="Sair" onClick={logout}>
              <Icon name="logout" />
            </button>
          </div>
          <main id="painel" className="admin-main" tabIndex={-1}>
            <Routes>
              <Route index element={can('dashboard:read') ? <Dashboard /> : <Denied />} />
              <Route path="agenda" element={can('appointments:read') ? <Agenda /> : <Denied />} />
              <Route path="pacientes" element={can('patients:read') ? <Patients /> : <Denied />} />
              <Route path="mensagens" element={can('notifications:read') ? <Messages onChange={manual.reload} /> : <Denied />} />
              <Route path="bloqueios" element={can('blocks:write') ? <Blocks /> : <Denied />} />
              <Route path="profissionais" element={can('professionals:write') ? <Professionals /> : <Denied />} />
              <Route path="servicos" element={can('services:write') ? <Services /> : <Denied />} />
              <Route path="configuracoes" element={can('settings:write') ? <SettingsPage /> : <Denied />} />
              <Route path="usuarios" element={can('users:read') ? <Users /> : <Denied />} />
              <Route path="auditoria" element={can('audit:read') ? <Audit /> : <Denied />} />
              <Route path="conta" element={<Account />} />
              <Route path="*" element={<Denied text="Página não encontrada." />} />
            </Routes>
          </main>
        </div>
      </div>

      <nav className="bottom-nav" aria-label="Atalhos">
        <NavLink to="/admin" end className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="home" size={22} />
          <small>Hoje</small>
        </NavLink>
        <NavLink to="/admin/agenda" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="calendar" size={22} />
          <small>Agenda</small>
        </NavLink>
        {can('appointments:write') ? (
          <button className="fab" onClick={() => navigate('/admin/agenda?novo=1')} aria-label="Novo agendamento">
            <span className="ic">
              <Icon name="plus" size={22} />
            </span>
            <small>Novo</small>
          </button>
        ) : (
          <span />
        )}
        {can('notifications:read') ? (
          <NavLink to="/admin/mensagens" className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name="message" size={22} />
            <small>Mensagens{pendingMessages ? ` (${pendingMessages})` : ''}</small>
          </NavLink>
        ) : (
          <span />
        )}
        <button onClick={() => setMenuOpen(true)}>
          <Icon name="menu" size={22} />
          <small>Mais</small>
        </button>
      </nav>

      {menuOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setMenuOpen(false)} />
          <div onKeyDown={(e) => e.key === 'Escape' && setMenuOpen(false)}>{sidebar('drawer')}</div>
        </>
      )}
    </div>
  );
}

function Denied({ text = 'Você não tem permissão para acessar esta área.' }: { text?: string }) {
  return (
    <div style={{ maxWidth: 520, paddingTop: 24 }}>
      <Alert kind="warn">{text}</Alert>
    </div>
  );
}

function Login({ notice, onLogin }: { notice: string | null; onLogin: (u: Me, csrf: string) => void }) {
  useTitle('Entrar no painel');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: Me; csrfToken: string }>('/api/admin/login', { email, password });
      onLogin(r.user, r.csrfToken);
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-block">
          <LogoMark size={64} color="var(--navy-800)" accent="var(--gold-600)" />
          <span className="wordmark">JR SAÚDE</span>
          <h1>Painel da clínica</h1>
        </div>
        <hr className="led" />
        {notice && <Alert kind="info">{notice}</Alert>}
        <Field label="E-mail">
          {(id) => <input id={id} className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />}
        </Field>
        <Field label="Senha">
          {(id) => (
            <input
              id={id}
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
        </Field>
        {error && <Alert kind="error">{error}</Alert>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? <Spinner /> : <Icon name="lock" size={18} />} Entrar
        </button>
        <a href="/" className="btn btn-ghost btn-sm">
          <Icon name="arrowLeft" size={16} /> Voltar ao site
        </a>
      </form>
    </div>
  );
}

export function ChangePasswordForm({ forced, onDone, onLogout }: { forced?: boolean; onDone: () => void; onLogout?: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    if (next !== again) return setFields({ again: 'As senhas não conferem.' });
    setBusy(true);
    try {
      await api.post('/api/admin/me/password', { currentPassword: cur, newPassword: next });
      setOk(true);
      setCur('');
      setNext('');
      setAgain('');
      onDone();
    } catch (err) {
      const e2 = err as { message: string; fields?: Record<string, string> };
      setError(e2.message);
      setFields(e2.fields ?? {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      {forced && (
        <div className="brand-block">
          <LogoMark size={48} color="var(--navy-800)" accent="var(--gold-600)" />
          <h1>Crie sua senha</h1>
          <p className="muted" style={{ margin: 0 }}>
            Por segurança, troque a senha temporária antes de continuar.
          </p>
        </div>
      )}
      <Field label={forced ? 'Senha temporária' : 'Senha atual'} error={fields.currentPassword}>
        {(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />}
      </Field>
      <Field label="Nova senha" hint="Mínimo de 10 caracteres, com letras e números." error={fields.newPassword}>
        {(id, d) => (
          <input id={id} className="input" type="password" autoComplete="new-password" aria-describedby={d} value={next} onChange={(e) => setNext(e.target.value)} />
        )}
      </Field>
      <Field label="Repita a nova senha" error={fields.again}>
        {(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />}
      </Field>
      {error && !Object.keys(fields).length && <Alert kind="error">{error}</Alert>}
      {ok && !forced && <Alert kind="success">Senha alterada. As outras sessões abertas foram encerradas.</Alert>}
      <button className="btn btn-primary btn-block" disabled={busy}>
        {busy && <Spinner />} Salvar nova senha
      </button>
      {onLogout && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onLogout}>
          Sair
        </button>
      )}
    </form>
  );
}

function Account() {
  useTitle('Minha conta');
  const { me } = useAdmin();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Minha conta</h1>
          <p>
            {me.name} · {me.email} · {ROLE_LABEL[me.role]}
          </p>
        </div>
      </div>
      <div className="panel" style={{ maxWidth: 520 }}>
        <div className="panel-head">
          <h2>Trocar senha</h2>
        </div>
        <div className="panel-body">
          <ChangePasswordForm onDone={() => {}} />
        </div>
      </div>
    </>
  );
}
