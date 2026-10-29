import { randomUUID } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { config } from './config.js';
import { files, pingDb } from './db.js';
import * as storage from './storage.js';
import { createLimiter, detectType, isImage, parseVariant, prepareImage, renderVariant } from './images.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxFileMb * 1024 * 1024, files: config.upload.maxFilesPerRequest },
});

const resizeLimiter = createLimiter(config.images.maxConcurrentResizes);
const inFlight = new Map();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IMMUTABLE = 'public, max-age=31536000, immutable';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Accepts "uuid" or "uuid.ext" so links keep a readable extension. */
const parseId = (raw) => {
  const id = raw.replace(/\.[a-z0-9]+$/i, '');
  return UUID.test(id) ? id : null;
};

const extOf = (key) => key.slice(key.lastIndexOf('.') + 1);
const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

const toDto = (row, req) => {
  const url = `${baseUrl(req)}/files/${row.id}.${extOf(row.storage_key)}`;
  return {
    id: row.id,
    name: row.original_name,
    contentType: row.content_type,
    size: row.size,
    width: row.width,
    height: row.height,
    lqip: row.lqip,
    createdAt: row.created_at,
    url,
    thumbUrl: isImage(row.content_type) ? `${url}?w=320&h=320&fit=cover` : null,
  };
};

const encodeCursor = (row) => Buffer.from(JSON.stringify([row.created_at, row.id])).toString('base64url');
const decodeCursor = (value) => {
  try {
    const [created_at, id] = JSON.parse(Buffer.from(value, 'base64url').toString());
    return typeof created_at === 'string' && typeof id === 'string' ? { created_at, id } : null;
  } catch {
    return null;
  }
};

async function storeUpload(file) {
  const type = await detectType(file.buffer);
  if (!type) {
    throw new HttpError(415, 'Only JPEG, PNG, WEBP and PDF files are accepted.');
  }

  const id = randomUUID();
  const key = `originals/${id}.${type.ext}`;
  let body = file.buffer;
  let image = { width: null, height: null, lqip: null };
  if (isImage(type.mime)) {
    try {
      image = await prepareImage(file.buffer, type.mime);
    } catch (err) {
      throw new HttpError(422, `The image could not be read: ${err.message}`);
    }
    body = image.body;
  }

  await storage.putObject(key, body, type.mime);
  const row = {
    id,
    storage_key: key,
    original_name: file.originalname.slice(0, 255),
    content_type: type.mime,
    size: body.length,
    width: image.width,
    height: image.height,
    lqip: image.lqip,
    created_at: new Date().toISOString(),
  };
  try {
    files.insert(row);
  } catch (err) {
    await storage.deleteKeys([key]).catch((cleanupErr) =>
      console.error(`Failed to remove orphaned object ${key}`, cleanupErr));
    throw err;
  }
  return row;
}

/** Returns the variant bytes, creating and caching them in storage on first request. */
async function loadVariant(row, variant) {
  const key = `variants/${row.id}/${variant.name}`;
  const cached = await storage.getObjectBuffer(key);
  if (cached) {
    return cached;
  }
  if (!inFlight.has(key)) {
    const job = resizeLimiter(async () => {
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

const contentDisposition = (req, name) => {
  const type = req.query.download !== undefined ? 'attachment' : 'inline';
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

const app = express();
app.disable('x-powered-by');
app.use(express.static('public'));

app.get('/api/config', (req, res) => {
  res.json({
    allowedSizes: config.images.allowedSizes,
    maxFileMb: config.upload.maxFileMb,
    maxFilesPerRequest: config.upload.maxFilesPerRequest,
  });
});

app.post('/api/files', upload.array('files'), async (req, res) => {
  if (!req.files?.length) {
    throw new HttpError(400, 'Attach one or more files in the "files" field.');
  }

  const stored = [];
  const errors = [];
  for (const file of req.files) {
    try {
      stored.push(toDto(await storeUpload(file), req));
    } catch (err) {
      if (!(err instanceof HttpError)) {
        console.error(`Upload of ${file.originalname} failed`, err);
      }
      errors.push({ name: file.originalname, error: err instanceof HttpError ? err.message : 'Storage error' });
    }
  }
  res.status(stored.length > 0 ? 201 : 400).json({ files: stored, errors });
});

app.get('/api/files', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 24));
  const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;
  if (req.query.cursor && !cursor) {
    throw new HttpError(400, 'Invalid cursor.');
  }
  const rows = files.list(limit + 1, cursor);
  const page = rows.slice(0, limit);
  res.json({
    files: page.map((row) => toDto(row, req)),
    nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
    stats: files.stats(),
  });
});

app.get('/api/files/:id/meta', (req, res) => {
  const id = parseId(req.params.id);
  const row = id && files.get(id);
  if (!row) {
    throw new HttpError(404, 'File not found');
  }
  res.json(toDto(row, req));
});

app.delete('/api/files/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const row = id && files.get(id);
  if (!row) {
    throw new HttpError(404, 'File not found');
  }
  await storage.deleteKeys([row.storage_key]);
  await storage.deletePrefix(`variants/${row.id}/`);
  files.delete(row.id);
  res.status(204).end();
});

// The hosted link. The browser never talks to Floci: this route looks the file up, optionally
// resizes it, and streams the bytes back.
app.get('/files/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const row = id && files.get(id);
  if (!row) {
    throw new HttpError(404, 'File not found');
  }

  const variant = isImage(row.content_type)
    ? parseVariant(req.query, row, { accept: req.get('accept') ?? '', saveData: req.get('save-data') === 'on' })
    : null;

  const etag = `"${row.id}-${variant?.name ?? 'original'}"`;
  res.set('ETag', etag);
  res.set('Cache-Control', IMMUTABLE);
  res.set('Content-Disposition', contentDisposition(req, row.original_name));
  if (variant?.auto) {
    res.set('Vary', 'Accept, Save-Data');
  }
  if (req.get('if-none-match') === etag) {
    return res.status(304).end();
  }

  if (variant) {
    const bytes = await loadVariant(row, variant);
    res.set('X-Image-Variant', variant.name);
    return res.type(variant.contentType).send(bytes);
  }

  const obj = await storage.getObject(row.storage_key);
  if (!obj) {
    throw new HttpError(404, 'File not found');
  }
  res.type(row.content_type);
  if (obj.contentLength !== undefined) {
    res.set('Content-Length', String(obj.contentLength));
  }
  obj.body.pipe(res);
});

app.get('/healthz', async (req, res) => {
  const checks = { db: 'ok', storage: 'ok' };
  try {
    pingDb();
  } catch (err) {
    checks.db = err.message;
  }
  try {
    await storage.pingStorage();
  } catch (err) {
    checks.storage = err.name ?? err.message;
  }
  const healthy = checks.db === 'ok' && checks.storage === 'ok';
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', ...checks, ...files.stats() });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `Each file must be at most ${config.upload.maxFileMb} MB.`
      : err.code === 'LIMIT_FILE_COUNT'
        ? `Upload at most ${config.upload.maxFilesPerRequest} files at a time.`
        : err.message;
    return res.status(status).json({ error: message });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(`${req.method} ${req.originalUrl} failed`, err);
  res.status(500).json({ error: 'Internal error' });
});

await storage.ensureBucket();
app.listen(config.port, () => console.log(`Demo running on port ${config.port}`));
