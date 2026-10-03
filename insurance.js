// Insurance: policies, which vehicles each one covers, claims and documents.
import * as api from './api.js';
import { can } from './state.js';
import {
  html, mount, on, plate, facts, fieldsHtml, readForm, openModal, toast, loadingHtml, emptyHtml, errorHtml,
  fmtDate, fmtDateShort, fmtMoney, todayStr, plural,
} from './ui.js';
import {
  POLICY_TYPE_LABEL, POLICY_STATUS_LABEL, PAYMENT_FREQ_LABEL, CLAIM_STATUS_LABEL, POLICY_DOC_CATEGORIES, driverName, vehicleTitle,
} from './domain.js';
import { navigate } from './router.js';
import { mountDocuments } from './docs.js';

const opts = (o) => Object.entries(o);
const daysTo = (iso) => Math.round((new Date(`${iso}T00:00:00`) - new Date(`${todayStr()}T00:00:00`)) / 86400000);

// ---- List ------------------------------------------------------------------
export async function insuranceList(main) {
  mount(main, html`<header class="page-head"><h1>Insurance</h1></header>${loadingHtml()}`);
  const [policies, vehicles, cover, contacts] = await Promise.all([api.listPolicies(), api.listVehicles(), api.listPolicyVehicles(), api.listContacts()]);
  const cById = new Map(contacts.map((c) => [c.id, c]));
  const today = todayStr();
  const covered = (p) => cover.filter((r) => r.policy_id === p.id && (!r.end_date || r.end_date >= today)).length;
  const uncovered = vehicles.filter((v) => v.status === 'active' && !v.archived_at && !v.insured_until);
  const ui = { all: false };
  mount(main, html`
    <header class="page-head"><h1>Insurance</h1>${can.write ? html`<a class="btn btn-primary" href="#/insurance/new">Add policy</a>` : ''}</header>
    ${uncovered.length ? html`<div class="banner-warn"><strong>${plural(uncovered.length, 'vehicle')} with no current cover:</strong>
      ${uncovered.map((v) => html` <a class="plate-link" href="#/vehicles/${v.id}?tab=insurance">${plate(v.registration)}</a>`)}</div>` : html`<p class="banner-info">Every active vehicle has current insurance cover.</p>`}
    <div class="filters"><label class="check small"><input type="checkbox" id="p-all"> <span>Include expired and cancelled policies</span></label></div>
    <div id="p-table"></div>`);
  const box = main.querySelector('#p-table');
  function draw() {
    const rows = policies.filter((p) => ui.all || p.status === 'active' || p.status === 'pending');
    if (!policies.length) { mount(box, emptyHtml('No policies yet', 'Add your motor policies so renewals, cover and claims are tracked.', can.write ? html`<p><a class="btn btn-primary" href="#/insurance/new">Add a policy</a></p>` : '')); return; }
    mount(box, html`<table class="grid"><thead><tr><th>Policy</th><th>Insurer</th><th>Type</th><th>Period</th><th class="num">Premium</th><th class="num">Vehicles</th><th>Status</th></tr></thead><tbody>
      ${rows.map((p) => { const d = daysTo(p.end_date); return html`<tr>
        <td data-label="Policy"><a href="#/insurance/${p.id}"><strong>${p.policy_number}</strong></a><div class="sub">${p.description || ''}</div></td>
        <td data-label="Insurer">${cById.get(p.insurer_id)?.name || ''}</td>
        <td data-label="Type">${POLICY_TYPE_LABEL[p.cover_type]}</td>
        <td data-label="Period">${fmtDateShort(p.start_date)} to ${fmtDateShort(p.end_date)}${p.status === 'active' ? html`<div class="sub ${d < 0 ? 'c-overdue' : d <= 60 ? 'c-soon' : ''}">${d < 0 ? `Ended ${plural(-d, 'day')} ago` : d === 0 ? 'Ends today' : `Ends in ${plural(d, 'day')}`}</div>` : ''}</td>
        <td data-label="Premium" class="num">${p.annual_premium != null ? fmtMoney(p.annual_premium) : ''}</td>
        <td data-label="Vehicles" class="num">${covered(p)}</td>
        <td data-label="Status">${POLICY_STATUS_LABEL[p.status]}</td></tr>`; })}</tbody></table>`);
  }
  main.querySelector('#p-all').addEventListener('change', (e) => { ui.all = e.target.checked; draw(); });
  draw();
}

