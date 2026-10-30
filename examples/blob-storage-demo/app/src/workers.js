import { config } from './config.js';
import { alerts, auditLog, files } from './db.js';
import { isImage, parseVariant } from './images.js';
import { ack, queues, receive, retryLater } from './messaging.js';
import { loadVariant } from './variants.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const formatMb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

let stopping = false;
export const workerStats = {};

/**
 * Runs a worker loop on one SQS queue: long-poll, handle each message, delete it on success.
 * On failure the message is not deleted. It becomes visible again after a growing delay
 * (5s, 10s, 20s...) and, after MAX_RECEIVE_COUNT attempts, SQS moves it to the DLQ.
 * Handlers must be safe to run twice for the same message: SQS delivers at least once.
 */
function startWorker(key, handler) {
  const queue = queues[key];
  const stats = { queue: queue.name, processed: 0, failed: 0, lastPollAt: null, lastError: null };
  workerStats[key] = stats;

  async function handleOne(message) {
    try {
      const event = JSON.parse(message.Body);
      if (!event?.id || !event?.type || !event?.data) {
        throw new Error('Message is not a valid event');
      }
      await handler(event);
      await ack(queue.url, message);
      stats.processed++;
    } catch (err) {
      stats.failed++;
      stats.lastError = err.message;
      const attempt = Number(message.Attributes?.ApproximateReceiveCount ?? 1);
      console.warn(`[${queue.name}] message ${message.MessageId} failed (attempt ${attempt}): ${err.message}`);
      await retryLater(queue.url, message, Math.min(60, 5 * 2 ** (attempt - 1)))
        .catch((e) => console.warn(`[${queue.name}] could not delay retry: ${e.message}`));
    }
  }

  (async () => {
    while (!stopping) {
      try {
        const messages = await receive(queue.url);
        stats.lastPollAt = new Date().toISOString();
        for (const message of messages) {
          await handleOne(message);
        }
      } catch (err) {
        stats.lastError = err.message;
        console.error(`[${queue.name}] polling failed, retrying in 5s: ${err.message}`);
        await sleep(5000);
      }
    }
  })();
}

/** Pre-generates the gallery thumbnails so the first view is instant. */
async function handleThumbnails(event) {
  if (event.type !== 'file.uploaded') {
    return;
  }
  const row = files.get(event.data.fileId);
  if (!row || !isImage(row.content_type)) {
    return;
  }
  for (const size of config.events.thumbnailSizes) {
    const variant = parseVariant({ w: String(size), h: String(size), fit: 'cover' }, row, { accept: 'image/webp' });
    await loadVariant(row, variant);
  }
}

/** Keeps a permanent record of every upload and delete. */
async function handleAudit(event) {
  auditLog.record({
    event_id: event.id,
    type: event.type,
    file_id: event.data.fileId ?? null,
    file_name: event.data.name ?? null,
    size: event.data.size ?? null,
    client_ip: event.data.clientIp ?? null,
    occurred_at: event.time,
    recorded_at: new Date().toISOString(),
  });
}

/**
 * Turns events into alerts shown on the Events page. This is where business rules belong,
 * for example "selfie uploaded after 09:00 means a late check-in".
 */
async function handleAlerts(event) {
  const { name, size, clientIp } = event.data;
  let alert = null;
  if (event.type === 'file.deleted') {
    alert = { level: 'warning', message: `"${name}" was deleted (from ${clientIp})` };
  } else if (event.type === 'file.uploaded' && size > config.events.alertLargeFileMb * 1024 * 1024) {
    alert = { level: 'info', message: `Large upload: "${name}", ${formatMb(size)} (from ${clientIp})` };
  }
  if (alert) {
    alerts.record({ event_id: event.id, ...alert, occurred_at: event.time });
  }
}

export function startWorkers() {
  startWorker('thumbnails', handleThumbnails);
  startWorker('audit', handleAudit);
  startWorker('alerts', handleAlerts);
}

export function stopWorkers() {
  stopping = true;
}
