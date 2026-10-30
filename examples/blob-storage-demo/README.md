# Floci file storage demo

Upload photos and PDFs, store them in Floci S3, and get a link back. Images can be resized
through the link, and the page picks a smaller or larger image depending on network speed.
Every upload and delete is published as an event through Floci SNS and SQS to background
workers.

```
Browser ──> app (Node, port 6100) ──> Floci S3   (file bytes: originals + resized copies)
                │                ──> Floci SNS ──> Floci SQS queues ──> workers (in the app)
                └──> SQLite      (file list, outbox, audit log, alerts)
```

- The browser never talks to Floci. Floci has no published port.
- Floci keeps only file bytes. SQLite keeps the list of files, so listing is fast.
- Originals are never changed. Resized copies are made from them on first request and cached.

## Run

```bash
docker compose up -d --build
```

Open http://localhost:6100.

To deploy on a server in your network, follow [DEPLOY.md](DEPLOY.md).

## Features

| Feature | Details |
|---|---|
| Drag and drop, many files at once | Up to 10 per request, two uploads run in parallel, each with a progress bar |
| Compression in the browser | JPEG and WEBP photos are shrunk to at most 2048px before upload (can be turned off) |
| Rotation fix and metadata removal | Applies the phone's rotation, then removes EXIF data such as GPS location |
| Real type check | Reads the file's bytes; a renamed `.exe` is rejected even if called `.jpg` |
| Gallery | Thumbnails with blurred placeholders, size, dimensions, copy link, open, delete |
| Resizing through the link | `?w=`, `?h=`, `?fit=`, `?q=`, `?format=` (see below) |
| Network-aware viewer | Picks low, medium or high quality from the browser's network info |
| Events (SNS and SQS) | Uploads and deletes fan out to three queues with background workers. See below |
| Events page | `/events.html`: queue sizes, worker status, dead letters, alerts, audit log |
| Health check | `GET /healthz` reports database, storage and messaging status within 3 seconds |

## Image links

```
/files/<id>.jpg                              original
/files/<id>.jpg?w=320                        320px wide
/files/<id>.jpg?w=200&h=200&fit=cover        200x200 square, cropped
/files/<id>.jpg?w=640&q=60&format=webp       640px WEBP at quality 60
```

| Option | Values | Default |
|---|---|---|
| `w`, `h` | Pixels. Snapped up to the next allowed size: 160, 320, 640, 1024, 1600 | Original size |
| `fit` | `inside` keeps the whole image, `cover` crops to fill the box | `inside` |
| `q` | 30 to 90, rounded to the nearest 5 | 75 |
| `format` | `webp`, `jpeg`, `png`, or `auto` (WEBP when the browser supports it) | `auto` |
| `download` | Present means "download instead of showing" | Not set |

Rules that keep the server safe:

- Sizes snap to a fixed list, so nobody can make the server store thousands of odd sizes.
- Each size is generated once, stored in Floci under `variants/<id>/`, and served from there afterwards.
- At most `MAX_CONCURRENT_RESIZES` images are resized at the same time.
- Images are never enlarged beyond their original size.
- If the browser sends `Save-Data: on` (data saver mode), quality drops to 50.

Links never change, so responses carry `Cache-Control: immutable` and an `ETag`.

## How the page picks image quality

| Layer | How | Browsers |
|---|---|---|
| `srcset` on thumbnails | The browser downloads only the size that fits the screen | All |
| Network check | `navigator.connection`: 2G or data saver gives Low, 3G gives Medium, 4G gives High | Chrome, Edge, Android. Safari and Firefox fall back to screen size |
| Blurred placeholder | A 24px preview stored in the database shows instantly | All |

You can also choose Low, Medium or High by hand, in the page and in the viewer.

## Events: SNS and SQS

```
upload / delete
   │  same database transaction
   ▼
outbox table ──dispatcher──> SNS topic "file-events" ──┬──> SQS "thumbnails" ──> thumbnail worker
                                                       ├──> SQS "audit-log"  ──> audit worker
                                                       └──> SQS "alerts"     ──> alert worker
                                       each queue has a dead-letter queue: "<name>-dlq"
```

| Worker | What it does |
|---|---|
| `thumbnails` | Creates the gallery thumbnails (`THUMBNAIL_SIZES`, default 320 and 640) right after an image upload, so the first gallery view is instant |
| `audit-log` | Stores every upload and delete with time, file, size and the uploader's address |
| `alerts` | Raises an alert when a file is deleted or an upload is larger than `ALERT_LARGE_FILE_MB`. Business rules such as "late check-in" go here |

An event looks like this, and is delivered to each queue as-is (SNS raw message delivery):

```json
{
  "id": "6f0d…",
  "type": "file.uploaded",
  "time": "2026-10-30T09:02:00.000Z",
  "data": { "fileId": "3f1c…", "name": "selfie.jpg", "contentType": "image/jpeg", "size": 284113, "clientIp": "192.168.1.57" }
}
```

How it stays reliable:

