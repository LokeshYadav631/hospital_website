# Testing

## Automated (`npm test`, 55 tests, synthetic data only, in-memory database)
`test/public.test.js` navigation, languages, 11 departments, empty doctor directory, no invented claims, SEO/security headers, escaping
`test/booking.test.js` booking with/without doctor, validation, past dates, holidays, slots/schedule/leave, double booking (app + DB), assignment, transitions, diagnostics, patient lookup/change requests, CSRF, rate limit, injection strings, database failure
`test/sms.test.js` disabled fallback, consent, templates, submitted vs delivered, webhook auth, retry/back-off/caps, idempotency, concurrency, notify-after-commit, reminders
`test/admin.test.js` unauthenticated access, login/lockout, hashing/audit, role matrix, clinician scoping, staff workflow, CSV safety, CSRF, doctors/services/settings/content management, staff accounts, password change

## Manual checklist (not automatable here)
**Devices:** 360 px phone, 768 px tablet, ≥1280 px desktop; Chrome, Safari, Firefox. No horizontal scroll; mobile menu opens/closes by keyboard; tap targets ≥ 44 px.
**Hindi:** all pages in Hindi render with Noto Sans Devanagari, nothing clipped, language switch keeps the same page; native speaker reads every page.
**Accessibility:** tab through every form (visible focus), screen-reader announces errors (error summary has `role=alert`), labels present, contrast OK (run Lighthouse/axe), 200 % zoom usable.
**Performance:** Lighthouse mobile on `/en/` and a department page (pages are server-rendered, ~15 KB HTML; check font loading on slow 3G).
**Booking:** submit with/without doctor; check success page; look up status; ask for change; staff confirm → status shows confirmed time.
**Admin:** try each role (receptionist, clinician, admin) against the permission list in `SECURITY-PRIVACY.md`.
**Backups:** run `npm run backup`, restore to a scratch server, sign in.
**SMS (when enabled):** see the go-live test in `docs/SMS.md`.
