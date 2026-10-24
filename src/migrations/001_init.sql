-- SACHKHAND HOSPITAL: initial schema (SQLite). Written in portable SQL; see docs/DEPLOYMENT.md for PostgreSQL notes.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin','admin','receptionist','clinician')),
  doctor_id INTEGER REFERENCES doctors(id) ON DELETE SET NULL,  -- links a clinician login to a doctor profile
  active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE departments (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL, name_hi TEXT NOT NULL,
  desc_en TEXT NOT NULL, desc_hi TEXT NOT NULL,
  note_en TEXT, note_hi TEXT,                       -- special public notice (e.g. blood services verification)
  status TEXT NOT NULL DEFAULT 'to_be_confirmed' CHECK (status IN ('available','appointment_required','to_be_confirmed','temporarily_unavailable','not_offered')),
  form_type TEXT NOT NULL DEFAULT 'consultation' CHECK (form_type IN ('consultation','diagnostic','inquiry')),
  hours_en TEXT, hours_hi TEXT,                     -- NULL = "hours to be confirmed"
  is_facility INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  translation_reviewed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE services (
  id INTEGER PRIMARY KEY,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name_en TEXT NOT NULL, name_hi TEXT NOT NULL,
  desc_en TEXT, desc_hi TEXT,
  status TEXT NOT NULL DEFAULT 'to_be_confirmed' CHECK (status IN ('available','appointment_required','to_be_confirmed','temporarily_unavailable','not_offered')),
  is_diagnostic INTEGER NOT NULL DEFAULT 0,         -- appears in the diagnostic request form
  hours_en TEXT, hours_hi TEXT,                     -- NULL = hours to be confirmed (never guessed)
  prep_en TEXT, prep_hi TEXT,                       -- clinically approved preparation text only
  prep_approved INTEGER NOT NULL DEFAULT 0,         -- shown publicly only when 1
  closure_note_en TEXT, closure_note_hi TEXT,       -- temporary closure message
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  translation_reviewed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_services_dept ON services(department_id);

CREATE TABLE doctors (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL, name_hi TEXT,
  photo_url TEXT,
  qualifications_en TEXT, qualifications_hi TEXT,
  specialization_en TEXT, specialization_hi TEXT,
  registration_no TEXT,                              -- shown only if show_registration=1
  show_registration INTEGER NOT NULL DEFAULT 0,
  experience_years INTEGER,
  languages TEXT,
  bio_en TEXT, bio_hi TEXT,
  consultation_fee INTEGER,                          -- rupees; shown only if fee_approved=1
  fee_approved INTEGER NOT NULL DEFAULT 0,
  slot_minutes INTEGER NOT NULL DEFAULT 15 CHECK (slot_minutes BETWEEN 5 AND 120),
  verified INTEGER NOT NULL DEFAULT 0,               -- hospital has verified the credentials
  published INTEGER NOT NULL DEFAULT 0,              -- visible on the public site (requires verified)
  active INTEGER NOT NULL DEFAULT 1,
  translation_reviewed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE doctor_departments (
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (doctor_id, department_id)
);

CREATE TABLE doctor_schedules (
  id INTEGER PRIMARY KEY,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Sunday
  start_time TEXT NOT NULL, end_time TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  CHECK (start_time < end_time)
);
CREATE INDEX idx_sched_doctor ON doctor_schedules(doctor_id, weekday);

CREATE TABLE doctor_unavailability (
  id INTEGER PRIMARY KEY,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  reason TEXT,
  CHECK (start_date <= end_date)
);

CREATE TABLE holidays (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL, name_hi TEXT NOT NULL
);

-- Patient details are stored once, on the appointment, to keep collection minimal (no EMR).
CREATE TABLE appointments (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,                          -- public, non-guessable booking reference
  type TEXT NOT NULL CHECK (type IN ('consultation','diagnostic')),
  department_id INTEGER REFERENCES departments(id),
  service_id INTEGER REFERENCES services(id),
  doctor_id INTEGER REFERENCES doctors(id),
  inquiry_only INTEGER NOT NULL DEFAULT 0,           -- service availability was unconfirmed: this is an inquiry
  patient_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  age INTEGER, dob TEXT, gender TEXT,
  email TEXT,
  patient_type TEXT CHECK (patient_type IN ('new','returning')),
  preferred_date TEXT,
  preferred_range TEXT CHECK (preferred_range IN ('morning','afternoon','evening','any')),
  slot_start TEXT,                                   -- 'YYYY-MM-DD HH:MM' (IST): held/confirmed time
  slot_end TEXT,
  reason TEXT,
  referring_doctor TEXT, has_referral TEXT, notes TEXT,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','hi')),
  sms_consent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Confirmed','Rescheduled','Completed','Cancelled','No-show')),
  cancel_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_appt_status ON appointments(status, created_at);
CREATE INDEX idx_appt_doctor ON appointments(doctor_id, slot_start);
CREATE INDEX idx_appt_dept ON appointments(department_id);
CREATE INDEX idx_appt_mobile ON appointments(mobile);
-- DOUBLE-BOOKING GUARD: a doctor can hold at most one live appointment per time slot.
-- Enforced by the database itself, independent of application checks.
CREATE UNIQUE INDEX uq_doctor_slot ON appointments(doctor_id, slot_start)
  WHERE doctor_id IS NOT NULL AND slot_start IS NOT NULL AND status IN ('Pending','Confirmed','Rescheduled');

CREATE TABLE appointment_status_history (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  from_status TEXT, to_status TEXT NOT NULL,
  note TEXT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_hist_appt ON appointment_status_history(appointment_id);

CREATE TABLE change_requests (                       -- patient-initiated cancel/reschedule requests (staff review them)
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('cancel','reschedule')),
  new_date TEXT, new_range TEXT, note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','handled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inquiries (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, mobile TEXT NOT NULL, email TEXT,
  department_id INTEGER REFERENCES departments(id),
  message TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','handled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  event TEXT NOT NULL CHECK (event IN ('received','confirmed','rescheduled','cancelled','reminder')),
  to_mobile TEXT NOT NULL,
  language TEXT NOT NULL,
  body TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,              -- guarantees one message per event, even across retries
  -- not_configured: SMS disabled, nothing sent | queued | sending | retry | submitted: accepted by gateway (NOT delivery)
  -- delivered: gateway callback confirmed | failed | simulated: dev console provider only
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('not_configured','queued','sending','retry','submitted','delivered','failed','simulated')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  provider TEXT, provider_message_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TEXT
);
CREATE INDEX idx_notif_status ON notifications(status, next_attempt_at);
CREATE INDEX idx_notif_provider_id ON notifications(provider_message_id);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT,
  action TEXT NOT NULL,
  entity TEXT, entity_id TEXT,
  detail TEXT,                                       -- never passwords, tokens or medical details
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

CREATE TABLE faqs (
  id INTEGER PRIMARY KEY,
  q_en TEXT NOT NULL, q_hi TEXT NOT NULL,
  a_en TEXT NOT NULL, a_hi TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE announcements (
  id INTEGER PRIMARY KEY,
  title_en TEXT NOT NULL, title_hi TEXT NOT NULL,
  body_en TEXT, body_hi TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE website_content (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  en TEXT NOT NULL DEFAULT '', hi TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 1,
  translation_reviewed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE hospital_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
