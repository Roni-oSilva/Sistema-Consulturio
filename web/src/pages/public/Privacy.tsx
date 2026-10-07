import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useClinic, useTitle } from '../../lib/hooks';

export function Privacy() {
  useTitle('Política de privacidade');
  const clinic = useClinic()!;
  return (
    <div className="wrap wrap-narrow booking stack-lg">
      <div>
        <span className="kicker">LGPD · versão {clinic.privacyPolicyVersion}</span>
        <h1 className="step-title display">Política de privacidade</h1>
      </div>
      <article className="page-card prose">{clinic.privacyPolicy}</article>
      <div className="page-card stack" style={{ padding: 20 }}>
        <strong>{clinic.name}</strong>
        {clinic.address && <span>{clinic.address}</span>}
        {(clinic.phone || clinic.email) && <span>{[clinic.phone, clinic.email].filter(Boolean).join(' · ')}</span>}
      </div>
      <Link to="/" className="btn btn-ghost">
        <Icon name="arrowLeft" size={18} /> Voltar ao início
      </Link>
    </div>
  );
}
