import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { ROLE_DEFS, type Role } from '../auth/rbac.js';
import { hashPassword } from '../auth/password.js';
import { DEFAULT_TEMPLATES } from '../services/notifications/defaults.js';

/**
 * Dados extraídos do vídeo institucional da Clínica JR Saúde:
 * - Consultas: Pediatria, Dermatologia, Ortopedia, Ginecologia, Cardiologia
 * - Atendimentos: Endocrinologia, Nutrologia, Gastroenterologia, Fisioterapia
 * - Exames: Eletrocardiograma, MAPA, Holter 24h, Ultrassonografia,
 *   Coleta de exames laboratoriais
 * - "Profissionais preparados para cuidar da sua saúde com atenção e qualidade."
 * - "Um ambiente preparado para cuidar de você e da sua família."
 */

const CONSULTA_PREP =
  'Traga documento com foto, cartão do convênio (se houver), exames anteriores e a lista de medicamentos em uso. Chegue com 15 minutos de antecedência.';

type SeedService = {
  slug: string;
  name: string;
  category: 'CONSULTA' | 'TERAPIA' | 'EXAME' | 'OUTRO';
  description: string;
  preparation: string;
  duration: number;
  choose: boolean;
  icon: string;
};

export const SEED_SERVICES: SeedService[] = [
  { slug: 'pediatria', name: 'Pediatria', category: 'CONSULTA', icon: 'baby', duration: 30, choose: true,
    description: 'Acompanhamento da saúde e do desenvolvimento de bebês, crianças e adolescentes.',
    preparation: CONSULTA_PREP + ' Traga a caderneta de vacinação da criança.' },
  { slug: 'dermatologia', name: 'Dermatologia', category: 'CONSULTA', icon: 'skin', duration: 30, choose: true,
    description: 'Cuidados com a pele, cabelos e unhas.', preparation: CONSULTA_PREP },
  { slug: 'ortopedia', name: 'Ortopedia', category: 'CONSULTA', icon: 'bone', duration: 30, choose: true,
    description: 'Diagnóstico e tratamento de ossos, articulações, músculos e coluna.',
    preparation: CONSULTA_PREP + ' Traga raio-X ou outros exames de imagem, se tiver.' },
  { slug: 'ginecologia', name: 'Ginecologia', category: 'CONSULTA', icon: 'female', duration: 30, choose: true,
    description: 'Saúde da mulher em todas as fases da vida.', preparation: CONSULTA_PREP },
  { slug: 'cardiologia', name: 'Cardiologia', category: 'CONSULTA', icon: 'heart', duration: 30, choose: true,
    description: 'Prevenção, diagnóstico e tratamento de doenças do coração.', preparation: CONSULTA_PREP },
  { slug: 'endocrinologia', name: 'Endocrinologia', category: 'CONSULTA', icon: 'drop', duration: 30, choose: true,
    description: 'Hormônios, tireoide, diabetes e metabolismo.', preparation: CONSULTA_PREP },
  { slug: 'nutrologia', name: 'Nutrologia', category: 'CONSULTA', icon: 'apple', duration: 30, choose: true,
    description: 'Nutrição clínica, controle de peso e deficiências nutricionais.', preparation: CONSULTA_PREP },
  { slug: 'gastroenterologia', name: 'Gastroenterologia', category: 'CONSULTA', icon: 'stomach', duration: 30, choose: true,
    description: 'Saúde do sistema digestivo: estômago, intestino, fígado.', preparation: CONSULTA_PREP },
  { slug: 'fisioterapia', name: 'Fisioterapia', category: 'TERAPIA', icon: 'motion', duration: 60, choose: true,
    description: 'Reabilitação, alívio de dores e recuperação de movimentos.',
    preparation: 'Use roupas confortáveis que permitam movimentar a região tratada. Traga o encaminhamento médico e exames, se tiver.' },
  { slug: 'eletrocardiograma', name: 'Eletrocardiograma (ECG)', category: 'EXAME', icon: 'pulse', duration: 20, choose: false,
    description: 'Registro da atividade elétrica do coração. Rápido e indolor.',
    preparation: 'Evite cremes ou óleos no peito no dia do exame. Use roupa confortável. Traga o pedido médico.' },
  { slug: 'mapa', name: 'MAPA 24h', category: 'EXAME', icon: 'gauge', duration: 30, choose: false,
    description: 'Monitorização Ambulatorial da Pressão Arterial durante 24 horas.',
    preparation: 'Use blusa de manga curta ou larga. O aparelho fica com você por 24 horas — evite exercícios intensos. Traga o pedido médico.' },
  { slug: 'holter', name: 'Holter 24h', category: 'EXAME', icon: 'pulse', duration: 30, choose: false,
    description: 'Monitoramento contínuo do ritmo do coração por 24 horas.',
    preparation: 'Tome banho antes da instalação — o aparelho não pode ser molhado durante as 24 horas. Use roupa confortável. Traga o pedido médico.' },
  { slug: 'ultrassonografia', name: 'Ultrassonografia', category: 'EXAME', icon: 'wave', duration: 30, choose: false,
    description: 'Exames de imagem por ultrassom.',
    preparation: 'Alguns tipos exigem preparo (ex.: abdome — jejum de 6 a 8 horas; pélvica — bexiga cheia). Em caso de dúvida, fale com a clínica. Traga o pedido médico.' },
  { slug: 'coleta-laboratorial', name: 'Coleta de exames laboratoriais', category: 'EXAME', icon: 'tube', duration: 10, choose: false,
    description: 'Coleta de sangue e outros materiais para exames de laboratório.',
    preparation: 'Confirme com seu médico a necessidade de jejum (geralmente 8 a 12 horas para exames de sangue). Beba água normalmente. Traga o pedido médico e documento com foto.' },
];

