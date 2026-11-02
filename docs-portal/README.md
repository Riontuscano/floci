# Floci Integration Docs Portal

A small [Fastify](https://fastify.dev/) app that serves a documentation site explaining how to add Floci to your own applications: running it next to your app, configuring AWS SDKs in Node.js, Python, Java and Go, sharing one instance across projects, seeding resources, readiness checks, and CI.

- **Backend**: Fastify 5, serving the guides as a JSON API and probing a live Floci instance.
- **Frontend**: a dependency-free single page app (`public/`) with navigation, search, table of contents, copy buttons, dark mode, and a live Floci status badge.
- **Content**: Markdown guides in `content/` with front matter.

## Run it

```bash
cd docs-portal
npm install
npm start
```

Open http://localhost:3000. Start Floci (`docker run --rm -p 4566:4566 floci/floci:latest`) to see the status badge turn green and the services page show live status.

For live reload during development:

```bash
npm run dev
```

### With Docker

```bash
docker build -t floci-docs-portal docs-portal
docker run --rm -p 3000:3000 -e FLOCI_ENDPOINT=http://host.docker.internal:4566 floci-docs-portal
```

The `/api/services` catalog is built from `../docs/services`, which is outside the image. Mount it to enable that page:

```bash
docker run --rm -p 3000:3000 -v "$PWD/docs/services:/docs/services:ro" -e DOCS_SERVICES_DIR=/docs/services floci-docs-portal
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `FLOCI_ENDPOINT` | `http://localhost:4566` | Floci instance probed by `/api/floci/status` |
| `FLOCI_TIMEOUT_MS` | `2000` | Probe timeout in milliseconds |
| `DOCS_CONTENT_DIR` | `./content` | Folder of Markdown guides |
| `DOCS_SERVICES_DIR` | `../docs/services` | Floci service docs used for `/api/services` |
| `CORS_ORIGIN` | unset | Comma-separated origins allowed to call the API |
| `LOG_LEVEL` | `info` | Log level |

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Portal health |
| `GET` | `/api/docs` | Guides grouped by section |
| `GET` | `/api/docs/:slug` | Rendered guide with TOC and previous / next links (`?format=markdown` for the source) |
| `GET` | `/api/search?q=` | Full-text search |
| `GET` | `/api/services` | AWS services documented in this repository |
| `GET` | `/api/floci/status` | Live probe of `FLOCI_ENDPOINT/_floci/health` |
| `GET` | `/api/floci/connection` | Endpoint and env vars an app should use |

The same reference is available in the portal under **Reference > Portal API reference**.

## Adding a guide

Create `content/NN-name.md`:

```markdown
---
title: Rust
section: Language Guides
order: 14
summary: AWS SDK for Rust with Floci.
---

# Rust
```

The numeric file prefix is dropped from the slug (`14-rust.md` becomes `/docs/rust`). Sections appear in the order of their first guide.

## Tests

```bash
npm test
```

Tests use `fastify.inject` and a stubbed `fetch`, so no network or running Floci is needed.

## Layout

```text
docs-portal/
  src/
    server.js        entry point
    app.js           Fastify app factory (used by tests)
    config.js        environment configuration
    content.js       Markdown loading, rendering, search
    routes/docs.js   /api/docs, /api/search, /api/services
    routes/floci.js  /api/floci/status, /api/floci/connection
  content/           Markdown guides
  public/            frontend (index.html, app.js, styles.css)
  test/              node:test suites
```
