'use strict';
// SMS provider abstraction. A provider exposes: name, send({to, body, reference}) -> Promise<result>
//   result = { ok: true, messageId, simulated? } | { ok: false, temporary: boolean, error }
// "ok" ONLY means the gateway accepted the message. Delivery is confirmed separately by callback.
const config = require('../lib/config');

let override; // tests can inject a provider (undefined = use config, null = force disabled)
function setProvider(p) { override = p; }

const consoleProvider = {
  name: 'console',
  async send({ to, body, reference }) {
    console.log(`[SMS:console] to=${to} ref=${reference} :: ${body}`);
    return { ok: true, messageId: `console-${reference}`, simulated: true };
  },
};

const httpProvider = {
  name: 'http',
  async send({ to, body, reference }) {
    try {
      const res = await fetch(config.sms.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.sms.token}` },
        body: JSON.stringify({ to: `+91${to}`, message: body, sender_id: config.sms.senderId || undefined, reference }),
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
  switch (config.sms.provider) {
    case 'console': return config.production ? null : consoleProvider;
    case 'http': return config.sms.url && config.sms.token ? httpProvider : null;
    default: return null;
  }
}
module.exports = { getProvider, setProvider, httpProvider, consoleProvider };
