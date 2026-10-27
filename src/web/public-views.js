'use strict';
const { all, get } = require('../lib/db');
const config = require('../lib/config');
const U = require('./ui');
const { html, raw, esc } = U;
const clock = require('../lib/clock');

const ICONS = { 'general-surgery': '🩺', gynecology: '🤰', pediatrics: '🧒', urology: '💧', physiotherapy: '🏃', orthopedics: '🦴', 'blood-bank': '🩸', medicine: '💊', dialysis: '🫘', ent: '👂', radiology: '🩻' };

// ----- data helpers -----
const departments = (db) => all(db, 'SELECT * FROM departments WHERE active=1 ORDER BY sort,id');
const consultDepartments = (db) => all(db, "SELECT * FROM departments WHERE active=1 AND form_type='consultation' ORDER BY sort,id");
const servicesOf = (db, deptId) => all(db, 'SELECT * FROM services WHERE department_id=? AND active=1 ORDER BY sort,id', deptId);
const diagnosticServices = (db) => all(db, `SELECT s.*, d.name_en AS dept_en, d.name_hi AS dept_hi FROM services s JOIN departments d ON d.id=s.department_id
  WHERE s.active=1 AND s.is_diagnostic=1 AND d.active=1 AND s.status NOT IN ('not_offered') ORDER BY d.sort,s.sort`);
function publishedDoctors(db, deptId) {
  const rows = deptId
    ? all(db, 'SELECT d.* FROM doctors d JOIN doctor_departments dd ON dd.doctor_id=d.id WHERE dd.department_id=? AND d.active=1 AND d.published=1 ORDER BY d.sort ASC, d.id ASC', deptId)
    : all(db, 'SELECT * FROM doctors WHERE active=1 AND published=1 ORDER BY sort ASC, id ASC');
  return rows.map((d) => ({
    ...d,
    depts: all(db, 'SELECT dep.id,dep.slug,dep.name_en,dep.name_hi FROM doctor_departments dd JOIN departments dep ON dep.id=dd.department_id WHERE dd.doctor_id=?', d.id),
    schedule: all(db, 'SELECT weekday,start_time,end_time FROM doctor_schedules WHERE doctor_id=? AND active=1 ORDER BY weekday,start_time', d.id),
  }));
}
const safeUrl = (u) => (/^(https:\/\/|\/static\/)/.test(u || '') ? u : '');
const content = (ctx, key) => { const c = ctx.content[key]; return c && c.published ? c[ctx.lang] || c.en : ''; };

function hoursText(ctx) {
  const s = ctx.settings;
  return s.hours_confirmed === '1' && (s[`hours_${ctx.lang}`] || s.hours_en) ? (s[`hours_${ctx.lang}`] || s.hours_en) : null; // never a guessed default
}
const L = U.localized;
const fmtDate = (d) => d.split('-').reverse().join('-');

function deptCard(ctx, d) {
  return html`<a class="card-link" href="/${ctx.lang}/departments/${d.slug}"><article class="card">
    <div class="icon" aria-hidden="true">${ICONS[d.slug] || '🏥'}</div>
    <h3 lang="${ctx.lang}">${L(ctx, d, 'name')}</h3><p class="sub" lang="${U.other(ctx.lang)}">${L({ lang: U.other(ctx.lang) }, d, 'name')}</p>
    ${U.badge(ctx, d.status)}<span class="more">${ctx.t('read_more')} →</span></article></a>`;
}

function formatTime12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatDoctorSchedules(schedule, dayNames) {
  if (!schedule || !schedule.length) return [];
  const byTime = {};
  for (const s of schedule) {
    const key = `${s.start_time}–${s.end_time}`;
    if (!byTime[key]) byTime[key] = { start: s.start_time, end: s.end_time, days: [] };
    byTime[key].days.push(s.weekday);
  }
  const result = [];
  for (const key of Object.keys(byTime)) {
    const group = byTime[key];
    const daysArr = group.days.sort((a, b) => a - b);
    let dayStr = '';
    if (daysArr.length >= 3 && daysArr.every((d, i) => i === 0 || d === daysArr[i - 1] + 1)) {
      dayStr = `${dayNames[daysArr[0]]} – ${dayNames[daysArr[daysArr.length - 1]]}`;
    } else {
      dayStr = daysArr.map((d) => dayNames[d]).join(', ');
    }
    result.push(`${dayStr}: ${formatTime12(group.start)} – ${formatTime12(group.end)}`);
  }
  return result;
}

function doctorCard(ctx, d) {
  const days = ctx.t('days').split(',');
  const schedPills = formatDoctorSchedules(d.schedule, days);
  const photo = safeUrl(d.photo_url);
  const isDirector = (d.specialization_en && d.specialization_en.includes('Director')) || d.slug === 'dr-gajraj-yadav';

  return html`<article class="card doctor-card ${isDirector ? 'is-director' : ''}">
    <div class="doc-top">
      <div class="doc-avatar-wrap">
        ${photo ? html`<img class="doc-avatar" src="${photo}" alt="${L(ctx, d, 'name')}" width="96" height="96" loading="lazy">` : html`<div class="doc-avatar avatar-placeholder" aria-hidden="true">🩺</div>`}
        ${isDirector ? html`<span class="director-badge">★ ${ctx.bi('Director', 'निदेशक')}</span>` : ''}
      </div>
      <div class="doc-info">
        <h3 class="doc-name">${L(ctx, d, 'name')}</h3>
        <p class="doc-specialty">${L(ctx, d, 'specialization')}</p>
        ${d.depts && d.depts.length ? html`
          <div class="doc-depts">
            ${d.depts.map((x) => html`<a class="dept-pill" href="/${ctx.lang}/departments/${x.slug}">🏥 ${L(ctx, x, 'name')}</a>`)}
          </div>` : ''}
      </div>
    </div>

    <div class="doc-chips">
      ${L(ctx, d, 'qualifications') ? html`<span class="doc-chip" title="${ctx.t('qualifications')}">🎓 <strong>${ctx.t('qualifications')}:</strong> ${L(ctx, d, 'qualifications')}</span>` : ''}
      ${d.experience_years != null ? html`<span class="doc-chip" title="${ctx.t('experience')}">⏳ <strong>${ctx.t('experience')}:</strong> ${d.experience_years} ${ctx.t('years')}</span>` : ''}
      ${d.languages ? html`<span class="doc-chip" title="${ctx.t('languages_spoken')}">🗣 <strong>${ctx.t('languages_spoken')}:</strong> ${d.languages}</span>` : ''}
      ${d.show_registration && d.registration_no ? html`<span class="doc-chip" title="${ctx.t('registration')}">📜 <strong>${ctx.t('registration')}:</strong> ${d.registration_no}</span>` : ''}
      ${d.fee_approved && d.consultation_fee != null ? html`<span class="doc-chip" title="${ctx.t('fee')}">💳 <strong>${ctx.t('fee')}:</strong> ₹${d.consultation_fee}</span>` : ''}
    </div>

    ${schedPills.length ? html`
      <div class="doc-schedule-card">
        <div class="sched-heading"><span>🕒</span> <strong>${ctx.t('consult_days')}</strong></div>
        <div class="sched-pills">
          ${schedPills.map((p) => html`<span class="sched-pill">• ${p}</span>`)}
        </div>
      </div>` : ''}

    <div class="doc-actions">
      <a class="btn btn-primary btn-sm doc-book-btn" href="/${ctx.lang}/appointment?doctor=${d.id}">📅 ${ctx.bi('Book Consultation', 'अपॉइंटमेंट बुक करें')}</a>
      <a class="btn btn-call btn-sm doc-call-btn" href="${U.telHref(ctx.settings.phone1)}">☎ ${ctx.t('call')}</a>
    </div>
  </article>`;
}

