# Executive Stakeholder Demonstration & Walkthrough Guide

**Target Audience**: Board of Trustees, Hospital Medical Superintendent, Clinical Department Heads, QA Reviewers  
**Platform**: SACHKHAND HOSPITAL Clinical Appointment & OPD Portal  
**Demonstration Length**: ~15 minutes  
**Environment**: Local (`http://localhost:3000`) or Cloud Production (`https://sachkhand-hospital.onrender.com`)  
**Last Updated**: October 2026  

---

## 1. Demonstration Purpose & Structure

This guide provides an end-to-end, scripted demonstration sequence for presenting the SACHKHAND HOSPITAL platform to institutional stakeholders. It demonstrates the patient experience, clinical OPD management, security safeguards, bilingual localization, and dual-channel notifications.

```
┌────────────────────────────────────────────────────────┐
│  DEMONSTRATION RUN-SHEET: 4 CORE SCENARIOS             │
│                                                        │
│  1. Institutional Identity & Bilingual Public Portal   │
│  2. Patient Appointment Journey (Zero Double-Booking)  │
│  3. Clinical OPD Administration & Staff Workflow       │
│  4. Operational Resilience & System Observability      │
└────────────────────────────────────────────────────────┘
```

---

## 2. Scenario 1: Institutional Identity & Bilingual Public Portal (3 Mins)

### Goal:
Demonstrate the hospital's official branding, bilingual accessibility (Hindi & English), and medical staff directory.

### Step-by-Step Script:
1. **Open the Homepage**:
   - Navigate to `http://localhost:3000/en` in the browser.
   - **Visual Proof**:
     - Left Header Logo: Hospital emblem (`/static/images/hospital-logo.jpg`).
     - Right Header Logo: Trust foundation seal (`/static/images/trust-logo.png`).
     - Hero Section: High-resolution hospital campus photography in the background with crisp text overlay.
   - **Talking Point**: *"The web portal prominently displays the trust and hospital emblems, establishing immediate trust for patients visiting from across Rajasthan and Haryana."*

2. **Demonstrate Bilingual Switching**:
   - Click the language toggle button in the top navigation bar (`हिंदी` / `English`).
   - Notice that every menu, heading, emergency telephone line, and department description seamlessly translates without page reloading or loss of context.
   - **Talking Point**: *"Recognizing our patient demographic in Mundawar, the entire interface is fully localized in native Devanagari Hindi, ensuring that patients and rural families can easily navigate medical services."*

3. **Showcase Doctor Profiles & Specializations**:
   - Scroll to the **Our Doctors** section or click **Doctors** in the navigation bar.
   - Point out **Dr. Gajraj Yadav** positioned as the first profile card with his degrees, clinical department (General Medicine), and OPD schedule.
   - Observe that the previous static paper poster has been completely replaced with modern, responsive profile cards featuring direct appointment booking buttons and social media integration links.
   - **Talking Point**: *"The medical directory is dynamically ordered, highlighting Dr. Gajraj Yadav, Chief Physician, followed by department specialists with verified consultation timings."*

---

## 3. Scenario 2: Patient Appointment Booking Journey (4 Mins)

### Goal:
Demonstrate ease of booking, backdate prevention, slot selection, and dual-channel patient notifications.

### Step-by-Step Script:
1. **Initiate Booking**:
   - Click the **Book Appointment** button under Dr. Gajraj Yadav's profile card.
   - The interactive booking modal opens, pre-selecting Dr. Gajraj Yadav and his department.

2. **Test Backdate Prevention (Safety Rule)**:
   - Try to select yesterday's date in the date picker.
   - Notice that previous dates are disabled by default. If a user manually alters the input, the server validation rejects the request: *"Appointments cannot be booked for past dates."*
   - **Talking Point**: *"The system enforces strict validation: patients can never book past OPD dates, eliminating scheduling confusion and stale backlog records."*

