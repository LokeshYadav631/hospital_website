'use strict';
// High concurrency, dual notification (SMS + Email), and high-complexity boundary testing suite.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

let smsGateway, emailGateway, smsCalls = [], emailCalls = [];
let smsMode = 'ok', emailMode = 'ok';
let H, notifications, appts, smsProviders, emailProviders;

before(async () => {
  // 1. Mock SMS Gateway
  smsGateway = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      smsCalls.push({ headers: req.headers, body: JSON.parse(b || '{}') });
      if (smsMode === 'ok') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message_id: 'sms-gw-' + smsCalls.length }));
      } else if (smsMode === 'temp') {
        res.writeHead(503); res.end('gateway busy');
      } else {
        res.writeHead(400); res.end('invalid destination');
      }
    });
  });
  await new Promise((r) => smsGateway.listen(0, '127.0.0.1', r));

  // 2. Mock Email Gateway
  emailGateway = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      emailCalls.push({ headers: req.headers, body: JSON.parse(b || '{}') });
      if (emailMode === 'ok') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message_id: 'email-gw-' + emailCalls.length }));
      } else if (emailMode === 'temp') {
        res.writeHead(503); res.end('mail queue busy');
      } else {
        res.writeHead(400); res.end('invalid recipient email');
      }
    });
  });
  await new Promise((r) => emailGateway.listen(0, '127.0.0.1', r));

  process.env.SMS_PROVIDER = 'http';
  process.env.SMS_HTTP_URL = `http://127.0.0.1:${smsGateway.address().port}/sms`;
  process.env.SMS_HTTP_TOKEN = 'secret-sms-token';
  process.env.SMS_WEBHOOK_SECRET = 'sms-hook-secret';

  process.env.EMAIL_PROVIDER = 'http';
  process.env.EMAIL_HTTP_URL = `http://127.0.0.1:${emailGateway.address().port}/email`;
  process.env.EMAIL_HTTP_TOKEN = 'secret-email-token';
  process.env.EMAIL_WEBHOOK_SECRET = 'email-hook-secret';

  H = require('./helpers');
  const config = require('../src/lib/config');
  config.trustProxy = true; // allow x-forwarded-for simulation for concurrent multi-user testing
  notifications = require('../src/services/notifications');
  appts = require('../src/services/appointments');
  smsProviders = require('../src/services/sms-providers');
  emailProviders = require('../src/services/email-providers');
  notifications.state.auto = false;
});

after(() => {
  smsGateway.closeAllConnections(); smsGateway.close();
  emailGateway.closeAllConnections(); emailGateway.close();
});

beforeEach(() => {
  smsCalls = []; emailCalls = [];
  smsMode = 'ok'; emailMode = 'ok';
  H.clock.setNow(H.NOW);
  smsProviders.setProvider(undefined);
  emailProviders.setProvider(undefined);
});

async function setup() {
  const app = await H.boot();
  const c = new H.Client(app.base);
  return {
    app,
    c,
    book: async (extra = {}) => c.post('/en/appointment', H.consultForm(app.db, extra)),
  };
}

const rows = (db, sql = 'SELECT * FROM notifications ORDER BY id') => H.all(db, sql);

// =========================================================================
// SECTION 1: Dual Notifications (SMS + Email) Full Lifecycle & Edge Cases
// =========================================================================

test('Dual Notification: booking with phone & email queues BOTH channels with distinct idempotency keys', async () => {
  const { app, book } = await setup();
  const r = await book({
    patient_name: 'Amitabh Bachchan',
    mobile: '9876543210',
    email: 'amitabh.bachchan@example.com',
    sms_consent: '1',
  });
  assert.equal(r.status, 303);

  const notifs = rows(app.db);
  assert.equal(notifs.length, 2, 'Should queue exactly 1 SMS and 1 Email');

  const sms = notifs.find((n) => n.channel === 'sms');
  const email = notifs.find((n) => n.channel === 'email');

  assert.ok(sms, 'SMS record must exist');
  assert.ok(email, 'Email record must exist');
  assert.equal(sms.to_mobile, '9876543210');
  assert.equal(email.to_email, 'amitabh.bachchan@example.com');
  assert.match(email.subject, /Appointment Request Received/);
  assert.match(email.body, /Amitabh Bachchan/);
  assert.match(email.body, /SKH-/);
  assert.notEqual(sms.idempotency_key, email.idempotency_key);
  assert.ok(email.idempotency_key.endsWith(':email'));

  await app.close();
});

