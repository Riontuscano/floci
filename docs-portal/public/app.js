const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  sections: [],
  status: null,
  defaultSlug: 'introduction',
};

const els = {
  sidebar: $('#sidebar'),
  content: $('#content'),
  toc: $('#toc'),
  connection: $('#connection'),
  search: $('#search'),
  results: $('#search-results'),
  status: $('#status'),
  theme: $('#theme-toggle'),
  menu: $('#menu-toggle'),
};

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path) {
  const res = await fetch(`/api${path}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message ?? `Request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function storage(key, value) {
  try {
    if (value === undefined) {
      return localStorage.getItem(key);
    }
    localStorage.setItem(key, value);
  } catch {
    return null;
  }
  return null;
}

/* Theme */
function applyTheme(theme) {
  if (theme) {
    document.documentElement.dataset.theme = theme;
  }
}
applyTheme(storage('floci-docs-theme'));
els.theme.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme
    ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  storage('floci-docs-theme', next);
});

/* Mobile nav */
els.menu.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  els.menu.setAttribute('aria-expanded', String(open));
});
function closeNav() {
  document.body.classList.remove('nav-open');
  els.menu.setAttribute('aria-expanded', 'false');
}

/* Sidebar */
function renderSidebar() {
  const html = state.sections.map((section) => `
    <h4>${escapeHtml(section.name)}</h4>
    ${section.guides.map((g) => `<a href="#/docs/${g.slug}" data-slug="${g.slug}" title="${escapeHtml(g.summary)}">${escapeHtml(g.title)}</a>`).join('')}
  `).join('');
  els.sidebar.innerHTML = `${html}
    <h4>Explore</h4>
    <a href="#/services" data-slug="__services">Supported AWS services</a>
    <a href="https://floci.io/floci/" target="_blank" rel="noopener noreferrer">Full Floci docs &#8599;</a>
    <a href="https://github.com/floci-io/floci" target="_blank" rel="noopener noreferrer">GitHub &#8599;</a>`;
}

function setActiveNav(slug) {
  $$('a[data-slug]', els.sidebar).forEach((a) => a.classList.toggle('active', a.dataset.slug === slug));
}

/* Code blocks */
const HASH_COMMENT = new Set(['bash', 'sh', 'shell', 'yaml', 'yml', 'python', 'py', 'hcl', 'toml', 'dotenv', 'text', '']);
const SLASH_COMMENT = new Set(['javascript', 'js', 'typescript', 'ts', 'java', 'go', 'rust', 'json']);

function highlightComments(code, lang) {
  const marker = HASH_COMMENT.has(lang) ? '#' : SLASH_COMMENT.has(lang) ? '//' : null;
  const lines = code.textContent.split('\n');
  if (!marker) {
    return;
  }
  code.innerHTML = lines.map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith(marker) && !trimmed.startsWith('#!')) {
      return `<span class="tok-c">${escapeHtml(line)}</span>`;
    }
    return escapeHtml(line);
  }).join('\n');
}

function enhanceCodeBlocks(root) {
  $$('pre > code', root).forEach((code) => {
    const pre = code.parentElement;
    const lang = (code.className.match(/language-([\w-]+)/) ?? [])[1] ?? '';
    highlightComments(code, lang);
    const wrap = document.createElement('div');
    wrap.className = 'code-wrap';
    pre.replaceWith(wrap);
    wrap.appendChild(pre);
    if (lang) {
      const label = document.createElement('span');
      label.className = 'code-lang';
      label.textContent = lang;
      wrap.appendChild(label);
    }
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = 'Copy';
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent);
        btn.textContent = 'Copied';
        btn.classList.add('done');
      } catch {
        btn.textContent = 'Press Ctrl+C';
      }
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1600);
    });
    wrap.appendChild(btn);
  });
}