/** Feriados nacionais (fixos e móveis). A clínica pode incluir municipais/estaduais. */
const HOLIDAYS: { date: string; name: string; recurring: boolean }[] = [
  { date: '2000-01-01', name: 'Confraternização Universal', recurring: true },
  { date: '2000-04-21', name: 'Tiradentes', recurring: true },
  { date: '2000-05-01', name: 'Dia do Trabalho', recurring: true },
  { date: '2000-09-07', name: 'Independência do Brasil', recurring: true },
  { date: '2000-10-12', name: 'Nossa Senhora Aparecida', recurring: true },
  { date: '2000-11-02', name: 'Finados', recurring: true },
  { date: '2000-11-15', name: 'Proclamação da República', recurring: true },
  { date: '2000-11-20', name: 'Dia Nacional de Zumbi e da Consciência Negra', recurring: true },
  { date: '2000-12-25', name: 'Natal', recurring: true },
  { date: '2027-02-08', name: 'Carnaval', recurring: false },
  { date: '2027-02-09', name: 'Carnaval', recurring: false },
  { date: '2027-03-26', name: 'Sexta-feira Santa', recurring: false },
  { date: '2027-05-27', name: 'Corpus Christi', recurring: false },
  { date: '2028-02-28', name: 'Carnaval', recurring: false },
  { date: '2028-02-29', name: 'Carnaval', recurring: false },
  { date: '2028-04-14', name: 'Sexta-feira Santa', recurring: false },
  { date: '2028-06-15', name: 'Corpus Christi', recurring: false },
];

