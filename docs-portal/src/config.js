import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const portalRoot = path.resolve(here, '..');

export function loadConfig(env = process.env) {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number.parseInt(env.PORT ?? '3000', 10),
    logLevel: env.LOG_LEVEL ?? 'info',
    flociEndpoint: (env.FLOCI_ENDPOINT ?? 'http://localhost:4566').replace(/\/+$/, ''),
    flociTimeoutMs: Number.parseInt(env.FLOCI_TIMEOUT_MS ?? '2000', 10),
    contentDir: env.DOCS_CONTENT_DIR ?? path.join(portalRoot, 'content'),
    servicesDir: env.DOCS_SERVICES_DIR ?? path.resolve(portalRoot, '..', 'docs', 'services'),
    publicDir: path.join(portalRoot, 'public'),
    corsOrigin: env.CORS_ORIGIN ?? false,
  };
}
