'use strict';
const { all, get, run } = require('../lib/db');
const clock = require('../lib/clock');
const config = require('../lib/config');
const { safeEqual } = require('../lib/security');
const { getProvider: getSmsProvider } = require('./sms-providers');
const { getProvider: getEmailProvider } = require('./email-providers');
const { getSettings } = require('./settings');

const MAX_ATTEMPTS = 5;
const dmy = (d) => d.split('-').reverse().join('-');

// Short, approved SMS templates. They contain no diagnosis, department or other medical detail.
const TEMPLATES = {
  received: {
    en: (a, h) => `SACHKHAND HOSPITAL: Request ${a.ref} received. It is not confirmed yet; we will contact you. Call ${h.phone1}.`,
    hi: (a, h) => `सचखंड हॉस्पिटल: अनुरोध ${a.ref} प्राप्त हुआ। अभी पुष्टि नहीं हुई है; हम आपसे संपर्क करेंगे। फ़ोन ${h.phone1}।`,
  },
  confirmed: {
    en: (a, h, d, t) => `SACHKHAND HOSPITAL: Appointment ${a.ref} is confirmed for ${d} at ${t}. Call ${h.phone1} for help.`,
    hi: (a, h, d, t) => `सचखंड हॉस्पिटल: अपॉइंटमेंट ${a.ref} की पुष्टि ${d} को ${t} बजे के लिए हुई। सहायता: ${h.phone1}।`,
  },
  rescheduled: {
    en: (a, h, d, t) => `SACHKHAND HOSPITAL: Appointment ${a.ref} is rescheduled to ${d} at ${t}. Call ${h.phone1} for help.`,
    hi: (a, h, d, t) => `सचखंड हॉस्पिटल: अपॉइंटमेंट ${a.ref} का समय बदलकर ${d}, ${t} बजे किया गया है। सहायता: ${h.phone1}।`,
  },
  cancelled: {
    en: (a, h) => `SACHKHAND HOSPITAL: Appointment ${a.ref} is cancelled. Call ${h.phone1} if you need help.`,
    hi: (a, h) => `सचखंड हॉस्पिटल: अपॉइंटमेंट ${a.ref} रद्द कर दिया गया है। सहायता के लिए ${h.phone1} पर फ़ोन करें।`,
  },
  reminder: {
    en: (a, h, d, t) => `SACHKHAND HOSPITAL: Reminder - appointment ${a.ref} on ${d} at ${t}. Call ${h.phone1} for changes.`,
    hi: (a, h, d, t) => `सचखंड हॉस्पिटल: स्मरण - अपॉइंटमेंट ${a.ref}, ${d}, ${t} बजे। बदलाव के लिए ${h.phone1} पर फ़ोन करें।`,
  },
};

const EMAIL_SUBJECTS = {
  received: {
    en: (a) => `SACHKHAND HOSPITAL: Appointment Request Received (${a.ref})`,
    hi: (a) => `सचखंड हॉस्पिटल: अपॉइंटमेंट अनुरोध प्राप्त हुआ (${a.ref})`,
  },
  confirmed: {
    en: (a) => `SACHKHAND HOSPITAL: Appointment Confirmed (${a.ref})`,
    hi: (a) => `सचखंड हॉस्पिटल: अपॉइंटमेंट की पुष्टि (${a.ref})`,
  },
  rescheduled: {
    en: (a) => `SACHKHAND HOSPITAL: Appointment Rescheduled (${a.ref})`,
    hi: (a) => `सचखंड हॉस्पिटल: अपॉइंटमेंट का समय बदला गया (${a.ref})`,
  },
  cancelled: {
    en: (a) => `SACHKHAND HOSPITAL: Appointment Cancelled (${a.ref})`,
    hi: (a) => `सचखंड हॉस्पिटल: अपॉइंटमेंट रद्द किया गया (${a.ref})`,
  },
  reminder: {
    en: (a) => `SACHKHAND HOSPITAL: Appointment Reminder (${a.ref})`,
    hi: (a) => `सचखंड हॉस्पिटल: अपॉइंटमेंट स्मरण (${a.ref})`,
  },
};

