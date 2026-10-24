'use strict';
const { all, get, run, tx } = require('../lib/db');
const sec = require('../lib/security');
const V = require('../lib/validation');
const clock = require('../lib/clock');
const U = require('./ui');
const { html, raw } = U;
const A = require('./admin-ui');
const { audit, setSetting, getSettings } = require('../services/settings');
const notifications = require('../services/notifications');
const { getProvider } = require('../services/sms-providers');
const { getProvider: getEmailProvider } = require('../services/email-providers');

const SV = ['available', 'appointment_required', 'to_be_confirmed', 'temporarily_unavailable', 'not_offered'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const t = (s) => (s === undefined || s === null || String(s).trim() === '' ? null : String(s).trim());
const flag = (b, k) => (b[k] === '1' || b[k] === 'on' ? 1 : 0);
const okUrl = (u) => !u || /^(https:\/\/|\/static\/)/.test(u);
const int = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : Number.isInteger(Number(v)) ? Number(v) : NaN);

module.exports = function register(router, { G, notFoundAdmin }) {
  const L = (ctx, title, active, main, status) => ctx.html(A.adminLayout(ctx, { title, active, main }), status);
  const txtField = (name, label, value, o = {}) => U.field({ t: (k) => (k === 'required_mark' ? 'required' : k) }, { name, label, value, type: o.type || 'text', required: o.required, help: o.help, attrs: o.attrs || {} });
  const area = (name, label, value, rows = 3) => html`<div class="field"><label for="f-${name}">${label}</label><textarea id="f-${name}" name="${name}" rows="${rows}">${value ?? ''}</textarea></div>`;
  const sel = (name, label, options, value) => html`<div class="field"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${A.opts(options, value)}</select></div>`;
  const svOptions = (ctx) => SV.map((s) => [s, ctx.t('sv_' + s)]);
  const back = (ctx, url, ok = 'saved') => ctx.redirect(`${url}${url.includes('?') ? '&' : '?'}ok=${ok}`);
  const failTo = (ctx, url, msg) => ctx.redirect(`${url}${url.includes('?') ? '&' : '?'}err=x&m=${encodeURIComponent(msg)}`);

  // ================= DOCTORS =================
  const doctorForm = (ctx, d = {}, deptIds = [], errors = []) => {
    const depts = all(ctx.db, 'SELECT id,name_en FROM departments ORDER BY sort');
    return html`${A.errorsBox(errors)}<form class="form" method="post" action="${d.id ? `/admin/doctors/${d.id}` : '/admin/doctors'}">${U.csrf(ctx)}
      <div class="row">${txtField('name_en', 'Full name (English)', d.name_en, { required: true })}${txtField('name_hi', 'पूरा नाम (Hindi)', d.name_hi)}</div>
      <div class="row">${txtField('qualifications_en', 'Qualifications (English)', d.qualifications_en)}${txtField('qualifications_hi', 'योग्यता (Hindi)', d.qualifications_hi)}</div>
      <div class="row">${txtField('specialization_en', 'Specialization (English)', d.specialization_en)}${txtField('specialization_hi', 'विशेषज्ञता (Hindi)', d.specialization_hi)}</div>
      <div class="row">${txtField('registration_no', 'Medical registration number', d.registration_no)}${txtField('experience_years', 'Verified experience (years)', d.experience_years, { type: 'number', attrs: { min: 0, max: 70 } })}</div>
      <div class="row">${txtField('languages', 'Languages spoken', d.languages)}${txtField('photo_url', 'Photograph URL (https:// or /static/…)', d.photo_url)}</div>
      <div class="row">${txtField('consultation_fee', 'Consultation fee (₹)', d.consultation_fee, { type: 'number', attrs: { min: 0, max: 100000 } })}${txtField('slot_minutes', 'Appointment duration (minutes)', d.slot_minutes ?? 15, { type: 'number', required: true, attrs: { min: 5, max: 120 } })}</div>
      <div class="row">${area('bio_en', 'Short bio (English)', d.bio_en, 2)}${area('bio_hi', 'संक्षिप्त परिचय (Hindi)', d.bio_hi, 2)}</div>
      <fieldset class="field"><legend>Departments</legend>${depts.map((x) => html`<label class="check"><input type="checkbox" name="dept" value="${x.id}" ${deptIds.includes(x.id) ? raw('checked') : ''}> ${x.name_en}</label>`)}</fieldset>
      ${A.yesNo('show_registration', 'Show registration number publicly', d.show_registration)}${A.yesNo('fee_approved', 'Consultation fee approved for public display', d.fee_approved)}
      ${A.yesNo('verified', 'Credentials verified by the hospital (required to publish)', d.verified)}${A.yesNo('published', 'Published on the public website', d.published)}
      ${A.yesNo('active', 'Active (can receive appointments)', d.id ? d.active : 1)}${A.yesNo('translation_reviewed', 'Hindi translation reviewed', d.translation_reviewed)}
      <button class="btn btn-primary" type="submit">Save doctor</button></form>`;
  };
  function readDoctor(b) {
    const errors = [], v = {};
    for (const k of ['name_en', 'name_hi', 'qualifications_en', 'qualifications_hi', 'specialization_en', 'specialization_hi', 'registration_no', 'languages', 'photo_url', 'bio_en', 'bio_hi']) v[k] = t(V.str(b[k], 600));
    if (!v.name_en || v.name_en.length < 2) errors.push('English name is required.');
    if (!okUrl(v.photo_url)) errors.push('Photograph URL must start with https:// or /static/.');
    v.experience_years = int(b.experience_years); v.consultation_fee = int(b.consultation_fee); v.slot_minutes = int(b.slot_minutes);
    if (Number.isNaN(v.experience_years) || (v.experience_years != null && (v.experience_years < 0 || v.experience_years > 70))) errors.push('Experience must be 0–70 years.');
    if (Number.isNaN(v.consultation_fee) || (v.consultation_fee != null && (v.consultation_fee < 0 || v.consultation_fee > 100000))) errors.push('Fee must be a whole number of rupees.');
    if (!Number.isInteger(v.slot_minutes) || v.slot_minutes < 5 || v.slot_minutes > 120) errors.push('Appointment duration must be 5–120 minutes.');
    for (const k of ['show_registration', 'fee_approved', 'verified', 'published', 'active', 'translation_reviewed']) v[k] = flag(b, k);
    const depts = [].concat(b.dept || []).map(Number).filter(Boolean);
    if (v.published && !v.verified) errors.push('A doctor can be published only after credentials are marked verified.');
    if (v.published && !depts.length) errors.push('Assign at least one department before publishing.');
    return { v, errors, depts };
  }
  const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'doctor';

  router.get('/admin/doctors', G('doctors.view', (ctx) => {
    const rows = all(ctx.db, `SELECT d.*, (SELECT group_concat(dep.name_en,', ') FROM doctor_departments dd JOIN departments dep ON dep.id=dd.department_id WHERE dd.doctor_id=d.id) AS depts,
      (SELECT COUNT(*) FROM doctor_schedules WHERE doctor_id=d.id AND active=1) AS sched FROM doctors d ORDER BY d.name_en`);
    L(ctx, 'Doctors', '/admin/doctors', html`${A.can(ctx.user, 'doctors.manage') ? html`<p><a class="btn btn-primary" href="/admin/doctors/new">Add doctor</a></p>` : ''}
      <p class="help">No doctor profile is shown publicly until it is verified and published. Without doctors, patients can still send requests and staff assign a doctor later.</p>
      ${A.table(['Name', 'Departments', 'Status', 'Schedule rows', 'Hindi', ''], rows.map((d) => [d.name_en, d.depts || '—', `${d.published ? 'Published' : 'Not published'}${d.verified ? ', verified' : ', unverified'}${d.active ? '' : ', inactive'}`, d.sched, d.name_hi && d.translation_reviewed ? 'Reviewed' : 'Needs review',
        A.can(ctx.user, 'doctors.manage') ? html`<a href="/admin/doctors/${d.id}">Edit</a>` : '']), 'No doctors yet. The public site shows "Doctor profiles will be updated soon".')}`);
  }));
  router.get('/admin/doctors/new', G('doctors.manage', (ctx) => L(ctx, 'Add doctor', '/admin/doctors', doctorForm(ctx))));
  router.post('/admin/doctors', G('doctors.manage', (ctx) => {
    const { v, errors, depts } = readDoctor(ctx.body);
    if (errors.length) return L(ctx, 'Add doctor', '/admin/doctors', doctorForm(ctx, { ...ctx.body, ...v }, depts, errors), 422);
    const id = tx(ctx.db, () => {
      let slug = slugify(v.name_en);
      if (get(ctx.db, 'SELECT 1 FROM doctors WHERE slug=?', slug)) slug += '-' + sec.token(3).toLowerCase().replace(/[^a-z0-9]/g, 'x');
      const r = run(ctx.db, `INSERT INTO doctors(slug,name_en,name_hi,photo_url,qualifications_en,qualifications_hi,specialization_en,specialization_hi,registration_no,show_registration,experience_years,languages,bio_en,bio_hi,consultation_fee,fee_approved,slot_minutes,verified,published,active,translation_reviewed)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, slug, v.name_en, v.name_hi, v.photo_url, v.qualifications_en, v.qualifications_hi, v.specialization_en, v.specialization_hi, v.registration_no, v.show_registration, v.experience_years, v.languages, v.bio_en, v.bio_hi, v.consultation_fee, v.fee_approved, v.slot_minutes, v.verified, v.published, v.active, v.translation_reviewed);
      const did = Number(r.lastInsertRowid);
      depts.forEach((d) => run(ctx.db, 'INSERT OR IGNORE INTO doctor_departments(doctor_id,department_id) VALUES (?,?)', did, d));
      return did;
    });
    audit(ctx.db, ctx.user, 'doctor.create', 'doctor', id, v.name_en, ctx.ip);
    ctx.redirect(`/admin/doctors/${id}?ok=created`);
  }));
  const schedulePanel = (ctx, d) => {
    const sch = all(ctx.db, 'SELECT * FROM doctor_schedules WHERE doctor_id=? ORDER BY weekday,start_time', d.id);
    const lv = all(ctx.db, 'SELECT * FROM doctor_unavailability WHERE doctor_id=? ORDER BY start_date', d.id);
    return html`<h2>Weekly consultation schedule</h2>
      <p class="help">Patients can pick real time slots only for doctors with a schedule. Slots are generated using the appointment duration above. Holidays and leave are excluded.</p>
      ${A.table(['Day', 'From', 'To', ''], sch.map((s) => [DAYS[s.weekday], s.start_time, s.end_time, html`<form method="post" action="/admin/doctors/${d.id}/schedule/${s.id}/delete" class="inline">${U.csrf(ctx)}<button class="btn btn-call btn-sm" type="submit">Remove</button></form>`]), 'No schedule yet.')}
      <form class="form" method="post" action="/admin/doctors/${d.id}/schedule" style="margin-top:12px">${U.csrf(ctx)}<div class="row">${sel('weekday', 'Day', DAYS.map((x, i) => [i, x]), 1)}<div></div></div>
        <div class="row">${txtField('start_time', 'From (HH:MM)', '', { type: 'time', required: true })}${txtField('end_time', 'To (HH:MM)', '', { type: 'time', required: true })}</div><button class="btn btn-primary btn-sm" type="submit">Add schedule</button></form>
      <h2>Leave / unavailability</h2>${A.table(['From', 'To', 'Reason', ''], lv.map((l) => [l.start_date, l.end_date, l.reason, html`<form method="post" action="/admin/doctors/${d.id}/leave/${l.id}/delete" class="inline">${U.csrf(ctx)}<button class="btn btn-call btn-sm" type="submit">Remove</button></form>`]), 'No leave recorded.')}
      <form class="form" method="post" action="/admin/doctors/${d.id}/leave" style="margin-top:12px">${U.csrf(ctx)}<div class="row">${txtField('start_date', 'From date', '', { type: 'date', required: true })}${txtField('end_date', 'To date', '', { type: 'date', required: true })}</div>
        ${txtField('reason', 'Reason (internal)', '')}<button class="btn btn-primary btn-sm" type="submit">Add leave</button></form>`;
  };
  const loadDoc = (ctx) => get(ctx.db, 'SELECT * FROM doctors WHERE id=?', Number(ctx.params.id));
  router.get('/admin/doctors/:id', G('doctors.manage', (ctx) => {
    const d = loadDoc(ctx); if (!d) return notFoundAdmin(ctx);
    const ids = all(ctx.db, 'SELECT department_id FROM doctor_departments WHERE doctor_id=?', d.id).map((r) => r.department_id);
    L(ctx, `Doctor: ${d.name_en}`, '/admin/doctors', html`${doctorForm(ctx, d, ids)}${schedulePanel(ctx, d)}`);
  }));
  router.post('/admin/doctors/:id', G('doctors.manage', (ctx) => {
    const d = loadDoc(ctx); if (!d) return notFoundAdmin(ctx);
    const { v, errors, depts } = readDoctor(ctx.body);
    if (errors.length) return L(ctx, `Doctor: ${d.name_en}`, '/admin/doctors', html`${doctorForm(ctx, { ...d, ...ctx.body, ...v, id: d.id }, depts, errors)}${schedulePanel(ctx, d)}`, 422);
    tx(ctx.db, () => {
      run(ctx.db, `UPDATE doctors SET name_en=?,name_hi=?,photo_url=?,qualifications_en=?,qualifications_hi=?,specialization_en=?,specialization_hi=?,registration_no=?,show_registration=?,experience_years=?,languages=?,bio_en=?,bio_hi=?,consultation_fee=?,fee_approved=?,slot_minutes=?,verified=?,published=?,active=?,translation_reviewed=? WHERE id=?`,
        v.name_en, v.name_hi, v.photo_url, v.qualifications_en, v.qualifications_hi, v.specialization_en, v.specialization_hi, v.registration_no, v.show_registration, v.experience_years, v.languages, v.bio_en, v.bio_hi, v.consultation_fee, v.fee_approved, v.slot_minutes, v.verified, v.published, v.active, v.translation_reviewed, d.id);
      run(ctx.db, 'DELETE FROM doctor_departments WHERE doctor_id=?', d.id);
      depts.forEach((x) => run(ctx.db, 'INSERT OR IGNORE INTO doctor_departments(doctor_id,department_id) VALUES (?,?)', d.id, x));
    });
    audit(ctx.db, ctx.user, 'doctor.update', 'doctor', d.id, `published=${v.published} verified=${v.verified} active=${v.active}`, ctx.ip);
    back(ctx, `/admin/doctors/${d.id}`);
  }));
  router.post('/admin/doctors/:id/schedule', G('doctors.manage', (ctx) => {
    const d = loadDoc(ctx); if (!d) return notFoundAdmin(ctx);
    const wd = Number(ctx.body.weekday), a = ctx.body.start_time, b = ctx.body.end_time;
    if (!(wd >= 0 && wd <= 6) || !clock.isTime(a) || !clock.isTime(b) || a >= b) return failTo(ctx, `/admin/doctors/${d.id}`, 'Enter a valid day and a start time earlier than the end time.');
    if (get(ctx.db, 'SELECT 1 FROM doctor_schedules WHERE doctor_id=? AND weekday=? AND active=1 AND start_time<? AND end_time>?', d.id, wd, b, a)) return failTo(ctx, `/admin/doctors/${d.id}`, 'That time overlaps an existing schedule row.');
    run(ctx.db, 'INSERT INTO doctor_schedules(doctor_id,weekday,start_time,end_time) VALUES (?,?,?,?)', d.id, wd, a, b);
    audit(ctx.db, ctx.user, 'doctor.schedule.add', 'doctor', d.id, `${DAYS[wd]} ${a}-${b}`, ctx.ip);
    back(ctx, `/admin/doctors/${d.id}`);
  }));
  router.post('/admin/doctors/:id/schedule/:sid/delete', G('doctors.manage', (ctx) => {
    run(ctx.db, 'DELETE FROM doctor_schedules WHERE id=? AND doctor_id=?', Number(ctx.params.sid), Number(ctx.params.id));
    audit(ctx.db, ctx.user, 'doctor.schedule.remove', 'doctor', ctx.params.id, `row ${ctx.params.sid}`, ctx.ip);
    back(ctx, `/admin/doctors/${Number(ctx.params.id)}`, 'deleted');
  }));
  router.post('/admin/doctors/:id/leave', G('doctors.manage', (ctx) => {
    const d = loadDoc(ctx); if (!d) return notFoundAdmin(ctx);
    const a = ctx.body.start_date, b = ctx.body.end_date;
    if (!clock.isDate(a) || !clock.isDate(b) || a > b) return failTo(ctx, `/admin/doctors/${d.id}`, 'Enter valid dates (start on or before end).');
    run(ctx.db, 'INSERT INTO doctor_unavailability(doctor_id,start_date,end_date,reason) VALUES (?,?,?,?)', d.id, a, b, t(V.str(ctx.body.reason, 200)));
    audit(ctx.db, ctx.user, 'doctor.leave.add', 'doctor', d.id, `${a}..${b}`, ctx.ip);
    back(ctx, `/admin/doctors/${d.id}`);
  }));
  router.post('/admin/doctors/:id/leave/:lid/delete', G('doctors.manage', (ctx) => {
    run(ctx.db, 'DELETE FROM doctor_unavailability WHERE id=? AND doctor_id=?', Number(ctx.params.lid), Number(ctx.params.id));
    back(ctx, `/admin/doctors/${Number(ctx.params.id)}`, 'deleted');
  }));

  // ================= DEPARTMENTS & SERVICES =================
  router.get('/admin/services', G('services.manage', (ctx) => {
    const depts = all(ctx.db, 'SELECT * FROM departments ORDER BY sort');
    L(ctx, 'Departments & services', '/admin/services', html`<p class="help">Set each department and service to its true status. Nothing is shown as "Available" unless you set it.</p>
      ${depts.map((d) => html`<h2><a href="/admin/departments/${d.id}">${d.name_en}</a> ${U.badge(ctx, d.status)} ${d.active ? '' : '(hidden)'}</h2>
        ${A.table(['Service', 'Status', 'Diagnostic form', ''], all(ctx.db, 'SELECT * FROM services WHERE department_id=? ORDER BY sort', d.id).map((s) => [s.name_en + (s.active ? '' : ' (inactive)'), U.badge(ctx, s.status), s.is_diagnostic ? 'Yes' : 'No', html`<a href="/admin/services/${s.id}">Edit</a>`]))}`)}`);
  }));
  router.get('/admin/departments/:id', G('services.manage', (ctx) => {
    const d = get(ctx.db, 'SELECT * FROM departments WHERE id=?', Number(ctx.params.id)); if (!d) return notFoundAdmin(ctx);
    L(ctx, `Department: ${d.name_en}`, '/admin/services', html`<form class="form" method="post" action="/admin/departments/${d.id}">${U.csrf(ctx)}
      <div class="row">${txtField('name_en', 'Name (English)', d.name_en, { required: true })}${txtField('name_hi', 'नाम (Hindi)', d.name_hi, { required: true })}</div>
      <div class="row">${area('desc_en', 'Description (English)', d.desc_en, 4)}${area('desc_hi', 'विवरण (Hindi)', d.desc_hi, 4)}</div>
      <div class="row">${area('note_en', 'Public notice (English, optional)', d.note_en, 2)}${area('note_hi', 'सूचना (Hindi, optional)', d.note_hi, 2)}</div>
      ${sel('status', 'Availability status', svOptions(ctx), d.status)}
      <div class="row">${txtField('hours_en', 'Department hours (English) — leave empty until confirmed', d.hours_en)}${txtField('hours_hi', 'विभाग का समय (Hindi)', d.hours_hi)}</div>
      ${A.yesNo('active', 'Visible on the website', d.active)}${A.yesNo('translation_reviewed', 'Hindi translation reviewed', d.translation_reviewed)}
      <button class="btn btn-primary" type="submit">Save department</button></form>
      <h2>Add a service</h2><form class="form" method="post" action="/admin/departments/${d.id}/services">${U.csrf(ctx)}<div class="row">${txtField('name_en', 'Service name (English)', '', { required: true })}${txtField('name_hi', 'सेवा का नाम (Hindi)', '', { required: true })}</div>
        ${A.yesNo('is_diagnostic', 'Show in the diagnostic request form', d.form_type === 'diagnostic')}<button class="btn btn-primary btn-sm" type="submit">Add service (starts as "Availability to be confirmed")</button></form>`);
  }));
  router.post('/admin/departments/:id', G('services.manage', (ctx) => {
    const d = get(ctx.db, 'SELECT * FROM departments WHERE id=?', Number(ctx.params.id)); if (!d) return notFoundAdmin(ctx);
    const b = ctx.body;
    if (!t(b.name_en) || !t(b.name_hi) || !t(b.desc_en) || !t(b.desc_hi) || !SV.includes(b.status)) return failTo(ctx, `/admin/departments/${d.id}`, 'Names, descriptions and a valid status are required.');
    run(ctx.db, 'UPDATE departments SET name_en=?,name_hi=?,desc_en=?,desc_hi=?,note_en=?,note_hi=?,status=?,hours_en=?,hours_hi=?,active=?,translation_reviewed=? WHERE id=?',
      V.str(b.name_en, 120), V.str(b.name_hi, 120), V.str(b.desc_en, 1500), V.str(b.desc_hi, 1500), t(V.str(b.note_en, 500)), t(V.str(b.note_hi, 500)), b.status, t(V.str(b.hours_en, 200)), t(V.str(b.hours_hi, 200)), flag(b, 'active'), flag(b, 'translation_reviewed'), d.id);
    audit(ctx.db, ctx.user, 'department.update', 'department', d.id, `status=${b.status}`, ctx.ip);
    back(ctx, `/admin/departments/${d.id}`);
  }));
  router.post('/admin/departments/:id/services', G('services.manage', (ctx) => {
    const d = get(ctx.db, 'SELECT * FROM departments WHERE id=?', Number(ctx.params.id)); if (!d) return notFoundAdmin(ctx);
    if (!t(ctx.body.name_en) || !t(ctx.body.name_hi)) return failTo(ctx, `/admin/departments/${d.id}`, 'Both English and Hindi names are required.');
    const r = run(ctx.db, "INSERT INTO services(department_id,name_en,name_hi,status,is_diagnostic,sort) VALUES (?,?,?,'to_be_confirmed',?,(SELECT COALESCE(MAX(sort),0)+1 FROM services WHERE department_id=?))", d.id, V.str(ctx.body.name_en, 120), V.str(ctx.body.name_hi, 120), flag(ctx.body, 'is_diagnostic'), d.id);
    audit(ctx.db, ctx.user, 'service.create', 'service', r.lastInsertRowid, V.str(ctx.body.name_en, 80), ctx.ip);
    ctx.redirect(`/admin/services/${r.lastInsertRowid}?ok=created`);
  }));
  router.get('/admin/services/:id', G('services.manage', (ctx) => {
    const s = get(ctx.db, 'SELECT * FROM services WHERE id=?', Number(ctx.params.id)); if (!s) return notFoundAdmin(ctx);
    L(ctx, `Service: ${s.name_en}`, '/admin/services', html`<form class="form" method="post" action="/admin/services/${s.id}">${U.csrf(ctx)}
      <div class="row">${txtField('name_en', 'Name (English)', s.name_en, { required: true })}${txtField('name_hi', 'नाम (Hindi)', s.name_hi, { required: true })}</div>
      <div class="row">${area('desc_en', 'Description (English)', s.desc_en, 2)}${area('desc_hi', 'विवरण (Hindi)', s.desc_hi, 2)}</div>
      ${sel('status', 'Availability status', svOptions(ctx), s.status)}
      <div class="row">${txtField('hours_en', 'Service hours (English) — empty until confirmed', s.hours_en)}${txtField('hours_hi', 'सेवा का समय (Hindi)', s.hours_hi)}</div>
      <div class="row">${txtField('closure_note_en', 'Temporary closure notice (English)', s.closure_note_en)}${txtField('closure_note_hi', 'अस्थायी बंदी सूचना (Hindi)', s.closure_note_hi)}</div>
      <div class="row">${area('prep_en', 'Clinically approved preparation instructions (English)', s.prep_en, 3)}${area('prep_hi', 'अनुमोदित तैयारी निर्देश (Hindi)', s.prep_hi, 3)}</div>
      ${A.yesNo('prep_approved', 'Preparation instructions approved by clinical staff (shown publicly only when ticked)', s.prep_approved)}
      ${A.yesNo('is_diagnostic', 'Show in the diagnostic request form', s.is_diagnostic)}${A.yesNo('active', 'Active (visible on the website)', s.active)}${A.yesNo('translation_reviewed', 'Hindi translation reviewed', s.translation_reviewed)}
      <button class="btn btn-primary" type="submit">Save service</button></form>`);
  }));
  router.post('/admin/services/:id', G('services.manage', (ctx) => {
    const s = get(ctx.db, 'SELECT * FROM services WHERE id=?', Number(ctx.params.id)); if (!s) return notFoundAdmin(ctx);
    const b = ctx.body;
    if (!t(b.name_en) || !t(b.name_hi) || !SV.includes(b.status)) return failTo(ctx, `/admin/services/${s.id}`, 'Names and a valid status are required.');
    run(ctx.db, 'UPDATE services SET name_en=?,name_hi=?,desc_en=?,desc_hi=?,status=?,hours_en=?,hours_hi=?,closure_note_en=?,closure_note_hi=?,prep_en=?,prep_hi=?,prep_approved=?,is_diagnostic=?,active=?,translation_reviewed=? WHERE id=?',
      V.str(b.name_en, 120), V.str(b.name_hi, 120), t(V.str(b.desc_en, 600)), t(V.str(b.desc_hi, 600)), b.status, t(V.str(b.hours_en, 200)), t(V.str(b.hours_hi, 200)), t(V.str(b.closure_note_en, 300)), t(V.str(b.closure_note_hi, 300)), t(V.str(b.prep_en, 1500)), t(V.str(b.prep_hi, 1500)), flag(b, 'prep_approved'), flag(b, 'is_diagnostic'), flag(b, 'active'), flag(b, 'translation_reviewed'), s.id);
    audit(ctx.db, ctx.user, 'service.update', 'service', s.id, `status=${b.status} active=${flag(b, 'active')}`, ctx.ip);
    back(ctx, `/admin/services/${s.id}`);
  }));

  // ================= HOSPITAL SETTINGS =================
  router.get('/admin/settings', G('settings.manage', (ctx) => {
    const s = getSettings(ctx.db);
    L(ctx, 'Hospital settings', '/admin/settings', html`<form class="form" method="post" action="/admin/settings">${U.csrf(ctx)}
      <h2>Contact details</h2>
      <div class="row">${txtField('phone1', 'Telephone', s.phone1, { required: true })}${txtField('phone2', 'Additional telephone', s.phone2, { required: true })}</div>
      <div class="row">${txtField('address_en', 'Address (English)', s.address_en, { required: true })}${txtField('address_hi', 'पता (Hindi)', s.address_hi, { required: true })}</div>
      <div class="row">${txtField('hospital_name_en', 'Hospital name (English)', s.hospital_name_en)}${txtField('hospital_name_hi', 'अस्पताल का नाम (Hindi)', s.hospital_name_hi)}</div>
      <div class="row">${txtField('tagline_en', 'Tagline (English)', s.tagline_en)}${txtField('tagline_hi', 'टैगलाइन (Hindi)', s.tagline_hi)}</div>
      <div class="row">${txtField('trust_name_en', 'Trust name (English)', s.trust_name_en)}${txtField('trust_name_hi', 'ट्रस्ट का नाम (Hindi)', s.trust_name_hi)}</div>
      ${txtField('email', 'Public email (optional)', s.email, { type: 'email' })}
      <h2>Opening hours</h2><p class="help">Hours stay hidden ("Hours to be confirmed") until you tick the confirmation box AND enter the text. Do not guess.</p>
      <div class="row">${txtField('hours_en', 'Opening hours (English)', s.hours_en)}${txtField('hours_hi', 'खुलने का समय (Hindi)', s.hours_hi)}</div>
      ${A.yesNo('hours_confirmed', 'Hospital management has confirmed these hours', s.hours_confirmed === '1')}
      <h2>Emergency service status</h2><p class="help">Leave as "Unconfirmed" unless management confirms. The site never claims 24/7 emergency care by default.</p>
      ${sel('emergency_status', 'Emergency status', [['unconfirmed', 'Unconfirmed (nothing claimed)'], ['available', 'Available (show note below)'], ['unavailable', 'Not available (show note below)']], s.emergency_status)}
      <div class="row">${txtField('emergency_note_en', 'Emergency note (English)', s.emergency_note_en)}${txtField('emergency_note_hi', 'आपातकालीन सूचना (Hindi)', s.emergency_note_hi)}</div>
      <h2>Map & images</h2>
      ${txtField('map_url', 'Google Maps link (https://…)', s.map_url)}${A.yesNo('map_verified', 'Map location verified (directions link is shown only when ticked)', s.map_verified === '1')}
      ${txtField('hero_image_url', 'Homepage photograph URL (https:// or /static/…; use a real, licensed hospital photo)', s.hero_image_url)}
      <h2>Social media</h2><p class="help">Official social media accounts for SACHKHAND HOSPITAL (displayed in header and footer).</p>
      <div class="row">${txtField('facebook_url', 'Facebook profile URL (https://…)', s.facebook_url || '')}${txtField('instagram_url', 'Instagram profile URL (https://…)', s.instagram_url || '')}</div>
      <h2>SMS</h2>${A.yesNo('sms_reminders_enabled', 'Send appointment reminders the day before (only to patients who consented; needs a configured SMS provider)', s.sms_reminders_enabled === '1')}
      <button class="btn btn-primary" type="submit">Save settings</button></form>`);
  }));
  router.post('/admin/settings', G('settings.manage', (ctx) => {
    const b = ctx.body, errs = [];
    const phone = (x) => /^[0-9][0-9\- ]{7,15}$/.test(String(x || '').trim());
    if (!phone(b.phone1) || !phone(b.phone2)) errs.push('Enter valid telephone numbers.');
    if (!t(b.address_en) || !t(b.address_hi)) errs.push('Address is required in both languages.');
    if (flag(b, 'hours_confirmed') && !(t(b.hours_en) && t(b.hours_hi))) errs.push('Enter opening hours in both languages before confirming them.');
    if (t(b.map_url) && !/^https:\/\//.test(b.map_url)) errs.push('Map link must start with https://');
    if (flag(b, 'map_verified') && !t(b.map_url)) errs.push('Enter the map link before marking it verified.');
    if (!okUrl(t(b.hero_image_url))) errs.push('Photograph URL must start with https:// or /static/.');
    if (t(b.facebook_url) && !/^https?:\/\//i.test(b.facebook_url)) errs.push('Facebook link must start with https:// or http://');
    if (t(b.instagram_url) && !/^https?:\/\//i.test(b.instagram_url)) errs.push('Instagram link must start with https:// or http://');
    if (['available', 'unavailable'].includes(b.emergency_status) && !(t(b.emergency_note_en) && t(b.emergency_note_hi))) errs.push('Provide the emergency note in both languages.');
    if (t(b.email) && !V.EMAIL.test(b.email)) errs.push('Email looks invalid.');
    if (errs.length) return failTo(ctx, '/admin/settings', errs.join(' '));
    tx(ctx.db, () => {
      for (const k of ['phone1', 'phone2', 'address_en', 'address_hi', 'hospital_name_en', 'hospital_name_hi', 'tagline_en', 'tagline_hi', 'trust_name_en', 'trust_name_hi', 'email', 'hours_en', 'hours_hi', 'emergency_note_en', 'emergency_note_hi', 'map_url', 'hero_image_url', 'facebook_url', 'instagram_url'])
        if (b[k] !== undefined) setSetting(ctx.db, k, V.str(b[k], 300).trim());
      setSetting(ctx.db, 'emergency_status', ['available', 'unavailable'].includes(b.emergency_status) ? b.emergency_status : 'unconfirmed');
      for (const k of ['hours_confirmed', 'map_verified', 'sms_reminders_enabled']) setSetting(ctx.db, k, flag(b, k) ? '1' : '0');
    });
    audit(ctx.db, ctx.user, 'settings.update', 'settings', null, `hours_confirmed=${flag(b, 'hours_confirmed')} map_verified=${flag(b, 'map_verified')} emergency=${b.emergency_status}`, ctx.ip);
    back(ctx, '/admin/settings');
  }));

  // ================= GENERIC CRUD (content, faqs, announcements, holidays) =================
  function crud(path, table, title, cols, { idCol = 'id', order = 'id', create = true, del = true, perm = 'content.manage', intro = '' } = {}) {
    const input = (c, row, rid) => {
      const val = row ? row[c.name] : c.default ?? '';
      const id = `${c.name}-${rid}`;
      if (c.type === 'checkbox') return html`<div class="field"><label class="check"><input type="checkbox" name="${c.name}" value="1" ${val ? raw('checked') : ''}> <span>${c.label}</span></label></div>`;
      if (c.type === 'textarea') return html`<div class="field"><label for="${id}">${c.label}</label><textarea id="${id}" name="${c.name}" rows="${c.rows || 3}">${val}</textarea></div>`;
      return html`<div class="field"><label for="${id}">${c.label}</label><input id="${id}" name="${c.name}" type="${c.type || 'text'}" value="${val}"></div>`;
    };
    const read = (b) => {
      const v = {}, errs = [];
      for (const c of cols) {
        if (c.type === 'checkbox') v[c.name] = flag(b, c.name);
        else if (c.type === 'number') v[c.name] = Number.isInteger(Number(b[c.name])) ? Number(b[c.name]) : 0;
        else { v[c.name] = V.str(b[c.name], c.max || (c.type === 'textarea' ? 4000 : 300)).trim(); if (c.required && !v[c.name]) errs.push(`${c.label} is required.`); if (c.type === 'date' && !clock.isDate(v[c.name])) errs.push(`${c.label} must be a valid date.`); }
      }
      return { v, errs };
    };
    router.get(path, G(perm, (ctx) => {
      const rows = all(ctx.db, `SELECT * FROM ${table} ORDER BY ${order}`);
      L(ctx, title, path, html`${intro ? html`<p class="help">${intro}</p>` : ''}
        ${create ? html`<details><summary><strong>Add new</strong></summary><form class="form" method="post" action="${path}">${U.csrf(ctx)}${cols.map((c) => input(c, null, 'new'))}<button class="btn btn-primary btn-sm" type="submit">Add</button></form></details>` : ''}
        ${rows.map((r) => html`<form class="form" method="post" action="${path}/${encodeURIComponent(r[idCol])}" style="margin:14px 0">${U.csrf(ctx)}${idCol === 'key' ? html`<p><strong>${r.label}</strong></p>` : ''}${cols.map((c) => input(c, r, r[idCol]))}
          <div class="actions-row"><button class="btn btn-primary btn-sm" type="submit">Save</button>${del ? html`<button class="btn btn-danger btn-sm" type="submit" formaction="${path}/${encodeURIComponent(r[idCol])}/delete">Delete</button>` : ''}</div></form>`)}`);
    }));
    if (create) router.post(path, G(perm, (ctx) => {
      const { v, errs } = read(ctx.body);
      if (errs.length) return failTo(ctx, path, errs.join(' '));
      const names = Object.keys(v);
      try { run(ctx.db, `INSERT INTO ${table}(${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`, ...names.map((n) => v[n])); } catch (e) { return failTo(ctx, path, 'Could not save (is it a duplicate?).'); }
      audit(ctx.db, ctx.user, `${table}.create`, table, null, null, ctx.ip);
      back(ctx, path, 'created');
    }));
    router.post(`${path}/:id`, G(perm, (ctx) => {
      const { v, errs } = read(ctx.body);
      if (errs.length) return failTo(ctx, path, errs.join(' '));
      const names = Object.keys(v);
      const extra = table === 'website_content' ? ", updated_at='" + clock.sqlNow() + "'" : '';
      run(ctx.db, `UPDATE ${table} SET ${names.map((n) => n + '=?').join(',')}${extra} WHERE ${idCol}=?`, ...names.map((n) => v[n]), ctx.params.id);
      audit(ctx.db, ctx.user, `${table}.update`, table, ctx.params.id, null, ctx.ip);
      back(ctx, path);
    }));
    if (del) router.post(`${path}/:id/delete`, G(perm, (ctx) => {
      run(ctx.db, `DELETE FROM ${table} WHERE ${idCol}=?`, ctx.params.id);
      audit(ctx.db, ctx.user, `${table}.delete`, table, ctx.params.id, null, ctx.ip);
      back(ctx, path, 'deleted');
    }));
  }
  crud('/admin/content', 'website_content', 'Page content (Hindi & English)', [
    { name: 'en', label: 'English', type: 'textarea', rows: 4, required: true }, { name: 'hi', label: 'हिन्दी (Hindi)', type: 'textarea', rows: 4, required: true },
    { name: 'published', label: 'Published', type: 'checkbox' }, { name: 'translation_reviewed', label: 'Hindi translation reviewed', type: 'checkbox' }],
    { idCol: 'key', order: 'key', create: false, del: false, intro: 'Unreviewed drafts (mission, vision, policies) should be approved by the hospital before launch. Separate paragraphs with a blank line. Do not add founding year, registrations, accreditation or awards until confirmed.' });
  crud('/admin/faqs', 'faqs', 'FAQs', [
    { name: 'q_en', label: 'Question (English)', required: true }, { name: 'q_hi', label: 'प्रश्न (Hindi)', required: true },
    { name: 'a_en', label: 'Answer (English)', type: 'textarea', required: true }, { name: 'a_hi', label: 'उत्तर (Hindi)', type: 'textarea', required: true },
    { name: 'sort', label: 'Order', type: 'number', default: 0 }, { name: 'published', label: 'Published', type: 'checkbox', default: 1 }], { order: 'sort,id' });
  crud('/admin/announcements', 'announcements', 'Announcements', [
    { name: 'title_en', label: 'Title (English)', required: true }, { name: 'title_hi', label: 'शीर्षक (Hindi)', required: true },
    { name: 'body_en', label: 'Text (English)', type: 'textarea' }, { name: 'body_hi', label: 'विवरण (Hindi)', type: 'textarea' }, { name: 'published', label: 'Published', type: 'checkbox' }], { order: 'created_at DESC' });
  crud('/admin/holidays', 'holidays', 'Holidays & closures', [
    { name: 'date', label: 'Date', type: 'date', required: true }, { name: 'name_en', label: 'Name (English)', required: true }, { name: 'name_hi', label: 'नाम (Hindi)', required: true }],
    { order: 'date', intro: 'Appointment requests cannot be made for these dates and doctors have no slots on them.' });

  // ================= INQUIRIES & NOTIFICATIONS =================
  router.get('/admin/inquiries', G('inquiries.manage', (ctx) => {
    const rows = all(ctx.db, 'SELECT i.*, d.name_en AS dept FROM inquiries i LEFT JOIN departments d ON d.id=i.department_id ORDER BY (i.status=\'new\') DESC, i.id DESC LIMIT 200');
    L(ctx, 'Inquiries', '/admin/inquiries', A.table(['Received (UTC)', 'Name', 'Mobile', 'Department', 'Message', 'Status', ''], rows.map((r) => [r.created_at, r.name, r.mobile, r.dept || '—', r.message, r.status,
      r.status === 'new' ? html`<form method="post" action="/admin/inquiries/${r.id}/handle" class="inline">${U.csrf(ctx)}<button class="btn btn-call btn-sm" type="submit">Mark handled</button></form>` : ''])));
  }));
  router.post('/admin/inquiries/:id/handle', G('inquiries.manage', (ctx) => { run(ctx.db, "UPDATE inquiries SET status='handled' WHERE id=?", Number(ctx.params.id)); audit(ctx.db, ctx.user, 'inquiry.handled', 'inquiry', ctx.params.id, null, ctx.ip); back(ctx, '/admin/inquiries', 'done'); }));

  router.get('/admin/notifications', G('notifications.manage', (ctx) => {
    const rows = all(ctx.db, 'SELECT n.*, a.ref FROM notifications n LEFT JOIN appointments a ON a.id=n.appointment_id ORDER BY n.id DESC LIMIT 200');
    const counts = all(ctx.db, 'SELECT status, COUNT(*) c FROM notifications GROUP BY status');
    const p = getProvider();
    const ep = getEmailProvider();
    L(ctx, 'Notifications log', '/admin/notifications', html`<p class="alert ${p ? 'alert-ok' : 'alert-info'}">${p ? `Provider "${p.name}" is configured.` : 'No SMS provider is configured. Events are recorded as "not_configured" and nothing is sent.'}
      "submitted" means the gateway accepted the message; only "delivered" (from the gateway callback) confirms delivery.</p>
      <p class="alert ${ep ? 'alert-ok' : 'alert-info'}">${ep ? `Email provider "${ep.name}" is configured.` : 'No email provider is configured. Email events are recorded as "not_configured" and nothing is sent.'}</p>
      <p>${counts.map((c) => `${c.status}: ${c.c}`).join(' · ') || 'No notification events yet.'}</p>
      ${A.table(['Created (UTC)', 'Booking', 'Event', 'Channel', 'To', 'Status', 'Attempts', 'Provider id', 'Error', ''], rows.map((n) => [n.created_at, n.ref, n.event, n.channel || 'sms', (n.channel === 'email' ? n.to_email : n.to_mobile) || '—', n.status, n.attempts, n.provider_message_id, n.error,
        n.status === 'failed' ? html`<form method="post" action="/admin/notifications/${n.id}/retry" class="inline">${U.csrf(ctx)}<button class="btn btn-call btn-sm" type="submit">Retry</button></form>` : '']))}`);
  }));
  router.post('/admin/notifications/:id/retry', G('notifications.manage', (ctx) => {
    notifications.retryFailed(ctx.db, Number(ctx.params.id));
    audit(ctx.db, ctx.user, 'notification.retry', 'notification', ctx.params.id, null, ctx.ip);
    notifications.dispatchSoon(ctx.db);
    back(ctx, '/admin/notifications', 'done');
  }));

  // ================= REPORTS & AUDIT =================
  router.get('/admin/reports', G('reports.view', (ctx) => {
    const db = ctx.db, ist = "'+330 minutes'";
    const daily = all(db, `SELECT date(created_at,${ist}) k, COUNT(*) c, SUM(type='consultation') cons, SUM(type='diagnostic') diag FROM appointments GROUP BY k ORDER BY k DESC LIMIT 31`);
    const monthly = all(db, `SELECT strftime('%Y-%m',created_at,${ist}) k, COUNT(*) c, SUM(type='consultation') cons, SUM(type='diagnostic') diag FROM appointments GROUP BY k ORDER BY k DESC LIMIT 12`);
    const dept = all(db, "SELECT COALESCE(d.name_en,'—') k, COUNT(*) c FROM appointments a LEFT JOIN departments d ON d.id=a.department_id GROUP BY d.id ORDER BY c DESC");
    const status = all(db, 'SELECT status k, COUNT(*) c FROM appointments GROUP BY status');
    const canc = all(db, "SELECT ref, cancel_reason, updated_at FROM appointments WHERE status='Cancelled' ORDER BY updated_at DESC LIMIT 30");
    const sms = all(db, 'SELECT status k, COUNT(*) c FROM notifications GROUP BY status');
    const row2 = (r) => [r.k, r.c, r.cons, r.diag];
    L(ctx, 'Reports', '/admin/reports', html`<p class="help">Dates use Asia/Kolkata.</p>
      <h2>Daily requests (last 31 days)</h2>${A.table(['Date', 'Total', 'Consultation', 'Diagnostic'], daily.map(row2))}
      <h2>Monthly requests</h2>${A.table(['Month', 'Total', 'Consultation', 'Diagnostic'], monthly.map(row2))}
      <h2>By department</h2>${A.table(['Department', 'Requests'], dept.map((r) => [r.k, r.c]))}
      <h2>Status summary</h2>${A.table(['Status', 'Count'], status.map((r) => [r.k, r.c]))}
      <h2>Recent cancellations</h2>${A.table(['Reference', 'Reason', 'When (UTC)'], canc.map((r) => [r.ref, r.cancel_reason, r.updated_at]))}
      <h2>SMS delivery</h2>${A.table(['Status', 'Count'], sms.map((r) => [r.k, r.c]), 'No SMS events.')}`);
  }));
  router.get('/admin/audit', G('audit.view', (ctx) => {
    const rows = all(ctx.db, 'SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300');
    L(ctx, 'Audit log', '/admin/audit', A.table(['When (UTC)', 'User', 'Action', 'Entity', 'Detail', 'IP'], rows.map((r) => [r.created_at, r.user_email || '—', r.action, `${r.entity || ''} ${r.entity_id || ''}`, r.detail, r.ip])));
  }));

  // ================= STAFF ACCOUNTS =================
  const roleOpts = Object.entries(A.ROLE_LABEL);
  router.get('/admin/users', G('users.manage', (ctx) => {
    const users = all(ctx.db, 'SELECT u.*, d.name_en AS doctor FROM users u LEFT JOIN doctors d ON d.id=u.doctor_id ORDER BY u.id');
    const docs = all(ctx.db, 'SELECT id,name_en FROM doctors ORDER BY name_en');
    L(ctx, 'Staff accounts', '/admin/users', html`
      ${users.map((u) => html`<form class="form" method="post" action="/admin/users/${u.id}" style="margin-bottom:14px">${U.csrf(ctx)}<p><strong>${u.name}</strong> — ${u.email}</p>
        <div class="row">${sel('role', 'Role', roleOpts, u.role)}${sel('doctor_id', 'Linked doctor (clinical staff only sees their own patients)', [['', '—'], ...docs.map((d) => [d.id, d.name_en])], u.doctor_id)}</div>
        ${A.yesNo('active', 'Active', u.active)}<div class="field"><label for="pw-${u.id}">New password (leave empty to keep)</label><input id="pw-${u.id}" name="password" type="password" autocomplete="new-password"></div>
        <button class="btn btn-primary btn-sm" type="submit">Save</button></form>`)}
      <h2>Add staff account</h2><form class="form" method="post" action="/admin/users">${U.csrf(ctx)}
        <div class="row">${txtField('name', 'Name', '', { required: true })}${txtField('email', 'Email', '', { type: 'email', required: true })}</div>
        <div class="row">${sel('role', 'Role', roleOpts, 'receptionist')}${sel('doctor_id', 'Linked doctor', [['', '—'], ...docs.map((d) => [d.id, d.name_en])], '')}</div>
        <div class="field"><label for="f-password">Initial password (min 12 characters, letters and a digit)</label><input id="f-password" name="password" type="password" autocomplete="new-password" required></div>
        <button class="btn btn-primary" type="submit">Create account</button></form>`);
  }));
  router.post('/admin/users', G('users.manage', async (ctx) => {
    const b = ctx.body, email = V.str(b.email, 254).toLowerCase(), name = V.str(b.name, 100);
    const problem = sec.passwordProblem(b.password);
    if (!V.EMAIL.test(email) || name.length < 2 || !A.ROLE_LABEL[b.role] || problem) return failTo(ctx, '/admin/users', problem || 'Enter a valid name, email and role.');
    if (get(ctx.db, 'SELECT 1 FROM users WHERE email=?', email)) return failTo(ctx, '/admin/users', 'That email already has an account.');
    const hash = await sec.hashPassword(b.password);
    const r = run(ctx.db, 'INSERT INTO users(email,name,password_hash,role,doctor_id) VALUES (?,?,?,?,?)', email, name, hash, b.role, Number(b.doctor_id) || null);
    audit(ctx.db, ctx.user, 'user.create', 'user', r.lastInsertRowid, `role=${b.role}`, ctx.ip);
    back(ctx, '/admin/users', 'created');
  }));
  router.post('/admin/users/:id', G('users.manage', async (ctx) => {
    const u = get(ctx.db, 'SELECT * FROM users WHERE id=?', Number(ctx.params.id)); if (!u) return notFoundAdmin(ctx);
    const b = ctx.body, role = A.ROLE_LABEL[b.role] ? b.role : u.role, active = flag(b, 'active');
    if (u.id === ctx.user.id && (!active || role !== u.role)) return failTo(ctx, '/admin/users', 'You cannot change your own role or deactivate yourself.');
    const wasSuper = u.role === 'super_admin' && u.active;
    if (wasSuper && (role !== 'super_admin' || !active) && get(ctx.db, "SELECT COUNT(*) c FROM users WHERE role='super_admin' AND active=1 AND id<>?", u.id).c === 0) return failTo(ctx, '/admin/users', 'At least one active super administrator is required.');
    let hash = u.password_hash;
    if (b.password) { const p = sec.passwordProblem(b.password); if (p) return failTo(ctx, '/admin/users', p); hash = await sec.hashPassword(b.password); }
    run(ctx.db, 'UPDATE users SET role=?, active=?, doctor_id=?, password_hash=?, failed_logins=0, locked_until=NULL WHERE id=?', role, active, Number(b.doctor_id) || null, hash, u.id);
    if (role !== u.role || !active || b.password) sec.destroyUserSessions(ctx.db, u.id); // permission changes take effect immediately
    audit(ctx.db, ctx.user, 'user.update', 'user', u.id, `role ${u.role}->${role} active=${active}${b.password ? ' password reset' : ''}`, ctx.ip);
    back(ctx, '/admin/users');
  }));

  router.get('/admin/account', G(null, (ctx) => L(ctx, 'My account', '/admin/account', html`<form class="form" method="post" action="/admin/account" style="max-width:480px">${U.csrf(ctx)}
    <div class="field"><label for="f-cur">Current password</label><input id="f-cur" name="current" type="password" autocomplete="current-password" required></div>
    <div class="field"><label for="f-new">New password (min 12 characters, letters and a digit)</label><input id="f-new" name="password" type="password" autocomplete="new-password" required></div>
    <button class="btn btn-primary" type="submit">Change password</button></form>`)));
  router.post('/admin/account', G(null, async (ctx) => {
    if (!sec.rateLimit(`pw:${ctx.user.id}`, 5, 15 * 60e3)) return failTo(ctx, '/admin/account', 'Too many attempts.');
    if (!(await sec.verifyPassword(String(ctx.body.current || ''), ctx.user.password_hash))) return failTo(ctx, '/admin/account', 'Current password is incorrect.');
    const p = sec.passwordProblem(ctx.body.password); if (p) return failTo(ctx, '/admin/account', p);
    run(ctx.db, 'UPDATE users SET password_hash=? WHERE id=?', await sec.hashPassword(ctx.body.password), ctx.user.id);
    run(ctx.db, 'DELETE FROM sessions WHERE user_id=? AND token_hash<>?', ctx.user.id, ctx.user.token_hash); // sign out other devices
    audit(ctx.db, ctx.user, 'user.password_change', 'user', ctx.user.id, null, ctx.ip);
    back(ctx, '/admin/account');
  }));
};
