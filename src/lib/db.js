'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

function open(file) {
  let targetFile = file;
  if (targetFile !== ':memory:') {
    try {
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    } catch {
      // If filesystem is read-only (e.g. /var/task on Vercel), fallback to os.tmpdir()
      targetFile = path.join(os.tmpdir(), 'hospital.db');
      try { fs.mkdirSync(path.dirname(targetFile), { recursive: true }); } catch { /* ignore */ }
    }
  }
  let db;
  try {
    db = new DatabaseSync(targetFile);
  } catch (err) {
    if (targetFile !== ':memory:' && !targetFile.startsWith(os.tmpdir())) {
      targetFile = path.join(os.tmpdir(), 'hospital.db');
      db = new DatabaseSync(targetFile);
    } else {
      throw err;
    }
  }
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (targetFile !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  return db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const dir = path.join(__dirname, '..', 'migrations');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const applied = [];

  let list = [];
  if (fs.existsSync(dir)) {
    try {
      list = fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort().map((f) => ({
        name: f,
        sql: fs.readFileSync(path.join(dir, f), 'utf8')
      }));
    } catch {
      // fallback to bundled below
    }
  }
  if (!list.length) {
    try {
      list = require('../migrations/bundled');
    } catch {
      // ignore
    }
  }

  for (const item of list) {
    if (done.has(item.name)) continue;
    db.exec('BEGIN');
    try {
      db.exec(item.sql);
      db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(item.name);
      db.exec('COMMIT');
      applied.push(item.name);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${item.name} failed: ${e.message}`);
    }
  }
  return applied;
}

const clean = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const all = (db, sql, ...p) => db.prepare(sql).all(...clean(p));
const get = (db, sql, ...p) => db.prepare(sql).get(...clean(p));
const run = (db, sql, ...p) => db.prepare(sql).run(...clean(p));

// Serialised write transaction: BEGIN IMMEDIATE takes the write lock up-front, so
// "check availability then insert" cannot interleave with another writer.
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  }
}
const isUniqueViolation = (e) => /UNIQUE constraint failed/i.test(String(e && e.message));

module.exports = { open, migrate, all, get, run, tx, isUniqueViolation };
