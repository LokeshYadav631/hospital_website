'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');

// Minimal .env loader (no dependency). Real environment variables always win.
(function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();

const env = process.env;
const production = env.NODE_ENV === 'production';

let secret = env.SESSION_SECRET;
if (!secret) {
  if (production) {
    console.error('FATAL: SESSION_SECRET must be set in production.');
    process.exit(1);
  }
  secret = crypto.randomBytes(32).toString('hex'); // dev only: sessions reset on restart
}
if (production && secret.length < 32) {
  console.error('FATAL: SESSION_SECRET must be at least 32 characters.');
  process.exit(1);
}

const config = {
  ROOT,
  production,
  port: Number(env.PORT || 3000),
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  dbPath: path.resolve(ROOT, env.DATABASE_PATH || './data/hospital.db'),
  secret,
  trustProxy: env.TRUST_PROXY === '1',
  cookieSecure: production || (env.BASE_URL || '').startsWith('https://'),
  sms: {
    provider: (env.SMS_PROVIDER || 'none').toLowerCase(),
    url: env.SMS_HTTP_URL || '',
    token: env.SMS_HTTP_TOKEN || '',
    senderId: env.SMS_SENDER_ID || '',
    webhookSecret: env.SMS_WEBHOOK_SECRET || '',
  },
  email: {
    provider: (env.EMAIL_PROVIDER || 'none').toLowerCase(),
    url: env.EMAIL_HTTP_URL || '',
    token: env.EMAIL_HTTP_TOKEN || '',
    from: env.EMAIL_FROM || 'SACHKHAND HOSPITAL <appointments@sachkhandhospital.org>',
    webhookSecret: env.EMAIL_WEBHOOK_SECRET || '',
  },
  timezone: 'Asia/Kolkata',
  sessionHours: 8,
  maxBodyBytes: 100 * 1024,
  maxAdvanceBookingDays: 90,
  slotWindowDays: 30,
};

module.exports = config;
