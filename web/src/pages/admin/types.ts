export type Me = {
  id: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'RECEPTION' | 'PROFESSIONAL';
  professionalId: string | null;
  mustChangePassword: boolean;
  permissions: string[];
};

export type AdminAppointment = {
  id: string;
  code: string;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  source: 'ONLINE' | 'ADMIN';
  start: string;
  end: string;
  date: string;
  time: string;
  endTime: string;
  service: { id: string; name: string; category: string };
  professional: { id: string; name: string; color: string };
  patient: { id: string; name: string; phone: string; phoneRaw: string; email: string | null };
  patientNotes: string;
  internalNotes: string;
  rescheduleCount: number;
  cancelReason: string;
  cancelledBy: string | null;
  createdAt: string;
};

export type AdminProfessional = {
  id: string;
  name: string;
  title: string;
  specialty: string;
  registry: string;
  showRegistry: boolean;
  bio: string;
  photoUrl: string | null;
  color: string;
  notifyPhone: string;
  notifyEmail: string;
  dailyAgenda: boolean;
  active: boolean;
  sortOrder: number;
  services: { serviceId: string; durationMinutes: number | null }[];
  schedules: { weekday: number; start: string; end: string }[];
  overrides: { id: string; date: string; start: string | null; end: string | null; note: string }[];
};

export type AdminService = {
  id: string;
  name: string;
  slug: string;
  category: 'CONSULTA' | 'TERAPIA' | 'EXAME' | 'OUTRO';
  description: string;
  preparation: string;
  durationMinutes: number;
  allowChooseProfessional: boolean;
  priceCents: number | null;
  showPrice: boolean;
  icon: string;
  active: boolean;
  sortOrder: number;
  professionalIds: string[];
};

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super administrador',
  ADMIN: 'Administrador',
  RECEPTION: 'Recepção',
  PROFESSIONAL: 'Profissional',
};

export const BLOCK_REASON: Record<string, string> = {
  VACATION: 'Férias',
  DAY_OFF: 'Folga',
  MEETING: 'Reunião',
  MAINTENANCE: 'Manutenção',
  OTHER: 'Outro motivo',
};
