'use strict';
// SMS: provider abstraction, disabled fallback, retries, idempotency, delivery callbacks. A local mock gateway stands in for a real provider.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

let gateway, calls = [], mode = 'ok', H, notifications, appts, providers;
before(async () => {
  gateway = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      calls.push({ headers: req.headers, body: JSON.parse(b || '{}') });
      if (mode === 'ok') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message_id: 'gw-' + calls.length })); }
      else if (mode === 'temp') { res.writeHead(503); res.end('busy'); }
      else { res.writeHead(400); res.end('bad number'); }
    });
  });
  await new Promise((r) => gateway.listen(0, '127.0.0.1', r));
  process.env.SMS_PROVIDER = 'http'; process.env.SMS_HTTP_URL = `http://127.0.0.1:${gateway.address().port}/send`;
  process.env.SMS_HTTP_TOKEN = 'secret-token-123'; process.env.SMS_WEBHOOK_SECRET = 'hook-secret';
  H = require('./helpers'); notifications = require('../src/services/notifications'); appts = require('../src/services/appointments'); providers = require('../src/services/sms-providers');
  notifications.state.auto = false; // tests drive dispatch explicitly for determinism
});
after(() => { gateway.closeAllConnections(); gateway.close(); });
beforeEach(() => { calls = []; mode = 'ok'; H.clock.setNow(H.NOW); providers.setProvider(undefined); });

async function setup() {
  const app = await H.boot(); const c = new H.Client(app.base);
  return { app, c, book: async (extra = {}) => { const r = await c.post('/en/appointment', H.consultForm(app.db, extra)); return r; } };
}
const rows = (db, sql = 'SELECT * FROM notifications ORDER BY id') => H.all(db, sql);

test('SMS disabled: nothing is sent, event recorded as not_configured, booking reference + phones still shown', async () => {
  providers.setProvider(null);
  const { app, book, c } = await setup();
  const r = await book({ sms_consent: '1' });
  assert.equal(r.status, 303);
  const n = rows(app.db);
  assert.equal(n.length, 1); assert.equal(n[0].status, 'not_configured'); assert.equal(n[0].attempts, 0); assert.equal(n[0].provider_message_id, null);
  assert.equal((await notifications.dispatchDue(app.db)).attempted, 0);
  assert.equal(calls.length, 0);
  const page = (await c.get(r.location)).text;
  assert.match(page, /SKH-/); assert.match(page, /SMS updates are not available right now/); assert.match(page, /tel:\+911494246333/);
  await app.close();
});

test('no consent -> no SMS event at all; consent -> one event with a concise template free of medical details', async () => {
  const { app, book } = await setup();
  await book({ reason: 'chest pain SECRET-REASON' });
  assert.equal(rows(app.db).length, 0);
  await book({ sms_consent: '1', reason: 'chest pain SECRET-REASON', patient_name: 'Consent Person' });
  const n = rows(app.db); assert.equal(n.length, 1);
  assert.ok(n[0].body.length < 200); assert.ok(!/chest|SECRET|Medicine|medicine/.test(n[0].body)); assert.match(n[0].body, /SKH-/);
  await book({ sms_consent: '1', language: 'hi', patient_name: 'Hindi Person' });
  assert.match(rows(app.db)[1].body, /सचखंड हॉस्पिटल/);
  await app.close();
});

test('success: gateway accepts -> "submitted" (NOT delivered); only the callback marks delivered; credentials stay server-side', async () => {
  const { app, book, c } = await setup();
  const r = await book({ sms_consent: '1' });
  await notifications.dispatchDue(app.db);
  const n = rows(app.db)[0];
  assert.equal(n.status, 'submitted'); assert.equal(n.attempts, 1); assert.ok(n.provider_message_id.startsWith('gw-')); assert.equal(n.delivered_at, null);
  assert.equal(calls.length, 1); assert.equal(calls[0].headers.authorization, 'Bearer secret-token-123'); assert.equal(calls[0].body.to, '+919876543210');
  const page = (await c.get(r.location)).text;
  assert.ok(!page.includes('secret-token-123') && !page.includes(process.env.SMS_HTTP_URL));
  // callback: wrong/missing secret rejected
  const bad = await c.req('POST', '/api/sms/webhook', { json: { message_id: n.provider_message_id, status: 'delivered' }, headers: { 'x-webhook-secret': 'nope' } });
  assert.equal(bad.status, 401); assert.equal((await c.req('POST', '/api/sms/webhook', { json: {} })).status, 401);
  assert.equal(rows(app.db)[0].status, 'submitted');
  const good = await c.req('POST', '/api/sms/webhook', { json: { message_id: n.provider_message_id, status: 'delivered' }, headers: { 'x-webhook-secret': 'hook-secret' } });
  assert.equal(good.status, 200);
  const d = rows(app.db)[0]; assert.equal(d.status, 'delivered'); assert.ok(d.delivered_at);
  await app.close();
});

