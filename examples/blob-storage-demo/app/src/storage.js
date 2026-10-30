import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { config } from './config.js';

const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: true,
  // Idle timeout rather than a total limit, so large downloads to slow clients are not cut off.
  requestHandler: { connectionTimeout: 5000, socketTimeout: 30000 },
});

const Bucket = config.s3.bucket;

const isNotFound = (err) =>
  err?.name === 'NoSuchKey' || err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404;

export async function ensureBucket({ attempts = 30, delayMs = 2000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket }));
      return;
    } catch (err) {
      if (isNotFound(err)) {
        await s3.send(new CreateBucketCommand({ Bucket }));
        console.log(`Created bucket ${Bucket}`);
        return;
      }
      console.log(`Waiting for S3 at ${config.s3.endpoint} (attempt ${attempt}): ${err.name}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(`S3 is not reachable at ${config.s3.endpoint}`);
}

export async function pingStorage() {
  await s3.send(new HeadBucketCommand({ Bucket }));
}

export async function putObject(key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
}

/** Returns { body: Readable, contentType, contentLength } or null when the key does not exist. */
export async function getObject(key) {
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
    return { body: obj.Body, contentType: obj.ContentType, contentLength: obj.ContentLength };
  } catch (err) {
    if (isNotFound(err)) {
      return null;
    }
    throw err;
  }
}

export async function getObjectBuffer(key) {
  const obj = await getObject(key);
  if (!obj) {
    return null;
  }
  return Buffer.from(await obj.body.transformToByteArray());
}

export async function deletePrefix(prefix) {
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key }));
    if (keys.length > 0) {
      await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys, Quiet: true } }));
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

export async function deleteKeys(keys) {
  if (keys.length === 0) {
    return;
  }
  await s3.send(new DeleteObjectsCommand({
    Bucket,
    Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
  }));
}
