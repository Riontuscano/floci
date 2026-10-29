# Deploy on a shared server (192.168.1.206)

This guide is written for a server that **already runs important services**. Nothing here
formats, repartitions or resizes a disk, and nothing changes or restarts your existing
services. Every step says what it touches.

End result:

- Devices on your Wi-Fi open `http://192.168.1.206:6100`. Everyone else is refused.
- Files live in `/srv/blob`, limited by a storage quota.
- The demo can use at most 1.5 GB of RAM and 2 CPU cores in total, so your other services keep theirs.
- Logs rotate, containers restart after reboots, and a nightly backup copies changes to another disk or machine.

Assumes Ubuntu 22.04 or 24.04. Commands run on the server unless a step says otherwise.

## 1. Connect

From your Mac:

```bash
ssh <your-user>@192.168.1.206
```

In your router, give the server a fixed address ("DHCP reservation") so `192.168.1.206`
never changes. Otherwise saved links break.

## 2. Pre-flight checks (read-only, change nothing)

Free disk space. You need the space you want to give the demo, plus room left for your
other services. Keep at least 15 to 20% of the disk free after the demo is full.

```bash
df -h /
```

Free memory. The demo is capped at 1.5 GB (1 GB Floci, 512 MB app); check that this
leaves enough for your services.

```bash
free -h
```

Port 6100 must be unused. No output means it is free:

```bash
sudo ss -ltnp | grep ':6100 '
```

Is Docker already installed?

```bash
docker --version && docker compose version
```

## 3. Docker

**If step 2 showed Docker and Compose versions: skip this step.** Do not run the install
script on a machine that already has Docker: it can upgrade Docker and restart the
containers your important services may be running in.

If Docker is not installed:

```bash
curl -fsSL https://get.docker.com | sudo sh
```

```bash
sudo usermod -aG docker $USER
```

Log out and back in, then check again with `docker compose version`.

Installing Docker adds its own firewall (iptables) chains for container networking. That
is standard and does not change existing rules for your services.

## 4. Storage: two safe options

### Option A (recommended): a folder plus a quota. Touches no disk settings.

This only creates folders. The app itself refuses uploads once `STORAGE_QUOTA_GB` is
reached, so it can never fill the disk.

```bash
sudo mkdir -p /srv/blob/floci /srv/blob/app && sudo chown 1000:1000 /srv/blob/app
```

The app runs as user id 1000 inside its container, so its folder must belong to that id.
In step 6 you set `STORAGE_QUOTA_GB`.

The quota counts originals only. Resized copies add roughly 20%, so set the quota about
20% below the space you want to give: **for 30 GB, set `STORAGE_QUOTA_GB=24`**.

To undo later: `docker compose down` and `sudo rm -rf /srv/blob`.

### Option B: a hard 30 GB limit enforced by the operating system

Use this if you want the limit guaranteed even if the app misbehaves. It creates one
30 GB file and uses it as a separate small disk. Existing disks and partitions are not
touched; it only uses 30 GB of free space.

Check that `/` has at least 30 GB free plus your safety margin (`df -h /`), then:

```bash
sudo fallocate -l 30G /srv/blob.img
```

```bash
sudo mkfs.ext4 -F /srv/blob.img
```

`mkfs` here formats **only the new file `/srv/blob.img`**, nothing else. Then mount it.
The `nofail` option means that if anything is ever wrong with this file, the server still
boots normally:

```bash
sudo mkdir -p /srv/blob && echo '/srv/blob.img /srv/blob ext4 loop,nofail,defaults 0 0' | sudo tee -a /etc/fstab
```

Check the line before relying on it. This must print no errors:

```bash
sudo findmnt --verify
```

```bash
sudo mount /srv/blob && df -h /srv/blob
```

Then create the folders as in Option A:

```bash
sudo mkdir -p /srv/blob/floci /srv/blob/app && sudo chown 1000:1000 /srv/blob/app
```

You can still set `STORAGE_QUOTA_GB=24` so users get a clear "storage is full" message
instead of upload errors.

To undo later: `docker compose down`, `sudo umount /srv/blob`, delete the `/srv/blob.img`
line from `/etc/fstab` (`sudo nano /etc/fstab`), then `sudo rm /srv/blob.img`.

## 5. Get the code

```bash
git clone --depth 1 --filter=blob:none --sparse -b claude/intelligent-einstein-2hn5qd https://github.com/riontuscano/floci.git ~/floci-demo
```

```bash
cd ~/floci-demo && git sparse-checkout set examples/blob-storage-demo && cd examples/blob-storage-demo
```

## 6. Find your Wi-Fi's address range

On a phone or laptop **connected to the Wi-Fi**, look up its IP address (on iPhone:
Settings, Wi-Fi, tap the network; on Android: Wi-Fi, network details). If it looks like
`192.168.1.57`, your Wi-Fi range is `192.168.1.0/24` (every `192.168.1.x` address).

Read "Wi-Fi only: what it can and cannot do" below before relying on it.

## 7. Configure

```bash
cp .env.example .env && nano .env
```

Set these values:

```
APP_PORT=192.168.1.206:6100
ALLOWED_NETWORKS=192.168.1.0/24
FLOCI_DATA=/srv/blob/floci
APP_DATA=/srv/blob/app
STORAGE_QUOTA_GB=24
```

