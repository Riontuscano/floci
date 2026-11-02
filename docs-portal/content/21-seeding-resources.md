---
title: Seeding resources
section: Running as a Service
order: 21
summary: Create buckets, queues, tables and parameters automatically when Floci starts.
---

# Seeding resources

Your app usually expects some resources to exist. Create them automatically so every developer and CI run starts from the same state.

## Init hooks (recommended)

Floci runs scripts from `/etc/floci/init/<phase>.d` in lexicographical order. The `ready` phase runs once the AWS APIs are up.

```text
my-app/
  compose.yaml
  floci/
    ready.d/
      01-buckets.sh
      02-queues.sh
      03-tables.sh
```

```sh
#!/bin/sh
# floci/ready.d/01-buckets.sh
set -eu
aws s3 mb s3://uploads
aws s3 mb s3://reports
```

```sh
#!/bin/sh
# floci/ready.d/02-queues.sh
set -eu
aws sqs create-queue --queue-name orders-dlq
aws sqs create-queue --queue-name orders \
  --attributes '{"RedrivePolicy":"{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:orders-dlq\",\"maxReceiveCount\":\"3\"}"}'
```

```sh
#!/bin/sh
# floci/ready.d/03-tables.sh
set -eu
aws dynamodb create-table \
  --table-name users \
  --attribute-definitions AttributeName=pk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
aws ssm put-parameter --name /app/feature-flags --type String --value '{"beta":true}' --overwrite
```

Mount the folder and use the **compat** image, which ships the AWS CLI and boto3 preconfigured for `http://localhost:4566`:

```yaml
services:
  floci:
    image: floci/floci:latest-compat
    ports:
      - "4566:4566"
    volumes:
      - ./floci/ready.d:/etc/floci/init/ready.d:ro
```

| Phase | Directory | AWS APIs available |
|---|---|---|
| boot | `boot.d` | No |
| start | `start.d` | Yes |
| ready | `ready.d` | Yes |
| stop | `stop.d` | Yes |

A failing `start` or `ready` script stops Floci, so mistakes surface immediately. Existing LocalStack scripts under `/etc/localstack/init/ready.d` also work unchanged.

## Infrastructure as code

If your project already has Terraform, CDK, or CloudFormation, apply it against Floci:

```hcl
provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true

  endpoints {
    s3       = "http://localhost:4566"
    sqs      = "http://localhost:4566"
    dynamodb = "http://localhost:4566"
  }
}
```

```bash
aws cloudformation deploy --template-file template.yaml --stack-name my-app
```

## From application code

As a last resort, create missing resources at startup, but only in local mode:

```javascript
if (process.env.AWS_ENDPOINT_URL) {
  await s3.send(new CreateBucketCommand({ Bucket: "uploads" })).catch((err) => {
    if (err.name !== "BucketAlreadyOwnedByYou") throw err;
  });
}
```
