'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { en, hi } = require('../src/i18n/strings');
const { html } = require('../src/lib/html');

let app, c;
before(async () => { app = await H.boot(); c = new H.Client(app.base); });
after(() => app.close());

const SLUGS = ['general-surgery', 'gynecology', 'pediatrics', 'urology', 'physiotherapy', 'orthopedics', 'blood-bank', 'medicine', 'dialysis', 'ent', 'radiology'];

test('i18n: English and Hindi dictionaries have identical keys', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(hi).sort());
  for (const k of Object.keys(en)) assert.ok(String(hi[k]).trim(), `empty Hindi string for ${k}`);
});

test('public navigation: every page returns 200 in both languages with no missing translation keys', async () => {
  for (const lang of ['en', 'hi']) {
    for (const p of ['', 'about', 'departments', 'doctors', 'diagnostics', 'appointment', 'appointment/status', 'contact', 'privacy', 'terms']) {
      const r = await c.get(`/${lang}/${p}`);
      assert.equal(r.status, 200, `${lang}/${p}`);
      assert.ok(!r.text.includes('⟦'), `missing key on ${lang}/${p}`);
      assert.match(r.text, new RegExp(`<html lang="${lang}"`));
    }
  }
});

test('root redirects by language preference; unknown paths 404', async () => {
  const r = await new H.Client(app.base).get('/', { headers: { 'accept-language': 'hi-IN,hi;q=0.9' } });
  assert.equal(r.location, '/hi/');
  assert.equal((await c.get('/en/does-not-exist')).status, 404);
  assert.equal((await c.get('/fr/about')).status, 404);
});

test('all 11 department pages exist in both languages with names, status badge, form and disclaimer', async () => {
  for (const slug of SLUGS) {
    const d = H.dept(app.db, slug);
    const e = await c.get(`/en/departments/${slug}`), h = await c.get(`/hi/departments/${slug}`);
    assert.equal(e.status, 200, slug); assert.equal(h.status, 200, slug);
    assert.ok(e.text.includes(html`${d.name_en}`.toString()) || e.text.includes(d.name_en.split(' ')[0]), `EN name ${slug}`);
    assert.ok(h.text.includes(d.name_hi), `HI name ${slug}`);
    assert.ok(e.text.includes('Availability to be confirmed') && h.text.includes('उपलब्धता की पुष्टि बाकी है'), `status badge ${slug}`);
    assert.match(e.text, /<form/); assert.match(e.text, /Clinical information notice/); assert.match(h.text, /चिकित्सकीय जानकारी/);
    assert.match(e.text, /href="tel:\+911494246333"/);
  }
  assert.equal(SLUGS.length, 11);
});

test('hospital identity: exact address, telephone numbers, taglines, hero headings', async () => {
  const e = await c.get('/en/'), h = await c.get('/hi/');
  for (const t of ['01494-246333', '09799107439', 'Sarai Road, Mundawar, District Khairthal-Tijara, Rajasthan, PIN 301707', 'Always Dedicated to Your Health.', 'Your Health, Our Priority.']) assert.ok(e.text.includes(t), t);
  for (const t of ['आपके स्वास्थ्य के लिए सदैव समर्पित...', 'आपका स्वास्थ्य, हमारी प्राथमिकता।', 'सराय रोड, मुंडावर']) assert.ok(h.text.includes(t), t);
  assert.match(e.text, /tel:\+919799107439/);
  assert.match(e.text, /"@type":"Hospital"/);
});

test('empty doctor directory: friendly bilingual message, no fake doctors, requests still possible', async () => {
  const e = await c.get('/en/doctors'), h = await c.get('/hi/doctors');
  assert.match(e.text, /Doctor profiles will be updated soon/);
  assert.match(h.text, /चिकित्सकों की जानकारी जल्द अपडेट की जाएगी/);
  assert.match(e.text, /href="\/en\/appointment"/);
  assert.equal(H.get(app.db, 'SELECT COUNT(*) c FROM doctors').c, 0);
  assert.match((await c.get('/en/')).text, /Doctor profiles will be updated soon/);
});

test('no invented claims: opening hours unpublished, no 24/7, no ratings/accreditation, directions pending', async () => {
  for (const p of ['/en/', '/hi/', '/en/contact', '/en/about']) {
    const r = await c.get(p);
    assert.ok(!/24\s*[/x×]\s*7|24 hours|round the clock|NABH|ISO|accredit|★|rating/i.test(r.text), `claim on ${p}`);
  }
  const contact = await c.get('/en/contact');
  assert.match(contact.text, /Hours to be confirmed/); assert.match((await c.get('/hi/contact')).text, /समय की पुष्टि बाकी है/);
  assert.match(contact.text, /Map directions will be added after the location is verified/);
  assert.ok(!contact.text.includes('google.com/maps'));
  assert.match(contact.text, /not an emergency service/i);
});

test('blood bank page does not claim to be a licensed blood bank; dialysis shows no hours/capacity', async () => {
  const b = await c.get('/en/departments/blood-bank');
  assert.match(b.text, /not advertised here as a licensed blood bank/);
  const d = await c.get('/en/departments/dialysis');
  assert.match(d.text, /Operating hours, capacity and equipment have not been published/);
});

