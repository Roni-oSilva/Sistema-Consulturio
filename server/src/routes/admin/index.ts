import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/guards.js';
import { authRoutes } from './auth.js';
import { dashboardRoutes } from './dashboard.js';
import { appointmentAdminRoutes } from './appointments.js';
import { catalogRoutes } from './catalog.js';
import { blockRoutes } from './blocks.js';
import { settingsRoutes } from './settings.js';
import { userRoutes } from './users.js';

/**
 * Área administrativa. DENY BY DEFAULT: todas as rotas abaixo passam por
 * requireAuth (sessão + CSRF) e cada rota declara a permissão exigida.
 * A única rota sem sessão é o login.
 */
export async function adminRoutes(app: FastifyInstance) {
  // respostas da área administrativa nunca devem ser guardadas em cache
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  await app.register(authRoutes);

  await app.register(async (secured) => {
    secured.addHook('preHandler', requireAuth);
    await secured.register(dashboardRoutes);
    await secured.register(appointmentAdminRoutes);
    await secured.register(catalogRoutes);
    await secured.register(blockRoutes);
    await secured.register(settingsRoutes);
    await secured.register(userRoutes);
  });
}
