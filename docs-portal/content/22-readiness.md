---
title: Health checks and readiness
section: Running as a Service
order: 22
summary: Wait for Floci before your app starts, in Compose, scripts, and CI.
---

# Health checks and readiness

Floci starts in milliseconds, but init hooks may still be running. Wait for readiness before your app or tests use it.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /_floci/health` | Version, edition, and the status of every service |
| `GET /_floci/init` | Completion status of the `boot`, `start`, `ready` hook phases |
| `GET /_floci/info` | Build and runtime information |
| `GET /_localstack/health`, `GET /_localstack/init` | LocalStack compatible aliases |

```bash
curl -s http://localhost:4566/_floci/health
curl -s http://localhost:4566/_floci/init
```

## Shell wait loop

```bash
#!/bin/sh
# scripts/wait-for-floci.sh
ENDPOINT="${AWS_ENDPOINT_URL:-http://localhost:4566}"
for i in $(seq 1 60); do
  if curl -fsS "$ENDPOINT/_floci/init" | grep -q '"ready" *: *true'; then
    echo "Floci is ready"
    exit 0
  fi
  sleep 1
done
echo "Floci did not become ready in time" >&2
exit 1
```

## Node.js wait helper

```javascript
export async function waitForFloci(endpoint = process.env.AWS_ENDPOINT_URL, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${endpoint}/_floci/init`);
      const body = await res.json();
      if (body.completed?.ready) return;
    } catch {
      // not up yet, retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Floci at ${endpoint} was not ready after ${timeoutMs} ms`);
}
```

## Compose: start the app after Floci

The Floci image is minimal, so run the probe from your app or a tiny helper container instead of a `healthcheck` that needs `curl` inside Floci:

```yaml
services:
  floci:
    image: floci/floci:latest
    environment:
      FLOCI_HOSTNAME: floci

  wait-for-floci:
    image: curlimages/curl:8.10.1
    depends_on: [floci]
    entrypoint: ["sh", "-c", "until curl -fsS http://floci:4566/_floci/health; do sleep 1; done"]

  app:
    build: .
    depends_on:
      wait-for-floci:
        condition: service_completed_successfully
```
