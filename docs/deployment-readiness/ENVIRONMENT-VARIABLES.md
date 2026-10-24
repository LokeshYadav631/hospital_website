# Environment Variables & Configuration Guide

**Project**: SACHKHAND HOSPITAL Clinical & Appointment Management System  
**Security Classification**: CONFIDENTIAL / OPERATIONAL  
**Target Environments**: Local Development, Staging, Render (Backend), Vercel (Frontend), Supabase (Database)  
**Last Updated**: October 2026  

---

## 1. Overview & Security Policy

All runtime behaviors, external API integrations, secret cryptographic seeds, and network interfaces in SACHKHAND HOSPITAL are governed by environment variables managed through [`src/lib/config.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/src/lib/config.js).

### Strict Security Guidelines:
1. **Zero Secret Hardcoding**: No secret keys, passwords, connection strings, or HMAC seeds may be committed to Git.
2. **Strict Validation**: The application strictly validates and coerces values upon process bootstrap; missing critical parameters in production environments trigger immediate safe aborts.
3. **Least Privilege**: Frontend and Edge CDN environments receive only public non-sensitive routing parameters; all database, SMTP, SMS gateway, and cryptographic secrets are confined exclusively to the Render backend environment.

---

## 2. Environment Variables Matrix

| Variable Name | Required | Default Value (Local) | Sensitivity | Deployment Scope | Purpose & Description | Format / Validation |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | Optional | `development` | Non-sensitive | Render, Vercel, Local | Controls logging verbosity, cookie `Secure` flags, and strict error rendering. | `production` \| `development` \| `test` |
| `PORT` | Optional | `3000` | Non-sensitive | Render, Local | TCP listen port. Automatically assigned by Render in production. | Integer `1024-65535` |
| `HOST` | Optional | `0.0.0.0` | Non-sensitive | Render, Local | Network interface bind address (`0.0.0.0` binds to all network interfaces). | IPv4 / hostname |
| `BASE_URL` | Recommended | `http://localhost:3000` | Non-sensitive | Render, Local | Canonical base URL used for absolute links in emails, SMS reminders, and SEO canonical tags. | Valid URL (`https://...`) |
| `ALLOWED_ORIGINS` | Optional | `*` (dev only) | Non-sensitive | Render | Comma-separated list of permitted CORS web origins for decoupled frontend access. | URLs e.g. `https://sachkhand-hospital.vercel.app` |
| `BACKEND_URL` | Required (Vercel) | `http://localhost:3000` | Non-sensitive | Vercel Edge Proxy | Target URL where Vercel forwards dynamic HTTP requests. | Valid URL (`https://...onrender.com`) |
| `SESSION_SECRET` | **Mandatory** | Fallback dev seed | **SECRET** | Render | 256-bit cryptographic seed used to sign and verify HMAC session cookies. | Hex / Base64 string (>= 32 chars) |
| `DATABASE_URL` | Optional | `data/hospital.db` | **SECRET** | Render, Local | Connection string for database (PostgreSQL connection URI or local SQLite file path). | URI: `postgres://user:pass@host:port/db` |
| `ADMIN_EMAIL` | Optional | `admin@sachkhand.local` | Sensitive | Render | Default bootstrap email address for hospital administrator account creation. | Valid email address |
| `ADMIN_INITIAL_PASSWORD`| Optional | Random generated | **SECRET** | Render | One-time bootstrap seed password for super administrator account creation. | String (>= 12 characters) |
| `NOTIFICATION_EMAIL_ENABLED`| Optional | `false` | Non-sensitive | Render | Feature toggle controlling asynchronous email notification delivery. | `true` \| `false` |
| `SMTP_HOST` | If email enabled | `""` | Non-sensitive | Render | Outbound SMTP relay hostname (e.g. `smtp.gmail.com`, `smtp.sendgrid.net`). | Hostname / IP address |
| `SMTP_PORT` | If email enabled | `587` | Non-sensitive | Render | Outbound SMTP connection port (typically 587 for STARTTLS or 465 for SSL). | Integer `25`, `465`, `587` |
| `SMTP_SECURE` | If email enabled | `false` | Non-sensitive | Render | Use direct TLS connection (`true` for port 465, `false` for port 587 with STARTTLS). | `true` \| `false` |
| `SMTP_USER` | If email enabled | `""` | Sensitive | Render | Authentication username for SMTP service provider. | String / email |
| `SMTP_PASS` | If email enabled | `""` | **SECRET** | Render | Authentication password or App Password for SMTP service provider. | Provider secret token |
| `NOTIFICATION_SMS_ENABLED`| Optional | `false` | Non-sensitive | Render | Feature toggle controlling asynchronous SMS notification dispatch. | `true` \| `false` |
| `SMS_GATEWAY_URL` | If SMS enabled | `""` | Non-sensitive | Render | Outbound HTTP POST API endpoint for Indian SMS provider (MSG91 / Fast2SMS). | Valid HTTPS URL |
| `SMS_GATEWAY_KEY` | If SMS enabled | `""` | **SECRET** | Render | Authorization Bearer token or API key for SMS gateway authentication. | Provider secret token |
| `SMS_SENDER_ID` | If SMS enabled | `SACHKD` | Non-sensitive | Render | Approved 6-character DLT registered Sender ID in India. | String (6 alphanumeric chars) |
| `AUDIT_LOG_RETENTION_DAYS`| Optional| `365` | Non-sensitive | Render | Number of days before archived security audit logs are purged. | Integer (1-3650) |

---

## 3. Configuration Profiles by Environment

### 3.1 Local Development Profile (`.env`)
```bash
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
BASE_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
SESSION_SECRET=dev-insecure-secret-replace-in-production-0123456789abcdef
DATABASE_URL=data/hospital.db
NOTIFICATION_EMAIL_ENABLED=false
NOTIFICATION_SMS_ENABLED=false
```

### 3.2 Render Production Backend Profile (Dashboard Configuration)
Configure in Render Dashboard -> **Service** -> **Environment**:
```bash
NODE_ENV=production
BASE_URL=https://sachkhand-hospital.onrender.com
ALLOWED_ORIGINS=https://sachkhand-hospital.vercel.app,https://sachkhand-hospital.onrender.com
SESSION_SECRET=<GENERATE_SECURE_64_CHAR_HEX_KEY>
DATABASE_URL=postgres://postgres.<project-ref>:<db-password>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require
NOTIFICATION_EMAIL_ENABLED=false
NOTIFICATION_SMS_ENABLED=false
```

### 3.3 Vercel Production Edge Profile (Dashboard Configuration)
Configure in Vercel Dashboard -> **Project Settings** -> **Environment Variables**:
```bash
BACKEND_URL=https://sachkhand-hospital.onrender.com
```

---

## 4. Key Generation & Cryptographic Rotation Procedures

### 4.1 Generating High-Entropy Secrets
Run the native Node.js cryptographic generator on any terminal:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Output format: 64-character hexadecimal string with 256 bits of cryptographic entropy.

### 4.2 Emergency Secret Rotation Runbook (Zero-Downtime)
In the event of suspected credential compromise:

1. **Step 1: Session Secret (`SESSION_SECRET`) Rotation**:
   - Update `SESSION_SECRET` in Render Environment dashboard.
   - Trigger manual redeploy.
   - *Impact*: Active admin and staff sessions will be invalidated and logged out. Patient booking is unaffected.

2. **Step 2: Database Password (`DATABASE_URL`) Rotation**:
   - In Supabase Dashboard -> **Project Settings** -> **Database** -> Reset Database Password.
   - Immediately update `DATABASE_URL` in Render Environment dashboard.
   - Trigger instant redeploy.
   - *Downtime*: < 15 seconds during container reconnect.

3. **Step 3: SMTP / SMS Gateway Credentials Rotation**:
   - Issue new API token in provider dashboard (SendGrid / MSG91).
   - Update `SMTP_PASS` or `SMS_GATEWAY_KEY` in Render environment variables.
   - Render automatically performs a zero-downtime rolling restart.

---

## 5. Verification & Health Audit

To verify that configuration is loaded properly without printing sensitive secrets to stdout:
```bash
node -e "const { config } = require('./src/lib/config'); console.log({ env: config.env, port: config.port, emailEnabled: config.notificationEmailEnabled, smsEnabled: config.notificationSmsEnabled, hasSessionSecret: Boolean(config.sessionSecret) });"
```
Expected output:
```json
{
  "env": "development",
  "port": 3000,
  "emailEnabled": false,
  "smsEnabled": false,
  "hasSessionSecret": true
}
```
