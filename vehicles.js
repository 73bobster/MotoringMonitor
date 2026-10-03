// Vehicles: list, add or edit, dispose, and the detail page with tabs.
import * as api from './api.js';
import { can } from './state.js';
import {
  html, mount, on, plate, pill, facts, fieldsHtml, readForm, openModal, toast, loadingHtml, emptyHtml, errorHtml,
  fmtDate, fmtDateShort, fmtInt, fmtMoney, dueText, todayStr, formatReg,
} from './ui.js';
import {
  CATEGORY_LABEL, FUEL_LABEL, OWNERSHIP_LABEL, VEHICLE_STATUS_LABEL, DISPOSAL_REASON_LABEL, COST_CATEGORY_LABEL, LICENCE_STATUS_LABEL, BLOCKING_LICENCE,
  VEHICLE_DOC_CATEGORIES, UNAVAIL_REASON_LABEL, availability, driverName, vehicleTitle, worstStatus, taskKey,
} from './domain.js';
import { openTaskPanel } from './actions.js';
import { navigate } from './router.js';
import { historyList, auditLookups } from './history.js';
import { incidentTable } from './incidents.js';
import { mountDocuments } from './docs.js';
import { outOfServiceModal, backInServiceModal, extendReturnModal, convertToOffRoadModal, sornDeclaredModal, cancelBookingModal, rescheduleModal } from './availability.js';

const opts = (o) => Object.entries(o);

// ---- List ------------------------------------------------------------------
export async function vehiclesList(main) {
  mount(main, html`<header class="page-head"><h1>Vehicles</h1></header>${loadingHtml('Loading vehicles')}`);
  const [vehicles, tasks, drivers, depots, garages] = await Promise.all([api.listVehicles(), api.listTasks(), api.listDrivers(), api.listAllDepots(), api.listGarages()]);
  const garageName = (id) => garages.find((g) => g.id === id)?.name || 'a garage';
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const depotById = new Map(depots.map((d) => [d.id, d]));
  const ui = { q: '', depot: '', category: '', avail: '', disposed: false, archived: false };
  const groupOf = (v) => { const k = availability(v).key; return k === 'booked' ? 'available' : (k === 'sorn' || k === 'off_road_no_sorn') ? 'off_road' : k; };

  mount(main, html`
    <header class="page-head"><h1>Vehicles</h1>${can.write ? html`<a class="btn btn-primary" href="#/vehicles/new">Add vehicle</a>` : ''}</header>
    <div class="filters">
      <input type="search" id="v-search" placeholder="Search registration, make or driver" aria-label="Search vehicles">
      ${depots.length ? html`<label class="inline"><span class="sr-only">Depot</span><select id="v-depot"><option value="">All depots</option>${depots.filter((d) => !d.archived_at).map((d) => html`<option value="${d.id}">${d.name}</option>`)}</select></label>` : ''}
      <label class="inline"><span class="sr-only">Availability</span><select id="v-avail"><option value="">Any availability</option><option value="available">Available</option><option value="garage">At a garage</option><option value="off_road">Off the road</option></select></label>
      <label class="inline"><span class="sr-only">Type</span><select id="v-cat"><option value="">All types</option>${opts(CATEGORY_LABEL).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label>
      <label class="check small"><input type="checkbox" id="v-disposed"> <span>Include disposed</span></label>
      <label class="check small"><input type="checkbox" id="v-archived"> <span>Include archived</span></label>
    </div>
    <div id="v-table"></div>`);
  const box = main.querySelector('#v-table');

  function draw() {
    const rows = vehicles.filter((v) =>
      (ui.disposed || v.status !== 'disposed') && (ui.archived || !v.archived_at) &&
      (!ui.depot || v.depot_id === ui.depot) && (!ui.category || v.category === ui.category) && (!ui.avail || groupOf(v) === ui.avail) &&
      (!ui.q || [v.registration, v.make, v.model, v.nickname, driverName(driverById.get(v.primary_driver_id))].join(' ').toLowerCase().includes(ui.q)));
    if (!vehicles.length) {
      mount(box, emptyHtml('No vehicles yet', 'Add your first vehicle and its compliance dates will start appearing under Tasks.',
        can.write ? html`<p><a class="btn btn-primary" href="#/vehicles/new">Add a vehicle</a></p>` : ''));
      return;
    }
    if (!rows.length) { mount(box, emptyHtml('No vehicles match', 'Try a different filter, or tick Include disposed or Include archived.')); return; }
    mount(box, html`<table class="grid"><thead><tr><th>Vehicle</th><th>Depot</th><th>Driver</th><th>Insurance</th><th class="num">Mileage</th><th>Compliance</th></tr></thead><tbody>
      ${rows.map((v) => {
        const vt = tasks.filter((t) => t.vehicle_id === v.id && t.applies_to === 'vehicle');
        const worst = worstStatus(vt);
        const overdue = vt.filter((t) => t.status === 'overdue').length;
        const live = v.status === 'active' && !v.archived_at;
        return html`<tr>
          <td data-label="Vehicle"><a class="plate-link" href="#/vehicles/${v.id}">${plate(v.registration)}</a>
            <div class="sub">${vehicleTitle(v)}${v.nickname ? ` (${v.nickname})` : ''}${v.status === 'disposed' ? html` <span class="tag">Disposed</span>` : ''}${v.archived_at ? html` <span class="tag">Archived</span>` : ''}${!v.archived_at && v.status !== 'disposed' && !['available'].includes(availability(v).key) ? html` <span class="tag ${['garage', 'booked'].includes(availability(v).key) ? '' : 'tag-warn'}">${availability(v).label}</span>` : ''}</div>${v.unavailable_garage_id && v.unavailable_reason !== 'off_road' ? html`<div class="sub">${UNAVAIL_REASON_LABEL[v.unavailable_reason]} at ${garageName(v.unavailable_garage_id)}${v.unavailable_expected_return ? `, back ${fmtDateShort(v.unavailable_expected_return)}` : ''}</div>` : ''}</td>
          <td data-label="Depot">${depotById.get(v.depot_id)?.name || ''}</td>
          <td data-label="Driver">${v.primary_driver_id ? html`<a href="#/drivers/${v.primary_driver_id}">${driverName(driverById.get(v.primary_driver_id))}</a>` : html`<span class="muted">${live ? 'Unassigned' : ''}</span>`}</td>
          <td data-label="Insurance">${v.insured_until ? html`Until ${fmtDateShort(v.insured_until)}` : live ? html`<span class="c-overdue"><strong>No cover</strong></span>` : ''}</td>
          <td data-label="Mileage" class="num">${v.latest_mileage != null ? fmtInt(v.latest_mileage) : html`<span class="muted">None logged</span>`}</td>
          <td data-label="Compliance">${live && worst ? html`${pill(worst)}${overdue ? html` <span class="sub c-overdue">${overdue} overdue</span>` : ''}` : html`<span class="muted">${live ? 'None tracked' : ''}</span>`}</td>
        </tr>`;
      })}</tbody></table>`);
  }
  main.querySelector('#v-search').addEventListener('input', (e) => { ui.q = e.target.value.trim().toLowerCase(); draw(); });
  main.querySelector('#v-depot')?.addEventListener('change', (e) => { ui.depot = e.target.value; draw(); });
  main.querySelector('#v-cat').addEventListener('change', (e) => { ui.category = e.target.value; draw(); });
  main.querySelector('#v-avail').addEventListener('change', (e) => { ui.avail = e.target.value; draw(); });
  main.querySelector('#v-disposed').addEventListener('change', (e) => { ui.disposed = e.target.checked; draw(); });
  main.querySelector('#v-archived').addEventListener('change', (e) => { ui.archived = e.target.checked; draw(); });
  draw();
}

