'use strict';
const clock = require('./clock');
const config = require('./config');

const DEV = { '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9' };
const asciiDigits = (s) => String(s).replace(/[०-९]/g, (c) => DEV[c]);

// Returns a normalised 10-digit Indian mobile number, or null.
function normalizeMobile(input) {
  let d = asciiDigits(input || '').replace(/[\s\-().]/g, '');
  if (d.startsWith('+91')) d = d.slice(3);
  else if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}
const str = (v, max = 500) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max + 1);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const ENUM = (v, list) => list.includes(v);

function checkDate(value, errors, field, { allowEmpty = false } = {}) {
  if (!value) { if (!allowEmpty) errors[field] = 'e_required'; return null; }
  if (!clock.isDate(value)) { errors[field] = 'e_date_invalid'; return null; }
  const today = clock.todayIST();
  if (value < today) { errors[field] = 'e_date_past'; return null; }
  if (value > clock.addDays(today, config.maxAdvanceBookingDays)) { errors[field] = 'e_date_far'; return null; }
  return value;
}

function patientCore(b, errors) {
  const v = {};
  v.patient_name = str(b.patient_name, 100);
  if (v.patient_name.length < 2 || v.patient_name.length > 100 || /[<>]/.test(v.patient_name)) errors.patient_name = 'e_name';
  v.mobile = normalizeMobile(b.mobile);
  if (!v.mobile) errors.mobile = 'e_mobile';
  v.language = ENUM(b.language, ['en', 'hi']) ? b.language : 'en';
  v.sms_consent = b.sms_consent === '1' || b.sms_consent === 'on' ? 1 : 0;
  v.email = str(b.email, 254) || null;
  if (v.email && !EMAIL.test(v.email)) errors.email = 'e_email';
  v.email_consent = b.email_consent === '0' ? 0 : 1;
  return v;
}

function validateConsultation(b) {
  const errors = {};
  const v = patientCore(b, errors);
  v.department_id = Number(b.department_id) || null;
  if (!v.department_id) errors.department_id = 'e_dept';
  v.doctor_id = b.doctor_id ? Number(b.doctor_id) || null : null;
  // age or DOB
  const ageRaw = asciiDigits(str(b.age, 3));
  v.dob = str(b.dob, 10) || null;
  v.age = null;
  if (v.dob) {
    if (!clock.isDate(v.dob) || v.dob > clock.todayIST() || v.dob < clock.addDays(clock.todayIST(), -365 * 121)) errors.dob = 'e_dob';
  }
  if (ageRaw !== '') {
    const n = Number(ageRaw);
    if (!/^\d{1,3}$/.test(ageRaw) || n > 120) errors.age = 'e_age'; else v.age = n;
  } else if (!v.dob) errors.age = 'e_age';
  v.gender = b.gender ? (ENUM(b.gender, ['male', 'female', 'other', 'na']) ? b.gender : (errors.gender = 'e_choice', null)) : null;
  v.patient_type = ENUM(b.patient_type, ['new', 'returning']) ? b.patient_type : (errors.patient_type = 'e_choice', null);
  v.preferred_date = checkDate(str(b.preferred_date, 10), errors, 'preferred_date');
  v.slot_time = str(b.slot_time, 5) || null;
  if (v.slot_time && !clock.isTime(v.slot_time)) errors.slot_time = 'e_choice';
  v.preferred_range = ENUM(b.preferred_range, ['morning', 'afternoon', 'evening', 'any']) ? b.preferred_range : 'any';
  v.reason = str(b.reason, 500) || null;
  if (v.reason && v.reason.length > 500) errors.reason = 'e_too_long';
  return { errors, v };
}

function validateDiagnostic(b) {
  const errors = {};
  const v = patientCore(b, errors);
  v.service_id = Number(b.service_id) || null;
  if (!v.service_id) errors.service_id = 'e_service';
  v.preferred_date = checkDate(str(b.preferred_date, 10), errors, 'preferred_date');
  v.preferred_range = ENUM(b.preferred_range, ['morning', 'afternoon', 'evening', 'any']) ? b.preferred_range : 'any';
  v.referring_doctor = str(b.referring_doctor, 100) || null;
  v.has_referral = ENUM(b.has_referral, ['yes', 'no', 'na']) ? b.has_referral : 'na';
  v.notes = str(b.notes, 500) || null;
  if (v.notes && v.notes.length > 500) errors.notes = 'e_too_long';
  return { errors, v };
}

function validateInquiry(b) {
  const errors = {};
  const v = {};
  v.name = str(b.name, 100);
  if (v.name.length < 2 || /[<>]/.test(v.name)) errors.name = 'e_name';
  v.mobile = normalizeMobile(b.mobile);
  if (!v.mobile) errors.mobile = 'e_mobile';
  v.email = str(b.email, 254) || null;
  if (v.email && !EMAIL.test(v.email)) errors.email = 'e_email';
  v.department_id = Number(b.department_id) || null;
  v.message = str(b.message, 1000);
  if (!v.message) errors.message = 'e_required'; else if (v.message.length > 1000) errors.message = 'e_too_long';
  v.language = ENUM(b.language, ['en', 'hi']) ? b.language : 'en';
  return { errors, v };
}

module.exports = { normalizeMobile, validateConsultation, validateDiagnostic, validateInquiry, checkDate, str, EMAIL };
