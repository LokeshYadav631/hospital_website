'use strict';
const { all, get } = require('../lib/db');
const clock = require('../lib/clock');
const config = require('../lib/config');
const { isHoliday } = require('./settings');

const LIVE = "('Pending','Confirmed','Rescheduled')";

const doctorBookable = (db, doctorId, deptId) => get(db,
  `SELECT d.* FROM doctors d JOIN doctor_departments dd ON dd.doctor_id=d.id
   WHERE d.id=? AND dd.department_id=? AND d.active=1 AND d.published=1`, doctorId, deptId) || null;

const hasSchedule = (db, doctorId) => !!get(db, 'SELECT 1 FROM doctor_schedules WHERE doctor_id=? AND active=1', doctorId);

function isUnavailable(db, doctorId, date) {
  return !!get(db, 'SELECT 1 FROM doctor_unavailability WHERE doctor_id=? AND start_date<=? AND end_date>=?', doctorId, date, date);
}

// Open slots for a doctor on a date. Honors weekly schedule, holidays, leave, existing live bookings and "now".
function slotsFor(db, doctorId, date, { ignoreAppointmentId = null } = {}) {
  const doc = get(db, 'SELECT * FROM doctors WHERE id=? AND active=1', doctorId);
  if (!doc || !clock.isDate(date)) return [];
  const today = clock.todayIST();
  if (date < today || date > clock.addDays(today, config.slotWindowDays + config.maxAdvanceBookingDays)) return [];
  if (isHoliday(db, date) || isUnavailable(db, doctorId, date)) return [];
  const rows = all(db, 'SELECT start_time,end_time FROM doctor_schedules WHERE doctor_id=? AND weekday=? AND active=1 ORDER BY start_time', doctorId, clock.weekday(date));
  const taken = new Set(all(db, `SELECT slot_start FROM appointments WHERE doctor_id=? AND slot_start LIKE ? AND status IN ${LIVE} AND id IS NOT ?`,
    doctorId, date + ' %', ignoreAppointmentId).map((r) => r.slot_start));
  const nowT = clock.nowTimeIST();
  const out = new Set();
  for (const r of rows) {
    for (let m = clock.toMinutes(r.start_time); m + doc.slot_minutes <= clock.toMinutes(r.end_time); m += doc.slot_minutes) {
      const time = clock.fromMinutes(m);
      if (date === today && time <= nowT) continue;
      if (!taken.has(`${date} ${time}`)) out.add(time);
    }
  }
  return [...out].sort();
}

// Dates in the next N days that still have at least one open slot (for the booking UI)
function bookableDates(db, doctorId, days = config.slotWindowDays) {
  const today = clock.todayIST();
  const out = [];
  for (let i = 0; i <= days; i++) {
    const d = clock.addDays(today, i);
    if (slotsFor(db, doctorId, d).length) out.push(d);
  }
  return out;
}

const isPastSlot = (date, time) => date < clock.todayIST() || (date === clock.todayIST() && time <= clock.nowTimeIST());
const slotEnd = (db, doctorId, date, time) => {
  const d = get(db, 'SELECT slot_minutes FROM doctors WHERE id=?', doctorId);
  return `${date} ${clock.fromMinutes(clock.toMinutes(time) + (d ? d.slot_minutes : 15))}`;
};

module.exports = { doctorBookable, hasSchedule, slotsFor, bookableDates, isPastSlot, slotEnd, isUnavailable };
