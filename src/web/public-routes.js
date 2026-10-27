'use strict';
const { all, get, run } = require('../lib/db');
const config = require('../lib/config');
const sec = require('../lib/security');
const V = require('../lib/validation');
const clock = require('../lib/clock');
const views = require('./public-views');
const slots = require('../services/slots');
const appts = require('../services/appointments');
const notifications = require('../services/notifications');
const { getContent } = require('../services/settings');

const HOUR = 3600e3;

module.exports = function register(router) {
  // language-aware wrapper: sets ctx.lang from the URL, loads editable content
  const P = (handler) => async (ctx) => {
    if (!['en', 'hi'].includes(ctx.params.lang)) return notFound(ctx);
    ctx.setLang(ctx.params.lang);
    ctx.content = getContent(ctx.db);
    ctx.cookie('lang', ctx.lang, { httpOnly: false, maxAge: 31536000 });
    return handler(ctx);
  };
  const notFound = (ctx) => { if (!ctx.content) ctx.content = getContent(ctx.db); ctx.html(views.notFound(ctx), 404); };
  router.notFound = (ctx) => {
    const m = /^\/(en|hi)(\/|$)/.exec(ctx.url.pathname);
    ctx.setLang(m ? m[1] : (ctx.cookies.lang === 'hi' ? 'hi' : 'en'));
    notFound(ctx);
  };

  const tooMany = (ctx, bucket, max, windowMs) => !sec.rateLimit(`${bucket}:${ctx.ip}`, max, windowMs);

  router.get('/', (ctx) => {
    const pref = ctx.cookies.lang === 'hi' || ctx.cookies.lang === 'en' ? ctx.cookies.lang : /^hi\b/i.test(ctx.req.headers['accept-language'] || '') ? 'hi' : 'en';
    ctx.redirect(`/${pref}/`, 302);
  });
  router.get('/:lang', P((ctx) => ctx.html(views.home(ctx)))); // matches /en and /en/
  router.get('/:lang/about', P((ctx) => ctx.html(views.about(ctx))));
  router.get('/:lang/departments', P((ctx) => ctx.html(views.departmentsIndex(ctx))));
  router.get('/:lang/departments/:slug', P((ctx) => {
    const d = get(ctx.db, 'SELECT * FROM departments WHERE slug=? AND active=1', ctx.params.slug);
    return d ? ctx.html(views.departmentPage(ctx, d)) : notFound(ctx);
  }));
  router.get('/:lang/doctors', P((ctx) => ctx.html(views.doctorsPage(ctx))));
  router.get('/:lang/privacy', P((ctx) => ctx.html(views.policyPage(ctx, 'privacy', ctx.t('footer_privacy')))));
  router.get('/:lang/terms', P((ctx) => ctx.html(views.policyPage(ctx, 'terms', ctx.t('footer_terms')))));

  // ---- contact / inquiry ----
  router.get('/:lang/contact', P((ctx) => ctx.html(views.contactPage(ctx))));
  router.post('/:lang/contact', P((ctx) => {
    const { errors, v } = V.validateInquiry(ctx.body);
    if (tooMany(ctx, 'inquiry', 5, HOUR)) return ctx.html(views.contactPage(ctx, { values: ctx.body, errors: { _: 'e_rate' } }), 429);
    if (Object.keys(errors).length) return ctx.html(views.contactPage(ctx, { values: ctx.body, errors }), 422);
    const dept = v.department_id && get(ctx.db, 'SELECT id FROM departments WHERE id=? AND active=1', v.department_id);
    run(ctx.db, 'INSERT INTO inquiries(name,mobile,email,department_id,message,language,created_at) VALUES (?,?,?,?,?,?,?)', v.name, v.mobile, v.email, dept ? dept.id : null, v.message, ctx.lang, clock.sqlNow());
    ctx.html(views.contactPage(ctx, { done: true }));
  }));

  // ---- consultation request ----
  const flashSet = (ctx, ref, type, flags) => ctx.cookie('flash', sec.sign(`${ref}|${type}|${flags}`), { maxAge: 600 });
  const apptState = (ctx, body) => {
    const st = { values: body, errors: {} };
    const docId = Number(body.doctor_id), date = body.preferred_date;
    if (docId && clock.isDate(date)) st.slotTimes = slots.slotsFor(ctx.db, docId, date);
    return st;
  };
  router.get('/:lang/appointment', P((ctx) => ctx.html(views.appointmentPage(ctx, { deptId: ctx.query.department || '', docId: ctx.query.doctor || '' }))));
  router.post('/:lang/appointment', P((ctx) => {
    if (ctx.body.action === 'slots') return ctx.html(views.appointmentPage(ctx, apptState(ctx, ctx.body))); // no-JS slot lookup, nothing saved
    if (tooMany(ctx, 'book', 10, HOUR)) return ctx.html(views.appointmentPage(ctx, { values: ctx.body, errors: { _: 'e_rate' } }), 429);
    const { errors, v } = V.validateConsultation(ctx.body);
    if (Object.keys(errors).length) return ctx.html(views.appointmentPage(ctx, { ...apptState(ctx, ctx.body), errors }), 422);
    try {
      const r = appts.createConsultation(ctx.db, v);
      notifications.dispatchSoon(ctx.db);
      flashSet(ctx, r.ref, 'consultation', (r.slotHeld ? 's' : '') + (v.sms_consent ? 'm' : ''));
      return ctx.redirect(`/${ctx.lang}/appointment/success`);
    } catch (e) {
      if (e instanceof appts.BookingError) return ctx.html(views.appointmentPage(ctx, { ...apptState(ctx, ctx.body), errors: { [e.field || '_']: e.code } }), 409);
      console.error('createConsultation failed:', e);
      return ctx.html(views.appointmentPage(ctx, { values: ctx.body, errors: { _: 'e_generic' } }), 500);
    }
  }));
  router.get('/:lang/appointment/success', P((ctx) => {
    const f = sec.unsign(ctx.cookies.flash);
    if (!f) return ctx.redirect(`/${ctx.lang}/appointment`);
    const parts = f.split('|');
    const ref = parts[0];
    const appt = ref ? get(ctx.db, 'SELECT * FROM appointments WHERE ref=?', ref) : null;
    ctx.html(views.successPage(ctx, parts, appt));
  }));

  // ---- receipt printable view & download ----
  router.get('/:lang/appointment/receipt', P((ctx) => {
    let appt = null;
    if (ctx.query.ref && ctx.query.mobile) {
      appt = appts.lookupAppointment(ctx.db, ctx.query.ref, ctx.query.mobile);
    } else {
      const f = sec.unsign(ctx.cookies.flash);
      if (f) {
        const [ref] = f.split('|');
        if (ref && (!ctx.query.ref || ctx.query.ref === ref)) {
          appt = get(ctx.db, 'SELECT * FROM appointments WHERE ref=?', ref);
        }
      }
    }
    if (!appt) return ctx.redirect(`/${ctx.lang}/appointment/status`);
    ctx.html(views.receiptPage(ctx, appt));
  }));

  router.get('/:lang/appointment/receipt/download', P((ctx) => {
    let appt = null;
    if (ctx.query.ref && ctx.query.mobile) {
      appt = appts.lookupAppointment(ctx.db, ctx.query.ref, ctx.query.mobile);
    } else {
      const f = sec.unsign(ctx.cookies.flash);
      if (f) {
        const [ref] = f.split('|');
        if (ref && (!ctx.query.ref || ctx.query.ref === ref)) {
          appt = get(ctx.db, 'SELECT * FROM appointments WHERE ref=?', ref);
        }
      }
    }
    if (!appt) return ctx.redirect(`/${ctx.lang}/appointment/status`);

    const s = ctx.settings;
    const dept = appt.department_id ? get(ctx.db, 'SELECT * FROM departments WHERE id=?', appt.department_id) : null;
    const doc = appt.doctor_id ? get(ctx.db, 'SELECT * FROM doctors WHERE id=?', appt.doctor_id) : null;
    const svc = appt.service_id ? get(ctx.db, 'SELECT * FROM services WHERE id=?', appt.service_id) : null;
    const deptName = dept ? (ctx.lang === 'hi' ? dept.name_hi : dept.name_en) : (appt.type === 'diagnostic' ? ctx.t('diag_card') : '—');
    const docName = doc ? (ctx.lang === 'hi' ? doc.name_hi : doc.name_en) : ctx.bi('Doctor to be assigned by hospital', 'चिकित्सक अस्पताल द्वारा निर्धारित किया जाएगा');
    const rangeLabel = { morning: 'tr_morning', afternoon: 'tr_afternoon', evening: 'tr_evening', any: 'tr_any' };
    const slotText = appt.slot_start ? appt.slot_start : (appt.preferred_date ? `${appt.preferred_date} (${ctx.t(rangeLabel[appt.preferred_range] || 'tr_any')})` : '—');

    if (ctx.query.format === 'txt') {
      const txt = [
        '==================================================================',
        `${s.hospital_name_en} - APPOINTMENT REGISTRATION SLIP`,
        `Managed by: ${s.trust_name_en}`,
        `Address: ${s.address_en}`,
        `Telephone: ${s.phone1} / ${s.phone2}`,
        '==================================================================',
        `BOOKING REFERENCE : ${appt.ref}`,
        `DATE ISSUED       : ${clock.todayIST()}`,
        `STATUS            : ${appt.status}`,
        '',
        'PATIENT INFORMATION:',
        `- Patient Name    : ${appt.patient_name}`,
        `- Mobile Number   : ${appt.mobile}`,
        `- Age / Gender    : ${appt.age || '—'} / ${appt.gender || '—'}`,
        `- Patient Type    : ${appt.patient_type === 'returning' ? 'Returning' : 'New'}`,
        '',
        'APPOINTMENT DETAILS:',
        `- Department      : ${deptName}${svc ? ' - ' + (ctx.lang === 'hi' ? svc.name_hi : svc.name_en) : ''}`,
        `- Consulting Dr.  : ${docName}`,
        `- Scheduled Time  : ${slotText}`,
        '',
        'IMPORTANT INSTRUCTIONS:',
        '1. Please arrive at registration counter 15 minutes prior to appointment.',
        '2. Please carry previous prescriptions and diagnostic reports.',
        '3. Ayushman Bharat (PM-JAY) / RGHS beneficiaries must carry their card.',
        `4. Helpline: ${s.phone1} / ${s.phone2}`,
        '==================================================================',
        `${s.tagline_en}`,
        '==================================================================',
      ].join('\r\n');

      ctx.res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      ctx.res.setHeader('Content-Disposition', `attachment; filename="sachkhand-receipt-${appt.ref}.txt"`);
      return ctx.send(200, txt, 'text/plain; charset=utf-8');
    }

    // Default: Self-contained Offline HTML receipt download
    const htmlDoc = `<!DOCTYPE html>
<html lang="${ctx.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt - ${appt.ref} - ${s['hospital_name_' + ctx.lang]}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; color: #1e293b; margin: 0; padding: 24px 16px; }
  .receipt-box { background: #fff; max-width: 680px; margin: 0 auto; border: 1px solid #cbd5e1; border-top: 6px solid #0f2b48; border-radius: 8px; padding: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px dashed #cbd5e1; padding-bottom: 16px; margin-bottom: 16px; gap: 12px; }
  .hname { margin: 0; font-size: 20px; color: #0f2b48; font-weight: bold; }
  .tname { margin: 2px 0; font-size: 13px; color: #64748b; font-weight: 600; }
  .addr { margin: 4px 0 0; font-size: 12px; color: #64748b; }
  .badge-col { text-align: right; }
  .badge { background: #e2e8f0; color: #0f2b48; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; display: inline-block; }
  .ref { font-family: monospace; font-size: 18px; font-weight: bold; color: #0f2b48; margin-top: 4px; }
  .grid { display: flex; gap: 20px; margin-bottom: 16px; }
  .col { flex: 1; }
  @media (max-width: 580px) { .grid { flex-direction: column; } .header { flex-direction: column; } .badge-col { text-align: left; } }
  .title { font-size: 13px; font-weight: bold; color: #0f2b48; border-bottom: 2px solid #38bdf8; padding-bottom: 4px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 5px 0; color: #64748b; font-weight: 600; width: 45%; vertical-align: top; }
  td { padding: 5px 0; color: #1e293b; vertical-align: top; }
  .inst { background: #f1f5f9; border-left: 4px solid #0d9488; padding: 10px 14px; border-radius: 4px; font-size: 12px; margin-bottom: 16px; }
  .inst h4 { margin: 0 0 4px; color: #0f2b48; }
  .inst ol { margin: 0; padding-left: 16px; line-height: 1.5; color: #475569; }
  .footer { text-align: center; border-top: 1px dashed #cbd5e1; padding-top: 12px; font-size: 12px; color: #64748b; }
  .actions { text-align: center; margin-top: 20px; }
  .btn { display: inline-block; padding: 9px 18px; background: #0f2b48; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold; cursor: pointer; border: none; font-size: 14px; }
  @media print { .actions { display: none !important; } body { background: #fff; padding: 0; } .receipt-box { border: 1px solid #777; box-shadow: none; max-width: 100%; } }
</style>
</head>
<body>
<div class="receipt-box">
  <div class="header">
    <div>
      <div class="hname">${s['hospital_name_' + ctx.lang]}</div>
      <div class="tname">${s['trust_name_' + ctx.lang]}</div>
      <div class="addr">${s['address_' + ctx.lang]} · ☎ ${s.phone1}</div>
    </div>
    <div class="badge-col">
      <span class="badge">${ctx.t('receipt_subtitle')}</span>
      <div class="ref">${appt.ref}</div>
      <div style="font-size:11px;color:#64748b">${ctx.t('receipt_date')}: ${clock.todayIST()}</div>
    </div>
  </div>

  <div class="grid">
    <div class="col">
      <div class="title">👤 ${ctx.t('receipt_patient_info')}</div>
      <table>
        <tr><th>${ctx.t('receipt_patient_name')}:</th><td><strong>${appt.patient_name}</strong></td></tr>
        <tr><th>${ctx.t('receipt_mobile')}:</th><td>${appt.mobile}</td></tr>
        ${appt.email ? `<tr><th>${ctx.t('f_email')}:</th><td>${appt.email}</td></tr>` : ''}
        <tr><th>${ctx.t('receipt_age_gender')}:</th><td>${appt.age ? appt.age + ' ' + ctx.t('years') : '—'} / ${appt.gender ? ctx.t('g_' + appt.gender) : '—'}</td></tr>
        <tr><th>${ctx.t('receipt_type')}:</th><td>${appt.patient_type === 'returning' ? ctx.t('pt_returning') : ctx.t('pt_new')}</td></tr>
      </table>
    </div>
    <div class="col">
      <div class="title">🏥 ${ctx.t('receipt_appt_info')}</div>
      <table>
        <tr><th>${ctx.t('receipt_num')}:</th><td><strong>${appt.ref}</strong></td></tr>
        <tr><th>${ctx.t('receipt_dept')}:</th><td><strong>${deptName}</strong>${svc ? ' — ' + (ctx.lang === 'hi' ? svc.name_hi : svc.name_en) : ''}</td></tr>
        <tr><th>${ctx.t('receipt_doctor')}:</th><td>${docName}</td></tr>
        <tr><th>${ctx.t('receipt_slot')}:</th><td><strong>${slotText}</strong></td></tr>
        <tr><th>${ctx.t('receipt_status')}:</th><td>${appt.status}</td></tr>
      </table>
    </div>
  </div>

  <div class="inst">
    <h4>📋 ${ctx.t('receipt_instructions_title')}</h4>
    <ol>
      <li>${ctx.t('receipt_inst_1')}</li>
      <li>${ctx.t('receipt_inst_2')}</li>
      <li>${ctx.t('receipt_inst_3')}</li>
      <li>${ctx.t('receipt_inst_4')}</li>
    </ol>
  </div>

  <div class="footer">
    <em>${ctx.t('receipt_tagline')}</em>
  </div>

  <div class="actions">
    <button class="btn" onclick="window.print()">🖨️ ${ctx.t('receipt_print')}</button>
  </div>
</div>
</body>
</html>`;

    ctx.res.setHeader('Content-Type', 'text/html; charset=utf-8');
    ctx.res.setHeader('Content-Disposition', `attachment; filename="sachkhand-receipt-${appt.ref}.html"`);
    return ctx.send(200, htmlDoc, 'text/html; charset=utf-8');
  }));

  // ---- diagnostic request ----
  router.get('/:lang/diagnostics', P((ctx) => ctx.html(views.diagnosticsPage(ctx, { serviceId: ctx.query.service || '' }))));
  router.post('/:lang/diagnostics', P((ctx) => {
    if (tooMany(ctx, 'book', 10, HOUR)) return ctx.html(views.diagnosticsPage(ctx, { values: ctx.body, errors: { _: 'e_rate' } }), 429);
    const { errors, v } = V.validateDiagnostic(ctx.body);
    if (Object.keys(errors).length) return ctx.html(views.diagnosticsPage(ctx, { values: ctx.body, errors }), 422);
    try {
      const r = appts.createDiagnostic(ctx.db, v);
      notifications.dispatchSoon(ctx.db);
      flashSet(ctx, r.ref, 'diagnostic', (r.inquiryOnly ? 'i' : '') + (v.sms_consent ? 'm' : ''));
      return ctx.redirect(`/${ctx.lang}/appointment/success`);
    } catch (e) {
      if (e instanceof appts.BookingError) return ctx.html(views.diagnosticsPage(ctx, { values: ctx.body, errors: { [e.field || '_']: e.code } }), 409);
      console.error('createDiagnostic failed:', e);
      return ctx.html(views.diagnosticsPage(ctx, { values: ctx.body, errors: { _: 'e_generic' } }), 500);
    }
  }));

  // ---- status lookup & patient change requests (verified by reference + mobile) ----
  router.get('/:lang/appointment/status', P((ctx) => ctx.html(views.statusPage(ctx))));
  router.post('/:lang/appointment/status', P((ctx) => {
    if (tooMany(ctx, 'lookup', 10, 15 * 60e3)) return ctx.html(views.statusPage(ctx, { values: ctx.body, error: 'e_rate' }), 429);
    const a = appts.lookupAppointment(ctx.db, ctx.body.ref, ctx.body.mobile);
    if (!a) return ctx.html(views.statusPage(ctx, { values: ctx.body, error: 'e_lookup' }), 404);
    ctx.html(views.statusPage(ctx, { values: { ref: a.ref, mobile: V.normalizeMobile(ctx.body.mobile) }, appt: a }));
  }));
  router.post('/:lang/appointment/status/change', P((ctx) => {
    if (tooMany(ctx, 'lookup', 10, 15 * 60e3)) return ctx.html(views.statusPage(ctx, { error: 'e_rate' }), 429);
    const a = appts.lookupAppointment(ctx.db, ctx.body.ref, ctx.body.mobile);
    if (!a) return ctx.html(views.statusPage(ctx, { error: 'e_lookup' }), 404);
    const values = { ref: a.ref, mobile: V.normalizeMobile(ctx.body.mobile) };
    const errs = {};
    const newDate = V.str(ctx.body.new_date, 10) || null;
    if (ctx.body.kind === 'reschedule') V.checkDate(newDate, errs, 'new_date');
    if (Object.keys(errs).length) return ctx.html(views.statusPage(ctx, { values, appt: a, changeError: errs.new_date }), 422);
    try {
      appts.createChangeRequest(ctx.db, a, { kind: ctx.body.kind, new_date: newDate, new_range: ['morning', 'afternoon', 'evening', 'any'].includes(ctx.body.new_range) ? ctx.body.new_range : 'any', note: V.str(ctx.body.note, 300) });
      return ctx.html(views.statusPage(ctx, { values, appt: a, changeDone: true }));
    } catch (e) {
      if (e instanceof appts.BookingError) return ctx.html(views.statusPage(ctx, { values, appt: a, changeError: e.code }), 409);
      throw e;
    }
  }));

  // ---- JSON: open slots (only times; no patient data) ----
  router.get('/api/slots', (ctx) => {
    if (tooMany(ctx, 'slots', 120, 60e3)) return ctx.json({ error: 'rate' }, 429);
    const doctor = Number(ctx.query.doctor), date = ctx.query.date;
    const doc = doctor && get(ctx.db, 'SELECT id FROM doctors WHERE id=? AND active=1 AND published=1', doctor);
    if (!doc || !clock.isDate(date)) return ctx.json({ times: [], hasSchedule: false });
    ctx.json({ times: slots.slotsFor(ctx.db, doc.id, date), hasSchedule: slots.hasSchedule(ctx.db, doc.id) });
  });

  // ---- SMS delivery-status callback (gateway -> us) ----
  router.post('/api/sms/webhook', (ctx) => {
    if (!notifications.webhookAuthorized(ctx.req.headers['x-webhook-secret'], config.sms.webhookSecret)) return ctx.json({ error: 'unauthorized' }, 401);
    const b = ctx.body || {};
    const ok = notifications.handleDeliveryCallback(ctx.db, { messageId: b.message_id || b.messageId || b.id, status: b.status === 'delivered' ? 'delivered' : b.status === 'failed' ? 'failed' : null, error: b.error });
    ctx.json({ ok });
  }, { csrf: false });

  // ---- Email delivery-status callback (gateway -> us) ----
  router.post('/api/email/webhook', (ctx) => {
    if (!notifications.webhookAuthorized(ctx.req.headers['x-webhook-secret'], config.email.webhookSecret)) return ctx.json({ error: 'unauthorized' }, 401);
    const b = ctx.body || {};
    const ok = notifications.handleDeliveryCallback(ctx.db, { messageId: b.message_id || b.messageId || b.id, status: b.status === 'delivered' ? 'delivered' : b.status === 'failed' ? 'failed' : null, error: b.error });
    ctx.json({ ok });
  }, { csrf: false });

  // ---- SEO / ops ----
  router.get('/robots.txt', (ctx) => ctx.send(200, `User-agent: *\nDisallow: /admin\nDisallow: /api/\nAllow: /\nSitemap: ${config.baseUrl}/sitemap.xml\n`, 'text/plain; charset=utf-8'));
  router.get('/sitemap.xml', (ctx) => {
    const paths = ['', 'about', 'departments', 'doctors', 'diagnostics', 'appointment', 'contact', 'privacy', 'terms', ...all(ctx.db, 'SELECT slug FROM departments WHERE active=1 ORDER BY sort').map((d) => `departments/${d.slug}`)];
    const urls = paths.flatMap((p) => ['en', 'hi'].map((l) => `<url><loc>${config.baseUrl}/${l}/${p}</loc><xhtml:link rel="alternate" hreflang="en" href="${config.baseUrl}/en/${p}"/><xhtml:link rel="alternate" hreflang="hi" href="${config.baseUrl}/hi/${p}"/></url>`));
    ctx.send(200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join('')}</urlset>`, 'application/xml; charset=utf-8');
  });
  router.get('/health', (ctx) => { get(ctx.db, 'SELECT 1'); ctx.json({ status: 'healthy', ok: true }); });
  router.get('/healthz', (ctx) => { get(ctx.db, 'SELECT 1'); ctx.json({ status: 'healthy', ok: true }); });
};