const doctorsEmpty = (ctx) => html`<div class="empty"><h3>${ctx.t('doctors_empty_title')}</h3><p>${ctx.t('doctors_empty_text')}</p>
  <a class="btn btn-primary" href="/${ctx.lang}/appointment">${ctx.t('book')}</a> ${U.phoneButtons(ctx)}</div>`;

// ----- forms -----
const rangeOptions = (ctx) => [['morning', ctx.t('tr_morning')], ['afternoon', ctx.t('tr_afternoon')], ['evening', ctx.t('tr_evening')], ['any', ctx.t('tr_any')]];

function patientFields(ctx, v, e, { consult }) {
  return html`<div class="row">${U.field(ctx, { name: 'patient_name', label: ctx.t('f_name'), value: v.patient_name, error: e.patient_name, required: true, attrs: { autocomplete: 'name', maxlength: 100 } })}
    ${U.field(ctx, { name: 'mobile', label: ctx.t('f_mobile'), type: 'tel', value: v.mobile, error: e.mobile, required: true, attrs: { autocomplete: 'tel', inputmode: 'numeric', maxlength: 16 } })}</div>
  ${consult ? html`<div class="row">${U.field(ctx, { name: 'age', label: ctx.t('f_age'), type: 'text', value: v.age, error: e.age, attrs: { inputmode: 'numeric', maxlength: 3 } })}
    ${U.field(ctx, { name: 'dob', label: ctx.t('f_dob'), type: 'date', value: v.dob, error: e.dob })}</div>
  <div class="row">${U.selectField(ctx, { name: 'gender', label: ctx.t('f_gender'), value: v.gender, error: e.gender, options: [['', ctx.t('f_choose')], ['female', ctx.t('g_female')], ['male', ctx.t('g_male')], ['other', ctx.t('g_other')], ['na', ctx.t('g_na')]] })}
    ${U.field(ctx, { name: 'email', label: ctx.t('f_email'), type: 'email', value: v.email, error: e.email, attrs: { autocomplete: 'email' } })}</div>
  ${U.radioGroup(ctx, { name: 'patient_type', legend: ctx.t('f_patient_type'), value: v.patient_type || 'new', error: e.patient_type, required: true, options: [['new', ctx.t('pt_new')], ['returning', ctx.t('pt_returning')]] })}`
  : U.field(ctx, { name: 'email', label: ctx.t('f_email'), type: 'email', value: v.email, error: e.email, attrs: { autocomplete: 'email' } })}`;
}

function consultForm(ctx, { values = {}, errors = {}, slotTimes = null, deptId = null, docId = null } = {}) {
  const db = ctx.db, v = values;
  const depts = consultDepartments(db);
  const docs = publishedDoctors(db);
  const selDoc = v.doctor_id || docId || (ctx.query && ctx.query.doctor) || '';
  const docObj = docs.find((x) => String(x.id) === String(selDoc));
  const selDept = v.department_id || (docObj && docObj.depts && docObj.depts[0] && docObj.depts[0].id) || deptId || (ctx.query && ctx.query.department) || '';
  const hasSlotUi = !!(selDoc);
  return html`<form id="consult-form" class="form" method="post" action="/${ctx.lang}/appointment" novalidate>
    ${U.csrf(ctx)}<input type="hidden" name="language_hint" value="${ctx.lang}">
    ${U.errorSummary(ctx, errors, { patient_name: ctx.t('f_name'), mobile: ctx.t('f_mobile'), age: ctx.t('f_age'), department_id: ctx.t('f_department'), preferred_date: ctx.t('f_date') })}
    ${U.selectField(ctx, { name: 'department_id', label: ctx.t('f_department'), value: selDept, error: errors.department_id, required: true, options: [['', ctx.t('f_choose')], ...depts.map((d) => [d.id, L(ctx, d, 'name')])] })}
    ${docs.length ? U.selectField(ctx, { name: 'doctor_id', label: ctx.t('f_doctor'), value: selDoc, error: errors.doctor_id, options: [['', ctx.t('f_doctor_tbd')], ...docs.map((d) => [d.id, `${L(ctx, d, 'name')}${L(ctx, d, 'specialization') ? ' — ' + L(ctx, d, 'specialization') : ''}`, d.depts.map((x) => x.id).join(',')])] })
      : html`<p class="alert alert-info">${ctx.t('f_doctor_tbd')}. ${ctx.t('doctors_empty_text')}</p>`}
    <div class="row">${U.field(ctx, { name: 'preferred_date', label: ctx.t('f_date'), type: 'date', value: v.preferred_date, error: errors.preferred_date, required: true, attrs: { min: clock.todayIST(), max: clock.addDays(clock.todayIST(), config.maxAdvanceBookingDays) } })}
      ${U.selectField(ctx, { name: 'preferred_range', label: ctx.t('f_range'), value: v.preferred_range || 'any', options: rangeOptions(ctx) })}</div>
    ${docs.length ? html`<div id="slot-box" ${hasSlotUi ? '' : raw('hidden')}>
      ${U.selectField(ctx, { name: 'slot_time', label: ctx.t('f_time'), value: v.slot_time || '', error: errors.slot_time, help: ctx.t('f_slot_hint'),
        options: [['', '—'], ...((slotTimes || []).map((x) => [x, x]))] })}
      ${slotTimes && !slotTimes.length ? html`<p class="alert alert-info">${ctx.t('no_slots')}</p>` : ''}</div>
      <p><button class="btn btn-call" type="submit" name="action" value="slots" formnovalidate data-load-slots>${ctx.t('f_load_slots')}</button></p>` : ''}
    ${patientFields(ctx, v, errors, { consult: true })}
    ${U.textareaField(ctx, { name: 'reason', label: ctx.t('f_reason'), value: v.reason, error: errors.reason, help: ctx.t('no_files') })}
    ${U.selectField(ctx, { name: 'language', label: ctx.t('f_language'), value: v.language || ctx.lang, options: [['hi', 'हिन्दी'], ['en', 'English']] })}
    ${U.checkbox(ctx, { name: 'sms_consent', label: ctx.t('f_consent_sms'), checked: v.sms_consent })}
    ${U.emergencyBanner(ctx)}
    <button class="btn btn-primary" type="submit">${ctx.t('f_submit')}</button></form>`;
}

