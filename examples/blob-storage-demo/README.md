# Floci blob storage demo

Upload an image or PDF, store it in Floci S3, and get back a link to view it.

```
Browser ──> app (Node, port 3000) ──> Floci S3 (private Docker network, no published port)
```

The browser never talks to Floci. The app stores the file with the AWS SDK and serves it
back at `/files/<id>`. In a real site, that route is where you check that the logged-in user
may see the file.

## Run

```bash
docker compose up -d --build
```

Open http://localhost:3000, pick an image, click **Upload**, and open the link it returns.

## Try it from the command line

```bash
curl -F "file=@photo.jpg;type=image/jpeg" http://localhost:3000/upload
```

The response contains the link, for example
`{"id":"3f1c...png","link":"http://localhost:3000/files/3f1c...png",...}`.

## What is stored where

| Thing | Where |
|---|---|
| File bytes | Docker volume `floci-data`, under `/app/data/s3/` in the Floci container |
| Object index | Same volume, in `wal` storage mode (append-only log, survives restarts) |

Restarting the containers keeps the files. `docker compose down -v` deletes them.

## Limits of this demo

- No login. Anyone who can reach port 3000 and knows a file id can view it. File ids are
  random UUIDs, so they cannot be guessed.
- Accepts JPEG, PNG, WEBP and PDF up to 10 MB.
- Floci must stay off the public internet: its S3 auth checks only the access key id, not
  the signature. Keep the `floci` service without a `ports:` entry.
