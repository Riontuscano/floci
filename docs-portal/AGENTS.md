# Agent handoff: docs-portal

Context for the next agent working in `docs-portal/`. The repo-wide rules in `../AGENTS.md` still apply (no em-dashes, conventional commits, braces in conditionals, no empty catch blocks).

## What this is

A standalone Node.js app (not part of the Java/Quarkus build) that serves a documentation site explaining how to add Floci to *other* applications as a shared local AWS service.

- Backend: Fastify 5, ESM, Node >= 20. Deps: `fastify`, `@fastify/static`, `@fastify/cors`, `marked`.
- Frontend: plain HTML/CSS/JS in `public/`, no build step, no CDN.
- Content: Markdown guides in `content/` with front matter.

Branch: `claude/eager-wozniak-tymj27`. No PR opened yet.

## Commands

```bash
cd docs-portal
npm install
npm start        # http://localhost:3000
npm run dev      # node --watch
npm test         # node --test test/*.test.js (17 tests, all passing)
```

## Files

| Path | Role |
|---|---|
| `src/server.js` | Entry point: listen, SIGINT/SIGTERM shutdown |
| `src/app.js` | `buildApp(overrides)` factory. Loads content at startup, registers `/api` routes, serves `public/`, SPA fallback, JSON error handler |
| `src/config.js` | Env config: `PORT`, `HOST`, `FLOCI_ENDPOINT`, `FLOCI_TIMEOUT_MS`, `DOCS_CONTENT_DIR`, `DOCS_SERVICES_DIR`, `CORS_ORIGIN`, `LOG_LEVEL` |
| `src/content.js` | Front matter parser, `marked` rendering with heading ids + TOC, guide loading, service catalog, search |
| `src/routes/docs.js` | `/api/docs`, `/api/docs/:slug`, `/api/search`, `/api/services` |
| `src/routes/floci.js` | `/api/floci/status` (probes `FLOCI_ENDPOINT/_floci/health`), `/api/floci/connection` |
| `public/app.js` | SPA: hash router, sidebar, search, TOC, copy buttons, theme, status badge, services page |
| `content/*.md` | 13 guides |
| `test/app.test.js` | API tests via `fastify.inject` with stubbed `fetch` |
| `Dockerfile` | `node:22-alpine`, `npm install --omit=dev` |

## API

| Route | Notes |
|---|---|
| `GET /api/health` | `{ status, guides, uptimeSeconds }` |
| `GET /api/docs` | `{ sections: [{ name, guides: [{ slug, title, section, order, summary }] }] }`. Response schema strips bodies |
| `GET /api/docs/:slug` | `{ slug, title, section, summary, html, toc, previous, next }`. `?format=markdown` returns raw Markdown. Slug must match `^[a-z0-9-]+$` |
| `GET /api/search?q=&limit=` | Substring AND search over title, summary, and text (code included). Title hits rank higher |
| `GET /api/services` | Built from `../docs/services/*.md` first `#` heading. Empty list (with a warning log) if the dir is missing |
| `GET /api/floci/status` | Always HTTP 200. `reachable: false` plus `error` when Floci is down, times out, or returns non-2xx |
| `GET /api/floci/connection` | Endpoint and `AWS_*` env vars for apps |

Errors: `{ error, message }` with `ValidationError` (400), `NotFound` (404), `InternalError` (500). Unknown `/api/*` returns JSON 404; any other path serves `index.html`.

## Content conventions

- Filename `NN-name.md`; the numeric prefix is dropped from the slug (`10-nodejs.md` is `nodejs`). `slug:` in front matter overrides.
- Front matter keys: `title`, `section`, `order`, `summary`. Sorted by `order`; sections appear in order of their first guide.
- Internal links use hash routes: `[Quick Start](#/docs/quick-start)`. In-page anchors (`#some-id`) are intercepted by `public/app.js`, so URLs look like `#/docs/nodejs#fastify-plugin-example`.
- Content is loaded once at startup: restart after editing.
- Floci facts in guides were checked against the Java source: `/_floci/health` returns `{ services: { name: "running"|"available" }, edition, version }` (`lifecycle/EmulatorInfoController.java`), `/_floci/init` returns `{ completed: { boot, start, ready, shutdown } }`.

## Decisions and gotchas

- `package-lock.json` is NOT committed: the root `.gitignore` ignores lockfiles. That is why the Dockerfile uses `npm install` instead of `npm ci`.
- `/api/services` reads `../docs/services`, outside the Docker image. Mount it and set `DOCS_SERVICES_DIR` when containerized.
- The status probe only targets the configured `FLOCI_ENDPOINT`, never a user-supplied URL (avoids SSRF).
- `marked` output is trusted because content is repo-authored. Sanitize it if content ever comes from users.
- Code highlighting is comments-only (`public/app.js` `highlightComments`), done on purpose to avoid a highlighting library.
- Logos in `public/` are copies of `../docs/assets/floci.svg` (light) and `floci-white.svg` (dark). `floci-black.svg` did not render its wordmark in Chromium, so it is not used.
- Do not run `pkill -f "node src/server.js"` from a shell whose command line contains that string: it kills itself. Use `pkill -f "src/serve[r].js"`.

## Verification done

- `npm test`: 17/17 passing.
- Playwright (Chromium) at 1400px light and dark, and 390px mobile: no console errors, no horizontal overflow, search, TOC anchors, and services page work.
- Not verified: the status badge and services page against a running Floci (none was available, so only the offline state was seen).

## Possible next steps

- Open a PR if the user asks.
- Run the portal against a live Floci to check the online badge and per-service status.
- Add guides (Rust, .NET, Terraform/CDK detail) by dropping files into `content/`.
- Optionally link the portal from the root `README.md` or add a `make` target.