| Setting | What it does |
|---|---|
| `APP_PORT=192.168.1.206:6100` | Listens only on the local network address, on port 6100 |
| `ALLOWED_NETWORKS=192.168.1.0/24` | Only devices with a `192.168.1.x` address can use the app. Others get "Access denied" |
| `STORAGE_QUOTA_GB=24` | Uploads are refused once 24 GB of originals are stored |
| `FLOCI_MEMORY`, `APP_MEMORY` | Hard RAM caps, default 1 GB and 512 MB. A container that hits its cap is restarted; your other services are not affected |
| `FLOCI_CPUS`, `APP_CPUS` | CPU caps, default 1 core each |

## 8. Start

```bash
docker compose up -d --build
```

```bash
docker compose ps
```

Both services should show `(healthy)` within a minute. `floci` must show no `0.0.0.0` port.
The app should show `192.168.1.206:6100->6100/tcp`.

Check the limits applied:

```bash
docker stats --no-stream
```

The `MEM USAGE / LIMIT` column should show `/ 1GiB` for Floci and `/ 512MiB` for the app.

## 9. Test

On a phone **on the Wi-Fi**, open:

```
http://192.168.1.206:6100
```

Upload a photo. Its link looks like `http://192.168.1.206:6100/files/<id>.jpg`.

To check that the restriction works: turn Wi-Fi off on the phone and use mobile data. The
page should not load (the server is not reachable from outside), and any device on another
address range gets "Access denied". Blocked attempts appear in `docker compose logs app`.

## Wi-Fi only: what it can and cannot do

Three layers keep the app on your network:

1. **Your router.** Do not add a port forward for 6100, so the internet cannot reach it.
2. **`APP_PORT=192.168.1.206:6100`.** The app listens only on the local network address.
3. **`ALLOWED_NETWORKS`.** The app checks every request's real source address (it cannot
   be faked with a header) and refuses anything outside the range.

Docker manages its own firewall rules for published ports, so `ufw` rules do **not**
restrict port 6100. Rely on the three layers above.

**Limitation:** most routers put Wi-Fi and wired (cable) devices in the same range, e.g.
both `192.168.1.x`. An address alone cannot tell them apart, so wired devices on your
network are allowed too. If you need strictly Wi-Fi devices only, put the Wi-Fi on its own
range in your router (a separate VLAN or subnet, for example `192.168.2.x`) and set
`ALLOWED_NETWORKS` to that range. A "guest" Wi-Fi is usually isolated and cannot reach the
server at all.

## 10. Nightly backup

The backup copies only new or changed files (rsync) to **another disk or another machine**.
It takes the same space as the data, not one copy per night. Do not back up to the same
disk: that doubles the space used on your shared server and does not protect against a
disk failure.

```bash
sudo apt install -y rsync && chmod +x scripts/backup.sh
```

Run it once, choosing one destination:

```bash
./scripts/backup.sh /mnt/usb/blob-backup
```

```bash
./scripts/backup.sh backup@192.168.1.50:/backups/blob
```

The containers stop for about 15 seconds while it copies. Schedule it for 02:30 every night
(replace the destination with yours):

```bash
(crontab -l 2>/dev/null; echo "30 2 * * * cd $PWD && ./scripts/backup.sh /mnt/usb/blob-backup >> $HOME/blob-backup.log 2>&1") | crontab -
```

To restore:

```bash
docker compose stop && sudo rsync -a /mnt/usb/blob-backup/ /srv/blob/ && docker compose start
```

## 11. Everyday operations

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Health | `curl http://192.168.1.206:6100/healthz` (from a Wi-Fi device) |
| Memory and CPU use | `docker stats --no-stream` |
| App logs | `docker compose logs -f app` |
| Disk used | `du -sh /srv/blob` (Option A) or `df -h /srv/blob` (Option B) |
| Restart the demo only | `docker compose restart` |
| Stop the demo only | `docker compose down` (data is kept) |
| Update code | `git pull && docker compose up -d --build` |

All commands run inside the demo folder affect only this demo's two containers
(`blob-storage-demo-app-1` and `blob-storage-demo-floci-1`), never your other containers.

## Remove the demo completely

```bash
docker compose down --rmi local
```

```bash
sudo rm -rf /srv/blob ~/floci-demo
```

For Option B, also do the undo steps in section 4.

## Troubleshooting

| Symptom | Fix |
|---|---|
| App keeps restarting, logs say `SQLITE_CANTOPEN` or `permission denied` | `sudo chown 1000:1000 /srv/blob/app` |
| App does not start, logs say `Invalid entry in ALLOWED_NETWORKS` | Fix the range in `.env`, e.g. `192.168.1.0/24`, then `docker compose up -d` |
| "Access denied" on a Wi-Fi device | Check the device's IP is inside `ALLOWED_NETWORKS`; `docker compose logs app` shows the blocked address |
| Page does not open at all | `docker compose ps`; the device must be on the same network; the server must still be `192.168.1.206` (`ip -4 addr`) |
| "Storage is full" | Delete files in the gallery, or raise `STORAGE_QUOTA_GB` (and for Option B, check `df -h /srv/blob`) |
| Upload fails with "at most 15 MB" | Raise `MAX_UPLOAD_MB` in `.env`, then `docker compose up -d` |
| "Copy link" does nothing | Use a current browser; the page falls back to an older copy method on plain `http` |