const EMAIL_TEMPLATES = {
  received: {
    en: (a, h) => `Dear ${a.patient_name || 'Patient'},

Your appointment request has been received by SACHKHAND HOSPITAL.
Booking Reference: ${a.ref}

Please note: Your appointment is NOT yet confirmed. Our hospital reception will contact you to verify details and confirm the schedule.

Hospital Contact:
Phone: ${h.phone1} / ${h.phone2}
Address: Sarai Road, Mundawar, Rajasthan 301707

Check your status online anytime at:
${config.baseUrl}/en/appointment/status

Thank you,
SACHKHAND HOSPITAL`,
    hi: (a, h) => `प्रिय ${a.patient_name || 'मरीज़'},

सचखंड हॉस्पिटल में आपका अपॉइंटमेंट अनुरोध प्राप्त हो गया है।
बुकिंग संदर्भ संख्या: ${a.ref}

कृपया ध्यान दें: आपकी अपॉइंटमेंट की पुष्टि अभी बाकी है। अस्पताल का स्टाफ आपसे संपर्क करके समय की पुष्टि करेगा।

अस्पताल संपर्क:
फ़ोन: ${h.phone1} / ${h.phone2}
पता: सराय रोड, मुंडावर, राजस्थान 301707

ऑनलाइन स्थिति देखें:
${config.baseUrl}/hi/appointment/status

धन्यवाद,
सचखंड हॉस्पिटल`,
  },
  confirmed: {
    en: (a, h, d, t) => `Dear ${a.patient_name || 'Patient'},

Your appointment at SACHKHAND HOSPITAL is CONFIRMED.
Booking Reference: ${a.ref}
Date: ${d}
Time: ${t}

Please arrive 15 minutes before your scheduled slot. If you need to make any changes, please call us.

Phone: ${h.phone1} / ${h.phone2}
Address: Sarai Road, Mundawar, Rajasthan 301707

Thank you,
SACHKHAND HOSPITAL`,
    hi: (a, h, d, t) => `प्रिय ${a.patient_name || 'मरीज़'},

सचखंड हॉस्पिटल में आपकी अपॉइंटमेंट की पुष्टि हो गई है।
बुकिंग संदर्भ संख्या: ${a.ref}
तिथि: ${d}
समय: ${t} बजे

कृपया अपने निर्धारित समय से 15 मिनट पहले अस्पताल पहुँचें। किसी भी बदलाव के लिए हमें कॉल करें।

फ़ोन: ${h.phone1} / ${h.phone2}
पता: सराय रोड, मुंडावर, राजस्थान 301707

धन्यवाद,
सचखंड हॉस्पिटल`,
  },
  rescheduled: {
    en: (a, h, d, t) => `Dear ${a.patient_name || 'Patient'},

Your appointment at SACHKHAND HOSPITAL has been RESCHEDULED.
Booking Reference: ${a.ref}
New Date: ${d}
New Time: ${t}

Phone: ${h.phone1} / ${h.phone2}
Address: Sarai Road, Mundawar, Rajasthan 301707

Thank you,
SACHKHAND HOSPITAL`,
    hi: (a, h, d, t) => `प्रिय ${a.patient_name || 'मरीज़'},

सचखंड हॉस्पिटल में आपकी अपॉइंटमेंट का समय बदल दिया गया है।
बुकिंग संदर्भ संख्या: ${a.ref}
नई तिथि: ${d}
नया समय: ${t} बजे

फ़ोन: ${h.phone1} / ${h.phone2}
पता: सराय रोड, मुंडावर, राजस्थान 301707

धन्यवाद,
सचखंड हॉस्पिटल`,
  },
  cancelled: {
    en: (a, h) => `Dear ${a.patient_name || 'Patient'},

Your appointment ${a.ref} at SACHKHAND HOSPITAL has been CANCELLED.
If you need further assistance or wish to book a new appointment, please call us at ${h.phone1} or visit our website.

Thank you,
SACHKHAND HOSPITAL`,
    hi: (a, h) => `प्रिय ${a.patient_name || 'मरीज़'},

सचखंड हॉस्पिटल में आपकी अपॉइंटमेंट ${a.ref} रद्द कर दी गई है।
सहायता या नया अपॉइंटमेंट बुक करने के लिए कृपया ${h.phone1} पर कॉल करें या हमारी वेबसाइट देखें।

धन्यवाद,
सचखंड हॉस्पिटल`,
  },
  reminder: {
    en: (a, h, d, t) => `Dear ${a.patient_name || 'Patient'},

This is a friendly reminder for your upcoming appointment at SACHKHAND HOSPITAL.
Booking Reference: ${a.ref}
Date: ${d}
Time: ${t}

Hospital Contact: ${h.phone1}
Sarai Road, Mundawar, Rajasthan 301707

Thank you,
SACHKHAND HOSPITAL`,
    hi: (a, h, d, t) => `प्रिय ${a.patient_name || 'मरीज़'},

सचखंड हॉस्पिटल में आपकी आगामी अपॉइंटमेंट के लिए स्मरण संदेश:
बुकिंग संदर्भ संख्या: ${a.ref}
तिथि: ${d}
समय: ${t} बजे

अस्पताल संपर्क: ${h.phone1}
सराय रोड, मुंडावर, राजस्थान 301707

धन्यवाद,
सचखंड हॉस्पिटल`,
  },
};

