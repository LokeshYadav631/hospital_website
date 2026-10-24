# Supabase PostgreSQL Configuration & Migration Guide

> **System**: SACHKHAND HOSPITAL Clinical Platform  
> **Target Database**: Supabase Managed PostgreSQL 16 (AWS Mumbai `ap-south-1` Region)  
> **Document Purpose**: Complete, repeatable blueprint to provision Supabase, execute PostgreSQL migrations, configure connection pooling (PgBouncer), enforce Row-Level Security (RLS), and integrate with the hospital application.

---

## 1. Supabase Project Provisioning

### Step 1: Create Supabase Project
1. Go to the [Supabase Dashboard](https://supabase.com/dashboard) and sign in (or create a free account).
2. Click **"New Project"**.
3. Fill in the project details:
   - **Name**: `sachkhand-hospital-db`
   - **Database Password**: Generate and securely store a 32-character random password.
   - **Region**: Select **`South Asia (Mumbai) - ap-south-1`** (Crucial for low latency and compliance with India's DPDP Act 2023).
   - **Plan**: **Free** ($0/month; includes 500MB DB, 50k MAU, and daily automated backups).
4. Wait 1-2 minutes for the database cluster to initialize.

---

## 2. Connection Strings & Pooling Architecture

Supabase provides two distinct connection URLs in **Project Settings > Database > Connection Strings**:

```
+---------------------------------------------------------------------------------------+
| 1. TRANSACTION POOLER (Port 6543) - USE THIS IN PRODUCTION FOR SERVERLESS / RENDER    |
| postgres://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require
+---------------------------------------------------------------------------------------+

+---------------------------------------------------------------------------------------+
| 2. DIRECT CONNECTION (Port 5432) - USE THIS ONLY FOR MIGRATION SCRIPTS                |
| postgres://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres?sslmode=require
+---------------------------------------------------------------------------------------+
```

> [!IMPORTANT]
> Always use the **Transaction Pooler (Port 6543)** in production environment variables (`DATABASE_URL`). It utilizes PgBouncer / Supavisor to support thousands of concurrent client requests without exhausting PostgreSQL connection limits.

---

## 3. PostgreSQL Migration Schema (Full DDL)

Open **Supabase Dashboard > SQL Editor**, paste the following consolidated DDL script, and click **"Run"**:

```sql
-- =============================================================================
-- SACHKHAND HOSPITAL — PRODUCTION POSTGRESQL SCHEMA (SUPABASE)
-- Consolidates Migrations 001, 002, and 003 with PostgreSQL-native types
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS & ACCESS CONTROL
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('receptionist', 'doctor', 'admin', 'super_admin')),
  doctor_id BIGINT,
  active INT NOT NULL DEFAULT 1,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. SESSIONS
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  doctor_id BIGINT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- 3. CLINICAL DEPARTMENTS
CREATE TABLE IF NOT EXISTS departments (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL, name_hi TEXT NOT NULL,
  desc_en TEXT NOT NULL, desc_hi TEXT NOT NULL,
  note_en TEXT, note_hi TEXT,
  status TEXT NOT NULL DEFAULT 'to_be_confirmed' CHECK (status IN ('available','appointment_required','to_be_confirmed','temporarily_unavailable','not_offered')),
  form_type TEXT NOT NULL DEFAULT 'consultation' CHECK (form_type IN ('consultation','diagnostic','inquiry')),
  hours_en TEXT, hours_hi TEXT,
  is_facility INT NOT NULL DEFAULT 0,
  sort INT NOT NULL DEFAULT 0,
  active INT NOT NULL DEFAULT 1,
  translation_reviewed INT NOT NULL DEFAULT 0
);

-- 4. SERVICES
CREATE TABLE IF NOT EXISTS services (
  id BIGSERIAL PRIMARY KEY,
  department_id BIGINT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name_en TEXT NOT NULL, name_hi TEXT NOT NULL,
  desc_en TEXT, desc_hi TEXT,
  status TEXT NOT NULL DEFAULT 'to_be_confirmed' CHECK (status IN ('available','appointment_required','to_be_confirmed','temporarily_unavailable','not_offered')),
  is_diagnostic INT NOT NULL DEFAULT 0,
  hours_en TEXT, hours_hi TEXT,
  prep_en TEXT, prep_hi TEXT,
  prep_approved INT NOT NULL DEFAULT 0,
  closure_note_en TEXT, closure_note_hi TEXT,
  sort INT NOT NULL DEFAULT 0,
  active INT NOT NULL DEFAULT 1,
  translation_reviewed INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_services_dept ON services(department_id);

-- 5. DOCTORS (Includes Migration 003 sort column)
CREATE TABLE IF NOT EXISTS doctors (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL, name_hi TEXT,
  photo_url TEXT,
  qualifications_en TEXT, qualifications_hi TEXT,
  specialization_en TEXT, specialization_hi TEXT,
  registration_no TEXT,
  show_registration INT NOT NULL DEFAULT 0,
  experience_years INT,
  languages TEXT,
  bio_en TEXT, bio_hi TEXT,
  consultation_fee INT,
  fee_approved INT NOT NULL DEFAULT 0,
  slot_minutes INT NOT NULL DEFAULT 15 CHECK (slot_minutes BETWEEN 5 AND 120),
  verified INT NOT NULL DEFAULT 0,
  published INT NOT NULL DEFAULT 0,
  active INT NOT NULL DEFAULT 1,
  translation_reviewed INT NOT NULL DEFAULT 0,
  sort INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_doctors_sort ON doctors(sort, active, published);

-- 6. DOCTOR-DEPARTMENTS JUNCTION
CREATE TABLE IF NOT EXISTS doctor_departments (
  doctor_id BIGINT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  department_id BIGINT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (doctor_id, department_id)
);

-- 7. DOCTOR RECURRING SCHEDULES
CREATE TABLE IF NOT EXISTS doctor_schedules (
  id BIGSERIAL PRIMARY KEY,
  doctor_id BIGINT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  weekday INT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  active INT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_schedules_doc_day ON doctor_schedules(doctor_id, weekday);

-- 8. DOCTOR UNAVAILABILITY
CREATE TABLE IF NOT EXISTS doctor_unavailability (
  id BIGSERIAL PRIMARY KEY,
  doctor_id BIGINT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT
);

-- 9. HOSPITAL HOLIDAYS
CREATE TABLE IF NOT EXISTS holidays (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  desc_en TEXT NOT NULL,
  desc_hi TEXT NOT NULL
);

-- 10. APPOINTMENTS (Includes Migration 002 email consent)
CREATE TABLE IF NOT EXISTS appointments (
  id BIGSERIAL PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'consultation' CHECK (type IN ('consultation','diagnostic')),
  department_id BIGINT NOT NULL REFERENCES departments(id),
  doctor_id BIGINT REFERENCES doctors(id),
  service_id BIGINT REFERENCES services(id),
  patient_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  email TEXT,
  patient_type TEXT NOT NULL DEFAULT 'new' CHECK (patient_type IN ('new','returning')),
  age INT,
  dob DATE,
  gender TEXT NOT NULL DEFAULT 'na' CHECK (gender IN ('male','female','other','na')),
  preferred_date DATE NOT NULL,
  preferred_range TEXT NOT NULL DEFAULT 'any' CHECK (preferred_range IN ('morning','afternoon','evening','any')),
  slot_time TEXT,
  confirmed_time TEXT,
  reason TEXT,
  referring_doctor TEXT,
  has_referral TEXT NOT NULL DEFAULT 'na' CHECK (has_referral IN ('yes','no','na')),
  notes TEXT,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','hi')),
  sms_consent INT NOT NULL DEFAULT 0,
  email_consent INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Confirmed','Rescheduled','Completed','Cancelled','No-show')),
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(preferred_date);
CREATE INDEX IF NOT EXISTS idx_appointments_mobile ON appointments(mobile);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

-- CRITICAL DOUBLE-BOOKING CONCURRENCY GUARD:
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_live_slot
ON appointments(doctor_id, preferred_date, slot_time)
WHERE doctor_id IS NOT NULL AND slot_time IS NOT NULL AND status != 'Cancelled';

-- 11. STATUS AUDIT HISTORY
CREATE TABLE IF NOT EXISTS appointment_status_history (
  id BIGSERIAL PRIMARY KEY,
  appointment_id BIGINT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by BIGINT REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 12. PATIENT CHANGE REQUESTS
CREATE TABLE IF NOT EXISTS change_requests (
  id BIGSERIAL PRIMARY KEY,
  appointment_id BIGINT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('cancel','reschedule')),
  new_date DATE,
  new_range TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 13. INQUIRIES
CREATE TABLE IF NOT EXISTS inquiries (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  email TEXT,
  department_id BIGINT REFERENCES departments(id),
  message TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','resolved')),
  internal_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 14. DUAL NOTIFICATIONS QUEUE (SMS & Email)
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','email')),
  to_phone TEXT,
  to_email TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','submitted','delivered','failed','not_configured')),
  provider_msg_id TEXT,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notif_channel ON notifications(channel, status);
CREATE INDEX IF NOT EXISTS idx_notif_pending ON notifications(status, next_attempt_at);

-- 15. AUDIT LOGS
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id BIGINT,
  details TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 16. WEBSITE CONTENT & FAQS
CREATE TABLE IF NOT EXISTS website_content (
  key TEXT PRIMARY KEY,
  desc_en TEXT NOT NULL,
  desc_hi TEXT NOT NULL,
  en TEXT NOT NULL,
  hi TEXT NOT NULL,
  published INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS faqs (
  id BIGSERIAL PRIMARY KEY,
  q_en TEXT NOT NULL, q_hi TEXT NOT NULL,
  a_en TEXT NOT NULL, a_hi TEXT NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  published INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS announcements (
  id BIGSERIAL PRIMARY KEY,
  title_en TEXT NOT NULL, title_hi TEXT NOT NULL,
  body_en TEXT, body_hi TEXT,
  published INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 17. HOSPITAL SETTINGS KEY-VALUE
CREATE TABLE IF NOT EXISTS hospital_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

---

## 4. Row-Level Security (RLS) Configuration

Supabase activates Row-Level Security to protect patient data from unauthenticated access:

```sql
-- Enable RLS across patient-sensitive tables
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_requests ENABLE ROW LEVEL SECURITY;

-- Allow public read-only access to clinical metadata
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view active departments" ON departments FOR SELECT USING (active = 1);

ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view published doctors" ON doctors FOR SELECT USING (active = 1 AND published = 1);

ALTER TABLE doctor_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view active doctor schedules" ON doctor_schedules FOR SELECT USING (active = 1);

ALTER TABLE faqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view published faqs" ON faqs FOR SELECT USING (published = 1);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view published announcements" ON announcements FOR SELECT USING (published = 1);

ALTER TABLE hospital_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view hospital settings" ON hospital_settings FOR SELECT USING (true);
```

---

## 5. Verification & Health Checks

Run this query in Supabase SQL Editor to confirm that all 17 tables and indexes are initialized:

```sql
SELECT 
  table_name, 
  (SELECT count(*) FROM information_schema.columns WHERE table_name=t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public' 
ORDER BY table_name;
```

Expected output: 17 public tables ready to accept production traffic.