function diagForm(ctx, { values = {}, errors = {}, serviceId = null } = {}) {
  const v = values;
  const svcs = diagnosticServices(ctx.db);
  const sel = v.service_id || serviceId || '';
  return html`<form class="form" method="post" action="/${ctx.lang}/diagnostics" novalidate>
    ${U.csrf(ctx)}
    ${U.errorSummary(ctx, errors, { patient_name: ctx.t('f_name'), mobile: ctx.t('f_mobile'), service_id: ctx.t('f_service'), preferred_date: ctx.t('f_date') })}
    ${U.selectField(ctx, { name: 'service_id', label: ctx.t('f_service'), value: sel, error: errors.service_id, required: true,
      options: [['', ctx.t('f_choose')], ...svcs.filter((s) => s.status !== 'temporarily_unavailable').map((s) => [s.id, `${L(ctx, s, 'name')} — ${ctx.t('sv_' + s.status)}`])] })}
    ${svcs.some((s) => s.status === 'temporarily_unavailable') ? html`<p class="help">${svcs.filter((s) => s.status === 'temporarily_unavailable').map((s) => `${L(ctx, s, 'name')}: ${ctx.t('sv_temporarily_unavailable')}. `)}</p>` : ''}
    <p class="alert alert-info">${ctx.t('avail_notice')}</p>
    <div class="row">${U.field(ctx, { name: 'preferred_date', label: ctx.t('f_date'), type: 'date', value: v.preferred_date, error: errors.preferred_date, required: true, attrs: { min: clock.todayIST(), max: clock.addDays(clock.todayIST(), config.maxAdvanceBookingDays) } })}
      ${U.selectField(ctx, { name: 'preferred_range', label: ctx.t('f_range'), value: v.preferred_range || 'any', options: rangeOptions(ctx) })}</div>
    ${patientFields(ctx, v, errors, { consult: false })}
    <div class="row">${U.field(ctx, { name: 'referring_doctor', label: ctx.t('f_referring'), value: v.referring_doctor, attrs: { maxlength: 100 } })}
      ${U.selectField(ctx, { name: 'has_referral', label: ctx.t('f_referral'), value: v.has_referral || 'na', options: [['yes', ctx.t('ref_yes')], ['no', ctx.t('ref_no')], ['na', ctx.t('ref_na')]] })}</div>
    ${U.textareaField(ctx, { name: 'notes', label: ctx.t('f_notes'), value: v.notes, error: errors.notes, help: ctx.t('no_files') })}
    ${U.selectField(ctx, { name: 'language', label: ctx.t('f_language'), value: v.language || ctx.lang, options: [['hi', 'हिन्दी'], ['en', 'English']] })}
    ${U.checkbox(ctx, { name: 'sms_consent', label: ctx.t('f_consent_sms'), checked: v.sms_consent })}
    ${U.emergencyBanner(ctx)}
    <button class="btn btn-primary" type="submit">${ctx.t('f_submit')}</button></form>`;
}

function inquiryForm(ctx, { values = {}, errors = {}, deptId = null, formId = 'inquiry-form' } = {}) {
  const v = values;
  return html`<form id="${formId}" class="form" method="post" action="/${ctx.lang}/contact" novalidate>
    ${U.csrf(ctx)}<input type="hidden" name="language" value="${ctx.lang}">
    ${U.errorSummary(ctx, errors, { name: ctx.t('f_name'), mobile: ctx.t('f_mobile'), message: ctx.t('f_message') })}
    <div class="row">${U.field(ctx, { name: 'name', label: ctx.t('f_name'), value: v.name, error: errors.name, required: true, attrs: { autocomplete: 'name', maxlength: 100 } })}
      ${U.field(ctx, { name: 'mobile', label: ctx.t('f_mobile'), type: 'tel', value: v.mobile, error: errors.mobile, required: true, attrs: { autocomplete: 'tel', inputmode: 'numeric' } })}</div>
    ${U.field(ctx, { name: 'email', label: ctx.t('f_email'), type: 'email', value: v.email, error: errors.email })}
    ${U.selectField(ctx, { name: 'department_id', label: ctx.t('f_department'), value: v.department_id || deptId || '', options: [['', ctx.t('f_choose')], ...departments(ctx.db).map((d) => [d.id, L(ctx, d, 'name')])] })}
    ${U.textareaField(ctx, { name: 'message', label: ctx.t('f_message'), value: v.message, error: errors.message, required: true, rows: 4, maxlength: 1000, help: ctx.t('no_files') })}
    ${U.emergencyBanner(ctx)}
    <button class="btn btn-primary" type="submit">${ctx.t('f_send')}</button></form>`;
}

// ----- sections -----
function hoursBlock(ctx) {
  const h = hoursText(ctx);
  return h ? html`<p><strong>${ctx.t('hours')}:</strong> ${h}</p>` : html`<p><strong>${ctx.t('hours')}:</strong> ${ctx.t('hours_tbc')}</p>`;
}
function emergencyStatusBlock(ctx) {
  const s = ctx.settings;
  const note = s[`emergency_note_${ctx.lang}`] || s.emergency_note_en;
  return s.emergency_status !== 'unconfirmed' && note ? html`<p><strong>${ctx.bi('Emergency services', 'आपातकालीन सेवा')}:</strong> ${note}</p>` : '';
}
function directionsBlock(ctx) {
  const s = ctx.settings;
  return s.map_verified === '1' && /^https:\/\//.test(s.map_url)
    ? html`<p><a class="btn btn-call" href="${s.map_url}" rel="noopener" target="_blank">📍 ${ctx.t('directions')}</a></p>` : html`<p class="help">${ctx.t('directions_pending')}</p>`;
}
const faqSection = (ctx) => {
  const rows = all(ctx.db, 'SELECT * FROM faqs WHERE published=1 ORDER BY sort,id');
  return html`<div class="faq">${rows.map((f) => html`<details><summary>${L(ctx, f, 'q')}</summary><p>${L(ctx, f, 'a')}</p></details>`)}</div>`;
};
const announcementsBlock = (ctx) => {
  const rows = all(ctx.db, 'SELECT * FROM announcements WHERE published=1 ORDER BY created_at DESC LIMIT 3');
  return rows.length ? html`<section class="block"><div class="wrap"><h2 class="sec">${ctx.t('announcements')}</h2>${rows.map((a) => html`<div class="alert alert-info"><strong>${L(ctx, a, 'title')}</strong>${L(ctx, a, 'body') ? html`<p>${L(ctx, a, 'body')}</p>` : ''}</div>`)}</div></section>` : '';
};

function jsonLd(ctx) {
  const s = ctx.settings;
  return { '@context': 'https://schema.org', '@type': 'Hospital', name: s.hospital_name_en, alternateName: s.hospital_name_hi, url: `${config.baseUrl}/${ctx.lang}/`,
    telephone: [s.phone1, s.phone2], slogan: s.tagline_en,
    address: { '@type': 'PostalAddress', streetAddress: 'Sarai Road', addressLocality: 'Mundawar', addressRegion: 'Rajasthan', postalCode: '301707', addressCountry: 'IN' },
    parentOrganization: { '@type': 'Organization', name: s.trust_name_en } };
}

