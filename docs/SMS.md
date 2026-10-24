# SMS notifications

**Default: disabled.** With `SMS_PROVIDER=none` nothing is ever sent. Each consented event is recorded as `not_configured`, and patients are shown their booking reference and the hospital phone numbers on screen.

## Events
Request received · confirmed · rescheduled · cancelled · reminder (the day before, only if enabled in Admin → Settings *and* the patient consented). Messages are short fixed templates in Hindi or English (`src/services/notifications.js`); they never contain diagnosis, reason for visit or department. In India, bulk/transactional SMS normally requires **DLT registration** of the sender ID and each template with your operator/gateway — register these texts before enabling.

## Lifecycle and what each status means
`not_configured` (disabled) → `queued` → `sending` → `submitted` (**gateway accepted it; NOT proof of delivery**) → `delivered` (only after the gateway’s callback) · `retry` (temporary error; exponential back-off, max 5 attempts) · `failed` (permanent error or retries exhausted; staff can press *Retry* in Admin → SMS log) · `simulated` (development console provider only).
Messages are queued only **after** the booking/status change has been committed, and each `(appointment, event[, slot])` has a unique idempotency key, so retries and restarts cannot create duplicates.

## Configure a gateway (generic HTTPS/JSON adapter)
Set in `.env` (credentials stay server-side; never in the browser):
```
SMS_PROVIDER=http
SMS_HTTP_URL=https://api.your-gateway.example/v1/messages
SMS_HTTP_TOKEN=<api token>
SMS_SENDER_ID=<approved sender id>
SMS_WEBHOOK_SECRET=<long random string>
```
The adapter (`src/services/sms-providers.js`) POSTs `Authorization: Bearer <token>` and JSON `{ "to": "+919876543210", "message": "...", "sender_id": "...", "reference": "<idempotency key>" }`, and reads the message id from `message_id`, `messageId` or `id` in the JSON reply. HTTP 429/5xx/timeouts are retried; other 4xx are permanent failures.
Most Indian gateways (MSG91, Twilio, Gupshup, Fast2SMS, …) use a different request shape: **add a small provider object** in `sms-providers.js` with a `send({to, body, reference})` method returning `{ok:true,messageId}` or `{ok:false,temporary,error}` and select it in `getProvider()`. Keep the rest unchanged.

## Delivery callbacks
Configure the gateway to POST status updates to `https://your-domain/api/sms/webhook` with header `X-Webhook-Secret: <SMS_WEBHOOK_SECRET>` and JSON `{ "message_id": "...", "status": "delivered" | "failed", "error": "..." }`. Adapt the field names in `src/web/public-routes.js` if your gateway differs.

## Go-live test
1. Enable with a test mobile number you own. 2. Submit a request with the consent box ticked. 3. Admin → SMS log shows `submitted`, then `delivered` after the callback. 4. Confirm/reschedule/cancel and check each message. 5. Switch the gateway off and confirm bookings still succeed with the on-screen fallback. Until step 3 works, do **not** tell patients they will receive SMS.
