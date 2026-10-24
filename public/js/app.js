(function () {
  'use strict';
  document.documentElement.classList.add('js');
  // Mobile menu
  var btn = document.querySelector('.menu-btn'), nav = document.getElementById('site-nav');
  if (btn && nav) btn.addEventListener('click', function () {
    var open = nav.classList.toggle('open'); btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  // Remember language choice
  document.querySelectorAll('a[data-lang]').forEach(function (a) {
    a.addEventListener('click', function () { document.cookie = 'lang=' + a.dataset.lang + '; Path=/; Max-Age=31536000; SameSite=Lax'; });
  });
  document.querySelectorAll('[data-print]').forEach(function (b) { b.addEventListener('click', function () { window.print(); }); });
  // Focus the error summary when the page loads with errors
  var es = document.getElementById('error-summary'); if (es) es.focus();
  // Backdate prevention on all appointment & change request date fields
  document.querySelectorAll('input[type=date][name=preferred_date], input[type=date][name=new_date]').forEach(function (dInput) {
    var today = new Date().toLocaleDateString('en-CA');
    if (!dInput.min || dInput.min < today) dInput.min = today;
    dInput.addEventListener('change', function () {
      if (dInput.value && dInput.value < dInput.min) {
        dInput.value = dInput.min;
      }
    });
  });

  // Booking form: filter doctors by department and load open slots
  var form = document.getElementById('consult-form');
  if (form) {
    var dept = form.querySelector('[name=department_id]'), doc = form.querySelector('[name=doctor_id]'),
        date = form.querySelector('[name=preferred_date]'), slot = form.querySelector('[name=slot_time]'),
        slotBox = document.getElementById('slot-box'), loadBtn = form.querySelector('[data-load-slots]');
    var filterDocs = function () {
      if (!doc) return; var d = dept.value;
      Array.prototype.forEach.call(doc.options, function (o) { if (!o.value) return; var ok = !d || (o.dataset.dept || '').split(',').indexOf(d) > -1; o.hidden = !ok; o.disabled = !ok; });
      if (doc.selectedOptions[0] && doc.selectedOptions[0].disabled) doc.value = '';
    };
    var loadSlots = function () {
      if (!doc || !slot || !doc.value || !date.value) return;
      if (date.min && date.value < date.min) date.value = date.min;
      fetch('/api/slots?doctor=' + encodeURIComponent(doc.value) + '&date=' + encodeURIComponent(date.value), { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); }).then(function (j) {
          var cur = slot.value; slot.innerHTML = '';
          var first = document.createElement('option'); first.value = ''; first.textContent = '—'; slot.appendChild(first);
          (j.times || []).forEach(function (t) { var o = document.createElement('option'); o.value = t; o.textContent = t; if (t === cur) o.selected = true; slot.appendChild(o); });
          if (slotBox) slotBox.hidden = !(j.hasSchedule);
        }).catch(function () {});
    };
    if (dept) dept.addEventListener('change', filterDocs);
    [doc, date].forEach(function (el) { if (el) el.addEventListener('change', loadSlots); });
    if (loadBtn) loadBtn.hidden = true;
    filterDocs();
  }
})();