function home(ctx) {
  const db = ctx.db, s = ctx.settings;
  const depts = departments(db), facilities = depts.filter((d) => d.is_facility);
  const docs = publishedDoctors(db);
  const highlightsBand = html`
  <section class="block" style="background:#f8fafc;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:24px 0">
    <div class="wrap">
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:16px;text-align:center">
        <div class="card" style="padding:16px;background:#fff;border-radius:8px">
          <div style="font-size:1.8rem;margin-bottom:6px">🏛️</div>
          <strong style="color:var(--navy);display:block;font-size:1rem;margin-bottom:4px">${ctx.bi('Ayushman & RGHS', 'आयुष्मान एवं RGHS')}</strong>
          <small style="color:var(--muted)">${ctx.bi('Empaneled for Cashless Treatment', 'कैशलेस स्वास्थ्य योजनाओं हेतु अधिकृत')}</small>
        </div>
        <div class="card" style="padding:16px;background:#fff;border-radius:8px">
          <div style="font-size:1.8rem;margin-bottom:6px">🛏️</div>
          <strong style="color:var(--navy);display:block;font-size:1rem;margin-bottom:4px">${ctx.bi('90 Beds & 15 ICU Units', '90 बेड एवं 15 आईसीयू यूनिट')}</strong>
          <small style="color:var(--muted)">${ctx.bi('Advanced Inpatient & Critical Care', 'आधुनिक इनडोर एवं गहन चिकित्सा')}</small>
        </div>
        <div class="card" style="padding:16px;background:#fff;border-radius:8px">
          <div style="font-size:1.8rem;margin-bottom:6px">🔬</div>
          <strong style="color:var(--navy);display:block;font-size:1rem;margin-bottom:4px">${ctx.bi('CT Scan & Digital Imaging', 'सीटी स्कैन एवं डिजिटल इमेजिंग')}</strong>
          <small style="color:var(--muted)">${ctx.bi('In-house Diagnostics & Pathology', 'डिजिटल एक्स-रे एवं पैथोलॉजी लैब')}</small>
        </div>
        <div class="card" style="padding:16px;background:#fff;border-radius:8px">
          <div style="font-size:1.8rem;margin-bottom:6px">🩺</div>
          <strong style="color:var(--navy);display:block;font-size:1rem;margin-bottom:4px">${ctx.bi('Specialist Surgical Care', 'विशेषज्ञ शल्य चिकित्सा')}</strong>
          <small style="color:var(--muted)">${ctx.bi('Laparoscopy, Ortho & General Surgery', 'लेप्रोस्कोपी एवं आधुनिक सर्जरी')}</small>
        </div>
      </div>
    </div>
  </section>`;

  const main = html`
  <section class="hero"><div class="wrap hero-grid"><div>
    <h1 lang="${ctx.lang}">${ctx.bi('Your Health, Our Priority.', 'आपका स्वास्थ्य, हमारी प्राथमिकता।')}</h1>
    <h2 lang="${U.other(ctx.lang)}">${ctx.lang === 'en' ? 'आपका स्वास्थ्य, हमारी प्राथमिकता।' : 'Your Health, Our Priority.'}</h2>
    <p>${content(ctx, 'home_intro')}</p>
    <p><strong>${s['tagline_' + ctx.lang]}</strong></p>
    <div class="actions"><a class="btn btn-primary" href="/${ctx.lang}/appointment">${ctx.t('book')}</a>
      <a class="btn btn-call" href="${U.telHref(s.phone1)}">☎ ${ctx.t('call')}</a>
      <a class="btn btn-outline" href="/${ctx.lang}/departments">${ctx.t('explore')}</a></div>
    ${U.phoneButtons(ctx)}
  </div><div class="hero-card">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--line)">
      <img src="/static/img/hospital-logo.jpg" alt="${s['hospital_name_' + ctx.lang]}" width="54" height="54" style="border-radius:50%;object-fit:cover;box-shadow:0 2px 6px rgba(0,0,0,0.15)">
      <div>
        <strong style="font-size:1.05rem;color:var(--navy);display:block">${s['hospital_name_' + ctx.lang]}</strong>
        <small style="color:var(--muted);font-weight:600">${s['trust_name_' + ctx.lang]}</small>
      </div>
    </div>
    <p><strong>${ctx.t('address')}:</strong><br>${s['address_' + ctx.lang]}</p>
    ${hoursBlock(ctx)}${emergencyStatusBlock(ctx)}
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn btn-primary btn-sm" href="/${ctx.lang}/appointment" style="flex:1;text-align:center">${ctx.t('book')}</a>
      <a class="btn btn-call btn-sm" href="${U.telHref(s.phone1)}" style="flex:1;text-align:center">☎ ${s.phone1}</a>
    </div>
  </div></div></section>
  <div class="wrap">${U.emergencyBanner(ctx)}</div>
  ${announcementsBlock(ctx)}
  ${highlightsBand}
  <section class="block"><div class="wrap"><h2 class="sec">${ctx.t('nav_departments')}</h2><p class="lead">${ctx.t('avail_notice')}</p>
    <div class="grid">${depts.map((d) => deptCard(ctx, d))}</div></div></section>
  <section class="block alt"><div class="wrap"><h2 class="sec">${ctx.bi('Request an appointment', 'अपॉइंटमेंट का अनुरोध')}</h2>
    <div class="grid">
      <article class="card"><div class="icon" aria-hidden="true">🩺</div><h3>${ctx.t('consult_card')}</h3><p>${ctx.bi('Choose a department and, if available, a doctor. Hospital staff will confirm the time.', 'विभाग और, यदि उपलब्ध हो, चिकित्सक चुनें। समय की पुष्टि अस्पताल का स्टाफ करेगा।')}</p><a class="btn btn-primary more" href="/${ctx.lang}/appointment">${ctx.t('book')}</a></article>
      <article class="card"><div class="icon" aria-hidden="true">🩻</div><h3>${ctx.t('diag_card')}</h3><p>${ctx.bi('X-ray, ultrasound, CT scan, digital imaging and dialysis inquiries.', 'एक्स-रे, अल्ट्रासाउंड, सीटी स्कैन, डिजिटल इमेजिंग और डायलिसिस संबंधी पूछताछ।')}</p><a class="btn btn-primary more" href="/${ctx.lang}/diagnostics">${ctx.t('diag_card')}</a></article>
    </div></div></section>
  <section class="block"><div class="wrap"><h2 class="sec">${ctx.t('nav_doctors')}</h2>
    ${docs.length ? html`<div class="grid">${docs.slice(0, 3).map((d) => doctorCard(ctx, d))}</div><p><a href="/${ctx.lang}/doctors">${ctx.t('nav_doctors')} →</a></p>` : doctorsEmpty(ctx)}</div></section>
  <section class="block alt"><div class="wrap"><h2 class="sec">${ctx.t('facilities')}</h2>
    <ul class="svc-list">${facilities.map((d) => html`<li><a href="/${ctx.lang}/departments/${d.slug}">${L(ctx, d, 'name')}</a>${U.badge(ctx, d.status)}</li>`)}</ul></div></section>
  <section class="block"><div class="wrap"><h2 class="sec">${ctx.t('trust')}</h2><p class="lead">${content(ctx, 'trust_intro')}</p><p><a href="/${ctx.lang}/about">${ctx.t('nav_about')} →</a></p></div></section>
  <section class="block alt"><div class="wrap"><h2 class="sec">${ctx.t('patient_info')}</h2><p class="lead">${content(ctx, 'patient_info')}</p>${U.disclaimer(ctx)}</div></section>
  <section class="block"><div class="wrap"><h2 class="sec">${ctx.t('faq')}</h2>${faqSection(ctx)}</div></section>
  <section class="block alt"><div class="wrap"><h2 class="sec">${ctx.t('nav_contact')}</h2>
    <p><strong>${ctx.t('address')}:</strong> ${s['address_' + ctx.lang]}</p>${U.phoneButtons(ctx)}${hoursBlock(ctx)}${directionsBlock(ctx)}
    <p><a href="/${ctx.lang}/contact">${ctx.t('nav_contact')} →</a></p></div></section>`;
  return U.layout(ctx, { title: '', desc: ctx.bi('SACHKHAND HOSPITAL, Mundawar, Rajasthan — Always Dedicated to Your Health. Departments, diagnostics and appointment requests.', 'सचखंड हॉस्पिटल, मुंडावर, राजस्थान — आपके स्वास्थ्य के लिए सदैव समर्पित। विभाग, जाँच सेवाएँ और अपॉइंटमेंट अनुरोध।'), path: '', main, jsonld: jsonLd(ctx) });
}

