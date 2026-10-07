import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useTitle } from '../../lib/hooks';

export function NotFound() {
  useTitle('Página não encontrada');
  return (
    <div className="wrap wrap-narrow booking stack" style={{ textAlign: 'center', paddingTop: 56 }}>
      <h1 className="step-title display">Página não encontrada</h1>
      <p className="muted">O endereço pode estar incorreto ou a página foi removida.</p>
      <div>
        <Link to="/" className="btn btn-primary btn-lg">
          <Icon name="home" size={20} /> Ir para o início
        </Link>
      </div>
    </div>
  );
}
