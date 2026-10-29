# Deploy on a server in your network (192.168.1.206)

These steps assume Ubuntu 22.04 or 24.04 and that the server and the devices using it are on
the same local network. Commands run on the server unless a step says otherwise.

End result: anyone on your network opens `http://192.168.1.206:3000`; files live in a
30 GB area under `/srv/blob`; everything restarts on reboot; a backup runs every night.

## 1. Connect to the server

From your Mac:

```bash
ssh <your-user>@192.168.1.206
```

In your router, give the server a fixed address (often called "DHCP reservation") so
`192.168.1.206` never changes. Otherwise saved links break when the address changes.

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
```

```bash
sudo usermod -aG docker $USER
```

Log out and back in so the group change applies, then check:

```bash
docker compose version
```

```bash
sudo systemctl enable docker
```

## 3. Create a 30 GB storage area

Pick one option.

**Option A: you have a spare disk or partition.** Format it and mount it at `/srv/blob`
(replace `/dev/sdb1` with your device; `lsblk` lists them). This erases that disk.

```bash
sudo mkfs.ext4 /dev/sdb1
```

```bash
sudo mkdir -p /srv/blob && echo '/dev/sdb1 /srv/blob ext4 defaults 0 2' | sudo tee -a /etc/fstab && sudo mount -a
```

**Option B: no spare disk.** Create a 30 GB file that acts as a disk. Uploads can never use
more than this, so the server's main disk can never fill up.

```bash
sudo fallocate -l 30G /srv/blob.img && sudo mkfs.ext4 -F /srv/blob.img
```

```bash
sudo mkdir -p /srv/blob && echo '/srv/blob.img /srv/blob ext4 loop,defaults 0 0' | sudo tee -a /etc/fstab && sudo mount -a
```

Then, for either option, create the data folders. The app runs as user id 1000 inside its
container, so its folder must belong to that id:

```bash
sudo mkdir -p /srv/blob/floci /srv/blob/app && sudo chown 1000:1000 /srv/blob/app
```

```bash
df -h /srv/blob
```

## 4. Get the code

```bash
git clone --depth 1 --filter=blob:none --sparse -b claude/intelligent-einstein-2hn5qd https://github.com/riontuscano/floci.git ~/floci-demo
```

```bash
cd ~/floci-demo && git sparse-checkout set examples/blob-storage-demo && cd examples/blob-storage-demo
```

## 5. Configure

```bash
cp .env.example .env
```

Edit `.env` (`nano .env`) and set:

```
APP_PORT=192.168.1.206:3000
FLOCI_DATA=/srv/blob/floci
APP_DATA=/srv/blob/app
MAX_CONCURRENT_RESIZES=2
```

- `APP_PORT=192.168.1.206:3000` makes the app listen on the local network address only. If
  the server also has a public internet address, the app is not exposed there.
- Set `MAX_CONCURRENT_RESIZES` to about the number of CPU cores (`nproc` prints it).

## 6. Start

```bash
docker compose up -d --build
```

```bash
docker compose ps
```

Both services should show `(healthy)` within a minute. `floci` must show no `0.0.0.0` port.

```bash
curl http://192.168.1.206:3000/healthz
```

## 7. Firewall

Allow SSH, then turn the firewall on:

```bash
sudo ufw allow OpenSSH && sudo ufw enable
```

Docker manages its own firewall rules for published ports, so `ufw` rules do not
restrict port 3000. What protects the app is:

1. `APP_PORT=192.168.1.206:3000`, which binds only to the local network address.
2. Your router: do **not** add a port forward for 3000. Then nothing outside your network can reach it.

## 8. Test from another device

On a phone or laptop connected to the same Wi-Fi or LAN, open:

```
http://192.168.1.206:3000
```

Upload a photo. The link it gives looks like `http://192.168.1.206:3000/files/<id>.jpg` and
works from any device on the network.

## 9. Nightly backup

The script stops the containers for a few seconds, archives `/srv/blob`, starts them again
and keeps 7 days of archives.

```bash
chmod +x scripts/backup.sh && sudo mkdir -p /srv/backups/blob && sudo chown $USER /srv/backups/blob
```

Run it once to check:

```bash
./scripts/backup.sh
```

Schedule it for 02:30 every night:

```bash
(crontab -l 2>/dev/null; echo "30 2 * * * cd $PWD && ./scripts/backup.sh >> /srv/backups/blob/backup.log 2>&1") | crontab -
```

`/srv/backups/blob` is on the same machine. Copy the archives to another machine or an
external disk regularly, or a failed disk loses both the data and the backups.

To restore an archive:

```bash
docker compose stop && sudo tar -xzf /srv/backups/blob/blob-<date>.tar.gz -C /srv/blob && docker compose start
```

## 10. Everyday operations

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Health | `curl http://192.168.1.206:3000/healthz` |
| App logs | `docker compose logs -f app` |
| Disk used | `df -h /srv/blob` |
| Restart | `docker compose restart` |
| Stop | `docker compose down` (data is kept) |
| Update code | `git pull && docker compose up -d --build` |

Containers restart automatically after a crash or a reboot (`restart: unless-stopped`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| App keeps restarting, logs say `SQLITE_CANTOPEN` or `permission denied` | `sudo chown 1000:1000 /srv/blob/app` |
| Page does not open from other devices | Check `docker compose ps`, that the device is on the same network, and that the server's address is still `192.168.1.206` (`ip -4 addr`) |
| Upload fails with "at most 15 MB" | Raise `MAX_UPLOAD_MB` in `.env`, then `docker compose up -d` |
| Disk full | `df -h /srv/blob`; delete files in the gallery, or grow the storage area |
| "Copy link" does nothing | Use a current browser; the page falls back to the older copy method on plain `http` |