test('Dual Delivery: dispatchDue delivers both SMS and Email via respective gateways and callbacks confirm delivery', async () => {
  const { app, book, c } = await setup();
  await book({
    patient_name: 'Priya Sharma',
    mobile: '9822334455',
    email: 'priya.sharma@example.test',
    sms_consent: '1',
  });

  const res = await notifications.dispatchDue(app.db);
  assert.equal(res.attempted, 2);

  assert.equal(smsCalls.length, 1);
  assert.equal(smsCalls[0].body.to, '+919822334455');
  assert.equal(smsCalls[0].headers.authorization, 'Bearer secret-sms-token');

  assert.equal(emailCalls.length, 1);
  assert.equal(emailCalls[0].body.to, 'priya.sharma@example.test');
  assert.equal(emailCalls[0].headers.authorization, 'Bearer secret-email-token');

  const notifs = rows(app.db);
  const sms = notifs.find((n) => n.channel === 'sms');
  const email = notifs.find((n) => n.channel === 'email');
  assert.equal(sms.status, 'submitted');
  assert.equal(email.status, 'submitted');

  // Verify Webhook for SMS
  const smsHook = await c.req('POST', '/api/sms/webhook', {
    json: { message_id: sms.provider_message_id, status: 'delivered' },
    headers: { 'x-webhook-secret': 'sms-hook-secret' },
  });
  assert.equal(smsHook.status, 200);

  // Verify Webhook for Email
  const emailHook = await c.req('POST', '/api/email/webhook', {
    json: { message_id: email.provider_message_id, status: 'delivered' },
    headers: { 'x-webhook-secret': 'email-hook-secret' },
  });
  assert.equal(emailHook.status, 200);

  const updated = rows(app.db);
  assert.equal(updated.find((n) => n.channel === 'sms').status, 'delivered');
  assert.equal(updated.find((n) => n.channel === 'email').status, 'delivered');

  await app.close();
});

test('Dual Status Workflow: Confirm, Reschedule, and Cancel dispatch notifications to both channels', async () => {
  const { app, book } = await setup();
  const docId = H.addDoctor(app.db);
  await book({
    patient_name: 'Rahul Dravid',
    mobile: '9811223344',
    email: 'rahul.dravid@cricket.test',
    doctor_id: String(docId),
    slot_time: '10:00',
    sms_consent: '1',
  });

  const a = H.get(app.db, 'SELECT * FROM appointments LIMIT 1');
  appts.changeStatusAndNotify(app.db, { id: a.id, action: 'confirm', user: null });
  appts.changeStatusAndNotify(app.db, { id: a.id, action: 'reschedule', user: null, date: H.TUESDAY, time: '10:15' });
  appts.changeStatusAndNotify(app.db, { id: a.id, action: 'cancel', user: null, reason: 'Patient requested cancellation' });

  const notifs = rows(app.db);
  assert.equal(notifs.length, 8, '4 events * 2 channels = 8 notifications');
  const events = [...new Set(notifs.map((n) => n.event))];
  assert.deepEqual(events, ['received', 'confirmed', 'rescheduled', 'cancelled']);

  await app.close();
});

test('Reminders: generates both SMS and Email reminders for tomorrow confirmed appointments', async () => {
  const { app, book } = await setup();
  const docId = H.addDoctor(app.db);
  H.clock.setNow('2026-10-12T04:00:00Z'); // Appointment is Tuesday 13 Oct = tomorrow

  await book({
    patient_name: 'Sunita Williams',
    mobile: '9877001122',
    email: 'sunita.williams@space.test',
    doctor_id: String(docId),
    slot_time: '10:15',
    sms_consent: '1',
  });
  const a = H.get(app.db, 'SELECT * FROM appointments LIMIT 1');
  appts.changeStatusAndNotify(app.db, { id: a.id, action: 'confirm', user: null });

  H.run(app.db, "UPDATE hospital_settings SET value='1' WHERE key='sms_reminders_enabled'");
  const remindersCount = notifications.queueReminders(app.db);
  assert.equal(remindersCount, 2, 'Should queue 1 SMS and 1 Email reminder');

  const notifs = rows(app.db, "SELECT * FROM notifications WHERE event='reminder'");
  assert.equal(notifs.length, 2);
  assert.ok(notifs.some((n) => n.channel === 'sms'));
  assert.ok(notifs.some((n) => n.channel === 'email'));

  // Calling queueReminders a second time must produce 0 due to idempotency
  assert.equal(notifications.queueReminders(app.db), 0);

  await app.close();
});

