/**
 * Modelos padrão das mensagens automáticas. A clínica pode editar todos
 * pelo painel (Mensagens). Variáveis são escritas como {{nome}}.
 */
export type Channel = 'WHATSAPP' | 'EMAIL' | 'SMS';

export const NOTIFICATION_TYPES = {
  BOOKING_CREATED: { label: 'Agendamento realizado', audience: 'PATIENT' },
  APPOINTMENT_CONFIRMED: { label: 'Consulta confirmada pela clínica', audience: 'PATIENT' },
  REMINDER: { label: 'Lembrete (véspera)', audience: 'PATIENT' },
  REMINDER_SHORT: { label: 'Lembrete (poucas horas antes)', audience: 'PATIENT' },
  RESCHEDULED: { label: 'Agendamento alterado', audience: 'PATIENT' },
  CANCELLED: { label: 'Agendamento cancelado', audience: 'PATIENT' },
  POST_VISIT: { label: 'Pós-atendimento (agradecimento)', audience: 'PATIENT' },
  NO_SHOW: { label: 'Falta (convite para remarcar)', audience: 'PATIENT' },
  CLINIC_NEW_BOOKING: { label: 'Aviso à clínica: novo agendamento', audience: 'CLINIC' },
  CLINIC_CANCELLED: { label: 'Aviso à clínica: cancelamento', audience: 'CLINIC' },
  CLINIC_RESCHEDULED: { label: 'Aviso à clínica: remarcação', audience: 'CLINIC' },
  DAILY_AGENDA: { label: 'Agenda do dia (profissional)', audience: 'PROFESSIONAL' },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export const TEMPLATE_VARIABLES: Record<string, string> = {
  paciente: 'Nome completo do paciente',
  primeiro_nome: 'Primeiro nome do paciente',
  clinica: 'Nome da clínica',
  servico: 'Serviço agendado',
  profissional: 'Profissional (com título)',
  data: 'Data (dd/mm/aaaa)',
  dia_semana: 'Dia da semana',
  hora: 'Horário (hh:mm)',
  endereco: 'Endereço da clínica',
  telefone_clinica: 'Telefone da clínica',
  whatsapp_clinica: 'WhatsApp da clínica',
  codigo: 'Código do agendamento',
  link: 'Link seguro para ver/confirmar/remarcar/cancelar',
  link_agendar: 'Link para um novo agendamento',
  preparo: 'Instruções de preparo do serviço',
  politica_cancelamento: 'Regra de cancelamento',
  motivo: 'Motivo do cancelamento',
  avaliacao_link: 'Link para avaliação (Google)',
  telefone_paciente: 'Telefone do paciente (avisos internos)',
  agenda: 'Lista de atendimentos do dia (agenda diária)',
  total: 'Total de atendimentos do dia (agenda diária)',
};

type Tpl = { subject?: string; body: string };
type Defaults = Partial<Record<NotificationType, Partial<Record<Channel, Tpl>>>>;

const FOOTER_EMAIL = '\n\n{{clinica}}\n{{endereco}}\nTelefone: {{telefone_clinica}}';

export const DEFAULT_TEMPLATES: Defaults = {
  BOOKING_CREATED: {
    WHATSAPP: {
      body:
        'Olá, {{primeiro_nome}}! 😊\n' +
        'Seu agendamento na *{{clinica}}* foi realizado.\n\n' +
        '📋 *{{servico}}*\n' +
        '👩‍⚕️ {{profissional}}\n' +
        '📅 {{data}} ({{dia_semana}})\n' +
        '⏰ {{hora}}\n' +
        '📍 {{endereco}}\n\n' +
        'Código: *{{codigo}}*\n' +
        '{{preparo}}\n' +
        'Para confirmar presença, remarcar ou cancelar:\n{{link}}\n\n' +
        'Será um prazer receber você!',
    },
    EMAIL: {
      subject: 'Agendamento realizado — {{servico}} em {{data}} às {{hora}}',
      body:
        'Olá, {{primeiro_nome}}!\n\n' +
        'Seu agendamento na {{clinica}} foi realizado com sucesso.\n\n' +
        'Serviço: {{servico}}\nProfissional: {{profissional}}\nData: {{data}} ({{dia_semana}})\nHorário: {{hora}}\n' +
        'Código do agendamento: {{codigo}}\n\n{{preparo}}\n\n' +
        'Para confirmar presença, remarcar ou cancelar, acesse:\n{{link}}\n\n{{politica_cancelamento}}' +
        FOOTER_EMAIL,
    },
    SMS: {
      body: '{{clinica}}: {{servico}} em {{data}} as {{hora}}. Cod {{codigo}}. Detalhes: {{link}}',
    },
  },
  APPOINTMENT_CONFIRMED: {
    WHATSAPP: {
      body:
        'Olá, {{primeiro_nome}}! ✅ Sua consulta está *confirmada*.\n\n' +
        '📋 {{servico}} com {{profissional}}\n📅 {{data}} às {{hora}}\n📍 {{endereco}}\n\n' +
        'Chegue com 15 minutos de antecedência. Até lá!',
    },
    EMAIL: {
      subject: 'Consulta confirmada — {{data}} às {{hora}}',
      body:
        'Olá, {{primeiro_nome}}!\n\nSua consulta está confirmada.\n\n' +
        'Serviço: {{servico}}\nProfissional: {{profissional}}\nData: {{data}} às {{hora}}\n\n' +
        'Chegue com 15 minutos de antecedência.\nDetalhes: {{link}}' +
        FOOTER_EMAIL,
    },
  },
  REMINDER: {
    WHATSAPP: {
      body:
        'Olá, {{primeiro_nome}}! 🔔 Lembrete da *{{clinica}}*:\n\n' +
        'Você tem *{{servico}}* com {{profissional}}\n📅 {{dia_semana}}, {{data}} às *{{hora}}*\n📍 {{endereco}}\n\n' +
        '{{preparo}}\n' +
        '👉 Confirme sua presença (ou remarque) pelo link:\n{{link}}',
    },
    EMAIL: {
      subject: 'Lembrete: {{servico}} — {{data}} às {{hora}}',
      body:
        'Olá, {{primeiro_nome}}!\n\nLembramos do seu atendimento:\n\n' +
        'Serviço: {{servico}}\nProfissional: {{profissional}}\nData: {{dia_semana}}, {{data}} às {{hora}}\n\n{{preparo}}\n\n' +
        'Confirme sua presença, remarque ou cancele em:\n{{link}}' +
        FOOTER_EMAIL,
    },
    SMS: { body: '{{clinica}}: lembrete {{servico}} {{data}} as {{hora}}. Confirme: {{link}}' },
  },
  REMINDER_SHORT: {
    WHATSAPP: {
      body:
        '{{primeiro_nome}}, seu atendimento na *{{clinica}}* é hoje às *{{hora}}* ⏰\n' +
        '📍 {{endereco}}\n\nSe não puder comparecer, avise pelo link: {{link}}',
    },
  },
  RESCHEDULED: {
    WHATSAPP: {
      body:
        'Olá, {{primeiro_nome}}! 🔄 Seu agendamento foi *alterado*.\n\n' +
        'Novo horário:\n📋 {{servico}}\n👩‍⚕️ {{profissional}}\n📅 {{data}} ({{dia_semana}})\n⏰ {{hora}}\n\n' +
        'Código: {{codigo}}\nDetalhes: {{link}}',
    },
    EMAIL: {
      subject: 'Agendamento alterado — {{data}} às {{hora}}',
      body:
        'Olá, {{primeiro_nome}}!\n\nSeu agendamento foi alterado. Novo horário:\n\n' +
        'Serviço: {{servico}}\nProfissional: {{profissional}}\nData: {{data}} ({{dia_semana}})\nHorário: {{hora}}\n\n' +
        'Detalhes: {{link}}' +
        FOOTER_EMAIL,
    },
    SMS: { body: '{{clinica}}: agendamento alterado para {{data}} as {{hora}}. {{link}}' },
  },
  CANCELLED: {
    WHATSAPP: {
      body:
        'Olá, {{primeiro_nome}}. Seu agendamento de *{{servico}}* em {{data}} às {{hora}} foi *cancelado*.\n' +
        '{{motivo}}\n\nQuando quiser, agende novamente: {{link_agendar}}',
    },
    EMAIL: {
      subject: 'Agendamento cancelado — {{data}} às {{hora}}',
      body:
        'Olá, {{primeiro_nome}}.\n\nSeu agendamento de {{servico}} em {{data}} às {{hora}} foi cancelado.\n{{motivo}}\n\n' +
        'Para agendar novamente: {{link_agendar}}' +
        FOOTER_EMAIL,
    },
    SMS: { body: '{{clinica}}: agendamento de {{data}} as {{hora}} cancelado. Novo: {{link_agendar}}' },
  },
  POST_VISIT: {
    WHATSAPP: {
      body:
        'Olá, {{primeiro_nome}}! 💙 Obrigado por escolher a *{{clinica}}*.\n' +
        'Esperamos que tenha sido bem atendido(a).\n\n' +
        '{{avaliacao_link}}\n' +
        'Precisando de retorno ou de um novo atendimento, é só agendar: {{link_agendar}}',
    },
  },
  NO_SHOW: {
    WHATSAPP: {
      body:
        'Olá, {{primeiro_nome}}. Sentimos sua falta hoje no atendimento de *{{servico}}* às {{hora}}.\n' +
        'Está tudo bem? Você pode remarcar facilmente por aqui: {{link_agendar}}',
    },
  },
  CLINIC_NEW_BOOKING: {
    WHATSAPP: {
      body:
        '🆕 *Novo agendamento online*\n{{paciente}} — {{telefone_paciente}}\n' +
        '{{servico}} com {{profissional}}\n{{dia_semana}}, {{data}} às {{hora}}\nCódigo {{codigo}}',
    },
    EMAIL: {
      subject: 'Novo agendamento: {{paciente}} — {{data}} {{hora}}',
      body:
        'Novo agendamento online.\n\nPaciente: {{paciente}}\nTelefone: {{telefone_paciente}}\n' +
        'Serviço: {{servico}}\nProfissional: {{profissional}}\nData: {{dia_semana}}, {{data}} às {{hora}}\nCódigo: {{codigo}}',
    },
  },
  CLINIC_CANCELLED: {
    WHATSAPP: {
      body:
        '❌ *Cancelamento*\n{{paciente}} — {{telefone_paciente}}\n{{servico}} com {{profissional}}\n' +
        '{{data}} às {{hora}} (horário liberado)\n{{motivo}}',
    },
    EMAIL: {
      subject: 'Cancelamento: {{paciente}} — {{data}} {{hora}}',
      body:
        'Agendamento cancelado — o horário foi liberado.\n\nPaciente: {{paciente}}\nTelefone: {{telefone_paciente}}\n' +
        'Serviço: {{servico}}\nProfissional: {{profissional}}\nData: {{data}} às {{hora}}\n{{motivo}}',
    },
  },
  CLINIC_RESCHEDULED: {
    WHATSAPP: {
      body:
        '🔄 *Remarcação pelo paciente*\n{{paciente}} — {{telefone_paciente}}\n{{servico}} com {{profissional}}\n' +
        'Novo horário: {{data}} às {{hora}}',
    },
  },
  DAILY_AGENDA: {
    WHATSAPP: {
      body: '☀️ Bom dia, {{profissional}}!\nSua agenda de hoje ({{data}}) — {{total}} atendimento(s):\n\n{{agenda}}',
    },
    EMAIL: {
      subject: 'Agenda de hoje ({{data}}) — {{total}} atendimento(s)',
      body: 'Bom dia, {{profissional}}!\n\nSua agenda de hoje ({{data}}):\n\n{{agenda}}\n\n{{clinica}}',
    },
  },
};

/** Renderiza um modelo substituindo {{variavel}}. Variáveis ausentes viram vazio. */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  const out = tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '');
  // remove linhas vazias repetidas geradas por variáveis em branco
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
