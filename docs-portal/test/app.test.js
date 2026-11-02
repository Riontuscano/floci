import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { parseFrontMatter, renderMarkdown, searchGuides } from '../src/content.js';

function fakeFetch(handler) {
  return async (url, init) => handler(url, init);
}

describe('docs portal API', () => {
  let app;

  before(async () => {
    app = await buildApp({
      logger: false,
      flociEndpoint: 'http://floci.test:4566',
      fetchImpl: fakeFetch((url) => {
        assert.equal(url, 'http://floci.test:4566/_floci/health');
        return new Response(JSON.stringify({ version: '9.9.9', edition: 'community', services: { s3: 'running', sqs: 'running', eks: 'available' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    });
  });

  after(() => app.close());

  test('GET /api/health', async () => {
    const res = await app.inject('/api/health');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, 'ok');
    assert.ok(res.json().guides > 5);
  });

  test('GET /api/docs groups guides by section in order', async () => {
    const res = await app.inject('/api/docs');
    assert.equal(res.statusCode, 200);
    const { sections } = res.json();
    assert.equal(sections[0].name, 'Getting Started');
    assert.equal(sections[0].guides[0].slug, 'introduction');
    const slugs = sections.flatMap((s) => s.guides.map((g) => g.slug));
    for (const slug of ['quick-start', 'configure-your-app', 'nodejs', 'python', 'java', 'go', 'shared-instance', 'portal-api']) {
      assert.ok(slugs.includes(slug), `missing guide ${slug}`);
    }
    assert.equal(sections[0].guides[0].markdown, undefined, 'navigation must not include bodies');
  });

  test('GET /api/docs/:slug returns rendered html, toc and neighbours', async () => {
    const res = await app.inject('/api/docs/quick-start');
    assert.equal(res.statusCode, 200);
    const guide = res.json();
    assert.equal(guide.title, 'Quick Start');
    assert.match(guide.html, /<h2 id="option-1-docker">/);
    assert.ok(guide.toc.some((t) => t.id === 'verify-it-is-running'));
    assert.equal(guide.previous.slug, 'introduction');
    assert.equal(guide.next.slug, 'configure-your-app');
  });

  test('GET /api/docs/:slug?format=markdown returns raw markdown', async () => {
    const res = await app.inject('/api/docs/nodejs?format=markdown');
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/markdown/);
    assert.match(res.body, /^# Node\.js/m);
  });

  test('unknown guide returns 404 with AWS-style error body', async () => {
    const res = await app.inject('/api/docs/does-not-exist');
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, 'NotFound');
  });

  test('invalid slug is rejected', async () => {
    const res = await app.inject('/api/docs/Bad_Slug');
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, 'ValidationError');
  });

  test('GET /api/search finds guides', async () => {
    const res = await app.inject('/api/search?q=forcePathStyle');
    assert.equal(res.statusCode, 200);
    const slugs = res.json().results.map((r) => r.slug);
    assert.ok(slugs.includes('nodejs'));
  });

  test('GET /api/search requires q', async () => {
    const res = await app.inject('/api/search');
    assert.equal(res.statusCode, 400);
  });

  test('GET /api/services lists Floci service docs', async () => {
    const res = await app.inject('/api/services');
    assert.equal(res.statusCode, 200);
    const { services, count } = res.json();
    assert.equal(count, services.length);
    assert.ok(services.some((s) => s.id === 's3'));
  });

  test('GET /api/floci/status reports a reachable instance', async () => {
    const res = await app.inject('/api/floci/status');
    const body = res.json();
    assert.equal(body.reachable, true);
    assert.equal(body.version, '9.9.9');
    assert.equal(body.serviceCount, 3);
  });

  test('GET /api/floci/connection returns env vars', async () => {
    const res = await app.inject('/api/floci/connection');
    assert.equal(res.json().env.AWS_ENDPOINT_URL, 'http://floci.test:4566');
  });

  test('unknown API route is a JSON 404, other paths serve the SPA', async () => {
    const apiRes = await app.inject('/api/nope');
    assert.equal(apiRes.statusCode, 404);
    assert.equal(apiRes.json().error, 'NotFound');

    const page = await app.inject('/');
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /<title>Floci Integration Docs<\/title>/);

    const deep = await app.inject('/some/client/route');
    assert.match(deep.body, /id="sidebar"/);
  });
});

describe('floci status when unreachable', () => {
  test('returns reachable=false instead of failing', async () => {
    const app = await buildApp({
      logger: false,
      fetchImpl: fakeFetch(() => { throw new TypeError('fetch failed'); }),
    });
    const res = await app.inject('/api/floci/status');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().reachable, false);
    assert.equal(res.json().error, 'fetch failed');
    await app.close();
  });

  test('reports non-2xx upstream responses', async () => {
    const app = await buildApp({
      logger: false,
      fetchImpl: fakeFetch(() => new Response('nope', { status: 503 })),
    });
    const res = await app.inject('/api/floci/status');
    assert.equal(res.json().reachable, false);
    assert.equal(res.json().error, 'HTTP 503');
    await app.close();
  });
});

describe('content helpers', () => {
  test('parseFrontMatter reads metadata', () => {
    const { meta, body } = parseFrontMatter('---\ntitle: Hello\norder: 4\n---\n# Body');
    assert.deepEqual(meta, { title: 'Hello', order: 4 });
    assert.equal(body, '# Body');
  });

  test('renderMarkdown builds unique heading ids and toc', () => {
    const { html, toc } = renderMarkdown('# T\n\n## Setup\n\n### Setup\n\n[x](https://example.com)');
    assert.deepEqual(toc.map((t) => t.id), ['setup', 'setup-1']);
    assert.match(html, /target="_blank"/);
  });

  test('searchGuides ranks title matches first', () => {
    const guides = [
      { slug: 'a', title: 'Other', section: 's', summary: '', plainText: 'python python python' },
      { slug: 'b', title: 'Python', section: 's', summary: '', plainText: 'python' },
    ];
    assert.equal(searchGuides(guides, 'python')[0].slug, 'b');
  });
});