export const DEFAULT_PRIVACY_POLICY = `POLÍTICA DE PRIVACIDADE — AGENDAMENTO ONLINE

1. Quem somos
Esta política explica como a clínica trata os dados pessoais informados no agendamento online, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).

2. Quais dados coletamos
Somente o necessário para agendar e lembrar você da consulta: nome completo, telefone e, quando informado ou exigido, e-mail, CPF e data de nascimento, além de uma observação opcional. Não solicitamos informações médicas no agendamento.

3. Para que usamos
• Registrar e gerenciar o seu agendamento;
• Enviar confirmação, lembretes, avisos de alteração ou cancelamento (WhatsApp, e-mail ou SMS);
• Cumprir obrigações legais e garantir a segurança do sistema (ex.: prevenção de fraudes e abusos).

4. Base legal
Execução do serviço solicitado por você (art. 7º, V), cumprimento de obrigação legal (art. 7º, II), legítimo interesse para segurança (art. 7º, IX) e o seu consentimento, registrado no momento do agendamento.

5. Compartilhamento
Seus dados não são vendidos nem divulgados publicamente. Podem ser processados por fornecedores que enviam as mensagens (ex.: provedor de WhatsApp ou e-mail), apenas para essa finalidade.

6. Segurança
Usamos conexão criptografada (HTTPS), controle de acesso por função, registro de auditoria e cópias de segurança. Apenas pessoas autorizadas da clínica acessam seus dados.

7. Por quanto tempo guardamos
Pelo tempo necessário para as finalidades acima e para cumprimento de obrigações legais.

8. Seus direitos
Você pode solicitar acesso, correção, anonimização ou eliminação dos seus dados, além de revogar o consentimento, entrando em contato com a clínica pelos canais informados no site.`;

export async function syncRoles(db: pg.Pool | pg.PoolClient) {
  for (const [code, def] of Object.entries(ROLE_DEFS)) {
    await db.query(
      `INSERT INTO roles (code, name, description, permissions) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, permissions = EXCLUDED.permissions`,
      [code, def.name, def.description, def.permissions],
    );
  }
}

export async function seedTemplates(db: pg.Pool | pg.PoolClient, overwrite = false) {
  for (const [type, channels] of Object.entries(DEFAULT_TEMPLATES)) {
    for (const [channel, tpl] of Object.entries(channels ?? {})) {
      if (!tpl) continue;
      await db.query(
        `INSERT INTO message_templates (type, channel, subject, body) VALUES ($1, $2, $3, $4)
         ON CONFLICT (type, channel) DO ${overwrite ? 'UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body, updated_at = now()' : 'NOTHING'}`,
        [type, channel, tpl.subject ?? '', tpl.body],
      );
    }
  }
}

export type SeedOptions = { adminEmail?: string; adminPassword?: string; adminName?: string; log?: (m: string) => void };

