# Floci file storage demo

Upload photos and PDFs, store them in Floci S3, and get a link back. Images can be resized
through the link, and the page picks a smaller or larger image depending on network speed.

```
Browser ──> app (Node, port 3000) ──> Floci S3   (file bytes: originals + resized copies)
                     │
                     └──> SQLite                 (file list: name, size, type, date)
```

- The browser never talks to Floci. Floci has no published port.
- Floci keeps only file bytes. SQLite keeps the list of files, so listing is fast.
- Originals are never changed. Resized copies are made from them on first request and cached.

## Run

```bash
docker compose up -d --build
```

Open http://localhost:3000.

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
| Health check | `GET /healthz` reports app, database and storage status |

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

Upload from the command line:

```bash
curl -F "files=@photo.jpg" -F "files=@scan.pdf" http://localhost:3000/api/files
```

Errors: `413` file too large, `415` wrong type (reported per file), `404` unknown file.

## Settings

Copy `.env.example` to `.env` to change anything. All values are optional.

| Setting | Default | Meaning |
|---|---|---|
| `APP_PORT` | `3000` | Port on the host. `192.168.1.206:3000` binds to one network address only |
| `FLOCI_DATA`, `APP_DATA` | Docker volumes | Where data lives. Use host folders on a server, see DEPLOY.md |
| `MAX_UPLOAD_MB` | `15` | Max size per file |
| `MAX_FILES_PER_REQUEST` | `10` | Max files per upload |
| `ALLOWED_SIZES` | `160,320,640,1024,1600` | Sizes the server may generate |
| `MAX_CONCURRENT_RESIZES` | `2` | Parallel resize jobs |

## Code layout

| File | Job |
|---|---|
| `app/src/server.js` | Routes and error handling |
| `app/src/images.js` | Type detection, rotation and metadata removal, resizing |
| `app/src/storage.js` | Talks to Floci with the AWS SDK |
| `app/src/db.js` | SQLite file list (Node's built-in `node:sqlite`) |
| `app/src/config.js` | Reads settings from environment variables |
| `app/public/` | The web page |

## Limits of this demo

- No login. Anyone who can reach the app can see and delete files. File ids are random
  UUIDs, so links cannot be guessed, but the gallery lists everything.
- Floci must stay off the network: its S3 auth checks only the access key id, not the
  signature. Keep the `floci` service without a `ports:` entry.
- PDFs are stored and served as they are, without previews.