function buildBody(db, a, event) {
  const h = getSettings(db);
  const [date, time] = a.slot_start ? a.slot_start.split(' ') : ['', ''];
  return TEMPLATES[event][a.language === 'hi' ? 'hi' : 'en'](a, h, date ? dmy(date) : '', time);
}

function buildEmailSubject(a, event) {
  const lang = a.language === 'hi' ? 'hi' : 'en';
  return EMAIL_SUBJECTS[event][lang](a);
}

function buildEmailBody(db, a, event) {
  const h = getSettings(db);
  const [date, time] = a.slot_start ? a.slot_start.split(' ') : ['', ''];
  const lang = a.language === 'hi' ? 'hi' : 'en';
  return EMAIL_TEMPLATES[event][lang](a, h, date ? dmy(date) : '', time);
}

// Records the SMS notification event. Called only AFTER the database operation committed.
function queueSms(db, a, event) {
  if (!a.sms_consent) return null;
  const key = event === 'reminder' ? `${a.id}:reminder:${(a.slot_start || '').slice(0, 10)}`
    : event === 'confirmed' || event === 'rescheduled' ? `${a.id}:${event}:${a.slot_start || ''}` : `${a.id}:${event}`;
  const configured = !!getSmsProvider();
  const now = clock.sqlNow();
  const r = run(db, `INSERT OR IGNORE INTO notifications(appointment_id,event,channel,to_mobile,language,body,idempotency_key,status,next_attempt_at,created_at,updated_at)
    VALUES (?,?,'sms',?,?,?,?,?,?,?,?)`, a.id, event, a.mobile, a.language, buildBody(db, a, event), key, configured ? 'queued' : 'not_configured', configured ? now : null, now, now);
  return r.changes ? Number(r.lastInsertRowid) : null;
}

// Records the Email notification event. Called only AFTER the database operation committed.
function queueEmail(db, a, event) {
  if (!a.email || (a.email_consent === 0)) return null;
  const key = event === 'reminder' ? `${a.id}:reminder:${(a.slot_start || '').slice(0, 10)}:email`
    : event === 'confirmed' || event === 'rescheduled' ? `${a.id}:${event}:${a.slot_start || ''}:email` : `${a.id}:${event}:email`;
  const configured = !!getEmailProvider();
  const now = clock.sqlNow();
  const subject = buildEmailSubject(a, event);
  const body = buildEmailBody(db, a, event);
  const r = run(db, `INSERT OR IGNORE INTO notifications(appointment_id,event,channel,to_mobile,to_email,subject,language,body,idempotency_key,status,next_attempt_at,created_at,updated_at)
    VALUES (?,?,'email',?,?,?,?,?,?,?,?,?,?)`, a.id, event, a.mobile || '', a.email, subject, a.language, body, key, configured ? 'queued' : 'not_configured', configured ? now : null, now, now);
  return r.changes ? Number(r.lastInsertRowid) : null;
}

function queueNotifications(db, a, event) {
  const smsId = queueSms(db, a, event);
  const emailId = queueEmail(db, a, event);
  return { smsId, emailId };
}

