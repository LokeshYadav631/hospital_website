(function () {
  'use strict';
  document.documentElement.classList.add('js');
  // Mobile menu with outside-click & escape key dismissal
  var btn = document.querySelector('.menu-btn'), nav = document.getElementById('site-nav');
  if (btn && nav) {
    var icon = btn.querySelector('.menu-icon');
    var toggleMenu = function (state) {
      var shouldOpen = typeof state === 'boolean' ? state : !nav.classList.contains('open');
      if (shouldOpen) {
        nav.classList.add('open');
        if (icon) icon.textContent = '✕';
      } else {
        nav.classList.remove('open');
        if (icon) icon.textContent = '☰';
      }
      btn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    };
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMenu();
    });
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        if (window.innerWidth <= 960) toggleMenu(false);
      });
    });
    document.addEventListener('click', function (e) {
      if (nav.classList.contains('open') && !nav.contains(e.target) && e.target !== btn) {
        toggleMenu(false);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        toggleMenu(false);
        btn.focus();
      }
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 960 && nav.classList.contains('open')) {
        toggleMenu(false);
      }
    });
  }
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
      var isHi = document.documentElement.lang === 'hi';
      slot.innerHTML = '<option value="">' + (isHi ? '⏳ स्लॉट लोड हो रहे हैं...' : '⏳ Loading available slots...') + '</option>';
      slot.disabled = true;
      fetch('/api/slots?doctor=' + encodeURIComponent(doc.value) + '&date=' + encodeURIComponent(date.value), { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); }).then(function (j) {
          slot.disabled = false;
          var cur = slot.value; slot.innerHTML = '';
          var first = document.createElement('option'); first.value = ''; first.textContent = '—'; slot.appendChild(first);
          (j.times || []).forEach(function (t) { var o = document.createElement('option'); o.value = t; o.textContent = t; if (t === cur) o.selected = true; slot.appendChild(o); });
          if (slotBox) slotBox.hidden = !(j.hasSchedule);
        }).catch(function () { slot.disabled = false; });
    };
    if (dept) dept.addEventListener('change', filterDocs);
    [doc, date].forEach(function (el) { if (el) el.addEventListener('change', loadSlots); });
    if (loadBtn) loadBtn.hidden = true;
    filterDocs();
  }

  // Enhanced Form Processing & Anti-Double-Submission Feedback
  document.querySelectorAll('form').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (f.dataset.submitting === 'true') {
        e.preventDefault();
        return;
      }
      var submitBtn = f.querySelector('button[type=submit], input[type=submit]');
      if (submitBtn) {
        if (!f.noValidate && f.checkValidity && !f.checkValidity()) {
          return;
        }
        f.dataset.submitting = 'true';
        var origHtml = submitBtn.innerHTML;
        var isHi = document.documentElement.lang === 'hi' || document.body.classList.contains('lang-hi');
        var busyText = isHi ? 'कृपया प्रतीक्षा करें...' : 'Processing...';
        submitBtn.innerHTML = '<span class="btn-spinner" aria-hidden="true">⏳</span> ' + busyText;
        submitBtn.classList.add('is-processing');
        setTimeout(function () {
          submitBtn.innerHTML = origHtml;
          submitBtn.classList.remove('is-processing');
          delete f.dataset.submitting;
        }, 10000);
      }
    });
  });

  // Smart Mobile Phone Number Normalization
  document.querySelectorAll('input[type=tel], input[name=mobile]').forEach(function (inp) {
    inp.addEventListener('input', function () {
      var val = inp.value.replace(/[^\d+]/g, '');
      if (val.indexOf('+91') === 0 && val.length > 3) val = val.slice(3).replace(/\D/g, '');
      else if (val.charAt(0) === '0' && val.length > 10) val = val.slice(1).replace(/\D/g, '');
      else val = val.replace(/\D/g, '');
      if (val.length > 10) val = val.slice(0, 10);
      if (inp.value !== val && val.length <= 10) inp.value = val;
    });
  });

  // Auto-Capitalize Reference Numbers
  document.querySelectorAll('input[name=reference], input[name=ref]').forEach(function (inp) {
    inp.addEventListener('input', function () {
      inp.value = inp.value.toUpperCase().replace(/\s+/g, '');
    });
  });

  // 1-Click Copy Reference Number
  document.querySelectorAll('[data-copy-ref]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var ref = btn.getAttribute('data-copy-ref');
      if (!ref && btn.previousElementSibling) ref = btn.previousElementSibling.textContent.trim();
      if (ref && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ref).then(function () {
          var orig = btn.textContent;
          btn.textContent = '✓ ' + (document.documentElement.lang === 'hi' ? 'कॉपी हो गया' : 'Copied!');
          btn.classList.add('btn-copied');
          setTimeout(function () {
            btn.textContent = orig;
            btn.classList.remove('btn-copied');
          }, 2500);
        });
      }
    });
  });
})();
