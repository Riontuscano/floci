import { config } from './config.js';
import { HttpError } from './errors.js';
import { createLimiter, renderVariant } from './images.js';
import * as storage from './storage.js';

// Shared by upload processing, on-demand resizing and the thumbnail worker: decoding images
// is the memory-heavy step, so at most this many run at once across all of them.
export const imageLimiter = createLimiter(config.images.maxConcurrentResizes);
const inFlight = new Map();

/** Returns the variant bytes, creating and caching them in storage on first request. */
export async function loadVariant(row, variant) {
  const key = `variants/${row.id}/${variant.name}`;
  const cached = await storage.getObjectBuffer(key);
  if (cached) {
    return cached;
  }
  if (!inFlight.has(key)) {
    const job = imageLimiter(async () => {
      const original = await storage.getObjectBuffer(row.storage_key);
      if (!original) {
        throw new HttpError(404, 'File not found');
      }
      const rendered = await renderVariant(original, variant);
      await storage.putObject(key, rendered, variant.contentType);
      return rendered;
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, job);
  }
  return inFlight.get(key);
}
