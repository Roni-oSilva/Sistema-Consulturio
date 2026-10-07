import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, WhatsAppIcon } from '../../components/Icon';
import { Alert, ErrorState, Field, Loading, Spinner } from '../../components/ui';
import { ApiError, api, qs } from '../../lib/api';
import { CATEGORY_LABEL, WEEKDAYS_SHORT, fmtDateBR, fmtDateLong, maskCpf, maskPhone, money, waLink } from '../../lib/format';
import { useAsync, useClinic, useTitle, type Clinic } from '../../lib/hooks';
import { proLabel, type Professional, type PublicAppointment, type Service, type Slot } from '../../lib/types';
import { DateTimePicker, ProPhoto } from './shared';

type PatientForm = { name: string; phone: string; email: string; cpf: string; birthDate: string; notes: string; consent: boolean; website: string };
const EMPTY_FORM: PatientForm = { name: '', phone: '', email: '', cpf: '', birthDate: '', notes: '', consent: false, website: '' };

type Result = { appointment: PublicAppointment; accessToken: string };

export function Booking() {
  const clinic = useClinic()!;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const serviceId = params.get('servico');
  const professionalParam = params.get('profissional');
  const date = params.get('data');
  const start = params.get('hora');
  const stage = params.get('etapa');

  const [form, setForm] = useState<PatientForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  /** Atualiza um campo e remove a mensagem de erro dele (já corrigido). */
  function setField<K extends keyof PatientForm>(k: K, v: PatientForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => Object.fromEntries(Object.entries(e).filter(([key]) => key !== k)));
  }

  const services = useAsync((signal) => api.get<Service[]>('/api/services', { signal }), []);
  const service = services.data?.find((s) => s.id === serviceId) ?? null;
  const pros = useAsync(
    (signal) => (serviceId ? api.get<Professional[]>(`/api/professionals${qs({ serviceId })}`, { signal }) : Promise.resolve([])),
    [serviceId],
  );

  const proList = pros.data ?? [];
  const chooseProfessional = !!service?.allowChooseProfessional && proList.length > 1;
  // Serviço sem escolha (ex.: exames) => o sistema escolhe; com 1 profissional => seleção automática
  const professionalId = service && !service.allowChooseProfessional ? null : chooseProfessional ? professionalParam : (proList[0]?.id ?? null);
  const professional = proList.find((p) => p.id === professionalId) ?? null;

  type Step = 'servico' | 'profissional' | 'horario' | 'dados' | 'confirmar' | 'pronto';
  let step: Step;
  if (result) step = 'pronto';
  else if (!service) step = 'servico';
  else if (chooseProfessional && !professional) step = 'profissional';
  else if (!date || !start) step = 'horario';
  else if (stage === 'confirmar' && form.name) step = 'confirmar';
  else step = 'dados';

  const stepList: { key: Step; label: string }[] = [
    { key: 'servico', label: 'Serviço' },
    ...(chooseProfessional ? [{ key: 'profissional' as Step, label: 'Profissional' }] : []),
    { key: 'horario', label: 'Data e horário' },
    { key: 'dados', label: 'Seus dados' },
    { key: 'confirmar', label: 'Confirmar' },
  ];
  const stepIndex = step === 'pronto' ? stepList.length : stepList.findIndex((s) => s.key === step);

  useTitle(step === 'pronto' ? 'Agendamento confirmado' : 'Agendar');

  // move o foco para o título a cada etapa (leitores de tela) e volta ao topo
  useEffect(() => {
    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  function go(patch: Record<string, string | null>, replace = false) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace });
  }

  function back() {
    navigate(-1);
  }

  const slotLabel = start ? new Intl.DateTimeFormat('pt-BR', { timeZone: clinic.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(start)) : '';

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    const name = form.name.trim();
    if (name.length < 3) e.name = 'Informe o nome completo.';
    else if (!name.includes(' ')) e.name = 'Informe nome e sobrenome.';
    const digits = form.phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) e.phone = 'Informe o telefone com DDD. Ex.: (91) 98888-7777';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'E-mail inválido.';
    if (clinic.requireEmail && !form.email.trim()) e.email = 'Informe o e-mail.';
    if (clinic.requireCpf && form.cpf.replace(/\D/g, '').length !== 11) e.cpf = 'Informe o CPF.';
    if (clinic.requireBirthDate && !form.birthDate) e.birthDate = 'Informe a data de nascimento.';
    if (!form.consent) e.consent = 'É necessário aceitar a política de privacidade.';
    return e;
  }

  function submitData(ev: FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      const first = Object.keys(e)[0];
      document.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    go({ etapa: 'confirmar' });
  }

  async function confirm() {
    if (!service || !start) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const r = await api.post<Result>('/api/appointments', {
        serviceId: service.id,
        professionalId,
        start,
        name: form.name.trim(),
        phone: form.phone,
        email: form.email.trim() || null,
        cpf: form.cpf || null,
        birthDate: form.birthDate || null,
        notes: form.notes.trim(),
        consent: form.consent,
        website: form.website,
        turnstileToken: turnstileToken ?? undefined,
      });
      setResult(r);
      // remove os dados pessoais da memória da página
      setForm(EMPTY_FORM);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && (err.code === 'SLOT_TAKEN' || err.code === 'SLOT_UNAVAILABLE')) {
        setNotice(err.message);
        go({ hora: null, etapa: null });
      } else if (err.status === 400 && Object.keys(err.fields).length) {
        setErrors(err.fields);
        setNotice(err.message);
        go({ etapa: null });
      } else {
        setNotice(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (services.error) {
    return (
      <div className="wrap wrap-narrow booking">
        <ErrorState error={services.error} onRetry={services.reload} />
      </div>
    );
  }
  if (services.loading || (serviceId && pros.loading)) return <Loading />;

  return (
    <div className="wrap wrap-narrow booking">
      {step !== 'pronto' && (
        <>
          <div className="step-meta">
            {stepIndex > 0 ? (
              <button type="button" className="back-btn" onClick={back}>
                <Icon name="arrowLeft" size={20} /> Voltar
              </button>
            ) : (
              <Link to="/" className="back-btn" style={{ textDecoration: 'none' }}>
                <Icon name="arrowLeft" size={20} /> Início
              </Link>
            )}
            <span>
              Etapa {stepIndex + 1} de {stepList.length}
            </span>
          </div>
          <ol className="steps" style={{ ['--n' as string]: stepList.length }} aria-label="Progresso do agendamento">
            {stepList.map((s, i) => (
              <li key={s.key} className={i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''} aria-current={i === stepIndex ? 'step' : undefined}>
                <span className="sr-only">
                  {s.label}
                  {i < stepIndex ? ' (concluída)' : ''}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}

      {/* ------------------------------------------------------------ 1. serviço */}
      {step === 'servico' && (
        <section aria-labelledby="t-step">
          <h1 id="t-step" className="step-title display" ref={headingRef} tabIndex={-1}>
            Qual atendimento você precisa?
          </h1>
          <p className="step-sub">Toque no serviço desejado.</p>
          {(['CONSULTA', 'TERAPIA', 'EXAME', 'OUTRO'] as const).map((cat) => {
            const list = (services.data ?? []).filter((s) => s.category === cat && s.professionalCount > 0);
            if (!list.length) return null;
            return (
              <div className="plaque-group" key={cat}>
                <h3>{CATEGORY_LABEL[cat]}</h3>
                <ul className="plaques" style={{ gridTemplateColumns: '1fr' }}>
                  {list.map((s) => (
                    <li key={s.id}>
                      <button type="button" className="plaque" onClick={() => go({ servico: s.id, profissional: null, data: null, hora: null, etapa: null })}>
                        <span className="plaque-name">{s.name}</span>
                        <span className="plaque-go">
                          <Icon name="chevronRight" size={22} />
                        </span>
                        <span className="plaque-desc">
                          {s.description}
                          {s.priceCents != null && ` · ${money(s.priceCents)}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      )}

      {/* ------------------------------------------------------------ 2. profissional */}
      {step === 'profissional' && service && (
        <section aria-labelledby="t-step">
          <h1 id="t-step" className="step-title display" ref={headingRef} tabIndex={-1}>
            Escolha o profissional
          </h1>
          <p className="step-sub">{service.name}</p>
          <div className="stack">
            {proList.map((p) => (
              <button key={p.id} type="button" className="pro-card selectable" onClick={() => go({ profissional: p.id, data: null, hora: null })}>
                <ProPhoto pro={p} />
                <div>
                  <div className="pro-name">{proLabel(p)}</div>
                  <div className="pro-spec">{p.specialty}</div>
                  {p.registry && <div className="pro-meta">{p.registry}</div>}
                  <div className="pro-days">
                    {WEEKDAYS_SHORT.map((d, i) => (
                      <span key={d} className={p.weekdays.includes(i + 1) ? 'on' : ''} aria-hidden={!p.weekdays.includes(i + 1)}>
                        {d}
                      </span>
                    ))}
                  </div>
                  <span className="sr-only">Atende: {p.weekdays.map((w) => WEEKDAYS_SHORT[w - 1]).join(', ')}</span>
                </div>
                <span className="btn btn-primary btn-sm" aria-hidden>
                  Selecionar
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------ 3. data e horário */}
      {step === 'horario' && service && (
        <section aria-labelledby="t-step">
          <h1 id="t-step" className="step-title display" ref={headingRef} tabIndex={-1}>
            Escolha o dia e o horário
          </h1>
          <div className="choice-summary">
            <span className="chip">
              <Icon name="stethoscope" size={16} /> {service.name}
            </span>
            {professional && (
              <span className="chip">
                <Icon name="user" size={16} /> {proLabel(professional)}
              </span>
            )}
          </div>
          {notice && (
            <div style={{ marginBottom: 16 }}>
              <Alert kind="warn">{notice}</Alert>
            </div>
          )}
          <DateTimePicker
            key={`${service.id}-${professionalId}`}
            serviceId={service.id}
            professionalId={professionalId}
            value={{ date, start }}
            onPick={(d, slot: Slot | null) => {
              if (slot) {
                setNotice(null);
                go({ data: d, hora: slot.start });
              } else go({ data: d, hora: null }, true);
            }}
          />
        </section>
      )}

      {/* ------------------------------------------------------------ 4. dados */}
      {step === 'dados' && service && date && start && (
        <section aria-labelledby="t-step">
          <h1 id="t-step" className="step-title display" ref={headingRef} tabIndex={-1}>
            Seus dados
          </h1>
          <div className="choice-summary">
            <span className="chip">
              <Icon name="stethoscope" size={16} /> {service.name}
            </span>
            <span className="chip">
              <Icon name="calendar" size={16} /> {fmtDateBR(date)} às {slotLabel}
            </span>
          </div>
          {notice && (
            <div style={{ marginBottom: 16 }}>
              <Alert kind="error">{notice}</Alert>
            </div>
          )}
          <form className="form-card" onSubmit={submitData} noValidate>
            <Field label="Nome completo do paciente" error={errors.name}>
              {(id, d) => (
                <input
                  id={id}
                  name="name"
                  className="input"
                  autoComplete="name"
                  value={form.name}
                  aria-describedby={d}
                  aria-invalid={!!errors.name}
                  maxLength={120}
                  onChange={(e) => setField('name', e.target.value)}
                />
              )}
            </Field>
            <Field label="Telefone (WhatsApp)" error={errors.phone} hint="Enviaremos a confirmação e os lembretes por aqui.">
              {(id, d) => (
                <input
                  id={id}
                  name="phone"
                  className="input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="(91) 98888-7777"
                  value={form.phone}
                  aria-describedby={d}
                  aria-invalid={!!errors.phone}
                  onChange={(e) => setField('phone', maskPhone(e.target.value))}
                />
              )}
            </Field>
            <Field label="E-mail" optional={!clinic.requireEmail} error={errors.email}>
              {(id, d) => (
                <input
                  id={id}
                  name="email"
                  className="input"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={form.email}
                  aria-describedby={d}
                  aria-invalid={!!errors.email}
                  maxLength={254}
                  onChange={(e) => setField('email', e.target.value)}
                />
              )}
            </Field>
            {(clinic.requireCpf || clinic.requireBirthDate) && (
              <div className="form-row">
                {clinic.requireCpf && (
                  <Field label="CPF" error={errors.cpf}>
                    {(id, d) => (
                      <input
                        id={id}
                        name="cpf"
                        className="input"
                        inputMode="numeric"
                        placeholder="000.000.000-00"
                        value={form.cpf}
                        aria-describedby={d}
                        aria-invalid={!!errors.cpf}
                        onChange={(e) => setField('cpf', maskCpf(e.target.value))}
                      />
                    )}
                  </Field>
                )}
                {clinic.requireBirthDate && (
                  <Field label="Data de nascimento" error={errors.birthDate}>
                    {(id, d) => (
                      <input
                        id={id}
                        name="birthDate"
                        className="input"
                        type="date"
                        max={new Date().toISOString().slice(0, 10)}
                        value={form.birthDate}
                        aria-describedby={d}
                        aria-invalid={!!errors.birthDate}
                        onChange={(e) => setField('birthDate', e.target.value)}
                      />
                    )}
                  </Field>
                )}
              </div>
            )}
            <Field label="Observação" optional error={errors.notes} hint="Ex.: é retorno, primeira consulta, precisa de acessibilidade. Não informe dados de saúde.">
              {(id, d) => (
                <textarea
                  id={id}
                  name="notes"
                  className="textarea"
                  value={form.notes}
                  aria-describedby={d}
                  maxLength={500}
                  rows={3}
                  onChange={(e) => setField('notes', e.target.value)}
                />
              )}
            </Field>
            {/* campo invisível para robôs (honeypot) */}
            <div className="honeypot" aria-hidden="true">
              <label>
                Site
                <input tabIndex={-1} autoComplete="off" name="website" value={form.website} onChange={(e) => setField('website', e.target.value)} />
              </label>
            </div>
            <div className="field">
              <label className="check">
                <input
                  type="checkbox"
                  name="consent"
                  checked={form.consent}
                  aria-invalid={!!errors.consent}
                  onChange={(e) => setField('consent', e.target.checked)}
                />
                <span>
                  Li e aceito a{' '}
                  <Link to="/privacidade" target="_blank">
                    política de privacidade
                  </Link>{' '}
                  e concordo em receber mensagens sobre este agendamento.
                </span>
              </label>
              {errors.consent && (
                <span className="field-error">
                  <Icon name="alert" size={16} /> {errors.consent}
                </span>
              )}
            </div>
            <button type="submit" className="btn btn-primary btn-lg btn-block">
              Revisar agendamento <Icon name="arrowRight" size={20} />
            </button>
          </form>
        </section>
      )}

      {/* ------------------------------------------------------------ 5. confirmar */}
      {step === 'confirmar' && service && date && start && (
        <section aria-labelledby="t-step">
          <h1 id="t-step" className="step-title display" ref={headingRef} tabIndex={-1}>
            Confira e confirme
          </h1>
          <p className="step-sub">Verifique se está tudo certo antes de finalizar.</p>
          <div className="stack">
            <div className="summary">
              <div className="summary-head">
                <h3>Sua consulta</h3>
                <Icon name="calendar" size={24} />
              </div>
              <dl>
                <div className="row">
                  <dt>Serviço</dt>
                  <dd>{service.name}</dd>
                </div>
                <div className="row">
                  <dt>Profissional</dt>
                  <dd>{professional ? proLabel(professional) : 'Primeiro profissional disponível'}</dd>
                </div>
                <div className="row">
                  <dt>Data</dt>
                  <dd>
                    {fmtDateBR(date)} <span className="muted" style={{ fontWeight: 400 }}>({fmtDateLong(date).split(',')[0]})</span>
                  </dd>
                </div>
                <div className="row">
                  <dt>Horário</dt>
                  <dd>{slotLabel}</dd>
                </div>
                <div className="row">
                  <dt>Paciente</dt>
                  <dd>{form.name}</dd>
                </div>
                <div className="row">
                  <dt>Telefone</dt>
                  <dd>{form.phone}</dd>
                </div>
                {form.email && (
                  <div className="row">
                    <dt>E-mail</dt>
                    <dd>{form.email}</dd>
                  </div>
                )}
                {clinic.address && (
                  <div className="row">
                    <dt>Local</dt>
                    <dd style={{ fontWeight: 500 }}>{clinic.address}</dd>
                  </div>
                )}
              </dl>
            </div>
            {service.preparation && (
              <div className="prep">
                <Icon name="info" size={20} />
                <div>
                  <strong>Preparo:</strong> {service.preparation}
                </div>
              </div>
            )}
            {clinic.bookingNotice && <p className="muted" style={{ margin: 0 }}>{clinic.bookingNotice}</p>}
            {notice && <Alert kind="error">{notice}</Alert>}
            {clinic.turnstileSiteKey && <Turnstile siteKey={clinic.turnstileSiteKey} onToken={setTurnstileToken} />}
            <div className="sticky-actions">
              <button
                type="button"
                className="btn btn-gold btn-lg btn-block"
                onClick={confirm}
                disabled={submitting || (!!clinic.turnstileSiteKey && !turnstileToken)}
                aria-busy={submitting}
              >
                {submitting ? (
                  <>
                    <Spinner /> Confirmando...
                  </>
                ) : (
                  <>
                    <Icon name="check" size={22} /> CONFIRMAR AGENDAMENTO
                  </>
                )}
              </button>
              <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 6 }} onClick={() => go({ etapa: null })}>
                <Icon name="edit" size={18} /> Corrigir meus dados
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------ pronto */}
      {step === 'pronto' && result && <Success result={result} clinic={clinic} headingRef={headingRef} />}
    </div>
  );
}

function googleCalendarUrl(a: PublicAppointment, clinic: Clinic) {
  const f = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${a.service.name} — ${clinic.shortName || clinic.name}`,
    dates: `${f(a.start)}/${f(a.end)}`,
    details: `Profissional: ${a.professional.name}\nCódigo: ${a.code}${a.service.preparation ? `\nPreparo: ${a.service.preparation}` : ''}`,
    location: clinic.address,
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

export function shareText(a: PublicAppointment, clinic: Clinic, link?: string) {
  return [
    `✅ Agendamento na ${clinic.shortName || clinic.name}`,
    `📋 ${a.service.name}`,
    `👩‍⚕️ ${a.professional.name}`,
    `📅 ${a.date} (${a.weekday}) às ${a.time}`,
    clinic.address ? `📍 ${clinic.address}` : '',
    `Código: ${a.code}`,
    link ? `Detalhes: ${link}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function Success({ result, clinic, headingRef }: { result: Result; clinic: Clinic; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const a = result.appointment;
  const manageUrl = `/agendamento/${a.id}?t=${encodeURIComponent(result.accessToken)}`;
  const fullManage = `${window.location.origin}${manageUrl}`;
  const confirmMsg = `Olá! Acabei de agendar pelo site:\n${shareText(a, clinic)}`;
  const icsUrl = `/api/appointments/${a.id}/calendar.ics?t=${encodeURIComponent(result.accessToken)}`;
  const gcal = useMemo(() => googleCalendarUrl(a, clinic), [a, clinic]);

  return (
    <section aria-labelledby="t-done" className="stack-lg">
      <div className="success-hero">
        <div className="success-seal" aria-hidden>
          <Icon name="check" size={46} strokeWidth={2.6} />
        </div>
        <h1 id="t-done" className="display" ref={headingRef} tabIndex={-1}>
          Agendamento confirmado!
        </h1>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          {a.status === 'PENDING' ? 'Seu horário está reservado. Você receberá um lembrete para confirmar a presença.' : 'Seu horário está confirmado.'}
        </p>
        <div className="code-box">
          <small>Número do agendamento</small>
          <b translate="no">{a.code}</b>
        </div>
        <p className="muted" style={{ fontSize: '0.92rem', margin: '6px 0 0' }}>
          Guarde este número. Com ele e seu telefone você consulta ou cancela o agendamento.
        </p>
      </div>

      <div className="summary">
        <dl>
          <div className="row">
            <dt>Serviço</dt>
            <dd>{a.service.name}</dd>
          </div>
          <div className="row">
            <dt>Profissional</dt>
            <dd>{a.professional.name}</dd>
          </div>
          <div className="row">
            <dt>Data</dt>
            <dd>
              {a.date} <span className="muted" style={{ fontWeight: 400 }}>({a.weekday})</span>
            </dd>
          </div>
          <div className="row">
            <dt>Horário</dt>
            <dd>{a.time}</dd>
          </div>
          {clinic.address && (
            <div className="row">
              <dt>Endereço</dt>
              <dd style={{ fontWeight: 500 }}>
                {clinic.address}
                {clinic.mapsUrl && (
                  <>
                    {' · '}
                    <a href={clinic.mapsUrl} target="_blank" rel="noopener noreferrer">
                      Como chegar
                    </a>
                  </>
                )}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {a.service.preparation && (
        <div className="prep">
          <Icon name="info" size={20} />
          <div>
            <strong>Preparo:</strong> {a.service.preparation}
          </div>
        </div>
      )}

      <div className="action-grid">
        <a className="btn btn-outline btn-lg" href={gcal} target="_blank" rel="noopener noreferrer">
          <Icon name="calendar" size={20} /> Adicionar ao calendário
        </a>
        <a
          className="btn btn-whatsapp btn-lg"
          href={clinic.whatsapp ? waLink(clinic.whatsapp, confirmMsg) : waLink('', shareText(a, clinic, fullManage))}
          target="_blank"
          rel="noopener noreferrer"
        >
          <WhatsAppIcon size={20} /> Enviar confirmação pelo WhatsApp
        </a>
        <a className="btn btn-ghost" href={icsUrl} download>
          <Icon name="download" size={18} /> Baixar evento (iPhone/Outlook)
        </a>
        <a className="btn btn-ghost" href={waLink('', shareText(a, clinic, fullManage))} target="_blank" rel="noopener noreferrer">
          <Icon name="send" size={18} /> Compartilhar com um familiar
        </a>
      </div>

      <div className="page-card stack" style={{ padding: 20 }}>
        <strong>Precisa mudar algo?</strong>
        <span className="muted">{a.cancellationPolicy}</span>
        <div className="action-grid">
          <Link className="btn btn-primary" to={manageUrl}>
            <Icon name="eye" size={18} /> Ver meu agendamento
          </Link>
          <Link className="btn btn-danger-outline" to={`${manageUrl}&acao=cancelar`}>
            <Icon name="xCircle" size={18} /> Cancelar agendamento
          </Link>
        </div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <Link to="/" className="btn btn-ghost">
          <Icon name="home" size={18} /> Voltar ao início
        </Link>
      </div>
    </section>
  );
}

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; remove: (id: string) => void };
  }
}

/** Cloudflare Turnstile (CAPTCHA discreto) — só aparece se a clínica configurar. */
function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (t: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let widget: string | null = null;
    const render = () => {
      if (ref.current && window.turnstile && !widget) {
        widget = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          language: 'pt-br',
          callback: (t: string) => onToken(t),
          'expired-callback': () => onToken(null),
        });
      }
    };
    if (window.turnstile) render();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
    return () => {
      if (widget && window.turnstile) window.turnstile.remove(widget);
    };
  }, [siteKey, onToken]);
  return <div ref={ref} />;
}
