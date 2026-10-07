import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { ClinicLogo } from '../../components/Logo';
import { ErrorState, Loading } from '../../components/ui';
import { api } from '../../lib/api';
import { ClinicContext, useAsync, type Clinic } from '../../lib/hooks';

export function PublicLayout() {
  const { data: clinic, error, reload } = useAsync((signal) => api.get<Clinic>('/api/public/clinic', { signal }), []);
  const { pathname, hash } = useLocation();
  const shortName = clinic?.shortName || 'JR Saúde';

  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);

  return (
    <div className="public">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="topbar">
        <div className="wrap">
          <div className="topbar-inner">
            <Link to="/" className="brand" aria-label={`${shortName} — página inicial`}>
              <ClinicLogo logoUrl={clinic?.logoUrl} name={shortName} size={30} color="var(--blue-800)" accent="var(--blue-500)" />
              <span className="wordmark wordmark-sm" translate="no">
                {shortName}
              </span>
            </Link>
            <nav className="topnav" aria-label="Seções">
              <a href="/#especialidades">Especialidades</a>
              <a href="/#sobre">A clínica</a>
              <a href="/#profissionais">Profissionais</a>
              <a href="/#contato">Contato</a>
            </nav>
            <div className="topbar-actions">
              <Link to="/meus-agendamentos" className="topbar-link" aria-label="Meus agendamentos">
                <Icon name="calendar" size={18} />
                <span>Meus agendamentos</span>
              </Link>
              {pathname !== '/agendar' && (
                <Link to="/agendar" className="btn btn-cta" aria-label="Agendar">
                  <span className="label">Agendar</span>
                  <span className="orb">
                    <Icon name="arrowUpRight" size={18} />
                  </span>
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      <main id="conteudo" tabIndex={-1}>
        {error ? (
          <div className="wrap wrap-narrow" style={{ paddingTop: 32 }}>
            <ErrorState error={error} onRetry={reload} />
          </div>
        ) : !clinic ? (
          <Loading />
        ) : (
          <ClinicContext.Provider value={clinic}>
            <Outlet />
          </ClinicContext.Provider>
        )}
      </main>

      <footer className="footer">
        <div className="bgword" aria-hidden="true" translate="no">
          {shortName.toUpperCase()}
        </div>
        <div className="wrap">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--white)' }}>
            <ClinicLogo logoUrl={clinic?.logoUrl} name={clinic?.name ?? shortName} size={28} color="var(--white)" accent="var(--lime-400)" />
            <span className="wordmark wordmark-sm">{clinic?.name ?? 'Centro Clínico JR Saúde'}</span>
          </div>
          {clinic?.address && <div>{clinic.address}</div>}
          <div className="footer-links">
            <Link to="/agendar">Agendar</Link>
            <Link to="/meus-agendamentos">Meus agendamentos</Link>
            <Link to="/privacidade">Política de privacidade</Link>
            <Link to="/admin">Área da clínica</Link>
          </div>
          <div style={{ fontSize: '0.82rem', opacity: 0.85 }}>Seus dados são protegidos conforme a LGPD. Conexão segura.</div>
        </div>
      </footer>
    </div>
  );
}
