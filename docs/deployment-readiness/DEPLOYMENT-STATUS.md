# Deployment Status Report

**Project**: SACHKHAND HOSPITAL Appointment & Clinical OPD Management System  
**Repository**: [github.com/LokeshYadav631/hospital_website](https://github.com/LokeshYadav631/hospital_website.git)  
**Target Infrastructure**: Zero-Cost Cloud Topology (Render + Vercel + Supabase)  
**Status**: Ready for Deployment / Manifests Configured  
**Last Updated**: October 2026  

---

## 1. Executive Summary

This document details the deployment topology, cloud configurations, provider specifications, health checks, domain management, and operational readiness for SACHKHAND HOSPITAL. The system is designed to run entirely on high-reliability free/low-cost tiers without requiring the purchase of a custom domain, leveraging provider-issued subdomains with automatic TLS/SSL certificates.

---

## 2. Target Cloud Topology & Provider Matrix

| Tier | Component | Provider | Tier / Plan | Domain / URL Pattern | Primary Role |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Backend & Daemon** | Node.js Core Web & Background Dispatcher | **Render** | Free Web Service (`free`) | `https://sachkhand-hospital.onrender.com` | HTTP Request Router, Auth, Session Guard, Notification Engine, In-Memory Scheduling |
| **Frontend CDN** | Static Assets & Edge Reverse Proxy | **Vercel** / **Netlify** | Hobby / Free | `https://sachkhand-hospital.vercel.app` | Global Edge Caching, Static Assets (`/static/*`, images, logos), Fast LCP/TTFB |
| **Database** | Managed Relational PostgreSQL | **Supabase** | Free Tier (PostgreSQL 16) | `db.<project-ref>.supabase.co` | Multi-Tenant Database, Connection Pooling (PgBouncer port 6543), Automatic Nightly Backups |
| **Source Control & CI** | Git Repository & CI Pipeline | **GitHub** | Free (`origin/main`) | `https://github.com/LokeshYadav631/hospital_website` | Version Control, Secret Storage, Automated GitHub Actions Test Pipeline |

---

## 3. Configuration Manifests in Codebase

### 3.1 Render Web Service Manifest (`render.yaml`)
Located at [`render.yaml`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/render.yaml):
- **Runtime**: `node` (version `>=22.13.0` via `engines` in `package.json`)
- **Plan**: `free`
- **Region**: `singapore` or `oregon` (Singapore `sin` recommended for lowest latency to Rajasthan, India)
- **Build Command**: Zero npm dependencies build: `echo "Build completed without external dependencies"`
- **Start Command**: `npm start` (`node --disable-warning=ExperimentalWarning src/server.js`)
- **Health Check Path**: `/health` (also aliased to `/healthz`)
- **Auto-Deploy**: Enabled on Git push to `main` branch.

### 3.2 Vercel Edge Proxy Manifest (`vercel.json`)
Located at [`vercel.json`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/vercel.json):
- **Clean URLs**: `true`
- **Asset Routing**: Static files in `/static/*` served with cache headers (`Cache-Control: public, max-age=31536000, immutable`).
- **Dynamic Routing**: Rewrites all non-static traffic (`/(.*)`) to the Render backend service endpoint.
- **Security Headers**: Injected at the edge (Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, Content-Security-Policy).

### 3.3 GitHub Actions Workflow (`.github/workflows/ci.yml`)
Located at [`.github/workflows/ci.yml`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/.github/workflows/ci.yml):
- **Triggers**: Push to `main` or Pull Request to `main`.
- **Matrix**: Node.js `22.x` and `24.x`.
- **Steps**:
  1. Checkout code (`actions/checkout@v4`).
  2. Setup Node (`actions/setup-node@v4`).
  3. Verify zero dependencies (`npm ls --depth=0`).
  4. Run automated test suite (`npm test`).
  5. Validate syntax across all source files (`node --check src/server.js`).

---

## 4. Health Check & Monitoring Specifications

The application provides dual standard health endpoints implemented in [`src/web/public-routes.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/src/web/public-routes.js):

### 4.1 Endpoints
1. `GET /health` (Render default probe)
2. `GET /healthz` (Kubernetes / Cloud-native standard probe)

### 4.2 Response Payload
```json
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: no-cache, no-store, must-revalidate

{
  "status": "healthy",
  "ok": true,
  "service": "sachkhand-hospital",
  "time": "2026-10-24T18:00:00.000Z",
  "uptime": 12450.85
}
```

### 4.3 Probe Intervals & Failure Thresholds
- **Render Health Check Frequency**: Every 10 seconds.
- **Unhealthy Threshold**: 3 consecutive failed probes (HTTP status != 200 or timeout > 4 seconds).
- **Restart Action**: Automated container recreation with notification to service owner.

---

## 5. Free-Tier Characteristics, Limitations & Mitigations

| Provider / Tier | Built-in Limitation | Impact on Hospital System | Engineering Mitigation |
| :--- | :--- | :--- | :--- |
| **Render Free Web Service** | Spins down after 15 minutes of inactivity (sleep mode). | Initial cold start delay (~30 to 50 seconds) on the first visitor after idle period. | Set up a free external ping monitor (e.g. UptimeRobot, Cron-Job.org, or BetterStack) polling `https://sachkhand-hospital.onrender.com/health` every 10 minutes to prevent sleep during clinic operational hours (08:00–20:00 IST). |
| **Render Free Bandwidth** | 100 GB outbound bandwidth / month. | Exceeding limit suspends service until next billing cycle. | Static media assets (hospital logo, trust logo, doctor photos) are compressed into efficient WebP/JPEG format and cached via Vercel Edge CDN. |
| **Supabase Free Database** | Pauses project after 1 week of zero query activity; 500 MB storage cap. | Hospital data unreachable if paused. | Regular health check queries or periodic background cron executions prevent inactivity pausing. 500 MB accommodates ~1.2 million appointment records. |
| **Supabase Connection Limit** | Direct connection pool limit: 60 connections. | Connection exhaustion under burst traffic. | Render backend connects via PgBouncer transaction pooler (Port 6543) instead of direct PostgreSQL session port (5432). |

---

## 6. Step-by-Step Deployment Instructions

### Phase A: Setup Supabase Database
1. Create a free account at [supabase.com](https://supabase.com).
2. Create project named `sachkhand-hospital` in region `ap-south-1` (Mumbai).
3. Open **SQL Editor** in Supabase dashboard.
4. Execute the complete DDL script from [`docs/deployment-readiness/SUPABASE-SETUP.md`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/docs/deployment-readiness/SUPABASE-SETUP.md).
5. Copy the Transaction Pooler Connection String (`postgres://postgres.[ref]:[password]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`).

### Phase B: Deploy Backend on Render
1. Sign in to [render.com](https://render.com) using GitHub account.
2. Click **New +** -> **Blueprint**.
3. Select repository `LokeshYadav631/hospital_website`.
4. Render detects [`render.yaml`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/render.yaml) automatically.
5. In Environment Variables configuration, enter:
   - `SESSION_SECRET`: Generate a 64-character random string (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   - `ADMIN_INITIAL_PASSWORD`: Secure initial password for admin setup.
   - `ADMIN_EMAIL`: Initial admin email.
   - `NOTIFICATION_EMAIL_ENABLED`: `false` (or configure SMTP).
   - `NOTIFICATION_SMS_ENABLED`: `false` (or configure MSG91 / Fast2SMS).
6. Click **Apply**. Build finishes in < 60 seconds.
7. Note down the backend URL: `https://<service-name>.onrender.com`.

### Phase C: Deploy Edge / Frontend on Vercel
1. Sign in to [vercel.com](https://vercel.com) using GitHub account.
2. Click **Add New Project** -> Import `LokeshYadav631/hospital_website`.
3. Framework Preset: **Other**.
4. Root Directory: `./`.
5. Build Command: Leave blank (no build step needed).
6. Output Directory: Leave blank.
7. Add Environment Variable:
   - `BACKEND_URL`: `https://<service-name>.onrender.com`
8. Click **Deploy**. Vercel publishes to `https://<project-name>.vercel.app`.

---

## 7. Verification Checklist

- [x] Git repository synced with `origin/main` ([github.com/LokeshYadav631/hospital_website](https://github.com/LokeshYadav631/hospital_website.git)).
- [x] Zero-dependency architecture verified (build requires no `npm install` external downloads).
- [x] Cloud manifests validated: [`render.yaml`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/render.yaml), [`vercel.json`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/vercel.json).
- [x] Automated test pipeline configured: [`.github/workflows/ci.yml`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/.github/workflows/ci.yml).
- [x] Health check endpoints verified (`/health`, `/healthz`).
- [x] Dual-origin CORS enabled for decoupled frontend routing (`ALLOWED_ORIGINS`).
