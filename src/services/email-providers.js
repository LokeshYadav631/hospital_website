'use strict';
// Email provider abstraction. A provider exposes: name, send({to, subject, body, reference}) -> Promise<result>
//   result = { ok: true, messageId, simulated? } | { ok: false, temporary: boolean, error }
// "ok" means the mail gateway or relay accepted the message.
const config = require('../lib/config');

let override; // tests can inject a provider (undefined = use config, null = force disabled)
function setProvider(p) { override = p; }

const consoleProvider = {
  name: 'console',
  async send({ to, subject, body, reference }) {
    console.log(`[EMAIL:console] to=${to} subject="${subject}" ref=${reference}\n${body}`);
    return { ok: true, messageId: `console-email-${reference}`, simulated: true };
  },
};

const httpProvider = {
  name: 'http',
  async send({ to, subject, body, reference }) {
    try {
      const headers = { 'content-type': 'application/json' };
      if (config.email.token) headers.authorization = `Bearer ${config.email.token}`;
      const payload = {
        from: config.email.from || 'SACHKHAND HOSPITAL <appointments@sachkhandhospital.org>',
        to,
        subject,
        text: body,
        reference,
      };
      const res = await fetch(config.email.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 429 || res.status >= 500) return { ok: false, temporary: true, error: `HTTP ${res.status}` };
      if (!res.ok) return { ok: false, temporary: false, error: `HTTP ${res.status}` };
      let j = {};
      try { j = await res.json(); } catch { /* gateway returned no JSON */ }
      return { ok: true, messageId: String(j.message_id || j.messageId || j.id || '') || null };
    } catch (e) {
      return { ok: false, temporary: true, error: String(e.message || e).slice(0, 200) };
    }
  },
};

function getProvider() {
  if (override !== undefined) return override;
  switch (config.email.provider) {
    case 'console': return config.production ? null : consoleProvider;
    case 'http': return config.email.url ? httpProvider : null;
    default: return null;
  }
}

module.exports = { getProvider, setProvider, httpProvider, consoleProvider };
