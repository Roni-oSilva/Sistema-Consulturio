import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { ClinicLogo, Wordmark } from '../../components/Logo';
import { ErrorState, Loading } from '../../components/ui';
import { api } from '../../lib/api';
import { ClinicContext, useAsync, type Clinic } from '../../lib/hooks';

export function PublicLayout() {
  const { data: clinic, error, reload } = useAsync((signal) => api.get<Clinic>('/api/public/clinic', { signal }), []);
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="public">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="topbar">
        <div className="wrap">
          <Link to="/" className="brand" aria-label="Página inicial">
            <ClinicLogo logoUrl={clinic?.logoUrl} name={clinic?.shortName || 'JR Saúde'} size={30} color="var(--cream-0)" accent="var(--gold-400)" />
            <Wordmark small name={(clinic?.shortName || 'JR Saúde').toUpperCase()} />
          </Link>
          <nav aria-label="Principal">
            <Link to="/meus-agendamentos" className="topbar-link">
              <Icon name="calendar" size={18} />
              <span>Meus agendamentos</span>
            </Link>
          </nav>
        </div>
        <hr className="led" />
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
        <div className="wrap">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--cream-0)' }}>
            <ClinicLogo logoUrl={clinic?.logoUrl} name={clinic?.name ?? 'JR Saúde'} size={26} color="var(--cream-0)" accent="var(--gold-400)" />
            <span className="wordmark wordmark-sm">{clinic?.name ?? 'Centro Clínico JR Saúde'}</span>
          </div>
          {clinic?.address && <div>{clinic.address}</div>}
          <div className="footer-links">
            <Link to="/agendar">Agendar</Link>
            <Link to="/meus-agendamentos">Meus agendamentos</Link>
            <Link to="/privacidade">Política de privacidade</Link>
            <Link to="/admin">Área da clínica</Link>
          </div>
          <div style={{ fontSize: '0.82rem', opacity: 0.8 }}>
            Seus dados são protegidos conforme a LGPD. Conexão segura.
          </div>
        </div>
      </footer>
    </div>
  );
}
