// UI toolkit: escaped-by-default templating, dates, forms, modals, toasts.
import { STATUS_LABEL } from './domain.js';

// ---- Templating ---------------------------------------------------------
// html`...` escapes every interpolated value unless it is itself html`...` or raw(...).
// Use raw() only for markup you wrote yourself, never for data from the database or the user.
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ENT[c]);
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s ?? ''));
const part = (v) => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(part).join('') : v === null || v === undefined || v === false ? '' : esc(v));
export const html = (strings, ...vals) => {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Safe(out);
};
export const mount = (el, safe) => { el.innerHTML = safe instanceof Safe ? safe.s : esc(safe); };
export const isSafe = (v) => v instanceof Safe;

// Click delegation: <button data-action="save"> calls handlers.save(el, event).
export function on(root, handlers) {
  root.onclick = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const fn = handlers[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
  };
}

// ---- Dates and numbers --------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => toISO(new Date());
export const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDaysISO = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return toISO(d); };
const dateLong = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const dateShort = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (s) => (s ? dateLong.format(parseISO(String(s).slice(0, 10))) : '');
export const fmtDateShort = (s) => (s ? dateShort.format(parseISO(String(s).slice(0, 10))) : '');
export const fmtDateTime = (s) => (s ? dateTime.format(new Date(s)) : '');
export const fmtInt = (n) => (n === null || n === undefined ? '' : new Intl.NumberFormat('en-GB').format(n));
export const fmtMoney = (n, cur = 'GBP') => (n === null || n === undefined ? '' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(n));
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export function dueText(days) {
  if (days === null || days === undefined) return 'No date set';
  if (days < 0) return `${plural(-days, 'day')} overdue`;
  if (days === 0) return 'Due today';
  return `Due in ${plural(days, 'day')}`;
}

// ---- Small components ---------------------------------------------------
const ICONS = {
  tasks: '<path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
  vehicles: '<path d="M3 16V7h11v9M14 10h4l3 3v3h-3M3 16h2M9 16h6M19 16h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  drivers: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  insurance: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  reports: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  audit: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  incidents: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  garages: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};
export const icon = (name) => raw(`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`);

// UK registration plate. Current-format plates get the conventional gap.
export function formatReg(reg) {
  const r = String(reg || '').toUpperCase().replace(/\s+/g, '');
  const m = /^([A-Z]{2}\d{2})([A-Z]{3})$/.exec(r);
  return m ? `${m[1]} ${m[2]}` : String(reg || '').toUpperCase().trim();
}
export const plate = (reg) => html`<span class="plate" role="img" aria-label="Registration ${formatReg(reg)}">${formatReg(reg)}</span>`;

// A logo image that falls back to the organisation's name as text if the picture cannot load.
export const logoImg = (url, name, extraClass = '') => (url
  ? html`<img class="logo" src="${url}" alt="${name}" data-name="${name}" data-class="${extraClass}" referrerpolicy="no-referrer">`
  : html`<span class="logo-text ${extraClass}">${name}</span>`);
export function wireLogos(root) {
  root.querySelectorAll('img.logo').forEach((img) => {
    img.addEventListener('error', () => {
      const s = document.createElement('span');
      s.className = `logo-text ${img.dataset.class || ''}`.trim();
      s.textContent = img.dataset.name || '';
      img.replaceWith(s);
    }, { once: true });
  });
}

export const facts = (pairs) => html`<dl class="facts">${pairs.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;

export const pill = (status) => html`<span class="pill pill-${status}">${STATUS_LABEL[status] || status}</span>`;
export const loadingHtml = (text = 'Loading') => html`<p class="loading" role="status">${text}</p>`;
export const emptyHtml = (title, text = '', actionHtml = '') => html`<div class="empty"><h2>${title}</h2>${text ? html`<p>${text}</p>` : ''}${actionHtml}</div>`;
export const errorHtml = (msg) => html`<div class="empty empty-error" role="alert"><h2>That didn't load</h2><p>${msg}</p><p><button class="btn" type="button" data-action="reload">Try again</button></p></div>`;

// ---- Toasts -------------------------------------------------------------
export function toast(msg, kind = 'ok') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3500);
}

// ---- Forms --------------------------------------------------------------
const optPair = (o) => (Array.isArray(o) ? o : [o.value ?? o, o.label ?? o]);

