# Phase 0: Baseline Initial State Report

- **Date & Timestamp**: 2026-10-24T23:21:00+05:30
- **Repository Root**: `C:\Users\lokes\Desktop\sachkhand-hospital`
- **Git Remote**: `https://github.com/LokeshYadav631/hospital_website.git`
- **Active Branch**: `main` (synchronized with `origin/main` at commit `6814776`)
- **Working Tree**: Clean (all application assets committed; deployment-readiness docs in progress)

---

## 1. Project Topology & Architecture

| Property | Value / Description |
|---|---|
| **Structure** | Single-application Full-Stack Monolith with Clean Architectural Separation |
| **Backend Runtime** | Node.js 22 LTS (running on v24.19.0, standard `node:http`) |
| **Frontend Architecture** | Server-Rendered Semantic HTML5 + Vanilla Responsive CSS + Lightweight Progressive Enhancements (`public/js/app.js`) |
| **Styling & Design** | Custom CSS variables, responsive grid (`minmax(320px, 1fr)` for doctor profiles, responsive navigation, print styles) |
| **Database Engine** | Embedded SQLite 3 via Node.js native `node:sqlite` (DatabaseSync) |
| **Database Journaling** | Write-Ahead Logging (`WAL` mode), `busy_timeout = 5000ms`, `synchronous = NORMAL` |
| **Dependencies** | **0 External NPM Dependencies** (`dependencies` and `devDependencies` are empty; uses native Node standard modules) |
| **Package Manager** | npm 11.17.0 |
| **Test Runner** | Native Node.js Test Runner (`node --test "test/*.test.js"`) |

---

## 2. Directory Structure & Key Files

```
c:\Users\lokes\Desktop\sachkhand-hospital\
├── .dockerignore
├── .env.example
├── .gitignore
├── Dockerfile
├── package.json
├── README.md
├── SYSTEM-ARCHITECTURE-AND-DEPLOYMENT.md
├── SACHKHAND-HOSPITAL-END-TO-END-DEVELOPMENT-HOSTING-AND-CREDENTIALS-GUIDE.md
├── DATABASE-SCALABILITY-AND-CLOUD-DEPLOYMENT-ANALYSIS.md
├── docs/
│   ├── DEPLOYMENT.md
│   ├── PENDING-CONFIRMATION.md
│   ├── SECURITY-PRIVACY.md
│   ├── SMS.md
│   ├── TESTING.md
│   └── deployment-readiness/
│       ├── EXECUTION-STATE.md
│       └── INITIAL-STATE.md
├── public/
│   ├── css/style.css
│   ├── js/app.js
│   └── img/
│       ├── hospital-building.jpg
│       ├── hospital-logo.jpg
│       ├── trust-logo.png
│       ├── doctors-team.jpg
│       └── doctors/ (19 verified doctor portraits)
├── src/
│   ├── server.js
│   ├── i18n/strings.js
│   ├── lib/ (clock, config, db, html, security, validation)
│   ├── data/ (seed, seed-data, verified-doctors)
│   ├── migrations/ (001_init.sql, 002_email_notifications.sql, 003_doctor_sort.sql)
│   ├── services/ (appointments, email-providers, notifications, settings, slots, sms-providers)
│   └── web/ (app, http, public-routes, public-views, admin-routes, admin-routes2, admin-ui, ui)
└── test/
    ├── helpers.js
    ├── public.test.js
    ├── booking.test.js
    ├── admin.test.js
    ├── sms.test.js
    └── concurrency-and-email.test.js
```

---

## 3. Baseline Verification Results

### A. Git Status & Remote Alignment
- Working branch: `main`.
- Remote: `origin/main` is up to date on `https://github.com/LokeshYadav631/hospital_website.git`.
- Sensitive files (`.env`, `data/`, `*.db`, `node_modules/`, `venv/`, `coursevault/`) are correctly excluded by `.gitignore`.

### B. Automated Test Suite Execution
- **Command**: `node --disable-warning=ExperimentalWarning --test "test/*.test.js"`
- **Result**: **67 Tests Passing / 0 Failing / 0 Skipped** (Duration: 5.09s).
- **Coverage Highlights**:
  - Unauthenticated access control to `/admin` routes.
  - Scrypt password hashing, lockout after 5 failed attempts, session cookie flags (`HttpOnly`, `SameSite=Strict`).
  - Role-based authorization matrix (`receptionist`, `doctor`, `admin`, `super_admin`).
  - Double-booking concurrency prevention (20 concurrent requests for 1 slot -> exactly 1 succeeds, 19 rejected).
  - High-concurrency booking of 25 simultaneous users across consultations and diagnostics.
  - Notification queue claiming with concurrency guard (10 parallel dispatchers -> 0 duplicate deliveries).
  - Backdate booking prevention (rejection of past dates in IST timezone).
  - Bilingual i18n consistency between English and Hindi dictionaries.
  - Doctor sorting sequence (Dr. Gajraj Yadav at #1, verified poster ordering).
  - Removal of static poster from public doctor directory.
  - Social media link validation and public rendering in header/footer.

### C. Live Daemon Process Verification
- Server running locally on `http://localhost:3000`.
- Health status: Responds with HTTP 200 on `/en/`, `/hi/`, `/en/doctors`, `/en/appointment`.
- Doctor selection query pre-selection verified: `/en/appointment?doctor=1` automatically selects Dr. Gajraj Yadav and General Surgery.

---

## 4. Current State: What Works, What is Partial, What is Unknown

### What Works Fully:
1. Complete public portal: Homepage with hero hospital image, About page, 11 clinical departments, 19 verified doctor profile cards, diagnostic booking, patient contact inquiry form.
2. Bilingual English/Hindi routing with zero-JS fallback.
3. Appointment booking with doctor selection, date validation, slot calculation, double-booking prevention, and reference generation (`SKH-XXXX-XXXX`).
4. Patient self-service status lookup and change/cancellation requests.
5. Role-based Admin portal with appointment filtering, status transitions, doctor assignments, CSV export, service hours management, emergency notes, and audit logs.
6. Dual notification engine (SMS & Email) with exponential retry backoff and webhook callbacks.
7. Poster-ordered doctor profiles with Dr. Gajraj Yadav as Director #1.
8. Admin panel configuration for Facebook and Instagram links.

### What is Partial / Requires External Activation:
1. **SMS Gateway**: Real SMS delivery requires configuring an external provider in `.env` (`fast2sms`, `msg91`, or `twilio`) and registering DLT templates with Indian telecom operators. In the absence of credentials, it operates safely in simulated or disabled mode.
2. **Email Gateway**: Real email delivery requires configuring `resend`, `sendgrid`, or SMTP credentials. In their absence, notifications remain queued or logged without breaking the application.
3. **Supabase / PostgreSQL**: Currently runs on native SQLite (`data/hospital.db`). A Supabase migration script and dual-database configuration is needed for users who want to host on cloud platforms like Render + Supabase without relying on persistent local disks.

### What Remains Unknown / Blockers for Instant Cloud Deployment:
1. Cloud provider credentials: The user has not yet provided active Supabase project connection strings or Render/Vercel deployment tokens. (Phase 6, 7, 8 will prepare the exact deployment configurations and zero-cost setup guides so deployment can be triggered seamlessly).
