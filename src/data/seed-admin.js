'use strict';
const crypto = require('crypto');
const { get, run } = require('../lib/db');

function seedAdmin(db) {
  if (process.env.NODE_ENV === 'test') return;
  try {
    const row = get(db, "SELECT COUNT(*) c FROM users WHERE role='super_admin'");
    if (row && row.c > 0) return;

    const email = (process.env.ADMIN_EMAIL || 'admin@sachkhandhospital.org').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'Sachkhand@2026';
    const name = process.env.ADMIN_NAME || 'Hospital Administrator';

    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    const hash = `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;

    run(db, "INSERT INTO users(email, name, password_hash, role) VALUES (?, ?, ?, 'super_admin')", email, name, hash);
    console.log(`[Bootstrap] Initial super administrator ready: ${email}`);
  } catch (err) {
    console.error('[Bootstrap] Failed to seed initial administrator:', err.message);
  }
}

module.exports = { seedAdmin };
