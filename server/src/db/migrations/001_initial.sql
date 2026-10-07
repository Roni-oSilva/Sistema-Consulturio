-- =====================================================================
-- Sistema de Agendamento — Clínica JR Saúde
-- Migração inicial: estrutura completa do banco de dados
-- =====================================================================

-- btree_gist permite a constraint de exclusão que impede dois
-- agendamentos sobrepostos para o mesmo profissional (concorrência).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------
-- Funções / Permissões (RBAC). A matriz de permissões é sincronizada
-- a partir do código (fonte da verdade) — ver src/auth/rbac.ts.
-- ---------------------------------------------------------------------
CREATE TABLE roles (
  code         text PRIMARY KEY,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  permissions  text[] NOT NULL DEFAULT '{}'
);

-- ---------------------------------------------------------------------
-- Configurações da clínica (linha única)
-- ---------------------------------------------------------------------
CREATE TABLE clinic_settings (
  id                         smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name                       text NOT NULL,
  short_name                 text NOT NULL DEFAULT '',
  tagline                    text NOT NULL DEFAULT '',
  description                text NOT NULL DEFAULT '',
  logo_url                   text,
  phone                      text NOT NULL DEFAULT '',
  whatsapp                   text NOT NULL DEFAULT '',
  email                      text NOT NULL DEFAULT '',
  address                    text NOT NULL DEFAULT '',
  maps_url                   text NOT NULL DEFAULT '',
  instagram                  text NOT NULL DEFAULT '',
  opening_hours              text NOT NULL DEFAULT '',
  timezone                   text NOT NULL DEFAULT 'America/Belem',
  -- Regras de agendamento
  default_duration_minutes   integer NOT NULL DEFAULT 30 CHECK (default_duration_minutes BETWEEN 5 AND 480),
  min_advance_minutes        integer NOT NULL DEFAULT 60 CHECK (min_advance_minutes >= 0),
  max_advance_days           integer NOT NULL DEFAULT 60 CHECK (max_advance_days BETWEEN 1 AND 365),
  cancel_min_hours           integer NOT NULL DEFAULT 2 CHECK (cancel_min_hours >= 0),
  allow_patient_reschedule   boolean NOT NULL DEFAULT true,
  initial_status             text NOT NULL DEFAULT 'PENDING' CHECK (initial_status IN ('PENDING', 'CONFIRMED')),
  require_cpf                boolean NOT NULL DEFAULT false,
  require_birth_date         boolean NOT NULL DEFAULT false,
  require_email              boolean NOT NULL DEFAULT false,
  max_active_per_phone       integer NOT NULL DEFAULT 3 CHECK (max_active_per_phone BETWEEN 1 AND 50),
  max_bookings_per_ip_day    integer NOT NULL DEFAULT 15 CHECK (max_bookings_per_ip_day BETWEEN 1 AND 1000),
  booking_notice             text NOT NULL DEFAULT '',
  privacy_policy             text NOT NULL DEFAULT '',
  privacy_policy_version     text NOT NULL DEFAULT '1.0',
  -- Automação de mensagens
  whatsapp_enabled           boolean NOT NULL DEFAULT true,
  email_enabled              boolean NOT NULL DEFAULT true,
  sms_enabled                boolean NOT NULL DEFAULT false,
  reminder1_hours            integer NOT NULL DEFAULT 24 CHECK (reminder1_hours BETWEEN 0 AND 168),
  reminder2_hours            integer NOT NULL DEFAULT 2 CHECK (reminder2_hours BETWEEN 0 AND 48),
  post_visit_enabled         boolean NOT NULL DEFAULT true,
  post_visit_delay_hours     integer NOT NULL DEFAULT 3 CHECK (post_visit_delay_hours BETWEEN 0 AND 168),
  no_show_message_enabled    boolean NOT NULL DEFAULT true,
  review_url                 text NOT NULL DEFAULT '',
  clinic_notify_enabled      boolean NOT NULL DEFAULT true,
  clinic_notify_whatsapp     text NOT NULL DEFAULT '',
  clinic_notify_email        text NOT NULL DEFAULT '',
  daily_agenda_enabled       boolean NOT NULL DEFAULT true,
  daily_agenda_time          text NOT NULL DEFAULT '07:00' CHECK (daily_agenda_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  auto_cancel_unconfirmed_hours integer NOT NULL DEFAULT 0 CHECK (auto_cancel_unconfirmed_hours BETWEEN 0 AND 72),
  auto_complete_after_hours  integer NOT NULL DEFAULT 0 CHECK (auto_complete_after_hours BETWEEN 0 AND 72),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid
);

-- ---------------------------------------------------------------------
-- Profissionais
-- ---------------------------------------------------------------------
CREATE TABLE professionals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  title          text NOT NULL DEFAULT '',            -- Dr., Dra., Ft., ...
  specialty      text NOT NULL DEFAULT '',
  registry       text NOT NULL DEFAULT '',            -- CRM-PA 12345, CREFITO...
  show_registry  boolean NOT NULL DEFAULT true,
  bio            text NOT NULL DEFAULT '',
  photo_url      text,
  color          text NOT NULL DEFAULT '#1B2A47' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  -- contato interno (agenda diária automática); nunca exposto publicamente
  notify_phone   text NOT NULL DEFAULT '',
  notify_email   text NOT NULL DEFAULT '',
  daily_agenda   boolean NOT NULL DEFAULT true,
  active         boolean NOT NULL DEFAULT true,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Serviços
-- ---------------------------------------------------------------------
CREATE TABLE services (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  slug                      text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  category                  text NOT NULL DEFAULT 'CONSULTA' CHECK (category IN ('CONSULTA', 'TERAPIA', 'EXAME', 'OUTRO')),
  description               text NOT NULL DEFAULT '',
  preparation               text NOT NULL DEFAULT '',   -- instruções de preparo (enviadas automaticamente)
  duration_minutes          integer NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 480),
  allow_choose_professional boolean NOT NULL DEFAULT true,
  price_cents               integer CHECK (price_cents IS NULL OR price_cents >= 0),
  show_price                boolean NOT NULL DEFAULT false,
  icon                      text NOT NULL DEFAULT 'stethoscope',
  active                    boolean NOT NULL DEFAULT true,
  sort_order                integer NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE professional_services (
  professional_id   uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  service_id        uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  duration_minutes  integer CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 480),
  PRIMARY KEY (professional_id, service_id)
);
CREATE INDEX professional_services_service_idx ON professional_services (service_id);

