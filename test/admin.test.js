'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const notifications = require('../src/services/notifications');

let app, anon;
before(async () => { notifications.state.auto = false; app = await H.boot(); anon = new H.Client(app.base); });
after(() => app.close());
beforeEach(() => { H.sec.resetRateLimits(); H.clock.setNow(H.NOW); });

const users = {};
const as = async (role, extra) => {
  const u = users[role] || (users[role] = await H.makeUser(app.db, role, extra));
  const c = new H.Client(app.base);
  const r = await H.login(c, u);
  assert.equal(r.status, 303, `login ${role}`);
  return c;
};
const seedAppt = (extra = {}) => {
  const r = H.run(app.db, `INSERT INTO appointments(ref,type,department_id,doctor_id,patient_name,mobile,age,patient_type,preferred_date,preferred_range,status,language,reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, extra.ref || 'SKH-TEST-' + Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[01OIL]/g, 'X'), 'consultation', H.dept(app.db, 'medicine').id, extra.doctor_id ?? null,
    extra.name || 'Synthetic Patient', extra.mobile || '9876543210', 40, 'new', '2026-10-20', 'any', extra.status || 'Pending', 'en', extra.reason || 'private reason');
  return Number(r.lastInsertRowid);
};

test('unauthenticated users cannot reach any admin page or export; login page is public and noindex', async () => {
  for (const p of ['/admin', '/admin/appointments', '/admin/appointments.csv', '/admin/appointments/1', '/admin/doctors', '/admin/services', '/admin/settings', '/admin/users', '/admin/audit', '/admin/reports', '/admin/notifications', '/admin/content', '/admin/inquiries']) {
    const r = await anon.get(p); assert.equal(r.status, 303, p); assert.equal(r.location, '/admin/login', p);
  }
  const login = await anon.get('/admin/login'); assert.equal(login.status, 200); assert.match(login.text, /noindex/);
  // POSTs without a session are also refused
  assert.equal((await anon.post('/admin/doctors', { name_en: 'X' }, { from: '/admin/login' })).status, 303);
});

test('login: wrong password rejected generically, lockout after repeated failures, sessions are HttpOnly+SameSite=Strict', async () => {
  const u = await H.makeUser(app.db, 'receptionist', { email: 'lock@example.test' });
  const c = new H.Client(app.base);
  for (let i = 0; i < 5; i++) { const r = await c.post('/admin/login', { email: u.email, password: 'wrong-password-1' }, { from: '/admin/login' }); assert.equal(r.status, 401); assert.match(r.text, /Invalid email or password/); }
  const locked = await H.login(c, u); assert.equal(locked.status, 401); assert.match(locked.text, /temporarily locked/);
  const unknown = await c.post('/admin/login', { email: 'nobody@example.test', password: 'whatever-123456' }, { from: '/admin/login' });
  assert.match(unknown.text, /Invalid email or password/);
  H.run(app.db, 'UPDATE users SET locked_until=NULL, failed_logins=0 WHERE id=?', u.id);
  H.sec.resetRateLimits();
  const ok = await H.login(c, u); assert.equal(ok.status, 303);
  const raw = await new H.Client(app.base).post('/admin/login', { email: u.email, password: u.password }, { from: '/admin/login' });
  const cookie = raw.headers.getSetCookie().find((x) => x.startsWith('sid='));
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  const stored = H.get(app.db, 'SELECT token_hash FROM sessions ORDER BY rowid DESC LIMIT 1').token_hash;
  assert.ok(!cookie.includes(stored) && stored.length === 64, 'only a hash of the session token is stored');
});

test('passwords are stored hashed (scrypt) and never logged in the audit trail', async () => {
  const u = await as('admin');
  const hash = H.get(app.db, 'SELECT password_hash FROM users WHERE email=?', users.admin.email).password_hash;
  assert.match(hash, /^scrypt\$/); assert.ok(!hash.includes(users.admin.password));
  const audit = H.all(app.db, 'SELECT * FROM audit_logs').map((r) => JSON.stringify(r)).join('\n');
  assert.ok(!audit.includes(users.admin.password) && !audit.includes('wrong-password'));
  assert.match(audit, /login\.success/); assert.match(audit, /login\.failed/);
});

test('role-based access: receptionist can manage appointments but not settings, users, content, reports, audit or CSV export', async () => {
  const c = await as('receptionist');
  for (const p of ['/admin', '/admin/appointments', '/admin/doctors', '/admin/inquiries']) assert.equal((await c.get(p)).status, 200, p);
  for (const p of ['/admin/settings', '/admin/users', '/admin/content', '/admin/faqs', '/admin/reports', '/admin/audit', '/admin/services', '/admin/notifications', '/admin/appointments.csv', '/admin/doctors/new']) assert.equal((await c.get(p)).status, 403, p);
  assert.equal((await c.post('/admin/settings', { phone1: '1' }, { from: '/admin' })).status, 403);
  assert.equal((await c.post('/admin/users', { email: 'x@example.test' }, { from: '/admin' })).status, 403);
  const nav = (await c.get('/admin')).text;
  assert.ok(!nav.includes('/admin/users') && !nav.includes('/admin/audit') && nav.includes('/admin/appointments'));
});

test('hospital admin: operational pages OK, staff accounts reserved for super administrator', async () => {
  const c = await as('admin');
  for (const p of ['/admin/settings', '/admin/reports', '/admin/audit', '/admin/services', '/admin/content', '/admin/faqs', '/admin/holidays', '/admin/announcements', '/admin/notifications', '/admin/appointments.csv']) assert.equal((await c.get(p)).status, 200, p);
  assert.equal((await c.get('/admin/users')).status, 403);
  const su = await as('super_admin'); assert.equal((await su.get('/admin/users')).status, 200);
});

test('clinician sees only their own doctor’s appointments, without contact details, and cannot manage or export', async () => {
  const mine = H.addDoctor(app.db, { slug: 'dr-clin', name: 'Dr. Clinical Synthetic' });
  const other = H.addDoctor(app.db, { slug: 'dr-other', name: 'Dr. Other Synthetic' });
  const a1 = seedAppt({ doctor_id: mine, name: 'Mine Patient', mobile: '9811111111', status: 'Confirmed' });
  const a2 = seedAppt({ doctor_id: other, name: 'Other Patient', mobile: '9822222222' });
  const clin = await H.makeUser(app.db, 'clinician', { doctor_id: mine, email: 'clin@example.test' });
  const c = new H.Client(app.base); await H.login(c, clin);
  const list = (await c.get('/admin/appointments')).text;
  assert.ok(list.includes('Mine Patient') && !list.includes('Other Patient'));
  assert.ok(!list.includes('9811111111'), 'no mobile numbers for clinical staff');
  assert.equal((await c.get(`/admin/appointments/${a2}`)).status, 404, 'cannot open another doctor’s record');
  const detail = (await c.get(`/admin/appointments/${a1}`)).text; assert.ok(!detail.includes('9811111111'));
  assert.equal((await c.get('/admin/appointments.csv')).status, 403);
  const denied = await c.post(`/admin/appointments/${a1}/action`, { action: 'cancel', reason: 'x' }, { from: `/admin/appointments/${a1}` });
  assert.equal(denied.status, 403);
  const done = await c.post(`/admin/appointments/${a1}/action`, { action: 'complete' }, { from: `/admin/appointments/${a1}` });
  assert.equal(done.status, 303);
  assert.equal(H.get(app.db, 'SELECT status FROM appointments WHERE id=?', a1).status, 'Completed');
  assert.equal((await c.post(`/admin/appointments/${a2}/action`, { action: 'complete' }, { from: '/admin' })).status, 404);
});

test('staff workflow over HTTP: filter, assign doctor, confirm slot, reschedule, cancel needs reason, history + audit', async () => {
  const doc = H.addDoctor(app.db, { slug: 'dr-flow', name: 'Dr. Flow Synthetic' });
  const id = seedAppt({ name: 'Flow Patient' });
  const c = await as('receptionist');
  const found = await c.get('/admin/appointments?q=Flow+Patient&status=Pending&type=consultation'); assert.match(found.text, /Flow Patient/);
  assert.ok(!(await c.get('/admin/appointments?q=Nonexistent')).text.includes('Flow Patient'));
  const page = `/admin/appointments/${id}`;
  const confirmNoDoc = await c.post(`${page}/action`, { action: 'confirm', date: H.TUESDAY, time: '10:00' }, { from: page });
  assert.match(confirmNoDoc.location, /err=e_doctor/);
  assert.match((await c.get(confirmNoDoc.location)).text, /not available for this department/);
  await c.post(`${page}/action`, { action: 'assign', doctor_id: String(doc) }, { from: page });
  assert.equal(H.get(app.db, 'SELECT doctor_id FROM appointments WHERE id=?', id).doctor_id, doc);
  const ok = await c.post(`${page}/action`, { action: 'confirm', date: H.TUESDAY, time: '10:15' }, { from: page });
  assert.match(ok.location, /ok=done/);
  assert.equal(H.get(app.db, 'SELECT slot_start,status FROM appointments WHERE id=?', id).slot_start, '2026-10-13 10:15');
  // another pending request cannot be confirmed into the same slot
  const id2 = seedAppt({ name: 'Second Flow', doctor_id: doc });
  const clash = await c.post(`/admin/appointments/${id2}/action`, { action: 'confirm', date: H.TUESDAY, time: '10:15' }, { from: page });
  assert.match(clash.location, /err=e_slot_unavailable/);
  const noReason = await c.post(`${page}/action`, { action: 'cancel', reason: '' }, { from: page });
  assert.match(noReason.location, /err=e_required/);
  await c.post(`${page}/action`, { action: 'cancel', reason: 'Patient requested' }, { from: page });
  const row = H.get(app.db, 'SELECT status,cancel_reason FROM appointments WHERE id=?', id); assert.equal(row.status, 'Cancelled'); assert.equal(row.cancel_reason, 'Patient requested');
  const detail = (await c.get(page)).text; assert.match(detail, /Status history/); assert.match(detail, /Patient requested/);
  assert.ok(H.all(app.db, "SELECT 1 FROM audit_logs WHERE action LIKE 'appointment.%'").length >= 3);
  assert.match((await c.get(`${page}/print`)).text, /SACHKHAND HOSPITAL/);
  assert.equal((await c.post(`${page}/action`, { action: 'confirm', date: H.TUESDAY, time: '10:30' }, { from: page })).location.includes('err='), true, 'cannot revive a cancelled appointment');
});

test('CSV export is restricted, audited, and neutralises spreadsheet formula injection', async () => {
  seedAppt({ name: '=HYPERLINK("http://evil.test")' });
  const c = await as('admin');
  const r = await c.get('/admin/appointments.csv');
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/csv/); assert.match(r.headers.get('content-disposition'), /attachment/);
  assert.ok(r.text.includes(`"'=HYPERLINK(""http://evil.test"")"`), 'formula prefixed with a quote');
  assert.ok(!r.text.includes('private reason'), 'free-text medical reason is not exported');
  assert.equal(H.get(app.db, "SELECT COUNT(*) c FROM audit_logs WHERE action='appointments.export'").c >= 1, true);
});

test('admin CSRF: state-changing admin requests without a valid token are refused', async () => {
  const c = await as('admin');
  assert.equal((await c.req('POST', '/admin/settings', { form: { phone1: '0' } })).status, 403);
  assert.equal((await c.req('POST', '/admin/logout', { form: { _csrf: 'bad' } })).status, 403);
});

test('doctors: add without code changes; cannot publish unverified; published doctors appear publicly in both languages; unpublished stay hidden', async () => {
  const c = await as('admin');
  const form = { name_en: 'Dr. Admin Synthetic', name_hi: 'डॉ. प्रशासन परीक्षण', specialization_en: 'General Medicine', specialization_hi: 'सामान्य चिकित्सा', slot_minutes: '20', dept: String(H.dept(app.db, 'medicine').id), active: '1' };
  const unverified = await c.post('/admin/doctors', { ...form, published: '1' }, { from: '/admin/doctors/new' });
  assert.equal(unverified.status, 422); assert.match(unverified.text, /only after credentials are marked verified/);
  const bad = await c.post('/admin/doctors', { ...form, slot_minutes: '1', photo_url: 'javascript:alert(1)' }, { from: '/admin/doctors/new' });
  assert.equal(bad.status, 422); assert.match(bad.text, /Photograph URL/); assert.match(bad.text, /duration/);
  const draft = await c.post('/admin/doctors', form, { from: '/admin/doctors/new' }); assert.equal(draft.status, 303);
  const id = Number(/\/admin\/doctors\/(\d+)/.exec(draft.location)[1]);
  assert.ok(!(await anon.get('/en/doctors')).text.includes('Dr. Admin Synthetic'), 'draft is not public');
  await c.post(`/admin/doctors/${id}`, { ...form, verified: '1', published: '1', translation_reviewed: '1', registration_no: 'REG-TEST-1', fee_approved: '', consultation_fee: '500' }, { from: `/admin/doctors/${id}` });
  const en = (await anon.get('/en/doctors')).text, hi = (await anon.get('/hi/doctors')).text;
  assert.ok(en.includes('Dr. Admin Synthetic') && hi.includes('डॉ. प्रशासन परीक्षण') && !hi.includes('Doctor profiles will be updated soon'));
  assert.ok(!en.includes('REG-TEST-1') && !en.includes('₹500'), 'registration & fee hidden until approved for display');
  await c.post(`/admin/doctors/${id}`, { ...form, verified: '1', published: '1', show_registration: '1', fee_approved: '1', consultation_fee: '500', registration_no: 'REG-TEST-1' }, { from: `/admin/doctors/${id}` });
  const en2 = (await anon.get('/en/doctors')).text; assert.ok(en2.includes('REG-TEST-1') && en2.includes('₹500'));
  // schedule rows: validation, overlap, then slots appear in the public booking API
  const sch = (b) => c.post(`/admin/doctors/${id}/schedule`, b, { from: `/admin/doctors/${id}` });
  assert.match((await sch({ weekday: '2', start_time: '12:00', end_time: '11:00' })).location, /err=x/);
  assert.match((await sch({ weekday: '2', start_time: '10:00', end_time: '11:00' })).location, /ok=saved/);
  assert.match((await sch({ weekday: '2', start_time: '10:30', end_time: '11:30' })).location, /overlaps/);
  assert.deepEqual(JSON.parse((await anon.get(`/api/slots?doctor=${id}&date=${H.TUESDAY}`)).text).times, ['10:00', '10:20', '10:40']);
  // deactivating removes the doctor from the public site
  await c.post(`/admin/doctors/${id}`, { ...form, verified: '1', published: '1' }, { from: `/admin/doctors/${id}` });
  await c.post(`/admin/doctors/${id}`, { ...form, verified: '1', published: '1', active: '' }, { from: `/admin/doctors/${id}` });
  assert.ok(!(await anon.get('/en/doctors')).text.includes('Dr. Admin Synthetic'));
});

test('service & department management: statuses, closure notices and translation are editable and reflected publicly', async () => {
  const c = await as('admin');
  const svc = H.get(app.db, "SELECT * FROM services WHERE name_en='X-ray'");
  const page = `/admin/services/${svc.id}`;
  const base = { name_en: 'X-ray', name_hi: 'एक्स-रे', is_diagnostic: '1', active: '1' };
  assert.match((await c.post(page, { ...base, status: 'bogus' }, { from: page })).location, /err=x/);
  await c.post(page, { ...base, status: 'temporarily_unavailable', closure_note_en: 'Machine servicing TEST', closure_note_hi: 'मशीन सर्विसिंग' }, { from: page });
  assert.match((await anon.get('/en/departments/radiology')).text, /Machine servicing TEST/);
  assert.ok(!(await anon.get('/en/diagnostics')).text.includes('value="' + svc.id + '"'), 'unavailable service not selectable');
  await c.post(page, { ...base, status: 'available' }, { from: page });
  assert.match((await anon.get('/hi/departments/radiology')).text, /उपलब्ध/);
  const add = await c.post(`/admin/departments/${H.dept(app.db, 'radiology').id}/services`, { name_en: 'MRI (TEST)', name_hi: 'एमआरआई (परीक्षण)', is_diagnostic: '1' }, { from: '/admin/services' });
  assert.equal(add.status, 303);
  assert.equal(H.get(app.db, "SELECT status FROM services WHERE name_en='MRI (TEST)'").status, 'to_be_confirmed', 'new services start unverified');
  H.run(app.db, "UPDATE services SET status='to_be_confirmed' WHERE id=?", svc.id);
});

test('hospital settings: hours need explicit confirmation; map & emergency claims need verification; edits are audited', async () => {
  const c = await as('admin');
  const base = { phone1: '01494-246333', phone2: '09799107439', address_en: 'Sarai Road, Mundawar', address_hi: 'सराय रोड, मुंडावर' };
  assert.match((await c.post('/admin/settings', { ...base, hours_confirmed: '1' }, { from: '/admin/settings' })).location, /err=x/, 'cannot confirm empty hours');
  assert.match((await c.post('/admin/settings', { ...base, emergency_status: 'available' }, { from: '/admin/settings' })).location, /err=x/);
  assert.match((await c.post('/admin/settings', { ...base, map_url: 'http://insecure.test', }, { from: '/admin/settings' })).location, /err=x/);
  assert.match((await c.post('/admin/settings', { ...base, facebook_url: 'ftp://bad' }, { from: '/admin/settings' })).location, /err=x/);
  assert.match((await c.post('/admin/settings', { ...base, instagram_url: 'javascript:bad' }, { from: '/admin/settings' })).location, /err=x/);
  await c.post('/admin/settings', { ...base, facebook_url: 'https://facebook.com/sachkhandhospital', instagram_url: 'https://instagram.com/sachkhandhospital' }, { from: '/admin/settings' });
  const pub = await anon.get('/en/');
  assert.ok(pub.text.includes('https://facebook.com/sachkhandhospital'));
  assert.ok(pub.text.includes('https://instagram.com/sachkhandhospital'));
  await c.post('/admin/settings', { ...base, hours_en: 'Mon-Sat 9am-1pm TEST', hours_hi: 'सोम-शनि सुबह 9-1 TEST', hours_confirmed: '1' }, { from: '/admin/settings' });
  assert.ok((await anon.get('/hi/contact')).text.includes('सोम-शनि सुबह 9-1 TEST'));
  await c.post('/admin/settings', { ...base, hours_en: 'Mon-Sat 9am-1pm TEST', hours_hi: 'सोम-शनि सुबह 9-1 TEST' }, { from: '/admin/settings' });
  assert.ok(!(await anon.get('/hi/contact')).text.includes('TEST'), 'unticking confirmation hides the hours again');
  assert.ok(H.get(app.db, "SELECT COUNT(*) c FROM audit_logs WHERE action='settings.update'").c >= 2);
});

test('content, FAQ, announcement and holiday management with bilingual output', async () => {
  const c = await as('admin');
  await c.post('/admin/faqs', { q_en: 'Test question?', q_hi: 'परीक्षण प्रश्न?', a_en: 'Test answer', a_hi: 'परीक्षण उत्तर', sort: '99', published: '1' }, { from: '/admin/faqs' });
  assert.ok((await anon.get('/hi/')).text.includes('परीक्षण प्रश्न?'));
  assert.match((await c.post('/admin/faqs', { q_en: 'Only English' }, { from: '/admin/faqs' })).location, /err=x/);
  await c.post('/admin/announcements', { title_en: 'Camp TEST', title_hi: 'शिविर TEST', published: '1' }, { from: '/admin/announcements' });
  assert.ok((await anon.get('/en/')).text.includes('Camp TEST') && (await anon.get('/hi/')).text.includes('शिविर TEST'));
  await c.post('/admin/holidays', { date: '2026-12-25', name_en: 'Test Holiday', name_hi: 'परीक्षण अवकाश' }, { from: '/admin/holidays' });
  assert.equal(H.get(app.db, "SELECT COUNT(*) c FROM holidays WHERE date='2026-12-25'").c, 1);
  const key = 'home_intro';
  await c.post(`/admin/content/${key}`, { en: 'EDITED-INTRO-EN', hi: 'संपादित-परिचय', published: '1' }, { from: '/admin/content' });
  assert.ok((await anon.get('/en/')).text.includes('EDITED-INTRO-EN') && (await anon.get('/hi/')).text.includes('संपादित-परिचय'));
  await c.post(`/admin/content/${key}`, { en: 'x', hi: 'y', published: '' }, { from: '/admin/content' });
  assert.ok(!(await anon.get('/en/')).text.includes('EDITED-INTRO-EN'));
});

test('staff accounts: password policy, last super-admin protection, immediate session revocation on role change', async () => {
  const su = await as('super_admin');
  const mk = (e, p, role = 'receptionist') => su.post('/admin/users', { name: 'New Staff', email: e, role, password: p }, { from: '/admin/users' });
  assert.match((await mk('weak@example.test', 'short1')).location, /err=x/);
  assert.match((await mk('weak@example.test', 'allletterspassword')).location, /err=x/);
  assert.match((await mk('good@example.test', 'Long-Enough-Pass-1')).location, /ok=created/);
  assert.match((await mk('good@example.test', 'Long-Enough-Pass-1')).location, /err=x/, 'duplicate email');
  const staffId = H.get(app.db, "SELECT id FROM users WHERE email='good@example.test'").id;
  const staff = new H.Client(app.base); assert.equal((await H.login(staff, { email: 'good@example.test', password: 'Long-Enough-Pass-1' })).status, 303);
  assert.equal((await staff.get('/admin/appointments')).status, 200);
  await su.post(`/admin/users/${staffId}`, { role: 'receptionist', active: '' }, { from: '/admin/users' });
  assert.equal((await staff.get('/admin/appointments')).status, 303, 'deactivated user is signed out immediately');
  const suId = users.super_admin.id;
  assert.match((await su.post(`/admin/users/${suId}`, { role: 'admin', active: '1' }, { from: '/admin/users' })).location, /err=x/, 'cannot demote self');
  const su2 = await H.makeUser(app.db, 'super_admin', { email: 'su2@example.test' });
  const c2 = new H.Client(app.base); await H.login(c2, su2);
  H.run(app.db, 'UPDATE users SET active=0 WHERE id=?', suId);
  assert.match((await c2.post(`/admin/users/${su2.id}`, { role: 'admin', active: '1' }, { from: '/admin/users' })).location, /err=x/, 'cannot demote self/last super admin');
  H.run(app.db, 'UPDATE users SET active=1 WHERE id=?', suId);
});

test('own password change requires current password and enforces policy', async () => {
  const u = await H.makeUser(app.db, 'admin', { email: 'pw@example.test', password: 'Original-Pass-12' });
  const c = new H.Client(app.base); await H.login(c, u);
  assert.match((await c.post('/admin/account', { current: 'wrong', password: 'New-Strong-Pass-12' }, { from: '/admin/account' })).location, /err=x/);
  assert.match((await c.post('/admin/account', { current: u.password, password: 'weak' }, { from: '/admin/account' })).location, /err=x/);
  assert.match((await c.post('/admin/account', { current: u.password, password: 'New-Strong-Pass-12' }, { from: '/admin/account' })).location, /ok=saved/);
  const c2 = new H.Client(app.base);
  assert.equal((await H.login(c2, u)).status, 401); assert.equal((await H.login(c2, { ...u, password: 'New-Strong-Pass-12' })).status, 303);
});

test('dashboard and reports render with data; SMS section reflects "not configured"; admin output is escaped', async () => {
  H.run(app.db, "INSERT INTO inquiries(name,mobile,message) VALUES ('<b>x</b>','9876543210','<script>alert(1)</script>')");
  const c = await as('admin');
  const dash = (await c.get('/admin')).text; assert.match(dash, /Pending requests/); assert.match(dash, /not configured/);
  const rep = (await c.get('/admin/reports')).text; for (const h of ['Daily requests', 'By department', 'Status summary', 'SMS delivery']) assert.ok(rep.includes(h), h);
  const inq = (await c.get('/admin/inquiries')).text;
  assert.ok(!inq.includes('<script>alert(1)</script>') && inq.includes('&lt;script&gt;'));
  assert.match((await c.get('/admin/notifications')).text, /No SMS provider is configured/);
});
