const $ = (id) => document.getElementById(id);

const PROFILES = {
  low: { w: 320, q: 50, label: 'Low' },
  medium: { w: 640, q: 70, label: 'Medium' },
  high: { w: 1600, q: 85, label: 'High' },
};
const COMPRESS_MAX_SIDE = 2048;
const COMPRESS_MIN_BYTES = 500 * 1024;

const state = { allowedSizes: [160, 320, 640, 1024, 1600], nextCursor: null };

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of [].concat(children)) {
    node.append(child);
  }
  return node;
}

const formatBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

function toast(message) {
  const box = $('toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { box.hidden = true; }, 2500);
}

// navigator.clipboard only exists on https or localhost. On http://192.168.x.x it is
// undefined, so fall back to the older copy command.
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
  } else {
    const area = el('textarea', { value: text });
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  toast('Link copied');
}

/* ---------- Network-aware quality ---------- */

function networkInfo() {
  const c = navigator.connection;
  if (!c) {
    return { known: false, text: 'Not reported by this browser (Safari/Firefox). Using screen size only.' };
  }
  const parts = [c.effectiveType?.toUpperCase(), c.downlink ? `~${c.downlink} Mbps` : null, c.saveData ? 'Data saver on' : null];
  return { known: true, type: c.effectiveType, downlink: c.downlink, saveData: c.saveData, text: parts.filter(Boolean).join(', ') };
}

function autoProfileName() {
  const net = networkInfo();
  if (!net.known) return 'high';
  if (net.saveData || net.type === 'slow-2g' || net.type === '2g') return 'low';
  if (net.type === '3g' || (net.downlink && net.downlink < 1.5)) return 'medium';
  return 'high';
}

const snapSize = (px) => state.allowedSizes.find((s) => s >= px) ?? state.allowedSizes[state.allowedSizes.length - 1];

/** Width and quality for a profile, never wider than the viewer needs on this screen. */
function profileFor(name) {
  const screenNeed = snapSize(Math.round(Math.min(window.innerWidth, 960) * (window.devicePixelRatio || 1)));
  return { name, w: Math.min(PROFILES[name].w, screenNeed), q: PROFILES[name].q };
}

/** The profile picked by network speed, or the manual choice. */
function currentProfile() {
  const mode = $('quality-mode').value;
  return profileFor(mode === 'auto' ? autoProfileName() : mode);
}

function renderNetwork() {
  $('network-info').textContent = networkInfo().text;
  const p = currentProfile();
  $('profile-info').textContent = `Viewer loads: ${PROFILES[p.name].label}, ${p.w}px, quality ${p.q}`;
}

navigator.connection?.addEventListener('change', renderNetwork);
$('quality-mode').addEventListener('change', renderNetwork);

/* ---------- Upload ---------- */

/** Shrinks big JPEG/WEBP photos before upload. Returns the original file when it would not help. */
async function compress(file) {
  if (!$('compress').checked || !['image/jpeg', 'image/webp'].includes(file.type)) {
    return file;
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, COMPRESS_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < COMPRESS_MIN_BYTES) {
    bitmap.close();
    return file;
  }
  const canvas = el('canvas', { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, file.type, 0.85));
  if (!blob || blob.size >= file.size) {
    return file;
  }
  return new File([blob], file.name, { type: file.type });
}

