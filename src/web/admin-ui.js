'use strict';
const U = require('./ui');
const { html, raw, esc } = U;

const PERMS = {
  admin: ['appointments.view', 'appointments.manage', 'appointments.export', 'doctors.view', 'doctors.manage', 'services.manage', 'content.manage', 'settings.manage', 'reports.view', 'audit.view', 'notifications.manage', 'inquiries.manage'],
  receptionist: ['appointments.view', 'appointments.manage', 'doctors.view', 'inquiries.manage'],
  clinician: ['appointments.view', 'appointments.clinical'],
};
const can = (user, perm) => !!user && (user.role === 'super_admin' || (PERMS[user.role] || []).includes(perm));
const ROLE_LABEL = { super_admin: 'Super administrator', admin: 'Hospital administrator', receptionist: 'Receptionist', clinician: 'Doctor / clinical staff' };

const NAV = [
  ['/admin', 'Dashboard', null], ['/admin/appointments', 'Appointments', 'appointments.view'], ['/admin/inquiries', 'Inquiries', 'inquiries.manage'],
  ['/admin/doctors', 'Doctors', 'doctors.view'], ['/admin/services', 'Departments & services', 'services.manage'], ['/admin/content', 'Page content', 'content.manage'],
  ['/admin/faqs', 'FAQs', 'content.manage'], ['/admin/announcements', 'Announcements', 'content.manage'], ['/admin/holidays', 'Holidays', 'content.manage'],
  ['/admin/settings', 'Hospital settings', 'settings.manage'], ['/admin/reports', 'Reports', 'reports.view'], ['/admin/notifications', 'SMS log', 'notifications.manage'],
  ['/admin/audit', 'Audit log', 'audit.view'], ['/admin/users', 'Staff accounts', 'users.manage'], ['/admin/account', 'My account', null],
];

function adminLayout(ctx, { title, main, active }) {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${title} | Admin — SACHKHAND HOSPITAL</title>
<link rel="icon" href="/static/img/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Noto+Sans+Devanagari:wght@400;600;700&display=swap">
<link rel="stylesheet" href="/static/css/style.css?v=1"><script src="/static/js/app.js" defer></script></head><body class="lang-en admin">
<div class="admin-shell"><aside class="admin-side no-print"><h2>SACHKHAND HOSPITAL<br><small>Admin</small></h2>
<nav aria-label="Admin">${NAV.filter(([, , p]) => !p || can(ctx.user, p)).map(([href, label]) => html`<a href="${href}" ${active === href ? raw('aria-current="page"') : ''}>${label}</a>`)}</nav>
<form method="post" action="/admin/logout" style="margin-top:20px">${U.csrf(ctx)}<button class="btn btn-outline btn-sm" type="submit">Sign out</button></form>
<p style="font-size:.8rem;margin-top:14px">${ctx.user.name}<br>${ROLE_LABEL[ctx.user.role]}</p></aside>
<main class="admin-main" id="main" tabindex="-1"><h1>${title}</h1>${flashBox(ctx)}${main}</main></div></body></html>`;
}

const OK_MSG = { saved: 'Saved.', done: 'Done.', created: 'Created.', deleted: 'Deleted.' };
function flashBox(ctx) {
  const { ok, err } = ctx.query;
  const errText = err && ctx.t(err).startsWith('⟦') ? null : err && ctx.t(err);
  return html`${ok && OK_MSG[ok] ? html`<div class="alert alert-ok" role="status">${OK_MSG[ok]}</div>` : ''}${errText ? html`<div class="alert alert-error" role="alert">${errText}</div>` : ''}${err && !errText && ctx.query.m ? html`<div class="alert alert-error" role="alert">${String(ctx.query.m).slice(0, 200)}</div>` : ''}`;
}
const errorsBox = (list) => (list && list.length ? html`<div class="alert alert-error" role="alert" id="error-summary" tabindex="-1"><ul>${list.map((e) => html`<li>${e}</li>`)}</ul></div>` : '');

function table(headers, rows, empty = 'Nothing to show.') {
  return rows.length ? html`<div class="tablewrap"><table><thead><tr>${headers.map((h) => html`<th scope="col">${h}</th>`)}</tr></thead><tbody>${rows.map((r) => html`<tr>${r.map((c) => html`<td>${c}</td>`)}</tr>`)}</tbody></table></div>` : html`<p>${empty}</p>`;
}
const opts = (list, sel) => list.map(([v, l]) => html`<option value="${v}" ${String(v) === String(sel ?? '') ? raw('selected') : ''}>${l}</option>`);
const yesNo = (name, label, checked) => html`<div class="field"><label class="check"><input type="checkbox" name="${name}" value="1" ${checked ? raw('checked') : ''}> <span>${label}</span></label></div>`;
const csvCell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

module.exports = { PERMS, can, ROLE_LABEL, adminLayout, errorsBox, table, opts, yesNo, csvCell, flashBox };