// ---- Form ------------------------------------------------------------------
export async function policyForm(main, { id }) {
  const editing = id && id !== 'new';
  mount(main, loadingHtml());
  if (!can.write) { mount(main, emptyHtml('You can view policies but not change them', '', html`<p><a class="btn" href="#/insurance">Back</a></p>`)); return; }
  const [contacts, existing] = await Promise.all([api.listContacts(), editing ? api.getPolicy(id) : null]);
  if (editing && !existing) { mount(main, emptyHtml('Policy not found', '', html`<p><a class="btn" href="#/insurance">Back</a></p>`)); return; }
  const contactOpts = (kind, label) => [...contacts.filter((c) => c.kind === kind).map((c) => [c.id, c.name]), ['__new__', `Add a new ${label}...`]];
  const specs = [
    { name: 'policy_number', label: 'Policy number', required: true },
    { name: 'cover_type', label: 'Type of cover', type: 'select', required: true, options: opts(POLICY_TYPE_LABEL) },
    { name: 'insurer_id', label: 'Insurer', type: 'select', blank: 'Not recorded', options: contactOpts('insurer', 'insurer') },
    { name: 'insurer_new_name', label: 'New insurer name' }, 
    { name: 'broker_id', label: 'Broker', type: 'select', blank: 'None', options: contactOpts('broker', 'broker') },
    { name: 'broker_new_name', label: 'New broker name' },
    { name: 'description', label: 'Description', span: 2 },
    { name: 'start_date', label: 'Starts', type: 'date', required: true },
    { name: 'end_date', label: 'Ends (renewal date)', type: 'date', required: true, hint: 'A task warns you 60, 30, 14 and 7 days ahead.' },
    { name: 'annual_premium', label: 'Annual premium (£)', type: 'number', step: '0.01', min: '0' },
    { name: 'excess', label: 'Excess (£)', type: 'number', step: '0.01', min: '0' },
    { name: 'payment_frequency', label: 'Paid', type: 'select', blank: 'Not recorded', options: opts(PAYMENT_FREQ_LABEL) },
    { name: 'status', label: 'Status', type: 'select', required: true, options: opts(POLICY_STATUS_LABEL) },
    { name: 'claims_phone', label: 'Claims phone', type: 'tel' }, { name: 'general_phone', label: 'General phone', type: 'tel' },
    { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
  ];
  const values = existing || { cover_type: 'fleet', status: 'active', start_date: todayStr() };
  const back = editing ? `#/insurance/${id}` : '#/insurance';
  mount(main, html`
    <header class="page-head"><h1>${editing ? `Edit ${existing.policy_number}` : 'Add policy'}</h1></header>
    <form class="page-form" id="policy-form"><fieldset><legend>Policy</legend>${fieldsHtml(specs, values)}</fieldset>
      <p class="form-error" role="alert" hidden></p>
      <div class="form-actions"><button class="btn btn-primary" type="submit">${editing ? 'Save changes' : 'Add policy'}</button><a class="btn" href="${back}">Cancel</a></div></form>`);
  const form = main.querySelector('#policy-form');
  const err = form.querySelector('.form-error');
  const toggle = (sel, nameField) => { const f = form.elements[nameField].closest('.field'); const on_ = () => { f.hidden = form.elements[sel].value !== '__new__'; }; form.elements[sel].addEventListener('change', on_); on_(); };
  toggle('insurer_id', 'insurer_new_name'); toggle('broker_id', 'broker_new_name');
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const v = readForm(form, specs);
      for (const [key, nameKey, kind] of [['insurer_id', 'insurer_new_name', 'insurer'], ['broker_id', 'broker_new_name', 'broker']]) {
        if (v[key] === '__new__') {
          if (!v[nameKey]) throw new Error(`Enter the name of the new ${kind}.`);
          v[key] = (await api.saveContact({ kind, name: v[nameKey] })).id;
        }
        delete v[nameKey];
      }
      if (v.end_date <= v.start_date) throw new Error('The policy must end after it starts.');
      const row = await api.savePolicy(v, editing ? id : null);
      toast(editing ? 'Policy saved.' : 'Policy added. Now add the vehicles it covers.');
      navigate(`#/insurance/${row.id}${editing ? '' : '?tab=cover'}`);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  };
}

// ---- Detail ----------------------------------------------------------------
const TABS = [{ id: 'cover', label: 'Vehicles covered' }, { id: 'claims', label: 'Claims' }, { id: 'documents', label: 'Documents' }];