test('security headers, CSP, static assets and SEO files', async () => {
  const r = await c.get('/en/');
  assert.equal(r.headers.get('x-frame-options'), 'DENY'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.ok(!/<script(?![^>]*src=)[^>]*>(?!\s*$)/.test(r.text.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '')), 'no inline scripts');
  assert.equal((await c.get('/static/css/style.css')).status, 200);
  assert.equal((await c.get('/static/../package.json')).status, 404);
  assert.equal((await c.get('/static/%2e%2e/package.json')).status, 404);
  const sm = await c.get('/sitemap.xml'); assert.match(sm.text, /\/hi\/departments\/radiology/);
  assert.match((await c.get('/robots.txt')).text, /Disallow: \/admin/);
  assert.match(r.text, /<link rel="alternate" hreflang="hi"/); assert.match(r.text, /<meta property="og:title"/);
});

test('html templating escapes interpolated values (XSS barrier)', () => {
  assert.equal(html`<p>${'<script>alert(1)</script>'}</p>`.toString(), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(html`<a title="${'" onmouseover="x'}">`.toString(), '<a title="&quot; onmouseover=&quot;x">');
});

test('availability statuses are admin-controlled and shown publicly', async () => {
  H.run(app.db, "UPDATE services SET status='available' WHERE name_en='X-ray'");
  H.run(app.db, "UPDATE services SET status='temporarily_unavailable' WHERE name_en='CT scan'");
  const e = await c.get('/en/departments/radiology'), h = await c.get('/hi/departments/radiology');
  assert.match(e.text, /Available/); assert.match(e.text, /Temporarily unavailable/); assert.match(h.text, /अस्थायी रूप से अनुपलब्ध/);
  H.run(app.db, "UPDATE services SET status='to_be_confirmed' WHERE is_diagnostic=1");
});

test('approved preparation instructions only; unapproved text is never shown', async () => {
  H.run(app.db, "UPDATE services SET prep_en='UNAPPROVED-PREP', prep_approved=0 WHERE name_en='X-ray'");
  assert.ok(!(await c.get('/en/departments/radiology')).text.includes('UNAPPROVED-PREP'));
  H.run(app.db, "UPDATE services SET prep_approved=1 WHERE name_en='X-ray'");
  assert.ok((await c.get('/en/departments/radiology')).text.includes('UNAPPROVED-PREP'));
  H.run(app.db, "UPDATE services SET prep_en=NULL, prep_approved=0 WHERE name_en='X-ray'");
});

test('published hours/map/emergency appear only when confirmed in settings', async () => {
  H.run(app.db, "UPDATE hospital_settings SET value='Mon-Sat 9-5 (TEST)' WHERE key='hours_en'");
  assert.ok(!(await c.get('/en/contact')).text.includes('TEST'), 'hours hidden while unconfirmed');
  H.run(app.db, "UPDATE hospital_settings SET value='1' WHERE key='hours_confirmed'");
  assert.ok((await c.get('/en/contact')).text.includes('Mon-Sat 9-5 (TEST)'));
  H.run(app.db, "UPDATE hospital_settings SET value='https://maps.example/test' WHERE key='map_url'");
  assert.ok(!(await c.get('/en/contact')).text.includes('maps.example'), 'map hidden until verified');
  H.run(app.db, "UPDATE hospital_settings SET value='1' WHERE key='map_verified'");
  assert.ok((await c.get('/en/contact')).text.includes('maps.example'));
  for (const [k, v] of [['hours_confirmed', '0'], ['hours_en', ''], ['map_verified', '0'], ['map_url', '']]) H.run(app.db, 'UPDATE hospital_settings SET value=? WHERE key=?', v, k);
});

test('header branding has hospital logo on left and trust logo on right', async () => {
  const e = await c.get('/en/');
  assert.ok(e.text.includes('<a class="brand" href="/en/"><img src="/static/img/hospital-logo.jpg"'));
  assert.ok(e.text.includes('<div class="header-trust"><a href="/en/about" title="Sachkhand Charitable Trust"><img src="/static/img/trust-logo.png"'));
});

test('verified doctors ordered with Dr. Gajraj Yadav first and poster removed', async () => {
  const { seedVerifiedDoctors } = require('../src/data/verified-doctors');
  seedVerifiedDoctors(app.db);
  const e = await c.get('/en/doctors');
  assert.equal(e.status, 200);
  assert.ok(!e.text.includes('doctors-team.jpg'), 'poster must not be rendered on doctors page');
  assert.ok(e.text.includes('Dr. Gajraj Yadav'));
  assert.ok(e.text.includes('Dr. Kritesh Mehta'));
  const gajrajIdx = e.text.indexOf('Dr. Gajraj Yadav');
  const kriteshIdx = e.text.indexOf('Dr. Kritesh Mehta');
  assert.ok(gajrajIdx !== -1 && kriteshIdx !== -1 && gajrajIdx < kriteshIdx, 'Dr. Gajraj Yadav must appear before Dr. Kritesh Mehta');
  H.run(app.db, 'DELETE FROM doctor_departments');
  H.run(app.db, 'DELETE FROM doctor_schedules');
  H.run(app.db, 'DELETE FROM doctors');
});
