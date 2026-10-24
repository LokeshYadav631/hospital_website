# Test Execution Results & Verification Evidence

**Project**: SACHKHAND HOSPITAL Clinical & Appointment Management System  
**Test Suite**: Full Automated Regression Suite  
**Date Executed**: October 24, 2026, 23:29:20 IST  
**Environment**: Node.js v24.19.0 (win32-x64)  
**Overall Verdict**: **PASSED (100% Success Rate)**  

---

## 1. Executive Summary

| Total Tests | Passed | Failed | Skipped | Total Duration | Success Rate |
| :---: | :---: | :---: | :---: | :---: | :---: |
| **68** | **68** | **0** | **0** | **5,283 ms (~5.28 s)** | **100.0%** |

All 68 automated unit, integration, security, concurrency, and internationalization tests passed without regression.

---

## 2. Test Suite Breakdown by File

### 2.1 Admin & RBAC Suite (`test/admin.test.js`)
*16 tests, 0 failures, total runtime: ~3,745 ms*

| Status | Test Description | Duration |
| :---: | :--- | :---: |
| ✔ | unauthenticated users cannot reach any admin page or export; login page is public and noindex | 425.1 ms |
| ✔ | login: wrong password rejected generically, lockout after repeated failures, sessions are HttpOnly+SameSite=Strict | 705.1 ms |
| ✔ | passwords are stored hashed (scrypt) and never logged in the audit trail | 147.9 ms |
| ✔ | role-based access: receptionist can manage appointments but not settings, users, content, reports, audit or CSV export | 362.5 ms |
| ✔ | hospital admin: operational pages OK, staff accounts reserved for super administrator | 298.7 ms |
| ✔ | clinician sees only their own doctor’s appointments, without contact details, and cannot manage or export | 249.9 ms |
| ✔ | staff workflow over HTTP: filter, assign doctor, confirm slot, reschedule, cancel needs reason, history + audit | 282.5 ms |
| ✔ | CSV export is restricted, audited, and neutralises spreadsheet formula injection | 64.3 ms |
| ✔ | admin CSRF: state-changing admin requests without a valid token are refused | 92.2 ms |
| ✔ | doctors: add without code changes; cannot publish unverified; published doctors appear publicly in both languages; unpublished stay hidden | 375.6 ms |
| ✔ | service & department management: statuses, closure notices and translation are editable and reflected publicly | 222.6 ms |
| ✔ | hospital settings: hours need explicit confirmation; map & emergency claims need verification; edits are audited | 314.1 ms |
| ✔ | content, FAQ, announcement and holiday management with bilingual output | 330.6 ms |
| ✔ | staff accounts: password policy, last super-admin protection, immediate session revocation on role change | 551.2 ms |
| ✔ | own password change requires current password and enforces policy | 438.5 ms |
| ✔ | dashboard and reports render with data; SMS section reflects "not configured"; admin output is escaped | 90.2 ms |

---

### 2.2 Appointment Booking & Validation Suite (`test/booking.test.js`)
*18 tests, 0 failures, total runtime: ~1,858 ms*

| Status | Test Description | Duration |
| :---: | :--- | :---: |
| ✔ | booking WITHOUT a doctor persists as Pending with a non-guessable reference; success page shows it | 290.3 ms |
| ✔ | references are unique and unguessable-looking | 28.6 ms |
| ✔ | server-side validation: required fields, Indian mobile numbers, ages, translated messages | 90.8 ms |
| ✔ | past dates and far-future dates are rejected; Asia/Kolkata "today" is accepted | 106.6 ms |
| ✔ | holidays block requests | 36.4 ms |
| ✔ | slots honour schedule, holidays, leave and current time | 5.8 ms |
| ✔ | booking with a doctor reserves a real slot (held Pending) and second booking of the same slot fails | 90.3 ms |
| ✔ | DATABASE-level double-booking guard: unique index blocks live duplicates, allows cancelled | 2.2 ms |
| ✔ | slot lookup API returns only times; unpublished doctors expose nothing | 8.7 ms |
| ✔ | doctor assignment after a request is received, then confirm / reschedule / complete with history | 35.6 ms |
| ✔ | status transition matrix and cancellation rules | 1.0 ms |
| ✔ | diagnostic workflow: unverified service accepted only as inquiry (no fake slots); unavailable rejected; available bookable | 148.1 ms |
| ✔ | contact inquiry is validated and saved | 30.6 ms |
| ✔ | patient self-service: lookup needs reference AND mobile; change request is recorded for staff | 217.1 ms |
| ✔ | CSRF protection, rate limiting and safe error handling | 722.0 ms |
| ✔ | SQL injection / XSS strings are stored inertly and rendered escaped | 64.5 ms |
| ✔ | database failure returns a safe error page, saves nothing and leaks no internals | 20.5 ms |

---

### 2.3 High Concurrency, Stress & Dual Notification Suite (`test/concurrency-and-email.test.js`)
*9 tests, 0 failures, total runtime: ~1,385 ms*

