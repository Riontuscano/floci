import fs from 'node:fs/promises';
import path from 'node:path';
import { Marked } from 'marked';

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontMatter(raw) {
  const match = raw.match(FRONT_MATTER);
  if (!match) {
    return { meta: {}, body: raw };
  }
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    meta[key] = /^\d+$/.test(value) ? Number(value) : value;
  }
  return { meta, body: raw.slice(match[0].length) };
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function stripMarkdown(text) {
  return text
    .replace(/^```.*$/gm, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-+*]\s+/gm, ' ')
    .replace(/[#>*_|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function renderMarkdown(body) {
  const toc = [];
  const seen = new Map();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        let id = slugify(html) || 'section';
        const count = seen.get(id) ?? 0;
        seen.set(id, count + 1);
        if (count > 0) {
          id = `${id}-${count}`;
        }
        if (depth === 2 || depth === 3) {
          toc.push({ id, depth, text: html.replace(/<[^>]+>/g, '') });
        }
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${html}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(href);
        const titleAttr = title ? ` title="${title}"` : '';
        const target = external ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${href}"${titleAttr}${target}>${text}</a>`;
      },
    },
  });
  const html = marked.parse(body);
  return { html, toc };
}

export async function loadGuides(contentDir) {
  const files = (await fs.readdir(contentDir)).filter((f) => f.endsWith('.md'));
  const guides = await Promise.all(
    files.map(async (file) => {
      const raw = await fs.readFile(path.join(contentDir, file), 'utf8');
      const { meta, body } = parseFrontMatter(raw);
      const slug = meta.slug ?? file.replace(/\.md$/, '').replace(/^\d+-/, '');
      const { html, toc } = renderMarkdown(body);
      return {
        slug,
        title: meta.title ?? slug,
        section: meta.section ?? 'Guides',
        order: meta.order ?? 999,
        summary: meta.summary ?? '',
        markdown: body,
        html,
        toc,
        plainText: stripMarkdown(body),
      };
    }),
  );
  guides.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return guides;
}

export async function loadServiceCatalog(servicesDir, log) {
  let files;
  try {
    files = (await fs.readdir(servicesDir)).filter((f) => f.endsWith('.md') && f !== 'index.md');
  } catch (err) {
    log?.warn({ err, servicesDir }, 'service docs directory not readable, service catalog will be empty');
    return [];
  }
  const services = await Promise.all(
    files.map(async (file) => {
      const raw = await fs.readFile(path.join(servicesDir, file), 'utf8');
      const heading = raw.match(/^#\s+(.+)$/m);
      const id = file.replace(/\.md$/, '');
      return {
        id,
        name: heading ? heading[1].trim() : id,
        docsUrl: `https://floci.io/floci/services/${id}/`,
      };
    }),
  );
  services.sort((a, b) => a.name.localeCompare(b.name));
  return services;
}

export function searchGuides(guides, query, limit = 10) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return [];
  }
  const results = [];
  for (const guide of guides) {
    const haystack = `${guide.title} ${guide.summary} ${guide.plainText}`.toLowerCase();
    if (!terms.every((t) => haystack.includes(t))) {
      continue;
    }
    const titleHits = terms.filter((t) => guide.title.toLowerCase().includes(t)).length;
    const bodyHits = terms.reduce((n, t) => n + haystack.split(t).length - 1, 0);
    const first = guide.plainText.toLowerCase().indexOf(terms[0]);
    const start = Math.max(0, first - 60);
    const snippet = first === -1
      ? guide.summary
      : `${start > 0 ? '...' : ''}${guide.plainText.slice(start, start + 180)}...`;
    results.push({ slug: guide.slug, title: guide.title, section: guide.section, snippet, score: titleHits * 10 + bodyHits });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