function about(ctx) {
  const s = ctx.settings;
  const facilities = departments(ctx.db).filter((d) => d.is_facility);
  const sec = (title, key) => (content(ctx, key) ? html`<section class="block"><div class="wrap"><h2 class="sec">${title}</h2>${U.nl2p(content(ctx, key))}</div></section>` : '');
  const visualHeader = html`
    <section class="block" style="padding-bottom:0"><div class="wrap" style="text-align:center">
      <img src="/static/img/hospital-building.jpg" alt="${s['hospital_name_' + ctx.lang]}" width="960" height="420" style="max-width:100%;height:auto;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.12);margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:16px">
        <img src="/static/img/hospital-logo.jpg" alt="Hospital Logo" width="64" height="64" style="border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.15)">
        <img src="/static/img/trust-logo.png" alt="Trust Logo" width="70" height="70" style="object-fit:contain">
      </div>
    </div></section>`;
  const main = html`<div class="pagehead"><div class="wrap"><h1>${ctx.t('nav_about')}</h1></div></div>
    ${visualHeader}
    ${sec(s['hospital_name_' + ctx.lang], 'about_intro')}
    ${sec(ctx.bi('Government health schemes', 'सरकारी स्वास्थ्य योजनाएँ'), 'schemes_intro')}
    ${sec(ctx.bi('Hospital facilities & infrastructure', 'अस्पताल की सुविधाएँ एवं बुनियादी ढाँचा'), 'facilities_overview')}
    ${sec(ctx.bi('Our mission', 'हमारा उद्देश्य'), 'mission')}${sec(ctx.bi('Our vision', 'हमारी दृष्टि'), 'vision')}${sec(ctx.bi('Patient-care philosophy', 'मरीज़ देखभाल का दृष्टिकोण'), 'philosophy')}
    ${sec(ctx.t('trust'), 'trust_intro')}
    <section class="block alt"><div class="wrap"><h2 class="sec">${ctx.t('facilities')}</h2><ul class="svc-list">${facilities.map((d) => html`<li><a href="/${ctx.lang}/departments/${d.slug}">${L(ctx, d, 'name')}</a>${U.badge(ctx, d.status)}</li>`)}</ul></div></section>
    ${sec(ctx.bi('Patient rights', 'मरीज़ों के अधिकार'), 'patient_rights')}${sec(ctx.bi('Patient responsibilities', 'मरीज़ों की जिम्मेदारियाँ'), 'patient_responsibilities')}
    <div class="wrap">${U.disclaimer(ctx)}</div>`;
  return U.layout(ctx, { title: ctx.t('nav_about'), desc: ctx.bi('About SACHKHAND HOSPITAL, Mundawar, managed by Sachkhand Charitable Trust.', 'सचखंड हॉस्पिटल, मुंडावर के बारे में — संचालन सचखंड चैरिटेबल ट्रस्ट।'), path: 'about', main });
}

function departmentsIndex(ctx) {
  const main = html`<div class="pagehead"><div class="wrap"><h1>${ctx.t('nav_departments')}</h1><p class="lead">${ctx.t('avail_notice')}</p></div></div>
    <section class="block"><div class="wrap"><div class="grid">${departments(ctx.db).map((d) => deptCard(ctx, d))}</div>${U.disclaimer(ctx)}</div></section>`;
  return U.layout(ctx, { title: ctx.t('nav_departments'), desc: ctx.bi('Departments and services at SACHKHAND HOSPITAL, Mundawar.', 'सचखंड हॉस्पिटल, मुंडावर के विभाग और सेवाएँ।'), path: 'departments', main });
}

