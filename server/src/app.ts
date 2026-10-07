import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { AppError } from './lib/errors.js';
import { publicRoutes } from './routes/public.js';
import { adminRoutes } from './routes/admin/index.js';

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const c = config();
  const app = Fastify({
    trustProxy: c.TRUST_PROXY,
    bodyLimit: 256 * 1024,
    logger:
      opts.logger === false
        ? false
        : {
            level: c.LOG_LEVEL,
            redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-access-token"]', 'req.headers["x-csrf-token"]'],
            serializers: {
              // nunca registrar query string (pode conter tokens de acesso)
              req: (req) => ({ method: req.method, url: String(req.url).split('?')[0], ip: req.ip }),
            },
          },
  });

  await app.register(cookie);

  // Cabeçalhos de segurança + Content Security Policy
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ['https://challenges.cloudflare.com'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        ...(c.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: c.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  });

  // CORS: por padrão, somente a mesma origem. Origens extras via CORS_ORIGINS.
  await app.register(cors, {
    origin: c.corsOrigins.length ? c.corsOrigins : false,
    credentials: true,
  });

  // Rate limit global da API (rotas sensíveis têm limites próprios mais rígidos)
  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
      error: `Muitas tentativas. Aguarde ${Math.ceil(ctx.ttl / 1000 / 60)} minuto(s) e tente novamente.`,
    }),
  });

  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 5 } });

  // Bloqueia requisições que alteram estado vindas de outra origem (defesa extra contra CSRF).
  app.addHook('onRequest', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.url.startsWith('/api/')) return;
    const origin = req.headers.origin;
    if (!origin) return;
    const allowed = new Set([new URL(c.PUBLIC_URL).origin, ...c.corsOrigins]);
    const host = req.headers.host;
    if (host) {
      allowed.add(`https://${host}`);
      allowed.add(`http://${host}`);
    }
    if (!allowed.has(origin)) {
      reply.code(403).send({ code: 'FORBIDDEN_ORIGIN', error: 'Origem não permitida.' });
    }
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ code: err.code, error: err.message, details: err.details });
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status === 429) return reply.code(429).send(err);
    if (status < 500) {
      const msg =
        (err as FastifyError).code === 'FST_REQ_FILE_TOO_LARGE'
          ? 'Arquivo muito grande (máximo 2 MB).'
          : (err as FastifyError).code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
            ? 'Formato de requisição inválido.'
            : 'Requisição inválida.';
      return reply.code(status).send({ code: 'BAD_REQUEST', error: msg });
    }
    req.log.error({ err }, 'erro interno');
    // nunca expor detalhes internos ao cliente
    return reply.code(500).send({ code: 'INTERNAL', error: 'Ocorreu um erro inesperado. Tente novamente em instantes.' });
  });

  await app.register(publicRoutes, { prefix: '/api' });
  await app.register(adminRoutes, { prefix: '/api/admin' });

  app.get('/api/health', async () => ({ ok: true }));

  // Arquivos enviados (fotos, logo) — somente imagens validadas no upload
  const uploadDir = resolve(c.UPLOAD_DIR);
  mkdirSync(uploadDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: uploadDir,
    prefix: '/uploads/',
    decorateReply: false,
    index: false,
    setHeaders: (res) => {
      res.header('X-Content-Type-Options', 'nosniff');
      res.header('Cache-Control', 'public, max-age=86400');
    },
  });

  // Frontend compilado (SPA) — em produção o mesmo servidor entrega o site.
  const webDist = c.WEB_DIST_DIR ? resolve(c.WEB_DIST_DIR) : resolve(process.cwd(), '../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/uploads/')) {
        return reply.code(404).send({ code: 'NOT_FOUND', error: 'Não encontrado.' });
      }
      return reply.type('text/html').sendFile('index.html', webDist);
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ code: 'NOT_FOUND', error: 'Não encontrado.' }));
  }

  return app;
}
