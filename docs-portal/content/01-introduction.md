---
title: Introduction
section: Getting Started
order: 1
summary: What Floci is and how to use it as a shared AWS service for your apps.
---

# Using Floci as a service for your apps

Floci is a local AWS emulator. It listens on **one port (`4566`)** and speaks the real AWS wire protocols, so any AWS SDK, the AWS CLI, Terraform, or CDK can talk to it as if it were AWS.

That makes it a good fit for a **shared backing service**: run one Floci instance and point every app you build (APIs, workers, frontends, test suites) at it instead of a real AWS account.

## How it fits into your project

```text
 +-------------+     +-------------+     +-------------+
 |   web-api   |     |   worker    |     |  test suite |
 | (Node, Py,  |     | (Java, Go)  |     | (CI / local)|
 |  Java ...)  |     |             |     |             |
 +------+------+     +------+------+     +------+------+
        |  AWS SDK          |  AWS SDK          |  AWS SDK
        +---------+---------+---------+---------+
                  |  http://floci:4566
           +------v------+
           |    Floci    |  S3, SQS, SNS, DynamoDB, Lambda,
           |  port 4566  |  Secrets Manager, SSM, Cognito ...
           +-------------+
```

Your application code does not change. Only the **endpoint** and **credentials** change:

| Setting | Real AWS | Floci |
|---|---|---|
| Endpoint | resolved by the SDK | `http://localhost:4566` (or `http://floci:4566` in Docker) |
| Region | your region | any region, usually `us-east-1` |
| Credentials | IAM keys | any non-empty value, for example `test` / `test` |
| Account ID | your account | `000000000000` by default |

## The three steps

1. **Run Floci** next to your app: Docker, Docker Compose, or the Floci CLI. See [Quick Start](#/docs/quick-start).
2. **Point your SDK at it**, ideally with the standard `AWS_ENDPOINT_URL` environment variable so the same code runs against real AWS in production. See [Configure your app](#/docs/configure-your-app).
3. **Create the resources** your app needs (buckets, queues, tables) with init hooks, the CLI, or IaC. See [Seeding resources](#/docs/seeding-resources).

## Pick your language

- [Node.js / TypeScript](#/docs/nodejs)
- [Python](#/docs/python)
- [Java / Spring Boot](#/docs/java)
- [Go](#/docs/go)

## Using this portal programmatically

Everything you read here is also served by this portal's Fastify API, so you can link to it or pull it into your own tooling. See [Portal API reference](#/docs/portal-api).
