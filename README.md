# SACHKHAND HOSPITAL — website & appointment management

Bilingual (Hindi / English) hospital website with a real backend, database, staff dashboard, appointment workflows and an SMS abstraction.
Hospital: **SACHKHAND HOSPITAL**, Sarai Road, Mundawar, District Khairthal-Tijara, Rajasthan 301707 · 01494-246333 · 09799107439 · managed by Sachkhand Charitable Trust.

## Quick start (3 commands)

Requires **Node.js 22.13 or newer**. No `npm install` is needed: the project has **zero dependencies** (it uses Node's built-in HTTP server and SQLite).

```bash
cp .env.example .env          # optional for local use; required SESSION_SECRET in production
npm run migrate               # creates ./data/hospital.db, applies migrations, loads the 11 departments / FAQs / content
npm run create-admin          # secure prompt for the first super administrator
npm start                     # http://localhost:3000  (admin: http://localhost:3000/admin)
```

`npm test` runs the automated suite (55 tests, ~5 s). `npm run backup` writes a consistent database copy to `./backups`.

## What is built

| Area | Status |
|---|---|
| Public pages (EN + HI): home, about, departments index, **11 department pages**, doctors, diagnostics, contact, appointment, status lookup, privacy, terms | Working |
| Doctor consultation requests — with or without a doctor; real slots only when a doctor has a schedule | Working |
| Diagnostic requests — unverified services accept an *inquiry* only; unavailable/not-offered are refused | Working |
| Booking reference (`SKH-XXXX-XXXX`), status history, status workflow (Pending → Confirmed → Rescheduled → Completed / Cancelled / No-show) | Working |
| Double-booking prevention: write-locked transaction + **partial unique index** on (doctor, slot) | Working, tested |
| Patient self-service: status lookup (reference + mobile) and change/cancel *requests* reviewed by staff | Working |
| Admin: dashboard, appointment search/filter/assign/confirm/reschedule/cancel/complete/no-show, print, CSV, doctors (+schedules, leave), departments & services (5 statuses), settings (hours, emergency, map), page content, FAQs, announcements, holidays, reports, SMS log, audit log, staff accounts | Working |
| Roles: super administrator, hospital administrator, receptionist, clinician (sees only their own doctor’s appointments, no phone numbers) | Working, tested |
| SMS: provider abstraction, consent, idempotent queue, retry with backoff, delivery callback, safe fallback | Working against a mock gateway; **not tested with a real provider** |

## Honest status: what is *not* live

* **SMS is off** until you configure a real gateway (`docs/SMS.md`). Until then events are recorded as `not_configured`, nothing is "sent", and patients see their reference on screen with the click-to-call numbers.
* **No opening hours, doctors, emergency claim, map link, founding year, registrations or accreditation are published.** See `docs/PENDING-CONFIRMATION.md` for everything the hospital must confirm. Every department and service starts as **"Availability to be confirmed / उपलब्धता की पुष्टि बाकी है"**.
* Hindi text, mission/vision text, **privacy policy and terms are drafts** and need review by the hospital / a lawyer (`docs/SECURITY-PRIVACY.md`).

## Deviations from the requested stack (please read)

The brief recommended Next.js + TypeScript + Tailwind + Supabase/PostgreSQL on Vercel. This build uses **Node's built-in HTTP server, server-rendered HTML and SQLite (`node:sqlite`)**. Reasons: it was built in an environment without internet access, so packages could not be installed or a Next.js build verified; this stack runs and is fully tested as delivered. Consequences:

* **Vercel is not suitable** (SQLite needs a persistent disk). Deploy to a small VPS, Render/Railway/Fly with a volume, or Docker (`docs/DEPLOYMENT.md`).
* `node:sqlite` is flagged *experimental* by Node 22 (a one-line warning is suppressed in the npm scripts).
* All SQL lives in `src/services` and `src/web`; the schema (`src/migrations/001_init.sql`) is portable. A move to PostgreSQL/Supabase means swapping `src/lib/db.js` and a few SQLite-specific bits (`INSERT OR IGNORE`, `date(...,'+330 minutes')`, partial index syntax is already Postgres-compatible). `docs/DEPLOYMENT.md` lists them.
* Tables `roles`/`user_roles`/`patients` are folded into `users.role` and the appointment row (less patient data stored). `rate limiting` is in-memory (single instance).
* The admin interface is English only (public site is fully bilingual; admin edits both languages).
* No automated browser/responsive/accessibility tests were possible; use `docs/TESTING.md`.
* The poster itself was not available to me, only the text of the brief. The logo (`public/img/logo.svg`) is a simple placeholder, **not** derived from the hospital’s logo, and no stock photography is included (inventing it would violate the brief). Add real, licensed photos via Admin → Hospital settings → homepage photograph URL.

## Project layout

```
src/server.js            entry point          src/migrations/   SQL schema
src/web/                 routes + views       src/data/         seed content (11 departments, FAQs, drafts)
src/services/            appointments, slots, notifications, SMS providers, settings/audit
src/lib/                 db, security (scrypt, sessions, CSRF, rate limit), validation, html escaping
src/i18n/strings.js      Hindi/English UI strings   public/  css, js, logo
scripts/                 migrate, create-admin, backup        test/  55 automated tests
docs/                    DEPLOYMENT, SMS, SECURITY-PRIVACY, PENDING-CONFIRMATION, TESTING
```

## Test coverage vs. the brief

Public navigation, Hindi/English, 11 department pages, empty doctor directory, booking without doctor, doctor assignment after request, diagnostic requests, validation & past dates, double booking (app + database level), schedules/holidays/leave, status transitions, admin authorization & roles, SMS disabled fallback, provider failures/retries/idempotency, database failure handling, CSRF, rate limits, XSS/SQL-injection strings. Mobile/desktop rendering is a manual check.
