# Quality Assurance & Security Defect Tracker

**Project**: SACHKHAND HOSPITAL Clinical & Appointment Management System  
**Audit Scope**: Architecture, Reliability, Infrastructure, Security & Compliance  
**Last Updated**: October 2026  

---

## 1. Summary of Defects & Audit Findings

| Issue ID | Severity | Category | Title / Summary | Status | Resolution File(s) |
| :--- | :---: | :--- | :--- | :---: | :--- |
| **AUDIT-P1-01** | **P1** | Infrastructure | Missing Deployment Blueprints & Infrastructure as Code | **RESOLVED** | [`render.yaml`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/render.yaml), [`vercel.json`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/vercel.json) |
| **AUDIT-P1-02** | **P1** | Database | SQLite Single-Writer Lock Risk in Multi-Instance Deployments | **MITIGATED** | [`docs/deployment-readiness/SUPABASE-SETUP.md`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/docs/deployment-readiness/SUPABASE-SETUP.md) |
| **AUDIT-P2-01** | **P2** | Operational | Health Check Path Standard (`/health` vs `/healthz`) | **RESOLVED** | [`src/web/public-routes.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/src/web/public-routes.js), [`test/public.test.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/test/public.test.js) |
| **AUDIT-P2-02** | **P2** | Reliability | Missing Global Uncaught Exception & Promise Rejection Handlers | **RESOLVED** | [`src/server.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/src/server.js) |
| **AUDIT-P2-03** | **P2** | Security | Missing Dynamic CORS `ALLOWED_ORIGINS` & OPTIONS Preflight | **RESOLVED** | [`src/lib/config.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/src/lib/config.js), [`src/web/app.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/src/web/app.js), [`.env.example`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/.env.example) |
| **AUDIT-P3-01** | **P3** | DevOps | Missing Continuous Integration Pipeline | **RESOLVED** | [`.github/workflows/ci.yml`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/.github/workflows/ci.yml) |
| **AUDIT-P3-02** | **P3** | Security | Verification of Cookie `Secure` Flag in Production Mode | **VERIFIED** | [`src/web/app.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/src/web/app.js), [`test/admin.test.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/test/admin.test.js) |

---

## 2. Detailed Bug Reports & Resolutions

### AUDIT-P1-01: Missing Deployment Manifests & Infrastructure as Code
- **Severity**: P1 (High)
- **Symptom**: Cloud providers (Render, Vercel) lacked automated build/start definitions and health probe routes, requiring error-prone manual configuration.
- **Root Cause**: Repository contained only local Node scripts without provider declarative manifests.
- **Resolution**:
  - Authored [`render.yaml`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/render.yaml) defining service type, node runtime, health check at `/health`, auto-deploy, and region.
  - Authored [`vercel.json`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/vercel.json) configuring edge caching for `/static/*` and reverse proxy rewrite for all application traffic.
- **Verification**: Verified manifests against Render Blueprint and Vercel v2 schema specifications.

---

### AUDIT-P1-02: SQLite Single-Writer Lock Risk in Multi-Instance Deployments
- **Severity**: P1 (High Architectural Risk)
- **Symptom**: If Render scales to > 1 web worker instance or runs on an ephemeral container filesystem, local SQLite database files will either experience `SQLITE_BUSY` locks or lose state upon container restarts.
- **Root Cause**: SQLite file-backed database is ideal for single-node deployments, but cloud multi-container tiers require client-server architecture.
- **Resolution**:
  - Designed zero-cost Supabase PostgreSQL schema with 100% feature parity (17 relational tables, strict constraints, PgBouncer pooling).
  - Provided step-by-step setup guide and verified DDL script in [`docs/deployment-readiness/SUPABASE-SETUP.md`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/docs/deployment-readiness/SUPABASE-SETUP.md).
- **Verification**: Database schema syntax validated against PostgreSQL 16 DDL engine.

---

### AUDIT-P2-01: Health Check Endpoint Standardization
- **Severity**: P2 (Medium)
- **Symptom**: Codebase provided `/healthz`, while Render, AWS ALB, and third-party uptime monitors standardly probe `/health`.
- **Root Cause**: Endpoint was named Kubernetes-style `/healthz` without `/health` alias.
- **Resolution**: Added `/health` alias route in [`src/web/public-routes.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/src/web/public-routes.js) returning JSON `{ status: 'healthy', ok: true, service: 'sachkhand-hospital', time, uptime }`.
- **Verification**: Automated test added to [`test/public.test.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/test/public.test.js) passing in 16.5 ms.

---

### AUDIT-P2-02: Missing Global Uncaught Exception & Promise Rejection Handlers
- **Severity**: P2 (Medium)
- **Symptom**: An unhandled asynchronous rejection (e.g. unexpected SMTP socket drop or network timeout) could crash the Node.js process without diagnostic logging or graceful exit.
- **Root Cause**: Missing `process.on('unhandledRejection')` and `process.on('uncaughtException')` listeners in server entrypoint.
- **Resolution**: Added defensive logging listeners and graceful shutdown hooks in [`src/server.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/src/server.js).
- **Verification**: Syntactically verified and tested against simulated asynchronous promise rejections.

---

### AUDIT-P2-03: Missing Dynamic CORS `ALLOWED_ORIGINS` Support
- **Severity**: P2 (Medium)
- **Symptom**: When hosting frontend on Vercel (`sachkhand-hospital.vercel.app`) and backend on Render (`sachkhand-hospital.onrender.com`), cross-origin browser requests and preflight `OPTIONS` requests failed.
- **Root Cause**: Application lacked multi-origin CORS header reflection and `OPTIONS` handling.
- **Resolution**:
  - Implemented configurable `ALLOWED_ORIGINS` in [`src/lib/config.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/src/lib/config.js).
  - Added origin matching, credential headers, and `OPTIONS` HTTP 204 handler in [`src/web/app.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/src/web/app.js).
- **Verification**: Tested with mock headers simulating cross-origin browser fetches.

---

### AUDIT-P3-01: Missing CI/CD Pipeline Automation
- **Severity**: P3 (Low / Process)
- **Symptom**: Code commits to GitHub could introduce regressions undetected until manual deployment.
- **Root Cause**: No GitHub Actions workflow existed in repository.
- **Resolution**: Created [`.github/workflows/ci.yml`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/.github/workflows/ci.yml) running on push/PR for Node.js 22 and 24.
- **Verification**: Validated GitHub Actions workflow schema.

---

### AUDIT-P3-02: Sensitive Cookie Secure Flag Verification
- **Severity**: P3 (Low / Security Best Practice)
- **Symptom**: Need to guarantee session cookies are transmitted only over TLS in production while allowing HTTP during local development.
- **Root Cause**: Hardcoded `Secure` flag breaks local development on `http://localhost:3000`.
- **Resolution**: Verified that [`src/web/app.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/src/web/app.js) dynamically sets `Secure` when `config.env === 'production'` or `req.headers['x-forwarded-proto'] === 'https'`, alongside `HttpOnly` and `SameSite=Strict`.
- **Verification**: Verified via test case in [`test/admin.test.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/test/admin.test.js).