test('Email Gateway Retry with Exponential Backoff', async () => {
  const { app, book } = await setup();
  await book({
    patient_name: 'Anil Kumble',
    mobile: '9876543210',
    email: 'anil@kumble.test',
    sms_consent: '1',
  });

  emailMode = 'temp'; // Email gateway fails with 503
  await notifications.dispatchDue(app.db);

  const notifs = rows(app.db);
  const sms = notifs.find((n) => n.channel === 'sms');
  const email = notifs.find((n) => n.channel === 'email');
  assert.equal(sms.status, 'submitted');
  assert.equal(email.status, 'retry');
  assert.equal(email.attempts, 1);
  assert.ok(email.next_attempt_at > H.clock.sqlNow());

  // Recover email gateway and advance clock past backoff
  emailMode = 'ok';
  H.clock.setNow('2026-10-12T05:00:00Z');
  await notifications.dispatchDue(app.db);

  const recovered = rows(app.db).find((n) => n.channel === 'email');
  assert.equal(recovered.status, 'submitted');
  assert.equal(recovered.attempts, 2);

  await app.close();
});

// =========================================================================
// SECTION 2: High Complexity Value Testing & Boundary Conditions
// =========================================================================

test('High Complexity Values: Long Devanagari Hindi Names, Plus-Addressed Emails, Special Characters', async () => {
  const { app, book } = await setup();
  // Name exactly 100 characters in Devanagari & complex characters
  const complexName = 'डॉ. श्रीमान राधेश्याम महाराज - आयुर्वेद एवं शल्यचिकित्सा परामर्श समिति मुंडावर राजस्थान केंद्र';
  const complexEmail = 'patient+hospital.dept1.special-request_2026@sub.regional.sachkhandhospital.org';
  const devanagariPhone = '९८७६५४३२१०'; // Indian Devanagari numerals
  const complexReason = 'विशेष परामर्श: पेट दर्द, पिछले ३ सप्ताह से लगातार असहजता। कृपया वरिष्ठ चिकित्सक से परामर्श कराएँ।';

  const r = await book({
    patient_name: complexName.slice(0, 95),
    mobile: devanagariPhone,
    email: complexEmail,
    reason: complexReason,
    language: 'hi',
    sms_consent: '1',
  });
  assert.equal(r.status, 303, 'Complex unicode & Devanagari booking should succeed');

  const a = H.get(app.db, 'SELECT * FROM appointments LIMIT 1');
  assert.equal(a.mobile, '9876543210', 'Devanagari phone digits normalised to ASCII');
  assert.equal(a.email, complexEmail);
  assert.equal(a.language, 'hi');

  const notifs = rows(app.db);
  const emailNotif = notifs.find((n) => n.channel === 'email');
  assert.match(emailNotif.subject, /सचखंड हॉस्पिटल: अपॉइंटमेंट अनुरोध प्राप्त हुआ/);
  assert.match(emailNotif.body, /सराय रोड, मुंडावर/);

  await app.close();
});

test('Security & Injection Boundary: XSS & SQLi payloads stored inertly and rendered safe in notifications', async () => {
  const { app, book } = await setup();
  const xssName = "John <script>alert('xss')</script>";
  // Name with < > should fail server validation
  const bad = await book({ patient_name: xssName });
  assert.equal(bad.status, 422, 'Names containing < or > are rejected by validation');

  // SQL injection string in reason and email plus-alias
  const sqliReason = "Normal reason'; DROP TABLE appointments; SELECT * FROM users WHERE '1'='1";
  const ok = await book({
    patient_name: "O'Connor Jr.",
    email: "valid.user+drop_table@example.com",
    reason: sqliReason,
    sms_consent: '1',
  });
  assert.equal(ok.status, 303);

  // Database must still have its tables intact
  const tableCheck = H.get(app.db, "SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='appointments'");
  assert.equal(tableCheck.c, 1, 'Appointments table must exist and not be dropped');

  const saved = H.get(app.db, "SELECT * FROM appointments WHERE patient_name=?", "O'Connor Jr.");
  assert.equal(saved.reason, sqliReason);

  await app.close();
});

// =========================================================================
// SECTION 3: High Concurrency & Multi-User Load Simulation
// =========================================================================

