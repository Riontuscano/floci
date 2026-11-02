export default async function flociRoutes(app, { endpoint, timeoutMs, fetchImpl = fetch }) {
  app.get('/floci/status', async (request) => {
    const started = Date.now();
    try {
      const response = await fetchImpl(`${endpoint}/_floci/health`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        return { endpoint, reachable: false, error: `HTTP ${response.status}`, latencyMs: Date.now() - started };
      }
      const health = await response.json();
      const services = health.services ?? {};
      return {
        endpoint,
        reachable: true,
        version: health.version ?? null,
        edition: health.edition ?? null,
        serviceCount: Object.keys(services).length,
        services,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      request.log.debug({ err, endpoint }, 'floci health probe failed');
      return { endpoint, reachable: false, error: err.name === 'TimeoutError' ? 'timeout' : err.message, latencyMs: Date.now() - started };
    }
  });

  app.get('/floci/connection', async () => ({
    endpoint,
    region: 'us-east-1',
    accessKeyId: 'test',
    secretAccessKey: 'test',
    env: {
      AWS_ENDPOINT_URL: endpoint,
      AWS_DEFAULT_REGION: 'us-east-1',
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
    },
  }));
}
