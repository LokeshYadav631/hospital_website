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

test('appointment receipt: rendered after booking on success page with print and download options', async () => {
  const form = H.consultForm(app.db, {
    patient_name: 'Rajesh Sharma',
    mobile: '9876543210',
    age: '42',
    gender: 'male',
  });
  const res = await c.post('/en/appointment', form);
  assert.equal(res.status, 303);
  assert.equal(res.location, '/en/appointment/success');

  const successPage = await c.get(res.location);
  assert.equal(successPage.status, 200);

  // Checks receipt card elements
  assert.ok(successPage.text.includes('id="appointment-receipt"'), 'receipt slip should be present on success page');
  assert.ok(successPage.text.includes('Rajesh Sharma'), 'patient name must appear on receipt');
  assert.ok(successPage.text.includes('9876543210'), 'mobile must appear on receipt');
  assert.ok(successPage.text.includes('SACHKHAND HOSPITAL'), 'hospital name must appear on receipt');
  assert.ok(successPage.text.includes('data-print'), 'print button must be present with data-print');
  assert.ok(successPage.text.includes('/en/appointment/receipt/download'), 'download receipt link must be present');
  assert.ok(successPage.text.includes('format=txt'), 'text download option must be present');
});

test('dedicated receipt page: accessible via ref + mobile query params', async () => {
  const form = H.consultForm(app.db, {
    patient_name: 'Sunita Devi',
    mobile: '9812345678',
    age: '38',
    gender: 'female',
  });
  const res = await c.post('/en/appointment', form);
  const successPage = await c.get(res.location);
  const ref = /SKH-[A-Z0-9]{4}-[A-Z0-9]{4}/.exec(successPage.text)[0];

  // Access dedicated receipt page
  const receiptEn = await c.get(`/en/appointment/receipt?ref=${ref}&mobile=9812345678`);
  assert.equal(receiptEn.status, 200);
  assert.ok(receiptEn.text.includes(ref));
  assert.ok(receiptEn.text.includes('Sunita Devi'));
  assert.ok(receiptEn.text.includes('Appointment Booking Slip &amp; Receipt') || receiptEn.text.includes('Appointment Booking Slip & Receipt'));

  // Hindi dedicated receipt page
  const receiptHi = await c.get(`/hi/appointment/receipt?ref=${ref}&mobile=9812345678`);
  assert.equal(receiptHi.status, 200);
  assert.ok(receiptHi.text.includes(ref));
  assert.ok(receiptHi.text.includes('सुनीता देवी') || receiptHi.text.includes('Sunita Devi'));
  assert.ok(receiptHi.text.includes('अपॉइंटमेंट बुकिंग पर्ची एवं रसीद'));

  // Invalid ref or mobile redirects to status lookup
  const badReceipt = await c.get(`/en/appointment/receipt?ref=${ref}&mobile=9999999999`);
  assert.equal(badReceipt.status, 303);
  assert.equal(badReceipt.location, '/en/appointment/status');
});

test('download receipt: serves standalone HTML and TXT attachments', async () => {
  const form = H.consultForm(app.db, {
    patient_name: 'Amit Verma',
    mobile: '9799123456',
  });
  const res = await c.post('/en/appointment', form);
  const successPage = await c.get(res.location);
  const ref = /SKH-[A-Z0-9]{4}-[A-Z0-9]{4}/.exec(successPage.text)[0];

  // HTML format download
  const dlHtml = await c.get(`/en/appointment/receipt/download?ref=${ref}&mobile=9799123456`);
  assert.equal(dlHtml.status, 200);
  assert.match(dlHtml.headers.get('content-type'), /text\/html/);
  assert.match(dlHtml.headers.get('content-disposition'), new RegExp(`attachment; filename="sachkhand-receipt-${ref}.html"`));
  assert.ok(dlHtml.text.includes('<!DOCTYPE html>'));
  assert.ok(dlHtml.text.includes('Amit Verma'));
  assert.ok(dlHtml.text.includes(ref));

  // TXT format download
  const dlTxt = await c.get(`/en/appointment/receipt/download?ref=${ref}&mobile=9799123456&format=txt`);
  assert.equal(dlTxt.status, 200);
  assert.match(dlTxt.headers.get('content-type'), /text\/plain/);
  assert.match(dlTxt.headers.get('content-disposition'), new RegExp(`attachment; filename="sachkhand-receipt-${ref}.txt"`));
  assert.ok(dlTxt.text.includes('SACHKHAND HOSPITAL - APPOINTMENT REGISTRATION SLIP'));
  assert.ok(dlTxt.text.includes(`BOOKING REFERENCE : ${ref}`));
  assert.ok(dlTxt.text.includes('Patient Name    : Amit Verma'));
});

test('status check page: shows appointment receipt and download links for verified patient', async () => {
  const form = H.consultForm(app.db, {
    patient_name: 'Pooja Yadav',
    mobile: '9888777666',
  });
  const res = await c.post('/en/appointment', form);
  const successPage = await c.get(res.location);
  const ref = /SKH-[A-Z0-9]{4}-[A-Z0-9]{4}/.exec(successPage.text)[0];

  // Look up status
  const statusRes = await c.post('/en/appointment/status', { ref, mobile: '9888777666' });
  assert.equal(statusRes.status, 200);
  assert.ok(statusRes.text.includes('id="appointment-receipt"'));
  assert.ok(statusRes.text.includes(ref));
  assert.ok(statusRes.text.includes('Pooja Yadav'));
  assert.ok(statusRes.text.includes('/en/appointment/receipt/download'));
});

test('hospital enriched details: homepage highlights band and about page government schemes', async () => {
  const homeEn = await c.get('/en/');
  assert.ok(homeEn.text.includes('Ayushman &amp; RGHS') || homeEn.text.includes('Ayushman & RGHS'));
  assert.ok(homeEn.text.includes('90 Beds &amp; 15 ICU Units') || homeEn.text.includes('90 Beds & 15 ICU Units'));
  assert.ok(homeEn.text.includes('CT Scan &amp; Digital Imaging') || homeEn.text.includes('CT Scan & Digital Imaging'));

  const homeHi = await c.get('/hi/');
  assert.ok(homeHi.text.includes('आयुष्मान एवं RGHS'));
  assert.ok(homeHi.text.includes('90 बेड एवं 15 आईसीयू यूनिट'));
  assert.ok(homeHi.text.includes('सीटी स्कैन एवं डिजिटल इमेजिंग'));

  const aboutEn = await c.get('/en/about');
  assert.ok(aboutEn.text.includes('Government health schemes'));
  assert.ok(aboutEn.text.includes('Ayushman Bharat'));

  const aboutHi = await c.get('/hi/about');
  assert.ok(aboutHi.text.includes('सरकारी स्वास्थ्य योजनाएँ'));
  assert.ok(aboutHi.text.includes('आयुष्मान भारत'));
});
