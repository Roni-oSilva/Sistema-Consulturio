import { Link } from 'react-router-dom';
import { Icon, WhatsAppIcon } from '../../components/Icon';
import { ClinicLogo } from '../../components/Logo';
import { api } from '../../lib/api';
import { CATEGORY_LABEL, WEEKDAYS_SHORT, formatPhoneDigits, telLink, waLink } from '../../lib/format';
import { useAsync, useClinic, useTitle } from '../../lib/hooks';
import { proLabel, type Professional, type Service } from '../../lib/types';
import { ProPhoto } from './shared';

const CATEGORY_ORDER = ['CONSULTA', 'TERAPIA', 'EXAME', 'OUTRO'] as const;

export function Home() {
  const clinic = useClinic()!;
  useTitle('');
  const services = useAsync((signal) => api.get<Service[]>('/api/services', { signal }), []);
  const pros = useAsync((signal) => api.get<Professional[]>('/api/professionals', { signal }), []);

  const bookable = (services.data ?? []).filter((s) => s.professionalCount > 0);
  const choosable = new Set((services.data ?? []).filter((s) => s.allowChooseProfessional).map((s) => s.id));
  const visiblePros = (pros.data ?? []).filter((p) => p.serviceIds.some((id) => choosable.has(id)));

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="wrap">
          <div className="hero-mark">
            <ClinicLogo logoUrl={clinic.logoUrl} name={clinic.name} size={92} color="var(--gold-300)" accent="var(--gold-400)" />
          </div>
          <p className="eyebrow">Centro Clínico</p>
          <h1 id="hero-title" className="display" translate="no">
            {(clinic.shortName || clinic.name).toUpperCase()}
          </h1>
          <p className="tagline">{clinic.tagline}</p>
          <div className="hero-cta">
            <Link to="/agendar" className="btn btn-gold btn-lg">
              <Icon name="calendar" size={22} />
              AGENDAR CONSULTA
            </Link>
            <span style={{ fontSize: '0.92rem', color: '#c9d1df' }}>Sem cadastro · leva menos de 2 minutos</span>
          </div>
          <div className="hero-quick">
            {clinic.whatsapp && (
              <a href={waLink(clinic.whatsapp, 'Olá! Gostaria de informações.')} target="_blank" rel="noopener noreferrer">
                <WhatsAppIcon size={18} /> {formatPhoneDigits(clinic.whatsapp)}
              </a>
            )}
            {clinic.phone && (
              <a href={telLink(clinic.phone)}>
                <Icon name="phone" size={18} /> {clinic.phone}
              </a>
            )}
            <Link to="/meus-agendamentos">
              <Icon name="search" size={18} /> Consultar ou cancelar agendamento
            </Link>
          </div>
        </div>
        <hr className="led" />
      </section>

      <section className="section" aria-labelledby="servicos">
        <div className="wrap">
          <div className="section-head">
            <span className="kicker">O que fazemos</span>
            <h2 id="servicos" className="display">
              Especialidades e exames
            </h2>
            <p>{clinic.description}</p>
          </div>
          {services.loading ? (
            <div className="plaques">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="skeleton" style={{ height: 76 }} />
              ))}
            </div>
          ) : (
            CATEGORY_ORDER.map((cat) => {
              const list = bookable.filter((s) => s.category === cat);
              if (!list.length) return null;
              return (
                <div className="plaque-group" key={cat}>
                  <h3>{CATEGORY_LABEL[cat]}</h3>
                  <ul className="plaques">
                    {list.map((s) => (
                      <li key={s.id}>
                        <Link to={`/agendar?servico=${s.id}`} className="plaque">
                          <span className="plaque-name">{s.name}</span>
                          <span className="plaque-go">
                            <Icon name="arrowRight" size={20} />
                          </span>
                          {s.description && <span className="plaque-desc">{s.description}</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>
      </section>

      {visiblePros.length > 0 && (
        <section className="section section-alt" aria-labelledby="profissionais">
          <div className="wrap">
            <div className="section-head">
              <span className="kicker">Nossa equipe</span>
              <h2 id="profissionais" className="display">
                Profissionais
              </h2>
              <p>Profissionais preparados para cuidar de você e da sua família.</p>
            </div>
            <div className="pros">
              {visiblePros.map((p) => (
                <article className="pro-card" key={p.id}>
                  <ProPhoto pro={p} />
                  <div>
                    <div className="pro-name">{proLabel(p)}</div>
                    <div className="pro-spec">{p.specialty}</div>
                    {p.registry && <div className="pro-meta">{p.registry}</div>}
                    <div className="pro-days" aria-label="Dias de atendimento">
                      {WEEKDAYS_SHORT.map((d, i) => (
                        <span key={d} className={p.weekdays.includes(i + 1) ? 'on' : ''} aria-hidden={!p.weekdays.includes(i + 1)}>
                          {d}
                        </span>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="contato">
        <div className="wrap">
          <div className="section-head">
            <span className="kicker">Visite-nos</span>
            <h2 id="contato" className="display">
              Será um prazer receber você
            </h2>
          </div>
          <div className="info-grid">
            <div className="info-card">
              {clinic.address && (
                <div className="info-row">
                  <span className="ico">
                    <Icon name="pin" />
                  </span>
                  <div>
                    <strong>Endereço</strong>
                    <p>{clinic.address}</p>
                    {clinic.mapsUrl && (
                      <a href={clinic.mapsUrl} target="_blank" rel="noopener noreferrer">
                        Ver no mapa
                      </a>
                    )}
                  </div>
                </div>
              )}
              {clinic.openingHours && (
                <div className="info-row">
                  <span className="ico">
                    <Icon name="clock" />
                  </span>
                  <div>
                    <strong>Horário de funcionamento</strong>
                    <p>{clinic.openingHours}</p>
                  </div>
                </div>
              )}
              {(clinic.phone || clinic.whatsapp) && (
                <div className="info-row">
                  <span className="ico">
                    <Icon name="phone" />
                  </span>
                  <div>
                    <strong>Telefone</strong>
                    <p>{[clinic.phone, clinic.whatsapp && `WhatsApp ${formatPhoneDigits(clinic.whatsapp)}`].filter(Boolean).join(' · ')}</p>
                  </div>
                </div>
              )}
              {clinic.instagram && (
                <div className="info-row">
                  <span className="ico">
                    <Icon name="instagram" />
                  </span>
                  <div>
                    <strong>Instagram</strong>
                    <a href={`https://instagram.com/${clinic.instagram.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer">
                      @{clinic.instagram.replace(/^@/, '')}
                    </a>
                  </div>
                </div>
              )}
            </div>
            <div className="info-card marble">
              <div className="info-row">
                <span className="ico">
                  <Icon name="calendar" />
                </span>
                <div>
                  <strong>Agendamento online</strong>
                  <p>Escolha o serviço, o profissional, o dia e o horário. Você recebe a confirmação na hora.</p>
                </div>
              </div>
              <div className="info-row">
                <span className="ico">
                  <Icon name="shield" />
                </span>
                <div>
                  <strong>Cancelamento</strong>
                  <p>{clinic.cancellationPolicy}</p>
                </div>
              </div>
              <div className="contact-actions">
                <Link to="/agendar" className="btn btn-gold">
                  <Icon name="calendar" size={18} /> Agendar agora
                </Link>
                {clinic.whatsapp ? (
                  <a className="btn btn-whatsapp" href={waLink(clinic.whatsapp, 'Olá! Gostaria de informações.')} target="_blank" rel="noopener noreferrer">
                    <WhatsAppIcon size={18} /> WhatsApp
                  </a>
                ) : clinic.phone ? (
                  <a className="btn btn-outline" href={telLink(clinic.phone)}>
                    <Icon name="phone" size={18} /> Ligar
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
