'use strict';
const crypto = require('crypto');
const { all, get, run, tx, isUniqueViolation } = require('../lib/db');
const clock = require('../lib/clock');
const { safeEqual } = require('../lib/security');
const { normalizeMobile } = require('../lib/validation');
const slots = require('./slots');
const { queueSms, queueEmail } = require('./notifications');
const { isHoliday, audit } = require('./settings');

class BookingError extends Error {
  constructor(code, field) { super(code); this.code = code; this.field = field || null; }
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
function newRef() {
  const b = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return `SKH-${s.slice(0, 4)}-${s.slice(4)}`;
}

const TRANSITIONS = {
  Pending: ['Confirmed', 'Rescheduled', 'Cancelled'],
  Confirmed: ['Rescheduled', 'Completed', 'Cancelled', 'No-show'],
  Rescheduled: ['Confirmed', 'Rescheduled', 'Completed', 'Cancelled', 'No-show'],
  Completed: [], Cancelled: [], 'No-show': [],
};
const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

function insertAppointment(db, row) {
  for (let i = 0; i < 5; i++) {
    const ref = newRef();
    try {
      const cols = Object.keys(row);
      const r = run(db, `INSERT INTO appointments(ref,${cols.join(',')}) VALUES (?,${cols.map(() => '?').join(',')})`, ref, ...cols.map((c) => row[c]));
      return { id: Number(r.lastInsertRowid), ref };
    } catch (e) {
      if (isUniqueViolation(e) && /appointments\.ref/.test(e.message)) continue; // ref collision: retry
      throw e;
    }
  }
  throw new Error('could not allocate booking reference');
}
const history = (db, id, from, to, note, userId) =>
  run(db, 'INSERT INTO appointment_status_history(appointment_id,from_status,to_status,note,actor_user_id,created_at) VALUES (?,?,?,?,?,?)', id, from, to, note || null, userId || null, clock.sqlNow());

// ---------- A. doctor consultation request ----------
function createConsultation(db, v) {
  try {
    const out = tx(db, () => {
      const dept = get(db, "SELECT * FROM departments WHERE id=? AND active=1 AND form_type='consultation'", v.department_id);
      if (!dept) throw new BookingError('e_dept', 'department_id');
      if (slots.isPastSlot(v.preferred_date, '23:59') ) throw new BookingError('e_date_past', 'preferred_date');
      if (isHoliday(db, v.preferred_date)) throw new BookingError('e_holiday', 'preferred_date');

      let slotStart = null, slotEnd = null, doctorId = null, slotHeld = false;
      if (v.doctor_id) {
        const doc = slots.doctorBookable(db, v.doctor_id, dept.id);
        if (!doc) throw new BookingError('e_doctor', 'doctor_id');
        doctorId = doc.id;
        if (slots.hasSchedule(db, doc.id)) {
          // Real scheduling data exists: a genuine open slot is required and rechecked here, inside the write transaction.
          if (!v.slot_time) throw new BookingError('e_time_required', 'slot_time');
          if (!slots.slotsFor(db, doc.id, v.preferred_date).includes(v.slot_time)) throw new BookingError('e_slot_unavailable', 'slot_time');
          slotStart = `${v.preferred_date} ${v.slot_time}`;
          slotEnd = slots.slotEnd(db, doc.id, v.preferred_date, v.slot_time);
          slotHeld = true;
        }
      }
      const { id, ref } = insertAppointment(db, {
        type: 'consultation', department_id: dept.id, doctor_id: doctorId,
        patient_name: v.patient_name, mobile: v.mobile, age: v.age, dob: v.dob, gender: v.gender, email: v.email, email_consent: v.email_consent !== undefined ? v.email_consent : 1,
        patient_type: v.patient_type, preferred_date: v.preferred_date, preferred_range: v.preferred_range,
        slot_start: slotStart, slot_end: slotEnd, reason: v.reason, language: v.language, sms_consent: v.sms_consent,
        status: 'Pending', created_at: clock.sqlNow(), updated_at: clock.sqlNow(),
      });
      history(db, id, null, 'Pending', slotHeld ? 'Request received; slot held pending confirmation' : 'Request received');
      const appt = get(db, 'SELECT * FROM appointments WHERE id=?', id);
      queueSms(db, appt, 'received');
      queueEmail(db, appt, 'received');
      return { id, ref, slotHeld };
    });
    return out;
  } catch (e) {
    if (isUniqueViolation(e) && /doctor_id/.test(e.message)) throw new BookingError('e_slot_unavailable', 'slot_time'); // DB-level double-booking guard
    throw e;
  }
}

// ---------- B. diagnostic request ----------
function createDiagnostic(db, v) {
  return tx(db, () => {
    const svc = get(db, `SELECT s.*, d.active AS dept_active FROM services s JOIN departments d ON d.id=s.department_id WHERE s.id=? AND s.active=1 AND s.is_diagnostic=1`, v.service_id);
    if (!svc || !svc.dept_active) throw new BookingError('e_service', 'service_id');
    if (['not_offered', 'temporarily_unavailable'].includes(svc.status)) throw new BookingError('e_service_unavailable', 'service_id');
    if (v.preferred_date < clock.todayIST()) throw new BookingError('e_date_past', 'preferred_date');
    if (isHoliday(db, v.preferred_date)) throw new BookingError('e_holiday', 'preferred_date');
    const inquiryOnly = svc.status === 'to_be_confirmed' ? 1 : 0; // no fictitious slots for unverified services
    const { id, ref } = insertAppointment(db, {
      type: 'diagnostic', department_id: svc.department_id, service_id: svc.id, inquiry_only: inquiryOnly,
      patient_name: v.patient_name, mobile: v.mobile, email: v.email, email_consent: v.email_consent !== undefined ? v.email_consent : 1, preferred_date: v.preferred_date, preferred_range: v.preferred_range,
      referring_doctor: v.referring_doctor, has_referral: v.has_referral, notes: v.notes, language: v.language, sms_consent: v.sms_consent,
      status: 'Pending', created_at: clock.sqlNow(), updated_at: clock.sqlNow(),
    });
    history(db, id, null, 'Pending', inquiryOnly ? 'Inquiry received (service availability unconfirmed)' : 'Request received');
    const appt = get(db, 'SELECT * FROM appointments WHERE id=?', id);
    queueSms(db, appt, 'received');
    queueEmail(db, appt, 'received');
    return { id, ref, inquiryOnly };
  });
}

// ---------- staff workflow ----------
function validateDateTime(date, time) {
  if (!clock.isDate(date) || !clock.isTime(time)) throw new BookingError('e_date_invalid', 'date');
  if (slots.isPastSlot(date, time)) throw new BookingError('e_date_past', 'date');
}

// action: assign | confirm | reschedule | cancel | complete | noshow
function changeStatus(db, { id, action, user, ip, note, doctor_id, date, time, reason }) {
  const result = tx(db, () => {
    const a = get(db, 'SELECT * FROM appointments WHERE id=?', id);
    if (!a) throw new BookingError('e_generic');
    const upd = (sets, params) => {
      const r = run(db, `UPDATE appointments SET ${sets}, updated_at=? WHERE id=? AND status=?`, ...params, clock.sqlNow(), a.id, a.status);
      if (r.changes !== 1) throw new BookingError('e_generic'); // concurrent change
    };
    const resolveSlot = (docId) => {
      // returns { slotStart, slotEnd } validated against schedule/holidays/leave/other bookings
      validateDateTime(date, time);
      if (isHoliday(db, date)) throw new BookingError('e_holiday', 'date');
      if (docId) {
        if (!slots.slotsFor(db, docId, date, { ignoreAppointmentId: a.id }).includes(time)) throw new BookingError('e_slot_unavailable', 'time');
        return { slotStart: `${date} ${time}`, slotEnd: slots.slotEnd(db, docId, date, time) };
      }
      return { slotStart: `${date} ${time}`, slotEnd: null };
    };

    if (action === 'assign') {
      if (a.type !== 'consultation' || !['Pending', 'Rescheduled'].includes(a.status)) throw new BookingError('e_generic');
      const doc = slots.doctorBookable(db, Number(doctor_id), a.department_id);
      if (!doc) throw new BookingError('e_doctor', 'doctor_id');
      // changing doctor releases any held slot (it belonged to the previous doctor)
      upd('doctor_id=?, slot_start=NULL, slot_end=NULL', [doc.id]);
      history(db, a.id, a.status, a.status, `Doctor assigned (#${doc.id})`, user && user.id);
      audit(db, user, 'appointment.assign', 'appointment', a.id, `doctor ${doc.id}`, ip);
      return { id: a.id, notify: null };
    }

    const map = { confirm: 'Confirmed', reschedule: 'Rescheduled', cancel: 'Cancelled', complete: 'Completed', noshow: 'No-show' };
    const to = map[action];
    if (!to) throw new BookingError('e_generic');
    if (!canTransition(a.status, to)) throw new BookingError('e_generic');

    if (to === 'Confirmed' || to === 'Rescheduled') {
      let slot;
      if (a.type === 'consultation') {
        if (!a.doctor_id) throw new BookingError('e_doctor', 'doctor_id'); // a doctor must be assigned first
        const docOk = slots.doctorBookable(db, a.doctor_id, a.department_id);
        if (!docOk) throw new BookingError('e_doctor', 'doctor_id');
        if (!date && !time && to === 'Confirmed' && a.slot_start) {
          const [d, t] = a.slot_start.split(' ');
          date = d; time = t; // confirm the held slot (re-validated)
        }
        slot = resolveSlot(a.doctor_id);
      } else {
        slot = resolveSlot(null);
      }
      upd('status=?, slot_start=?, slot_end=?', [to, slot.slotStart, slot.slotEnd]);
    } else if (to === 'Cancelled') {
      if (!reason || !String(reason).trim()) throw new BookingError('e_required', 'reason');
      upd('status=?, cancel_reason=?', [to, String(reason).trim().slice(0, 300)]);
    } else {
      upd('status=?', [to]);
    }
    history(db, a.id, a.status, to, to === 'Cancelled' ? reason : note, user && user.id);
    audit(db, user, `appointment.${action}`, 'appointment', a.id, `${a.status} -> ${to}`, ip);
    const fresh = get(db, 'SELECT * FROM appointments WHERE id=?', a.id);
    return { id: a.id, notify: ({ Confirmed: 'confirmed', Rescheduled: 'rescheduled', Cancelled: 'cancelled' })[to] || null, fresh };
  });
  return result;
}
// Called by the route layer after the transaction committed.
function notifyAfterChange(db, result) {
  if (result && result.notify) {
    queueSms(db, result.fresh, result.notify);
    queueEmail(db, result.fresh, result.notify);
  }
}
function changeStatusAndNotify(db, args) {
  try {
    const r = changeStatus(db, args);
    notifyAfterChange(db, r);
    return r;
  } catch (e) {
    if (isUniqueViolation(e)) throw new BookingError('e_slot_unavailable', 'time');
    throw e;
  }
}

// ---------- patient self-service lookup + change requests ----------
function lookupAppointment(db, refInput, mobileInput) {
  const ref = String(refInput || '').trim().toUpperCase();
  const mobile = normalizeMobile(mobileInput);
  if (!/^SKH-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(ref) || !mobile) return null;
  const a = get(db, 'SELECT * FROM appointments WHERE ref=?', ref);
  if (!a || !safeEqual(a.mobile, mobile)) return null; // identical result for "no such ref" and "wrong mobile"
  return a;
}
function createChangeRequest(db, a, { kind, new_date, new_range, note }) {
  if (!['cancel', 'reschedule'].includes(kind)) throw new BookingError('e_choice');
  if (['Completed', 'Cancelled', 'No-show'].includes(a.status)) throw new BookingError('e_generic');
  if (get(db, "SELECT 1 FROM change_requests WHERE appointment_id=? AND status='open'", a.id)) throw new BookingError('change_open');
  run(db, 'INSERT INTO change_requests(appointment_id,kind,new_date,new_range,note) VALUES (?,?,?,?,?)', a.id, kind,
    kind === 'reschedule' ? new_date : null, kind === 'reschedule' ? new_range : null, note ? String(note).slice(0, 300) : null);
}

module.exports = { BookingError, TRANSITIONS, canTransition, createConsultation, createDiagnostic, changeStatus, changeStatusAndNotify, lookupAppointment, createChangeRequest, newRef, history };