// ---- Form ------------------------------------------------------------------
const sections = (depots, existing) => [
  { title: 'Identity', specs: [
    { name: 'registration', label: 'Registration', required: true, autocomplete: 'off' },
    { name: 'fleet_number', label: 'Fleet number' },
    { name: 'nickname', label: 'Nickname' },
    { name: 'category', label: 'Type', type: 'select', required: true, options: opts(CATEGORY_LABEL) },
    { name: 'depot_id', label: 'Depot', type: 'select', blank: 'No depot', options: depots.filter((d) => !d.archived_at || d.id === existing?.depot_id).map((d) => [d.id, d.name]), hint: depots.length ? '' : 'Depots are set up under Settings.' },
    ...(existing?.status === 'disposed' ? [] : [{ name: 'status', label: 'Status', type: 'select', required: true, options: [['active', 'Active'], ['off_road', 'Off the road']], hint: 'To remove a vehicle from the fleet, use Dispose on its page.' }]),
  ] },
  { title: 'Details', specs: [
    { name: 'make', label: 'Make' }, { name: 'model', label: 'Model' },
    { name: 'body_type', label: 'Body type' }, { name: 'colour', label: 'Colour' },
    { name: 'vin', label: 'VIN', autocomplete: 'off' }, { name: 'first_registered_date', label: 'First registered', type: 'date' },
    { name: 'year_of_manufacture', label: 'Year of manufacture', type: 'number', min: '1900', max: '2100', step: '1' },
    { name: 'fuel_type', label: 'Fuel', type: 'select', options: opts(FUEL_LABEL) },
    { name: 'gross_weight_kg', label: 'Gross weight (kg)', type: 'number', min: '1', step: '1', hint: 'Over 3,500 kg usually means tachograph and operator licence rules apply.' },
    { name: 'payload_kg', label: 'Allowable payload (kg)', type: 'number', min: '1', step: '1', hint: 'The most it may carry: gross weight minus unladen weight, both shown on the V5C.' },
    { name: 'seats', label: 'Seats', type: 'number', min: '0', step: '1' },
    { name: 'mpg', label: 'Fuel economy (mpg)', type: 'number', min: '0', step: '0.1' },
  ] },
  { title: 'Ownership', specs: [
    { name: 'ownership_type', label: 'Ownership', type: 'select', required: true, options: opts(OWNERSHIP_LABEL) },
    { name: 'date_acquired', label: 'Date acquired', type: 'date' },
    { name: 'opening_mileage', label: 'Mileage when acquired', type: 'number', min: '0', step: '1' },
    { name: 'purchase_price', label: 'Purchase price (£)', type: 'number', min: '0', step: '0.01' },
    { name: 'monthly_payment', label: 'Monthly payment (£)', type: 'number', min: '0', step: '0.01', hint: 'Leased, financed or rented vehicles.' },
    { name: 'term_start', label: 'Term start', type: 'date' },
    { name: 'term_end', label: 'Term end', type: 'date', hint: 'The lease, rental or finance end date. A task warns you 90, 60 and 30 days ahead.' },
    { name: 'capped_miles', label: 'Mileage cap over the term', type: 'number', min: '1', step: '1' },
    { name: 'cost_per_excess_mile', label: 'Cost per excess mile (£)', type: 'number', min: '0', step: '0.001' },
  ] },
  { title: 'Notes', specs: [{ name: 'notes', label: 'Notes', type: 'textarea', span: 2, rows: 4 }] },
];

