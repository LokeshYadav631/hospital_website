'use strict';
const http = require('http');
const config = require('../lib/config');
const sec = require('../lib/security');
const { t } = require('../i18n/strings');
const { Router, readBody, parseBody, buildCtx, serveStatic } = require('./http');
const registerPublic = require('./public-routes');
const registerAdmin = require('./admin-routes');
const notifications = require('../services/notifications');
const views = require('./public-views');
const { getContent } = require('../services/settings');

function createApp(db) {
  const router = new Router();
  registerPublic(router);
  registerAdmin(router);

  async function handle(req, res) {
    let ctx;
    try {
      ctx = buildCtx(db, req, res);
      const origin = req.headers.origin;
      if (origin && config.allowedOrigins.length) {
        if (config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin)) {
          ctx.extraHeaders['Access-Control-Allow-Origin'] = origin;
          ctx.extraHeaders['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
          ctx.extraHeaders['Access-Control-Allow-Headers'] = 'Content-Type, X-CSRF-Token, Authorization';
          ctx.extraHeaders['Access-Control-Allow-Credentials'] = 'true';
        }
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, ctx.extraHeaders);
        res.end();
        return;
      }
      const pathname = ctx.url.pathname;
      if (pathname.startsWith('/static/')) { if (serveStatic(ctx, pathname)) return; return ctx.send(404, 'Not found', 'text/plain'); }
      const m = router.match(req.method === 'HEAD' ? 'GET' : req.method, pathname);
      if (!m) return router.notFound(ctx);
      ctx.params = m.params;
      if (req.method === 'POST') {
        const raw = await readBody(req);
        ctx.body = parseBody(raw, req.headers['content-type']);
        if (m.route.opts.csrf !== false && !sec.csrfOk(ctx.pc, ctx.body._csrf)) {
          const lang = /^\/hi(\/|$)/.test(pathname) || ctx.cookies.lang === 'hi' ? 'hi' : 'en';
          return ctx.send(403, t(lang, 'e_csrf'), 'text/plain; charset=utf-8');
        }
      }
      if (pathname.startsWith('/admin')) ctx.user = sec.getSession(db, ctx.cookies.sid);
      await m.route.handler(ctx);
    } catch (e) {
      if (e && e.status === 413) { try { res.writeHead(413); res.end('Request too large'); } catch { /* ignore */ } return; }
      console.error('Unhandled error:', e && e.stack || e);
      try {
        if (res.headersSent) return res.end();
        if (ctx) { ctx.content = getContent(db); const m = /^\/(en|hi)\//.exec(ctx.url.pathname + '/'); ctx.setLang(m ? m[1] : 'en'); return ctx.html(views.serverError(ctx), 500); }
        res.writeHead(500); res.end('Server error');
      } catch { /* ignore */ }
    }
  }

  const server = http.createServer(handle);
  server.requestTimeout = 30000; server.headersTimeout = 15000;
  let timers = [];
  server.startBackground = () => {
    // Dispatch queued SMS every 30s (no-op while SMS is not configured) and queue reminders hourly.
    timers.push(setInterval(() => notifications.dispatchDue(db).catch((e) => console.error('sms dispatch', e)), 30000).unref());
    timers.push(setInterval(() => { try { notifications.queueReminders(db); } catch (e) { console.error('reminders', e); } }, 3600e3).unref());
    timers.push(setInterval(() => { try { db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString()); } catch { /* ignore */ } }, 3600e3).unref());
  };
  server.stopBackground = () => { timers.forEach(clearInterval); timers = []; };
  return server;
}
module.exports = { createApp };