-- ---------------------------------------------------------------------
-- Horários de atendimento (semanal). weekday: 1=segunda ... 7=domingo
-- ---------------------------------------------------------------------
CREATE TABLE schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id  uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  weekday          smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time       time NOT NULL,
  end_time         time NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX schedules_professional_idx ON schedules (professional_id, weekday);

-- Horários especiais por data: substituem a grade semanal naquele dia.
-- Uma linha com start_time/end_time NULL significa "não atende neste dia".
CREATE TABLE schedule_overrides (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id  uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  date             date NOT NULL,
  start_time       time,
  end_time         time,
  note             text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((start_time IS NULL AND end_time IS NULL) OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time))
);
CREATE INDEX schedule_overrides_idx ON schedule_overrides (professional_id, date);

-- ---------------------------------------------------------------------
-- Feriados (bloqueiam a clínica inteira)
-- ---------------------------------------------------------------------
CREATE TABLE holidays (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date        date NOT NULL,
  name        text NOT NULL,
  recurring   boolean NOT NULL DEFAULT false,  -- repete todo ano (mesmo dia/mês)
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date, recurring)
);

-- ---------------------------------------------------------------------
-- Usuários administrativos
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  email                 text NOT NULL,
  password_hash         text NOT NULL,
  role                  text NOT NULL REFERENCES roles(code),
  professional_id       uuid REFERENCES professionals(id) ON DELETE SET NULL,
  active                boolean NOT NULL DEFAULT true,
  must_change_password  boolean NOT NULL DEFAULT false,
  last_login_at         timestamptz,
  password_changed_at   timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

ALTER TABLE clinic_settings
  ADD CONSTRAINT clinic_settings_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;

