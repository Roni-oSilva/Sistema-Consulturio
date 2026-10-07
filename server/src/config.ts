import { z } from 'zod';

/**
 * Configuração via variáveis de ambiente. Segredos (senhas, chaves de API,
 * tokens) vivem SOMENTE aqui — nunca no frontend nem no banco.
 */
const bool = z
  .string()
  .optional()
  .transform((v) => v === '1' || v?.toLowerCase() === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  // Segredo usado para assinar tokens temporários e gerar hashes de IP.
  APP_SECRET: z.string().min(32, 'APP_SECRET deve ter pelo menos 32 caracteres'),
  TRUST_PROXY: bool,
  COOKIE_SECURE: z.string().optional(),
  CORS_ORIGINS: z.string().default(''),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).default(12),
  UPLOAD_DIR: z.string().default('./uploads'),
  WEB_DIST_DIR: z.string().default(''),
  DISABLE_JOBS: bool,
  DISABLE_RATE_LIMIT: bool,
  LOG_LEVEL: z.string().default('info'),

  // CAPTCHA (Cloudflare Turnstile) — opcional
  TURNSTILE_SITE_KEY: z.string().default(''),
  TURNSTILE_SECRET_KEY: z.string().default(''),

  // WhatsApp
  WHATSAPP_PROVIDER: z.enum(['manual', 'evolution', 'zapi', 'twilio', 'meta', 'webhook', 'log']).default('manual'),
  EVOLUTION_API_URL: z.string().default(''),
  EVOLUTION_API_KEY: z.string().default(''),
  EVOLUTION_INSTANCE: z.string().default(''),
  ZAPI_INSTANCE_ID: z.string().default(''),
  ZAPI_TOKEN: z.string().default(''),
  ZAPI_CLIENT_TOKEN: z.string().default(''),
  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  TWILIO_WHATSAPP_FROM: z.string().default(''),
  TWILIO_SMS_FROM: z.string().default(''),
  META_WA_TOKEN: z.string().default(''),
  META_WA_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_WEBHOOK_URL: z.string().default(''),
  WHATSAPP_WEBHOOK_TOKEN: z.string().default(''),

  // E-mail (SMTP)
  EMAIL_PROVIDER: z.enum(['none', 'smtp', 'log']).default('none'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  EMAIL_FROM: z.string().default(''),

  // SMS
  SMS_PROVIDER: z.enum(['none', 'twilio', 'webhook', 'log']).default('none'),
  SMS_WEBHOOK_URL: z.string().default(''),
  SMS_WEBHOOK_TOKEN: z.string().default(''),
});

export type Config = z.infer<typeof schema> & {
  isProd: boolean;
  cookieSecure: boolean;
  corsOrigins: string[];
};

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  const c = parsed.data;
  const isProd = c.NODE_ENV === 'production';
  const cookieSecure =
    c.COOKIE_SECURE !== undefined ? c.COOKIE_SECURE === '1' || c.COOKIE_SECURE === 'true' : isProd;
  if (isProd && /trocar|change-me|dev-secret/i.test(c.APP_SECRET)) {
    throw new Error('APP_SECRET de desenvolvimento não pode ser usado em produção.');
  }
  return {
    ...c,
    isProd,
    cookieSecure,
    corsOrigins: c.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export function config(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}

export function setConfigForTests(c: Config) {
  cached = c;
}
