import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerSecurity } from './plugins/security.js';
import { registerAdminRoutes, registerUserRoutes } from './routes/admin.js';
import { registerGatewayRoutes } from './routes/gateway.js';
import { logger } from './lib/logger.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 4 * 1024 * 1024,
    trustProxy: true,
  });

  registerErrorHandler(app);
  await registerSecurity(app);

  const swagger = (await import('@fastify/swagger')).default;
  const swaggerUi = (await import('@fastify/swagger-ui')).default;
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Mimo Gateway API',
        description:
          'AI API Gateway for shared Mimo quota. `/v1/*` is OpenAI-compatible; `/api/*` is the management API.',
        version: '0.1.0',
      },
      servers: [{ url: `http://localhost:${config.env.PORT}` }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
      tags: [
        { name: 'gateway', description: 'OpenAI-compatible endpoints' },
        { name: 'auth', description: 'Authentication' },
        { name: 'admin', description: 'Admin management API' },
        { name: 'mimo', description: 'Mimo account management' },
        { name: 'usage', description: 'Usage analytics' },
        { name: 'user', description: 'Self-service user API' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/healthz', { schema: { hide: true } }, async () => ({ status: 'ok', ts: Date.now() }));
  app.get('/openapi.json', { schema: { hide: true } }, async (_req, reply) =>
    reply.send(app.swagger()),
  );

  registerGatewayRoutes(app);
  registerAdminRoutes(app);
  registerUserRoutes(app);

  app.addHook('onClose', async () => {
    logger.info('app closed');
  });

  return app;
}
