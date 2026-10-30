const $ = (id) => document.getElementById(id);

const QUEUE_INFO = {
  thumbnails: 'Pre-generates gallery thumbnails after each image upload',
  audit: 'Records every upload and delete in the audit log',
  alerts: 'Raises alerts for deletes and large uploads',
};

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of [].concat(children)) {
    node.append(child);
  }
  return node;
}

const formatBytes = (n) => {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const formatTime = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' });

function toast(message) {
  const box = $('toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { box.hidden = true; }, 3000);
}

async function post(path) {
  const res = await fetch(path, { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

function stat(label, value, className = '') {
  return el('div', { className: `stat ${className}` }, [
    el('span', { className: 'value', textContent: String(value) }),
    el('span', { className: 'label', textContent: label }),
  ]);
}

function queueCard(key, queue, worker) {
  const purgeButton = el('button', {
    className: 'danger',
    textContent: 'Clear dead letters',
    disabled: queue.deadLetters === 0,
    title: 'Permanently discard messages that cannot be processed',
  });
  purgeButton.addEventListener('click', async () => {
    if (!confirm(`Permanently discard ${queue.deadLetters} dead letter(s) in ${queue.name}?`)) return;
    await post(`/api/queues/${key}/purge-dead-letters`);
    toast(`Dead letters in ${queue.name} cleared`);
    refresh();
  });

  const redriveButton = el('button', {
    textContent: 'Retry dead letters',
    disabled: queue.deadLetters === 0,
    title: 'Send them back to the queue, e.g. after fixing a bug',
  });
  redriveButton.addEventListener('click', async () => {
    const { moved } = await post(`/api/queues/${key}/redrive`);
    toast(`Moved ${moved} message(s) back to ${queue.name}`);
    refresh();
  });

  const lastPoll = worker?.lastPollAt ? `last checked ${formatTime(worker.lastPollAt)}` : 'not polling yet';
  return el('div', { className: 'panel queue-card' }, [
    el('div', { className: 'queue-head' }, [
      el('strong', { textContent: queue.name }),
      el('span', { className: `dot ${worker?.lastPollAt ? 'ok' : ''}`, title: lastPoll }),
    ]),
    el('p', { className: 'muted small', textContent: QUEUE_INFO[key] ?? '' }),
    el('div', { className: 'stats' }, [
      stat('waiting', queue.waiting),
      stat('in progress', queue.inFlight),
      stat('dead letters', queue.deadLetters, queue.deadLetters > 0 ? 'bad' : ''),
    ]),
    el('p', { className: 'muted small', textContent: `Worker: ${worker?.processed ?? 0} done, ${worker?.failed ?? 0} failed attempts, ${lastPoll}` }),
    worker?.lastError ? el('p', { className: 'error small', textContent: `Last error: ${worker.lastError}` }) : '',
    el('div', { className: 'actions' }, [redriveButton, purgeButton]),
  ]);
}

async function refresh() {
  try {
    const [messaging, log] = await Promise.all([
      fetch('/api/messaging').then((r) => r.json()),
      fetch('/api/events?limit=50').then((r) => r.json()),
    ]);

    $('topic').textContent = messaging.topic;
    $('max-receive').textContent = messaging.maxReceiveCount;
    $('outbox').textContent = `${messaging.outbox.pending} waiting to publish`;
    $('published').textContent = `${messaging.outbox.published} published since start`;

    $('queues').replaceChildren(...Object.entries(messaging.queues)
      .map(([key, queue]) => queueCard(key, queue, messaging.workers[key])));

    $('alerts').replaceChildren(...(log.alerts.length
      ? log.alerts.map((a) => el('li', { className: a.level }, [
        el('span', { className: 'muted small', textContent: formatTime(a.occurred_at) }),
        el('span', { textContent: a.message }),
      ]))
      : [el('li', { className: 'muted', textContent: 'No alerts yet. Delete a file or upload one over the size limit.' })]));

    $('events').replaceChildren(...(log.events.length
      ? log.events.map((e) => el('tr', {}, [
        el('td', { textContent: formatTime(e.occurred_at) }),
        el('td', {}, el('span', { className: `tag ${e.type.replace('.', '-')}`, textContent: e.type })),
        el('td', { className: 'name', title: e.file_name ?? '', textContent: e.file_name ?? '' }),
        el('td', { textContent: formatBytes(e.size) }),
        el('td', { textContent: e.client_ip ?? '' }),
      ]))
      : [el('tr', {}, el('td', { colSpan: 5, className: 'muted', textContent: 'No events yet. Upload a file on the Files page.' }))]));
  } catch (err) {
    toast(`Could not load events: ${err.message}`);
  }
}

refresh();
setInterval(refresh, 3000);
