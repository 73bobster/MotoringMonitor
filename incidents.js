// Accidents, damage and fines: one register, linked to vehicles and drivers.
import * as api from './api.js';
import { can } from './state.js';
import {
  html, mount, on, plate, facts, fieldsHtml, readForm, openModal, toast, loadingHtml, emptyHtml,
  fmtDate, fmtDateShort, fmtMoney, todayStr,
} from './ui.js';
import {
  INCIDENT_KIND_LABEL, FINE_TYPE_LABEL, INCIDENT_STATUS_LABEL, APPEAL_LABEL, INCIDENT_DOC_CATEGORIES, driverName, incidentTitle, incidentCost,
} from './domain.js';
import { runAction } from './actions.js';
import { navigate } from './router.js';
import { mountDocuments } from './docs.js';

const opts = (o) => Object.entries(o);
const yesNo = (b) => (b === true ? 'Yes' : b === false ? 'No' : '');

// Shared table, also used on vehicle and driver pages. L = { vehicles: Map, drivers: Map }
export function incidentTable(list, L, { hideVehicle = false, hideDriver = false } = {}) {
  const totalCost = list.reduce((s, i) => s + incidentCost(i), 0);
  const recovered = list.reduce((s, i) => s + Number(i.insurer_paid || 0), 0);
  return html`<table class="grid"><thead><tr><th>Date</th><th>What</th>${hideVehicle ? '' : html`<th>Vehicle</th>`}${hideDriver ? '' : html`<th>Driver</th>`}<th>Details</th><th class="num">Cost</th><th>Status</th></tr></thead><tbody>
    ${list.map((i) => html`<tr>
      <td data-label="Date"><a href="#/incidents/${i.id}">${fmtDateShort(i.incident_date)}</a></td>
      <td data-label="What"><strong>${incidentTitle(i)}</strong></td>
      ${hideVehicle ? '' : html`<td data-label="Vehicle">${i.vehicle_id && L.vehicles.get(i.vehicle_id) ? html`<a class="plate-link" href="#/vehicles/${i.vehicle_id}">${plate(L.vehicles.get(i.vehicle_id).registration)}</a>` : ''}</td>`}
      ${hideDriver ? '' : html`<td data-label="Driver">${i.driver_id ? html`<a href="#/drivers/${i.driver_id}">${driverName(L.drivers.get(i.driver_id)) || 'Driver'}</a>` : html`<span class="muted">Not named</span>`}</td>`}
      <td data-label="Details">${i.kind === 'fine'
        ? html`${i.reference || ''}${i.paid_on ? html` <span class="tag">Paid</span>` : i.pay_by ? html` <span class="sub">Pay by ${fmtDateShort(i.pay_by)}</span>` : ''}`
        : html`${(i.description || '').slice(0, 70)}${(i.description || '').length > 70 ? '...' : ''}${i.at_fault === true ? html` <span class="tag">At fault</span>` : ''}`}</td>
      <td data-label="Cost" class="num">${incidentCost(i) ? fmtMoney(incidentCost(i)) : ''}${Number(i.insurer_paid) ? html`<div class="sub">Insurer paid ${fmtMoney(i.insurer_paid)}</div>` : ''}</td>
      <td data-label="Status">${INCIDENT_STATUS_LABEL[i.status]}</td></tr>`)}
  </tbody><tfoot><tr><td colspan="${3 + (hideVehicle ? 0 : 1) + (hideDriver ? 0 : 1)}" class="totals-label">${list.length} ${list.length === 1 ? 'record' : 'records'}</td><td class="num totals">${fmtMoney(totalCost)}${recovered ? html`<div class="sub">Insurer paid ${fmtMoney(recovered)}</div>` : ''}</td><td></td></tr></tfoot></table>`;
}

