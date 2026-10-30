import { outbox } from './db.js';
import { publishEvent } from './messaging.js';

/**
 * Publishes events saved in the outbox table to SNS, oldest first, and removes each one once
 * SNS has accepted it. Runs every second and whenever kick() is called after a new event.
 * If SNS is unreachable the events simply wait in the table and go out when it is back.
 */
export function startOutboxDispatcher({ intervalMs = 1000 } = {}) {
  const stats = { published: 0, failed: 0, lastError: null };
  let running = false;

  async function run() {
    if (running) {
      return;
    }
    running = true;
    try {
      for (const row of outbox.pending(50)) {
        try {
          await publishEvent(JSON.parse(row.payload));
          outbox.markPublished(row.id);
          stats.published++;
        } catch (err) {
          outbox.markFailed(row.id, err.message);
          stats.failed++;
          stats.lastError = err.message;
          console.error(`Publishing event ${row.id} (${row.type}) failed, will retry: ${err.message}`);
          // Stop this round: keeps events in order and avoids hammering an unavailable SNS.
          break;
        }
      }
    } finally {
      running = false;
    }
  }

  const timer = setInterval(run, intervalMs);
  return {
    kick: () => { run(); },
    stop: () => clearInterval(timer),
    stats,
    pending: () => outbox.count(),
  };
}