function departmentPage(ctx, d, state = {}) {
  const db = ctx.db;
  const svcs = servicesOf(db, d.id);
  const docs = publishedDoctors(db, d.id);
  const all_ = departments(db);
  const idx = all_.findIndex((x) => x.id === d.id);
  const related = [1, 2, 3].map((i) => all_[(idx + i) % all_.length]).filter((x) => x.id !== d.id);
  const hrs = L(ctx, d, 'hours');
  const formBlock = d.form_type === 'diagnostic' ? diagForm(ctx, { ...state, serviceId: svcs[0] && svcs[0].id })
    : d.form_type === 'inquiry' ? inquiryForm(ctx, { ...state, deptId: d.id, formId: 'dept-inquiry' }) : consultForm(ctx, { ...state, deptId: d.id });
  const main = html`<div class="pagehead"><div class="wrap">
    <p class="breadcrumb" style="padding:0"><a href="/${ctx.lang}/departments">${ctx.t('nav_departments')}</a> / ${L(ctx, d, 'name')}</p>
    <h1 lang="${ctx.lang}">${ICONS[d.slug] || ''} ${L(ctx, d, 'name')}</h1>
    <p class="sub" lang="${U.other(ctx.lang)}" style="margin:0;color:#4a5875">${L({ lang: U.other(ctx.lang) }, d, 'name')}</p>
    <p>${U.badge(ctx, d.status)}</p></div></div>
  <section class="block"><div class="wrap">
    ${d.status === 'to_be_confirmed' ? html`<div class="alert alert-info"><strong>${ctx.t('sv_to_be_confirmed')}.</strong> ${ctx.t('avail_notice')}</div>` : ''}
    ${d.status === 'temporarily_unavailable' ? html`<div class="alert alert-error"><strong>${ctx.t('sv_temporarily_unavailable')}.</strong> ${U.phoneButtons(ctx)}</div>` : ''}
    ${L(ctx, d, 'note') ? html`<div class="alert alert-info">${L(ctx, d, 'note')}</div>` : ''}
    <p class="lead">${L(ctx, d, 'desc')}</p>
    <p><strong>${ctx.t('dept_hours')}:</strong> ${hrs || ctx.t('hours_tbc')}</p>
    ${U.phoneButtons(ctx)}
    <h2 class="sec" style="margin-top:28px">${ctx.t('dept_services')}</h2>
    <ul class="svc-list">${svcs.map((sv) => html`<li><div><strong>${L(ctx, sv, 'name')}</strong>
      ${L(ctx, sv, 'desc') ? html`<br><span class="sub">${L(ctx, sv, 'desc')}</span>` : ''}
      ${L(ctx, sv, 'hours') ? html`<br><span class="sub">${ctx.t('dept_hours')}: ${L(ctx, sv, 'hours')}</span>` : ''}
      ${L(ctx, sv, 'closure_note') ? html`<br><span class="err">${ctx.t('closure')}: ${L(ctx, sv, 'closure_note')}</span>` : ''}
      ${sv.prep_approved && L(ctx, sv, 'prep') ? html`<br><em>${ctx.t('prep')}:</em> ${L(ctx, sv, 'prep')}` : ''}</div>${U.badge(ctx, sv.status)}</li>`)}</ul>
    <h2 class="sec" style="margin-top:28px">${ctx.t('dept_doctors')}</h2>
    ${docs.length ? html`<div class="grid">${docs.map((x) => doctorCard(ctx, x))}</div>` : doctorsEmpty(ctx)}
    <h2 class="sec" style="margin-top:28px" id="request">${d.form_type === 'consultation' ? ctx.t('dept_request') : ctx.t('dept_inquiry')}</h2>
    ${formBlock}
    <h2 class="sec" style="margin-top:28px">${ctx.t('dept_related')}</h2>
    <div class="grid">${related.map((x) => deptCard(ctx, x))}</div>
    ${U.disclaimer(ctx)}</div></section>`;
  return U.layout(ctx, { title: L(ctx, d, 'name'), desc: L(ctx, d, 'desc').slice(0, 160), path: `departments/${d.slug}`, main });
}

function doctorsPage(ctx) {
  const docs = publishedDoctors(ctx.db);
  const main = html`<div class="pagehead"><div class="wrap"><h1>${ctx.t('nav_doctors')}</h1><p class="lead">${ctx.bi('SACHKHAND HOSPITAL Super-Specialist Doctor Team — Meet our verified surgeons, physicians, and medical specialists dedicated to your health.', 'सचखंड हॉस्पिटल की सुपर-स्पेशलिस्ट चिकित्सकों की टीम — आपके स्वास्थ्य के लिए सदैव समर्पित वरिष्ठ चिकित्सक एवं सर्जन।')}</p></div></div>
    <section class="block"><div class="wrap">${docs.length ? html`<div class="grid doc-grid">${docs.map((d) => doctorCard(ctx, d))}</div>` : doctorsEmpty(ctx)}${U.disclaimer(ctx)}</div></section>`;
  return U.layout(ctx, { title: ctx.t('nav_doctors'), desc: ctx.bi('Doctors at SACHKHAND HOSPITAL.', 'सचखंड हॉस्पिटल के चिकित्सक।'), path: 'doctors', main });
}

function contactPage(ctx, { values = {}, errors = {}, done = false } = {}) {
  const s = ctx.settings;
  const main = html`<div class="pagehead"><div class="wrap"><h1>${ctx.t('nav_contact')}</h1></div></div>
    <section class="block"><div class="wrap">${U.emergencyBanner(ctx)}
    <p><strong>${s['hospital_name_' + ctx.lang]}</strong></p><p><strong>${ctx.t('address')}:</strong> ${s['address_' + ctx.lang]}</p>
    ${U.phoneButtons(ctx)}${hoursBlock(ctx)}${emergencyStatusBlock(ctx)}${directionsBlock(ctx)}
    <h2 class="sec" style="margin-top:28px">${ctx.bi('Send an inquiry', 'पूछताछ भेजें')}</h2>
    ${done ? html`<div class="alert alert-ok" role="status">${ctx.t('ok_inquiry_sent')}</div>` : inquiryForm(ctx, { values, errors })}
    ${U.disclaimer(ctx)}</div></section>`;
  return U.layout(ctx, { title: ctx.t('nav_contact'), desc: ctx.bi('Contact SACHKHAND HOSPITAL, Sarai Road, Mundawar. Telephone 01494-246333, 09799107439.', 'सचखंड हॉस्पिटल से संपर्क करें, सराय रोड, मुंडावर। फ़ोन 01494-246333, 09799107439।'), path: 'contact', main, jsonld: jsonLd(ctx) });
}

const appointmentPage = (ctx, st) => U.layout(ctx, { title: ctx.t('book'), desc: ctx.bi('Request a doctor consultation at SACHKHAND HOSPITAL.', 'सचखंड हॉस्पिटल में चिकित्सक परामर्श का अनुरोध करें।'), path: 'appointment',
  main: html`<div class="pagehead"><div class="wrap"><h1>${ctx.t('book')}</h1><p class="lead">${ctx.t('ok_received_text')}</p></div></div><section class="block"><div class="wrap">${consultForm(ctx, st)}${U.disclaimer(ctx)}</div></section>` });

const diagnosticsPage = (ctx, st) => {
  const svcs = diagnosticServices(ctx.db);
  return U.layout(ctx, { title: ctx.t('nav_diagnostics'), desc: ctx.bi('Request X-ray, ultrasound, CT scan, digital imaging or dialysis inquiries at SACHKHAND HOSPITAL.', 'सचखंड हॉस्पिटल में एक्स-रे, अल्ट्रासाउंड, सीटी स्कैन, डिजिटल इमेजिंग या डायलिसिस की पूछताछ करें।'), path: 'diagnostics',
    main: html`<div class="pagehead"><div class="wrap"><h1>${ctx.t('nav_diagnostics')}</h1><p class="lead">${ctx.t('avail_notice')}</p></div></div>
    <section class="block"><div class="wrap"><ul class="svc-list">${svcs.map((s) => html`<li><strong>${L(ctx, s, 'name')}</strong>${U.badge(ctx, s.status)}</li>`)}</ul>
    ${diagForm(ctx, st)}${U.disclaimer(ctx)}</div></section>` });
};