export async function seedBase(pool: pg.Pool, opts: SeedOptions = {}) {
  const log = opts.log ?? console.log;
  await syncRoles(pool);

  await pool.query(
    `INSERT INTO clinic_settings (id, name, short_name, tagline, description, opening_hours, privacy_policy, booking_notice)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
    [
      'Centro Clínico JR Saúde',
      'JR Saúde',
      'Profissionais preparados para cuidar da sua saúde com atenção e qualidade.',
      'Um ambiente preparado para cuidar de você e da sua família. Consultas em diversas especialidades, atendimentos multiprofissionais e exames em um só lugar.',
      'Segunda a sexta: 07h às 18h\nSábado: 07h às 12h',
      DEFAULT_PRIVACY_POLICY,
      'Chegue com 15 minutos de antecedência e traga um documento com foto.',
    ],
  );

  for (const [i, s] of SEED_SERVICES.entries()) {
    await pool.query(
      `INSERT INTO services (slug, name, category, description, preparation, duration_minutes, allow_choose_professional, icon, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (slug) DO NOTHING`,
      [s.slug, s.name, s.category, s.description, s.preparation, s.duration, s.choose, s.icon, i],
    );
  }

  for (const h of HOLIDAYS) {
    await pool.query(
      'INSERT INTO holidays (date, name, recurring) VALUES ($1, $2, $3) ON CONFLICT (date, recurring) DO NOTHING',
      [h.date, h.name, h.recurring],
    );
  }

  await seedTemplates(pool);

  // Equipes de exame (recursos, não pessoas): permitem agendar exames
  // sem que o paciente precise escolher profissional.
  const teams: { name: string; specialty: string; services: string[]; color: string; weekly: [number, string, string][] }[] = [
    {
      name: 'Coleta Laboratorial', specialty: 'Coleta de exames laboratoriais', services: ['coleta-laboratorial'], color: '#7A4E9C',
      weekly: [[1, '07:00', '10:00'], [2, '07:00', '10:00'], [3, '07:00', '10:00'], [4, '07:00', '10:00'], [5, '07:00', '10:00'], [6, '07:00', '09:00']],
    },
    {
      name: 'Exames Cardiológicos', specialty: 'Eletrocardiograma, MAPA e Holter', services: ['eletrocardiograma', 'mapa', 'holter'], color: '#B23A48',
      weekly: [[1, '08:00', '12:00'], [2, '08:00', '12:00'], [3, '08:00', '12:00'], [4, '08:00', '12:00'], [5, '08:00', '12:00'],
               [1, '14:00', '17:00'], [3, '14:00', '17:00'], [5, '14:00', '17:00']],
    },
    {
      name: 'Ultrassonografia', specialty: 'Exames de imagem', services: ['ultrassonografia'], color: '#2E7D8C',
      weekly: [[2, '08:00', '12:00'], [4, '08:00', '12:00'], [6, '08:00', '11:00']],
    },
  ];
  for (const [i, t] of teams.entries()) {
    const exists = await pool.query('SELECT id FROM professionals WHERE name = $1', [t.name]);
    if (exists.rowCount) continue;
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO professionals (name, title, specialty, show_registry, color, sort_order, daily_agenda)
       VALUES ($1, '', $2, false, $3, $4, false) RETURNING id`,
      [t.name, t.specialty, t.color, 100 + i],
    );
    const pid = rows[0].id;
    for (const slug of t.services) {
      await pool.query(
        'INSERT INTO professional_services (professional_id, service_id) SELECT $1, id FROM services WHERE slug = $2 ON CONFLICT DO NOTHING',
        [pid, slug],
      );
    }
    for (const [wd, s, e] of t.weekly) {
      await pool.query('INSERT INTO schedules (professional_id, weekday, start_time, end_time) VALUES ($1, $2, $3, $4)', [pid, wd, s, e]);
    }
  }

  // Usuário administrador inicial
  const { rows: users } = await pool.query('SELECT 1 FROM users LIMIT 1');
  if (users.length === 0) {
    const email = (opts.adminEmail || 'admin@jrsaude.com.br').toLowerCase();
    const generated = !opts.adminPassword;
    const password = opts.adminPassword || randomBytes(12).toString('base64url');
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES ($1, $2, $3, 'SUPER_ADMIN', $4)`,
      [opts.adminName || 'Administrador', email, await hashPassword(password), generated],
    );
    log('------------------------------------------------------------');
    log(' Usuário administrador criado');
    log(`   E-mail: ${email}`);
    log(generated ? `   Senha temporária: ${password}  (troque no primeiro acesso)` : '   Senha: (definida por INITIAL_ADMIN_PASSWORD)');
    log('------------------------------------------------------------');
  }
}

/**
 * Profissionais FICTÍCIOS para demonstração/testes. Em produção, cadastre
 * os profissionais reais pelo painel e desative/edite estes.
 */
export const DEMO_PROFESSIONALS: { name: string; title: string; specialty: string; registry: string; services: string[]; color: string; weekly: [number, string, string][] }[] = [
  { name: 'Ana Silva', title: 'Dra.', specialty: 'Dermatologista', registry: 'CRM 00001', services: ['dermatologia'], color: '#C27C5B',
    weekly: [[1, '08:00', '12:00'], [1, '14:00', '18:00'], [3, '08:00', '12:00'], [3, '14:00', '18:00'], [5, '08:00', '12:00']] },
  { name: 'Carlos Mendes', title: 'Dr.', specialty: 'Cardiologista', registry: 'CRM 00002', services: ['cardiologia'], color: '#B23A48',
    weekly: [[2, '08:00', '12:00'], [2, '14:00', '18:00'], [4, '08:00', '12:00'], [4, '14:00', '18:00']] },
  { name: 'Beatriz Rocha', title: 'Dra.', specialty: 'Pediatra', registry: 'CRM 00003', services: ['pediatria'], color: '#3D8B6D',
    weekly: [[1, '08:00', '12:00'], [2, '08:00', '12:00'], [3, '08:00', '12:00'], [4, '08:00', '12:00'], [5, '08:00', '12:00'], [6, '08:00', '11:00']] },
  { name: 'Marcos Lima', title: 'Dr.', specialty: 'Ortopedista', registry: 'CRM 00004', services: ['ortopedia'], color: '#4A6FA5',
    weekly: [[1, '14:00', '18:00'], [3, '14:00', '18:00'], [5, '14:00', '18:00']] },
  { name: 'Juliana Costa', title: 'Dra.', specialty: 'Ginecologista', registry: 'CRM 00005', services: ['ginecologia'], color: '#A0527E',
    weekly: [[2, '08:00', '12:00'], [4, '08:00', '12:00'], [4, '14:00', '17:00']] },
  { name: 'Renata Alves', title: 'Dra.', specialty: 'Endocrinologista', registry: 'CRM 00006', services: ['endocrinologia'], color: '#8C6D1F',
    weekly: [[1, '08:00', '12:00'], [3, '08:00', '12:00']] },
  { name: 'Paulo Souza', title: 'Dr.', specialty: 'Nutrólogo', registry: 'CRM 00007', services: ['nutrologia'], color: '#5B8C3D',
    weekly: [[2, '14:00', '18:00'], [5, '14:00', '18:00']] },
  { name: 'Fernanda Dias', title: 'Dra.', specialty: 'Gastroenterologista', registry: 'CRM 00008', services: ['gastroenterologia'], color: '#6B5B95',
    weekly: [[3, '14:00', '18:00'], [5, '08:00', '12:00']] },
  { name: 'Lucas Martins', title: 'Ft.', specialty: 'Fisioterapeuta', registry: 'CREFITO 00009', services: ['fisioterapia'], color: '#2E7D8C',
    weekly: [[1, '07:00', '12:00'], [2, '07:00', '12:00'], [3, '07:00', '12:00'], [4, '07:00', '12:00'], [5, '07:00', '12:00'],
             [1, '14:00', '19:00'], [3, '14:00', '19:00']] },
  { name: 'Camila Ribeiro', title: 'Ft.', specialty: 'Fisioterapeuta', registry: 'CREFITO 00010', services: ['fisioterapia'], color: '#3A7CA5',
    weekly: [[2, '14:00', '19:00'], [4, '14:00', '19:00'], [6, '08:00', '12:00']] },
];

export async function seedDemo(pool: pg.Pool, log: (m: string) => void = console.log) {
  for (const [i, p] of DEMO_PROFESSIONALS.entries()) {
    const exists = await pool.query('SELECT id FROM professionals WHERE name = $1', [p.name]);
    if (exists.rowCount) continue;
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO professionals (name, title, specialty, registry, color, sort_order, bio)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [p.name, p.title, p.specialty, p.registry, p.color, i, 'Profissional de demonstração — substitua pelos dados reais no painel.'],
    );
    const pid = rows[0].id;
    for (const slug of p.services) {
      await pool.query(
        'INSERT INTO professional_services (professional_id, service_id) SELECT $1, id FROM services WHERE slug = $2 ON CONFLICT DO NOTHING',
        [pid, slug],
      );
    }
    for (const [wd, s, e] of p.weekly) {
      await pool.query('INSERT INTO schedules (professional_id, weekday, start_time, end_time) VALUES ($1, $2, $3, $4)', [pid, wd, s, e]);
    }
  }
  log('[seed] profissionais de demonstração criados');
}

export function isRole(r: string): r is Role {
  return r in ROLE_DEFS;
}