export function field(f, values = {}) {
  const has = values[f.name] !== undefined && values[f.name] !== null;
  const cur = has ? values[f.name] : f.value ?? '';
  const id = `f-${f.name}`;
  const req = f.required ? raw(' required') : '';
  const attrs = html`id="${id}" name="${f.name}"${req}`;
  if (f.type === 'checkbox') {
    return html`<div class="field ${f.span === 2 ? 'span-2' : ''}"><label class="check"><input type="checkbox" id="${id}" name="${f.name}" ${cur ? raw('checked') : ''}> <span>${f.label}</span></label>${f.hint ? html`<p class="hint">${f.hint}</p>` : ''}</div>`;
  }
  let control;
  if (f.type === 'textarea') {
    control = html`<textarea ${attrs} rows="${f.rows || 3}">${cur}</textarea>`;
  } else if (f.type === 'select') {
    const opts = (f.options || []).map(optPair).map(([v, l]) => html`<option value="${v}" ${String(v) === String(cur) ? raw('selected') : ''}>${l}</option>`);
    const blank = f.required && cur ? [] : [html`<option value="">${f.blank || (f.required ? 'Choose' : 'Not set')}</option>`];
    control = html`<select ${attrs}>${blank}${opts}</select>`;
  } else {
    const extra = ['min', 'max', 'step', 'placeholder', 'autocomplete', 'inputmode', 'maxlength', 'list']
      .filter((k) => f[k] !== undefined)
      .map((k) => html` ${k}="${f[k]}"`);
    control = html`<input type="${f.type || 'text'}" ${attrs} value="${cur}"${extra}>`;
  }
  return html`<div class="field ${f.span === 2 ? 'span-2' : ''}"><label for="${id}">${f.label}${f.required ? html`<span class="req" aria-hidden="true"> *</span>` : ''}</label>${control}${f.hint ? html`<p class="hint">${f.hint}</p>` : ''}</div>`;
}

export const datalist = (id, options) => html`<datalist id="${id}">${options.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</datalist>`;

export const fieldsHtml = (specs, values = {}) => html`<div class="form-grid">${specs.map((f) => field(f, values))}</div>`;

// Reads a form into a plain object: blanks become null, numbers become numbers, checkboxes become booleans.
export function readForm(form, specs) {
  const out = {};
  for (const f of specs) {
    const el = form.elements[f.name];
    if (!el) continue;
    if (f.type === 'checkbox') { out[f.name] = !!el.checked; continue; }
    let v = String(el.value ?? '').trim();
    if (v === '') { out[f.name] = null; continue; }
    if (f.type === 'number') v = Number(v);
    out[f.name] = v;
  }
  return out;
}

// ---- Modal --------------------------------------------------------------
let lastFocus = null;
export function closeModal() {
  const dlg = document.getElementById('dialog');
  if (dlg?.open) dlg.close();
}

// openModal({ title, body, onSubmit, submitLabel, hideFooter, wide, danger })
// onSubmit(form) may throw: the message is shown inside the dialog and it stays open.
export function openModal({ title, body, onSubmit, submitLabel = 'Save', cancelLabel = 'Cancel', hideFooter = false, wide = false, danger = false }) {
  const dlg = document.getElementById('dialog');
  lastFocus = document.activeElement;
  dlg.onclick = null;
  dlg.className = `modal${wide ? ' modal-wide' : ''}`;
  mount(dlg, html`<form class="modal-form" method="dialog">
    <header class="modal-head"><h2 id="dlg-title">${title}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('close')}</button></header>
    <div class="modal-body">${body}<p class="form-error" role="alert" hidden></p></div>
    ${hideFooter ? '' : html`<footer class="modal-foot"><button type="button" class="btn" data-close>${cancelLabel}</button><button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${submitLabel}</button></footer>`}
  </form>`);
  const form = dlg.querySelector('form');
  const errBox = dlg.querySelector('.form-error');
  dlg.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => closeModal(); });
  dlg.onclose = () => { mount(dlg, ''); try { lastFocus?.focus?.(); } catch { /* element gone */ } };
  if (onSubmit) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      try {
        await onSubmit(form);
        closeModal();
      } catch (err) {
        errBox.textContent = err.message || 'Something went wrong.';
        errBox.hidden = false;
        if (btn) btn.disabled = false;
      }
    };
  } else {
    form.onsubmit = (e) => e.preventDefault();
  }
  if (!dlg.open) dlg.showModal();
  return dlg;
}