export async function policyDetail(main, { id }, query) {
  mount(main, loadingHtml());
  const [p, contacts] = await Promise.all([api.getPolicy(id), api.listContacts()]);
  if (!p) { mount(main, emptyHtml('Policy not found', '', html`<p><a class="btn" href="#/insurance">Back</a></p>`)); return; }
  const cById = new Map(contacts.map((c) => [c.id, c]));
  const tab = TABS.find((t) => t.id === query.tab) ? query.tab : 'cover';
  const d = daysTo(p.end_date);
  mount(main, html`
    <header class="page-head">
      <div><p class="crumb"><a href="#/insurance">Insurance</a></p><h1>${p.policy_number}</h1><p class="sub">${cById.get(p.insurer_id)?.name || ''}${p.description ? ` - ${p.description}` : ''} <span class="tag">${POLICY_STATUS_LABEL[p.status]}</span></p></div>
      ${can.write ? html`<div class="head-actions"><a class="btn" href="#/insurance/${p.id}/edit">Edit</a></div>` : ''}
    </header>
    <div class="cols">
      <section>${facts([
        ['Period', `${fmtDateShort(p.start_date)} to ${fmtDateShort(p.end_date)}`],
        ['Renewal', p.status !== 'active' ? '' : html`<span class="${d < 0 ? 'c-overdue' : d <= 60 ? 'c-soon' : ''}">${d < 0 ? `Ended ${plural(-d, 'day')} ago` : `In ${plural(d, 'day')}`}</span>`],
        ['Premium', p.annual_premium != null ? `${fmtMoney(p.annual_premium)}${p.payment_frequency ? `, paid ${PAYMENT_FREQ_LABEL[p.payment_frequency].toLowerCase()}` : ''}` : ''], ['Excess', p.excess != null ? fmtMoney(p.excess) : '']])}</section>
      <section>${facts([['Type', POLICY_TYPE_LABEL[p.cover_type]], ['Broker', cById.get(p.broker_id)?.name], ['Claims phone', p.claims_phone], ['General phone', p.general_phone], ['Notes', p.notes]])}</section>
    </div>
    <nav class="tabs" aria-label="Policy sections">${TABS.map((t) => html`<a class="tab" href="#/insurance/${p.id}?tab=${t.id}" ${t.id === tab ? html`aria-current="page"` : ''}>${t.label}</a>`)}</nav>
    <div id="tab-body">${loadingHtml()}</div>`);
  const body = main.querySelector('#tab-body');
  try { await TAB_RENDER[tab](body, p); } catch (e) { console.error(e); mount(body, errorHtml(e.message)); }
}

