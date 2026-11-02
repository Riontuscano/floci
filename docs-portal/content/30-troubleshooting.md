---
title: Troubleshooting
section: Reference
order: 30
summary: Fixes for the most common integration problems.
---

# Troubleshooting

## `ECONNREFUSED` or `connection refused`

- Is Floci running? `curl http://localhost:4566/_floci/health`
- Inside Docker, `localhost` is the container itself. Use the Compose service name (`http://floci:4566`) or `http://host.docker.internal:4566`.

## SQS queue URL points to `localhost` from inside a container

Set `FLOCI_HOSTNAME` on the Floci container to its service name so returned URLs such as `QueueUrl` use `http://floci:4566/...`.

## S3: `getaddrinfo ENOTFOUND my-bucket.localhost`

The SDK is using virtual-hosted addressing. Enable path-style (`forcePathStyle: true`, `addressing_style: path`, `.forcePathStyle(true)`, `UsePathStyle = true`).

## `The security token included in the request is invalid` / missing credentials

Floci accepts any non-empty credentials, but the SDK still needs **some** to sign requests. Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

## Resources created by one app are not visible to another

They are probably using different 12-digit access keys and therefore different accounts. Use the same `AWS_ACCESS_KEY_ID` in apps that should share resources.

## Region errors

Any region works, but clients and resources must use the **same** region. Set `AWS_REGION` and `AWS_DEFAULT_REGION` consistently.

## Lambda, RDS, ECS or ElastiCache fail to start

These services start real containers and need the Docker socket:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

Set `FLOCI_SERVICES_DOCKER_NETWORK` to your Compose network so the spawned containers can reach Floci and your app.

## Data disappears after a restart

The default storage mode is `memory`. Use `FLOCI_STORAGE_MODE=hybrid` (or `persistent`) with a volume mounted at `FLOCI_STORAGE_PERSISTENT_PATH`.

## Still stuck?

- Floci docs: https://floci.io/floci/
- Issues: https://github.com/floci-io/floci/issues
