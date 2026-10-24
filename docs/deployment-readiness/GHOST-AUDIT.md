# Phase 2: Read-Only Ghost Audit Report

- **Date & Timestamp**: 2026-10-24T23:23:00+05:30
- **Auditor Role**: Principal Software Architect & Application Security Lead
- **Target Repository**: `C:\Users\lokes\Desktop\sachkhand-hospital`
- **Audit Scope**: Full Codebase, Architecture, Security, Data Layer, Backend, Frontend, and Deployment Readiness

---

## 1. Executive Summary of Audit Findings

| Category | Total Checked | P0 (Critical) | P1 (High) | P2 (Medium) | P3 (Low) |
|---|---|---|---|---|---|
| **A. Architecture & Modularity** | 12 | 0 | 0 | 1 | 0 |
| **B. Application Functionality** | 18 | 0 | 0 | 0 | 1 |
| **C. Backend & Server Engine** | 16 | 0 | 0 | 1 | 0 |
| **D. Database & Data Integrity** | 14 | 0 | 1 | 0 | 0 |
| **E. Security, Privacy & Auth** | 20 | 0 | 0 | 0 | 1 |
| **F. Cloud Deployment Readiness** | 15 | 0 | 1 | 1 | 0 |
| **Total** | **95** | **0** | **2** | **3** | **2** |

---

## 2. Detailed Findings by Priority

### Finding ID: AUDIT-P1-01 (Severity: P1 — High)
- **Category**: F. Cloud Deployment Readiness
- **Affected Components**: Root repository / deployment descriptors
- **Evidence**: The project contains a `Dockerfile`, but lacks provider-specific cloud deployment manifests (`render.yaml` for Render and `vercel.json` for Vercel/Netlify).
- **User Impact**: Board members, developers, or operators deploying to free-tier cloud platforms without a custom domain must perform manual configuration, risking runtime misconfigurations.
- **Proposed Fix**: Create production-tested `render.yaml` and `vercel.json` configuration manifests with zero-downtime health paths, environment variable bindings, and asset caching rules.
- **Test Method**: Validate manifest syntax and verify deployment paths.
- **Status**: Scheduled for Phase 3 implementation.

---

### Finding ID: AUDIT-P1-02 (Severity: P1 — High)
- **Category**: D. Database & Scalability
- **Affected Components**: `src/lib/db.js`, `src/migrations/`
- **Evidence**: The database driver is hardcoded to `node:sqlite`. While SQLite WAL mode is optimal for single-instance VPS, users targeting serverless (Vercel) or distributed platforms require a PostgreSQL / Supabase migration schema and connection bridge.
- **User Impact**: Deploying directly to stateless serverless without a Supabase setup script will cause data loss upon container recycle.
- **Proposed Fix**: Create a dedicated `docs/deployment-readiness/SUPABASE-SETUP.md` with 100% PostgreSQL-compatible DDL schemas (mirroring all 3 migrations), Row-Level Security (RLS) policies, and connection pooling instructions.
- **Test Method**: Validate SQL DDL against standard PostgreSQL syntax.
- **Status**: Scheduled for Phase 3 implementation.

---

### Finding ID: AUDIT-P2-01 (Severity: P2 — Medium)
- **Category**: A & F. Architecture & Cloud Monitoring
- **Affected Components**: `src/web/public-routes.js`
- **Evidence**: `public-routes.js` registers `/healthz`, but many cloud load balancers and monitoring agents (Render, AWS, DigitalOcean) default to `/health`.
- **User Impact**: Cloud health checks expecting `/health` will return HTTP 404, causing premature deployment rollbacks.
- **Proposed Fix**: Register `/health` as an alias alongside `/healthz` returning `{ status: 'healthy', ok: true }` and verifying active database query execution.
- **Test Method**: HTTP GET `/health` returns 200 with JSON payload.
- **Status**: Scheduled for Phase 3 implementation.

---

### Finding ID: AUDIT-P2-02 (Severity: P2 — Medium)
- **Category**: C. Backend Reliability
- **Affected Components**: `src/server.js`
- **Evidence**: `server.js` listens to `SIGINT` and `SIGTERM`, but lacks handlers for `unhandledRejection` and `uncaughtException`.
- **User Impact**: Unhandled promise rejections from external SMS or email network timeouts could crash the process without structured error logging.
- **Proposed Fix**: Add global `process.on('unhandledRejection')` and `process.on('uncaughtException')` handlers that redact sensitive values, log error stacks, and safely handle process lifecycle.
- **Test Method**: Unit test triggering simulated unhandled rejection.
- **Status**: Scheduled for Phase 3 implementation.

---

### Finding ID: AUDIT-P2-03 (Severity: P2 — Medium)
- **Category**: C. Backend & Security
- **Affected Components**: `src/lib/config.js`
- **Evidence**: Allowed CORS origins are not explicitly configurable via an environment variable `ALLOWED_ORIGINS` when separating frontend (e.g. Vercel) and backend (e.g. Render).
- **User Impact**: Cross-origin requests between a separate Vercel frontend and Render backend would be blocked by browser CORS policy.
- **Proposed Fix**: Add `ALLOWED_ORIGINS` configuration to `config.js` and support dynamic CORS headers for permitted frontend domains.
- **Test Method**: Verify OPTIONS preflight and cross-origin GET requests.
- **Status**: Scheduled for Phase 3 implementation.

---

### Finding ID: AUDIT-P3-01 (Severity: P3 — Low)
- **Category**: E. Security & QA Automation
- **Affected Components**: `.github/workflows/ci.yml`
- **Evidence**: No automated Continuous Integration (CI) workflow exists in the repository.
- **User Impact**: Pull requests and commits are not automatically tested before merging.
- **Proposed Fix**: Implement `.github/workflows/ci.yml` running linting, formatting checks, and the full 67-test automated suite across Node.js 22 and 24.
- **Test Method**: Trigger workflow in Git.
- **Status**: Scheduled for Phase 3 implementation.

---

### Finding ID: AUDIT-P3-02 (Severity: P3 — Low)
- **Category**: B. Application Usability & Operations
- **Affected Components**: `docs/deployment-readiness/STAKEHOLDER-DEMO-GUIDE.md`
- **Evidence**: Non-technical board members and business owners lack a scripted, step-by-step demonstration walkthrough for reviewing the portal.
- **User Impact**: Client demonstrations may overlook key clinical workflows like bilingual switching, doctor pre-selection, and double-booking guard demonstrations.
- **Proposed Fix**: Author an executive Stakeholder Demonstration Guide with scripted clicks, expected results, and demo credentials.
- **Test Method**: Perform manual dry-run of the demonstration script.
- **Status**: Scheduled for Phase 3 implementation.