export async function vehicleForm(main, { id }) {
  const editing = id && id !== 'new';
  mount(main, loadingHtml());
  const [depots, existing] = await Promise.all([api.listAllDepots(), editing ? api.getVehicle(id) : null]);
  if (editing && !existing) { mount(main, emptyHtml('Vehicle not found', 'It may have been removed.', html`<p><a class="btn" href="#/vehicles">Back to vehicles</a></p>`)); return; }
  if (!can.write) { mount(main, emptyHtml('You can view vehicles but not change them', '', html`<p><a class="btn" href="#/vehicles">Back to vehicles</a></p>`)); return; }
  const secs = sections(depots, existing);
  const specs = secs.flatMap((s) => s.specs);
  const values = existing || { category: 'van', status: 'active', ownership_type: 'owned' };
  const back = editing ? `#/vehicles/${id}` : '#/vehicles';
  mount(main, html`
    <header class="page-head"><h1>${editing ? `Edit ${formatReg(existing.registration)}` : 'Add vehicle'}</h1></header>
    <form class="page-form" id="vehicle-form">
      ${secs.map((s) => html`<fieldset><legend>${s.title}</legend>${fieldsHtml(s.specs, values)}</fieldset>`)}
      <p class="form-error" role="alert" hidden></p>
      <div class="form-actions"><button class="btn btn-primary" type="submit">${editing ? 'Save changes' : 'Add vehicle'}</button><a class="btn" href="${back}">Cancel</a></div>
    </form>`);
  const form = main.querySelector('#vehicle-form');
  const err = form.querySelector('.form-error');
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const v = readForm(form, specs);
      v.registration = v.registration.toUpperCase().replace(/\s+/g, ' ').trim();
      const row = await api.saveVehicle(v, editing ? id : null);
      toast(editing ? 'Vehicle saved.' : 'Vehicle added. Set its compliance dates next.');
      navigate(`#/vehicles/${row.id}${editing ? '' : '?tab=compliance'}`);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  };
}

// ---- Disposal ----------------------------------------------------------------
export function disposeModal(v) {
  const specs = [
    { name: 'disposed_date', label: 'Date disposed of', type: 'date', required: true, max: todayStr() },
    { name: 'disposal_reason', label: 'Reason', type: 'select', required: true, options: opts(DISPOSAL_REASON_LABEL) },
    { name: 'sale_price', label: 'Sale price (£)', type: 'number', step: '0.01', min: '0' },
    { name: 'sold_to', label: 'Sold to', type: 'text' },
    { name: 'disposal_notes', label: 'Notes', type: 'textarea', span: 2 },
  ];
  const dlg = openModal({
    title: `Dispose of ${formatReg(v.registration)}`, submitLabel: 'Dispose of vehicle', danger: true,
    body: html`<p class="muted">The vehicle stays in FleetMonitor with all its records and history. This ends its current driver assignment and insurance cover, and adds a task to tell your insurer.</p>${fieldsHtml(specs, { disposed_date: todayStr() })}`,
    onSubmit: async (f) => {
      const x = readForm(f, specs);
      await api.disposeVehicle({ id: v.id, date: x.disposed_date, reason: x.disposal_reason, salePrice: x.sale_price, soldTo: x.sold_to, notes: x.disposal_notes });
      toast('Vehicle disposed of. A task to tell your insurer has been added.');
      navigate(`#/vehicles/${v.id}`);
    },
  });
  const reason = dlg.querySelector('#f-disposal_reason');
  const toggle = () => ['sale_price', 'sold_to'].forEach((n) => { dlg.querySelector(`#f-${n}`).closest('.field').hidden = reason.value !== 'sold'; });
  reason.addEventListener('change', toggle); toggle();
}

// ---- Detail ----------------------------------------------------------------
const TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'compliance', label: 'Compliance' }, { id: 'drivers', label: 'Drivers' }, { id: 'insurance', label: 'Insurance' },
  { id: 'availability', label: 'Availability' }, { id: 'incidents', label: 'Incidents' }, { id: 'costs', label: 'Costs' }, { id: 'documents', label: 'Documents' }, { id: 'readings', label: 'Readings' },
  { id: 'history', label: 'History', when: () => can.audit },
];

