import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

export async function registerSecurity(app: FastifyInstance) {
  const helmet = (await import('@fastify/helmet')).default;
  const cors = (await import('@fastify/cors')).default;

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
    credentials: true,
    allowedHeaders: ['authorization', 'content-type'],
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    return payload;
  });
}
