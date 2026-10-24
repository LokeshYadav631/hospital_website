'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../lib/config');
const sec = require('../lib/security');
const { getSession } = sec;
const { t } = require('../i18n/strings');
const { getSettings } = require('../services/settings');

const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
const PUBLIC_DIR = path.join(config.ROOT, 'public');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
};
if (config.cookieSecure) SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler, opts = {}) {
    const keys = [];
    // ':lang' only matches en|hi so it can never shadow /admin, /api, /healthz ...
    const re = new RegExp('^' + pattern.replace(/:([a-z_]+)/g, (_, k) => { keys.push(k); return k === 'lang' ? '(en|hi)' : '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler, opts });
  }
  get(p, h, o) { this.add('GET', p, h, o); }
  post(p, h, o) { this.add('POST', p, h, o); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
  hasPath(pathname) { return this.routes.some((r) => r.re.test(pathname)); }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > config.maxBodyBytes) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function parseBody(raw, type) {
  if (/json/.test(type || '')) { try { return JSON.parse(raw || '{}'); } catch { return {}; } }
  const out = {};
  for (const [k, v] of new URLSearchParams(raw)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (k in out) out[k] = [].concat(out[k], v); else out[k] = v; // repeated keys -> array (e.g. checkbox groups)
  }
  return out;
}
const clientIp = (req) => {
  if (config.trustProxy) { const f = req.headers['x-forwarded-for']; if (f) return String(f).split(',')[0].trim(); }
  return req.socket.remoteAddress || '0.0.0.0';
};

function buildCtx(db, req, res) {
  const url = new URL(req.url, 'http://localhost');
  const cookies = sec.parseCookies(req.headers.cookie);
  const ctx = {
    db, req, res, url, query: Object.fromEntries(url.searchParams), cookies, ip: clientIp(req), method: req.method,
    setCookies: [], extraHeaders: {}, params: {}, body: {}, user: null, lang: 'en',
  };
  ctx.pc = cookies.pc;
  if (!ctx.pc || !/^[A-Za-z0-9_-]{20,64}$/.test(ctx.pc)) { ctx.pc = sec.token(24); ctx.setCookies.push(sec.serializeCookie('pc', ctx.pc, { maxAge: 86400 * 30 })); }
  ctx.csrf = sec.csrfFor(ctx.pc);
  ctx.cookie = (name, value, o) => ctx.setCookies.push(sec.serializeCookie(name, value, o));
  ctx.send = (status, body, type = 'text/html; charset=utf-8') => {
    const headers = { ...SECURITY_HEADERS, 'Content-Type': type, ...ctx.extraHeaders };
    if (type.startsWith('text/html')) headers['Cache-Control'] = 'no-store';
    if (ctx.setCookies.length) headers['Set-Cookie'] = ctx.setCookies;
    res.writeHead(status, headers); res.end(String(body));
  };
  ctx.html = (page, status = 200) => ctx.send(status, page.toString());
  ctx.json = (obj, status = 200) => { ctx.extraHeaders['Cache-Control'] = 'no-store'; ctx.send(status, JSON.stringify(obj), 'application/json; charset=utf-8'); };
  ctx.redirect = (loc, status = 303) => { const headers = { ...SECURITY_HEADERS, Location: loc, 'Cache-Control': 'no-store' }; if (ctx.setCookies.length) headers['Set-Cookie'] = ctx.setCookies; res.writeHead(status, headers); res.end(); };
  ctx.setLang = (lang) => {
    ctx.lang = lang;
    ctx.t = (k) => t(lang, k);
    ctx.bi = (en, hi) => (lang === 'hi' ? hi : en);
  };
  ctx.setLang('en');
  ctx.settings = getSettings(db);
  return ctx;
}

function serveStatic(ctx, pathname) {
  const rel = pathname.replace(/^\/static\//, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  if (!MIME[ext]) return false;
  ctx.res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[ext], 'Cache-Control': 'public, max-age=3600' });
  ctx.res.end(fs.readFileSync(file));
  return true;
}

module.exports = { Router, readBody, parseBody, buildCtx, serveStatic, SECURITY_HEADERS, getSession };
