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
    ctx.html(views.successPage(ctx, f.split('|')));
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
  router.get('/healthz', (ctx) => { get(ctx.db, 'SELECT 1'); ctx.json({ ok: true }); });
};
