'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const appts = require('../src/services/appointments');
const slots = require('../src/services/slots');
const V = require('../src/lib/validation');
const { isUniqueViolation } = require('../src/lib/db');

let app, c;
before(async () => { app = await H.boot(); c = new H.Client(app.base); });
after(() => app.close());
beforeEach(() => { H.sec.resetRateLimits(); H.clock.setNow(H.NOW); });

const count = (sql, ...p) => H.get(app.db, sql, ...p).c;
const body = (extra) => H.consultForm(app.db, extra);

test('booking WITHOUT a doctor persists as Pending with a non-guessable reference; success page shows it', async () => {
  const r = await c.post('/en/appointment', body());
  assert.equal(r.status, 303); assert.equal(r.location, '/en/appointment/success');
  const ok = await c.get(r.location);
  const ref = /SKH-[A-Z2-9]{4}-[A-Z2-9]{4}/.exec(ok.text)[0];
  const row = H.get(app.db, 'SELECT * FROM appointments WHERE ref=?', ref);
  assert.equal(row.status, 'Pending'); assert.equal(row.doctor_id, null); assert.equal(row.slot_start, null); assert.equal(row.type, 'consultation');
  assert.match(ok.text, /NOT confirmed yet/); assert.match(ok.text, /01494-246333/);
  assert.equal(count('SELECT COUNT(*) c FROM appointment_status_history WHERE appointment_id=?', row.id), 1);
  const hi = await c.post('/hi/appointment', body({ language: 'hi' }));
  assert.match((await c.get(hi.location)).text, /अनुरोध प्राप्त हुआ/);
});