export async function vehicleDetail(main, { id }, query) {
  mount(main, loadingHtml());
  const [v, garages] = await Promise.all([api.getVehicle(id), api.listGarages()]);
  if (!v) { mount(main, emptyHtml('Vehicle not found', 'It may have been removed.', html`<p><a class="btn" href="#/vehicles">Back to vehicles</a></p>`)); return; }
  const tab = TABS.find((t) => t.id === query.tab && (!t.when || t.when())) ? query.tab : 'overview';
  const disposed = v.status === 'disposed';
  const av = availability(v);
  const gname = garages.find((g) => g.id === v.unavailable_garage_id)?.name || 'a garage';
  const lateBack = v.unavailable_expected_return && v.unavailable_expected_return < todayStr();
  const again = () => navigate(location.hash);
  const actionsBar = (list) => (can.write ? html`<div class="banner-actions">${list.map(([a, l]) => html`<button class="btn btn-sm" data-action="${a}">${l}</button>`)}</div>` : '');
  const availBanner = disposed || v.archived_at ? '' : av.key === 'garage'
    ? html`<div class="banner-warn"><p>At <strong>${gname}</strong> since ${fmtDate(v.unavailable_since)} for ${UNAVAIL_REASON_LABEL[v.unavailable_reason].toLowerCase()}. ${v.unavailable_expected_return ? html`${lateBack ? html`<strong>Back was due ${fmtDate(v.unavailable_expected_return)}.</strong>` : `Expected back ${fmtDate(v.unavailable_expected_return)}.`}` : 'No return date set.'}</p>${actionsBar([['back-in', 'Back in service'], ['extend', 'Change expected return'], ['to-sorn', 'Record as off the road (SORN)']])}</div>`
    : av.key === 'sorn' ? html`<div class="banner-info"><p>Off the road since ${fmtDate(v.unavailable_since)}. SORN declared ${fmtDate(v.sorn_declared_on)}. Road tax and no-cover reminders are paused until it goes back in service.</p>${actionsBar([['back-in', 'Back in service']])}</div>`
    : av.key === 'off_road_no_sorn' && v.unavailable_event_id ? html`<div class="banner-danger"><p><strong>Off the road since ${fmtDate(v.unavailable_since)} with no SORN recorded.</strong> A vehicle that is not on the road must be taxed or have a SORN.</p>${actionsBar([['sorn', 'Record the SORN'], ['back-in', 'Back in service']])}</div>`
    : av.key === 'off_road_no_sorn' ? html`<div class="banner-warn"><p>Marked as off the road, but there is no record of why or where. Record it properly so the SORN is tracked.</p>${actionsBar([['out-of-service', 'Record it now']])}</div>`
    : av.key === 'booked' ? html`<div class="banner-info"><p>Booked in on ${fmtDate(v.next_booking_date)}. See the Availability tab for the details.</p></div>` : '';
  mount(main, html`
    <header class="page-head head-vehicle">
      <div><p class="crumb"><a href="#/vehicles">Vehicles</a></p><h1>${plate(v.registration)}</h1><p class="sub">${vehicleTitle(v)}${v.nickname ? ` (${v.nickname})` : ''}${v.status !== 'active' ? html` <span class="tag">${VEHICLE_STATUS_LABEL[v.status]}</span>` : ''}${v.archived_at ? html` <span class="tag">Archived</span>` : ''}</p></div>
      ${can.write ? html`<div class="head-actions"><a class="btn" href="#/vehicles/${v.id}/edit">Edit</a>${!disposed && !v.archived_at && ['available', 'booked'].includes(av.key) ? html`<button class="btn" data-action="out-of-service">Out of service</button>` : ''}${!disposed && !v.archived_at ? html`<button class="btn" data-action="dispose">Dispose</button>` : ''}${v.archived_at ? html`<button class="btn" data-action="restore">Restore</button>` : html`<button class="btn" data-action="archive">Archive</button>`}</div>` : ''}
    </header>
    ${disposed ? html`<p class="banner-info">Disposed of on ${fmtDate(v.disposed_date)} (${DISPOSAL_REASON_LABEL[v.disposal_reason] || v.disposal_reason}).${v.sold_to ? ` Sold to ${v.sold_to}${v.sale_price != null ? ` for ${fmtMoney(v.sale_price)}` : ''}.` : ''} Its records and history stay available.</p>` : ''}
    ${availBanner}
    ${v.archived_at ? html`<p class="banner-warn">This vehicle is archived: it is hidden from lists and tasks. Restore it to bring it back.</p>` : ''}
    <nav class="tabs" aria-label="Vehicle sections">${TABS.filter((t) => !t.when || t.when()).map((t) => html`<a class="tab" href="#/vehicles/${v.id}?tab=${t.id}" ${t.id === tab ? html`aria-current="page"` : ''}>${t.label}</a>`)}</nav>
    <div id="tab-body">${loadingHtml()}</div>`);
  on(main, {
    'out-of-service': () => outOfServiceModal(v.id, { onDone: again }),
    'back-in': () => backInServiceModal(v.unavailable_event_id, { onDone: again }),
    extend: () => extendReturnModal(v.unavailable_event_id, { onDone: again }),
    'to-sorn': () => convertToOffRoadModal(v.unavailable_event_id, { onDone: again }),
    sorn: () => sornDeclaredModal(v.unavailable_event_id, { onDone: again }),
    dispose: () => disposeModal(v),
    restore: async () => { await api.restoreVehicle(v.id); toast('Vehicle restored.'); navigate(`#/vehicles/${v.id}`); },
    archive: () => openModal({
      title: `Archive ${formatReg(v.registration)}?`, submitLabel: 'Archive vehicle', danger: true,
      body: html`<p>Use this for a vehicle entered by mistake. It will be hidden from lists and tasks, and you can restore it later. To record that a vehicle has been sold, scrapped or returned, use Dispose instead.</p>`,
      onSubmit: async () => { await api.archiveVehicle(v.id); toast('Vehicle archived.'); navigate('#/vehicles'); },
    }),
  });
  const body = main.querySelector('#tab-body');
  try { await TAB_RENDER[tab](body, v); } catch (err) { console.error(err); mount(body, errorHtml(err.message)); }
  if (query.dispose && can.write && !disposed && !v.archived_at) disposeModal(v);
}

