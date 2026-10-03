// Audit log: every change, searchable by period, vehicle and driver. Visible to fleet admins and the superuser.
import * as api from './api.js';
import { can } from './state.js';
import { html, mount, on, plate, loadingHtml, emptyHtml, todayStr, addDaysISO } from './ui.js';
import { driverName } from './domain.js';
import { auditLookups, historyList } from './history.js';

export async function auditView(main) {
  if (!can.audit) { mount(main, html`<header class="page-head"><h1>Audit log</h1></header>${emptyHtml("You don't have access to the audit log", 'Ask a fleet admin or the superuser.')}`); return; }
  mount(main, html`<header class="page-head"><h1>Audit log</h1></header>${loadingHtml()}`);
  const L = await auditLookups();
  const vehicles = [...L.vehicles.values()].sort((a, b) => a.registration.localeCompare(b.registration));
  const drivers = [...L.drivers.values()];
  const ui = { from: addDaysISO(todayStr(), -30), to: todayStr(), vehicleId: '', driverId: '', readings: false, limit: 200 };

  mount(main, html`
    <header class="page-head"><h1>Audit log</h1></header>
    <p class="muted">Every change made in FleetMonitor: who made it, when, and what it was. It cannot be edited or deleted.</p>
    <form class="filters audit-filters" id="audit-form">
      <div class="field"><label for="a-from">From</label><input type="date" id="a-from" value="${ui.from}"></div>
      <div class="field"><label for="a-to">To</label><input type="date" id="a-to" value="${ui.to}"></div>
      <div class="field"><label for="a-vehicle">Vehicle</label><select id="a-vehicle"><option value="">All vehicles</option>${vehicles.map((v) => html`<option value="${v.id}">${v.registration}</option>`)}</select></div>
      <div class="field"><label for="a-driver">Driver</label><select id="a-driver"><option value="">All drivers</option>${drivers.map((d) => html`<option value="${d.id}">${driverName(d)}</option>`)}</select></div>
      <label class="check small"><input type="checkbox" id="a-readings"> <span>Include mileage readings</span></label>
    </form>
    <p class="presets"><span class="muted">Quick periods:</span>
      <button class="link" data-action="preset" data-days="1">Today</button>
      <button class="link" data-action="preset" data-days="7">Last 7 days</button>
      <button class="link" data-action="preset" data-days="30">Last 30 days</button>
      <button class="link" data-action="preset" data-days="90">Last 90 days</button>
      <button class="link" data-action="preset" data-days="0">Any time</button></p>
    <div id="audit-results">${loadingHtml()}</div>`);
  const box = main.querySelector('#audit-results');

  async function search() {
    mount(box, loadingHtml('Searching'));
    const entries = await api.searchAudit({ from: ui.from || null, to: ui.to || null, vehicleId: ui.vehicleId || null, driverId: ui.driverId || null, includeReadings: ui.readings, limit: ui.limit });
    mount(box, html`<p class="summary"><strong>${entries.length}</strong> ${entries.length === 1 ? 'change' : 'changes'}${entries.length >= ui.limit ? ' (showing the most recent)' : ''}</p>
      ${historyList(entries, L, { subject: true })}
      ${entries.length >= ui.limit ? html`<p><button class="btn" data-action="more">Show more</button></p>` : ''}`);
  }
  const bind = (id, key, isCheck = false) => main.querySelector(id).addEventListener('change', (e) => { ui[key] = isCheck ? e.target.checked : e.target.value; ui.limit = 200; search(); });
  bind('#a-from', 'from'); bind('#a-to', 'to'); bind('#a-vehicle', 'vehicleId'); bind('#a-driver', 'driverId'); bind('#a-readings', 'readings', true);
  main.querySelector('#audit-form').addEventListener('submit', (e) => e.preventDefault());
  on(main, {
    preset: (el) => {
      const days = Number(el.dataset.days);
      ui.to = days ? todayStr() : ''; ui.from = days ? addDaysISO(todayStr(), -(days - 1)) : ''; ui.limit = 200;
      main.querySelector('#a-from').value = ui.from; main.querySelector('#a-to').value = ui.to;
      search();
    },
    more: () => { ui.limit += 200; search(); },
  });
  await search();
}
