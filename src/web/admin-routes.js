'use strict';
const { all, get, run, tx } = require('../lib/db');
const config = require('../lib/config');
const sec = require('../lib/security');
const V = require('../lib/validation');
const clock = require('../lib/clock');
const U = require('./ui');
const { html, raw } = U;
const A = require('./admin-ui');
const { can } = A;
const appts = require('../services/appointments');
const slots = require('../services/slots');
const notifications = require('../services/notifications');
const { getSettings, setSetting, audit } = require('../services/settings');
const { getProvider } = require('../services/sms-providers');
const registerAdmin2 = require('./admin-routes2');

const STATUSES = ['Pending', 'Confirmed', 'Rescheduled', 'Completed', 'Cancelled', 'No-show'];

module.exports = function register(router) {
  // Guard: signed-in + permission. Unauthenticated -> login. Unauthorized -> 403.
  const G = (perm, handler) => async (ctx) => {
    ctx.setLang('en');
    ctx.extraHeaders['Cache-Control'] = 'no-store';
    if (!ctx.user) return ctx.redirect('/admin/login');
    if (perm && !can(ctx.user, perm)) return ctx.html(A.adminLayout(ctx, { title: 'Access denied', main: html`<p class="alert alert-error">You do not have permission to view this page.</p>` }), 403);
    return handler(ctx);
  };
  router.G = G;

  // ---------- login / logout ----------
  const loginPage = (ctx, error, email = '') => ctx.html(html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow">
    <title>Staff sign in | SACHKHAND HOSPITAL</title><link rel="stylesheet" href="/static/css/style.css?v=1"></head><body class="lang-en"><main class="wrap" style="max-width:460px;padding:40px 18px">
    <h1>Staff sign in</h1><p>SACHKHAND HOSPITAL administration</p>
    <form class="form" method="post" action="/admin/login">${U.csrf(ctx)}
      ${error ? html`<p class="alert alert-error" role="alert">${error}</p>` : ''}
      ${U.field(ctx, { name: 'email', label: 'Email', type: 'email', value: email, required: true, attrs: { autocomplete: 'username' } })}
      ${U.field(ctx, { name: 'password', label: 'Password', type: 'password', required: true, attrs: { autocomplete: 'current-password' } })}
      <button class="btn btn-primary" type="submit">Sign in</button></form></main></body></html>`, error ? 401 : 200);

  router.get('/admin/login', (ctx) => { ctx.setLang('en'); if (ctx.user) return ctx.redirect('/admin'); ctx.user = sec.getSession(ctx.db, ctx.cookies.sid); return ctx.user ? ctx.redirect('/admin') : loginPage(ctx); });
  router.post('/admin/login', async (ctx) => {
    ctx.setLang('en');
    const email = V.str(ctx.body.email, 254).toLowerCase(), password = String(ctx.body.password || '');
    if (!sec.rateLimit(`login:${ctx.ip}`, 10, 15 * 60e3)) return loginPage(ctx, 'Too many sign-in attempts. Please wait 15 minutes.', email);
    const u = get(ctx.db, 'SELECT * FROM users WHERE email=?', email);
    const locked = u && u.locked_until && u.locked_until > clock.now().toISOString();
    const ok = await sec.verifyPassword(password, u ? u.password_hash : 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'); // constant-ish time whether or not user exists
    if (!u || !u.active || locked || !ok) {
      if (u && !locked) {
        const n = u.failed_logins + 1;
        run(ctx.db, 'UPDATE users SET failed_logins=?, locked_until=? WHERE id=?', n, n >= 5 ? new Date(clock.now().getTime() + 15 * 60e3).toISOString() : null, u.id);
      }
      audit(ctx.db, null, 'login.failed', 'user', null, `email=${email.slice(0, 80)}`, ctx.ip);
      return loginPage(ctx, locked ? 'Account temporarily locked. Try again later.' : 'Invalid email or password.', email);
    }
    run(ctx.db, 'UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?', u.id);
    const s = sec.createSession(ctx.db, u.id, ctx.ip);
    ctx.cookie('sid', s.token, { maxAge: config.sessionHours * 3600, sameSite: 'Strict' });
    audit(ctx.db, u, 'login.success', 'user', u.id, null, ctx.ip);
    ctx.redirect('/admin');
  });
  router.post('/admin/logout', (ctx) => {
    if (ctx.user) audit(ctx.db, ctx.user, 'logout', 'user', ctx.user.id, null, ctx.ip);
    sec.destroySession(ctx.db, ctx.cookies.sid);
    ctx.cookie('sid', '', { maxAge: 0, sameSite: 'Strict' });
    ctx.redirect('/admin/login');
  });

  // ---------- dashboard ----------
  const scope = (ctx) => (ctx.user.role === 'clinician' ? { sql: ' AND a.doctor_id = ?', p: [ctx.user.doctor_id || 0] } : { sql: '', p: [] });
  router.get('/admin', G(null, (ctx) => {
    const db = ctx.db, sc = scope(ctx), today = clock.todayIST(), now = `${today} ${clock.nowTimeIST()}`;
    const n = (extra, ...p) => get(db, `SELECT COUNT(*) c FROM appointments a WHERE 1=1 ${sc.sql} ${extra}`, ...sc.p, ...p).c;
    const stats = [
      ["Today's requests", n("AND date(a.created_at,'+330 minutes')=?", today)], ['Pending requests', n("AND a.status='Pending'")],
      ['Confirmed', n("AND a.status='Confirmed'")], ['Upcoming consultations', n("AND a.type='consultation' AND a.status IN ('Confirmed','Rescheduled') AND a.slot_start>=?", now)],
      ['Diagnostic requests (pending)', n("AND a.type='diagnostic' AND a.status='Pending'")], ['Completed', n("AND a.status='Completed'")], ['Cancelled', n("AND a.status='Cancelled'")],
    ];
    const extra = [];
    if (can(ctx.user, 'notifications.manage')) extra.push(['SMS delivery failures', get(db, "SELECT COUNT(*) c FROM notifications WHERE status='failed'").c]);
    if (can(ctx.user, 'inquiries.manage')) extra.push(['New inquiries', get(db, "SELECT COUNT(*) c FROM inquiries WHERE status='new'").c], ['Open patient change requests', get(db, "SELECT COUNT(*) c FROM change_requests WHERE status='open'").c]);
    const byDept = all(db, `SELECT COALESCE(d.name_en,'—') n, COUNT(*) c FROM appointments a LEFT JOIN departments d ON d.id=a.department_id WHERE 1=1 ${sc.sql} GROUP BY d.id ORDER BY c DESC`, ...sc.p);
    const sms = getProvider();
    ctx.html(A.adminLayout(ctx, { title: 'Dashboard', active: '/admin', main: html`
      <div class="stats">${[...stats, ...extra].map(([l, v]) => html`<div class="stat"><b>${v}</b>${l}</div>`)}</div>
      <p class="alert ${sms ? 'alert-ok' : 'alert-info'}">SMS: ${sms ? `provider "${sms.name}" configured` : 'not configured — no SMS will be sent; patients see their booking reference on screen.'}</p>
      <h2>Requests by department</h2>${A.table(['Department', 'Requests'], byDept.map((r) => [r.n, r.c]))}` }));
  }));

  // ---------- appointments ----------
  function filters(ctx) {
    const q = ctx.query, where = [], p = [], sc = scope(ctx);
    let sql = `FROM appointments a LEFT JOIN departments d ON d.id=a.department_id LEFT JOIN doctors dr ON dr.id=a.doctor_id LEFT JOIN services s ON s.id=a.service_id WHERE 1=1${sc.sql}`;
    p.push(...sc.p);
    const add = (c, ...v) => { where.push(c); p.push(...v); };
    if (q.q) { const like = `%${String(q.q).trim().slice(0, 60)}%`; add('(a.ref LIKE ? OR a.patient_name LIKE ?)', like, like); }
    if (STATUSES.includes(q.status)) add('a.status=?', q.status);
    if (['consultation', 'diagnostic'].includes(q.type)) add('a.type=?', q.type);
    if (Number(q.dept)) add('a.department_id=?', Number(q.dept));
    if (Number(q.doctor)) add('a.doctor_id=?', Number(q.doctor));
    if (clock.isDate(q.from)) add('COALESCE(substr(a.slot_start,1,10),a.preferred_date)>=?', q.from);
    if (clock.isDate(q.to)) add('COALESCE(substr(a.slot_start,1,10),a.preferred_date)<=?', q.to);
    return { sql: sql + (where.length ? ' AND ' + where.join(' AND ') : ''), p };
  }
  const apptSelect = 'SELECT a.*, d.name_en AS dept, dr.name_en AS doctor, s.name_en AS service';

  router.get('/admin/appointments', G('appointments.view', (ctx) => {
    const f = filters(ctx), q = ctx.query;
    const rows = all(ctx.db, `${apptSelect} ${f.sql} ORDER BY a.created_at DESC, a.id DESC LIMIT 200`, ...f.p);
    const clin = ctx.user.role === 'clinician';
    ctx.html(A.adminLayout(ctx, { title: 'Appointments', active: '/admin/appointments', main: html`
      <form class="filters no-print" method="get" action="/admin/appointments">
        <div class="field"><label for="f-q">Reference / name</label><input id="f-q" name="q" value="${q.q || ''}"></div>
        <div class="field"><label for="f-status">Status</label><select id="f-status" name="status"><option value="">All</option>${A.opts(STATUSES.map((s) => [s, s]), q.status)}</select></div>
        <div class="field"><label for="f-type">Type</label><select id="f-type" name="type"><option value="">All</option>${A.opts([['consultation', 'Consultation'], ['diagnostic', 'Diagnostic']], q.type)}</select></div>
        <div class="field"><label for="f-dept">Department</label><select id="f-dept" name="dept"><option value="">All</option>${A.opts(all(ctx.db, 'SELECT id,name_en FROM departments ORDER BY sort').map((d) => [d.id, d.name_en]), q.dept)}</select></div>
        <div class="field"><label for="f-doctor">Doctor</label><select id="f-doctor" name="doctor"><option value="">All</option>${A.opts(all(ctx.db, 'SELECT id,name_en FROM doctors ORDER BY name_en').map((d) => [d.id, d.name_en]), q.doctor)}</select></div>
        <div class="field"><label for="f-from">From date</label><input id="f-from" type="date" name="from" value="${q.from || ''}"></div>
        <div class="field"><label for="f-to">To date</label><input id="f-to" type="date" name="to" value="${q.to || ''}"></div>
        <button class="btn btn-primary btn-sm" type="submit">Filter</button>
        ${can(ctx.user, 'appointments.export') ? html`<a class="btn btn-call btn-sm" href="/admin/appointments.csv?${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([k]) => ['q', 'status', 'type', 'dept', 'doctor', 'from', 'to'].includes(k))))}">Export CSV</a>` : ''}</form>
      ${A.table(['Reference', 'Patient', clin ? 'Age' : 'Mobile', 'Type', 'Department / service', 'Doctor', 'Requested / confirmed', 'Status', ''],
        rows.map((r) => [r.ref, r.patient_name, clin ? (r.age ?? '') : r.mobile, r.type, `${r.dept || ''}${r.service ? ' / ' + r.service : ''}${r.inquiry_only ? ' (inquiry)' : ''}`, r.doctor || '—',
          r.slot_start ? `${r.slot_start} (confirmed/held)` : `${r.preferred_date || ''} ${r.preferred_range || ''}`, U.apptBadge(ctx, r.status), html`<a href="/admin/appointments/${r.id}">Open</a>`]), 'No appointments match.')}
      <p class="help">Showing up to 200 most recent matches.</p>` }));
  }));

  router.get('/admin/appointments.csv', G('appointments.export', (ctx) => {
    const f = filters(ctx);
    const rows = all(ctx.db, `${apptSelect} ${f.sql} ORDER BY a.created_at DESC LIMIT 5000`, ...f.p);
    const head = ['reference', 'type', 'status', 'department', 'service', 'doctor', 'patient_name', 'mobile', 'age', 'gender', 'preferred_date', 'preferred_range', 'slot_start', 'created_at_utc'];
    const lines = [head.join(',')].concat(rows.map((r) => [r.ref, r.type, r.status, r.dept, r.service, r.doctor, r.patient_name, r.mobile, r.age, r.gender, r.preferred_date, r.preferred_range, r.slot_start, r.created_at].map(A.csvCell).join(',')));
    audit(ctx.db, ctx.user, 'appointments.export', 'appointment', null, `${rows.length} rows`, ctx.ip);
    ctx.extraHeaders['Content-Disposition'] = `attachment; filename="appointments-${clock.todayIST()}.csv"`;
    ctx.send(200, '\ufeff' + lines.join('\r\n'), 'text/csv; charset=utf-8');
  }));

  const loadAppt = (ctx) => {
    const sc = scope(ctx);
    return get(ctx.db, `${apptSelect} ${'FROM appointments a LEFT JOIN departments d ON d.id=a.department_id LEFT JOIN doctors dr ON dr.id=a.doctor_id LEFT JOIN services s ON s.id=a.service_id'} WHERE a.id=?${sc.sql}`, Number(ctx.params.id), ...sc.p);
  };
  const notFoundAdmin = (ctx) => ctx.html(A.adminLayout(ctx, { title: 'Not found', main: html`<p>Record not found.</p>` }), 404);

  function apptDetail(ctx, a, print) {
    const db = ctx.db, clin = ctx.user.role === 'clinician', manage = can(ctx.user, 'appointments.manage');
    const hist = all(db, 'SELECT h.*, u.name AS who FROM appointment_status_history h LEFT JOIN users u ON u.id=h.actor_user_id WHERE appointment_id=? ORDER BY h.id', a.id);
    const notifs = clin ? [] : all(db, 'SELECT * FROM notifications WHERE appointment_id=? ORDER BY id', a.id);
    const changes = clin ? [] : all(db, 'SELECT * FROM change_requests WHERE appointment_id=? ORDER BY id DESC', a.id);
    const dl = (k, v) => html`<tr><th scope="row" style="width:220px">${k}</th><td>${v ?? '—'}</td></tr>`;
    const info = html`<div class="tablewrap"><table><tbody>
      ${dl('Reference', a.ref)}${dl('Status', U.apptBadge(ctx, a.status))}${dl('Type', a.type + (a.inquiry_only ? ' (inquiry — service availability unconfirmed)' : ''))}
      ${dl('Department', a.dept)}${dl('Service', a.service)}${dl('Doctor', a.doctor)}${dl('Patient', a.patient_name)}${clin ? '' : dl('Mobile', a.mobile)}${clin ? '' : dl('Email', a.email)}
      ${dl('Age / DOB', [a.age, a.dob].filter((x) => x != null).join(' / '))}${dl('Gender', a.gender)}${dl('Patient type', a.patient_type)}
      ${dl('Requested date', a.preferred_date)}${dl('Preferred time of day', a.preferred_range)}${dl('Confirmed / held slot', a.slot_start)}
      ${dl('Reason', a.reason)}${dl('Referring doctor', a.referring_doctor)}${dl('Referral', a.has_referral)}${dl('Notes', a.notes)}
      ${dl('Language / SMS consent', `${a.language} / ${a.sms_consent ? 'yes' : 'no'}`)}${a.cancel_reason ? dl('Cancellation reason', a.cancel_reason) : ''}${dl('Received (UTC)', a.created_at)}
    </tbody></table></div>`;
    if (print) return info;

    const eligible = a.department_id ? all(db, `SELECT d.id,d.name_en FROM doctors d JOIN doctor_departments dd ON dd.doctor_id=d.id WHERE dd.department_id=? AND d.active=1 AND d.published=1 ORDER BY d.name_en`, a.department_id) : [];
    const live = !['Completed', 'Cancelled', 'No-show'].includes(a.status);
    const slotDate = clock.isDate(ctx.query.slot_date) ? ctx.query.slot_date : null;
    const open = slotDate && a.doctor_id ? slots.slotsFor(db, a.doctor_id, slotDate, { ignoreAppointmentId: a.id }) : null;
    const [sd, st] = a.slot_start ? a.slot_start.split(' ') : [a.preferred_date || '', ''];
    const act = (action, label, extra, cls = 'btn-primary') => html`<form method="post" action="/admin/appointments/${a.id}/action" class="inline">${U.csrf(ctx)}<input type="hidden" name="action" value="${action}">${extra || ''}<button class="btn ${cls} btn-sm" type="submit">${label}</button></form>`;
    const clinical = can(ctx.user, 'appointments.clinical') && !manage && a.status !== 'Pending' && ['Confirmed', 'Rescheduled'].includes(a.status);
    const controls = !live ? '' : html`<h2 class="no-print">Actions</h2><div class="no-print">
      ${manage && a.type === 'consultation' && ['Pending', 'Rescheduled'].includes(a.status) ? html`<form method="post" action="/admin/appointments/${a.id}/action" class="form" style="margin-bottom:14px">${U.csrf(ctx)}<input type="hidden" name="action" value="assign">
        <div class="field"><label for="f-doctor_id">Assign verified doctor</label><select id="f-doctor_id" name="doctor_id" required><option value="">Choose…</option>${A.opts(eligible.map((d) => [d.id, d.name_en]), a.doctor_id)}</select>
        ${eligible.length ? '' : html`<p class="help">No published doctor is assigned to this department yet. Add one under Doctors.</p>`}</div><button class="btn btn-primary btn-sm" type="submit">Assign doctor</button></form>` : ''}
      ${manage ? html`${a.doctor_id ? html`<form method="get" action="/admin/appointments/${a.id}" class="filters"><div class="field"><label for="f-slot_date">Check open slots on</label><input id="f-slot_date" type="date" name="slot_date" value="${slotDate || ''}"></div><button class="btn btn-call btn-sm" type="submit">Show slots</button></form>
        ${open ? html`<p>${open.length ? `Open slots on ${slotDate}: ${open.join(', ')}` : `No open slots for this doctor on ${slotDate}.`}</p>` : ''}` : ''}
        <form method="post" action="/admin/appointments/${a.id}/action" class="form" style="margin-bottom:14px">${U.csrf(ctx)}
          <div class="row"><div class="field"><label for="f-date">Date</label><input id="f-date" type="date" name="date" value="${sd}"></div><div class="field"><label for="f-time">Time (HH:MM, IST)</label><input id="f-time" type="time" name="time" value="${st}"></div></div>
          <div class="field"><label for="f-note">Note (optional)</label><input id="f-note" name="note" maxlength="200"></div>
          <div class="actions-row">${['Pending', 'Rescheduled'].includes(a.status) ? html`<button class="btn btn-primary btn-sm" name="action" value="confirm" type="submit">Confirm</button>` : ''}
          <button class="btn btn-call btn-sm" name="action" value="reschedule" type="submit">Reschedule</button></div>
          ${a.type === 'consultation' && !a.doctor_id ? html`<p class="help">Assign a doctor before confirming or rescheduling a consultation.</p>` : ''}</form>
        <form method="post" action="/admin/appointments/${a.id}/action" class="form" style="margin-bottom:14px">${U.csrf(ctx)}<input type="hidden" name="action" value="cancel">
          <div class="field"><label for="f-reason">Cancellation reason (required)</label><input id="f-reason" name="reason" maxlength="300" required></div><button class="btn btn-danger btn-sm" type="submit">Cancel appointment</button></form>` : ''}
      ${(manage || clinical) && ['Confirmed', 'Rescheduled'].includes(a.status) ? html`<div class="actions-row">${act('complete', 'Mark completed', '', 'btn-primary')}${act('noshow', 'Mark no-show', '', 'btn-call')}</div>` : ''}</div>`;

    return html`${info}${controls}
      ${changes.length ? html`<h2>Patient change requests</h2>${A.table(['Kind', 'Requested', 'Note', 'Status', ''], changes.map((c) => [c.kind, `${c.new_date || ''} ${c.new_range || ''}`, c.note, c.status,
        c.status === 'open' && manage ? html`<form method="post" action="/admin/changes/${c.id}/handle" class="inline">${U.csrf(ctx)}<button class="btn btn-call btn-sm" type="submit">Mark handled</button></form>` : '']))}` : ''}
      <h2>Status history</h2>${A.table(['When (UTC)', 'From', 'To', 'Note', 'By'], hist.map((h) => [h.created_at, h.from_status || '—', h.to_status, h.note, h.who || 'Patient/system']))}
      ${clin ? '' : html`<h2>Notifications (SMS & Email)</h2>${A.table(['Event', 'Channel', 'Recipient', 'Status', 'Attempts', 'Provider id', 'Error'], notifs.map((n) => [n.event, n.channel || 'sms', (n.channel === 'email' ? n.to_email : n.to_mobile) || '—', n.status, n.attempts, n.provider_message_id, n.error]), (a.sms_consent || a.email) ? 'No notification events recorded.' : 'Patient did not request notifications.')}`}`;
  }

  router.get('/admin/appointments/:id', G('appointments.view', (ctx) => {
    const a = loadAppt(ctx); if (!a) return notFoundAdmin(ctx);
    ctx.html(A.adminLayout(ctx, { title: `Appointment ${a.ref}`, active: '/admin/appointments', main: html`<p class="no-print"><a href="/admin/appointments">← All appointments</a> · <a href="/admin/appointments/${a.id}/print" target="_blank">Print</a></p>${apptDetail(ctx, a)}` }));
  }));
  router.get('/admin/appointments/:id/print', G('appointments.view', (ctx) => {
    const a = loadAppt(ctx); if (!a) return notFoundAdmin(ctx);
    audit(ctx.db, ctx.user, 'appointment.print', 'appointment', a.id, null, ctx.ip);
    ctx.html(A.adminLayout(ctx, { title: `Appointment ${a.ref}`, active: '/admin/appointments', main: html`${apptDetail(ctx, a, true)}<p class="no-print"><button class="btn btn-primary" data-print type="button">Print</button></p><p>SACHKHAND HOSPITAL · ${ctx.settings.phone1} · ${ctx.settings.phone2}</p>` }));
  }));
  router.post('/admin/appointments/:id/action', G('appointments.view', (ctx) => {
    const a = loadAppt(ctx); if (!a) return notFoundAdmin(ctx);
    const action = String(ctx.body.action || '');
    const manage = can(ctx.user, 'appointments.manage');
    const clinicalOk = can(ctx.user, 'appointments.clinical') && ['complete', 'noshow'].includes(action);
    if (!manage && !clinicalOk) return ctx.html(A.adminLayout(ctx, { title: 'Access denied', main: html`<p class="alert alert-error">You do not have permission to perform this action.</p>` }), 403);
    try {
      const r = appts.changeStatusAndNotify(ctx.db, { id: a.id, action, user: ctx.user, ip: ctx.ip, note: V.str(ctx.body.note, 200), doctor_id: ctx.body.doctor_id, date: V.str(ctx.body.date, 10), time: V.str(ctx.body.time, 5), reason: V.str(ctx.body.reason, 300) });
      notifications.dispatchSoon(ctx.db);
      ctx.redirect(`/admin/appointments/${a.id}?ok=done`);
    } catch (e) {
      if (e instanceof appts.BookingError) return ctx.redirect(`/admin/appointments/${a.id}?err=${encodeURIComponent(e.code)}`);
      throw e;
    }
  }));
  router.post('/admin/changes/:id/handle', G('appointments.manage', (ctx) => {
    const c = get(ctx.db, 'SELECT * FROM change_requests WHERE id=?', Number(ctx.params.id));
    if (!c) return notFoundAdmin(ctx);
    run(ctx.db, "UPDATE change_requests SET status='handled' WHERE id=?", c.id);
    audit(ctx.db, ctx.user, 'change_request.handled', 'change_request', c.id, null, ctx.ip);
    ctx.redirect(`/admin/appointments/${c.appointment_id}?ok=done`);
  }));

  registerAdmin2(router, { G, notFoundAdmin });
};