const taskTable = (tasks) => html`<table class="grid"><thead><tr><th>Item</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${tasks.map((t) => html`<tr>
  <td data-label="Item"><button class="task-title" data-action="open" data-key="${taskKey(t)}">${t.type_name}</button>${t.is_statutory ? html` <span class="tag">Statutory</span>` : ''}</td>
  <td data-label="Due">${t.due_date ? html`${fmtDate(t.due_date)}<div class="sub">${dueText(t.days_remaining)}</div>` : html`<span class="muted">Not set</span>`}</td>
  <td data-label="Status">${pill(t.status)}</td>
  <td class="act">${can.write ? html`<button class="btn btn-sm" data-action="open" data-key="${taskKey(t)}">${t.due_date ? 'Manage' : 'Set date'}</button>` : ''}</td>
</tr>`)}</tbody></table>`;

const TAB_RENDER = {
  async overview(body, v) {
    const [drivers, depots] = await Promise.all([api.listDrivers(), api.listAllDepots()]);
    const driver = drivers.find((d) => d.id === v.primary_driver_id);
    mount(body, html`<div class="cols">
      <section><h2>Vehicle</h2>${facts([
        ['Type', CATEGORY_LABEL[v.category]], ['Make and model', [v.make, v.model].filter(Boolean).join(' ')], ['Body', v.body_type], ['Colour', v.colour],
        ['Depot', depots.find((d) => d.id === v.depot_id)?.name], ['VIN', v.vin], ['First registered', fmtDateShort(v.first_registered_date)], ['Year', v.year_of_manufacture], ['Fuel', FUEL_LABEL[v.fuel_type]],
        ['Gross weight', v.gross_weight_kg ? `${fmtInt(v.gross_weight_kg)} kg` : ''], ['Allowable payload', v.payload_kg ? `${fmtInt(v.payload_kg)} kg` : ''],
        ['Seats', v.seats], ['Fuel economy', v.mpg ? `${v.mpg} mpg` : ''], ['Fleet number', v.fleet_number]])}</section>
      <section><h2>Use and cost</h2>${facts([
        ['Primary driver', driver ? html`<a href="#/drivers/${driver.id}">${driverName(driver)}</a>` : (v.status === 'active' ? 'Unassigned' : '')],
        ['Insurance', v.insured_until ? `Covered until ${fmtDateShort(v.insured_until)}` : (v.status === 'active' ? html`<span class="c-overdue"><strong>No current cover</strong></span>` : '')],
        ['Latest mileage', v.latest_mileage != null ? `${fmtInt(v.latest_mileage)} miles on ${fmtDateShort(v.latest_reading_date)}` : 'None logged'],
        ['Running costs logged', Number(v.running_costs_total) ? fmtMoney(v.running_costs_total) : ''],
        ['Ownership', OWNERSHIP_LABEL[v.ownership_type]], ['Acquired', fmtDateShort(v.date_acquired)], ['Purchase price', fmtMoney(v.purchase_price)],
        ['Monthly payment', fmtMoney(v.monthly_payment)], ['Term', v.term_start || v.term_end ? `${fmtDateShort(v.term_start) || '?'} to ${fmtDateShort(v.term_end) || '?'}` : ''],
        ['Mileage cap', v.capped_miles ? `${fmtInt(v.capped_miles)} miles` : ''], ['Excess mileage', v.cost_per_excess_mile != null ? `${fmtMoney(v.cost_per_excess_mile)} per mile` : '']])}</section>
      ${v.status === 'disposed' ? html`<section class="span-all"><h2>Disposal</h2>${facts([
        ['Date', fmtDate(v.disposed_date)], ['Reason', DISPOSAL_REASON_LABEL[v.disposal_reason]], ['Sold to', v.sold_to], ['Sale price', v.sale_price != null ? fmtMoney(v.sale_price) : ''],
        ['Insurer told', v.disposal_insurer_notified_on ? fmtDate(v.disposal_insurer_notified_on) : html`<span class="c-soon"><strong>Not yet recorded</strong></span>`], ['Notes', v.disposal_notes]])}</section>` : ''}
      ${v.notes ? html`<section class="span-all"><h2>Notes</h2><p class="prewrap">${v.notes}</p></section>` : ''}
    </div>`);
  },

  async compliance(body, v) {
    const ctx = { vehicles: new Map([[v.id, v]]), drivers: new Map() };
    const load = async () => (await api.listTasks({ vehicleId: v.id })).filter((t) => t.vehicle_id === v.id);
    let tasks = await load();
    const byKey = (k) => tasks.find((t) => taskKey(t) === k);
    const draw = () => mount(body, tasks.length ? taskTable(tasks)
      : emptyHtml('Nothing tracked for this vehicle', v.status === 'active' ? 'Compliance items are created from the types switched on for your organisation.' : 'Disposed, archived and off-road vehicles do not raise tasks.'));
    const refresh = async () => { tasks = await load(); draw(); };
    draw();
    on(body, { open: (el) => { const t = byKey(el.dataset.key); if (t) openTaskPanel(t, ctx, refresh); } });
  },

  async drivers(body, v) {
    const [assigns, drivers, licences] = await Promise.all([api.listAssignments({ vehicleId: v.id }), api.listDrivers(), api.currentLicences()]);
    const dById = new Map(drivers.map((d) => [d.id, d]));
    const licBy = new Map(licences.map((l) => [l.driver_id, l]));
    const live = v.status === 'active' && !v.archived_at;
    const draw = (rows) => mount(body, html`
      ${can.write && live ? html`<p><button class="btn btn-primary" data-action="assign">Assign driver</button></p>` : ''}
      ${rows.length ? html`<table class="grid"><thead><tr><th>Driver</th><th>Role</th><th>From</th><th>To</th><th></th></tr></thead><tbody>${rows.map((a) => html`<tr>
        <td data-label="Driver"><a href="#/drivers/${a.driver_id}">${driverName(dById.get(a.driver_id)) || 'Former driver'}</a>${a.override_reason ? html`<div class="sub">Licence override: ${a.override_reason}</div>` : ''}</td>
        <td data-label="Role">${a.assignment_type === 'primary' ? 'Primary' : 'Named'}</td>
        <td data-label="From">${fmtDateShort(a.start_date)}</td>
        <td data-label="To">${a.end_date ? fmtDateShort(a.end_date) : html`<strong>Current</strong>`}</td>
        <td class="act">${can.write && !a.end_date ? html`<button class="btn btn-sm" data-action="end" data-id="${a.id}">End</button>` : ''}</td></tr>`)}</tbody></table>`
        : emptyHtml('No drivers assigned', 'Assign a primary driver to see who is responsible for this vehicle.')}`);
    let rows = assigns;
    const reload = async () => { rows = await api.listAssignments({ vehicleId: v.id }); draw(rows); };
    draw(rows);
    on(body, {
      end: (el) => openModal({
        title: 'End assignment', submitLabel: 'End assignment',
        body: html`<p>Mark this driver as no longer assigned from today.</p>`,
        onSubmit: async () => { await api.endAssignment(el.dataset.id, todayStr()); toast('Assignment ended.'); await reload(); },
      }),
      assign: () => {
        const specs = [
          { name: 'driver_id', label: 'Driver', type: 'select', required: true, span: 2, options: drivers.filter((d) => d.employment_status === 'active').map((d) => [d.id, driverName(d)]) },
          { name: 'assignment_type', label: 'Role', type: 'select', required: true, options: [['primary', 'Primary driver'], ['named', 'Named driver']] },
          { name: 'start_date', label: 'From', type: 'date', required: true },
          { name: 'override_reason', label: 'Override reason', type: 'textarea', span: 2, hint: can.override ? 'Only needed if the driver\'s licence is expired, suspended, revoked or disqualified.' : 'A fleet admin or superuser must approve assigning a driver whose licence is not valid.' },
        ];
        const dlg = openModal({
          title: 'Assign driver', submitLabel: 'Assign driver',
          body: html`${fieldsHtml(specs, { assignment_type: 'primary', start_date: todayStr() })}<p class="warn" id="licence-warn" role="status" hidden></p>`,
          onSubmit: async (f) => {
            const val = readForm(f, specs);
            try { await api.addAssignment({ ...val, vehicle_id: v.id }); } catch (e) {
              if (e.code === '23505') throw new Error('This vehicle already has a primary driver, or that driver is already assigned. End the current assignment first.');
              throw e;
            }
            toast('Driver assigned.');
            await reload();
          },
        });
        dlg.querySelector('#f-driver_id').addEventListener('change', (e) => {
          const lic = licBy.get(e.target.value);
          const warn = dlg.querySelector('#licence-warn');
          const bad = lic && BLOCKING_LICENCE.includes(lic.status);
          warn.hidden = !bad;
          if (bad) warn.textContent = `Latest licence check: ${LICENCE_STATUS_LABEL[lic.status]}. Assigning this driver needs an override reason from a fleet admin or superuser.`;
        });
      },
    });
  },

  async insurance(body, v) {
    const [rows, policies, contacts] = await Promise.all([api.listPolicyVehicles({ vehicleId: v.id }), api.listPolicies(), api.listContacts()]);
    const pById = new Map(policies.map((p) => [p.id, p]));
    const cById = new Map(contacts.map((c) => [c.id, c]));
    const today = todayStr();
    const coverEnd = (r) => { const p = pById.get(r.policy_id); return [r.end_date, p?.end_date].filter(Boolean).sort()[0] || null; };
    const state = (r) => { const p = pById.get(r.policy_id); const end = coverEnd(r);
      if (!p || p.status !== 'active') return 'Ended'; if (r.start_date && r.start_date > today) return 'Starts later'; return end && end < today ? 'Ended' : 'Current'; };
    const live = v.status === 'active' && !v.archived_at;
    mount(body, html`
      ${v.insured_until ? html`<p class="banner-info">Covered until ${fmtDate(v.insured_until)}.</p>` : live ? html`<p class="banner-warn"><strong>No current insurance cover.</strong> Add this vehicle to a policy below.</p>` : ''}
      ${can.write && live ? html`<p><button class="btn btn-primary" data-action="cover">Add to a policy</button></p>` : ''}
      ${rows.length ? html`<table class="grid"><thead><tr><th>Policy</th><th>Insurer</th><th>Cover from</th><th>Cover to</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((r) => { const p = pById.get(r.policy_id); return html`<tr>
        <td data-label="Policy">${p ? html`<a href="#/insurance/${p.id}">${p.policy_number}</a>` : 'A removed policy'}</td>
        <td data-label="Insurer">${cById.get(p?.insurer_id)?.name || ''}</td>
        <td data-label="Cover from">${fmtDateShort(r.start_date || p?.start_date)}</td>
        <td data-label="Cover to">${fmtDateShort(coverEnd(r))}</td>
        <td data-label="Status">${state(r)}</td>
        <td class="act">${can.write && !r.end_date && state(r) === 'Current' ? html`<button class="btn btn-sm" data-action="uncover" data-id="${r.id}">End cover</button>` : ''}</td></tr>`; })}</tbody></table>`
        : emptyHtml('No insurance recorded', 'Add the vehicle to a policy to record who insures it and from when.')}`);
    on(body, {
      cover: () => {
        const active = policies.filter((p) => p.status === 'active');
        const specs = [
          { name: 'policy_id', label: 'Policy', type: 'select', required: true, span: 2, options: active.map((p) => [p.id, `${p.policy_number}${cById.get(p.insurer_id) ? ` (${cById.get(p.insurer_id).name})` : ''}, ends ${fmtDateShort(p.end_date)}`]), hint: active.length ? '' : 'There are no active policies yet. Add one under Insurance first.' },
          { name: 'start_date', label: 'Cover from', type: 'date', required: true },
          { name: 'end_date', label: 'Cover to (optional)', type: 'date', hint: 'Leave blank to follow the policy end date.' },
        ];
        openModal({
          title: 'Add to a policy', submitLabel: 'Add cover', body: fieldsHtml(specs, { start_date: todayStr() }),
          onSubmit: async (f) => { const x = readForm(f, specs); await api.addPolicyVehicle({ ...x, vehicle_id: v.id }); toast('Insurance cover added.'); navigate(location.hash); },
        });
      },
      uncover: (el) => openModal({
        title: 'End insurance cover', submitLabel: 'End cover', danger: true,
        body: html`<p>Mark this vehicle as no longer covered by this policy from today. It will then show as having no cover unless it is on another policy.</p>`,
        onSubmit: async () => { await api.endPolicyVehicle(el.dataset.id, today); toast('Cover ended.'); navigate(location.hash); },
      }),
    });
  },

  async availability(body, v) {
    const [events, garages] = await Promise.all([api.listUnavailability(v.id), api.listGarages()]);
    const gById = new Map(garages.map((g) => [g.id, g]));
    const today = todayStr();
    const again = () => navigate(location.hash);
    const stateOf = (e) => (e.cancelled_at ? 'Cancelled' : e.returned_on ? 'Completed' : e.from_date > today ? 'Booked' : e.reason === 'off_road' ? (e.sorn_declared_on ? 'Off the road (SORN)' : 'Off the road, no SORN') : 'At the garage');
    const live = v.status !== 'disposed' && !v.archived_at;
    mount(body, html`
      ${can.write && live ? html`<p><button class="btn btn-primary" data-action="tab-out">Out of service or book a visit</button></p>` : ''}
      <p class="muted">Garage visits, bookings and time off the road. A garage must always be named, from the Garages list, or Unknown garage if you do not know. A vehicle that is off the road for a long time needs a SORN.</p>
      ${events.length ? html`<table class="grid"><thead><tr><th>When</th><th>Why</th><th>Where</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>${events.map((e) => html`<tr>
        <td data-label="When">${fmtDateShort(e.from_date)} to ${e.cancelled_at ? '' : e.returned_on ? fmtDateShort(e.returned_on) : e.expected_return ? html`${fmtDateShort(e.expected_return)} <span class="sub">expected</span>` : e.reason === 'off_road' ? 'open' : 'not set'}</td>
        <td data-label="Why">${UNAVAIL_REASON_LABEL[e.reason]}</td>
        <td data-label="Where">${e.reason === 'off_road' ? (e.location_note || 'Off the road') : (gById.get(e.garage_id)?.name || '')}</td>
        <td data-label="Status">${stateOf(e)}${e.reason === 'off_road' && e.sorn_declared_on ? html`<div class="sub">SORN ${fmtDateShort(e.sorn_declared_on)}</div>` : ''}</td>
        <td data-label="Notes">${e.notes || ''}</td>
        <td class="act">${can.write && !e.returned_on ? (e.from_date > today
          ? html`<button class="btn btn-sm" data-action="reschedule" data-id="${e.id}">Change</button> <button class="btn btn-sm" data-action="cancel" data-id="${e.id}">Cancel</button>`
          : html`<button class="btn btn-sm" data-action="tab-back" data-id="${e.id}">Back in service</button>${e.reason === 'off_road' && !e.sorn_declared_on ? html` <button class="btn btn-sm" data-action="tab-sorn" data-id="${e.id}">Record SORN</button>` : ''}`) : ''}</td></tr>`)}</tbody></table>`
        : emptyHtml('No garage visits or time off the road', 'Record each time this vehicle goes to a garage or comes off the road.')}`);
    on(body, {
      'tab-out': () => outOfServiceModal(v.id, { onDone: again }),
      'tab-back': (el) => backInServiceModal(el.dataset.id, { onDone: again }),
      'tab-sorn': (el) => sornDeclaredModal(el.dataset.id, { onDone: again }),
      reschedule: (el) => rescheduleModal(el.dataset.id, { onDone: again }),
      cancel: (el) => cancelBookingModal(el.dataset.id, { onDone: again }),
    });
  },

  async incidents(body, v) {
    const [list, drivers] = await Promise.all([api.listIncidents({ vehicleId: v.id }), api.listDrivers()]);
    mount(body, html`${can.write ? html`<p><a class="btn btn-primary" href="#/incidents/new?vehicle=${v.id}">Report an accident, damage or fine</a></p>` : ''}
      ${list.length ? incidentTable(list, { vehicles: new Map([[v.id, v]]), drivers: new Map(drivers.map((d) => [d.id, d])) }, { hideVehicle: true })
        : emptyHtml('No incidents', 'Accidents, damage and fines for this vehicle will appear here.')}`);
  },

  async costs(body, v) {
    let rows = await api.listCosts(v.id);
    const draw = () => {
      const total = rows.reduce((s, r) => s + Number(r.amount), 0);
      const byCat = Object.entries(rows.reduce((m, r) => ({ ...m, [r.category]: (m[r.category] || 0) + Number(r.amount) }), {}));
      mount(body, html`${can.write ? html`<p><button class="btn btn-primary" data-action="add">Add cost</button></p>` : ''}
        ${rows.length ? html`<p class="summary">Total logged: <strong>${fmtMoney(total)}</strong> <span class="muted">${byCat.map(([c, a]) => `${COST_CATEGORY_LABEL[c]} ${fmtMoney(a)}`).join(', ')}</span></p>
          <table class="grid"><thead><tr><th>Date</th><th>Type</th><th class="num">Amount</th><th>Invoice</th><th>Note</th></tr></thead><tbody>${rows.map((r) => html`<tr>
            <td data-label="Date">${fmtDateShort(r.cost_date)}</td><td data-label="Type">${COST_CATEGORY_LABEL[r.category]}</td><td data-label="Amount" class="num">${fmtMoney(r.amount)}</td>
            <td data-label="Invoice">${r.invoice_ref || ''}</td><td data-label="Note">${r.note || ''}</td></tr>`)}</tbody></table>
          <p class="hint">Accident, damage and fine costs are recorded under Incidents.</p>`
          : emptyHtml('No costs logged', 'Log servicing, tyres, repairs and other running costs here.')}`);
    };
    draw();
    on(body, {
      add: () => {
        const specs = [
          { name: 'category', label: 'Type', type: 'select', required: true, options: opts(COST_CATEGORY_LABEL) },
          { name: 'cost_date', label: 'Date', type: 'date', required: true, max: todayStr() },
          { name: 'amount', label: 'Amount (£)', type: 'number', required: true, step: '0.01', min: '0' },
          { name: 'vat_amount', label: 'VAT (£)', type: 'number', step: '0.01', min: '0' },
          { name: 'invoice_ref', label: 'Invoice number' }, { name: 'note', label: 'Note', span: 2 },
        ];
        openModal({
          title: 'Add cost', submitLabel: 'Add cost', body: fieldsHtml(specs, { cost_date: todayStr(), category: 'servicing' }),
          onSubmit: async (f) => { await api.addCost({ ...readForm(f, specs), vehicle_id: v.id }); toast('Cost added.'); rows = await api.listCosts(v.id); draw(); },
        });
      },
    });
  },

  async documents(body, v) { await mountDocuments(body, { target: { vehicle_id: v.id }, categories: VEHICLE_DOC_CATEGORIES }); },

  async readings(body, v) {
    let rows = await api.listReadings(v.id);
    const draw = () => mount(body, html`
      ${can.write ? html`<p><button class="btn btn-primary" data-action="add">Add reading</button></p>` : ''}
      ${rows.length ? html`<table class="grid"><thead><tr><th>Date</th><th class="num">Mileage</th><th>Source</th><th>Note</th></tr></thead><tbody>${rows.map((r) => html`<tr>
        <td data-label="Date">${fmtDate(r.reading_date)}</td><td data-label="Mileage" class="num">${fmtInt(r.mileage)}</td>
        <td data-label="Source">${r.source === 'manual' ? 'Entered by hand' : r.source}</td><td data-label="Note">${r.note || ''}</td></tr>`)}</tbody></table>`
        : emptyHtml('No readings yet', 'Log the odometer to track mileage over time.')}`);
    const reload = async () => { rows = await api.listReadings(v.id); draw(); };
    draw();
    on(body, {
      add: () => {
        const last = rows[0];
        const specs = [
          { name: 'reading_date', label: 'Date', type: 'date', required: true, max: todayStr() },
          { name: 'mileage', label: 'Odometer (miles)', type: 'number', required: true, min: '0', step: '1', inputmode: 'numeric' },
          { name: 'note', label: 'Note', type: 'text', span: 2 },
          { name: 'confirm_lower', label: 'This is correct even though it is lower than the last reading', type: 'checkbox', span: 2, hint: last ? `Last reading: ${fmtInt(last.mileage)} miles on ${fmtDateShort(last.reading_date)}. Tick for an odometer replacement or a correction.` : '' },
        ];
        openModal({
          title: 'Add odometer reading', submitLabel: 'Add reading',
          body: fieldsHtml(specs, { reading_date: todayStr() }),
          onSubmit: async (f) => {
            const val = readForm(f, specs);
            if (last && val.mileage < last.mileage && !val.confirm_lower) throw new Error(`That is lower than the last reading (${fmtInt(last.mileage)}). Check the figure, or tick the box to confirm it.`);
            await api.addReading({ vehicle_id: v.id, reading_date: val.reading_date, mileage: val.mileage, note: val.note });
            toast('Reading added.');
            await reload();
          },
        });
      },
    });
  },

  async history(body, v) {
    const [L, entries] = await Promise.all([auditLookups(), api.listAuditFor({ vehicleId: v.id })]);
    mount(body, html`<h2>Change history</h2><p class="muted">Every significant change to this vehicle and its records, newest first. Mileage readings are not listed.</p>${historyList(entries, L)}`);
  },
};
