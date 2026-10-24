'use strict';
const { get, run, tx } = require('../lib/db');
const seedData = require('./seed-data');

// Idempotent: only inserts what is missing; never overwrites admin edits.
function seed(db) {
  tx(db, () => {
    seedData.departments.forEach((d, i) => {
      if (get(db, 'SELECT 1 FROM departments WHERE slug=?', d.slug)) return;
      const r = run(db, `INSERT INTO departments(slug,name_en,name_hi,desc_en,desc_hi,note_en,note_hi,status,form_type,is_facility,sort)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`, d.slug, d.name_en, d.name_hi, d.desc_en, d.desc_hi, d.note_en || null, d.note_hi || null,
        seedData.STATUS_DEFAULT, d.form_type || 'consultation', d.is_facility || 0, i + 1);
      d.services.forEach((s, j) => run(db, `INSERT INTO services(department_id,name_en,name_hi,status,is_diagnostic,sort) VALUES (?,?,?,?,?,?)`,
        r.lastInsertRowid, s.name_en, s.name_hi, seedData.STATUS_DEFAULT, s.is_diagnostic || 0, j + 1));
    });
    if (!get(db, 'SELECT 1 FROM faqs LIMIT 1'))
      seedData.faqs.forEach((f, i) => run(db, 'INSERT INTO faqs(q_en,q_hi,a_en,a_hi,sort) VALUES (?,?,?,?,?)', f[0], f[1], f[2], f[3], i + 1));
    for (const [key, label, en, hi] of seedData.content)
      run(db, 'INSERT OR IGNORE INTO website_content(key,label,en,hi) VALUES (?,?,?,?)', key, label, en, hi);
    for (const [k, v] of Object.entries(seedData.settings))
      run(db, 'INSERT OR IGNORE INTO hospital_settings(key,value) VALUES (?,?)', k, v);
  });
}
module.exports = { seed };
