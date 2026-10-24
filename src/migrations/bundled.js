'use strict';
const fs = require('fs');
const path = require('path');

// Read migrations from disk if available, or export bundled strings
let migrations = [];

try {
  const dir = __dirname;
  const f1 = path.join(dir, '001_init.sql');
  const f2 = path.join(dir, '002_email_notifications.sql');
  const f3 = path.join(dir, '003_doctor_sort.sql');
  if (fs.existsSync(f1)) {
    migrations = [
      { name: '001_init.sql', sql: fs.readFileSync(f1, 'utf8') },
      { name: '002_email_notifications.sql', sql: fs.readFileSync(f2, 'utf8') },
      { name: '003_doctor_sort.sql', sql: fs.readFileSync(f3, 'utf8') },
    ];
  }
} catch {
  // fallback below
}

if (!migrations.length) {
  // Hardcoded bundled fallback for environments where .sql files are omitted from lambda bundle
  migrations = [
    {
      name: '001_init.sql',
      sql: `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin','admin','receptionist','clinician')),
  doctor_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL, name_hi TEXT NOT NULL,
  desc_en TEXT NOT NULL, desc_hi TEXT NOT NULL,
  note_en TEXT, note_hi TEXT,
  status TEXT NOT NULL DEFAULT 'to_be_confirmed',
  form_type TEXT NOT NULL DEFAULT 'consultation',
  hours_en TEXT, hours_hi TEXT,
  is_facility INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  translation_reviewed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name_en TEXT NOT NULL, name_hi TEXT NOT NULL,
  desc_en TEXT, desc_hi TEXT,
  status TEXT NOT NULL DEFAULT 'to_be_confirmed',
  is_diagnostic INTEGER NOT NULL DEFAULT 0,
  hours_en TEXT, hours_hi TEXT,
  prep_en TEXT, prep_hi TEXT,
  prep_approved INTEGER NOT NULL DEFAULT 0,
  closure_note_en TEXT, closure_note_hi TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  translation_reviewed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_services_dept ON services(department_id);

CREATE TABLE IF NOT EXISTS doctors (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL, name_hi TEXT,
  photo_url TEXT,
  qualifications_en TEXT, qualifications_hi TEXT,
  specialization_en TEXT, specialization_hi TEXT,
  registration_no TEXT,
  show_registration INTEGER NOT NULL DEFAULT 0,
  experience_years INTEGER,
  languages TEXT,
  bio_en TEXT, bio_hi TEXT,
  consultation_fee INTEGER,
  fee_approved INTEGER NOT NULL DEFAULT 0,
  slot_minutes INTEGER NOT NULL DEFAULT 15,
  verified INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  translation_reviewed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctor_departments (
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (doctor_id, department_id)
);

CREATE TABLE IF NOT EXISTS doctor_schedules (
  id INTEGER PRIMARY KEY,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL,
  start_time TEXT NOT NULL, end_time TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sched_doctor ON doctor_schedules(doctor_id, weekday);

CREATE TABLE IF NOT EXISTS doctor_unavailability (
  id INTEGER PRIMARY KEY,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL, name_hi TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id),
  service_id INTEGER REFERENCES services(id),
  doctor_id INTEGER REFERENCES doctors(id),
  inquiry_only INTEGER NOT NULL DEFAULT 0,
  patient_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  age INTEGER, dob TEXT, gender TEXT,
  email TEXT,
  patient_type TEXT,
  preferred_date TEXT,
  preferred_range TEXT,
  slot_start TEXT,
  slot_end TEXT,
  reason TEXT,
  referring_doctor TEXT, has_referral TEXT, notes TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  sms_consent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending',
  cancel_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_appt_status ON appointments(status, created_at);
CREATE INDEX IF NOT EXISTS idx_appt_doctor ON appointments(doctor_id, slot_start);
CREATE INDEX IF NOT EXISTS idx_appt_dept ON appointments(department_id);
CREATE INDEX IF NOT EXISTS idx_appt_mobile ON appointments(mobile);
CREATE UNIQUE INDEX IF NOT EXISTS uq_doctor_slot ON appointments(doctor_id, slot_start)
  WHERE doctor_id IS NOT NULL AND slot_start IS NOT NULL AND status IN ('Pending','Confirmed','Rescheduled');

CREATE TABLE IF NOT EXISTS appointment_status_history (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  from_status TEXT, to_status TEXT NOT NULL,
  note TEXT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hist_appt ON appointment_status_history(appointment_id);

CREATE TABLE IF NOT EXISTS change_requests (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  new_date TEXT, new_range TEXT, note TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, mobile TEXT NOT NULL, email TEXT,
  department_id INTEGER REFERENCES departments(id),
  message TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  event TEXT NOT NULL,
  to_mobile TEXT NOT NULL,
  language TEXT NOT NULL,
  body TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  provider TEXT, provider_message_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notif_status ON notifications(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_notif_provider_id ON notifications(provider_message_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT,
  action TEXT NOT NULL,
  entity TEXT, entity_id TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY,
  q_en TEXT NOT NULL, q_hi TEXT NOT NULL,
  a_en TEXT NOT NULL, a_hi TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY,
  title_en TEXT NOT NULL, title_hi TEXT NOT NULL,
  body_en TEXT, body_hi TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS website_content (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  en TEXT NOT NULL DEFAULT '', hi TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 1,
  translation_reviewed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hospital_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`
    },
    {
      name: '002_email_notifications.sql',
      sql: `
ALTER TABLE appointments ADD COLUMN email_consent INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notifications ADD COLUMN channel TEXT NOT NULL DEFAULT 'sms';
ALTER TABLE notifications ADD COLUMN to_email TEXT;
ALTER TABLE notifications ADD COLUMN subject TEXT;
CREATE INDEX IF NOT EXISTS idx_notif_channel ON notifications(channel, status);
`
    },
    {
      name: '003_doctor_sort.sql',
      sql: `
ALTER TABLE doctors ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_doctors_sort ON doctors(sort, active, published);
`
    }
  ];
}

module.exports = migrations;