| Problem | Handling |
|---|---|
| App crashes or Floci is down right after an upload | The event is saved in the `outbox` table in the same transaction as the file. A dispatcher publishes it when SNS is reachable, so no event is lost |
| A worker fails on a message | The message is not deleted. It comes back after 5, 10, then 20 seconds |
| A message keeps failing | After `MAX_RECEIVE_COUNT` attempts (default 3) SQS moves it to the queue's dead-letter queue. "Retry dead letters" on the Events page moves it back |
| A message is delivered twice (SQS is at-least-once) | Workers are safe to repeat: thumbnails are overwritten, audit entries and alerts are keyed by event id |
| Floci stops answering | Every call has a timeout, so nothing hangs. Workers keep retrying every 5 seconds |
| Restarts | Floci stores queues, subscriptions and waiting messages on disk (`wal` mode). The app recreates missing queues and subscriptions on start, without duplicates |

On the Events page, **Retry dead letters** sends parked messages back to their queue (for
example after fixing a bug), and **Clear dead letters** permanently discards messages that can
never succeed.

## API

| Method and path | Purpose |
|---|---|
| `POST /api/files` | Upload one or more files in the `files` field. Returns stored files and per-file errors |
| `GET /api/files?limit=24&cursor=...` | List files, newest first, page by page |
| `GET /api/files/<id>/meta` | Details of one file |
| `DELETE /api/files/<id>` | Delete the original and all its resized copies |
| `GET /files/<id>.<ext>?...` | The file link |
| `GET /healthz` | Status of app, database and storage |
| `GET /api/config` | Limits and allowed sizes, used by the page |
| `GET /api/messaging` | Queue sizes, dead letters, worker and outbox status |
| `GET /api/events?limit=50` | Recent audit log entries and alerts |
| `POST /api/queues/<thumbnails\|audit\|alerts>/redrive` | Move dead-letter messages back to the queue |
| `POST /api/queues/<thumbnails\|audit\|alerts>/purge-dead-letters` | Permanently discard a queue's dead-letter messages |

Upload from the command line:

```bash
curl -F "files=@photo.jpg" -F "files=@scan.pdf" http://localhost:6100/api/files
```

Errors: `413` file too large, `415` wrong type (reported per file), `404` unknown file.

## Settings

Copy `.env.example` to `.env` to change anything. All values are optional.

| Setting | Default | Meaning |
|---|---|---|
| `APP_PORT` | `6100` | Port on the host. `192.168.1.206:6100` binds to one network address only |
| `ALLOWED_NETWORKS` | Empty (everyone) | Comma-separated address ranges allowed to use the app, e.g. `192.168.1.0/24`. Checked against the real source address, not headers |
| `FLOCI_DATA`, `APP_DATA` | Docker volumes | Where data lives. Use host folders on a server, see DEPLOY.md |
| `STORAGE_QUOTA_GB` | `0` (no limit) | Uploads are refused once stored originals reach this size. Resized copies add about 20% on top |
| `MAX_UPLOAD_MB` | `15` | Max size per file |
| `MAX_FILES_PER_REQUEST` | `10` | Max files per upload |
| `ALLOWED_SIZES` | `160,320,640,1024,1600` | Sizes the server may generate |
| `MAX_CONCURRENT_RESIZES` | `2` | Images processed at the same time (uploads and resizes) |
| `FLOCI_MEMORY`, `APP_MEMORY` | `1g`, `512m` | Hard memory caps per container |
| `FLOCI_CPUS`, `APP_CPUS` | `1.0`, `1.0` | CPU caps per container |
| `THUMBNAIL_SIZES` | `320,640` | Square thumbnails the worker creates after each image upload |
| `MAX_RECEIVE_COUNT` | `3` | Attempts before a message moves to the dead-letter queue |
| `ALERT_LARGE_FILE_MB` | `5` | Uploads above this size raise an alert |

Both containers also rotate their logs (3 files of 10 MB each), so logs cannot fill the disk.

## Code layout

| File | Job |
|---|---|
| `app/src/server.js` | Routes and error handling |
| `app/src/images.js` | Type detection, rotation and metadata removal, resizing |
| `app/src/storage.js` | Talks to Floci with the AWS SDK |
| `app/src/db.js` | SQLite file list (Node's built-in `node:sqlite`) |
| `app/src/network.js` | Allows only the address ranges in `ALLOWED_NETWORKS` |
| `app/src/messaging.js` | Creates the SNS topic, SQS queues, dead-letter queues and subscriptions; publish, receive, redrive |
| `app/src/outbox.js` | Publishes saved events to SNS |
| `app/src/workers.js` | The three queue workers and their retry handling |
| `app/src/variants.js` | Creates and caches resized images, shared by routes and the thumbnail worker |
| `app/src/config.js` | Reads settings from environment variables |
| `app/public/` | The Files page (`index.html`) and the Events page (`events.html`) |

## Limits of this demo

- No login. Anyone allowed by `ALLOWED_NETWORKS` can see and delete files. File ids are
  random UUIDs, so links cannot be guessed, but the gallery lists everything.
- Floci must stay off the network: its S3 auth checks only the access key id, not the
  signature. Keep the `floci` service without a `ports:` entry.
- PDFs are stored and served as they are, without previews.
