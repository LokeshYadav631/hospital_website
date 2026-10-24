'use strict';
const { html, raw, esc, jsonForScript } = require('../lib/html');
const config = require('../lib/config');

const telHref = (n) => 'tel:+91' + String(n).replace(/\D/g, '').replace(/^0/, '');
const nl2p = (text) => String(text || '').split(/\n\s*\n/).filter(Boolean).map((p) => html`<p>${p}</p>`);

const badge = (ctx, status) => html`<span class="badge sv-${status}">${ctx.t('sv_' + status)}</span>`;
const apptBadge = (ctx, status) => html`<span class="badge st-${status.replace(/[^a-z]/gi, '')}">${ctx.t('st_' + status)}</span>`;

const csrf = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;

function errorSummary(ctx, errors, labels = {}) {
  const keys = Object.keys(errors || {});
  if (!keys.length) return '';
  return html`<div class="alert alert-error" role="alert" tabindex="-1" id="error-summary">
    <strong>${ctx.t('e_title')}</strong>
    <ul>${keys.map((k) => html`<li><a href="#f-${k}">${labels[k] ? labels[k] + ': ' : ''}${ctx.t(errors[k])}</a></li>`)}</ul></div>`;
}
const describedBy = (name, error, help) => [error ? `err-${name}` : '', help ? `help-${name}` : ''].filter(Boolean).join(' ') || null;
const errP = (ctx, name, error) => (error ? html`<p class="err" id="err-${name}">${ctx.t(error)}</p>` : '');
const reqMark = (ctx, required) => (required ? html` <span class="req" aria-hidden="true">*</span><span class="sr-only"> (${ctx.t('required_mark')})</span>` : '');

function field(ctx, { name, label, type = 'text', value = '', error, required, help, attrs = {} }) {
  const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  return html`<div class="field ${error ? 'has-error' : ''}">
    <label for="f-${name}">${label}${reqMark(ctx, required)}</label>
    ${help ? html`<p class="help" id="help-${name}">${help}</p>` : ''}
    <input id="f-${name}" name="${name}" type="${type}" value="${value ?? ''}" ${required ? raw('required') : ''} ${error ? raw('aria-invalid="true"') : ''} ${describedBy(name, error, help) ? raw(`aria-describedby="${describedBy(name, error, help)}"`) : ''}${raw(a)}>
    ${errP(ctx, name, error)}</div>`;
}
function selectField(ctx, { name, label, options, value = '', error, required, attrs = {}, help }) {
  const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  return html`<div class="field ${error ? 'has-error' : ''}">
    <label for="f-${name}">${label}${reqMark(ctx, required)}</label>
    ${help ? html`<p class="help" id="help-${name}">${help}</p>` : ''}
    <select id="f-${name}" name="${name}" ${required ? raw('required') : ''} ${error ? raw('aria-invalid="true"') : ''} ${describedBy(name, error, help) ? raw(`aria-describedby="${describedBy(name, error, help)}"`) : ''}${raw(a)}>
      ${options.map((o) => html`<option value="${o[0]}" ${String(o[0]) === String(value ?? '') ? raw('selected') : ''}${o[2] ? raw(` data-dept="${esc(o[2])}"`) : ''}>${o[1]}</option>`)}
    </select>${errP(ctx, name, error)}</div>`;
}
function textareaField(ctx, { name, label, value = '', error, required, help, rows = 3, maxlength = 500 }) {
  return html`<div class="field ${error ? 'has-error' : ''}">
    <label for="f-${name}">${label}${reqMark(ctx, required)}</label>
    ${help ? html`<p class="help" id="help-${name}">${help}</p>` : ''}
    <textarea id="f-${name}" name="${name}" rows="${rows}" maxlength="${maxlength + 1}" ${required ? raw('required') : ''} ${error ? raw('aria-invalid="true"') : ''} ${describedBy(name, error, help) ? raw(`aria-describedby="${describedBy(name, error, help)}"`) : ''}>${value ?? ''}</textarea>
    ${errP(ctx, name, error)}</div>`;
}
function radioGroup(ctx, { name, legend, options, value = '', error, required }) {
  return html`<fieldset class="field ${error ? 'has-error' : ''}" id="f-${name}"><legend>${legend}${reqMark(ctx, required)}</legend>
    <div class="radios">${options.map((o, i) => html`<label class="radio"><input type="radio" name="${name}" value="${o[0]}" ${String(o[0]) === String(value) ? raw('checked') : ''} ${required && i === 0 ? raw('required') : ''}> ${o[1]}</label>`)}</div>
    ${errP(ctx, name, error)}</fieldset>`;
}
const checkbox = (ctx, { name, label, checked }) => html`<div class="field"><label class="check"><input type="checkbox" name="${name}" value="1" ${checked ? raw('checked') : ''}> <span>${label}</span></label></div>`;