function uploadOne(file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('files', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      if (xhr.status === 201 && body.files?.length) {
        resolve(body.files[0]);
      } else {
        reject(new Error(body.errors?.[0]?.error ?? body.error ?? `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(form);
  });
}

async function handleFiles(fileList) {
  const items = [...fileList];
  const queue = $('queue');
  const jobs = items.map((file) => {
    const status = el('span', { className: 'muted', textContent: 'Waiting' });
    const bar = el('progress', { max: 1, value: 0 });
    queue.prepend(el('li', {}, [el('span', { className: 'name', textContent: file.name }), status, bar]));
    return { file, status, bar };
  });

  // Two uploads at a time: fast overall, but gentle on slow networks.
  const workers = Array.from({ length: Math.min(2, jobs.length) }, async () => {
    while (jobs.length) {
      const { file, status, bar } = jobs.shift();
      try {
        status.textContent = 'Compressing...';
        const ready = await compress(file);
        const sizeNote = ready === file ? formatBytes(file.size) : `${formatBytes(file.size)} → ${formatBytes(ready.size)}`;
        status.textContent = `Uploading ${sizeNote}`;
        const stored = await uploadOne(ready, (p) => { bar.value = p; });
        bar.value = 1;
        status.className = 'done';
        status.textContent = `Stored, ${sizeNote}`;
        $('gallery').prepend(card(stored));
        $('empty').hidden = true;
      } catch (err) {
        status.className = 'error';
        status.textContent = err.message;
      }
    }
  });
  await Promise.all(workers);
  refreshStatus();
}

const dropzone = $('dropzone');
$('file-input').addEventListener('change', (e) => {
  handleFiles(e.target.files);
  e.target.value = '';
});
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('over');
  handleFiles(e.dataTransfer.files);
});

/* ---------- Gallery ---------- */

function thumbnail(file) {
  if (!file.contentType.startsWith('image/')) {
    return el('a', { className: 'thumb', href: file.url, target: '_blank' }, el('span', { className: 'pdf', textContent: 'PDF' }));
  }
  // srcset lets the browser choose the smallest square that fills the card on this screen.
  const sizes = [160, 320, 640].map((s) => `${file.url}?w=${s}&h=${s}&fit=cover ${s}w`).join(', ');
  const img = el('img', {
    src: `${file.url}?w=320&h=320&fit=cover`,
    srcset: sizes,
    sizes: '(max-width: 600px) 45vw, 200px',
    loading: 'lazy',
    decoding: 'async',
    alt: file.name,
  });
  img.addEventListener('load', () => img.classList.add('loaded'));
  const button = el('button', { className: 'thumb', title: 'Open viewer' }, img);
  if (file.lqip) {
    button.style.backgroundImage = `url("${file.lqip}")`;
  }
  button.addEventListener('click', () => openViewer(file));
  return button;
}

function card(file) {
  const node = el('div', { className: 'card' });
  const dims = file.width ? `${file.width}×${file.height}, ` : '';
  const del = el('button', { className: 'danger', textContent: 'Delete' });
  del.addEventListener('click', async () => {
    if (!confirm(`Delete "${file.name}"?`)) return;
    const res = await fetch(`/api/files/${file.id}`, { method: 'DELETE' });
    if (res.ok) {
      node.remove();
      toast('Deleted');
      refreshStatus();
    } else {
      toast('Delete failed');
    }
  });
  const copy = el('button', { textContent: 'Copy link' });
  copy.addEventListener('click', () => copyText(file.url));

  node.append(
    thumbnail(file),
    el('div', { className: 'meta' }, [
      el('span', { className: 'name', title: file.name, textContent: file.name }),
      el('span', { className: 'muted', textContent: `${dims}${formatBytes(file.size)}` }),
    ]),
    el('div', { className: 'actions' }, [
      copy,
      el('a', { href: file.url, target: '_blank', textContent: 'Open' }),
      del,
    ]),
  );
  return node;
}

async function loadPage() {
  const query = state.nextCursor ? `?cursor=${encodeURIComponent(state.nextCursor)}` : '';
  const res = await fetch(`/api/files${query}`);
  const body = await res.json();
  for (const file of body.files) {
    $('gallery').append(card(file));
  }
  state.nextCursor = body.nextCursor;
  $('load-more').hidden = !body.nextCursor;
  $('empty').hidden = $('gallery').children.length > 0;
}

$('load-more').addEventListener('click', loadPage);

/* ---------- Viewer ---------- */

let viewerFile = null;

function variantUrl(file, profileName) {
  if (profileName === 'original') return file.url;
  const p = profileFor(profileName);
  return `${file.url}?w=${p.w}&q=${p.q}`;
}

function showVariant(profileName) {
  const file = viewerFile;
  const url = variantUrl(file, profileName);
  const img = $('viewer-img');
  const stage = $('viewer-stage');
  const started = performance.now();

  stage.classList.add('loading');
  $('viewer-info').textContent = 'Loading...';
  $('viewer-url').textContent = url;
  for (const b of document.querySelectorAll('.viewer-controls button')) {
    b.classList.toggle('active', b.dataset.profile === profileName);
  }

  img.onload = () => {
    stage.classList.remove('loading');
    const ms = Math.round(performance.now() - started);
    const entry = performance.getEntriesByName(img.currentSrc).pop();
    const bytes = entry?.encodedBodySize || entry?.transferSize;
    const size = bytes ? `, ${formatBytes(bytes)}` : '';
    $('viewer-info').textContent = `Showing ${img.naturalWidth}×${img.naturalHeight}${size}, loaded in ${ms} ms`;
  };
  img.src = url;
}

function openViewer(file) {
  viewerFile = file;
  $('viewer-title').textContent = file.name;
  // The blurred placeholder shows instantly while the real image downloads.
  $('viewer-stage').style.backgroundImage = file.lqip ? `url("${file.lqip}")` : '';
  $('viewer').showModal();
  showVariant(currentProfile().name);
}

for (const b of document.querySelectorAll('.viewer-controls button')) {
  b.addEventListener('click', () => showVariant(b.dataset.profile));
}
$('viewer-close').addEventListener('click', () => $('viewer').close());
$('viewer').addEventListener('click', (e) => { if (e.target === $('viewer')) $('viewer').close(); });

/* ---------- Status ---------- */

async function refreshStatus() {
  try {
    const res = await fetch('/healthz');
    const body = await res.json();
    $('health').className = `dot ${res.ok ? 'ok' : 'bad'}`;
    $('health').title = res.ok ? 'App, database and storage are healthy' : `DB: ${body.db}, storage: ${body.storage}`;
    const quota = body.quotaBytes ? ` of ${formatBytes(body.quotaBytes)}` : '';
    $('stats').textContent = `${body.count} files, ${formatBytes(body.bytes)}${quota}`;
  } catch {
    $('health').className = 'dot bad';
    $('stats').textContent = 'App unreachable';
  }
}

async function init() {
  const cfg = await fetch('/api/config').then((r) => r.json());
  state.allowedSizes = cfg.allowedSizes;
  $('limits').textContent = `JPEG, PNG, WEBP or PDF, up to ${cfg.maxFileMb} MB each, ${cfg.maxFilesPerRequest} at a time`;
  renderNetwork();
  refreshStatus();
  loadPage();
}

init();
