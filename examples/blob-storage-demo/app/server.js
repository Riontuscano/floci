import { randomUUID } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

const BUCKET = process.env.S3_BUCKET || 'demo-uploads';
const PORT = Number(process.env.PORT || 3000);

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:4566',
  region: process.env.AWS_REGION || 'us-east-1',
  forcePathStyle: true,
});

const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype in ALLOWED_TYPES),
});

async function ensureBucket() {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
      return;
    } catch (err) {
      if (err.$metadata?.httpStatusCode === 404) {
        await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
        console.log(`Created bucket ${BUCKET}`);
        return;
      }
      console.log(`Waiting for Floci (attempt ${attempt}): ${err.name}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('Floci S3 is not reachable');
}

const app = express();
app.use(express.static('public'));

app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Send a JPEG, PNG, WEBP or PDF up to 10 MB in the "file" field.' });
  }

  const id = randomUUID() + ALLOWED_TYPES[req.file.mimetype];
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: id,
    Body: req.file.buffer,
    ContentType: req.file.mimetype,
    Metadata: { 'original-name': encodeURIComponent(req.file.originalname) },
  }));

  const link = `${req.protocol}://${req.get('host')}/files/${id}`;
  res.json({ id, link, size: req.file.size, type: req.file.mimetype });
});

// The "hosted link". The browser never talks to Floci; this route fetches the object and
// streams it back. In a real site, check the logged-in user's permission here first.
app.get('/files/:id', async (req, res) => {
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: req.params.id }));
    res.set('Content-Type', obj.ContentType || 'application/octet-stream');
    if (obj.ContentLength !== undefined) {
      res.set('Content-Length', String(obj.ContentLength));
    }
    res.set('Cache-Control', 'private, max-age=3600');
    obj.Body.pipe(res);
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return res.status(404).send('File not found');
    }
    console.error('Failed to read file', req.params.id, err);
    res.status(500).send('Storage error');
  }
});

await ensureBucket();
app.listen(PORT, () => console.log(`Demo running on http://localhost:${PORT}`));
