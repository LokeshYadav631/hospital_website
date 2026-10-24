# Deployment guide

## 1. What you need
* A small Linux server (1 vCPU / 1 GB RAM is plenty) **with persistent disk**, or a PaaS with a volume (Render, Railway, Fly.io).
* Node.js ≥ 22.13 (or Docker).
* A domain name (e.g. `sachkhandhospital.example`) and HTTPS.

## 2. Configure
```bash
cp .env.example .env
```
Set at least:
```
NODE_ENV=production
BASE_URL=https://your-domain
SESSION_SECRET=<node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
DATABASE_PATH=/var/lib/sachkhand/hospital.db     # on a persistent disk
TRUST_PROXY=1                                    # when behind Caddy/nginx/Cloudflare
```
In production the app refuses to start without a strong `SESSION_SECRET`, and cookies are `Secure`.
`.env` is git-ignored. Never commit it.

## 3. Initialise (once)
```bash
npm run migrate
npm run create-admin      # prompts; password is not echoed. Use a long unique password.
```
Sign in at `/admin/login`, then **Staff accounts** → create personal accounts (receptionists etc.) and use the super-admin account only for administration.

## 4. Run
### Option A – systemd + Caddy (recommended on a VPS)
`/etc/systemd/system/sachkhand.service`
```
[Unit]
Description=Sachkhand Hospital website
After=network.target
[Service]
WorkingDirectory=/opt/sachkhand-hospital
EnvironmentFile=/opt/sachkhand-hospital/.env
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning src/server.js
Restart=always
User=sachkhand
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/var/lib/sachkhand /opt/sachkhand-hospital/backups
[Install]
WantedBy=multi-user.target
```
`/etc/caddy/Caddyfile` (Caddy obtains and renews HTTPS certificates automatically)
```
your-domain {
  encode gzip
  reverse_proxy 127.0.0.1:3000
}
```
Point your domain’s DNS **A/AAAA** record at the server, open ports 80/443, `systemctl enable --now sachkhand caddy`.

### Option B – Docker
```bash
docker build -t sachkhand .
docker run -d --name sachkhand --restart=always -p 127.0.0.1:3000:3000 \
  --env-file .env -e DATABASE_PATH=/data/hospital.db -v sachkhand-data:/data sachkhand
```
Put Caddy/nginx/Cloudflare in front for HTTPS as above.

### Not Vercel
SQLite needs a persistent filesystem; Vercel’s is ephemeral. To use Vercel + managed Postgres/Supabase you must port `src/lib/db.js` (see §7).

## 5. Backups and restore
* Backup (safe while running): `npm run backup` → `backups/hospital-YYYYMMDD-HHMMSS.db` (mode 600).
* Schedule nightly + copy off-server (encrypted): `0 2 * * * cd /opt/sachkhand-hospital && npm run backup && find backups -mtime +30 -delete`
* **Restore:** stop the service, copy the backup over `DATABASE_PATH` (delete any `*.db-wal`/`*.db-shm` beside it), start the service, then check `/healthz` and sign in. **Test a restore before launch** and after any change of server.
* Backups contain patient data: store them encrypted, restrict access, and apply the retention plan in `SECURITY-PRIVACY.md`.

## 6. Updating
`git pull` → `npm test` → `npm run migrate` → restart. Migrations are additive and recorded in `schema_migrations`.

## 7. If you later move to PostgreSQL / Supabase
Replace `src/lib/db.js` (driver, `tx`, `isUniqueViolation`) and review: `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`; `date(created_at,'+330 minutes')` / `strftime` in reports → `created_at AT TIME ZONE 'Asia/Kolkata'`; `INTEGER PRIMARY KEY` → `GENERATED ... AS IDENTITY`; `group_concat` → `string_agg`; `BEGIN IMMEDIATE` → `BEGIN` + `SELECT … FOR UPDATE` on the doctor row. The partial unique index `uq_doctor_slot` works unchanged on PostgreSQL. Do **not** expose service-role keys to the browser; keep all DB access server-side as here.

## 8. Pre-launch checklist
1. Complete `docs/PENDING-CONFIRMATION.md` with hospital management.
2. Native Hindi reviewer approves all Hindi text; tick “translation reviewed”.
3. Legal review of privacy policy/terms and DPDP Act compliance (`SECURITY-PRIVACY.md`).
4. Verify map location, then enable it in Settings.
5. Real photographs added; set `BASE_URL` to the final domain; check `/sitemap.xml` and submit to Google Search Console.
6. HTTPS working, `SESSION_SECRET` set, backups tested, staff accounts created, default test data absent.
7. Run `docs/TESTING.md` manual checks on a phone and desktop.