async function dispatchDue(db, { limit = 25 } = {}) {
  const smsProvider = getSmsProvider();
  const emailProvider = getEmailProvider();
  if (!smsProvider && !emailProvider) return { attempted: 0 };
  const now = clock.sqlNow();
  const staleCutoff = new Date(clock.now().getTime() - 5 * 60e3).toISOString().replace('T', ' ').slice(0, 19);
  // A worker that died mid-send leaves 'sending' rows; return them to the retry queue.
  run(db, "UPDATE notifications SET status='retry', next_attempt_at=?, updated_at=? WHERE status='sending' AND updated_at<?", now, now, staleCutoff);
  const due = all(db, "SELECT id, channel FROM notifications WHERE status IN ('queued','retry') AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY id LIMIT ?", now, limit);
  let attempted = 0;
  for (const { id, channel } of due) {
    const isEmail = channel === 'email';
    const provider = isEmail ? emailProvider : smsProvider;
    if (!provider) continue; // skip if provider for this specific channel is not configured

    // Atomic claim: only one dispatcher can move a row to 'sending'
    const claim = run(db, "UPDATE notifications SET status='sending', attempts=attempts+1, updated_at=? WHERE id=? AND status IN ('queued','retry')", now, id);
    if (claim.changes !== 1) continue;
    attempted++;
    const n = get(db, 'SELECT * FROM notifications WHERE id=?', id);
    let res;
    try {
      if (isEmail) {
        res = await provider.send({ to: n.to_email, subject: n.subject, body: n.body, reference: n.idempotency_key });
      } else {
        res = await provider.send({ to: n.to_mobile, body: n.body, reference: n.idempotency_key });
      }
    } catch (e) {
      res = { ok: false, temporary: true, error: String(e.message || e).slice(0, 200) };
    }
    const t = clock.sqlNow();
    if (res.ok) {
      run(db, 'UPDATE notifications SET status=?, provider=?, provider_message_id=?, error=NULL, updated_at=? WHERE id=?',
        res.simulated ? 'simulated' : 'submitted', provider.name, res.messageId || null, t, id);
    } else if (res.temporary && n.attempts < MAX_ATTEMPTS) {
      const wait = new Date(clock.now().getTime() + Math.min(2 ** n.attempts, 60) * 60e3).toISOString().replace('T', ' ').slice(0, 19);
      run(db, "UPDATE notifications SET status='retry', next_attempt_at=?, error=?, provider=?, updated_at=? WHERE id=?", wait, res.error || 'temporary error', provider.name, t, id);
    } else {
      run(db, "UPDATE notifications SET status='failed', error=?, provider=?, updated_at=? WHERE id=?", res.error || 'failed', provider.name, t, id);
    }
  }
  return { attempted };
}

// Gateway delivery callback. Only a gateway report can mark a message delivered.
function handleDeliveryCallback(db, { messageId, status, error }) {
  if (!messageId) return false;
  const n = get(db, 'SELECT * FROM notifications WHERE provider_message_id=?', String(messageId));
  if (!n) return false;
  const t = clock.sqlNow();
  if (status === 'delivered' && ['submitted', 'sending', 'failed'].includes(n.status))
    run(db, "UPDATE notifications SET status='delivered', delivered_at=?, error=NULL, updated_at=? WHERE id=?", t, t, n.id);
  else if (status === 'failed' && ['submitted', 'sending'].includes(n.status))
    run(db, "UPDATE notifications SET status='failed', error=?, updated_at=? WHERE id=?", String(error || 'delivery failed').slice(0, 200), t, n.id);
  else return false;
  return true;
}
const webhookAuthorized = (given, expected) => !!expected && !!given && safeEqual(given, expected);

function queueReminders(db) {
  const smsOk = !!getSmsProvider() && getSettings(db).sms_reminders_enabled === '1';
  const emailOk = !!getEmailProvider();
  if (!smsOk && !emailOk) return 0;
  const tomorrow = clock.addDays(clock.todayIST(), 1);
  let n = 0;
  for (const a of all(db, "SELECT * FROM appointments WHERE status IN ('Confirmed','Rescheduled') AND slot_start LIKE ?", tomorrow + ' %')) {
    if (smsOk && a.sms_consent) { if (queueSms(db, a, 'reminder')) n++; }
    if (emailOk && a.email && a.email_consent !== 0) { if (queueEmail(db, a, 'reminder')) n++; }
  }
  return n;
}

function retryFailed(db, id) {
  return run(db, "UPDATE notifications SET status='retry', attempts=0, next_attempt_at=?, updated_at=? WHERE id=? AND status='failed'", clock.sqlNow(), clock.sqlNow(), id).changes === 1;
}

// Fire-and-forget dispatch after a request commits (disabled in tests that drive dispatch manually).
const state = { auto: true };
function dispatchSoon(db) { if (state.auto) setImmediate(() => dispatchDue(db).catch((e) => console.error('notification dispatch', e))); }

module.exports = {
  state,
  dispatchSoon,
  queueSms,
  queueEmail,
  queueNotifications,
  dispatchDue,
  handleDeliveryCallback,
  webhookAuthorized,
  queueReminders,
  retryFailed,
  buildBody,
  buildEmailSubject,
  buildEmailBody,
  MAX_ATTEMPTS,
  getProvider: getSmsProvider, // for backward compatibility with existing tests
};
