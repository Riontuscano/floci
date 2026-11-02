---
title: Quick Start
section: Getting Started
order: 2
summary: Run Floci locally in under a minute with Docker, Compose, or the CLI.
---

# Quick Start

## Option 1: Docker

```bash
docker run --rm -p 4566:4566 floci/floci:latest
```

Lambda, RDS, ElastiCache, ECS and the other container-backed services need the Docker socket:

```bash
docker run -d --name floci \
  -p 4566:4566 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -u root \
  floci/floci:latest
```

## Option 2: Docker Compose (recommended for projects)

Add Floci to your project's `compose.yaml` next to your app:

```yaml
services:
  floci:
    image: floci/floci:latest
    ports:
      - "4566:4566"
    environment:
      FLOCI_HOSTNAME: floci

  app:
    build: .
    environment:
      AWS_ENDPOINT_URL: http://floci:4566
      AWS_REGION: us-east-1
      AWS_ACCESS_KEY_ID: test
      AWS_SECRET_ACCESS_KEY: test
    depends_on:
      - floci
```

```bash
docker compose up
```

`FLOCI_HOSTNAME` must match the Compose service name so URLs returned by Floci (such as SQS `QueueUrl`) are reachable from other containers.

## Option 3: Floci CLI

```bash
floci start
eval $(floci env)
```

`floci env` prints the `AWS_*` variables your shell needs.

## Verify it is running

```bash
curl http://localhost:4566/_floci/health
```

Then try a real AWS command:

```bash
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_DEFAULT_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test

aws s3 mb s3://my-bucket
aws s3 ls
```

You can also open `http://localhost:4566/` in a browser for the built-in status page.

## Pinning a version

Use a fixed tag in shared environments so every app sees the same behavior:

```yaml
image: floci/floci:1.2.3   # pick a release from GitHub releases
```

Use `floci/floci:latest-compat` when your init scripts need the AWS CLI or boto3 inside the container.
