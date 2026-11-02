---
title: Configure your app
section: Getting Started
order: 3
summary: Environment variables and patterns to switch between Floci and real AWS without code changes.
---

# Configure your app

The cleanest integration is **configuration only**: your code builds AWS clients normally and the environment decides whether they hit Floci or AWS.

## Standard environment variables

All current AWS SDKs (JavaScript v3, boto3, Java v2, Go v2, .NET, Rust) and the AWS CLI read `AWS_ENDPOINT_URL`.

```bash
# .env.local
AWS_ENDPOINT_URL=http://localhost:4566
AWS_REGION=us-east-1
AWS_DEFAULT_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

In production simply **do not set** `AWS_ENDPOINT_URL`, and the SDK falls back to the real AWS endpoints.

| Variable | Purpose | Floci value |
|---|---|---|
| `AWS_ENDPOINT_URL` | Global endpoint override for every service | `http://localhost:4566` |
| `AWS_ENDPOINT_URL_<SERVICE>` | Per-service override, for example `AWS_ENDPOINT_URL_S3` | `http://localhost:4566` |
| `AWS_REGION` / `AWS_DEFAULT_REGION` | Region | any, usually `us-east-1` |
| `AWS_ACCESS_KEY_ID` | Access key; a 12-digit value selects the account | `test` or `111111111111` |
| `AWS_SECRET_ACCESS_KEY` | Secret key | any non-empty value |

## Which host name to use

| Where your app runs | Endpoint |
|---|---|
| On your machine, Floci in Docker with `-p 4566:4566` | `http://localhost:4566` |
| In the same Compose project as Floci | `http://floci:4566` (the service name) |
| In another Compose project on the same machine | `http://floci:4566` over a shared network, see [Sharing one Floci](#/docs/shared-instance) |
| In a container, Floci on the host | `http://host.docker.internal:4566` |
| In CI with Floci as a service container | `http://localhost:4566` or the service alias |

## S3 path-style addressing

S3 clients default to virtual-hosted URLs (`bucket.host`). Against a local endpoint, enable **path-style** addressing:

| SDK | Option |
|---|---|
| JavaScript v3 | `forcePathStyle: true` |
| boto3 | `Config(s3={"addressing_style": "path"})` |
| Java v2 | `.forcePathStyle(true)` |
| Go v2 | `o.UsePathStyle = true` |

## Account ID and ARNs

Floci uses account `000000000000` unless the access key is exactly 12 digits. Build ARNs from configuration or from `sts:GetCallerIdentity` instead of hard-coding them.

```bash
aws sts get-caller-identity
```

## Useful Floci server settings

These go on the **Floci container**, not your app:

| Variable | What it does |
|---|---|
| `FLOCI_HOSTNAME` | Host name embedded in returned URLs, set it to the Compose service name |
| `FLOCI_BASE_URL` | Full base URL used for generated links, for example `http://floci:4566` |
| `FLOCI_STORAGE_MODE` | `memory`, `persistent`, `hybrid` or `wal` |
| `FLOCI_STORAGE_PERSISTENT_PATH` | Data directory when storage is persistent |
| `FLOCI_DEFAULT_ACCOUNT_ID` | Account used for non 12-digit access keys |
| `FLOCI_SERVICES_DOCKER_NETWORK` | Docker network for Lambda, RDS and other spawned containers |

See the full list in the [Floci environment variable reference](https://floci.io/floci/configuration/environment-variables/).
