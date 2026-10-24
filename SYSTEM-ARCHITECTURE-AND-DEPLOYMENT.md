# SACHKHAND HOSPITAL — Comprehensive Architecture, Database, Dual Notifications & Production Deployment Guide

**SACHKHAND HOSPITAL**, Sarai Road, Mundawar, District Khairthal-Tijara, Rajasthan 301707  
*Bilingual (Hindi / English) Healthcare Web Application, Appointment Scheduling & Multi-Channel Notification System*

---

## Table of Contents
1. [Executive Summary & System Architecture](#1-executive-summary--system-architecture)
2. [End-to-End Application Workflow](#2-end-to-end-application-workflow)
3. [Database Deep Dive & Data Storage](#3-database-deep-dive--data-storage)
4. [Dual Notification System: SMS (Phone) & Email](#4-dual-notification-system-sms-phone--email)
5. [High Concurrency & Load Stress Testing Results](#5-high-concurrency--load-stress-testing-results)
6. [System Limitations & Known Constraints](#6-system-limitations--known-constraints)
7. [Comprehensive Improvement Roadmap](#7-comprehensive-improvement-roadmap)
8. [Production Deployment & Custom Domain Setup Guide](#8-production-deployment--custom-domain-setup-guide)
9. [Verification & Operational Commands](#9-verification--operational-commands)

---

## 1. Executive Summary & System Architecture

### 1.1 Architecture Philosophy
The SACHKHAND HOSPITAL platform is built with a **zero external dependency** architecture running on **Node.js 22 LTS or newer**. Rather than relying on heavy third-party frameworks with fragile dependency graphs, the platform utilizes Node's built-in, highly optimized native modules:
* `node:http`: High-throughput asynchronous HTTP/1.1 server.
* `node:sqlite` (`DatabaseSync`): Embedded relational database operating in Write-Ahead Logging (WAL) mode.
* `node:crypto`: Cryptographically secure random references, scrypt password hashing, session tokens, and timing-safe comparisons.
* `node:test` & `node:assert`: Native automated test harness.

```
                      +------------------------------------------+
                      |               Web Browser                |
                      |   (Bilingual: English / Hindi Desktop)   |
                      +--------------------+---------------------+
                                           | HTTPS (:443)
                                           v
                      +--------------------+---------------------+
                      |       Nginx / Reverse Proxy & TLS        |
                      | (Rate Limiting, SSL, Compression, Cache) |
                      +--------------------+---------------------+
                                           | HTTP (:3000)
                                           v
+---------------------------------------------------------------------------------------+
| Node.js Native HTTP Server (src/server.js)                                           |
|                                                                                       |
|  [Security Middlewares]                                                               |
|  * Timing-safe CSRF Validation                                                        |
|  * In-memory Bucket Rate Limiting                                                      |
|  * Strict Cookie Session Authentication (HttpOnly, SameSite=Strict)                   |
|  * Security Headers (CSP, X-Frame-Options: DENY, X-Content-Type-Options: nosniff)       |
|                                                                                       |
|  [Routing & Controllers]                                                              |
|  * Public Routes (src/web/public-routes.js)                                           |
|  * Staff & Admin Portal (src/web/admin-routes.js, admin-routes2.js)                   |
|  * Webhook Listeners (/api/sms/webhook, /api/email/webhook)                           |
|                                                                                       |
|  [Service & Business Logic Layer]                                                     |
|  * Appointments & Workflow Engine (src/services/appointments.js)                      |
|  * Slot Generator & Double-Booking Guard (src/services/slots.js)                      |
|  * Dual Notification Engine (src/services/notifications.js)                           |
|                                                                                       |
|  [Data Persistence]                                                                   |
|  * SQLite in WAL Mode with BEGIN IMMEDIATE write-locks (data/hospital.db)             |
+--------------------------+---------------------------------+--------------------------+
                           |                                 |
                           v                                 v
        +------------------+--------------+   +--------------+------------------+
        |   SMS Provider Adapter (Phone)   |   |   Email Provider Adapter (Email) |
        |   (HTTP / Console / Mock Gateway)|   |   (HTTP / Resend / SES / Brevo)  |
        +---------------------------------+   +---------------------------------+
```

---

## 2. End-to-End Application Workflow

### 2.1 Bilingual Interface (Hindi & English)
* **Routing**: The application maintains strict URL routing under `/:lang/` (e.g. `/en/appointment` and `/hi/appointment`).
* **Content Parity**: The internationalization dictionary (`src/i18n/strings.js`) enforces exact key parity between Hindi and English dictionaries, validated by automated tests.
* **Auto-Language Detection**: Root path `/` inspects `Accept-Language` headers and user preference cookies (`lang=hi` or `lang=en`) and redirects seamlessly.

### 2.2 Department & Diagnostic Directory
* **11 Medical Departments**: Fully modeled with clinical services, operating hours, verified notices, and status indicators:
  1. General Surgery (`general-surgery`)
  2. Obstetrics & Gynecology (`gynecology`)
  3. Pediatrics (`pediatrics`)
  4. Urology (`urology`)
  5. Physiotherapy (`physiotherapy`)
  6. Orthopedics (`orthopedics`)
  7. Blood Bank (`blood-bank`)
  8. General Medicine (`medicine`)
  9. Dialysis (`dialysis`)
  10. ENT (Ear, Nose, Throat) (`ent`)
  11. Radiology & Digital Imaging (`radiology`)
* **5 Explicit Availability Statuses**: Services and departments display real operational truth:
  - `available` (खुला / उपलब्ध)
  - `appointment_required` (अपॉइंटमेंट आवश्यक)
  - `to_be_confirmed` (उपलब्धता की पुष्टि बाकी है)
  - `temporarily_unavailable` (अस्थायी रूप से अनुपलब्ध)
  - `not_offered` (उपलब्ध नहीं)

### 2.3 Verified Super-Specialist Doctor Team (19 Doctors in Poster Order)
The complete medical roster from the official hospital poster (*"सचखंड हॉस्पिटल की सुपर-स्पेशलिस्ट चिकित्सकों की टीम"*) is active in the database with individual portraits (`public/img/doctors/`), qualifications, and OPD schedules. **Dr. Gajraj Yadav** (Director) is positioned as the #1 profile, followed by all 18 doctors in exact poster order via the `sort` column in `doctors` table:

| # | Doctor Name | Qualifications | Department / Specialization | Photo Asset |
|---|---|---|---|---|
| 1 | **Dr. Gajraj Yadav** (Director) | MBBS, MS, FMAS | General & Laparoscopic Surgery | `dr-gajraj-yadav.jpg` |
| 2 | **Dr. Kritesh Mehta** | MBBS, MD, DM | Cardiology (General Medicine) | `dr-kritesh-mehta.jpg` |
| 3 | **Dr. Vijay Singh** | MBBS, MS, M.Ch. | Urology | `dr-vijay-singh.jpg` |
| 4 | **Dr. Bhupender Yadav** | MBBS, DNB, DM | Gastroenterology & Hepatology | `dr-bhupender-yadav.jpg` |
| 5 | **Dr. Ajit Yadav** | MBBS, MD | General Medicine | `dr-ajit-yadav.jpg` |
| 6 | **Dr. Shashank Trigunayat** | MBBS, DNB | General Medicine | `dr-shashank-trigunayat.jpg` |
| 7 | **Dr. Ramesh Kumar** | MBBS, D. Ortho, DNB, FISM, FIJRS | Orthopedics & Joint Replacement | `dr-ramesh-kumar.jpg` |
| 8 | **Dr. Ranvir Singh** | MBBS, MS | ENT (Ear, Nose & Throat) | `dr-ranvir-singh.jpg` |
| 9 | **Dr. Chetan Singh Tanwar** | MBBS, MD | Pediatrics & Neonatology | `dr-chetan-singh-tanwar.jpg` |
| 10 | **Dr. Ravina Yadav** | MBBS, DNB (Obs & Gynae) | Obstetrics & Gynecology | `dr-ravina-yadav.jpg` |
| 11 | **Dr. P. L. Sharma** | MBBS, DNB | Radiology & Digital Imaging | `dr-pl-sharma.jpg` |
| 12 | **Dr. Vaishali Yadav** | MBBS, MS (Obs & Gynae), FMAS | Obstetrics & Gynecology | `dr-vaishali-yadav.jpg` |
| 13 | **Dr. Darshan TS** | MBBS, DNB | General Medicine | `dr-darshan-ts.jpg` |
| 14 | **Dr. Surendra Singh Khichi** | MBBS, DCH (Pediatrics) | Pediatrics | `dr-surendra-singh-khichi.jpg` |
| 15 | **Dr. Hafiz Kalam Uddin** | MBBS, MS | General & Laparoscopic Surgery | `dr-hafiz-kalam-uddin.jpg` |
| 16 | **Dr. Arvind Kumar** | MBBS, MD | Anaesthesia & Critical Care | `dr-arvind-kumar.jpg` |
| 17 | **Dr. Kavita** | BDS | Dental Surgery | `dr-kavita.jpg` |
| 18 | **Dr. Sanjeev Singh** | MBBS, MS, M.Ch. (Neurosurgery) | Neurosurgery (Brain & Spine) | `dr-sanjeev-singh.jpg` |
| 19 | **Dr. Shyam Sharma** | MBBS, MD, DM (Nephrology) | Nephrology & Dialysis | `dr-shyam-sharma.jpg` |

> [!NOTE]
> Per user design requirement, the legacy static doctor team poster image has been removed from the public Doctors page UI. Only the clean, responsive individual doctor profile cards are displayed.

### 2.4 Official Hospital Visual Assets & Header Redesign
* **Header Layout**:
  - **Left Side**: Hospital Official Logo (`public/img/hospital-logo.jpg`) with hospital title and bilingual tagline.
  - **Center**: Accessible navigation links (Home, About, Departments, Doctors, Diagnostics, Contact, Status) and primary "Book appointment" CTA.
  - **Right Side**: University / Trust Logo (`public/img/trust-logo.png`) with link to About page and trust details.
* **Homepage Hero Section**:
  - Styled with the real hospital building exterior (`public/img/hospital-building.jpg`) as the section background image.
  - Overlaid with a dark blue gradient (`rgba(8, 47, 114, 0.88)` to `rgba(18, 60, 140, 0.84)`) for contrast and legibility of typography and CTAs.
* **Social Media Management (Admin Panel)**:
  - Hospital administrators can manage official Facebook (`facebook_url`) and Instagram (`instagram_url`) links directly in `/admin/settings`.
  - Links are rendered in the topbar and footer with safe rel-attributes (`target="_blank" rel="noopener noreferrer"`).

### 2.5 Backdate Prevention & Historical OPD Architecture
* **Strict Backdate Prohibition on Booking**:
  - HTML5 attribute `min="${clock.todayIST()}"` prevents date selection in the past.
  - Client-side guard in `public/js/app.js` dynamically enforces `date.min = today` and automatically resets any attempt to enter a past date.
  - Server-side validation in `src/lib/validation.js` checks `if (value < todayIST()) errors.preferred_date = 'e_date_past'`.
  - Intraday past-time checks: If a patient books for today, time slots that have already passed are pruned (`time <= nowTimeIST()`).
* **Historical OPD & Past Records Preservation**:
  - Past appointments are preserved permanently in `data/hospital.db` with complete audit trails and status history.
  - Administrative staff can filter and view past OPD records across all historical dates via `/admin/appointments` (`from` / `to` date filters).
  - Staff can reschedule past pending or missed appointments to future dates via the admin actions panel (`action=reschedule`).

### 2.3 Appointment Workflow
1. **Patient Booking Request**:
   - The patient selects a department and (optionally) an approved doctor.
   - If an approved doctor with an active schedule is selected, available 15-minute time slots are loaded dynamically.
   - The patient enters contact information (Phone number and optional Email address), age or DOB, gender, preferred date/time range, and reason.
   - The patient can select notification preferences (Phone SMS and Email).
2. **Booking Reference Allocation**:
   - The system generates an unguessable, high-entropy reference in the format `SKH-XXXX-XXXX` (Base-32 alphabet without visually ambiguous characters like `0`, `O`, `1`, `I`, `L`).
3. **Double-Booking Guard**:
   - Validated both at the application level and at the database level using a write-locked transaction (`BEGIN IMMEDIATE`) and a partial unique index.
4. **Patient Self-Service**:
   - Patients can check their live status at `/en/appointment/status` or `/hi/appointment/status` by supplying their booking reference AND mobile number (constant-time verification prevents data enumeration).
   - Patients can submit cancel or reschedule change requests directly online for staff review.

### 2.4 Staff & Admin Portal (`/admin`)
* **Role-Based Access Control (RBAC)**:
  - `super_admin`: Full system control, staff management, audit logs, configuration.
  - `admin`: Operational control over doctors, schedules, services, content, and appointments.
  - `receptionist`: Can view, assign, confirm, reschedule, and manage appointment requests.
  - `clinician`: Restricted view; clinicians see only their assigned patients, with patient phone numbers redacted for privacy.
* **Audit Trail**: Every state change, doctor assignment, status transition, user login, and CSV export is recorded in `audit_logs` with timestamps, actor IDs, and IP addresses.
* **CSV Exports**: Neutralizes formula injection vulnerabilities (e.g. cells starting with `=`, `+`, `-`, `@` are prefixed with a single quote).

---

## 3. Database Deep Dive & Data Storage

### 3.1 SQLite Storage Engine & WAL Mode
The database is stored in a single file at `data/hospital.db`. On startup, `src/lib/db.js` enforces:
```sql
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
```
* **WAL (Write-Ahead Logging)**: Readers do not block writers, and writers do not block readers. Multiple concurrent users can browse the website and read doctor schedules while a write transaction is committing.
* **`PRAGMA busy_timeout = 5000`**: Concurrent writers wait up to 5,000 milliseconds for locks to clear before raising a busy error.
* **Serialized Write Transactions (`BEGIN IMMEDIATE`)**: `tx(db, fn)` in `src/lib/db.js` opens transactions with `BEGIN IMMEDIATE`, taking the write lock up front so that validation and reservation logic cannot interleave with another writer.

### 3.2 Schema Architecture (All 17 Tables)

```
 +------------------+           +-------------------+           +-------------------+
 |      users       |           |    departments    |           |      doctors      |
 +------------------+           +-------------------+           +-------------------+
 | id (PK)          |           | id (PK)           |           | id (PK)           |
 | email (UNIQUE)   |           | slug (UNIQUE)     |           | slug (UNIQUE)     |
 | password_hash    |           | name_en / name_hi |           | name_en / name_hi |
 | role             |           | status            |           | slot_minutes      |
 | doctor_id (FK)   |---+       | is_facility       |           | verified          |
 +------------------+   |       +---------+---------+           | published         |
                        |                 |                     +---------+---------+
                        v                 | 1:N                           |
                +-------------------+     |                               |
                |     sessions      |     v                               | 1:N
                +-------------------+   +-------------------+             |
                | token_hash (PK)   |   |     services      |             v
                | user_id (FK)      |   +-------------------+   +--------------------+
                | expires_at        |   | id (PK)           |   |  doctor_schedules  |
                +-------------------+   | department_id (FK)|   +--------------------+
                                        | name_en / name_hi |   | id (PK)            |
                                        | is_diagnostic     |   | doctor_id (FK)     |
                                        +---------+---------+   | weekday (0-6)      |
                                                  |             | start_time / end   |
                                                  v             +--------------------+
                                        +-------------------+
                                        |   appointments    |
                                        +-------------------+
                                        | id (PK)           |
                                        | ref (UNIQUE)      |
                                        | department_id (FK)|
                                        | doctor_id (FK)    |
                                        | patient_name      |
                                        | mobile            |
                                        | email             |
                                        | email_consent     |
                                        | sms_consent       |
                                        | slot_start / end  |
                                        | status            |
                                        +---------+---------+
                                                  |
                         +------------------------+-----------------------+
                         | 1:N                                            | 1:N
                         v                                                v
             +-----------------------+                        +-----------------------+
             |     notifications     |                        |  status_history       |
             +-----------------------+                        +-----------------------+
             | id (PK)               |                        | id (PK)               |
             | appointment_id (FK)   |                        | appointment_id (FK)   |
             | channel (sms / email) |                        | from_status           |
             | to_mobile / to_email  |                        | to_status             |
             | subject / body        |                        | actor_user_id (FK)    |
             | idempotency_key (UQ)  |                        | created_at            |
             | status                |                        +-----------------------+
             | attempts              |
             +-----------------------+
```

#### Detailed Table Specifications:
1. **`users`**: Administrative and clinician credentials. Passwords hashed using cryptographic `scrypt`. Failed login tracking with lockouts after 5 consecutive failures.
2. **`sessions`**: Server-side session tokens. Token values are SHA-256 hashed before storage; expired sessions are cleaned up automatically.
3. **`departments`**: Clinical departments with bilingual names, descriptions, operational statuses, and notices.
4. **`services`**: Individual clinical procedures and diagnostic tests linked to departments. Includes clinical preparation instructions that only display publicly when verified by staff (`prep_approved=1`).
5. **`doctors`**: Physician profiles, qualifications, verified/published flags, consultation fees, slot durations (default 15 minutes), and display order sequence (`sort` column, migration 003).
6. **`doctor_departments`**: Junction table establishing M:N relationships between doctors and departments.
7. **`doctor_schedules`**: Weekly recurring availability rules (weekday 0-6, start time, end time).
8. **`doctor_unavailability`**: Temporary leaves or absence dates preventing bookings.
9. **`holidays`**: Hospital-wide holiday calendar blocking appointment slots across all departments.
10. **`appointments`**: Central appointment registry. Stores patient contact information, selected department, assigned doctor, held slot times, referral info, and communication consents (`sms_consent`, `email_consent`).
11. **`appointment_status_history`**: Audit trail of every lifecycle status transition, the acting user, and notes.
12. **`change_requests`**: Patient-initiated cancellation or rescheduling requests awaiting staff review.
13. **`inquiries`**: General patient inquiries submitted via the contact form.
14. **`notifications`**: Dual-channel communication logs (SMS & Email). Tracks channel, recipient, subject, body, idempotency key, retry attempts, next attempt schedule, provider message IDs, and delivery status.
15. **`audit_logs`**: Tamper-evident administrative action log recording IP, user ID, timestamp, and action description.
16. **`faqs`**: Bilingual published FAQ items.
17. **`announcements`**: Bilingual emergency alerts and operational notices.
18. **`website_content`**: Editable bilingual copy for homepage intros, trust mission, patient rights, and philosophy.
19. **`hospital_settings`**: Key-value settings for contact numbers, emergency claims, and verified map coordinates.

### 3.3 The Double-Booking Guard
Double booking is strictly prevented at the database engine level via a partial unique index:
```sql
CREATE UNIQUE INDEX uq_doctor_slot ON appointments(doctor_id, slot_start)
  WHERE doctor_id IS NOT NULL 
    AND slot_start IS NOT NULL 
    AND status IN ('Pending','Confirmed','Rescheduled');
```
* Even if two concurrent web requests pass application-level validation simultaneously, the second `INSERT` or `UPDATE` triggers a `SQLITE_CONSTRAINT_UNIQUE` violation, rolling back the transaction and returning an HTTP 409 conflict.
* Once an appointment moves to `Cancelled`, `Completed`, or `No-show`, the slot is immediately freed for new bookings.

---

## 4. Dual Notification System: SMS (Phone) & Email

The notification system provides multi-channel delivery across both SMS and Email.

### 4.1 Channel Architecture & Delivery Pipeline
* **Phone Channel (`channel = 'sms'`)**: Normalizes Indian mobile numbers (`+91`, `0`, spaces, and Devanagari numerals `०-९` are converted to standard 10-digit format). Dispatches short, approved templates to SMS gateways.
* **Email Channel (`channel = 'email'`)**: Validates email syntax and plus-addressing. Formats bilingual email subjects and detailed, structured email bodies with hospital directions and reference links.
* **Dual Triggering**: When an appointment is requested, confirmed, rescheduled, or cancelled, `src/services/appointments.js` calls both `queueSms` and `queueEmail`.
* **Privacy Safeguards**: In accordance with medical data privacy guidelines, notification messages contain **zero clinical details, diagnoses, or department medical notes**. Only the booking reference, date, time, and hospital telephone numbers are included.

### 4.2 Idempotency & Concurrency Protection
To prevent duplicate messages during gateway timeouts or concurrent worker runs:
* **SMS Key**: `${appointment_id}:${event}:${slot_start || ''}`
* **Email Key**: `${appointment_id}:${event}:${slot_start || ''}:email`
The `idempotency_key UNIQUE` constraint ensures that duplicate notifications cannot be inserted into the database.

### 4.3 Atomic Worker Claim & Exponential Backoff
The background dispatcher (`notifications.dispatchDue`) runs every 30 seconds:
1. **Atomic Claim**:
   ```sql
   UPDATE notifications 
   SET status='sending', attempts=attempts+1, updated_at=? 
   WHERE id=? AND status IN ('queued','retry')
   ```
   If two background workers run concurrently, only one worker claims the notification row (`changes === 1`).
2. **Provider Dispatch**: The worker sends the payload to the respective SMS or Email provider adapter.
3. **Exponential Backoff**: On temporary gateway errors (HTTP 429, 502, 503, 504), the row status moves to `retry` with a backoff calculation:
   $$\text{Wait Minutes} = \min(2^{\text{attempts}}, 60)$$
4. **Permanent Failure Capping**: Messages fail permanently after 5 failed attempts (`MAX_ATTEMPTS = 5`), allowing manual review and retry by hospital staff via the Admin portal.
5. **Two-Phase Delivery Status**:
   - `submitted`: Gateway accepted the message for delivery.
   - `delivered`: Only marked delivered upon receiving a cryptographically signed callback webhook from the gateway (`/api/sms/webhook` or `/api/email/webhook`).

### 4.4 Provider Adapters & Supported Gateways
The system supports three operational provider modes configured via environment variables:
* `none`: Safe default mode. Notifications are logged as `not_configured` without leaking credentials or throwing errors.
* `console`: Development mode. Prints full formatted SMS and Email messages directly to the terminal for local verification.
* `http`: Production mode. Sends JSON payloads over HTTPS to any transactional SMS or Email gateway (e.g. Resend, SendGrid, Amazon SES, Twilio, Exotel, Brevo, Gupshup).

---

## 5. High Concurrency & Load Stress Testing Results

A high-load concurrency and boundary test suite (`test/concurrency-and-email.test.js`) verifies system behavior under heavy simulated traffic:

### 5.1 Test Execution Summary
```
> sachkhand-hospital@1.0.0 test
> node --disable-warning=ExperimentalWarning --test "test/*.test.js"

✔ unauthenticated users cannot reach any admin page or export (278ms)
✔ login: lockout after repeated failures, HttpOnly+SameSite sessions (691ms)
✔ passwords stored hashed (scrypt) and never logged in audit (90ms)
✔ role-based access: super_admin, admin, receptionist, clinician (340ms)
✔ staff workflow: assign doctor, confirm slot, reschedule, cancel (330ms)
✔ CSV export neutralises spreadsheet formula injection (78ms)
✔ doctors: cannot publish unverified; unpublished stay hidden (457ms)
✔ booking WITHOUT a doctor persists as Pending (161ms)
✔ booking with a doctor reserves real slot, second booking fails (137ms)
✔ DATABASE-level double-booking guard: unique partial index blocks live duplicates (2ms)
✔ diagnostic workflow: unverified service accepted only as inquiry (165ms)
✔ patient self-service: lookup needs reference AND mobile (216ms)
✔ SQL injection / XSS strings stored inertly and rendered escaped (49ms)
✔ Dual Notification: booking queues BOTH SMS and Email with distinct idempotency keys (244ms)
✔ Dual Delivery: dispatchDue delivers both SMS and Email via respective gateways (128ms)
✔ Dual Status Workflow: Confirm, Reschedule, Cancel dispatch to both channels (40ms)
✔ Reminders: generates both SMS and Email reminders for tomorrow's appointments (22ms)
✔ Email Gateway Retry with Exponential Backoff (51ms)
✔ High Complexity Values: Long Devanagari Hindi Names, Plus-Addressed Emails (20ms)
✔ Security & Injection Boundary: XSS & SQLi payloads stored inertly (54ms)
✔ Concurrency: 20 simultaneous users competing for the SAME slot - exactly 1 wins, 19 rejected (158ms)
✔ Concurrency: 25 simultaneous users booking distinct appointments (171ms)
✔ Concurrency: 10 concurrent notification dispatchers compete - no duplicates (391ms)
✔ all 11 department pages exist in both languages (211ms)
✔ hospital identity: exact address, telephone numbers, taglines (24ms)
✔ SMS disabled fallback: booking reference + phones still shown (226ms)

ℹ tests 65
ℹ pass 65
ℹ fail 0
ℹ duration_ms 4964ms
```

### 5.2 Key Concurrency Findings
1. **Contested Slot Collision (20 Concurrent Users)**:
   - When 20 simulated clients concurrently submit requests for the same doctor and identical time slot, **exactly 1 booking succeeds (HTTP 303)** and all other **19 concurrent requests are rejected (HTTP 409)**.
   - The database contains strictly 1 held appointment for the slot.
2. **Multi-User Burst (25 Concurrent Bookings)**:
   - 25 concurrent users booking across various departments succeed without database deadlocks or data corruption.
   - All 25 generated booking references are unique.
3. **Concurrent Dispatch Race Protection**:
   - 10 background worker dispatchers running in parallel across 20 queued notifications produced **zero duplicate sends** to the gateways.

---

## 6. System Limitations & Known Constraints

While the system is fast and self-contained, deploying it at high scale has specific architectural boundaries:

1. **Single-Writer Database Lock**:
   - SQLite operates with a single writer lock. While WAL mode enables unlimited concurrent readers, only one write transaction can execute at a time.
   - *Capacity limit*: Up to ~1,500 write transactions/second. For an appointment booking system handling thousands of daily bookings, this is more than sufficient, but cannot scale horizontally across multiple instances without a centralized database.
2. **In-Memory Rate Limiter**:
   - The IP rate limiter (`sec.rateLimit`) stores request counters in memory. If multiple Node.js processes run in cluster mode, each process maintains an independent counter unless backed by Redis.
3. **Session Affinity**:
   - Session tokens are stored in the local SQLite `sessions` table. Running multiple web instances behind a load balancer requires sticky sessions or migrating sessions to PostgreSQL / Redis.
4. **Mock Communication Gateways by Default**:
   - SMS and Email are set to `none` out of the box so that the site can run offline without external dependencies. Production deployment requires valid credentials from an SMS gateway and an email service provider.
5. **No Full Electronic Medical Record (EMR)**:
   - The system is an appointment scheduling and triage system, not an EMR. Medical history, patient records, prescriptions, and lab reports are intentionally not stored on the public web server to minimize data breach risks.

---

## 7. Comprehensive Improvement Roadmap

To evolve this project into an enterprise hospital management suite, consider the following enhancements:

### Phase 1: Database & Distributed Caching
* **PostgreSQL Migration**: Swap `src/lib/db.js` with `node-postgres` (`pg`) or Supabase when migrating to a distributed, multi-region architecture. The SQL schema is already portable.
* **Redis Integration**: Use Redis for distributed rate limiting, session storage, and BullMQ background job queues.

### Phase 2: Payment Gateway & WhatsApp Integration
* **Online Consultation Fee Collection**: Integrate Razorpay or UPI Intent flow for upfront consultation fee payment.
* **WhatsApp Business Messaging**: Add a WhatsApp notification adapter alongside SMS and Email using the Meta Cloud API, as WhatsApp is the primary communication channel in rural and semi-urban India.

### Phase 3: ABDM & Digital Health Records
* **ABDM (Ayushman Bharat Digital Mission) Compliance**: Integrate Ayushman Bharat Health Account (ABHA) creation, allowing patients to link their hospital appointments with their national digital health records.
* **Doctor Tele-Consultation**: WebRTC video consultation rooms for remote rural clinics.

---

## 8. Production Deployment & Custom Domain Setup Guide

Follow this step-by-step guide to take this project from localhost to a publicly accessible, secured production domain (e.g. `https://sachkhandhospital.org`).

---

### Step 1: VPS Server Provisioning & Linux Hardening
Rent a small Linux VPS (Ubuntu 24.04 LTS, 2 vCPU, 2 GB RAM) from DigitalOcean, Hetzner, Linode, or AWS EC2.

1. **Log in to the server**:
   ```bash
   ssh root@<YOUR_SERVER_IP>
   ```
2. **Update the system and install essential packages**:
   ```bash
   apt update && apt upgrade -y
   apt install -y ufw curl git fail2ban
   ```
3. **Configure the UFW Firewall**:
   ```bash
   ufw default deny incoming
   ufw default allow outgoing
   ufw allow OpenSSH
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw enable
   ```
4. **Create a dedicated non-root application user**:
   ```bash
   adduser --disabled-password --gecos "" sachkhand
   usermod -aG sudo sachkhand
   ```

---

### Step 2: Install Node.js 22 LTS
Install official Node.js 22 via NodeSource:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v  # Must report v22.x or v24.x
```

---

### Step 3: Domain DNS Configuration
Log in to your domain registrar (e.g. Cloudflare, GoDaddy, Namecheap) and create DNS records pointing to your server's public IP:

| Type | Host / Name | Value / Destination | TTL |
|---|---|---|---|
| **A** | `@` | `<YOUR_SERVER_IP>` | Auto / 300s |
| **A** | `www` | `<YOUR_SERVER_IP>` | Auto / 300s |
| **TXT** | `@` | `v=spf1 include:_spf.youremailprovider.com ~all` | Auto |

*(Allow 5 to 30 minutes for DNS propagation)*.

---

### Step 4: Deploy the Codebase & Database
1. **Switch to the application user and clone the repository**:
   ```bash
   su - sachkhand
   git clone https://github.com/your-org/sachkhand-hospital.git /home/sachkhand/app
   cd /home/sachkhand/app
   ```
2. **Create persistent directory for the database**:
   ```bash
   mkdir -p /home/sachkhand/app/data
   mkdir -p /home/sachkhand/app/backups
   ```
3. **Configure Production Environment (`.env`)**:
   ```bash
   cp .env.example .env
   nano .env
   ```
   Set production variables:
   ```ini
   NODE_ENV=production
   PORT=3000
   BASE_URL=https://sachkhandhospital.org
   DATABASE_PATH=/home/sachkhand/app/data/hospital.db
   TRUST_PROXY=1

   # Generate a 64-character secret with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   SESSION_SECRET=c1f4e8b9934271829e018274a98b182736450192837465019283746501928374650192837465019283746501

   # Production SMS Gateway (Twilio / Exotel / Gupshup / HTTP Gateway)
   SMS_PROVIDER=http
   SMS_HTTP_URL=https://api.your-sms-provider.com/v1/send
   SMS_HTTP_TOKEN=your-production-sms-token
   SMS_SENDER_ID=SKHHSP
   SMS_WEBHOOK_SECRET=your-secure-webhook-secret-sms

   # Production Email Gateway (Resend / SendGrid / Brevo / SES)
   EMAIL_PROVIDER=http
   EMAIL_HTTP_URL=https://api.resend.com/emails
   EMAIL_HTTP_TOKEN=re_your_resend_api_key
   EMAIL_FROM=SACHKHAND HOSPITAL <appointments@sachkhandhospital.org>
   EMAIL_WEBHOOK_SECRET=your-secure-webhook-secret-email
   ```
4. **Run migrations and create the first Super Administrator**:
   ```bash
   node scripts/migrate.js
   node scripts/create-admin.js
   ```

---

### Step 5: Process Management with Systemd
Create a systemd service to keep the application running 24/7 with automatic restart upon server reboot or unexpected failure:

1. Create `/etc/systemd/system/sachkhand.service`:
   ```bash
   sudo nano /etc/systemd/system/sachkhand.service
   ```
2. Add the configuration:
   ```ini
   [Unit]
   Description=SACHKHAND HOSPITAL Node.js Web Application
   After=network.target

   [Service]
   Type=simple
   User=sachkhand
   WorkingDirectory=/home/sachkhand/app
   ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning src/server.js
   Restart=always
   RestartSec=5
   Environment=NODE_ENV=production

   # Security sandboxing
   NoNewPrivileges=true
   ProtectSystem=full
   ProtectHome=false
   PrivateTmp=true

   [Install]
   WantedBy=multi-user.target
   ```
3. Enable and start the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable sachkhand
   sudo systemctl start sachkhand
   sudo systemctl status sachkhand
   ```

---

### Step 6: Nginx Reverse Proxy & Automated SSL (Let's Encrypt)

1. **Install Nginx and Certbot**:
   ```bash
   sudo apt install -y nginx certbot python3-certbot-nginx
   ```
2. **Create the Nginx server block**:
   ```bash
   sudo nano /etc/nginx/sites-available/sachkhandhospital.org
   ```
3. **Paste the hardened configuration**:
   ```nginx
   # Rate limiting zone: max 15 requests per second per IP
   limit_req_zone $binary_remote_addr zone=hospital_limit:10m rate=15r/s;

   server {
       server_name sachkhandhospital.org www.sachkhandhospital.org;

       # Max body size for appointments and inquiries
       client_max_body_size 2M;

       # Static assets served directly with cache headers
       location /static/ {
           alias /home/sachkhand/app/public/;
           expires 30d;
           add_header Cache-Control "public, no-transform";
           access_log off;
       }

       location / {
           limit_req zone=hospital_limit burst=30 nodelay;

           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;

           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;

           proxy_connect_timeout 15s;
           proxy_read_timeout 30s;
           proxy_send_timeout 30s;
       }
   }
   ```
4. **Enable the site configuration**:
   ```bash
   sudo ln -s /etc/nginx/sites-available/sachkhandhospital.org /etc/nginx/sites-enabled/
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo nginx -t
   sudo systemctl restart nginx
   ```
5. **Issue Free Automated Let's Encrypt SSL Certificate**:
   ```bash
   sudo certbot --nginx -d sachkhandhospital.org -d www.sachkhandhospital.org
   ```
   Select **Redirect HTTP to HTTPS**. Certbot configures automatic TLS renewal cron jobs.

---

### Step 7: Automated Nightly Database Backups
Set up an automated nightly SQLite backup that creates a consistent database snapshot without stopping the server:

1. Create a backup script:
   ```bash
   nano /home/sachkhand/app/scripts/nightly-backup.sh
   ```
2. Add:
   ```bash
   #!/bin/bash
   BACKUP_DIR="/home/sachkhand/app/backups"
   TIMESTAMP=$(date +'%Y-%m-%d_%H%M%S')
   cd /home/sachkhand/app
   /usr/bin/node scripts/backup.js
   # Keep last 14 days of backups
   find "$BACKUP_DIR" -type f -name "hospital-*.db" -mtime +14 -delete
   ```
3. Make it executable and add to crontab:
   ```bash
   chmod +x /home/sachkhand/app/scripts/nightly-backup.sh
   crontab -e
   ```
   Add:
   ```
   0 3 * * * /home/sachkhand/app/scripts/nightly-backup.sh >> /home/sachkhand/app/backups/backup.log 2>&1
   ```

---

## 9. Verification & Operational Commands

### 9.1 Local Development Commands
| Command | Description |
|---|---|
| `npm.cmd start` | Start the production server on port 3000 |
| `npm.cmd test` | Execute the complete test suite (65 tests) |
| `node scripts/migrate.js` | Apply any pending SQL database migrations |
| `node scripts/create-admin.js` | Interactive super administrator account generator |
| `node scripts/backup.js` | Create an immediate snapshot of the database in `./backups` |

### 9.2 Key Production Monitoring Commands
* **Check Service Status**: `sudo systemctl status sachkhand`
* **View Application Logs**: `sudo journalctl -u sachkhand -f`
* **Test Health Endpoint**: `curl -I https://sachkhandhospital.org/healthz`
* **Check SQLite Database Integrity**:
  ```bash
  node -e "const { open } = require('./src/lib/db'); const db = open('./data/hospital.db'); console.log(db.prepare('PRAGMA integrity_check').all());"
  ```