test('temporary gateway failure: retried later with backoff, then sent exactly once (no duplicates)', async () => {
  const { app, book } = await setup();
  await book({ sms_consent: '1' });
  mode = 'temp'; await notifications.dispatchDue(app.db);
  let n = rows(app.db)[0];
  assert.equal(n.status, 'retry'); assert.equal(n.attempts, 1); assert.match(n.error, /503/); assert.ok(n.next_attempt_at > H.clock.sqlNow());
  assert.equal((await notifications.dispatchDue(app.db)).attempted, 0, 'not due yet: no immediate hammering');
  mode = 'ok'; H.clock.setNow('2026-10-12T04:30:00Z');
  await notifications.dispatchDue(app.db);
  n = rows(app.db)[0]; assert.equal(n.status, 'submitted'); assert.equal(n.attempts, 2);
  const okCalls = calls.length;
  await notifications.dispatchDue(app.db); await notifications.dispatchDue(app.db);
  assert.equal(calls.length, okCalls, 'already-submitted message is never resent');
  await app.close();
});

test('retries are capped; permanent errors fail immediately; failed messages can be retried by staff', async () => {
  const { app, book } = await setup();
  await book({ sms_consent: '1' });
  mode = 'temp';
  for (let i = 0; i < 8; i++) { H.clock.setNow(new Date(Date.parse(H.NOW) + (i + 1) * 3 * 3600e3).toISOString()); await notifications.dispatchDue(app.db); }
  let n = rows(app.db)[0]; assert.equal(n.status, 'failed'); assert.equal(n.attempts, notifications.MAX_ATTEMPTS);
  H.clock.setNow(H.NOW);
  await book({ sms_consent: '1', patient_name: 'Second Person' });
  mode = 'perm'; await notifications.dispatchDue(app.db);
  const second = rows(app.db)[1]; assert.equal(second.status, 'failed'); assert.equal(second.attempts, 1); assert.match(second.error, /400/);
  mode = 'ok'; assert.ok(notifications.retryFailed(app.db, n.id));
  await notifications.dispatchDue(app.db);
  assert.equal(rows(app.db)[0].status, 'submitted');
  await app.close();
});

test('idempotency: the same event can only be recorded once; concurrent dispatchers do not double-send', async () => {
  const { app, book } = await setup();
  await book({ sms_consent: '1' });
  const a = H.get(app.db, 'SELECT * FROM appointments LIMIT 1');
  assert.equal(notifications.queueSms(app.db, a, 'received'), null, 'duplicate event ignored');
  assert.equal(rows(app.db).length, 1);
  const before = calls.length;
  await Promise.all([notifications.dispatchDue(app.db), notifications.dispatchDue(app.db), notifications.dispatchDue(app.db)]);
  assert.ok(calls.length - before <= 1, 'at most one gateway call per message');
  await app.close();
});

test('SMS only AFTER the database operation succeeds: failed booking creates no notification; status changes notify', async () => {
  const { app, book } = await setup();
  const bad = await book({ sms_consent: '1', mobile: '123' });
  assert.equal(bad.status, 422); assert.equal(rows(app.db).length, 0);
  const docId = H.addDoctor(app.db);
  await book({ sms_consent: '1', doctor_id: String(docId), slot_time: '10:00' });
  const dup = await book({ sms_consent: '1', doctor_id: String(docId), slot_time: '10:00', patient_name: 'Other Person' });
  assert.equal(dup.status, 409); assert.equal(rows(app.db).length, 1, 'rolled-back booking leaves no SMS record');
  const a = H.get(app.db, 'SELECT * FROM appointments LIMIT 1');
  appts.changeStatusAndNotify(app.db, { id: a.id, action: 'confirm', user: null });
  appts.changeStatusAndNotify(app.db, { id: a.id, action: 'reschedule', user: null, date: H.TUESDAY, time: '10:15' });
  appts.changeStatusAndNotify(app.db, { id: a.id, action: 'cancel', user: null, reason: 'test' });
  assert.deepEqual(rows(app.db).map((n) => n.event), ['received', 'confirmed', 'rescheduled', 'cancelled']);
  assert.match(rows(app.db)[1].body, /13-10-2026 at 10:00/);
  await app.close();
});

test('reminders: only for consenting, confirmed patients tomorrow, only when enabled and a provider exists', async () => {
  const { app, book } = await setup();
  const docId = H.addDoctor(app.db);
  H.clock.setNow('2026-10-12T04:00:00Z'); // Monday; appointment is Tuesday = tomorrow
  await book({ sms_consent: '1', doctor_id: String(docId), slot_time: '10:30' });
  const a = H.get(app.db, 'SELECT * FROM appointments LIMIT 1');
  appts.changeStatusAndNotify(app.db, { id: a.id, action: 'confirm', user: null });
  assert.equal(notifications.queueReminders(app.db), 0, 'disabled by default');
  H.run(app.db, "UPDATE hospital_settings SET value='1' WHERE key='sms_reminders_enabled'");
  assert.equal(notifications.queueReminders(app.db), 1); assert.equal(notifications.queueReminders(app.db), 0, 'once');
  providers.setProvider(null); assert.equal(notifications.queueReminders(app.db), 0, 'no provider');
  await app.close();
});

test('after a booking commits, queued SMS is dispatched automatically in the background', async () => {
  notifications.state.auto = true;
  try {
    const { app, book } = await setup();
    await book({ sms_consent: '1' });
    for (let i = 0; i < 40 && !calls.length; i++) await new Promise((x) => setTimeout(x, 25));
    assert.equal(calls.length, 1);
    assert.equal(rows(app.db)[0].status, 'submitted');
    await app.close();
  } finally { notifications.state.auto = false; }
});