const emergencyBanner = (ctx) => html`<div class="alert alert-emergency" role="note"><strong>${ctx.t('emergency_title')}.</strong> ${ctx.t('emergency_text')}</div>`;
const disclaimer = (ctx) => html`<aside class="notice" aria-label="${ctx.t('disclaimer_title')}"><strong>${ctx.t('disclaimer_title')}:</strong> ${ctx.t('disclaimer_text')}</aside>`;
const phoneButtons = (ctx, cls = '') => html`<div class="phones ${cls}">
  <a class="btn btn-call" href="${telHref(ctx.settings.phone1)}">☎ ${ctx.settings.phone1}</a>
  <a class="btn btn-call" href="${telHref(ctx.settings.phone2)}">☎ ${ctx.settings.phone2}</a></div>`;

function localized(ctx, row, base) { return row[`${base}_${ctx.lang}`] || row[`${base}_en`] || ''; }
const other = (lang) => (lang === 'en' ? 'hi' : 'en');

function layout(ctx, { title, desc, path, main, jsonld, noindex }) {
  const { lang, settings: s } = ctx;
  const name = s[`hospital_name_${lang}`] || s.hospital_name_en;
  const fullTitle = title ? `${title} | ${name}` : `${name} — ${s['tagline_' + lang]}`;
  const base = config.baseUrl;
  const nav = [['', 'nav_home'], ['about', 'nav_about'], ['departments', 'nav_departments'], ['doctors', 'nav_doctors'], ['diagnostics', 'nav_diagnostics'], ['contact', 'nav_contact']];
  const here = (p) => (p === (path || '').split('/')[0] ? ' aria-current="page"' : '');
  return html`<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${desc || ctx.bi('SACHKHAND HOSPITAL, Mundawar, Rajasthan. Departments, diagnostics and appointment requests.', 'सचखंड हॉस्पिटल, मुंडावर, राजस्थान। विभाग, जाँच सेवाएँ और अपॉइंटमेंट अनुरोध।')}">
${noindex ? raw('<meta name="robots" content="noindex">') : ''}
<link rel="canonical" href="${base}/${lang}/${path || ''}">
<link rel="alternate" hreflang="en" href="${base}/en/${path || ''}"><link rel="alternate" hreflang="hi" href="${base}/hi/${path || ''}"><link rel="alternate" hreflang="x-default" href="${base}/en/${path || ''}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${name}"><meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${desc || s['tagline_' + lang]}"><meta property="og:url" content="${base}/${lang}/${path || ''}"><meta property="og:locale" content="${lang === 'hi' ? 'hi_IN' : 'en_IN'}">
<meta name="theme-color" content="#123C8C">
<link rel="icon" href="/static/img/logo.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Noto+Sans+Devanagari:wght@400;600;700&display=swap">
<link rel="stylesheet" href="/static/css/style.css?v=1">
<script src="/static/js/app.js" defer></script>
${jsonld ? html`<script type="application/ld+json">${jsonForScript(jsonld)}</script>` : ''}
</head><body class="lang-${lang}">
<a class="skip" href="#main">${ctx.t('skip')}</a>
<div class="topbar"><div class="wrap topbar-in">
  <span>${ctx.t('hospital_phones')}: <a href="${telHref(s.phone1)}">${s.phone1}</a> · <a href="${telHref(s.phone2)}">${s.phone2}</a></span>
  <div class="topbar-right">
    ${s.facebook_url ? html`<a href="${esc(s.facebook_url)}" target="_blank" rel="noopener noreferrer" class="social-link" title="Facebook" aria-label="Facebook"><span>📘</span> Facebook</a>` : ''}
    ${s.instagram_url ? html`<a href="${esc(s.instagram_url)}" target="_blank" rel="noopener noreferrer" class="social-link" title="Instagram" aria-label="Instagram"><span>📸</span> Instagram</a>` : ''}
    <a class="langswitch" lang="${other(lang)}" hreflang="${other(lang)}" href="/${other(lang)}/${path || ''}" data-lang="${other(lang)}">${ctx.t('lang_switch')}</a>
  </div>
</div></div>
<header class="site-header"><div class="wrap header-in">
  <a class="brand" href="/${lang}/"><img src="/static/img/hospital-logo.jpg" alt="${name}" width="52" height="52" class="brand-logo" style="border-radius:50%;object-fit:cover;box-shadow:0 1px 4px rgba(0,0,0,0.15)"><span class="brand-text"><strong>${name}</strong><small>${s['tagline_' + lang]}</small></span></a>
  <button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav">${ctx.t('menu')}</button>
  <nav id="site-nav" class="site-nav" aria-label="Main">
    <ul>${nav.map(([p, k]) => html`<li><a href="/${lang}/${p}"${raw(here(p))}>${ctx.t(k)}</a></li>`)}
    <li><a href="/${lang}/appointment/status"${raw(here('appointment'))}>${ctx.t('nav_status')}</a></li></ul>
    <a class="btn btn-primary" href="/${lang}/appointment">${ctx.t('book')}</a>
  </nav>
  <div class="header-trust"><a href="/${lang}/about" title="${s['trust_name_' + lang]}"><img src="/static/img/trust-logo.png" alt="${s['trust_name_' + lang]}" width="50" height="50" style="object-fit:contain" class="trust-logo"></a></div>
</div></header>
<main id="main" tabindex="-1">${main}</main>
<footer class="site-footer"><div class="wrap footer-in">
  <div><strong>${name}</strong><p>${ctx.t('footer_managed')}: ${s['trust_name_' + lang]}</p><p>${s['address_' + lang]}</p></div>
  <div>
    <p>☎ <a href="${telHref(s.phone1)}">${s.phone1}</a></p>
    <p>☎ <a href="${telHref(s.phone2)}">${s.phone2}</a></p>
    ${s.facebook_url || s.instagram_url ? html`<div class="footer-social" style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
      ${s.facebook_url ? html`<a href="${esc(s.facebook_url)}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.12);padding:4px 10px;border-radius:6px;text-decoration:none;font-size:0.9rem">📘 Facebook</a>` : ''}
      ${s.instagram_url ? html`<a href="${esc(s.instagram_url)}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.12);padding:4px 10px;border-radius:6px;text-decoration:none;font-size:0.9rem">📸 Instagram</a>` : ''}
    </div>` : ''}
  </div>
  <div><p><a href="/${lang}/privacy">${ctx.t('footer_privacy')}</a></p><p><a href="/${lang}/terms">${ctx.t('footer_terms')}</a></p><p><a href="/${lang}/departments">${ctx.t('nav_departments')}</a></p></div>
</div><div class="wrap copy">© ${new Date().getFullYear()} ${name}. ${ctx.t('footer_rights')}</div></footer>
</body></html>`;
}

module.exports = { telHref, nl2p, badge, apptBadge, csrf, errorSummary, field, selectField, textareaField, radioGroup, checkbox, emergencyBanner, disclaimer, phoneButtons, localized, layout, other, html, raw, esc };