function appointmentReceiptCard(ctx, appt, { isStandalone = false } = {}) {
  const db = ctx.db, s = ctx.settings;
  const dept = appt.department_id ? get(db, 'SELECT * FROM departments WHERE id=?', appt.department_id) : null;
  const doc = appt.doctor_id ? get(db, 'SELECT * FROM doctors WHERE id=?', appt.doctor_id) : null;
  const svc = appt.service_id ? get(db, 'SELECT * FROM services WHERE id=?', appt.service_id) : null;

  const deptName = dept ? L(ctx, dept, 'name') : (appt.type === 'diagnostic' ? ctx.t('diag_card') : ctx.t('f_choose'));
  const docName = doc ? `${L(ctx, doc, 'name')}${L(ctx, doc, 'specialization') ? ' — ' + L(ctx, doc, 'specialization') : ''}` : ctx.bi('Doctor to be assigned by hospital', 'चिकित्सक अस्पताल द्वारा निर्धारित किया जाएगा');

  const rangeLabel = { morning: 'tr_morning', afternoon: 'tr_afternoon', evening: 'tr_evening', any: 'tr_any' };
  let slotText = '—';
  if (appt.slot_start) {
    slotText = `${fmtDate(appt.slot_start.slice(0, 10))} ${appt.slot_start.slice(11)}`;
  } else if (appt.preferred_date) {
    slotText = `${fmtDate(appt.preferred_date)} (${ctx.t(rangeLabel[appt.preferred_range] || 'tr_any')})`;
  }

  const patientTypeStr = appt.patient_type === 'returning' ? ctx.t('pt_returning') : ctx.t('pt_new');
  const genderStr = appt.gender ? ctx.t('g_' + appt.gender) : '—';
  const ageStr = appt.age ? `${appt.age} ${ctx.t('years')}` : (appt.dob ? fmtDate(appt.dob) : '—');

  return html`
  <div class="receipt-slip" id="appointment-receipt">
    <div class="receipt-header">
      <div class="receipt-brand">
        <img src="/static/img/hospital-logo.jpg" alt="${s['hospital_name_' + ctx.lang]}" width="52" height="52" class="receipt-logo">
        <div>
          <h2 class="receipt-hname">${s['hospital_name_' + ctx.lang]}</h2>
          <p class="receipt-tname">${s['trust_name_' + ctx.lang]}</p>
          <p class="receipt-addr">${s['address_' + ctx.lang]} · ☎ ${s.phone1}</p>
        </div>
      </div>
      <div class="receipt-badge-box">
        <span class="receipt-badge">${ctx.t('receipt_subtitle')}</span>
        <div class="receipt-ref-code">${appt.ref}</div>
        <div class="receipt-date"><small>${ctx.t('receipt_date')}: ${clock.todayIST()}</small></div>
      </div>
    </div>

    <div class="receipt-grid">
      <div class="receipt-col">
        <h3 class="receipt-sect-title">👤 ${ctx.t('receipt_patient_info')}</h3>
        <table class="receipt-table">
          <tr><th>${ctx.t('receipt_patient_name')}:</th><td><strong>${appt.patient_name}</strong></td></tr>
          <tr><th>${ctx.t('receipt_mobile')}:</th><td>${appt.mobile}</td></tr>
          ${appt.email ? html`<tr><th>${ctx.t('f_email')}:</th><td>${appt.email}</td></tr>` : ''}
          <tr><th>${ctx.t('receipt_age_gender')}:</th><td>${ageStr} / ${genderStr}</td></tr>
          <tr><th>${ctx.t('receipt_type')}:</th><td>${patientTypeStr}</td></tr>
        </table>
      </div>

      <div class="receipt-col">
        <h3 class="receipt-sect-title">🏥 ${ctx.t('receipt_appt_info')}</h3>
        <table class="receipt-table">
          <tr><th>${ctx.t('receipt_num')}:</th><td><strong class="ref-mono" style="color:var(--navy)">${appt.ref}</strong></td></tr>
          <tr><th>${ctx.t('receipt_dept')}:</th><td><strong>${deptName}</strong>${svc ? html` — ${L(ctx, svc, 'name')}` : ''}</td></tr>
          <tr><th>${ctx.t('receipt_doctor')}:</th><td>${docName}</td></tr>
          <tr><th>${ctx.t('receipt_slot')}:</th><td><strong>${slotText}</strong></td></tr>
          <tr><th>${ctx.t('receipt_status')}:</th><td>${U.apptBadge(ctx, appt.status)}</td></tr>
        </table>
      </div>
    </div>

    <div class="receipt-instructions">
      <h4>📋 ${ctx.t('receipt_instructions_title')}</h4>
      <ol>
        <li>${ctx.t('receipt_inst_1')}</li>
        <li>${ctx.t('receipt_inst_2')}</li>
        <li>${ctx.t('receipt_inst_3')}</li>
        <li>${ctx.t('receipt_inst_4')}</li>
      </ol>
    </div>

    <div class="receipt-footer">
      <p><em>${ctx.t('receipt_tagline')}</em></p>
    </div>

    <div class="receipt-actions no-print">
      <button class="btn btn-primary" type="button" data-print>🖨️ ${ctx.t('receipt_print')}</button>
      <a class="btn btn-call" href="/${ctx.lang}/appointment/receipt/download?ref=${appt.ref}&mobile=${encodeURIComponent(appt.mobile)}" download="sachkhand-receipt-${appt.ref}.html">⬇️ ${ctx.t('receipt_download')}</a>
      <a class="btn btn-outline" href="/${ctx.lang}/appointment/receipt/download?ref=${appt.ref}&mobile=${encodeURIComponent(appt.mobile)}&format=txt" download="sachkhand-receipt-${appt.ref}.txt">📄 ${ctx.t('receipt_download_txt')}</a>
      ${!isStandalone ? html`<a class="btn btn-outline" href="/${ctx.lang}/appointment/receipt?ref=${appt.ref}&mobile=${encodeURIComponent(appt.mobile)}">🔍 ${ctx.t('receipt_view')}</a>` : ''}
    </div>
  </div>`;
}

function receiptPage(ctx, appt) {
  const main = html`
    <div class="pagehead no-print"><div class="wrap">
      <h1>${ctx.t('receipt_title')}</h1>
      <p class="lead">${ctx.t('receipt_subtitle')} — ${appt.ref}</p>
    </div></div>
    <section class="block"><div class="wrap">
      ${appointmentReceiptCard(ctx, appt, { isStandalone: true })}
      <div class="no-print" style="margin-top:24px;text-align:center;display:flex;gap:12px;justify-content:center">
        <a class="btn btn-outline" href="/${ctx.lang}/appointment/status">← ${ctx.t('nav_status')}</a>
        <a class="btn btn-outline" href="/${ctx.lang}/">🏠 ${ctx.t('go_home')}</a>
      </div>
    </div></section>`;
  return U.layout(ctx, { title: ctx.t('receipt_title'), path: 'appointment/receipt', main, noindex: true });
}

function successPage(ctx, flash, appt = null) {
  const [ref, type, flags] = flash;
  const apptRow = appt || (ref ? get(ctx.db, 'SELECT * FROM appointments WHERE ref=?', ref) : null);
  const smsAvail = require('../services/sms-providers').getProvider() !== null;
  const main = html`<div class="pagehead"><div class="wrap"><h1>${ctx.t('ok_received')}</h1></div></div>
    <section class="block"><div class="wrap"><div class="alert alert-ok" role="status"><p>${ctx.t('ok_received_text')}</p>
      ${flags.includes('s') ? html`<p>${ctx.t('ok_slot_held')}</p>` : ''}${flags.includes('i') ? html`<p>${ctx.t('ok_inquiry')}</p>` : ''}</div>
    <p>${ctx.t('ok_ref')}:</p><p><span class="ref">${ref}</span></p><p>${ctx.t('ok_keep')}</p>
    ${flags.includes('m') ? html`<p>${smsAvail ? ctx.t('ok_sms_on') : ctx.t('ok_sms_off')}</p>` : ''}
    ${apptRow ? appointmentReceiptCard(ctx, apptRow) : ''}
    <div class="no-print" style="margin-top:20px">
      <p><a class="btn btn-call" href="/${ctx.lang}/appointment/status">${ctx.t('nav_status')}</a></p>
      <h2>${ctx.t('hospital_phones')}</h2>${U.phoneButtons(ctx)}${U.emergencyBanner(ctx)}
    </div></div></section>`;
  return U.layout(ctx, { title: ctx.t('ok_received'), path: 'appointment/status', main, noindex: true });
}

