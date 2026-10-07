import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArtHeart, ArtSpine, ArtTube } from '../../components/Art';
import { Icon, WhatsAppIcon } from '../../components/Icon';
import { api } from '../../lib/api';
import { CATEGORY_LABEL, WEEKDAYS_SHORT, formatPhoneDigits, telLink, waLink } from '../../lib/format';
import { useAsync, useClinic, useTitle } from '../../lib/hooks';
import { proLabel, type Professional, type Service } from '../../lib/types';
import { ProPhoto } from './shared';

const CATEGORY_ORDER = ['CONSULTA', 'TERAPIA', 'EXAME', 'OUTRO'] as const;

export function Home() {
  const clinic = useClinic()!;
  useTitle('');
  const { hash } = useLocation();
  const services = useAsync((signal) => api.get<Service[]>('/api/services', { signal }), []);
  const pros = useAsync((signal) => api.get<Professional[]>('/api/professionals', { signal }), []);

  const bookable = (services.data ?? []).filter((s) => s.professionalCount > 0);
  const byCat = (c: string) => bookable.filter((s) => s.category === c);
  const choosable = new Set((services.data ?? []).filter((s) => s.allowChooseProfessional).map((s) => s.id));
  const visiblePros = (pros.data ?? []).filter((p) => p.serviceIds.some((id) => choosable.has(id)));
  const shortName = clinic.shortName || clinic.name;

  // links como /#especialidades: rola até a seção quando o conteúdo carrega
  useEffect(() => {
    if (hash && services.data) document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash, services.data]);

  const categories = [
    { key: 'CONSULTA', title: 'Consultas', sub: `${byCat('CONSULTA').length} especialidades`, Art: ArtHeart, dark: false },
    { key: 'TERAPIA', title: 'Atendimentos', sub: 'Fisioterapia e reabilitação', Art: ArtSpine, dark: false },
    { key: 'EXAME', title: 'Exames', sub: `${byCat('EXAME').length} exames no local`, Art: ArtTube, dark: true },
  ].filter((c) => byCat(c.key).length > 0);

  return (
    <>
      {/* ------------------------------------------------------------ herói */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="bgword" aria-hidden="true" translate="no">
          {shortName.toUpperCase()}
        </div>
        <div className="wrap hero-grid">
          <div>
            <span className="chip-pill">
              <span className="dot-live">
                <Icon name="pulse" size={13} strokeWidth={2.6} />
              </span>
              Agendamento online · sem cadastro
            </span>
            <h1 id="hero-title">
              <span className="l1">Saúde com</span>
              <span className="l2">
                <span className="hero-ico" aria-hidden="true">
                  <Icon name="stethoscope" strokeWidth={2.2} />
                </span>
                <span>atenção</span>
              </span>
              <span className="l3">e qualidade</span>
            </h1>
            <p className="hero-lead">
              <strong>{shortName}</strong> reúne consultas em várias especialidades, atendimentos e exames em um só lugar. Escolha o dia e o horário e receba a
              confirmação na hora.
            </p>
            <div className="hero-actions">
              <Link to="/agendar" className="btn btn-cta btn-lg">
                Agendar consulta
                <span className="orb">
                  <Icon name="arrowUpRight" size={22} />
                </span>
              </Link>
              <Link to="/meus-agendamentos" className="btn btn-outline btn-lg">
                Meus agendamentos
              </Link>
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
            </div>
          </div>

          <div className="hero-visual">
            <div className="arch">
              <img src="/img/recepcao.webp" alt={`Recepção da ${clinic.name}`} width={720} height={960} fetchPriority="high" />
            </div>
            <div className="side-card">
              <img src="/img/coleta.webp" alt="Tubos para coleta de exames laboratoriais" width={720} height={720} loading="lazy" />
            </div>
            {bookable.length > 0 && (
              <div className="float-chip chip-a">
                <span className="ico lime">
                  <Icon name="stethoscope" size={20} />
                </span>
                <div>
                  <b>{bookable.length}</b>
                  <small>serviços e exames</small>
                </div>
              </div>
            )}
            <div className="float-chip chip-b">
              <span className="ico">
                <WhatsAppIcon size={20} />
              </span>
              <div>
                <b style={{ fontSize: '1rem' }}>Confirmação</b>
                <small>e lembrete no WhatsApp</small>
              </div>
            </div>
            <div className="float-chip chip-c">
              <span className="ico">
                <Icon name="clock" size={20} />
              </span>
              <div>
                <b>24h</b>
                <small>agenda online</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ especialidades */}
      <section className="section" id="especialidades" aria-labelledby="t-esp" style={{ scrollMarginTop: 90 }}>
        <div className="wrap">
          <div className="section-head">
            <span className="kicker">Especialidades</span>
            <h2 id="t-esp" className="display caps">
              Cuidado completo em um só lugar
            </h2>
            <p>{clinic.description}</p>
          </div>

          {services.loading ? (
            <div className="cat-grid">
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton" style={{ height: 190, borderRadius: 22 }} />
              ))}
            </div>
          ) : (
            <>
              <div className="cat-grid">
                {categories.map(({ key, title, sub, Art, dark }) => (
                  <a key={key} href={`#cat-${key}`} className={`cat-card ${dark ? 'dark' : ''}`}>
                    <span className="cat-art">
                      <Art dark={dark} />
                    </span>
                    <span className="orb-btn" aria-hidden="true">
                      <Icon name="arrowUpRight" size={20} />
                    </span>
                    <span className="cat-title">
                      {title}
                      <small>{sub}</small>
                    </span>
                  </a>
                ))}
              </div>

              {CATEGORY_ORDER.map((cat) => {
                const list = byCat(cat);
                if (!list.length) return null;
                return (
                  <div className="svc-group" key={cat} id={`cat-${cat}`}>
                    <h3>{CATEGORY_LABEL[cat]}</h3>
                    <ul className="svc-list">
                      {list.map((s) => (
                        <li key={s.id}>
                          <Link to={`/agendar?servico=${s.id}`} className="svc">
                            <span className="svc-name">{s.name}</span>
                            <span className="svc-go" aria-hidden="true">
                              <Icon name="arrowUpRight" size={18} />
                            </span>
                            {s.description && <span className="svc-desc">{s.description}</span>}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------ sobre */}
      <section className="section" id="sobre" aria-labelledby="t-sobre" style={{ scrollMarginTop: 90 }}>
        <div className="wrap about-grid">
          <div className="about-photo">
            <img src="/img/consultorio.webp" alt={`Consultório da ${clinic.name} com o logotipo iluminado`} loading="lazy" />
            <div className="about-panel">
              <span className="tag">
                <i>
                  <Icon name="plus" size={18} strokeWidth={3} />
                </i>
                {shortName}
              </span>
              <b>Ambiente preparado</b>
              <p>Para cuidar de você e da sua família.</p>
            </div>
          </div>
          <div className="about-copy">
            <span className="pill-lime">Sobre nós</span>
            <h2 id="t-sobre" className="display">
              {clinic.name}
            </h2>
            <p>{clinic.tagline}</p>
            <p style={{ marginTop: 10 }}>
              Consultas, atendimentos multiprofissionais e exames — com agendamento online, confirmação na hora e lembretes automáticos para você não esquecer.
            </p>
            <div className="about-actions">
              <Link to="/agendar" className="btn btn-cta">
                Agendar agora
                <span className="orb">
                  <Icon name="arrowUpRight" size={18} />
                </span>
              </Link>
              {(clinic.whatsapp || clinic.phone) && (
                <a
                  className="ask"
                  href={clinic.whatsapp ? waLink(clinic.whatsapp, 'Olá! Tenho uma dúvida.') : telLink(clinic.phone)}
                  target={clinic.whatsapp ? '_blank' : undefined}
                  rel="noopener noreferrer"
                >
                  <i>
                    <Icon name="phone" size={20} />
                  </i>
                  <span>
                    <strong>Ficou com dúvida?</strong>
                    <span>{clinic.whatsapp ? formatPhoneDigits(clinic.whatsapp) : clinic.phone}</span>
                  </span>
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ números */}
      {!services.loading && bookable.length > 0 && (
        <section className="section" style={{ paddingTop: 8 }} aria-label="A clínica em números">
          <div className="wrap">
            <div className="stats-band">
              <div>
                <b>{byCat('CONSULTA').length}</b>
                <span>Especialidades médicas</span>
              </div>
              <div>
                <b>{byCat('EXAME').length}</b>
                <span>Exames no local</span>
              </div>
              <div>
                <b>24h</b>
                <span>Agendamento online</span>
              </div>
              <div>
                <b>2 min</b>
                <span>Para agendar, sem cadastro</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------ profissionais */}
      {visiblePros.length > 0 && (
        <section className="section section-alt" id="profissionais" aria-labelledby="t-pros" style={{ scrollMarginTop: 90 }}>
          <div className="wrap">
            <div className="section-head">
              <span className="kicker">Nossa equipe</span>
              <h2 id="t-pros" className="display caps">
                Profissionais
              </h2>
              <p>Profissionais preparados para cuidar da sua saúde com atenção e qualidade.</p>
            </div>
            <div className="pros">
              {visiblePros.map((p) => (
                <article className="pro-card" key={p.id}>
                  <ProPhoto pro={p} />
                  <div>
                    <div className="pro-name">{proLabel(p)}</div>
                    <div className="pro-spec">{p.specialty}</div>
                    {p.registry && <div className="pro-meta">{p.registry}</div>}
                    <div className="pro-days" aria-label={`Atende: ${p.weekdays.map((w) => WEEKDAYS_SHORT[w - 1]).join(', ')}`}>
                      {WEEKDAYS_SHORT.map((d, i) => (
                        <span key={d} className={p.weekdays.includes(i + 1) ? 'on' : ''} aria-hidden="true">
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

      {/* ------------------------------------------------------------ contato */}
      <section className="section" id="contato" aria-labelledby="t-contato" style={{ scrollMarginTop: 90 }}>
        <div className="wrap">
          <div className="section-head">
            <span className="kicker">Visite-nos</span>
            <h2 id="t-contato" className="display caps">
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
            <div className="info-card dark">
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
                <Link to="/agendar" className="btn btn-accent">
                  <Icon name="calendar" size={18} /> Agendar agora
                </Link>
                {clinic.whatsapp ? (
                  <a className="btn btn-cta light" href={waLink(clinic.whatsapp, 'Olá! Gostaria de informações.')} target="_blank" rel="noopener noreferrer">
                    WhatsApp
                    <span className="orb">
                      <WhatsAppIcon size={18} />
                    </span>
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