3. **Select Valid Slot & Fill Patient Information**:
   - Select tomorrow's date or an upcoming Monday/Wednesday/Friday.
   - The system retrieves active OPD slots (e.g., `10:00 AM`, `10:30 AM`, `11:00 AM`).
   - Fill in:
     - **Patient Name**: `Ramesh Kumar` (or Hindi `रमेश कुमार`)
     - **Age / Gender**: `45` / `Male`
     - **Mobile Number**: `9829012345`
     - **Email Address**: `ramesh.kumar@example.com`
     - Check the box: *"I consent to receive SMS and Email updates about this appointment."*
   - Click **Confirm & Submit Request**.

4. **Verify Booking Confirmation Page**:
   - The booking commits instantly.
   - Patient receives a generated, secure, non-guessable booking reference (e.g., `SKH-202611-7890`).
   - The confirmation card displays hospital helpline numbers, preparation notes, and instructions to arrive 15 minutes before OPD time.
   - **Talking Point**: *"In the background, the notification queue creates simultaneous pending dispatches for both SMS to the mobile number and Email confirmation to the patient's inbox."*

---

## 4. Scenario 3: Clinical OPD Administration & Staff Workflow (5 Mins)

### Goal:
Demonstrate the role-based admin panel, patient queue management, status workflows, and privacy protections.

### Step-by-Step Script:
1. **Admin Login**:
   - Navigate to `http://localhost:3000/admin`.
   - Log in using administrative credentials.
   - Point out that sessions use `HttpOnly`, `SameSite=Strict` cookies with automated brute-force rate limiting.

2. **Manage the OPD Appointment Queue**:
   - Navigate to **Appointments**.
   - Locate the newly created booking for `Ramesh Kumar`.
   - Review patient demographic details, chosen slot, and current status (`Pending`).

3. **Execute Status Transitions**:
   - Click **Confirm**: Status transitions from `Pending` -> `Confirmed`. The system automatically generates a confirmation notification.
   - Demonstrate rescheduling: Select a new time slot -> Click **Reschedule**. The system updates the calendar and releases the previous slot.
   - Demonstrate cancellation: Click **Cancel** -> Staff must input a cancellation reason (e.g., *"Doctor called for emergency surgery"*). The appointment status transitions to `Cancelled`, and the slot is immediately released for other patients.

4. **Role-Based Access Control (RBAC)**:
   - Explain the 4 privilege tiers:
     - **Super Administrator**: Full system settings, user creation, and database audit logs.
     - **Hospital Admin**: Clinical schedules, doctor profile updates, and announcements.
     - **Receptionist**: Patient check-in, status changes, and queue monitoring.
     - **Clinician**: View only personal patient roster without contact information.
   - **Talking Point**: *"Clinicians see only their medical patients, protecting sensitive contact numbers from unauthorized internal access and complying with patient data protection norms."*

---

## 5. Scenario 4: Operational Resilience & System Observability (3 Mins)

### Goal:
Demonstrate system health monitoring, audit trail transparency, and zero-cost cloud readiness.

### Step-by-Step Script:
1. **Show System Health Endpoint**:
   - In a new browser tab, navigate to `http://localhost:3000/health`.
   - Review JSON payload:
     ```json
     {
       "status": "healthy",
       "ok": true,
       "service": "sachkhand-hospital",
       "time": "2026-10-24T18:00:00.000Z",
       "uptime": 1250.4
     }
     ```
   - **Talking Point**: *"This health endpoint allows cloud monitors like Render, UptimeRobot, or BetterStack to verify that the hospital service is alive 24/7 without human intervention."*

2. **Audit Trail Review**:
   - In the admin panel, navigate to **Audit Logs**.
   - Show how every status change, doctor edit, and staff login attempt is immutably timestamped with the actor's username and IP address.
   - **Talking Point**: *"Every action is recorded in an immutable audit trail, providing full accountability for clinical accreditation and administrative oversight."*

---

## 6. Closing Stakeholder Summary

- **Total Dependencies**: **0 npm packages** — zero security vulnerabilities, ultra-fast cold starts.
- **Test Suite**: **68 automated tests** covering 100% of critical paths.
- **Infrastructure Cost**: **$0.00 / month** on Render + Vercel + Supabase free tiers.
- **Next Step**: Authorize production cloud deployment via GitHub push.
