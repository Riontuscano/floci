const int = (name, fallback) => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
};

const list = (name, fallback) =>
  (process.env[name] ?? fallback)
    .split(',')
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

export const config = {
  port: int('PORT', 6100),
  // Comma-separated CIDR ranges allowed to use the app, e.g. "192.168.1.0/24". Empty allows all.
  allowedNetworks: (process.env.ALLOWED_NETWORKS ?? '').split(',').map((v) => v.trim()).filter(Boolean),
  dbPath: process.env.DB_PATH ?? './data/files.db',

  s3: {
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:4566',
    region: process.env.AWS_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'demo-uploads',
  },

  upload: {
    maxFileMb: int('MAX_UPLOAD_MB', 15),
    maxFilesPerRequest: int('MAX_FILES_PER_REQUEST', 10),
    // Total size of stored originals after which uploads are refused. 0 disables the limit.
    // Resized copies are not counted, so leave headroom (about 20%) below the real free space.
    quotaBytes: Math.round(Number.parseFloat(process.env.STORAGE_QUOTA_GB ?? '0') * 1024 ** 3) || 0,
  },

  images: {
    // Only these sizes are ever generated; any requested w/h snaps up to the next one.
    // Keeps the number of stored variants per image small and bounded.
    allowedSizes: list('ALLOWED_SIZES', '160,320,640,1024,1600'),
    defaultQuality: int('DEFAULT_QUALITY', 75),
    saveDataQuality: int('SAVE_DATA_QUALITY', 50),
    originalQuality: int('ORIGINAL_QUALITY', 90),
    maxConcurrentResizes: int('MAX_CONCURRENT_RESIZES', 2),
  },
};