/* TOC */
let tocObserver;
function renderToc(toc) {
  tocObserver?.disconnect();
  if (!toc?.length) {
    els.toc.innerHTML = '';
    return;
  }
  els.toc.innerHTML = `<h5>On this page</h5>${toc.map((t) =>
    `<a href="#${t.id}" data-target="${t.id}" class="depth-${t.depth}">${escapeHtml(t.text)}</a>`).join('')}`;
  const links = new Map($$('a', els.toc).map((a) => [a.dataset.target, a]));
  tocObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (visible) {
      links.forEach((a) => a.classList.remove('active'));
      links.get(visible.target.id)?.classList.add('active');
    }
  }, { rootMargin: '-70px 0px -70% 0px' });
  toc.forEach((t) => {
    const el = document.getElementById(t.id);
    if (el) {
      tocObserver.observe(el);
    }
  });
}

function scrollToAnchor(id) {
  const el = id && document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    window.scrollTo({ top: 0 });
  }
}

/* Pages */
async function showGuide(slug, anchor) {
  setActiveNav(slug);
  try {
    const guide = await api(`/docs/${encodeURIComponent(slug)}`);
    document.title = `${guide.title} | Floci Integration Docs`;
    const lead = guide.summary ? `<p class="lead">${escapeHtml(guide.summary)}</p>` : '';
    const html = guide.html.replace(/(<\/h1>)/, `$1${lead}`);
    els.content.innerHTML = `
      <article class="article">
        <div class="breadcrumb">${escapeHtml(guide.section)}</div>
        ${html}
        <nav class="pager">
          ${guide.previous ? `<a class="prev" href="#/docs/${guide.previous.slug}"><small>Previous</small><strong>&larr; ${escapeHtml(guide.previous.title)}</strong></a>` : '<span></span>'}
          ${guide.next ? `<a class="next" href="#/docs/${guide.next.slug}"><small>Next</small><strong>${escapeHtml(guide.next.title)} &rarr;</strong></a>` : '<span></span>'}
        </nav>
      </article>`;
    enhanceCodeBlocks(els.content);
    renderToc(guide.toc);
    scrollToAnchor(anchor);
  } catch (err) {
    els.content.innerHTML = `<div class="error"><h1>${err.status === 404 ? 'Guide not found' : 'Something went wrong'}</h1>
      <p>${escapeHtml(err.message)}</p><p><a href="#/docs/${state.defaultSlug}">Back to the introduction</a></p></div>`;
    renderToc([]);
  }
}

async function showServices() {
  setActiveNav('__services');
  document.title = 'Supported AWS services | Floci Integration Docs';
  renderToc([]);
  els.content.innerHTML = '<div class="loading">Loading services...</div>';
  try {
    const { services } = await api('/services');
    const live = state.status?.reachable ? state.status.services : {};
    const liveNote = state.status?.reachable
      ? `Live status from <code>${escapeHtml(state.status.endpoint)}</code>: <strong>${Object.values(live).filter((s) => s === 'running').length}</strong> services running.`
      : 'Start Floci to see which services are enabled on your instance.';
    els.content.innerHTML = `
      <article class="article">
        <div class="breadcrumb">Explore</div>
        <h1>Supported AWS services</h1>
        <p class="lead">${services.length} services documented. ${liveNote}</p>
        <input class="services-filter" id="svc-filter" type="search" placeholder="Filter services" aria-label="Filter services">
        <div class="services-grid" id="svc-grid"></div>
      </article>`;
    const grid = $('#svc-grid');
    const render = (filter = '') => {
      const f = filter.toLowerCase();
      grid.innerHTML = services
        .filter((s) => !f || s.name.toLowerCase().includes(f) || s.id.includes(f))
        .map((s) => {
          const st = live[s.id] ?? live[s.id.replace(/-/g, '')];
          const badge = st ? `<span class="badge ${st === 'running' ? 'running' : ''}">${escapeHtml(st)}</span>` : '';
          return `<a href="${s.docsUrl}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(s.name)}</span>${badge}</a>`;
        }).join('') || '<p>No services match.</p>';
    };
    render();
    $('#svc-filter').addEventListener('input', (e) => render(e.target.value));
  } catch (err) {
    els.content.innerHTML = `<div class="error">Could not load services: ${escapeHtml(err.message)}</div>`;
  }
}