-- Sessões no servidor. "id" é o SHA-256 do token do cookie (o token em
-- si nunca é armazenado).
CREATE TABLE sessions (
  id             text PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  ip             text NOT NULL DEFAULT '',
  user_agent     text NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Proteção contra força bruta (por e-mail e por IP)
CREATE TABLE auth_throttle (
  key               text PRIMARY KEY,
  failures          integer NOT NULL DEFAULT 0,
  first_failure_at  timestamptz NOT NULL DEFAULT now(),
  locked_until      timestamptz
);

-- ---------------------------------------------------------------------
-- Bloqueios de horário (férias, folgas, reuniões, manutenção...)
-- professional_id NULL = bloqueia a clínica inteira
-- ---------------------------------------------------------------------
CREATE TABLE blocked_times (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id  uuid REFERENCES professionals(id) ON DELETE CASCADE,
  start_at         timestamptz NOT NULL,
  end_at           timestamptz NOT NULL,
  reason_type      text NOT NULL DEFAULT 'OTHER' CHECK (reason_type IN ('VACATION', 'DAY_OFF', 'MEETING', 'MAINTENANCE', 'OTHER')),
  description      text NOT NULL DEFAULT '',
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);
CREATE INDEX blocked_times_range_idx ON blocked_times USING gist (professional_id, tstzrange(start_at, end_at, '[)'));

-- ---------------------------------------------------------------------
-- Pacientes (dados mínimos — LGPD)
-- ---------------------------------------------------------------------
CREATE TABLE patients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  name_key        text NOT NULL,             -- nome normalizado para deduplicação
  phone           text NOT NULL,             -- somente dígitos, com DDI (55...)
  email           text,
  cpf             text,
  birth_date      date,
  anonymized_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patients_phone_idx ON patients (phone);
CREATE INDEX patients_name_key_idx ON patients (name_key);

-- ---------------------------------------------------------------------
-- Agendamentos — nunca são apagados; mudam de status.
-- ---------------------------------------------------------------------
CREATE TABLE appointments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,
  access_token_hash  text NOT NULL,
  service_id         uuid NOT NULL REFERENCES services(id),
  professional_id    uuid NOT NULL REFERENCES professionals(id),
  patient_id         uuid NOT NULL REFERENCES patients(id),
  patient_name       text NOT NULL,
  contact_phone      text NOT NULL,
  contact_email      text,
  start_at           timestamptz NOT NULL,
  end_at             timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  source             text NOT NULL DEFAULT 'ONLINE' CHECK (source IN ('ONLINE', 'ADMIN')),
  patient_notes      text NOT NULL DEFAULT '',
  internal_notes     text NOT NULL DEFAULT '',
  confirmed_at       timestamptz,
  cancelled_at       timestamptz,
  cancelled_by       text CHECK (cancelled_by IS NULL OR cancelled_by IN ('PATIENT', 'STAFF', 'SYSTEM')),
  cancel_reason      text NOT NULL DEFAULT '',
  completed_at       timestamptz,
  no_show_at         timestamptz,
  reschedule_count   integer NOT NULL DEFAULT 0,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  ip_hash            text NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  -- GARANTIA FINAL CONTRA RESERVA DUPLA: o banco recusa qualquer
  -- agendamento ativo que se sobreponha a outro do mesmo profissional.
  CONSTRAINT appointments_no_overlap EXCLUDE USING gist (
    professional_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status <> 'CANCELLED')
);
CREATE INDEX appointments_start_idx ON appointments (start_at);
CREATE INDEX appointments_prof_start_idx ON appointments (professional_id, start_at);
CREATE INDEX appointments_status_start_idx ON appointments (status, start_at);
CREATE INDEX appointments_phone_idx ON appointments (contact_phone, start_at);
CREATE INDEX appointments_patient_idx ON appointments (patient_id);
CREATE INDEX appointments_ip_idx ON appointments (ip_hash, created_at);

-- Histórico interno de cada agendamento
CREATE TABLE appointment_events (
  id              bigserial PRIMARY KEY,
  appointment_id  uuid NOT NULL REFERENCES appointments(id),
  at              timestamptz NOT NULL DEFAULT now(),
  actor_type      text NOT NULL CHECK (actor_type IN ('PATIENT', 'STAFF', 'SYSTEM')),
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  action          text NOT NULL,
  from_status     text,
  to_status       text,
  details         jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX appointment_events_appt_idx ON appointment_events (appointment_id, at);

-- Registro de consentimentos (LGPD)
CREATE TABLE consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES patients(id),
  appointment_id  uuid REFERENCES appointments(id),
  type            text NOT NULL,          -- PRIVACY_POLICY, MESSAGES
  version         text NOT NULL,
  granted         boolean NOT NULL,
  ip_hash         text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_patient_idx ON consents (patient_id);

-- ---------------------------------------------------------------------
-- Mensagens automáticas
-- ---------------------------------------------------------------------
CREATE TABLE message_templates (
  type        text NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('WHATSAPP', 'EMAIL', 'SMS')),
  subject     text NOT NULL DEFAULT '',
  body        text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (type, channel)
);

CREATE TABLE notifications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id       uuid REFERENCES appointments(id),
  professional_id      uuid REFERENCES professionals(id) ON DELETE SET NULL,
  type                 text NOT NULL,
  channel              text NOT NULL CHECK (channel IN ('WHATSAPP', 'EMAIL', 'SMS')),
  audience             text NOT NULL DEFAULT 'PATIENT' CHECK (audience IN ('PATIENT', 'CLINIC', 'PROFESSIONAL')),
  recipient            text NOT NULL,
  subject              text NOT NULL DEFAULT '',
  body                 text NOT NULL DEFAULT '',
  status               text NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED', 'MANUAL')),
  scheduled_for        timestamptz NOT NULL DEFAULT now(),
  attempts             integer NOT NULL DEFAULT 0,
  last_error           text NOT NULL DEFAULT '',
  provider             text NOT NULL DEFAULT '',
  provider_message_id  text NOT NULL DEFAULT '',
  dedupe_key           text UNIQUE,
  context              jsonb NOT NULL DEFAULT '{}',
  sent_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_due_idx ON notifications (status, scheduled_for);
CREATE INDEX notifications_appt_idx ON notifications (appointment_id);

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id             bigserial PRIMARY KEY,
  at             timestamptz NOT NULL DEFAULT now(),
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  user_label     text NOT NULL DEFAULT '',
  action         text NOT NULL,
  resource_type  text NOT NULL DEFAULT '',
  resource_id    text NOT NULL DEFAULT '',
  result         text NOT NULL DEFAULT 'SUCCESS' CHECK (result IN ('SUCCESS', 'FAILURE', 'DENIED')),
  ip             text NOT NULL DEFAULT '',
  user_agent     text NOT NULL DEFAULT '',
  details        jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_logs_at_idx ON audit_logs (at DESC);
CREATE INDEX audit_logs_user_idx ON audit_logs (user_id, at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, at DESC);
