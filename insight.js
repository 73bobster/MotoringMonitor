// Shared by the Dashboard and Reports: the reporting period, and the sums behind mileage, cost and downtime.
import { html, todayStr, addDaysISO, fmtDateShort } from './ui.js';

// ---- Reporting period (remembered for the session so Dashboard and Reports agree) ------------
const KEY = 'fm:period';
export const PRESETS = [['last7', 'Last 7 days'], ['last30', 'Last 30 days'], ['last90', 'Last 90 days'], ['thisMonth', 'This month'], ['lastMonth', 'Last month'], ['ytd', 'Year to date']];
const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export function presetRange(key, today = todayStr()) {
  const [y, m] = today.split('-').map(Number);
  switch (key) {
    case 'last7': return { from: addDaysISO(today, -6), to: today };
    case 'last90': return { from: addDaysISO(today, -89), to: today };
    case 'thisMonth': return { from: iso(y, m - 1, 1), to: today };
    case 'lastMonth': { const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 11 : m - 2; return { from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)) }; }
    case 'ytd': return { from: iso(y, 0, 1), to: today };
    default: return { from: addDaysISO(today, -29), to: today };
  }
}
export function loadPeriod() {
  try { const p = JSON.parse(sessionStorage.getItem(KEY)); if (p?.from && p?.to) return p; } catch { /* use the default */ }
  return { preset: 'last30', ...presetRange('last30') };
}
export const savePeriod = (p) => { try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch { /* not remembered */ } };
export const daysInPeriod = (p) => Math.round((new Date(`${p.to}T00:00:00`) - new Date(`${p.from}T00:00:00`)) / 86400000) + 1;
export const periodLabel = (p) => `${fmtDateShort(p.from)} to ${fmtDateShort(p.to)} (${daysInPeriod(p)} days)`;
export const inPeriod = (date, p) => !!date && date >= p.from && date <= p.to;

// Period controls: preset buttons and two dates. Calls onChange(period) when anything changes.
export function periodControlsHtml(p) {
  return html`<div class="period" role="group" aria-label="Reporting period">
    <select class="period-select" id="p-preset" aria-label="Reporting period">${PRESETS.map(([k, l]) => html`<option value="${k}" ${p.preset === k ? 'selected' : ''}>${l}</option>`)}<option value="custom" ${p.preset === 'custom' ? 'selected' : ''}>Custom dates</option></select>
    <div class="seg">${PRESETS.map(([k, l]) => html`<button type="button" class="seg-btn" data-action="preset" data-preset="${k}" aria-pressed="${String(p.preset === k)}">${l}</button>`)}</div>
    <div class="field inline-field"><label for="p-from">From</label><input type="date" id="p-from" value="${p.from}" max="${p.to}"></div>
    <div class="field inline-field"><label for="p-to">To</label><input type="date" id="p-to" value="${p.to}" min="${p.from}"></div>
  </div>`;
}
export function wirePeriod(root, p, onChange) {
  const apply = (next) => { Object.assign(p, next); savePeriod(p); onChange(p); };
  if (root._periodClick) root.removeEventListener('click', root._periodClick);
  root._periodClick = (e) => {
    const b = e.target.closest('[data-action="preset"]'); if (!b || !root.contains(b)) return;
    e.preventDefault(); apply({ preset: b.dataset.preset, ...presetRange(b.dataset.preset) });
  };
  root.addEventListener('click', root._periodClick);
  root.querySelector('#p-preset')?.addEventListener('change', (e) => { if (e.target.value !== 'custom') apply({ preset: e.target.value, ...presetRange(e.target.value) }); });
  const from = root.querySelector('#p-from'); const to = root.querySelector('#p-to');
  const custom = () => { if (from.value && to.value && from.value <= to.value) apply({ preset: 'custom', from: from.value, to: to.value }); };
  from.addEventListener('change', custom); to.addEventListener('change', custom);
}

// ---- Mileage ---------------------------------------------------------------------------------
// rows come from api.milesInPeriod: { vehicle_id, start_date, start_mileage, end_date, end_mileage }.
// Returns Map(vehicle_id -> { start, end, miles, days, perDay }).
export function milesFromRows(rows) {
  const out = new Map();
  for (const r of rows) {
    const start = r.start_date ? { reading_date: r.start_date, mileage: r.start_mileage } : null;
    const end = r.end_date ? { reading_date: r.end_date, mileage: r.end_mileage } : null;
    if (!start || !end || end.reading_date < start.reading_date || end.mileage < start.mileage) { out.set(r.vehicle_id, { start, end, miles: 0, days: 0, perDay: null }); continue; }
    const days = Math.round((new Date(`${end.reading_date}T00:00:00`) - new Date(`${start.reading_date}T00:00:00`)) / 86400000);
    const miles = end.mileage - start.mileage;
    out.set(r.vehicle_id, { start, end, miles, days, perDay: days > 0 ? miles / days : null });
  }
  return out;
}

// Lease or finance mileage against the cap, projected to the end of the term.
export function leaseProjection(v, latestMileage, today = todayStr()) {
  if (!v.capped_miles || !v.term_end || latestMileage == null) return null;
  const start = v.term_start || v.date_acquired; if (!start) return null;
  const days = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
  const used = latestMileage - Number(v.opening_mileage || 0);
  const elapsed = days(start, today); const total = days(start, v.term_end);
  const projected = elapsed >= 30 && total > 0 ? Math.round((used / elapsed) * total) : null;
  return { cap: v.capped_miles, used, projected, over: projected != null && projected > v.capped_miles };
}

// ---- Downtime ---------------------------------------------------------------------------------
const dayDiff = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
// Days of the period during which an event had the vehicle out of service. A day it came back counts as available.
export function eventDaysInPeriod(e, p, today = todayStr()) {
  const end = e.returned_on ? addDaysISO(e.returned_on, -1) : (e.from_date > today ? null : today);
  if (!end || end < e.from_date) return e.returned_on && e.returned_on === e.from_date && inPeriod(e.from_date, p) ? 1 : 0;
  const a = e.from_date > p.from ? e.from_date : p.from; const b = end < p.to ? end : p.to;
  return b < a ? 0 : dayDiff(a, b) + 1;
}
export const eventTouchesPeriod = (e, p, today = todayStr()) => eventDaysInPeriod(e, p, today) > 0;