/* Routing: #/docs/<slug>[#anchor] or #/services */
function route() {
  closeNav();
  hideResults();
  const hash = decodeURIComponent(location.hash.slice(1));
  const [path, anchor] = hash.split('#');
  const docMatch = path.match(/^\/docs\/([a-z0-9-]+)$/);
  if (docMatch) {
    return showGuide(docMatch[1], anchor);
  }
  if (path === '/services') {
    return showServices();
  }
  location.replace(`#/docs/${state.defaultSlug}`);
  return null;
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) {
    return;
  }
  const href = a.getAttribute('href');
  if (href.startsWith('#/')) {
    return;
  }
  e.preventDefault();
  const id = href.slice(1);
  const base = location.hash.split('#').slice(0, 2).join('#');
  history.replaceState(null, '', `#${base.replace(/^#/, '')}#${id}`);
  scrollToAnchor(id);
});

window.addEventListener('hashchange', route);

/* Search */
let searchTimer;
let activeResult = -1;

function hideResults() {
  els.results.hidden = true;
  activeResult = -1;
}

async function runSearch(q) {
  if (!q.trim()) {
    hideResults();
    return;
  }
  try {
    const { results } = await api(`/search?q=${encodeURIComponent(q)}&limit=8`);
    els.results.innerHTML = results.length
      ? results.map((r) => `<a href="#/docs/${r.slug}"><div class="r-section">${escapeHtml(r.section)}</div><div class="r-title">${escapeHtml(r.title)}</div><div class="r-snippet">${escapeHtml(r.snippet)}</div></a>`).join('')
      : `<div class="empty">No results for "${escapeHtml(q)}"</div>`;
    els.results.hidden = false;
    activeResult = -1;
  } catch (err) {
    els.results.innerHTML = `<div class="empty">Search failed: ${escapeHtml(err.message)}</div>`;
    els.results.hidden = false;
  }
}

els.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(els.search.value), 150);
});

els.search.addEventListener('keydown', (e) => {
  const items = $$('a', els.results);
  if (e.key === 'Escape') {
    hideResults();
    els.search.blur();
  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
    e.preventDefault();
    activeResult = (activeResult + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((a, i) => a.classList.toggle('active', i === activeResult));
    items[activeResult].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && items.length) {
    location.hash = items[Math.max(activeResult, 0)].getAttribute('href');
    els.search.value = '';
    els.search.blur();
  }
});

els.results.addEventListener('click', () => {
  els.search.value = '';
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search')) {
    hideResults();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== els.search && !/input|textarea/i.test(document.activeElement?.tagName ?? '')) {
    e.preventDefault();
    els.search.focus();
  }
});

/* Live Floci status */
async function refreshStatus() {
  try {
    state.status = await api('/floci/status');
  } catch {
    state.status = { reachable: false, error: 'portal unreachable' };
  }
  const s = state.status;
  els.status.classList.toggle('online', s.reachable);
  els.status.classList.toggle('offline', !s.reachable);
  $('.status-text', els.status).textContent = s.reachable ? `Floci ${s.version ?? ''} online`.replace('  ', ' ') : 'Floci offline';
  els.status.title = s.reachable
    ? `${s.endpoint}: ${s.serviceCount} services, ${s.latencyMs} ms`
    : `${s.endpoint ?? 'Floci'} not reachable (${s.error}). See Quick Start to run it.`;
}

els.status.addEventListener('click', () => {
  location.hash = state.status?.reachable ? '#/services' : '#/docs/quick-start';
});

async function renderConnectionCard() {
  try {
    const conn = await api('/floci/connection');
    const env = Object.entries(conn.env).map(([k, v]) => `${k}=${v}`).join('\n');
    els.connection.innerHTML = `<h5>Connect your app</h5><p>Add to your <code>.env</code>:</p><pre><code class="language-dotenv">${escapeHtml(env)}</code></pre>`;
    els.connection.hidden = false;
    enhanceCodeBlocks(els.connection);
  } catch {
    els.connection.hidden = true;
  }
}

/* Boot */
async function init() {
  try {
    const { sections } = await api('/docs');
    state.sections = sections;
    state.defaultSlug = sections[0]?.guides[0]?.slug ?? 'introduction';
    renderSidebar();
  } catch (err) {
    els.content.innerHTML = `<div class="error"><h1>Docs unavailable</h1><p>${escapeHtml(err.message)}</p></div>`;
    return;
  }
  route();
  renderConnectionCard();
  refreshStatus();
  setInterval(refreshStatus, 10000);
}

init();
