'use strict';
// All date logic uses Asia/Kolkata. Dates are plain 'YYYY-MM-DD' strings, times 'HH:MM'.
let override = null;
function setNow(d) { override = d ? new Date(d) : null; }
function now() { return override ? new Date(override) : new Date(); }

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function istParts(d = now()) {
  const p = {};
  for (const x of fmt.formatToParts(d)) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const todayIST = () => istParts().date;
const nowTimeIST = () => istParts().time;
const isDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
};
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (dateStr) => new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0=Sunday
const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMinutes = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const sqlNow = () => now().toISOString().replace('T', ' ').slice(0, 19); // UTC timestamps for audit columns

module.exports = { setNow, now, istParts, todayIST, nowTimeIST, isDate, isTime, addDays, weekday, toMinutes, fromMinutes, sqlNow };