test('references are unique and unguessable-looking', () => {
  const set = new Set(Array.from({ length: 2000 }, () => appts.newRef()));
  assert.equal(set.size, 2000);
  for (const r of set) assert.match(r, /^SKH-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
});

test('server-side validation: required fields, Indian mobile numbers, ages, translated messages', async () => {
  const bad = await c.post('/en/appointment', body({ patient_name: '', mobile: '12345', age: '', department_id: '' }));
  assert.equal(bad.status, 422);
  for (const m of ['Enter a valid name', 'valid 10-digit Indian mobile', 'Please choose a department', 'age between 0 and 120']) assert.match(bad.text, new RegExp(m));
  const bad2 = await c.post('/hi/appointment', body({ mobile: '5123456789' }));
  assert.match(bad2.text, /सही 10 अंकों का भारतीय मोबाइल नंबर/);
  assert.equal(V.normalizeMobile('+91 98765 43210'), '9876543210'); assert.equal(V.normalizeMobile('09876543210'), '9876543210');
  assert.equal(V.normalizeMobile('९८७६५४३२१०'), '9876543210'); assert.equal(V.normalizeMobile('5876543210'), null); assert.equal(V.normalizeMobile('98765'), null);
  assert.equal((await c.post('/en/appointment', body({ age: '200' }))).status, 422);
  assert.equal((await c.post('/en/appointment', body({ gender: 'robot' }))).status, 422);
});

test('past dates and far-future dates are rejected; Asia/Kolkata "today" is accepted', async () => {
  const past = await c.post('/en/appointment', body({ preferred_date: '2026-10-11' }));
  assert.equal(past.status, 422); assert.match(past.text, /cannot be in the past/);
  assert.match((await c.post('/en/appointment', body({ preferred_date: '2027-06-01' }))).text, /within the next 90 days/);
  assert.equal((await c.post('/en/appointment', body({ preferred_date: '2026-10-12' }))).status, 303); // today in IST
  // 20:00 UTC on 11 Oct is already 12 Oct in India: 11 Oct is "past", 12 Oct is today
  H.clock.setNow('2026-10-11T20:00:00Z');
  assert.equal(H.clock.todayIST(), '2026-10-12');
  assert.equal((await c.post('/en/appointment', body({ preferred_date: '2026-10-11' }))).status, 422);
});

test('holidays block requests', async () => {
  H.run(app.db, "INSERT INTO holidays(date,name_en,name_hi) VALUES ('2026-10-20','Test holiday','परीक्षण अवकाश')");
  const r = await c.post('/en/appointment', body({ preferred_date: '2026-10-20' }));
  assert.equal(r.status, 409); assert.match(r.text, /marked closed on this date/);
  const d = await c.post('/en/diagnostics', { service_id: String(H.get(app.db, "SELECT id FROM services WHERE name_en='X-ray'").id), preferred_date: '2026-10-20', patient_name: 'Test Patient', mobile: '9876543210' }, { from: '/en/diagnostics' });
  assert.equal(d.status, 409);
  H.run(app.db, "DELETE FROM holidays WHERE date='2026-10-20'"); // cleanup so later tests can use this date
});

let docId;
test('slots honour schedule, holidays, leave and current time', () => {
  docId = H.addDoctor(app.db);
  assert.deepEqual(slots.slotsFor(app.db, docId, H.TUESDAY), ['10:00', '10:15', '10:30', '10:45']);
  assert.deepEqual(slots.slotsFor(app.db, docId, '2026-10-14'), [], 'Wednesday has no schedule');
  H.run(app.db, "INSERT INTO holidays(date,name_en,name_hi) VALUES (?,?,?)", H.TUESDAY, 'Holiday', 'अवकाश');
  assert.deepEqual(slots.slotsFor(app.db, docId, H.TUESDAY), [], 'holiday removes slots');
  H.run(app.db, 'DELETE FROM holidays WHERE date=?', H.TUESDAY);
  H.run(app.db, "INSERT INTO doctor_unavailability(doctor_id,start_date,end_date,reason) VALUES (?,?,?,?)", docId, '2026-10-13', '2026-10-13', 'leave');
  assert.deepEqual(slots.slotsFor(app.db, docId, H.TUESDAY), [], 'leave removes slots');
  H.run(app.db, 'DELETE FROM doctor_unavailability WHERE doctor_id=?', docId);
  // "now" = Tuesday 10:20 IST -> earlier slots disappear
  H.clock.setNow('2026-10-13T04:50:00Z');
  assert.deepEqual(slots.slotsFor(app.db, docId, H.TUESDAY), ['10:30', '10:45']);
});

test('booking with a doctor reserves a real slot (held Pending) and second booking of the same slot fails', async () => {
  const f = body({ doctor_id: String(docId), slot_time: '10:00' });
  const a = await c.post('/en/appointment', f);
  assert.equal(a.status, 303);
  const row = H.get(app.db, "SELECT * FROM appointments WHERE doctor_id=? AND slot_start='2026-10-13 10:00'", docId);
  assert.ok(row); assert.equal(row.status, 'Pending');
  const b = await c.post('/en/appointment', { ...f, patient_name: 'Second Patient', mobile: '9123456780' });
  assert.equal(b.status, 409); assert.match(b.text, /no longer available/);
  assert.equal(count("SELECT COUNT(*) c FROM appointments WHERE doctor_id=? AND slot_start='2026-10-13 10:00'", docId), 1);
  assert.ok(!slots.slotsFor(app.db, docId, H.TUESDAY).includes('10:00'));
  // a doctor with a schedule requires a real slot
  const no = await c.post('/en/appointment', body({ doctor_id: String(docId) }));
  assert.equal(no.status, 409); assert.match(no.text, /choose one of the available times/);
  // slot not in schedule
  assert.equal((await c.post('/en/appointment', body({ doctor_id: String(docId), slot_time: '12:00' }))).status, 409);
  // doctor from the wrong department
  H.addDoctor(app.db, { slug: 'dr-ent', name: 'Dr. ENT Synthetic', deptSlug: 'ent' });
  const wrong = await c.post('/en/appointment', body({ doctor_id: String(H.get(app.db, "SELECT id FROM doctors WHERE slug='dr-ent'").id), slot_time: '10:15' }));
  assert.equal(wrong.status, 409);
});

test('DATABASE-level double-booking guard: unique index blocks live duplicates, allows cancelled', () => {
  const ins = (status) => H.run(app.db, `INSERT INTO appointments(ref,type,department_id,doctor_id,patient_name,mobile,slot_start,status) VALUES (?,?,?,?,?,?,?,?)`,
    appts.newRef(), 'consultation', H.dept(app.db, 'medicine').id, docId, 'DB Test', '9876543210', '2026-10-27 10:00', status);
  ins('Confirmed');
  assert.throws(() => ins('Pending'), (e) => isUniqueViolation(e));
  assert.throws(() => ins('Rescheduled'), (e) => isUniqueViolation(e));
  assert.doesNotThrow(() => ins('Cancelled'));
  assert.doesNotThrow(() => ins('Completed'));
});

test('slot lookup API returns only times; unpublished doctors expose nothing', async () => {
  const r = await c.get(`/api/slots?doctor=${docId}&date=2026-10-20`);
  assert.deepEqual(JSON.parse(r.text), { times: ['10:00', '10:15', '10:30', '10:45'], hasSchedule: true });
  const hidden = H.addDoctor(app.db, { slug: 'dr-hidden', name: 'Dr. Hidden', published: 0 });
  assert.deepEqual(JSON.parse((await c.get(`/api/slots?doctor=${hidden}&date=2026-10-20`)).text).times, []);
});

test('doctor assignment after a request is received, then confirm / reschedule / complete with history', async () => {
  const r = await c.post('/en/appointment', body({ preferred_date: '2026-10-20' }));
  const ref = /SKH-[A-Z2-9-]{9}/.exec((await c.get(r.location)).text)[0];
  const a = H.get(app.db, 'SELECT * FROM appointments WHERE ref=?', ref);
  const staff = { id: null, email: 'staff@example.test' };
  assert.throws(() => appts.changeStatus(app.db, { id: a.id, action: 'confirm', user: staff, date: '2026-10-20', time: '10:00' }), (e) => e.code === 'e_doctor', 'cannot confirm without doctor');
  appts.changeStatus(app.db, { id: a.id, action: 'assign', user: staff, doctor_id: docId });
  assert.equal(H.get(app.db, 'SELECT doctor_id FROM appointments WHERE id=?', a.id).doctor_id, docId);
  assert.throws(() => appts.changeStatus(app.db, { id: a.id, action: 'confirm', user: staff, date: '2026-10-20', time: '12:00' }), (e) => e.code === 'e_slot_unavailable');
  assert.throws(() => appts.changeStatus(app.db, { id: a.id, action: 'confirm', user: staff, date: '2026-10-11', time: '10:00' }), (e) => e.code === 'e_date_past');
  appts.changeStatusAndNotify(app.db, { id: a.id, action: 'confirm', user: staff, date: '2026-10-20', time: '10:30' });
  assert.equal(H.get(app.db, 'SELECT status,slot_start FROM appointments WHERE id=?', a.id).slot_start, '2026-10-20 10:30');
  // another patient cannot take the confirmed slot
  assert.ok(!slots.slotsFor(app.db, docId, '2026-10-20').includes('10:30'));
  appts.changeStatusAndNotify(app.db, { id: a.id, action: 'reschedule', user: staff, date: '2026-10-20', time: '10:45' });
  assert.equal(H.get(app.db, 'SELECT status FROM appointments WHERE id=?', a.id).status, 'Rescheduled');
  assert.ok(slots.slotsFor(app.db, docId, '2026-10-20').includes('10:30'), 'old slot released');
  appts.changeStatusAndNotify(app.db, { id: a.id, action: 'confirm', user: staff });
  appts.changeStatusAndNotify(app.db, { id: a.id, action: 'complete', user: staff });
  assert.equal(H.get(app.db, 'SELECT status FROM appointments WHERE id=?', a.id).status, 'Completed');
  const hist = H.all(app.db, 'SELECT to_status FROM appointment_status_history WHERE appointment_id=? ORDER BY id', a.id).map((h) => h.to_status);
  assert.deepEqual(hist, ['Pending', 'Pending', 'Confirmed', 'Rescheduled', 'Confirmed', 'Completed']);
  assert.throws(() => appts.changeStatus(app.db, { id: a.id, action: 'confirm', user: staff, date: '2026-10-20', time: '10:00' }), (e) => e.code === 'e_generic', 'terminal state');
});

test('status transition matrix and cancellation rules', () => {
  const T = appts.TRANSITIONS;
  assert.deepEqual(Object.keys(T).sort(), ['Cancelled', 'Completed', 'Confirmed', 'No-show', 'Pending', 'Rescheduled']);
  for (const s of ['Completed', 'Cancelled', 'No-show']) assert.deepEqual(T[s], []);
  assert.ok(!appts.canTransition('Pending', 'Completed') && !appts.canTransition('Pending', 'No-show'));
  assert.ok(appts.canTransition('Confirmed', 'No-show'));
  const row = H.get(app.db, "SELECT id FROM appointments WHERE status='Pending' LIMIT 1");
  assert.throws(() => appts.changeStatus(app.db, { id: row.id, action: 'cancel', user: null, reason: '  ' }), (e) => e.code === 'e_required');
  appts.changeStatus(app.db, { id: row.id, action: 'cancel', user: null, reason: 'Patient called' });
  const got = H.get(app.db, 'SELECT status,cancel_reason FROM appointments WHERE id=?', row.id);
  assert.deepEqual({ ...got }, { status: 'Cancelled', cancel_reason: 'Patient called' });
});

test('diagnostic workflow: unverified service accepted only as inquiry (no fake slots); unavailable rejected; available bookable', async () => {
  const xray = H.get(app.db, "SELECT id FROM services WHERE name_en='X-ray'").id, ct = H.get(app.db, "SELECT id FROM services WHERE name_en='CT scan'").id, usg = H.get(app.db, "SELECT id FROM services WHERE name_en LIKE 'Ultrasound%'").id;
  const form = (service_id, extra) => ({ service_id: String(service_id), preferred_date: '2026-10-21', preferred_range: 'any', patient_name: 'Diag Patient', mobile: '9876500000', has_referral: 'yes', language: 'en', ...extra });
  const r1 = await c.post('/en/diagnostics', form(xray));
  assert.equal(r1.status, 303);
  const a1 = H.get(app.db, "SELECT * FROM appointments WHERE type='diagnostic' ORDER BY id DESC LIMIT 1");
  assert.equal(a1.status, 'Pending'); assert.equal(a1.inquiry_only, 1); assert.equal(a1.slot_start, null); assert.equal(a1.doctor_id, null);
  assert.match((await c.get(r1.location)).text, /availability is still being confirmed/);
  H.run(app.db, "UPDATE services SET status='available' WHERE id=?", usg);
  H.run(app.db, "UPDATE services SET status='temporarily_unavailable' WHERE id=?", ct);
  await c.post('/en/diagnostics', form(usg));
  assert.equal(H.get(app.db, "SELECT inquiry_only FROM appointments WHERE type='diagnostic' ORDER BY id DESC LIMIT 1").inquiry_only, 0);
  const blocked = await c.post('/en/diagnostics', form(ct));
  assert.equal(blocked.status, 409); assert.match(blocked.text, /currently unavailable/);
  H.run(app.db, "UPDATE services SET status='not_offered' WHERE id=?", xray);
  assert.equal((await c.post('/en/diagnostics', form(xray))).status, 409);
  assert.equal((await c.post('/en/diagnostics', form(usg, { preferred_date: '2026-10-01' }))).status, 422, 'past date');
  assert.equal((await c.post('/en/diagnostics', form(usg, { mobile: '1' }))).status, 422);
  assert.ok(!(await c.get('/en/diagnostics')).text.includes('type="file"'), 'no file uploads');
  H.run(app.db, "UPDATE services SET status='to_be_confirmed' WHERE is_diagnostic=1");
});

test('contact inquiry is validated and saved', async () => {
  assert.equal((await c.post('/en/contact', { name: 'A', mobile: '1', message: '' })).status, 422);
  const ok = await c.post('/en/contact', { name: 'Inquiry Person', mobile: '9876501234', message: 'Hello', department_id: String(H.dept(app.db, 'ent').id) });
  assert.equal(ok.status, 200); assert.match(ok.text, /We will contact you/);
  assert.equal(count("SELECT COUNT(*) c FROM inquiries WHERE name='Inquiry Person'"), 1);
});

test('patient self-service: lookup needs reference AND mobile; change request is recorded for staff', async () => {
  const r = await c.post('/en/appointment', body({ preferred_date: '2026-10-22' }));
  const ref = /SKH-[A-Z2-9-]{9}/.exec((await c.get(r.location)).text)[0];
  const wrongMobile = await c.post('/en/appointment/status', { ref, mobile: '9000000001' });
  const noRef = await c.post('/en/appointment/status', { ref: 'SKH-AAAA-AAAA', mobile: '9876543210' });
  assert.equal(wrongMobile.status, 404); assert.equal(noRef.status, 404);
  assert.equal(wrongMobile.text.replace(/value="[^"]*"/g, ''), noRef.text.replace(/value="[^"]*"/g, ''), 'identical response whether ref or mobile is wrong');
  const found = await c.post('/en/appointment/status', { ref: ref.toLowerCase(), mobile: '+91 98765 43210' });
  assert.equal(found.status, 200); assert.match(found.text, /Pending/); assert.match(found.text, /Request a change/);
  const ch = await c.post('/en/appointment/status/change', { ref, mobile: '9876543210', kind: 'reschedule', new_date: '2026-10-25', new_range: 'evening' }, { from: '/en/appointment/status' });
  assert.match(ch.text, /change request has been recorded/);
  assert.equal(count("SELECT COUNT(*) c FROM change_requests WHERE status='open'"), 1);
  const again = await c.post('/en/appointment/status/change', { ref, mobile: '9876543210', kind: 'cancel' }, { from: '/en/appointment/status' });
  assert.equal(again.status, 409);
  assert.equal(H.get(app.db, 'SELECT status FROM appointments WHERE ref=?', ref).status, 'Pending', 'patient request never changes the appointment itself');
  assert.equal((await c.post('/en/appointment/status/change', { ref, mobile: '9000000001', kind: 'cancel' }, { from: '/en/appointment/status' })).status, 404);
});

test('CSRF protection, rate limiting and safe error handling', async () => {
  const bare = new H.Client(app.base);
  assert.equal((await bare.post('/en/appointment', body(), { noCsrf: true })).status, 403);
  assert.equal((await c.req('POST', '/en/appointment', { form: { ...body(), _csrf: 'forged' } })).status, 403);
  H.sec.resetRateLimits();
  let last;
  for (let i = 0; i < 12; i++) last = await c.post('/en/appointment', body({ patient_name: 'Rate ' + i }));
  assert.equal(last.status, 429); assert.match(last.text, /Too many attempts/);
  H.sec.resetRateLimits();
  let l2; for (let i = 0; i < 12; i++) l2 = await c.post('/en/appointment/status', { ref: 'SKH-AAAA-AAAA', mobile: '9876543210' });
  assert.equal(l2.status, 429);
});

test('SQL injection / XSS strings are stored inertly and rendered escaped', async () => {
  H.sec.resetRateLimits();
  const evil = `<script>alert(1)</script>'); DROP TABLE appointments;--`;
  const r = await c.post('/en/contact', { name: 'Evil Name', mobile: '9876501234', message: evil });
  assert.equal(r.status, 200);
  assert.equal(H.get(app.db, "SELECT message FROM inquiries WHERE name='Evil Name'").message, evil);
  assert.ok(count('SELECT COUNT(*) c FROM appointments') > 0);
  const bad = await c.post('/en/appointment', body({ patient_name: '<img src=x onerror=alert(1)>' }));
  assert.equal(bad.status, 422);
  assert.ok(!bad.text.includes('<img src=x'));
});

test('database failure returns a safe error page, saves nothing and leaks no internals', async () => {
  H.sec.resetRateLimits();
  const before = count('SELECT COUNT(*) c FROM appointments');
  H.run(app.db, 'ALTER TABLE appointments RENAME TO appointments_bak');
  const origErr = console.error; console.error = () => {};
  try {
    const r = await c.post('/en/appointment', body({ preferred_date: '2026-10-23' }));
    assert.equal(r.status, 500); assert.match(r.text, /Your request was not saved/);
    assert.ok(!/SQLITE|no such table|at .*\.js/i.test(r.text), 'no internals leaked');
  } finally { console.error = origErr; H.run(app.db, 'ALTER TABLE appointments_bak RENAME TO appointments'); }
  assert.equal(count('SELECT COUNT(*) c FROM appointments'), before);
});
