---
title: Python
section: Language Guides
order: 11
summary: Use boto3 with Floci, plus FastAPI and pytest examples.
---

# Python

## Install

```bash
pip install boto3
```

Recent boto3 versions read `AWS_ENDPOINT_URL` automatically. Set it in your environment and create clients as usual.

## A small client factory

```python
# app/aws.py
import os
import boto3
from botocore.config import Config

ENDPOINT = os.getenv("AWS_ENDPOINT_URL")
REGION = os.getenv("AWS_REGION", "us-east-1")

_session = boto3.session.Session(region_name=REGION)

def client(service: str):
    config = Config(s3={"addressing_style": "path"}) if ENDPOINT and service == "s3" else None
    return _session.client(service, endpoint_url=ENDPOINT, config=config)

def resource(service: str):
    return _session.resource(service, endpoint_url=ENDPOINT)
```

## Using it

```python
from app.aws import client, resource

s3 = client("s3")
s3.create_bucket(Bucket="uploads")
s3.put_object(Bucket="uploads", Key="hello.txt", Body=b"hi")

sqs = client("sqs")
queue_url = sqs.create_queue(QueueName="orders")["QueueUrl"]
sqs.send_message(QueueUrl=queue_url, MessageBody='{"id": 1}')

table = resource("dynamodb").Table("users")
table.put_item(Item={"pk": "user#1", "name": "Ada"})

ssm = client("ssm")
ssm.put_parameter(Name="/app/feature-flag", Value="on", Type="String", Overwrite=True)
```

## FastAPI example

```python
from fastapi import FastAPI
from app.aws import client

app = FastAPI()
s3 = client("s3")

@app.get("/files")
def list_files(bucket: str = "uploads"):
    resp = s3.list_objects_v2(Bucket=bucket)
    return [o["Key"] for o in resp.get("Contents", [])]
```

## pytest fixture

```python
# conftest.py
import os
import pytest
import boto3

@pytest.fixture(scope="session", autouse=True)
def floci_env():
    os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")
    os.environ.setdefault("AWS_REGION", "us-east-1")
    os.environ.setdefault("AWS_ACCESS_KEY_ID", "test")
    os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "test")

@pytest.fixture
def bucket():
    s3 = boto3.client("s3")
    s3.create_bucket(Bucket="test-bucket")
    yield "test-bucket"
    for obj in s3.list_objects_v2(Bucket="test-bucket").get("Contents", []):
        s3.delete_object(Bucket="test-bucket", Key=obj["Key"])
    s3.delete_bucket(Bucket="test-bucket")
```

For containers managed by the test itself, use the Floci Testcontainers module: see the [Floci Python Testcontainers docs](https://floci.io/floci/testcontainers/python/).