function statusPage(ctx, { values = {}, error = null, appt = null, changeDone = false, changeError = null } = {}) {
  let detail = '';
  if (appt) {
    const dept = appt.department_id ? get(ctx.db, 'SELECT * FROM departments WHERE id=?', appt.department_id) : null;
    const doc = appt.doctor_id ? get(ctx.db, 'SELECT * FROM doctors WHERE id=? AND published=1 AND active=1', appt.doctor_id) : null;
    const rangeLabel = { morning: 'tr_morning', afternoon: 'tr_afternoon', evening: 'tr_evening', any: 'tr_any' };
    const open = get(ctx.db, "SELECT 1 FROM change_requests WHERE appointment_id=? AND status='open'", appt.id);
    const final = ['Completed', 'Cancelled', 'No-show'].includes(appt.status);
    detail = html`<div class="card" style="max-width:760px"><h2>${appt.ref}</h2>
      <p><strong>${ctx.t('status_now')}:</strong> ${U.apptBadge(ctx, appt.status)}</p>
      <p>${ctx.t('type_' + appt.type)}${dept ? ' — ' + L(ctx, dept, 'name') : ''}</p>
      ${doc ? html`<p><strong>${ctx.t('status_doctor')}:</strong> ${L(ctx, doc, 'name')}</p>` : ''}
      ${appt.slot_start && ['Confirmed', 'Rescheduled'].includes(appt.status) ? html`<p><strong>${ctx.t('status_time')}:</strong> ${fmtDate(appt.slot_start.slice(0, 10))} ${appt.slot_start.slice(11)}</p>` : ''}
      ${appt.preferred_date ? html`<p><strong>${ctx.t('status_pref')}:</strong> ${fmtDate(appt.preferred_date)} (${ctx.t(rangeLabel[appt.preferred_range] || 'tr_any')})</p>` : ''}
      ${appt.status === 'Pending' ? html`<p class="alert alert-info">${ctx.t('ok_received_text')}</p>` : ''}
      <div style="margin-top:12px;margin-bottom:12px">
        <a class="btn btn-primary btn-sm" href="/${ctx.lang}/appointment/receipt?ref=${appt.ref}&mobile=${encodeURIComponent(values.mobile || appt.mobile)}">🧾 ${ctx.t('receipt_view')}</a>
      </div>
      ${U.phoneButtons(ctx)}</div>
      <div style="margin:20px 0">${appointmentReceiptCard(ctx, appt)}</div>
      ${final ? '' : open || changeDone ? html`<div class="alert alert-ok" role="status">${changeDone ? ctx.t('ok_change') : ctx.t('change_open')}</div>` : html`
      <h2>${ctx.t('change_title')}</h2>
      <form class="form" method="post" action="/${ctx.lang}/appointment/status/change" novalidate>${U.csrf(ctx)}
        <input type="hidden" name="ref" value="${appt.ref}"><input type="hidden" name="mobile" value="${values.mobile || ''}">
        ${changeError ? html`<p class="err" role="alert">${ctx.t(changeError)}</p>` : ''}
        ${U.radioGroup(ctx, { name: 'kind', legend: ctx.t('change_title'), required: true, value: 'reschedule', options: [['reschedule', ctx.t('change_resched')], ['cancel', ctx.t('change_cancel')]] })}
        ${U.field(ctx, { name: 'new_date', label: ctx.t('f_date'), type: 'date', attrs: { min: clock.todayIST(), max: clock.addDays(clock.todayIST(), config.maxAdvanceBookingDays) } })}
        ${U.selectField(ctx, { name: 'new_range', label: ctx.t('f_range'), options: rangeOptions(ctx), value: 'any' })}
        ${U.textareaField(ctx, { name: 'note', label: ctx.t('change_note'), rows: 2, maxlength: 300 })}
        <button class="btn btn-primary" type="submit">${ctx.t('f_send')}</button></form>`}`;
  }
  const main = html`<div class="pagehead"><div class="wrap"><h1>${ctx.t('status_title')}</h1><p class="lead">${ctx.t('status_help')}</p></div></div>
    <section class="block"><div class="wrap">
    <form class="form" method="post" action="/${ctx.lang}/appointment/status" novalidate>${U.csrf(ctx)}
      ${error ? html`<p class="alert alert-error" role="alert">${ctx.t(error)}</p>` : ''}
      ${U.field(ctx, { name: 'ref', label: ctx.t('f_ref'), value: values.ref, required: true, attrs: { autocomplete: 'off', maxlength: 20, placeholder: 'SKH-XXXX-XXXX' } })}
      ${U.field(ctx, { name: 'mobile', label: ctx.t('f_mobile'), type: 'tel', value: values.mobile, required: true, attrs: { autocomplete: 'tel', inputmode: 'numeric' } })}
      <button class="btn btn-primary" type="submit">${ctx.t('f_check')}</button></form>
    ${detail}</div></section>`;
  return U.layout(ctx, { title: ctx.t('status_title'), path: 'appointment/status', main, noindex: true });
}

function policyPage(ctx, key, title) {
  const main = html`<div class="pagehead"><div class="wrap"><h1>${title}</h1></div></div><section class="block"><div class="wrap" style="max-width:820px">${U.nl2p(content(ctx, key))}</div></section>`;
  return U.layout(ctx, { title, path: key, main });
}

function notFound(ctx) {
  return U.layout(ctx, { title: ctx.t('page_not_found'), path: '', noindex: true, main: html`<section class="block"><div class="wrap"><h1>${ctx.t('page_not_found')}</h1><p>${ctx.t('page_not_found_text')}</p><a class="btn btn-primary" href="/${ctx.lang}/">${ctx.t('go_home')}</a></div></section>` });
}
function serverError(ctx) {
  return U.layout(ctx, { title: ctx.t('err_500'), path: '', noindex: true, main: html`<section class="block"><div class="wrap"><h1>${ctx.t('err_500')}</h1><p>${ctx.t('err_500_text')}</p>${U.phoneButtons(ctx)}</div></section>` });
}

module.exports = { home, about, departmentsIndex, departmentPage, doctorsPage, contactPage, appointmentPage, diagnosticsPage, successPage, statusPage, receiptPage, appointmentReceiptCard, policyPage, notFound, serverError,
  departments, consultDepartments, publishedDoctors, diagnosticServices, servicesOf, content };
