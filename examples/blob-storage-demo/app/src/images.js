import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { config } from './config.js';

export const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const OUTPUT_TYPES = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const FITS = new Set(['inside', 'cover']);

export const isImage = (contentType) => contentType.startsWith('image/');

/** Detects the type from the file's bytes, not its name or the browser's claim. */
export async function detectType(buffer) {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !(detected.mime in ALLOWED_TYPES)) {
    return null;
  }
  return { mime: detected.mime, ext: ALLOWED_TYPES[detected.mime] };
}

function encode(pipeline, format, quality) {
  switch (format) {
    case 'jpeg': return pipeline.jpeg({ quality, mozjpeg: true });
    case 'png': return pipeline.png({ compressionLevel: 9 });
    case 'webp': return pipeline.webp({ quality });
    default: throw new Error(`Unsupported output format ${format}`);
  }
}

const formatOf = (mime) => mime.split('/')[1];

/**
 * Normalises an uploaded image: applies the EXIF rotation, then re-encodes it, which drops
 * all metadata (GPS location, camera details). Also builds a tiny blurred placeholder.
 */
export async function prepareImage(buffer, mime) {
  const { data, info } = await encode(sharp(buffer).rotate(), formatOf(mime), config.images.originalQuality)
    .toBuffer({ resolveWithObject: true });

  const placeholder = await sharp(data).resize(24).blur(1.5).webp({ quality: 40 }).toBuffer();

  return {
    body: data,
    width: info.width,
    height: info.height,
    lqip: `data:image/webp;base64,${placeholder.toString('base64')}`,
  };
}

const snapSize = (value) => {
  const sizes = config.images.allowedSizes;
  return sizes.find((s) => s >= value) ?? sizes[sizes.length - 1];
};

const positiveInt = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Turns ?w=&h=&fit=&q=&format= into a normalised variant, or null when the original is wanted.
 * Every value is snapped to a small fixed set so the number of possible variants stays bounded.
 */
export function parseVariant(query, file, { accept = '', saveData = false } = {}) {
  const wanted = ['w', 'h', 'q', 'fit', 'format'].some((k) => query[k] !== undefined);
  if (!wanted && !saveData) {
    return null;
  }

  const w = positiveInt(query.w);
  const h = positiveInt(query.h);
  const fit = FITS.has(query.fit) ? query.fit : 'inside';

  let q = positiveInt(query.q) ?? config.images.defaultQuality;
  q = Math.min(90, Math.max(30, Math.round(q / 5) * 5));
  if (saveData) {
    q = Math.min(q, config.images.saveDataQuality);
  }

  const requested = (query.format ?? 'auto').toLowerCase();
  let format;
  if (requested in OUTPUT_TYPES) {
    format = requested;
  } else if (accept.includes('image/webp')) {
    format = 'webp';
  } else {
    format = file.content_type === 'image/png' ? 'png' : 'jpeg';
  }

  const variant = {
    w: w ? snapSize(w) : null,
    h: h ? snapSize(h) : null,
    fit,
    q,
    format,
    contentType: OUTPUT_TYPES[format],
    auto: !(requested in OUTPUT_TYPES),
  };
  variant.name = `w${variant.w ?? 0}_h${variant.h ?? 0}_${fit}_q${q}.${format}`;
  return variant;
}

export async function renderVariant(original, variant) {
  let pipeline = sharp(original);
  if (variant.w || variant.h) {
    pipeline = pipeline.resize({
      width: variant.w ?? undefined,
      height: variant.h ?? undefined,
      fit: variant.fit,
      withoutEnlargement: true,
    });
  }
  return encode(pipeline, variant.format, variant.q).toBuffer();
}

/** Small async semaphore so a burst of first-time requests cannot exhaust CPU and memory. */
export function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) {
      return;
    }
    active++;
    const { task, resolve, reject } = queue.shift();
    task().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };
  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    next();
  });
}
