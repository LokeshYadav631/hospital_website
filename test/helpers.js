'use strict';
// Test harness: in-memory DB, real HTTP server on a random port, cookie-aware client. Synthetic data only.
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-123456';
const { open, migrate, run, get, all } = require('../src/lib/db');
const { seed } = require('../src/data/seed');
const { createApp } = require('../src/web/app');
const sec = require('../src/lib/security');
const clock = require('../src/lib/clock');

// Fixed "now": Monday 12 Oct 2026, 09:30 IST
const NOW = '2026-10-12T04:00:00Z';
const TUESDAY = '2026-10-13';

async function boot() {
  clock.setNow(NOW);
  sec.resetRateLimits();
  const db = open(':memory:'); migrate(db); seed(db);
  const server = createApp(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, server, base, close: () => new Promise((r) => { server.stopBackground(); server.close(r); }) };
}

class Client {
  constructor(base) { this.base = base; this.jar = {}; }
  async req(method, path, { form, json, headers = {} } = {}) {
    const h = { ...headers, cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ') };
    let body;
    if (form) { body = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    if (json) { body = JSON.stringify(json); h['content-type'] = 'application/json'; }
    const res = await fetch(this.base + path, { method, headers: h, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';'); const i = kv.indexOf('=');
      const k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1));
      if (/Max-Age=0/i.test(c)) delete this.jar[k]; else this.jar[k] = v;
    }
    const text = await res.text();
    return { status: res.status, text, headers: res.headers, location: res.headers.get('location') };
  }
  get(p, o) { return this.req('GET', p, o); }
  // fetch a page first to obtain a CSRF token, then POST the form
  async post(p, form, { from = p, noCsrf = false, headers } = {}) {
    let token = '';
    if (!noCsrf) {
      const page = await this.get(from);
      token = (/name="_csrf" value="([^"]+)"/.exec(page.text) || [])[1] || '';
    }
    return this.req('POST', p, { form: { _csrf: token, ...form }, headers });
  }
}

async function makeUser(db, role, { email, password = 'Correct-Horse-9', doctor_id = null, name } = {}) {
  email = email || `${role}@example.test`;
  const hash = await sec.hashPassword(password);
  const r = run(db, 'INSERT INTO users(email,name,password_hash,role,doctor_id) VALUES (?,?,?,?,?)', email, name || role, hash, role, doctor_id);
  return { id: Number(r.lastInsertRowid), email, password };
}
async function login(client, user) {
  const r = await client.post('/admin/login', { email: user.email, password: user.password }, { from: '/admin/login' });
  return r;
}
const dept = (db, slug) => get(db, 'SELECT * FROM departments WHERE slug=?', slug);
// Synthetic doctor, published + verified, scheduled Tuesdays 10:00-11:00, 15-minute slots
function addDoctor(db, { slug = 'dr-test', name = 'Dr. Synthetic Test', deptSlug = 'medicine', schedule = true, published = 1 } = {}) {
  const r = run(db, `INSERT INTO doctors(slug,name_en,name_hi,verified,published,active,slot_minutes) VALUES (?,?,?,?,?,1,15)`, slug, name, 'डॉ. परीक्षण', 1, published);
  const id = Number(r.lastInsertRowid);
  run(db, 'INSERT INTO doctor_departments(doctor_id,department_id) VALUES (?,?)', id, dept(db, deptSlug).id);
  if (schedule) run(db, 'INSERT INTO doctor_schedules(doctor_id,weekday,start_time,end_time) VALUES (?,?,?,?)', id, 2, '10:00', '11:00');
  return id;
}
const consultForm = (db, extra = {}) => ({
  department_id: String(dept(db, 'medicine').id), preferred_date: TUESDAY, preferred_range: 'morning', patient_name: 'Test Patient', mobile: '9876543210',
  age: '34', gender: 'female', patient_type: 'new', language: 'en', ...extra,
});
module.exports = { boot, Client, makeUser, login, addDoctor, dept, consultForm, NOW, TUESDAY, run, get, all, clock, sec };
