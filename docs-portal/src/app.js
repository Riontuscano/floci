import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import { loadConfig } from './config.js';
import { loadGuides, loadServiceCatalog } from './content.js';
import docsRoutes from './routes/docs.js';
import flociRoutes from './routes/floci.js';

export async function buildApp(overrides = {}) {
  const config = { ...loadConfig(), ...overrides };
  const app = Fastify({ logger: overrides.logger ?? { level: config.logLevel } });

  const guides = await loadGuides(config.contentDir);
  const services = await loadServiceCatalog(config.servicesDir, app.log);
  app.log.info({ guides: guides.length, services: services.length }, 'documentation loaded');

  if (config.corsOrigin) {
    await app.register(fastifyCors, { origin: config.corsOrigin.split(',').map((o) => o.trim()) });
  }

  app.setErrorHandler((err, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err }, 'request failed');
    }
    reply.code(status).send({
      error: err.validation ? 'ValidationError' : (err.code ?? 'InternalError'),
      message: status >= 500 ? 'Internal server error' : err.message,
    });
  });

  await app.register(async (api) => {
    api.get('/health', async () => ({ status: 'ok', guides: guides.length, uptimeSeconds: Math.round(process.uptime()) }));
    await api.register(docsRoutes, { guides, services });
    await api.register(flociRoutes, {
      endpoint: config.flociEndpoint,
      timeoutMs: config.flociTimeoutMs,
      fetchImpl: overrides.fetchImpl ?? fetch,
    });
  }, { prefix: '/api' });

  await app.register(fastifyStatic, { root: config.publicDir, prefix: '/' });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'NotFound', message: `Route ${request.method} ${request.url} not found` });
    }
    return reply.sendFile('index.html');
  });

  return app;
}
