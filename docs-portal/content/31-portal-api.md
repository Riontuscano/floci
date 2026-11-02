---
title: Portal API reference
section: Reference
order: 31
summary: The Fastify REST API that serves this documentation.
---

# Portal API reference

This documentation site is a Fastify app. Its JSON API lets you embed these guides in your own developer portal, chatbots, or onboarding scripts.

All routes live under `/api` and return JSON unless noted.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Portal health and number of loaded guides |
| `GET` | `/api/docs` | Navigation: guides grouped by section |
| `GET` | `/api/docs/:slug` | One guide rendered to HTML, with table of contents and previous / next links |
| `GET` | `/api/docs/:slug?format=markdown` | The raw Markdown source of a guide |
| `GET` | `/api/search?q=...&limit=10` | Full-text search over all guides |
| `GET` | `/api/services` | AWS services documented in the Floci repository |
| `GET` | `/api/floci/status` | Live probe of the configured Floci instance (`/_floci/health`) |
| `GET` | `/api/floci/connection` | Endpoint, region and env vars an app should use for that instance |

## Examples

```bash
curl -s http://localhost:3000/api/docs | jq '.sections[].name'
curl -s http://localhost:3000/api/docs/nodejs | jq '.toc'
curl -s "http://localhost:3000/api/docs/nodejs?format=markdown"
curl -s "http://localhost:3000/api/search?q=path%20style"
curl -s http://localhost:3000/api/floci/status
```

`GET /api/floci/status` response:

```json
{
  "endpoint": "http://localhost:4566",
  "reachable": true,
  "version": "1.2.3",
  "edition": "community",
  "serviceCount": 85,
  "services": { "s3": "running", "sqs": "running" },
  "latencyMs": 4
}
```

When Floci cannot be reached the response is still `200` with `"reachable": false` and an `error` string, so dashboards can render a status without handling HTTP errors.

## Errors

Errors use a stable shape:

```json
{ "error": "NotFound", "message": "No guide named 'nope'" }
```

| Status | `error` | When |
|---|---|---|
| 400 | `ValidationError` | Bad parameters, for example an invalid slug or a missing `q` |
| 404 | `NotFound` | Unknown guide or API route |
| 500 | `InternalError` | Unexpected server failure |

## Portal configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `FLOCI_ENDPOINT` | `http://localhost:4566` | Floci instance probed by `/api/floci/status` |
| `FLOCI_TIMEOUT_MS` | `2000` | Probe timeout |
| `DOCS_CONTENT_DIR` | `./content` | Folder of Markdown guides |
| `DOCS_SERVICES_DIR` | `../docs/services` | Floci service docs used for `/api/services` |
| `CORS_ORIGIN` | unset | Comma-separated origins allowed to call the API from a browser |
| `LOG_LEVEL` | `info` | Fastify / pino log level |

## Adding a guide

Drop a Markdown file into `content/` with front matter:

```markdown
---
title: Rust
section: Language Guides
order: 14
summary: AWS SDK for Rust with Floci.
---

# Rust
...
```

Restart the portal and it appears in the navigation, search, and API.
