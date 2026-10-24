'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const config = require('./config');
const { get, run } = require('./db');
const clock = require('./clock');
const scrypt = promisify(crypto.scrypt);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (s) => crypto.createHmac('sha256', config.secret).update(s).digest('hex');
const token = (n = 32) => crypto.randomBytes(n).toString('base64url');
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- passwords (scrypt, per-user salt) ----------
const SCRYPT = { N: 16384, r: 8, p: 1 };
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  try {
    const [alg, s, k] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const key = await scrypt(pw, Buffer.from(s, 'base64'), 64, SCRYPT);
    const want = Buffer.from(k, 'base64');
    return key.length === want.length && crypto.timingSafeEqual(key, want);
  } catch { return false; }
}
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 12) return 'Password must be at least 12 characters.';
  if (pw.length > 200) return 'Password is too long.';
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and at least one digit.';
  return null;
}

// ---------- sessions (opaque random token; only its hash is stored) ----------
function createSession(db, userId, ip) {
  const t = token(32);
  const exp = new Date(clock.now().getTime() + config.sessionHours * 3600e3).toISOString();
  run(db, 'INSERT INTO sessions(token_hash,user_id,expires_at,ip) VALUES (?,?,?,?)', sha256(t), userId, exp, ip);
  return { token: t, expires: exp };
}
function getSession(db, t) {
  if (!t) return null;
  const row = get(db, `SELECT s.token_hash, s.expires_at, u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`, sha256(t));
  if (!row || !row.active) return null;
  if (row.expires_at < clock.now().toISOString()) { run(db, 'DELETE FROM sessions WHERE token_hash=?', row.token_hash); return null; }
  return row;
}
const destroySession = (db, t) => t && run(db, 'DELETE FROM sessions WHERE token_hash=?', sha256(t));
const destroyUserSessions = (db, userId) => run(db, 'DELETE FROM sessions WHERE user_id=?', userId);

// ---------- CSRF: HMAC bound to the visitor's anonymous cookie ----------
const csrfFor = (pc) => hmac('csrf:' + pc);
const csrfOk = (pc, given) => !!pc && !!given && safeEqual(csrfFor(pc), given);

// signed short-lived value (used for the post-submit "flash" cookie)
function sign(value) { return `${value}.${hmac('sign:' + value).slice(0, 32)}`; }
function unsign(s) {
  const i = String(s || '').lastIndexOf('.');
  if (i < 1) return null;
  const v = s.slice(0, i);
  return safeEqual(sign(v), s) ? v : null;
}

// ---------- rate limiting (in-memory sliding window; single instance) ----------
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return false; }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 20000) for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k);
  return true;
}
const resetRateLimits = () => buckets.clear();

// ---------- cookies ----------
function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ } }
  }
  return out;
}
function serializeCookie(name, value, o = {}) {
  let s = `${name}=${encodeURIComponent(value)}; Path=${o.path || '/'}; SameSite=${o.sameSite || 'Lax'}`;
  if (o.httpOnly !== false) s += '; HttpOnly';
  if (config.cookieSecure) s += '; Secure';
  if (o.maxAge !== undefined) s += `; Max-Age=${o.maxAge}`;
  return s;
}

module.exports = {
  sha256, hmac, token, safeEqual, hashPassword, verifyPassword, passwordProblem,
  createSession, getSession, destroySession, destroyUserSessions,
  csrfFor, csrfOk, sign, unsign, rateLimit, resetRateLimits, parseCookies, serializeCookie,
};
