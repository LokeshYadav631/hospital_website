# Disaster Recovery & Rollback Operational Runbook

**Project**: SACHKHAND HOSPITAL Clinical & Appointment Management System  
**Document Type**: Standard Operating Procedure (SOP) — Emergency Response  
**Recovery Targets**:
- **Recovery Time Objective (RTO)**: < 5 minutes for application availability.
- **Recovery Point Objective (RPO)**: < 15 minutes for appointment data loss.
**Last Updated**: October 2026  

---

## 1. Emergency Escalation Triggers

Initiate this rollback runbook immediately if any of the following occur following a production deployment:
1. **Critical Route Failure**: The `/health` or `/healthz` probe returns HTTP 500 or times out for > 3 consecutive minutes.
2. **Booking Engine Blockage**: Patients cannot complete appointment requests or experience unhandled exceptions during submission.
3. **Admin Authentication Lockout**: Clinical staff and administrators cannot log into the `/admin` portal.
4. **Data Corruption / Slot Collision**: Duplicate appointments are committed for the same doctor slot.
5. **Security Breach / Leak**: Sensitive credentials or patient medical inquiries are exposed.

---

## 2. Immediate Rollback Runbooks

### 2.1 Render Backend Instant Rollback (< 2 Minutes)
Render maintains immutable deployment history with cached image builds.

#### Via Render Web Dashboard (Recommended):
1. Navigate to **dashboard.render.com** -> Select **sachkhand-hospital** web service.
2. Open the **Events** or **Deploys** tab.
3. Locate the last known good deployment (marked with green checkmark).
4. Click the three dots (`...`) on that deploy -> Select **Rollback to this deploy**.
5. Render immediately diverts HTTP traffic to the previous healthy container.

#### Via Git Force-Revert (If Dashboard Inaccessible):
```bash
# Revert the faulty commit on main
git revert HEAD --no-edit

# Push revert to GitHub
git push origin main
```
Render's GitHub webhook automatically triggers a rebuild and zero-downtime deploy.

---

### 2.2 Vercel Edge / Frontend Instant Rollback (< 1 Minute)
Vercel keeps all previous deployments live and immutable at unique deployment URLs.

#### Via Vercel Web Dashboard:
1. Go to **vercel.com/dashboard** -> Select project `sachkhand-hospital`.
2. Navigate to the **Deployments** tab.
3. Locate the last successful deployment.
4. Click the three dots (`...`) -> Select **Promote to Production** (or **Assign Custom Domain**).
5. Vercel instantly points the production edge subdomain (`sachkhand-hospital.vercel.app`) to the selected deployment without rebuilding.

---

### 2.3 Database Recovery & Point-in-Time Restore

#### Case A: Managed Supabase PostgreSQL
1. Open **Supabase Dashboard** -> Select Project -> **Database** -> **Backups**.
2. **Daily Snapshot Restore**:
   - Choose the snapshot from before the failure occurred.
   - Click **Restore to this backup**.
3. **Point-in-Time Recovery (PITR)**:
   - Select precise timestamp prior to the corrupted transaction.
   - Confirm restore.
4. *Post-Restore Step*: Re-run health probe at `https://sachkhand-hospital.onrender.com/health` to confirm active pool connections.

#### Case B: File-Backed SQLite Database (Local / Persistent Disk)
The application includes an automated backup utility in [`scripts/backup.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/scripts/backup.js).
```bash
# 1. Stop the application daemon
npm run stop # or terminate task process

# 2. Check available backup archives in data/backups/
dir data\backups\

# 3. Restore the latest clean database backup
copy data\backups\hospital-backup-YYYY-MM-DDTHH-mm-ss.db data\hospital.db /Y

# 4. Remove stale WAL and SHM journal files
del data\hospital.db-wal data\hospital.db-shm

# 5. Verify database integrity
node -e "const { getDb } = require('./src/lib/db'); const db = getDb(); console.log(db.prepare('PRAGMA integrity_check').all());"

# 6. Restart server
npm start
```

---

## 3. Communication & Incident Management Protocol

During an active rollback event:

```
[Incident Detected]
       │
       ▼
[Notify Tech Lead & Medical Superintendent via Phone/WhatsApp]
       │
       ▼
[Execute Provider Dashboard Rollback: Render / Vercel] (< 2 min)
       │
       ▼
[Verify Health Probe: GET /health returns 200 OK] (< 1 min)
       │
       ▼
[Verify Appointment Booking Flow End-to-End] (< 2 min)
       │
       ▼
[Log Incident in Security Audit Trail & Author Post-Mortem]
```

### Emergency Contacts:
- **Lead Software Engineer & DevOps Lead**: Lokesh Yadav (`admin@sachkhand.local`)
- **Hospital Medical Director**: Dr. Gajraj Yadav (Chief Medical Officer)
- **Hospital Administration & Front Desk**: Sachkhand Hospital Reception (`+91 94140 XXXXX`)
- **Cloud Infrastructure Monitoring**: Render Status (`status.render.com`) | Supabase Status (`status.supabase.com`)

---

## 4. Post-Rollback Validation Checklist

Following any rollback execution, perform these 5 mandatory verification checks:
- [ ] `/health` returns status code `200` with `"status": "healthy"`.
- [ ] Public website loads with complete bilingual navigation (`/en` and `/hi`).
- [ ] Hospital logo and Trust logo render properly without 404 broken image placeholders.
- [ ] Staff can log into `/admin` with valid credentials and review pending OPD queue.
- [ ] Test booking request creates a new record in `appointments` table and issues reference code.