// ---- List ------------------------------------------------------------------
export async function incidentsList(main) {
  mount(main, html`<header class="page-head"><h1>Accidents, damage and fines</h1></header>${loadingHtml()}`);
  const [list, vehicles, drivers] = await Promise.all([api.listIncidents(), api.listVehicles(), api.listDrivers()]);
  const L = { vehicles: new Map(vehicles.map((v) => [v.id, v])), drivers: new Map(drivers.map((d) => [d.id, d])) };
  const ui = { kind: 'all', vehicle: '', driver: '', from: '', to: '', status: '' };
  mount(main, html`
    <header class="page-head"><h1>Accidents, damage and fines</h1>${can.write ? html`<a class="btn btn-primary" href="#/incidents/new">Report an incident</a>` : ''}</header>
    <div class="filters">
      <div class="seg" role="group" aria-label="Show">${[['all', 'All'], ['accident', 'Accidents'], ['damage', 'Damage'], ['fine', 'Fines']].map(([k, l]) => html`<button type="button" class="seg-btn" data-action="kind" data-kind="${k}" aria-pressed="${String(k === ui.kind)}">${l}</button>`)}</div>
      <label class="inline"><span class="sr-only">Vehicle</span><select id="i-vehicle"><option value="">All vehicles</option>${vehicles.filter((v) => !v.archived_at).map((v) => html`<option value="${v.id}">${v.registration}</option>`)}</select></label>
      <label class="inline"><span class="sr-only">Driver</span><select id="i-driver"><option value="">All drivers</option>${drivers.map((d) => html`<option value="${d.id}">${driverName(d)}</option>`)}</select></label>
      <label class="inline"><span class="sr-only">Status</span><select id="i-status"><option value="">Any status</option>${opts(INCIDENT_STATUS_LABEL).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label>
      <div class="field inline-field"><label for="i-from">From</label><input type="date" id="i-from"></div>
      <div class="field inline-field"><label for="i-to">To</label><input type="date" id="i-to"></div>
    </div>
    <div id="i-table"></div>`);
  const box = main.querySelector('#i-table');
  function draw() {
    const rows = list.filter((i) => (ui.kind === 'all' || i.kind === ui.kind) && (!ui.vehicle || i.vehicle_id === ui.vehicle) && (!ui.driver || i.driver_id === ui.driver)
      && (!ui.status || i.status === ui.status) && (!ui.from || i.incident_date >= ui.from) && (!ui.to || i.incident_date <= ui.to));
    if (!list.length) { mount(box, emptyHtml('Nothing recorded', 'Report accidents, damage and fines here so costs and deadlines are tracked.', can.write ? html`<p><a class="btn btn-primary" href="#/incidents/new">Report an incident</a></p>` : '')); return; }
    mount(box, rows.length ? incidentTable(rows, L) : emptyHtml('No incidents match', 'Try different filters.'));
  }
  on(main, { kind: (el) => { ui.kind = el.dataset.kind; main.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-pressed', String(b === el))); draw(); } });
  for (const [id, key] of [['#i-vehicle', 'vehicle'], ['#i-driver', 'driver'], ['#i-status', 'status'], ['#i-from', 'from'], ['#i-to', 'to']]) main.querySelector(id).addEventListener('change', (e) => { ui[key] = e.target.value; draw(); });
  draw();
}

// ---- Form ------------------------------------------------------------------
const ACC = ['accident', 'damage'];
export async function incidentForm(main, { id }, query) {
  const editing = id && id !== 'new';
  mount(main, loadingHtml());
  if (!can.write) { mount(main, emptyHtml('You can view incidents but not change them', '', html`<p><a class="btn" href="#/incidents">Back</a></p>`)); return; }
  const [vehicles, drivers, existing] = await Promise.all([api.listVehicles(), api.listDrivers(), editing ? api.getIncident(id) : null]);
  if (editing && !existing) { mount(main, emptyHtml('Incident not found', '', html`<p><a class="btn" href="#/incidents">Back</a></p>`)); return; }
  const kind0 = existing?.kind || (INCIDENT_KIND_LABEL[query.kind] ? query.kind : 'accident');
  const pv = vehicles.find((x) => x.id === query.vehicle);
  const base = { kind: kind0, status: 'open', incident_date: todayStr(), notify_insurer: kind0 === 'accident', appeal_status: 'none', vehicle_id: query.vehicle || '', driver_id: query.driver || pv?.primary_driver_id || '' };
  const values = existing ? { ...existing, at_fault: existing.at_fault === true ? 'yes' : existing.at_fault === false ? 'no' : '' } : base;
  const vOpts = vehicles.filter((v) => !v.archived_at).map((v) => [v.id, `${v.registration}${v.nickname ? ` (${v.nickname})` : ''}`]);
  const dOpts = drivers.map((d) => [d.id, driverName(d)]);
  const groups = {
    common: [
      { name: 'kind', label: 'What happened', type: 'select', required: true, options: opts(INCIDENT_KIND_LABEL) },
      { name: 'incident_date', label: 'Date', type: 'date', required: true, max: todayStr() },
      { name: 'vehicle_id', label: 'Vehicle', type: 'select', blank: 'Not a vehicle', options: vOpts },
      { name: 'driver_id', label: 'Driver', type: 'select', blank: 'Not known or not named', options: dOpts },
      { name: 'location', label: 'Where', span: 2 },
      { name: 'description', label: 'What happened', type: 'textarea', span: 2 },
      { name: 'reference', label: 'Reference (PCN, ticket or claim number)' },
      { name: 'status', label: 'Status', type: 'select', required: true, options: opts(INCIDENT_STATUS_LABEL) },
    ],
    accident: [
      { name: 'at_fault', label: 'Was the driver at fault?', type: 'select', blank: 'Not known', options: [['yes', 'Yes'], ['no', 'No']] },
      { name: 'injuries', label: 'Anyone injured', type: 'checkbox' },
      { name: 'police_reference', label: 'Police reference' },
      { name: 'third_party_details', label: 'Other party and witnesses', type: 'textarea', span: 2 },
      { name: 'repair_cost', label: 'Repair cost (£)', type: 'number', step: '0.01', min: '0' },
      { name: 'excess_paid', label: 'Excess paid (£)', type: 'number', step: '0.01', min: '0' },
      { name: 'insurer_paid', label: 'Paid by the insurer (£)', type: 'number', step: '0.01', min: '0' },
      { name: 'third_party_cost', label: 'Cost to other parties (£)', type: 'number', step: '0.01', min: '0' },
      { name: 'repaired_on', label: 'Repaired on', type: 'date' },
      { name: 'notify_insurer', label: 'Tell the insurer (adds a task)', type: 'checkbox', span: 2 },
      { name: 'insurer_notified_on', label: 'Insurer told on', type: 'date' },
      { name: 'insurer_notified_ref', label: 'Insurer reference' },
    ],
    fine: [
      { name: 'fine_type', label: 'Type of fine', type: 'select', options: opts(FINE_TYPE_LABEL) },
      { name: 'fine_amount', label: 'Fine (£)', type: 'number', step: '0.01', min: '0' },
      { name: 'notice_date', label: 'Date of the notice', type: 'date' },
      { name: 'nominate_by', label: 'Name the driver by', type: 'date', hint: 'Speeding and red light notices: filled in as 28 days after the notice date.' },
      { name: 'nominated_on', label: 'Driver named on', type: 'date' },
      { name: 'discount_until', label: 'Reduced fine until', type: 'date' },
      { name: 'pay_by', label: 'Pay in full by', type: 'date' },
      { name: 'paid_on', label: 'Paid on', type: 'date' },
      { name: 'paid_by', label: 'Paid by', type: 'select', blank: 'Not paid yet', options: [['company', 'The company'], ['driver', 'The driver']] },
      { name: 'recharge_to_driver', label: 'Recharge to the driver', type: 'checkbox' },
      { name: 'recharged_on', label: 'Recharged on', type: 'date' },
      { name: 'appeal_status', label: 'Appeal', type: 'select', options: opts(APPEAL_LABEL) },
    ],
    notes: [{ name: 'notes', label: 'Notes', type: 'textarea', span: 2 }],
  };
  const back = editing ? `#/incidents/${id}` : '#/incidents';
  mount(main, html`
    <header class="page-head"><h1>${editing ? 'Edit incident' : 'Report an incident'}</h1></header>
    <form class="page-form" id="incident-form">
      <fieldset><legend>The incident</legend>${fieldsHtml(groups.common, values)}</fieldset>
      <fieldset data-group="accident" ${ACC.includes(kind0) ? '' : 'hidden'}><legend>Accident or damage</legend>${fieldsHtml(groups.accident, values)}</fieldset>
      <fieldset data-group="fine" ${kind0 === 'fine' ? '' : 'hidden'}><legend>Fine</legend>${fieldsHtml(groups.fine, values)}</fieldset>
      <fieldset><legend>Notes</legend>${fieldsHtml(groups.notes, values)}</fieldset>
      <p class="form-error" role="alert" hidden></p>
      <div class="form-actions"><button class="btn btn-primary" type="submit">${editing ? 'Save changes' : 'Save incident'}</button><a class="btn" href="${back}">Cancel</a></div>
    </form>`);
  const form = main.querySelector('#incident-form');
  const err = form.querySelector('.form-error');
  const kindSel = form.elements.kind;
  const applyKind = (resetDefaults) => {
    const k = kindSel.value;
    form.querySelector('[data-group="accident"]').hidden = !ACC.includes(k);
    form.querySelector('[data-group="fine"]').hidden = k !== 'fine';
    if (resetDefaults && !editing) form.elements.notify_insurer.checked = k === 'accident';
  };
  kindSel.addEventListener('change', () => applyKind(true));
  // choosing a vehicle suggests its current primary driver
  form.elements.vehicle_id.addEventListener('change', () => {
    const v = vehicles.find((x) => x.id === form.elements.vehicle_id.value);
    if (v?.primary_driver_id && !form.elements.driver_id.value) form.elements.driver_id.value = v.primary_driver_id;
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const k = kindSel.value;
      const specs = [...groups.common, ...(ACC.includes(k) ? groups.accident : []), ...(k === 'fine' ? groups.fine : []), ...groups.notes];
      const v = readForm(form, specs);
      if (!v.vehicle_id && !v.driver_id) throw new Error('Choose a vehicle, a driver, or both.');
      if (k === 'fine' && !v.fine_type) throw new Error('Choose the type of fine.');
      if ('at_fault' in v) v.at_fault = v.at_fault === 'yes' ? true : v.at_fault === 'no' ? false : null;
      if (k !== 'fine') v.fine_type = null;
      const row = await api.saveIncident(v, editing ? id : null);
      toast(!editing && ACC.includes(k) && v.notify_insurer && !v.insurer_notified_on ? 'Incident recorded. A task to tell the insurer has been added.' : 'Incident saved.');
      navigate(`#/incidents/${row.id}`);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  };
}

// ---- Detail ----------------------------------------------------------------
export async function incidentDetail(main, { id }) {
  mount(main, loadingHtml());
  const [i, vehicles, drivers] = await Promise.all([api.getIncident(id), api.listVehicles(), api.listDrivers()]);
  if (!i) { mount(main, emptyHtml('Incident not found', 'It may have been removed.', html`<p><a class="btn" href="#/incidents">Back</a></p>`)); return; }
  const v = vehicles.find((x) => x.id === i.vehicle_id); const d = drivers.find((x) => x.id === i.driver_id);
  const ctx = { vehicles: new Map(vehicles.map((x) => [x.id, x])), drivers: new Map(drivers.map((x) => [x.id, x])) };
  const fine = i.kind === 'fine';
  const task = (type_name) => ({ source_type: 'incident', source_id: i.id, state_key: '', type_name, target_label: `${incidentTitle(i)} ${fmtDateShort(i.incident_date)}`, applies_to: 'incident', vehicle_id: i.vehicle_id, driver_id: i.driver_id, due_date: null });
  const again = () => navigate(`#/incidents/${i.id}`);
  mount(main, html`
    <header class="page-head">
      <div><p class="crumb"><a href="#/incidents">Accidents, damage and fines</a></p><h1>${incidentTitle(i)}</h1><p class="sub">${fmtDate(i.incident_date)}${i.location ? `, ${i.location}` : ''}</p></div>
      ${can.write ? html`<div class="head-actions"><a class="btn" href="#/incidents/${i.id}/edit">Edit</a><button class="btn" data-action="archive">Remove</button></div>` : ''}
    </header>
    ${can.write ? html`<div class="panel-actions">
      ${!fine && i.notify_insurer && !i.insurer_notified_on ? html`<button class="btn btn-primary" data-action="act" data-act="notify-incident">Record insurer told</button>` : ''}
      ${fine && !i.paid_on ? html`<button class="btn btn-primary" data-action="act" data-act="paid">Record as paid</button>` : ''}
      ${fine && i.nominate_by && !i.nominated_on ? html`<button class="btn btn-primary" data-action="act" data-act="nominated">Record driver named</button>` : ''}</div>` : ''}
    <div class="cols">
      <section><h2>What happened</h2>${facts([
        ['Vehicle', v ? html`<a class="plate-link" href="#/vehicles/${v.id}">${plate(v.registration)}</a>` : ''], ['Driver', d ? html`<a href="#/drivers/${d.id}">${driverName(d)}</a>` : (i.driver_id ? 'Driver' : 'Not named')],
        ['Status', INCIDENT_STATUS_LABEL[i.status]], ['Reference', i.reference], ['Description', i.description],
        ...(fine ? [['Type', FINE_TYPE_LABEL[i.fine_type]], ['Appeal', i.appeal_status !== 'none' ? APPEAL_LABEL[i.appeal_status] : '']]
          : [['At fault', yesNo(i.at_fault)], ['Injuries', i.injuries ? 'Yes' : ''], ['Police reference', i.police_reference], ['Other party', i.third_party_details], ['Repaired on', fmtDate(i.repaired_on)]]),
        ['Notes', i.notes]])}</section>
      <section><h2>${fine ? 'Fine and deadlines' : 'Costs and insurer'}</h2>${facts(fine ? [
        ['Fine', i.fine_amount != null ? fmtMoney(i.fine_amount) : ''], ['Notice dated', fmtDate(i.notice_date)],
        ['Name the driver by', i.nominate_by ? html`${fmtDate(i.nominate_by)}${i.nominated_on ? html` <span class="tag">Done ${fmtDateShort(i.nominated_on)}</span>` : html` <span class="c-soon"><strong>Not yet</strong></span>`}` : ''],
        ['Reduced fine until', fmtDate(i.discount_until)], ['Pay in full by', fmtDate(i.pay_by)],
        ['Paid', i.paid_on ? `${fmtDate(i.paid_on)} by ${i.paid_by === 'driver' ? 'the driver' : 'the company'}` : html`<span class="c-soon"><strong>Not yet</strong></span>`],
        ['Recharge to driver', i.recharge_to_driver ? `Yes${i.recharged_on ? `, recharged ${fmtDateShort(i.recharged_on)}` : ', not yet recharged'}` : '']] : [
        ['Repair cost', i.repair_cost != null ? fmtMoney(i.repair_cost) : ''], ['Excess paid', i.excess_paid != null ? fmtMoney(i.excess_paid) : ''], ['Paid by the insurer', i.insurer_paid != null ? fmtMoney(i.insurer_paid) : ''],
        ['Cost to other parties', i.third_party_cost != null ? fmtMoney(i.third_party_cost) : ''],
        ['Insurer told', i.insurer_notified_on ? `${fmtDate(i.insurer_notified_on)}${i.insurer_notified_ref ? ` (${i.insurer_notified_ref})` : ''}` : (i.notify_insurer ? html`<span class="c-soon"><strong>Not yet</strong></span>` : 'Not required')]])}</section>
    </div>
    <h2 class="spaced">Documents and photos</h2><div id="doc-panel"></div>`);
  on(main, {
    act: (el) => runAction(el.dataset.act, task(incidentTitle(i)), ctx, again),
    archive: () => openModal({
      title: 'Remove this incident?', submitLabel: 'Remove', danger: true,
      body: html`<p>Use this for an incident entered by mistake. It will be hidden from lists. The record stays in the audit log.</p>`,
      onSubmit: async () => { await api.archiveIncident(i.id); toast('Incident removed.'); navigate('#/incidents'); },
    }),
  });
  await mountDocuments(main.querySelector('#doc-panel'), { target: { incident_id: i.id }, categories: INCIDENT_DOC_CATEGORIES });
}