test('Concurrency: 20 simultaneous simulated users competing for the SAME slot - exactly 1 wins, 19 rejected', async () => {
  const { app } = await setup();
  const docId = H.addDoctor(app.db);

  // Prepare 20 distinct simulated clients
  const numUsers = 20;
  const clients = Array.from({ length: numUsers }, () => new H.Client(app.base));

  // Concurrently fetch the appointment page to acquire separate sessions & CSRF tokens
  const tokens = await Promise.all(clients.map(async (cl, i) => {
    const page = await cl.req('GET', '/en/appointment', { headers: { 'x-forwarded-for': `198.51.100.${i + 1}` } });
    return (/name="_csrf" value="([^"]+)"/.exec(page.text) || [])[1] || '';
  }));

  // Simultaneous POST requests aiming for the EXACT SAME doctor and time slot (Tuesday 10:00)
  const results = await Promise.all(clients.map((cl, i) => {
    return cl.req('POST', '/en/appointment', {
      headers: { 'x-forwarded-for': `198.51.100.${i + 1}` },
      form: {
        _csrf: tokens[i],
        department_id: String(H.dept(app.db, 'medicine').id),
        doctor_id: String(docId),
        preferred_date: H.TUESDAY,
        slot_time: '10:00',
        patient_name: `Concurrent User ${i + 1}`,
        mobile: `98765432${String(i).padStart(2, '0')}`,
        email: `user${i + 1}@loadtest.test`,
        age: '30',
        gender: 'male',
        patient_type: 'new',
        language: 'en',
        sms_consent: '1',
      },
    });
  }));

  const successes = results.filter((r) => r.status === 303);
  const rejections = results.filter((r) => r.status === 409);

  assert.equal(successes.length, 1, 'Strictly 1 booking must succeed for the contested slot');
  assert.equal(rejections.length, numUsers - 1, 'All other 19 concurrent contenders must be rejected with 409');

  // Verify database integrity
  const booked = H.all(app.db, "SELECT * FROM appointments WHERE doctor_id=? AND slot_start LIKE ?", docId, `${H.TUESDAY} 10:00%`);
  assert.equal(booked.length, 1, 'Database must have exactly 1 record for this slot');

  await app.close();
});

test('Concurrency: 25 simultaneous users booking distinct consultation and diagnostic appointments', async () => {
  const { app } = await setup();
  const numUsers = 25;
  const clients = Array.from({ length: numUsers }, () => new H.Client(app.base));

  // Acquire tokens
  const tokens = await Promise.all(clients.map(async (cl, i) => {
    const page = await cl.req('GET', '/en/appointment', { headers: { 'x-forwarded-for': `198.51.101.${i + 1}` } });
    return (/name="_csrf" value="([^"]+)"/.exec(page.text) || [])[1] || '';
  }));

  // Concurrently fire 25 bookings across different departments without specific slot holding
  const results = await Promise.all(clients.map((cl, i) => {
    return cl.req('POST', '/en/appointment', {
      headers: { 'x-forwarded-for': `198.51.101.${i + 1}` },
      form: {
        _csrf: tokens[i],
        department_id: String(H.dept(app.db, 'medicine').id),
        preferred_date: H.TUESDAY,
        preferred_range: i % 2 === 0 ? 'morning' : 'afternoon',
        patient_name: `Multi User ${i + 1}`,
        mobile: `99001122${String(i).padStart(2, '0')}`,
        email: `multiuser${i + 1}@testing.test`,
        age: '28',
        gender: 'female',
        patient_type: 'new',
        language: 'en',
        sms_consent: '1',
      },
    });
  }));

  for (const r of results) {
    assert.equal(r.status, 303, 'Every distinct booking request should succeed');
  }

  const allBookings = H.all(app.db, "SELECT id, ref FROM appointments");
  assert.equal(allBookings.length, numUsers);

  // All references must be unique
  const refs = new Set(allBookings.map((b) => b.ref));
  assert.equal(refs.size, numUsers, 'All booking references generated under load must be unique');

  await app.close();
});

test('Concurrency: 10 concurrent notification dispatchers compete to process queued items - no duplicates', async () => {
  const { app, book } = await setup();

  // Queue 10 appointments (each generates 1 SMS and 1 Email = 20 total notification rows)
  for (let i = 0; i < 10; i++) {
    await book({
      patient_name: `Queue Patient ${i}`,
      mobile: `98000000${String(i).padStart(2, '0')}`,
      email: `patient${i}@dispatch.test`,
      sms_consent: '1',
    });
  }

  const queuedTotal = H.get(app.db, "SELECT COUNT(*) c FROM notifications WHERE status='queued'").c;
  assert.equal(queuedTotal, 20);

  // Launch 10 concurrent dispatchers in parallel
  await Promise.all(Array.from({ length: 10 }, () => notifications.dispatchDue(app.db)));

  // Gateways should have received exactly 10 SMS calls and 10 Email calls
  assert.equal(smsCalls.length, 10, 'SMS gateway must receive each message once');
  assert.equal(emailCalls.length, 10, 'Email gateway must receive each message once');

  // All 20 items in the database must now be 'submitted'
  const submittedCount = H.get(app.db, "SELECT COUNT(*) c FROM notifications WHERE status='submitted'").c;
  assert.equal(submittedCount, 20, 'All 20 queued notifications must be marked submitted');

  await app.close();
});
