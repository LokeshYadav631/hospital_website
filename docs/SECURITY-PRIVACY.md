# Security & privacy

## Implemented controls
* **Auth:** scrypt password hashing (per-user salt); sessions are random 256-bit tokens, only their SHA-256 hash is stored; cookies `HttpOnly`, `SameSite=Strict` (admin), `Secure` in production; 8-hour expiry; account lock after 5 failed logins (15 min) plus per-IP login rate limit; password policy ≥ 12 chars; changing role/active/password immediately revokes sessions; the last super administrator cannot be removed.
* **Authorization:** server-side role checks on every admin route (`src/web/admin-ui.js` → `PERMS`); clinicians are limited to their linked doctor’s appointments and see no phone/email.
* **Input/Output:** all input validated on the server (mobile numbers, dates, enums, lengths); parameterised SQL everywhere; every template value HTML-escaped; strict CSP (no inline scripts), `X-Frame-Options: DENY`, `nosniff`, referrer policy, HSTS in production; CSV export neutralises formula injection.
* **CSRF:** HMAC token bound to an anonymous cookie on every POST (except the secret-authenticated SMS webhook).
* **Abuse:** in-memory rate limits on booking, inquiry, status lookup, slots, login, password change. (Single instance only — use your proxy/Cloudflare for more.)
* **Privacy by design:** minimal fields; no medical-file upload; no public patient endpoints; status lookup requires reference **and** mobile and gives an identical error for either mistake; references are non-guessable and not placed in URLs (success page uses a short-lived signed cookie); SMS contains no medical details; passwords/tokens never written to the audit log.
* **Audit log:** sign-ins, appointment actions, exports, prints, doctor/service/settings/content/user changes (who, what, when, IP).

## Your responsibilities before launch
1. **DPDP Act 2023 / IT Rules:** appointment data (name, mobile, age, reason) is personal and some of it health-related. Have counsel confirm lawful basis/consent wording, a notice in Hindi and English, a grievance contact, breach-response and processor arrangements (hosting, SMS gateway). Review the draft policy text in Admin → Page content.
2. **Retention (suggested — set your own):** keep appointment records for the period the hospital needs them for administration (e.g. 12–24 months), then delete or anonymise; keep audit logs ≥ 12 months; delete inquiries after 6 months; expire backups after 30–90 days. Example purge: `DELETE FROM appointments WHERE created_at < date('now','-24 months');` (cascades history/notifications links), run after a backup.
3. **Access hygiene:** one account per person, remove leavers promptly, least-privilege roles, strong unique passwords (add 2FA at the proxy/VPN level if possible — not built in).
4. **Infrastructure:** HTTPS only, OS updates, firewall (only 80/443), encrypted off-site backups, tested restore.
5. **Independent security review / penetration test** — none has been performed on this code.
6. Self-host the fonts if you do not want visitors’ browsers contacting Google Fonts (download Inter and Noto Sans Devanagari into `public/` and adjust the CSP in `src/web/http.js`).
