import type { Queryable } from '../db/pool.js';

export type ClinicSettings = {
  name: string;
  short_name: string;
  tagline: string;
  description: string;
  logo_url: string | null;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  maps_url: string;
  instagram: string;
  opening_hours: string;
  timezone: string;
  default_duration_minutes: number;
  min_advance_minutes: number;
  max_advance_days: number;
  cancel_min_hours: number;
  allow_patient_reschedule: boolean;
  initial_status: 'PENDING' | 'CONFIRMED';
  require_cpf: boolean;
  require_birth_date: boolean;
  require_email: boolean;
  max_active_per_phone: number;
  max_bookings_per_ip_day: number;
  booking_notice: string;
  privacy_policy: string;
  privacy_policy_version: string;
  whatsapp_enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  reminder1_hours: number;
  reminder2_hours: number;
  post_visit_enabled: boolean;
  post_visit_delay_hours: number;
  no_show_message_enabled: boolean;
  review_url: string;
  clinic_notify_enabled: boolean;
  clinic_notify_whatsapp: string;
  clinic_notify_email: string;
  daily_agenda_enabled: boolean;
  daily_agenda_time: string;
  auto_cancel_unconfirmed_hours: number;
  auto_complete_after_hours: number;
  updated_at: string;
};

let cache: { value: ClinicSettings; at: number } | null = null;
const TTL_MS = 5_000;

export async function getSettings(db: Queryable, fresh = false): Promise<ClinicSettings> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const { rows } = await db.query('SELECT * FROM clinic_settings WHERE id = 1');
  if (!rows[0]) throw new Error('Configurações da clínica não encontradas. Execute "npm run seed".');
  const value = rows[0] as ClinicSettings;
  cache = { value, at: Date.now() };
  return value;
}

export function invalidateSettings() {
  cache = null;
}

/** Texto amigável da política de cancelamento. */
export function cancellationPolicyText(s: ClinicSettings): string {
  if (s.cancel_min_hours <= 0) return 'Cancelamentos podem ser feitos até o horário do atendimento.';
  const h = s.cancel_min_hours;
  return `Cancelamentos e remarcações podem ser feitos online até ${h} hora${h > 1 ? 's' : ''} antes do horário.`;
}
