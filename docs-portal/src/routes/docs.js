import { searchGuides } from '../content.js';

const guideSummary = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    title: { type: 'string' },
    section: { type: 'string' },
    order: { type: 'integer' },
    summary: { type: 'string' },
  },
};

export default async function docsRoutes(app, { guides, services }) {

  app.get('/docs', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            sections: {
              type: 'array',
              items: {
                type: 'object',
                properties: { name: { type: 'string' }, guides: { type: 'array', items: guideSummary } },
              },
            },
          },
        },
      },
    },
  }, async () => {
    const sections = [];
    for (const guide of guides) {
      let section = sections.find((s) => s.name === guide.section);
      if (!section) {
        section = { name: guide.section, guides: [] };
        sections.push(section);
      }
      section.guides.push(guide);
    }
    return { sections };
  });

  app.get('/docs/:slug', {
    schema: {
      params: { type: 'object', properties: { slug: { type: 'string', pattern: '^[a-z0-9-]+$' } }, required: ['slug'] },
      querystring: { type: 'object', properties: { format: { type: 'string', enum: ['html', 'markdown'] } } },
    },
  }, async (request, reply) => {
    const index = guides.findIndex((g) => g.slug === request.params.slug);
    if (index === -1) {
      return reply.code(404).send({ error: 'NotFound', message: `No guide named '${request.params.slug}'` });
    }
    const guide = guides[index];
    if (request.query.format === 'markdown') {
      return reply.type('text/markdown; charset=utf-8').send(guide.markdown);
    }
    const neighbour = (g) => (g ? { slug: g.slug, title: g.title } : null);
    return {
      slug: guide.slug,
      title: guide.title,
      section: guide.section,
      summary: guide.summary,
      html: guide.html,
      toc: guide.toc,
      previous: neighbour(guides[index - 1]),
      next: neighbour(guides[index + 1]),
    };
  });

  app.get('/search', {
    schema: {
      querystring: {
        type: 'object',
        properties: { q: { type: 'string', maxLength: 200 }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
        required: ['q'],
      },
    },
  }, async (request) => ({ query: request.query.q, results: searchGuides(guides, request.query.q, request.query.limit) }));

  app.get('/services', async () => ({ count: services.length, services }));

}