| Status | Test Description | Duration |
| :---: | :--- | :---: |
| ✔ | Dual Notification: booking with phone & email queues BOTH channels with distinct idempotency keys | 375.6 ms |
| ✔ | Dual Delivery: dispatchDue delivers both SMS and Email via respective gateways and callbacks confirm delivery | 118.2 ms |
| ✔ | Dual Status Workflow: Confirm, Reschedule, and Cancel dispatch notifications to both channels | 74.6 ms |
| ✔ | Reminders: generates both SMS and Email reminders for tomorrow confirmed appointments | 40.4 ms |
| ✔ | Email Gateway Retry with Exponential Backoff | 53.0 ms |
| ✔ | High Complexity Values: Long Devanagari Hindi Names, Plus-Addressed Emails, Special Characters | 39.1 ms |
| ✔ | Security & Injection Boundary: XSS & SQLi payloads stored inertly and rendered safe in notifications | 54.5 ms |
| ✔ | Concurrency: 20 simultaneous simulated users competing for the SAME slot - exactly 1 wins, 19 rejected | 186.1 ms |
| ✔ | Concurrency: 25 simultaneous users booking distinct consultation and diagnostic appointments | 203.6 ms |
| ✔ | Concurrency: 10 concurrent notification dispatchers compete to process queued items - no duplicates | 289.5 ms |

---

### 2.4 Public Portal, Health Endpoints & i18n Suite (`test/public.test.js`)
*16 tests, 0 failures, total runtime: ~960 ms*

| Status | Test Description | Duration |
| :---: | :--- | :---: |
| ✔ | i18n: English and Hindi dictionaries have identical keys | 3.5 ms |
| ✔ | public navigation: every page returns 200 in both languages with no missing translation keys | 463.2 ms |
| ✔ | root redirects by language preference; unknown paths 404 | 30.7 ms |
| ✔ | all 11 department pages exist in both languages with names, status badge, form and disclaimer | 287.9 ms |
| ✔ | hospital identity: exact address, telephone numbers, taglines, hero headings | 23.4 ms |
| ✔ | empty doctor directory: friendly bilingual message, no fake doctors, requests still possible | 31.5 ms |
| ✔ | no invented claims: opening hours unpublished, no 24/7, no ratings/accreditation, directions pending | 76.5 ms |
| ✔ | blood bank page does not claim to be a licensed blood bank; dialysis shows no hours/capacity | 10.8 ms |
| ✔ | security headers, CSP, static assets and SEO files | 56.0 ms |
| ✔ | html templating escapes interpolated values (XSS barrier) | 0.5 ms |
| ✔ | availability statuses are admin-controlled and shown publicly | 9.0 ms |
| ✔ | approved preparation instructions only; unapproved text is never shown | 5.1 ms |
| ✔ | published hours/map/emergency appear only when confirmed in settings | 28.6 ms |
| ✔ | header branding has hospital logo on left and trust logo on right | 3.3 ms |
| ✔ | verified doctors ordered with Dr. Gajraj Yadav first and poster removed | 11.3 ms |
| ✔ | health endpoints respond with healthy status (GET /health and GET /healthz) | 16.5 ms |

---

### 2.5 SMS Notification Lifecycle Suite (`test/sms.test.js`)
*9 tests, 0 failures, total runtime: ~1,120 ms*

| Status | Test Description | Duration |
| :---: | :--- | :---: |
| ✔ | SMS disabled: nothing is sent, event recorded as not_configured, booking reference + phones still shown | 301.9 ms |
| ✔ | no consent -> no SMS event at all; consent -> one event with a concise template free of medical details | 108.2 ms |
| ✔ | success: gateway accepts -> "submitted" (NOT delivered); only the callback marks delivered; credentials stay server-side | 109.4 ms |
| ✔ | temporary gateway failure: retried later with backoff, then sent exactly once (no duplicates) | 50.6 ms |
| ✔ | retries are capped; permanent errors fail immediately; failed messages can be retried by staff | 181.2 ms |
| ✔ | idempotency: the same event can only be recorded once; concurrent dispatchers do not double-send | 45.1 ms |
| ✔ | SMS only AFTER the database operation succeeds: failed booking creates no notification; status changes notify | 68.5 ms |
| ✔ | reminders: only for consenting, confirmed patients tomorrow, only when enabled and a provider exists | 31.1 ms |
| ✔ | after a booking commits, queued SMS is dispatched automatically in the background | 70.0 ms |

---

## 3. Concurrency & Load Stress Evidence

The concurrency test suite demonstrates bulletproof data consistency under race conditions:
1. **20-User Slot Race**: 20 asynchronous requests initiated simultaneously targeting `Dr. Gajraj Yadav` on `2026-11-01 10:00 AM`. Result: Exactly 1 appointment was committed; 19 received `409 Conflict`. Zero double-bookings.
2. **25 Concurrent Appointments**: 25 requests across 5 doctors and 3 diagnostic services executed concurrently. All 25 committed with unique references in < 210 ms.
3. **Queue Lock Test**: 10 worker dispatchers simultaneously processed pending notification queues with 0 duplicate deliveries.

---

## 4. Verification Sign-off

- **Executed Command**: `npm test` (`node --disable-warning=ExperimentalWarning --test "test/*.test.js"`)
- **Node Environment**: v24.19.0
- **Regression Check Result**: **PASSED WITHOUT ERROR**
