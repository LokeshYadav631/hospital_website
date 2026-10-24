'use strict';
const { all, get, run } = require('../lib/db');

const getSettings = (db) => Object.fromEntries(all(db, 'SELECT key,value FROM hospital_settings').map((r) => [r.key, r.value]));
const setSetting = (db, key, value) => run(db, 'INSERT INTO hospital_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value ?? ''));
const getContent = (db) => Object.fromEntries(all(db, 'SELECT * FROM website_content').map((r) => [r.key, r]));

function audit(db, user, action, entity, entityId, detail, ip) {
  run(db, 'INSERT INTO audit_logs(user_id,user_email,action,entity,entity_id,detail,ip) VALUES (?,?,?,?,?,?,?)',
    user ? user.id : null, user ? user.email : null, action, entity || null, entityId == null ? null : String(entityId), detail ? String(detail).slice(0, 500) : null, ip || null);
}
const isHoliday = (db, date) => get(db, 'SELECT * FROM holidays WHERE date=?', date) || null;

module.exports = { getSettings, setSetting, getContent, audit, isHoliday };
