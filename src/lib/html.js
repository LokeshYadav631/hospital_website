'use strict';
// Tiny auto-escaping template helper. Every interpolated value is HTML-escaped
// unless it is wrapped with raw() or was produced by html``. This is the XSS barrier.
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
function render(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}
function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Raw(out);
}
const raw = (s) => new Raw(s);
// JSON for <script type="application/ld+json">: escape "<" to avoid </script> breakouts
const jsonForScript = (o) => raw(JSON.stringify(o).replace(/</g, '\\u003c'));
module.exports = { html, raw, esc, Raw, render, jsonForScript };
