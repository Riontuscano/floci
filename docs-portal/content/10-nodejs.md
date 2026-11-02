---
title: Node.js / TypeScript
section: Language Guides
order: 10
summary: Use AWS SDK for JavaScript v3 against Floci, with Express and Fastify examples.
---

# Node.js / TypeScript

## Install the SDK clients you need

```bash
npm install @aws-sdk/client-s3 @aws-sdk/client-sqs @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

## Create a shared client config

Keep the Floci-specific bits in one module. When `AWS_ENDPOINT_URL` is unset (production), the SDK talks to real AWS.

```javascript
// src/aws.js
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const endpoint = process.env.AWS_ENDPOINT_URL;
const isLocal = Boolean(endpoint);

const base = {
  region: process.env.AWS_REGION ?? "us-east-1",
  ...(isLocal && {
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
    },
  }),
};

export const s3 = new S3Client({ ...base, forcePathStyle: isLocal });
export const sqs = new SQSClient(base);
export const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(base));
```

## Use it like normal AWS

```javascript
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { SendMessageCommand, GetQueueUrlCommand } from "@aws-sdk/client-sqs";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { s3, sqs, dynamo } from "./aws.js";

await s3.send(new PutObjectCommand({ Bucket: "uploads", Key: "hello.txt", Body: "hi" }));

const obj = await s3.send(new GetObjectCommand({ Bucket: "uploads", Key: "hello.txt" }));
console.log(await obj.Body.transformToString());

const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: "orders" }));
await sqs.send(new SendMessageCommand({ QueueUrl, MessageBody: JSON.stringify({ id: 1 }) }));

await dynamo.send(new PutCommand({ TableName: "users", Item: { pk: "user#1", name: "Ada" } }));
```

Always look up queue URLs with `GetQueueUrl` (or read them from config) instead of hard-coding `localhost`, so they work from inside Docker too.

## Fastify plugin example

```javascript
// plugins/aws.js
import fp from "fastify-plugin";
import { s3, sqs, dynamo } from "../aws.js";

export default fp(async (app) => {
  app.decorate("aws", { s3, sqs, dynamo });
  app.addHook("onClose", async () => {
    s3.destroy();
    sqs.destroy();
    dynamo.destroy();
  });
});
```

```javascript
// routes/upload.js
import { PutObjectCommand } from "@aws-sdk/client-s3";

export default async function (app) {
  app.post("/upload/:key", async (req) => {
    await app.aws.s3.send(new PutObjectCommand({
      Bucket: process.env.UPLOAD_BUCKET ?? "uploads",
      Key: req.params.key,
      Body: JSON.stringify(req.body),
    }));
    return { stored: req.params.key };
  });
}
```

## Express example

```javascript
import express from "express";
import { ListBucketsCommand } from "@aws-sdk/client-s3";
import { s3 } from "./aws.js";

const app = express();
app.get("/buckets", async (_req, res) => {
  const { Buckets = [] } = await s3.send(new ListBucketsCommand({}));
  res.json(Buckets.map((b) => b.Name));
});
app.listen(3000);
```

## Pre-signed URLs for the browser

```javascript
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";

const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: "uploads", Key: "avatar.png" }), { expiresIn: 300 });
```

The browser must be able to reach the host inside the URL. If your server uses `http://floci:4566` inside Docker, create a second client for signing with a browser-reachable endpoint such as `http://localhost:4566`.

## Tests with Testcontainers

```bash
npm install --save-dev @floci/testcontainers
```

```javascript
import { FlociContainer } from "@floci/testcontainers";

const floci = await new FlociContainer().start();
process.env.AWS_ENDPOINT_URL = floci.getEndpoint();
// ... run tests ...
await floci.stop();
```
