'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let app, c;
before(async () => {
  app = await H.boot();
  c = new H.Client(app.base);
});
after(() => app.close());

const OFFICIAL_FB = 'https://www.facebook.com/profile.php?id=100054475659030';
const OFFICIAL_IG = 'https://www.instagram.com/sachkhandhospital?utm_source=ig_web_button_share_sheet&psln=ZDNlZDc0MzIxNw==';

test('permanent social accounts: exact official Instagram and Facebook links appear on website', async () => {
  // Ensure default seeded settings have the official links
  H.run(app.db, 'UPDATE hospital_settings SET value=? WHERE key=?', OFFICIAL_FB, 'facebook_url');
  H.run(app.db, 'UPDATE hospital_settings SET value=? WHERE key=?', OFFICIAL_IG, 'instagram_url');

  const enPage = await c.get('/en/');
  assert.equal(enPage.status, 200);

  // Topbar social links (HTML escaped)
  assert.ok(enPage.text.includes(OFFICIAL_FB), 'official Facebook link must be in topbar/page');
  assert.ok(enPage.text.includes(OFFICIAL_IG.replace(/&/g, '&amp;')) || enPage.text.includes(OFFICIAL_IG), 'official Instagram link must be in topbar/page');

  // Footer social buttons
  assert.ok(enPage.text.includes('footer-social-btn fb-footer-btn'), 'footer facebook button present');
  assert.ok(enPage.text.includes('footer-social-btn ig-footer-btn'), 'footer instagram button present');

  // Hindi page also has them
  const hiPage = await c.get('/hi/');
  assert.equal(hiPage.status, 200);
  assert.ok(hiPage.text.includes(OFFICIAL_FB));
  assert.ok(hiPage.text.includes(OFFICIAL_IG.replace(/&/g, '&amp;')) || hiPage.text.includes(OFFICIAL_IG));
});

test('mobile phone UI: mobile bottom bar and mobile menu extras (with no admin login links in user UI)', async () => {
  const page = await c.get('/en/');
  assert.equal(page.status, 200);

  // Mobile Bottom Bar for fast smartphone touch actions
  assert.ok(page.text.includes('mobile-bottom-bar'), 'mobile bottom navigation bar must be present');
  assert.ok(page.text.includes('mbi-item mbi-highlight'), 'mobile book appointment CTA must be highlighted');
  assert.ok(page.text.includes('/en/appointment/status'), 'mobile check status link must be in bottom bar');

  // Mobile Menu Extras inside #site-nav
  assert.ok(page.text.includes('site-nav-mobile-extras'), 'mobile menu extras container must be present');
  assert.ok(page.text.includes('mobile-menu-social'), 'social buttons inside mobile menu drawer');

  // Verification: No admin login links anywhere in the user UI
  assert.ok(!page.text.includes('footer-admin-link'), 'no admin login link in footer');
  assert.ok(!page.text.includes('mobile-menu-admin'), 'no admin login link in mobile menu');
  assert.ok(!page.text.includes('href="/admin"'), 'user UI must not expose any link to /admin');
});

test('admin and user interface linkage: view public website in admin & settings sync to user site', async () => {
  // 1. User site does not expose any admin links
  const anon = await c.get('/en/');
  assert.ok(!anon.text.includes('/admin'), 'user site must have zero admin links');

  // 2. Log in as super admin using helper
  const adminClient = new H.Client(app.base);
  const u = await H.makeUser(app.db, 'super_admin', { email: 'headadmin@sachkhandhospital.org', name: 'Dr. Head Admin' });
  const loginRes = await H.login(adminClient, u);
  assert.equal(loginRes.status, 303);

  // 3. Admin Panel has direct link to View Public Website
  const adminDash = await adminClient.get('/admin');
  assert.equal(adminDash.status, 200);
  assert.ok(adminDash.text.includes('View Public Website'), 'admin sidebar must contain View Public Website link');
  assert.ok(adminDash.text.includes('href="/en/"'));

  // 4. Changing hospital settings in admin updates public site immediately and permanently
  const base = {
    phone1: '01494-246333',
    phone2: '09799107439',
    address_en: 'Sarai Road, Mundawar, Test Colony',
    address_hi: 'सराय रोड, मुंडावर, टेस्ट कॉलोनी',
    tagline_en: 'Custom Admin Tagline Test',
    tagline_hi: 'कस्टम एडमिन टैगलाइन टेस्ट',
    facebook_url: OFFICIAL_FB,
    instagram_url: OFFICIAL_IG,
  };
  const saveRes = await adminClient.post('/admin/settings', base, { from: '/admin/settings' });
  assert.equal(saveRes.status, 303);

  // Check public site immediately reflects the change
  const updatedPub = await c.get('/en/');
  assert.ok(updatedPub.text.includes('Custom Admin Tagline Test'), 'public site must immediately reflect tagline edit');
  assert.ok(updatedPub.text.includes('Sarai Road, Mundawar, Test Colony'), 'public site must immediately reflect address edit');

  // Check Hindi version reflects immediately
  const updatedHi = await c.get('/hi/');
  assert.ok(updatedHi.text.includes('कस्टम एडमिन टैगलाइन टेस्ट'));
  assert.ok(updatedHi.text.includes('सराय रोड, मुंडावर, टेस्ट कॉलोनी'));
});
