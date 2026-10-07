export type Service = {
  id: string;
  name: string;
  slug: string;
  category: 'CONSULTA' | 'TERAPIA' | 'EXAME' | 'OUTRO';
  description: string;
  preparation: string;
  durationMinutes: number;
  allowChooseProfessional: boolean;
  icon: string;
  priceCents: number | null;
  professionalCount: number;
};

export type Professional = {
  id: string;
  name: string;
  title: string;
  specialty: string;
  registry: string;
  bio: string;
  photoUrl: string | null;
  color: string;
  weekdays: number[];
  serviceIds: string[];
};

export type Slot = { time: string; start: string };

export type PublicAppointment = {
  id: string;
  code: string;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  service: { id: string; name: string; preparation: string };
  professional: { id: string; name: string; specialty: string };
  start: string;
  end: string;
  date: string;
  dateLong: string;
  weekday: string;
  time: string;
  patientName: string;
  phoneMasked: string;
  canCancel: boolean;
  canReschedule: boolean;
  canConfirm: boolean;
  changeBlockedReason: string | null;
  cancellationPolicy: string;
};

export function proLabel(p: { title?: string; name: string }) {
  return [p.title, p.name].filter(Boolean).join(' ');
}
