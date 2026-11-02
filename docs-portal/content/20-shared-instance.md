---
title: Sharing one Floci across apps
section: Running as a Service
order: 20
summary: Run a single Floci instance that several separate projects connect to.
---

# Sharing one Floci across apps

You can embed Floci in each project's Compose file, or run **one long-lived instance** that all your projects share. The shared setup saves memory and lets apps talk to each other through the same queues, topics, and buckets.

## 1. Create a shared Docker network

```bash
docker network create floci-shared
```

## 2. Run Floci on that network

Keep this in its own folder, for example `~/infra/floci/compose.yaml`:

```yaml
services:
  floci:
    image: floci/floci:latest
    container_name: floci
    restart: unless-stopped
    ports:
      - "4566:4566"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - floci-data:/app/data
    environment:
      FLOCI_HOSTNAME: floci
      FLOCI_BASE_URL: http://floci:4566
      FLOCI_STORAGE_MODE: hybrid
      FLOCI_STORAGE_PERSISTENT_PATH: /app/data
      FLOCI_SERVICES_DOCKER_NETWORK: floci-shared
    networks:
      - floci-shared

volumes:
  floci-data:

networks:
  floci-shared:
    external: true
```

```bash
docker compose up -d
```

`hybrid` storage keeps data across restarts while staying fast. Use `memory` if every restart should start clean.

## 3. Join the network from each app

In every other project:

```yaml
services:
  api:
    build: .
    environment:
      AWS_ENDPOINT_URL: http://floci:4566
      AWS_REGION: us-east-1
      AWS_ACCESS_KEY_ID: test
      AWS_SECRET_ACCESS_KEY: test
    networks:
      - default
      - floci-shared

networks:
  floci-shared:
    external: true
```

Apps running directly on your machine (not in Docker) use `http://localhost:4566`.

## Isolating apps from each other

On a shared instance every app sees the same resources by default. To keep them apart you have two options.

### Option A: one account per app

If `AWS_ACCESS_KEY_ID` is exactly **12 digits**, Floci uses it as the account ID and namespaces every resource under it:

```yaml
# billing-service
AWS_ACCESS_KEY_ID: "111111111111"

# notifications-service
AWS_ACCESS_KEY_ID: "222222222222"
```

Both apps can create a queue called `orders` without colliding. Use the same account ID in apps that **should** share resources.

Account isolation is a convenience for local development, not a security boundary.

### Option B: name prefixes

Keep one account and prefix resource names per app or per developer, for example `billing-orders` and `notify-orders`, driven by an env var such as `RESOURCE_PREFIX`.

## Exposing it to a team

Floci has no authentication by default. Only expose it on trusted networks, for example a dev VPN or a private CI runner, and never on the public internet.
