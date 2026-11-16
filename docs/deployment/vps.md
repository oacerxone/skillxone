# Mode A: a single VPS

One Linux server runs the web app under systemd behind Caddy or Nginx. A systemd timer runs the worker every 10 minutes. SQLite lives in `/opt/skillxone/data`. A 1 GB server is enough for the catalog sizes measured so far ([measurements.md](measurements.md)).

The commands below assume Debian or Ubuntu and a sudo-capable admin account. Steps marked **as skillxone** run as the service user.

## 1. Install Node.js and create the service user

Install Node.js 22.12 or later from your distribution or [nodejs.org](https://nodejs.org/en/download). Check the version:

```bash
node --version
```

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin skillxone && sudo install -d -o skillxone -g skillxone /opt/skillxone
```

If `better-sqlite3` has no prebuilt binary for your platform, `pnpm install` compiles it, which needs build tools:

```bash
sudo apt-get install -y python3 make g++ git
```

## 2. Get the code and install (as skillxone)

```bash
sudo -u skillxone -s /bin/bash
```

```bash
git clone https://github.com/OWNER/skillxone.git /opt/skillxone && cd /opt/skillxone
```

Replace `OWNER/skillxone` with the repository you deploy from, and check out a release tag (`git checkout v0.1.0-beta`) rather than `main`. pnpm is provided by corepack; keeping its cache inside `/opt/skillxone` lets the hardened systemd units (which hide home directories) find it:

```bash
export COREPACK_HOME=/opt/skillxone/.corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0 PATH=/opt/skillxone/.bin:$PATH && corepack enable --install-directory /opt/skillxone/.bin
```

```bash
pnpm install --frozen-lockfile
```

## 3. Configure (as skillxone)

```bash
cp .env.example .env && chmod 600 .env
```

Edit `.env`:

- `NODE_ENV=production`
- `SITE_URL=https://skills.example.org` (your public address)
- `TRUST_PROXY=1` (the app sits behind Caddy or Nginx)
- `GITHUB_TOKEN=` a fine-grained token with public read-only access (raises the GitHub rate limit from 60 to 5,000 requests an hour)
- Optional: `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` and `ADMIN_GITHUB_IDS` for the admin dashboard

## 4. Create the database and build (as skillxone)

```bash
pnpm worker migrate && pnpm worker seed
```

```bash
pnpm build
```

Check that it serves before adding systemd:

```bash
pnpm --filter @skillxone/web exec next start -H 127.0.0.1 -p 3000
```

In another shell, `curl http://127.0.0.1:3000/api/health` should print `{"status":"ok","database":"ok"}`. Stop the server with Ctrl-C and leave the skillxone shell (`exit`).

## 5. systemd

Copy the units from `deploy/systemd/` and start them:

```bash
sudo cp /opt/skillxone/deploy/systemd/skillxone-* /etc/systemd/system/
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now skillxone-web.service skillxone-worker.timer skillxone-backup.timer
```

```bash
systemctl status skillxone-web.service
```

The web unit listens on 127.0.0.1:3000 only. The worker unit runs `worker schedule` then `worker drain` every 10 minutes and exits, so it uses no memory between runs. The units run `/opt/skillxone/.bin/pnpm`, the corepack shim created in step 2. If Node.js itself is installed outside `/usr/local/bin` or `/usr/bin`, add its directory to the units' `PATH`.

The first worker run discovers the seed repositories, indexes them and scans every skill. Follow it with:

```bash
journalctl -u skillxone-worker.service -f
```

## 6. Reverse proxy

**Caddy** (TLS is automatic): copy `deploy/caddy/Caddyfile` to `/etc/caddy/Caddyfile`, replace the domain, then `sudo systemctl reload caddy`.

**Nginx**: copy `deploy/nginx/skillxone.conf` to `/etc/nginx/sites-available/`, replace the domain, get a certificate (for example with certbot), enable the site, then `sudo nginx -t && sudo systemctl reload nginx`.

Both pass the client address in `X-Forwarded-For` in a form the app can trust with `TRUST_PROXY=1`.

## 7. Logs

Logs go to the systemd journal. Cap its size in `/etc/systemd/journald.conf`:

```ini
[Journal]
SystemMaxUse=200M
```

## 8. Backups

The backup timer writes a verified copy of the database to `/opt/skillxone/data/backups/` every night and keeps 14 days. Copy that directory off the server too. Restoring is covered in [backup.md](backup.md).

## 9. Updating

```bash
sudo -u skillxone -s /bin/bash
```

```bash
cd /opt/skillxone && export COREPACK_HOME=/opt/skillxone/.corepack PATH=/opt/skillxone/.bin:$PATH && pnpm worker backup && git fetch --tags && git checkout v0.1.1
```

```bash
pnpm install --frozen-lockfile && pnpm worker migrate && pnpm build
```

Then, from the admin account:

```bash
sudo systemctl restart skillxone-web.service
```

## 10. Rolling back

Check out the previous tag, `pnpm install --frozen-lockfile && pnpm build`, and restart the web unit. If the newer release ran a migration, also restore the backup taken before the update (migrations are not reversed automatically):

```bash
sudo systemctl stop skillxone-web.service skillxone-worker.timer
```

```bash
sudo -u skillxone sh -c 'cd /opt/skillxone && COREPACK_HOME=/opt/skillxone/.corepack /opt/skillxone/.bin/pnpm worker restore data/backups/<file>.db --yes'
```

```bash
sudo systemctl start skillxone-web.service skillxone-worker.timer
```

## Hosts without systemd

Panels that run Node.js apps (Passenger-style) can run `pnpm --filter @skillxone/web exec next start -p $PORT` as the app command, with cron entries for `pnpm worker schedule && pnpm worker drain` every 10 minutes and `pnpm worker backup` nightly. PHP-only shared hosting cannot run the server or the worker; use [Mode C](static.md) there.
