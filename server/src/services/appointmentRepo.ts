import type { Queryable } from '../db/pool.js';

export type AppointmentStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type AppointmentFull = {
  id: string;
  code: string;
  access_token_hash: string;
  service_id: string;
  service_name: string;
  service_category: string;
  service_preparation: string;
  professional_id: string;
  professional_name: string;
  professional_title: string;
  professional_specialty: string;
  professional_color: string;
  patient_id: string;
  patient_name: string;
  contact_phone: string;
  contact_email: string | null;
  start_at: Date;
  end_at: Date;
  status: AppointmentStatus;
  source: 'ONLINE' | 'ADMIN';
  patient_notes: string;
  internal_notes: string;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  cancel_reason: string;
  completed_at: Date | null;
  no_show_at: Date | null;
  reschedule_count: number;
  created_at: Date;
  updated_at: Date;
};

export const APPOINTMENT_SELECT = `
  SELECT a.id, a.code, a.access_token_hash, a.service_id, s.name AS service_name, s.category AS service_category,
         s.preparation AS service_preparation,
         a.professional_id, p.name AS professional_name, p.title AS professional_title,
         p.specialty AS professional_specialty, p.color AS professional_color,
         a.patient_id, a.patient_name, a.contact_phone, a.contact_email, a.start_at, a.end_at, a.status, a.source,
         a.patient_notes, a.internal_notes, a.confirmed_at, a.cancelled_at, a.cancelled_by, a.cancel_reason,
         a.completed_at, a.no_show_at, a.reschedule_count, a.created_at, a.updated_at
    FROM appointments a
    JOIN services s ON s.id = a.service_id
    JOIN professionals p ON p.id = a.professional_id`;

export async function getAppointment(db: Queryable, id: string, forUpdate = false): Promise<AppointmentFull | null> {
  const { rows } = await db.query<AppointmentFull>(
    `${APPOINTMENT_SELECT} WHERE a.id = $1 ${forUpdate ? 'FOR UPDATE OF a' : ''}`,
    [id],
  );
  return rows[0] ?? null;
}

export function professionalLabel(a: { professional_title: string; professional_name: string }) {
  return [a.professional_title, a.professional_name].filter(Boolean).join(' ');
}

export async function addEvent(
  db: Queryable,
  e: {
    appointmentId: string;
    actorType: 'PATIENT' | 'STAFF' | 'SYSTEM';
    actorUserId?: string | null;
    action: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    details?: Record<string, unknown>;
  },
) {
  await db.query(
    `INSERT INTO appointment_events (appointment_id, actor_type, actor_user_id, action, from_status, to_status, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [e.appointmentId, e.actorType, e.actorUserId ?? null, e.action, e.fromStatus ?? null, e.toStatus ?? null, JSON.stringify(e.details ?? {})],
  );
}
