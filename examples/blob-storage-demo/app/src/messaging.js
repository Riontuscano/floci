import {
  SNSClient,
  CreateTopicCommand,
  ListSubscriptionsByTopicCommand,
  PublishCommand,
  SubscribeCommand,
} from '@aws-sdk/client-sns';
import {
  SQSClient,
  ChangeMessageVisibilityCommand,
  CreateQueueCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { config } from './config.js';

const clientConfig = {
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  // Fail instead of hanging when Floci does not answer. Long polls wait up to 20s, so 30s.
  requestHandler: { connectionTimeout: 5000, requestTimeout: 30000, throwOnRequestTimeout: true },
};
const sns = new SNSClient(clientConfig);
// Always talk to the configured endpoint, even if a queue URL names another host.
const sqs = new SQSClient({ ...clientConfig, useQueueUrlAsEndpoint: false });

/** name -> { url, arn, dlqUrl, dlqArn }. Filled by setupMessaging(). */
export const queues = {};
let topicArn;

async function queueArn(url) {
  const { Attributes } = await sqs.send(new GetQueueAttributesCommand({
    QueueUrl: url,
    AttributeNames: ['QueueArn'],
  }));
  return Attributes.QueueArn;
}

/** Creates a queue with a dead-letter queue. Safe to run on every start. */
async function ensureQueue(name) {
  const dlq = await sqs.send(new CreateQueueCommand({
    QueueName: `${name}-dlq`,
    Attributes: { MessageRetentionPeriod: String(14 * 24 * 3600) },
  }));
  const dlqArn = await queueArn(dlq.QueueUrl);

  const main = await sqs.send(new CreateQueueCommand({ QueueName: name }));
  // Attributes are applied separately so a restart with changed settings updates the queue
  // instead of failing with QueueAlreadyExists.
  await sqs.send(new SetQueueAttributesCommand({
    QueueUrl: main.QueueUrl,
    Attributes: {
      VisibilityTimeout: String(config.events.visibilityTimeoutSeconds),
      ReceiveMessageWaitTimeSeconds: '20',
      RedrivePolicy: JSON.stringify({
        deadLetterTargetArn: dlqArn,
        maxReceiveCount: String(config.events.maxReceiveCount),
      }),
    },
  }));

  return { url: main.QueueUrl, arn: await queueArn(main.QueueUrl), dlqUrl: dlq.QueueUrl, dlqArn };
}

async function existingSubscriptionEndpoints(arn) {
  const endpoints = new Set();
  let token;
  do {
    const page = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: arn, NextToken: token }));
    for (const sub of page.Subscriptions ?? []) {
      endpoints.add(sub.Endpoint);
    }
    token = page.NextToken;
  } while (token);
  return endpoints;
}

/** Creates the topic, every queue with its DLQ, and the topic-to-queue subscriptions. */
export async function setupMessaging() {
  ({ TopicArn: topicArn } = await sns.send(new CreateTopicCommand({ Name: config.events.topicName })));

  for (const [key, name] of Object.entries(config.events.queues)) {
    queues[key] = { name, ...(await ensureQueue(name)) };
  }

  const subscribed = await existingSubscriptionEndpoints(topicArn);
  for (const queue of Object.values(queues)) {
    if (subscribed.has(queue.arn)) {
      continue;
    }
    await sns.send(new SubscribeCommand({
      TopicArn: topicArn,
      Protocol: 'sqs',
      Endpoint: queue.arn,
      // Deliver the published JSON as-is instead of wrapped in an SNS envelope.
      Attributes: { RawMessageDelivery: 'true' },
    }));
    console.log(`Subscribed queue ${queue.name} to topic ${config.events.topicName}`);
  }
  console.log(`Messaging ready: topic ${config.events.topicName}, queues ${Object.values(queues).map((q) => q.name).join(', ')}`);
}

export async function publishEvent(event) {
  await sns.send(new PublishCommand({
    TopicArn: topicArn,
    Message: JSON.stringify(event),
    MessageAttributes: { eventType: { DataType: 'String', StringValue: event.type } },
  }));
}

export async function receive(url, { max = 5, waitSeconds = 20 } = {}) {
  const { Messages } = await sqs.send(new ReceiveMessageCommand({
    QueueUrl: url,
    MaxNumberOfMessages: max,
    WaitTimeSeconds: waitSeconds,
    MessageSystemAttributeNames: ['ApproximateReceiveCount'],
  }));
  return Messages ?? [];
}

export async function ack(url, message) {
  await sqs.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: message.ReceiptHandle }));
}

/** Makes a failed message visible again after a delay, so retries are spaced out. */
export async function retryLater(url, message, seconds) {
  await sqs.send(new ChangeMessageVisibilityCommand({
    QueueUrl: url,
    ReceiptHandle: message.ReceiptHandle,
    VisibilityTimeout: seconds,
  }));
}

export async function sendRaw(url, body) {
  await sqs.send(new SendMessageCommand({ QueueUrl: url, MessageBody: body }));
}

async function depth(url) {
  const { Attributes } = await sqs.send(new GetQueueAttributesCommand({
    QueueUrl: url,
    AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
  }));
  return {
    waiting: Number(Attributes.ApproximateNumberOfMessages ?? 0),
    inFlight: Number(Attributes.ApproximateNumberOfMessagesNotVisible ?? 0),
  };
}

export async function queueStats() {
  const result = {};
  for (const [key, queue] of Object.entries(queues)) {
    const [main, dlq] = await Promise.all([depth(queue.url), depth(queue.dlqUrl)]);
    result[key] = { name: queue.name, ...main, deadLetters: dlq.waiting + dlq.inFlight };
  }
  return result;
}

/** Moves messages from a queue's DLQ back to the queue so they are processed again. */
export async function redrive(key) {
  const queue = queues[key];
  let moved = 0;
  for (let round = 0; round < 20; round++) {
    const batch = await receive(queue.dlqUrl, { max: 10, waitSeconds: 0 });
    if (batch.length === 0) {
      break;
    }
    for (const message of batch) {
      await sendRaw(queue.url, message.Body);
      await ack(queue.dlqUrl, message);
      moved++;
    }
  }
  return moved;
}

export async function purgeDeadLetters(key) {
  await sqs.send(new PurgeQueueCommand({ QueueUrl: queues[key].dlqUrl }));
}

export async function pingMessaging() {
  await depth(Object.values(queues)[0].url);
}