const TAB_RENDER = {
  async cover(body, p) {
    const [rows, vehicles] = await Promise.all([api.listPolicyVehicles({ policyId: p.id }), api.listVehicles()]);
    const vById = new Map(vehicles.map((v) => [v.id, v]));
    const today = todayStr();
    const onPolicy = new Set(rows.filter((r) => !r.end_date || r.end_date >= today).map((r) => r.vehicle_id));
    mount(body, html`${can.write ? html`<p><button class="btn btn-primary" data-action="add">Add vehicles</button></p>` : ''}
      ${rows.length ? html`<table class="grid"><thead><tr><th>Vehicle</th><th>Cover from</th><th>Cover to</th><th></th></tr></thead><tbody>${rows.map((r) => { const v = vById.get(r.vehicle_id); const ended = r.end_date && r.end_date < today; return html`<tr>
        <td data-label="Vehicle">${v ? html`<a class="plate-link" href="#/vehicles/${v.id}?tab=insurance">${plate(v.registration)}</a> <span class="sub">${vehicleTitle(v)}</span>` : 'Removed vehicle'}</td>
        <td data-label="Cover from">${fmtDateShort(r.start_date || p.start_date)}</td>
        <td data-label="Cover to">${r.end_date ? fmtDateShort(r.end_date) : html`<span class="muted">Follows the policy (${fmtDateShort(p.end_date)})</span>`}</td>
        <td class="act">${can.write && !r.end_date ? html`<button class="btn btn-sm" data-action="end" data-id="${r.id}">End cover</button>` : ended ? html`<span class="tag">Ended</span>` : ''}</td></tr>`; })}</tbody></table>`
        : emptyHtml('No vehicles on this policy', 'Add the vehicles it covers.')}`);
    on(body, {
      add: () => {
        const free = vehicles.filter((v) => v.status === 'active' && !v.archived_at && !onPolicy.has(v.id));
        const specs = [{ name: 'start_date', label: 'Cover from', type: 'date', required: true }];
        openModal({
          title: 'Add vehicles to this policy', submitLabel: 'Add cover',
          body: html`${fieldsHtml(specs, { start_date: todayStr() })}
            <fieldset class="pick"><legend>Vehicles</legend>${free.length ? free.map((v) => html`<label class="check"><input type="checkbox" name="veh" value="${v.id}"> <span>${plate(v.registration)} ${vehicleTitle(v)}${v.insured_until ? html` <span class="sub">(covered until ${fmtDateShort(v.insured_until)})</span>` : ''}</span></label>`) : html`<p class="muted">Every active vehicle is already on this policy.</p>`}</fieldset>`,
          onSubmit: async (f) => {
            const chosen = [...f.querySelectorAll('input[name="veh"]:checked')].map((i) => i.value);
            if (!chosen.length) throw new Error('Tick at least one vehicle.');
            const { start_date } = readForm(f, specs);
            for (const vid of chosen) await api.addPolicyVehicle({ policy_id: p.id, vehicle_id: vid, start_date });
            toast(`${plural(chosen.length, 'vehicle')} added.`);
            navigate(location.hash);
          },
        });
      },
      end: (el) => openModal({
        title: 'End cover for this vehicle', submitLabel: 'End cover', danger: true,
        body: html`<p>The vehicle will no longer be covered by this policy from today.</p>`,
        onSubmit: async () => { await api.endPolicyVehicle(el.dataset.id, todayStr()); toast('Cover ended.'); navigate(location.hash); },
      }),
    });
  },

  async claims(body, p) {
    const [claims, vehicles, drivers] = await Promise.all([api.listClaims(p.id), api.listVehicles(), api.listDrivers()]);
    const vById = new Map(vehicles.map((v) => [v.id, v])); const dById = new Map(drivers.map((d) => [d.id, d]));
    mount(body, html`${can.write ? html`<p><button class="btn btn-primary" data-action="edit">Add claim</button></p>` : ''}
      ${claims.length ? html`<table class="grid"><thead><tr><th>Claim</th><th>Incident</th><th>Vehicle</th><th>Driver</th><th class="num">Claimed</th><th class="num">Paid</th><th>Status</th><th></th></tr></thead><tbody>${claims.map((c) => html`<tr>
        <td data-label="Claim"><strong>${c.claim_reference || 'No reference'}</strong><div class="sub">${c.description || ''}</div></td>
        <td data-label="Incident">${fmtDateShort(c.incident_date)}</td>
        <td data-label="Vehicle">${vById.get(c.vehicle_id) ? plate(vById.get(c.vehicle_id).registration) : ''}</td>
        <td data-label="Driver">${driverName(dById.get(c.driver_id))}</td>
        <td data-label="Claimed" class="num">${c.amount_claimed != null ? fmtMoney(c.amount_claimed) : ''}</td><td data-label="Paid" class="num">${c.amount_paid != null ? fmtMoney(c.amount_paid) : ''}</td>
        <td data-label="Status">${CLAIM_STATUS_LABEL[c.status]}</td>
        <td class="act">${can.write ? html`<button class="btn btn-sm" data-action="edit" data-id="${c.id}">Edit</button>` : ''}</td></tr>`)}</tbody></table>`
        : emptyHtml('No claims on this policy', 'Claims made under this policy are recorded here.')}`);
    on(body, {
      edit: (el) => {
        const c = claims.find((x) => x.id === el.dataset.id);
        const specs = [
          { name: 'claim_reference', label: 'Claim reference' }, { name: 'incident_date', label: 'Date of incident', type: 'date', required: true, max: todayStr() },
          { name: 'vehicle_id', label: 'Vehicle', type: 'select', blank: 'Not recorded', options: vehicles.map((v) => [v.id, v.registration]) },
          { name: 'driver_id', label: 'Driver', type: 'select', blank: 'Not recorded', options: drivers.map((d) => [d.id, driverName(d)]) },
          { name: 'description', label: 'What happened', type: 'textarea', span: 2 },
          { name: 'status', label: 'Status', type: 'select', required: true, options: opts(CLAIM_STATUS_LABEL) },
          { name: 'closed_date', label: 'Closed on', type: 'date' },
          { name: 'amount_claimed', label: 'Amount claimed (£)', type: 'number', step: '0.01', min: '0' }, { name: 'amount_paid', label: 'Amount paid (£)', type: 'number', step: '0.01', min: '0' },
          { name: 'excess_paid', label: 'Excess paid (£)', type: 'number', step: '0.01', min: '0' },
          { name: 'third_party_details', label: 'Other party', type: 'textarea', span: 2 }, { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
        ];
        openModal({
          title: c ? 'Edit claim' : 'Add claim', submitLabel: 'Save claim', wide: true, body: fieldsHtml(specs, c || { status: 'open' }),
          onSubmit: async (f) => { await api.saveClaim({ ...readForm(f, specs), ...(c ? {} : { policy_id: p.id }) }, c?.id); toast('Claim saved.'); navigate(location.hash); },
        });
      },
    });
  },

  async documents(body, p) { await mountDocuments(body, { target: { policy_id: p.id }, categories: POLICY_DOC_CATEGORIES }); },
};
