# Comprehensive Quality Assurance & Test Plan

**Project**: SACHKHAND HOSPITAL Clinical & Appointment Management System  
**Test Framework**: Native Node.js Test Runner (`node:test`, `node:assert/strict`)  
**Target Coverage**: Public Navigation, Clinical Scheduling, RBAC, Dual Notifications, Concurrency, Security  
**Last Updated**: October 2026  

---

## 1. Test Strategy Overview

The testing strategy for SACHKHAND HOSPITAL guarantees stability, data integrity, patient data privacy, zero double-booking, and resilient cloud operation without introducing external npm test dependencies.

Testing is organized into six tiers:
1. **Tier 1: Static Code Quality & Syntax Verification**
2. **Tier 2: Unit Testing (Pure Business Logic & Helpers)**
3. **Tier 3: Database & Transactional Integrity Testing**
4. **Tier 4: End-to-End HTTP Route & Integration Testing**
5. **Tier 5: Concurrency, Load & Dual Notification Testing**
6. **Tier 6: Deployment Smoke Testing & Post-Release Health Checks**

---

## 2. Test Suites Matrix & Mapping

| Test Suite File | Focus Area | Assertions / Scenarios | Target Risks Mitigated |
| :--- | :--- | :--- | :--- |
| [`test/public.test.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/test/public.test.js) | Public portal, i18n, branding, doctor profiles, health checks | 16 test suites | Broken links, missing Hindi translations, incorrect logos, unverified claims, health check failures. |
| [`test/booking.test.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/test/booking.test.js) | Public appointment booking, validation, reference generator | 18 test suites | Past date bookings, malformed phone numbers, unhandled holiday closures, reference collisions. |
| [`test/admin.test.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/test/admin.test.js) | RBAC, authentication, clinical workflows, CSV audit | 16 test suites | Unauthorized access, privilege escalation, CSRF exploits, CSV spreadsheet formula injection. |
| [`test/sms.test.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/test/sms.test.js) | SMS dispatch, retry backoff, webhook callbacks, consent | 9 test suites | Double-sending, sending without consent, gateway timeout hangs, lost reminders. |
| [`test/concurrency-and-email.test.js`](file:///c:/Users/lokes/Desktop/sachkhand-hospital/test/concurrency-and-email.test.js) | High concurrency (20-user race conditions), email notifications | 9 test suites | Double booking under simultaneous race condition, dual-channel notification failure, Devanagari encoding bugs. |

---

## 3. Tier 1: Static Analysis & Syntax Validation

### 3.1 Syntax & Import Check
All Javascript source files are validated using the Node.js syntax checker before execution:
```bash
node --check src/server.js
node --check src/lib/config.js
node --check src/lib/db.js
node --check src/services/doctor-service.js
node --check src/services/appointment-service.js
node --check src/services/notification-service.js
node --check src/web/app.js
node --check src/web/admin-routes.js
node --check src/web/public-routes.js
```

### 3.2 Secret Scanning
Automated regex scan ensuring no hardcoded private keys or credentials exist in source trees:
- Rule: Reject matches for `sk_live_`, `AIza`, `-----BEGIN PRIVATE KEY-----`, or hardcoded passwords in `.js` files.

---

## 4. Tier 2 & 3: Database & Business Logic Tests

### 4.1 Doctor Sorting & Profile Verification
- **Test ID**: `TC-DOC-01`
- **Assertion**: Dr. Gajraj Yadav must be the first record in the doctor profile query when sorted by order index.
- **Assertion**: Doctor poster must not be displayed on public views.
- **Assertion**: Unpublished doctors must not appear in public schedule lookups or search results.

### 4.2 Past-Date & Holiday Rejection
- **Test ID**: `TC-BOOK-01`
- **Assertion**: Any date prior to current Asia/Kolkata date must be rejected with HTTP 400 and bilingual error message.
- **Assertion**: Configured hospital holidays must block slot reservations.

### 4.3 Slot Collision & Database Constraints
- **Test ID**: `TC-DB-01`
- **Assertion**: Unique composite index `(doctor_id, appointment_date, appointment_time)` prevents simultaneous duplicate active slots at the database storage engine layer.
- **Assertion**: Cancelled appointments release the slot for future bookings.

---

## 5. Tier 4: Security & RBAC Integration Tests

### 5.1 Role-Based Access Control
- **Test ID**: `TC-SEC-01`
- **Scenarios**:
  - Unauthenticated access to `/admin/*` redirects to `/admin/login`.
  - Receptionist role can view and update appointment statuses but cannot access user management, audit logs, or system settings.
  - Clinician role accesses only their personal doctor schedule and patient names without phone numbers.
  - Super Administrator has full access including staff account provisioning and configuration.

### 5.2 CSRF & Secure Cookie Flags
- **Test ID**: `TC-SEC-02`
- **Assertion**: State-changing POST/PUT requests without a valid CSRF token in header or body fail with HTTP 403.
- **Assertion**: Session cookies have `HttpOnly`, `SameSite=Strict`, and `Secure` attributes enabled in production.

### 5.3 Injection Resistance
- **Test ID**: `TC-SEC-03`
- **Assertion**: Storing strings like `<script>alert(1)</script>` or `'; DROP TABLE appointments; --` is safely parameterized, stored inertly, and escaped upon HTML rendering.
- **Assertion**: CSV exports prepend `'` to formula trigger characters (`=`, `+`, `-`, `@`) preventing spreadsheet execution.

---

## 6. Tier 5: Concurrency & Stress Testing

### 6.1 Simultaneous Slot Competition
- **Test ID**: `TC-PERF-01`
- **Methodology**: 20 asynchronous requests initiated within the same millisecond targeting the identical doctor, date, and slot.
- **Expected Result**: Exactly 1 request succeeds with status `Pending` and receives a unique booking reference; 19 requests receive HTTP 409 or slot unavailable error.

### 6.2 Concurrent Queue Dispatchers
- **Test ID**: `TC-PERF-02`
- **Methodology**: 10 background worker threads concurrently polling the pending notification table.
- **Expected Result**: Row-level locking and atomic status update ensure zero duplicate emails or SMS dispatches.

---

## 7. Tier 6: Post-Deployment Smoke Test Protocol

Immediately upon deploying to Render or Vercel, run the following smoke suite:
1. `GET /health` -> Must return HTTP 200 and `{ "status": "healthy", "ok": true }`.
2. `GET /en` -> Must return HTTP 200 with complete header, doctor list, and logos.
3. `GET /hi` -> Must return HTTP 200 with complete Hindi localization.
4. `GET /en/doctors` -> Verify Dr. Gajraj Yadav is displayed first.
5. `GET /static/images/hospital-logo.jpg` -> Must return HTTP 200 with image headers.
6. `GET /static/images/trust-logo.png` -> Must return HTTP 200 with image headers.
7. `OPTIONS /health` -> Must return HTTP 204 with CORS `Access-Control-Allow-Origin`.

---

## 8. Test Execution Commands

```bash
# Execute entire test suite
npm test

# Run individual test suites
node --test test/public.test.js
node --test test/booking.test.js
node --test test/admin.test.js
node --test test/concurrency-and-email.test.js
node --test test/sms.test.js
```
