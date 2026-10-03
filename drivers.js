// Drivers: list, add or edit, and the detail page with tabs.
// Date of birth, licence details and convictions come from restricted tables that the database
// only returns to fleet managers, fleet admins and superusers.
import * as api from './api.js';
import { can } from './state.js';
import {
  html, mount, on, plate, pill, facts, datalist, fieldsHtml, readForm, openModal, toast, loadingHtml, emptyHtml, errorHtml,
  fmtDate, fmtDateShort, fmtMoney, dueText, todayStr, plural,
} from './ui.js';
import {
  LICENCE_STATUS_LABEL, LICENCE_METHOD_LABEL, BLOCKING_LICENCE, LEAVING_REASON_LABEL, CONVICTION_SOURCE_LABEL, DRIVER_DOC_CATEGORIES,
  driverName, worstStatus, taskKey, vehicleTitle, normLicence,
} from './domain.js';
import { openTaskPanel } from './actions.js';
import { navigate } from './router.js';
import { historyList, auditLookups } from './history.js';
import { incidentTable } from './incidents.js';
import { mountDocuments } from './docs.js';

const opts = (o) => Object.entries(o);
const licenceClass = (s) => (s === 'valid' ? 'upcoming' : BLOCKING_LICENCE.includes(s) ? 'overdue' : 'due_soon');
const licencePill = (s) => html`<span class="pill pill-${licenceClass(s)}">${LICENCE_STATUS_LABEL[s] || s}</span>`;
const parseCats = (s) => { const a = String(s || '').split(/[\s,]+/).filter(Boolean).map((x) => x.toUpperCase()); return a.length ? a : null; };
const maskLicence = (n) => (n ? `${n.slice(0, 5)}${'•'.repeat(Math.max(0, n.length - 8))}${n.slice(-3)}` : '');
const livePoints = (cs, today) => cs.filter((c) => c.status === 'live' && c.points > 0 && c.licence_until >= today).reduce((s, c) => s + c.points, 0);

// ---- List ------------------------------------------------------------------
export async function driversList(main) {
  mount(main, html`<header class="page-head"><h1>Drivers</h1></header>${loadingHtml('Loading drivers')}`);
  const [drivers, tasks, depots, vehicles, assigns, licences, convictions] = await Promise.all([
    api.listDrivers(), api.listTasks(), api.listAllDepots(), api.listVehicles(), api.listAssignments({}), api.currentLicences(), can.sensitive ? api.listConvictions() : [],
  ]);
  const depotById = new Map(depots.map((d) => [d.id, d]));
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const licBy = new Map(licences.map((l) => [l.driver_id, l]));
  const today = todayStr();
  const ui = { q: '', depot: '', former: false };
  mount(main, html`
    <header class="page-head"><h1>Drivers</h1>${can.write ? html`<a class="btn btn-primary" href="#/drivers/new">Add driver</a>` : ''}</header>
    <div class="filters">
      <input type="search" id="d-search" placeholder="Search name or employee number" aria-label="Search drivers">
      ${depots.length ? html`<label class="inline"><span class="sr-only">Depot</span><select id="d-depot"><option value="">All depots</option>${depots.filter((d) => !d.archived_at).map((d) => html`<option value="${d.id}">${d.name}</option>`)}</select></label>` : ''}
      <label class="check small"><input type="checkbox" id="d-former"> <span>Include former drivers</span></label>
    </div>
    <div id="d-table"></div>`);
  const box = main.querySelector('#d-table');
  function draw() {
    const rows = drivers.filter((d) =>
      (ui.former || d.employment_status === 'active') && (!ui.depot || d.depot_id === ui.depot) &&
      (!ui.q || [driverName(d), d.employee_number].join(' ').toLowerCase().includes(ui.q)));
    if (!drivers.length) { mount(box, emptyHtml('No drivers yet', 'Add your drivers to track licence checks and assign them to vehicles.', can.write ? html`<p><a class="btn btn-primary" href="#/drivers/new">Add a driver</a></p>` : '')); return; }
    if (!rows.length) { mount(box, emptyHtml('No drivers match', 'Try a different filter, or tick Include former drivers.')); return; }
    mount(box, html`<table class="grid"><thead><tr><th>Driver</th><th>Depot</th><th>Vehicle</th><th>Work mobile</th>${can.sensitive ? html`<th>Licence</th>` : ''}<th>Compliance</th></tr></thead><tbody>${rows.map((d) => {
      const dt = tasks.filter((t) => t.driver_id === d.id && t.applies_to === 'driver');
      const worst = worstStatus(dt);
      const lic = licBy.get(d.id);
      const pts = livePoints(convictions.filter((c) => c.driver_id === d.id), today);
      const mine = assigns.filter((a) => a.driver_id === d.id && !a.end_date).map((a) => vehicleById.get(a.vehicle_id)).filter(Boolean);
      const former = d.employment_status !== 'active';
      return html`<tr>
        <td data-label="Driver"><a href="#/drivers/${d.id}"><strong>${driverName(d)}</strong></a><div class="sub">${d.job_title || ''}${former ? html` <span class="tag">Left ${fmtDateShort(d.end_date)}</span>` : ''}</div></td>
        <td data-label="Depot">${depotById.get(d.depot_id)?.name || ''}</td>
        <td data-label="Vehicle">${mine.length ? mine.map((v) => html`<a class="plate-link" href="#/vehicles/${v.id}">${plate(v.registration)}</a> `) : html`<span class="muted">None</span>`}</td>
        <td data-label="Work mobile">${d.mobile_work || ''}${d.company_phone ? html`<div class="sub">Company phone</div>` : ''}</td>
        ${can.sensitive ? html`<td data-label="Licence">${lic ? html`${licencePill(lic.status)}<div class="sub">${pts} points${pts >= 9 ? html` <span class="c-overdue"><strong>check totting up</strong></span>` : ''}</div>` : html`<span class="muted">Not checked</span>`}</td>` : ''}
        <td data-label="Compliance">${!former && worst ? pill(worst) : html`<span class="muted">${former ? '' : 'None tracked'}</span>`}</td></tr>`;
    })}</tbody></table>`);
  }
  main.querySelector('#d-search').addEventListener('input', (e) => { ui.q = e.target.value.trim().toLowerCase(); draw(); });
  main.querySelector('#d-depot')?.addEventListener('change', (e) => { ui.depot = e.target.value; draw(); });
  main.querySelector('#d-former').addEventListener('change', (e) => { ui.former = e.target.checked; draw(); });
  draw();
}

// ---- Form ------------------------------------------------------------------
export async function driverForm(main, { id }) {
  const editing = id && id !== 'new';
  mount(main, loadingHtml());
  if (!can.write) { mount(main, emptyHtml('You can view drivers but not change them', '', html`<p><a class="btn" href="#/drivers">Back to drivers</a></p>`)); return; }
  const [depots, existing, sens] = await Promise.all([api.listAllDepots(), editing ? api.getDriver(id) : null, editing && can.sensitive ? api.getDriverSensitive(id) : null]);
  if (editing && !existing) { mount(main, emptyHtml('Driver not found', '', html`<p><a class="btn" href="#/drivers">Back to drivers</a></p>`)); return; }
  const base = [
    { name: 'first_name', label: 'First name', required: true, autocomplete: 'off' },
    { name: 'last_name', label: 'Last name', required: true, autocomplete: 'off' },
    { name: 'email', label: 'Email', type: 'email', hint: 'Used when you email them from a task.' },
    { name: 'employee_number', label: 'Employee number' },
    { name: 'mobile_work', label: 'Work mobile', type: 'tel', hint: 'The number the business uses to reach them. With no company phone, leave this blank and enter their personal number: it will be used for work as well.' },
    { name: 'mobile_personal', label: 'Personal mobile', type: 'tel' },
    { name: 'company_phone', label: 'The work mobile is a company-issued phone', type: 'checkbox', span: 2, hint: 'A company phone number is released when the driver leaves, so it can be given to someone else.' },
    { name: 'job_title', label: 'Job title' },
    { name: 'depot_id', label: 'Depot', type: 'select', blank: 'No depot', options: depots.filter((d) => !d.archived_at || d.id === existing?.depot_id).map((d) => [d.id, d.name]), hint: depots.length ? '' : 'Depots are set up under Settings.' },
    ...(editing ? [] : [{ name: 'start_date', label: 'Start date', type: 'date' }]),
    { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
  ];
  const sensitive = [
    { name: 'licence_number', label: 'Licence number', autocomplete: 'off', hint: 'Used to recognise a returning driver and for DVLA checks. Only fleet managers, fleet admins and superusers can see it, and it is never written into the audit log.' },
    { name: 'date_of_birth', label: 'Date of birth', type: 'date', hint: 'Needed for insurance.' },
    { name: 'licence_start_date', label: 'Licence held since', type: 'date' },
    { name: 'licence_type', label: 'Licence type', type: 'select', options: [['full', 'Full'], ['provisional', 'Provisional'], ['international', 'International'], ['other', 'Other']] },
    { name: 'licence_expiry_date', label: 'Photocard expiry', type: 'date' },
    { name: 'entitlement_categories', label: 'Entitlement categories', hint: 'Separate with commas, for example B, C1, C.' },
  ];
  const values = existing || {};
  const sensValues = { ...(sens || {}), entitlement_categories: (sens?.entitlement_categories || []).join(', ') };
  const back = editing ? `#/drivers/${id}` : '#/drivers';
  mount(main, html`
    <header class="page-head"><h1>${editing ? `Edit ${driverName(existing)}` : 'Add driver'}</h1></header>
    <form class="page-form" id="driver-form">
      <fieldset><legend>Driver</legend>${fieldsHtml(base, values)}</fieldset>
      ${can.sensitive ? html`<fieldset><legend>Licence details</legend>${fieldsHtml(sensitive, sensValues)}</fieldset>` : ''}
      <p class="form-error" role="alert" hidden></p>
      <div class="form-actions"><button class="btn btn-primary" type="submit">${editing ? 'Save changes' : 'Add driver'}</button><a class="btn" href="${back}">Cancel</a></div>
    </form>`);
  const form = main.querySelector('#driver-form');
  const err = form.querySelector('.form-error');
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const v = readForm(form, base);
      if (v.company_phone && !v.mobile_work) throw new Error('Enter the company phone number, or untick the company-issued phone box.');
      if (!v.mobile_work && v.mobile_personal) { v.mobile_work = v.mobile_personal; v.company_phone = false; }
      let s = null;
      if (can.sensitive) {
        s = readForm(form, sensitive);
        s.entitlement_categories = parseCats(s.entitlement_categories);
        s.licence_number = s.licence_number ? normLicence(s.licence_number) : null;
        if (s.licence_number && s.licence_number.length < 5) throw new Error('That licence number looks too short.');
        if (!editing && s.licence_number) {
          const hit = await api.findDriverByLicence(s.licence_number);
          if (hit) throw new Error(`${driverName(hit)} is already recorded with this licence number${hit.employment_status === 'left' ? ` (left ${fmtDateShort(hit.end_date)}). Open them under Drivers with Include former drivers ticked and use Rehire instead of adding them again` : ''}.`);
        }
      }
      const row = await api.saveDriver(v, s, editing ? id : null, !!sens);
      toast(editing ? 'Driver saved.' : 'Driver added. Log their first licence check next.');
      navigate(`#/drivers/${row.id}${editing ? '' : '?tab=licence'}`);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  };
}

// ---- Detail ----------------------------------------------------------------
const TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'licence', label: 'Licence', when: () => can.sensitive }, { id: 'convictions', label: 'Points and convictions', when: () => can.sensitive },
  { id: 'employment', label: 'Employment' }, { id: 'incidents', label: 'Incidents' }, { id: 'documents', label: 'Documents' },
  { id: 'compliance', label: 'Compliance' }, { id: 'history', label: 'History', when: () => can.audit },
];

export async function driverDetail(main, { id }, query) {
  mount(main, loadingHtml());
  const [d, periods] = await Promise.all([api.getDriver(id), api.listPeriods(id)]);
  if (!d) { mount(main, emptyHtml('Driver not found', '', html`<p><a class="btn" href="#/drivers">Back to drivers</a></p>`)); return; }
  const tab = TABS.find((t) => t.id === query.tab && (!t.when || t.when())) ? query.tab : 'overview';
  const open = periods.find((p) => !p.end_date);
  mount(main, html`
    <header class="page-head">
      <div><p class="crumb"><a href="#/drivers">Drivers</a></p><h1>${driverName(d)}</h1><p class="sub">${d.job_title || ''}${open ? '' : html` <span class="tag">Left ${fmtDateShort(d.end_date)}</span>`}</p></div>
      ${can.write ? html`<div class="head-actions"><a class="btn" href="#/drivers/${d.id}/edit">Edit</a>${open ? html`<button class="btn" data-action="leave">Record leaver</button>` : html`<button class="btn btn-primary" data-action="rehire">Rehire</button>`}</div>` : ''}
    </header>
    <nav class="tabs" aria-label="Driver sections">${TABS.filter((t) => !t.when || t.when()).map((t) => html`<a class="tab" href="#/drivers/${d.id}?tab=${t.id}" ${t.id === tab ? html`aria-current="page"` : ''}>${t.label}</a>`)}</nav>
    <div id="tab-body">${loadingHtml()}</div>`);
  const again = () => navigate(`#/drivers/${d.id}${query.tab ? `?tab=${query.tab}` : ''}`);
  on(main, { leave: () => leaveModal(d, again), rehire: () => rehireModal(d, periods, again) });
  const body = main.querySelector('#tab-body');
  try { await TAB_RENDER[tab](body, d, periods); } catch (e) { console.error(e); mount(body, errorHtml(e.message)); }
}

function leaveModal(d, done) {
  const specs = [
    { name: 'end_date', label: 'Last day of employment', type: 'date', required: true },
    { name: 'leaving_reason', label: 'Reason', type: 'select', required: true, options: opts(LEAVING_REASON_LABEL) },
    { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
  ];
  openModal({
    title: `Record ${driverName(d)} as a leaver`, submitLabel: 'Record leaver', danger: true,
    body: html`<p class="muted">This ends their current vehicle assignment${d.company_phone ? ' and releases the company phone number so it can be given to someone else' : ''}. Their records, history and licence details are all kept, and they can be rehired later.</p>${fieldsHtml(specs, { end_date: todayStr() })}`,
    onSubmit: async (f) => { const v = readForm(f, specs); await api.leaveDriver({ id: d.id, date: v.end_date, reason: v.leaving_reason, notes: v.notes }); toast('Leaver recorded.'); done(); },
  });
}
function rehireModal(d, periods, done) {
  const last = periods[0];
  const specs = [
    { name: 'start_date', label: 'Start date', type: 'date', required: true, min: last?.end_date || undefined },
    { name: 'employee_number', label: 'Employee number', hint: 'Normally the same as before.' },
    { name: 'job_title', label: 'Job title' },
  ];
  openModal({
    title: `Rehire ${driverName(d)}`, submitLabel: 'Rehire',
    body: html`<p class="muted">This starts a new period of employment. Their earlier periods, licence details, convictions and history stay as they are, and a new licence check becomes due on the start date.</p>${fieldsHtml(specs, { start_date: todayStr(), employee_number: last?.employee_number || d.employee_number || '', job_title: last?.job_title || d.job_title || '' })}`,
    onSubmit: async (f) => { const v = readForm(f, specs); await api.rehireDriver({ id: d.id, startDate: v.start_date, employeeNumber: v.employee_number, jobTitle: v.job_title }); toast('Rehired. A licence check is now due.'); done(); },
  });
}

const TAB_RENDER = {
  async overview(body, d, periods) {
    const [assigns, vehicles, depots] = await Promise.all([api.listAssignments({ driverId: d.id }), api.listVehicles(), api.listAllDepots()]);
    const vById = new Map(vehicles.map((v) => [v.id, v]));
    const open = periods.find((p) => !p.end_date);
    mount(body, html`<div class="cols">
      <section><h2>Contact and employment</h2>${facts([
        ['Email', d.email ? html`<a href="mailto:${d.email}">${d.email}</a>` : ''],
        ['Work mobile', d.mobile_work ? html`${d.mobile_work}${d.company_phone ? html` <span class="tag">Company phone</span>` : ''}` : ''],
        ['Personal mobile', d.mobile_personal && d.mobile_personal !== d.mobile_work ? d.mobile_personal : (d.mobile_personal ? 'Same as work mobile' : '')],
        ['Employee number', d.employee_number], ['Depot', depots.find((x) => x.id === d.depot_id)?.name],
        ['Employment', open ? `Current, since ${fmtDateShort(open.start_date)}` : `Left ${fmtDateShort(d.end_date)}`]])}</section>
      <section><h2>Vehicles</h2>${assigns.length ? html`<ul class="plain">${assigns.map((a) => {
        const v = vById.get(a.vehicle_id);
        return html`<li>${v ? html`<a class="plate-link" href="#/vehicles/${v.id}">${plate(v.registration)}</a> <span class="muted">${vehicleTitle(v)}</span>` : 'Former vehicle'}
          <div class="sub">${a.assignment_type === 'primary' ? 'Primary driver' : 'Named driver'}, ${fmtDateShort(a.start_date)} to ${a.end_date ? fmtDateShort(a.end_date) : 'now'}</div></li>`;
      })}</ul>` : html`<p class="muted">Not assigned to a vehicle. Assign them from a vehicle's Drivers tab.</p>`}</section>
      ${d.notes ? html`<section class="span-all"><h2>Notes</h2><p class="prewrap">${d.notes}</p></section>` : ''}
    </div>`);
  },

  async licence(body, d) {
    let [sens, checks] = await Promise.all([api.getDriverSensitive(d.id), api.listLicenceChecks(d.id)]);
    let shown = false;
    const draw = () => {
      const last = checks[0];
      mount(body, html`<div class="cols">
        <section><h2>Licence details</h2>${sens ? facts([
          ['Licence number', sens.licence_number ? html`<span class="mono">${shown ? sens.licence_number : maskLicence(sens.licence_number)}</span> <button class="link" data-action="reveal">${shown ? 'Hide' : 'Show'}</button>` : ''],
          ['Date of birth', fmtDate(sens.date_of_birth)], ['Licence held since', fmtDateShort(sens.licence_start_date)], ['Type', sens.licence_type],
          ['Photocard expiry', fmtDateShort(sens.licence_expiry_date)], ['Categories', (sens.entitlement_categories || []).join(', ')]]) : html`<p class="muted">No licence details recorded.${can.write ? html` <a href="#/drivers/${d.id}/edit">Add them</a>.` : ''}</p>`}</section>
        <section><h2>Latest check</h2>${last ? html`<p>${licencePill(last.status)} <span class="muted">${fmtDate(last.checked_on)}</span></p>${facts([
          ['Points', last.points], ['Next check due', last.next_check_due ? fmtDate(last.next_check_due) : ''], ['Endorsements', last.endorsements]])}`
          : html`<p class="muted">No licence check recorded yet.</p>`}</section>
      </div>
      <h2 class="spaced">Check history</h2>
      ${can.write ? html`<p><button class="btn btn-primary" data-action="check">Log a licence check</button></p>` : ''}
      ${checks.length ? html`<table class="grid"><thead><tr><th>Checked</th><th>Result</th><th class="num">Points</th><th>Method</th><th>Notes</th></tr></thead><tbody>${checks.map((c) => html`<tr>
        <td data-label="Checked">${fmtDate(c.checked_on)}</td><td data-label="Result">${licencePill(c.status)}</td><td data-label="Points" class="num">${c.points ?? ''}</td>
        <td data-label="Method">${LICENCE_METHOD_LABEL[c.method]}</td><td data-label="Notes">${[c.endorsements, c.notes].filter(Boolean).join('. ')}</td></tr>`)}</tbody></table>`
        : emptyHtml('No checks yet', 'Log a check each time you verify the licence, for example with a DVLA share code.')}`);
    };
    const reload = async () => { [sens, checks] = await Promise.all([api.getDriverSensitive(d.id), api.listLicenceChecks(d.id)]); draw(); };
    draw();
    on(body, {
      reveal: () => { shown = !shown; draw(); },
      check: () => {
        const specs = [
          { name: 'checked_on', label: 'Checked on', type: 'date', required: true, max: todayStr() },
          { name: 'method', label: 'How was it checked?', type: 'select', required: true, options: opts(LICENCE_METHOD_LABEL) },
          { name: 'status', label: 'Result', type: 'select', required: true, options: opts(LICENCE_STATUS_LABEL) },
          { name: 'points', label: 'Penalty points', type: 'number', min: '0', step: '1' },
          { name: 'entitlement_categories', label: 'Entitlement categories', hint: 'Separate with commas, for example B, C1.' },
          { name: 'next_check_due', label: 'Next check due', type: 'date', hint: 'Leave blank to use the standard interval.' },
          { name: 'endorsements', label: 'Endorsements', type: 'textarea', span: 2 },
          { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
        ];
        openModal({
          title: `Licence check: ${driverName(d)}`, submitLabel: 'Save check',
          body: html`${fieldsHtml(specs, { checked_on: todayStr(), method: 'dvla_share_code', status: 'valid' })}<p class="hint">If the check shows new points, record the conviction under Points and convictions as well.</p>`,
          onSubmit: async (f) => {
            const v = readForm(f, specs);
            v.entitlement_categories = parseCats(v.entitlement_categories);
            await api.addLicenceCheck({ ...v, driver_id: d.id });
            toast(BLOCKING_LICENCE.includes(v.status) ? 'Check saved. This driver can no longer be assigned without an override.' : 'Licence check saved.');
            await reload();
          },
        });
      },
    });
  },

  async convictions(body, d) {
    const [codes, vehicles] = await Promise.all([api.listConvictionCodes(), api.listVehicles()]);
    let list = await api.listConvictions(d.id);
    const today = todayStr();
    const draw = () => {
      const live = list.filter((c) => c.status === 'live' && c.points > 0);
      const onLicence = livePoints(list, today);
      const totting = live.filter((c) => c.totting_until >= today).reduce((s, c) => s + c.points, 0);
      mount(body, html`
        ${totting >= 12 ? html`<p class="banner-danger"><strong>${totting} points count towards totting up.</strong> Twelve or more points within three years normally means disqualification for at least six months.</p>`
          : totting >= 9 ? html`<p class="banner-warn"><strong>${totting} points count towards totting up.</strong> Another offence of ${12 - totting} or more points would reach twelve.</p>` : ''}
        <div class="cols">
          <section>${facts([['Points on the licence now', `${onLicence}`], ['Points counting towards totting up', `${totting}`]])}
            <p class="hint">Totting up counts points from offences in the last three years. Points stay on the licence for four years from the offence (eleven years from conviction for drink and drug offences).</p></section>
          <section>${can.write ? html`<p><button class="btn btn-primary" data-action="edit">Record a conviction</button></p>` : ''}
            <p class="hint">Adding one creates a task to tell the insurer, and tasks that warn you when it comes off the licence and when it no longer needs declaring.</p></section>
        </div>
        ${list.length ? html`<table class="grid"><thead><tr><th>Offence</th><th>Offence date</th><th class="num">Points</th><th>Off the licence</th><th>Totting up</th><th>Declare to insurer</th><th>Insurer told</th><th></th></tr></thead><tbody>${list.map((c) => {
          const removed = c.status === 'removed';
          return html`<tr>
            <td data-label="Offence"><strong>${c.offence_code}</strong>${removed ? html` <span class="tag">Removed</span>` : ''}<div class="sub">${c.description || ''}</div>${c.fine_amount != null ? html`<div class="sub">Fine ${fmtMoney(c.fine_amount)}${c.disqualified_months ? `, disqualified ${plural(c.disqualified_months, 'month')}` : ''}</div>` : ''}</td>
            <td data-label="Offence date">${fmtDateShort(c.offence_date)}${c.conviction_date !== c.offence_date ? html`<div class="sub">Convicted ${fmtDateShort(c.conviction_date)}</div>` : ''}</td>
            <td data-label="Points" class="num">${c.points}</td>
            <td data-label="Off the licence">${c.licence_until ? (c.licence_until >= today ? fmtDateShort(c.licence_until) : html`<span class="muted">Off since ${fmtDateShort(c.licence_until)}</span>`) : ''}</td>
            <td data-label="Totting up">${c.totting_until ? (c.totting_until >= today ? html`Counts until ${fmtDateShort(c.totting_until)}` : html`<span class="muted">No longer counts</span>`) : ''}</td>
            <td data-label="Declare to insurer">${c.disclose_until >= today ? html`Until ${fmtDateShort(c.disclose_until)}` : html`<span class="muted">No longer needed</span>`}</td>
            <td data-label="Insurer told">${c.insurer_notified_on ? html`${fmtDateShort(c.insurer_notified_on)}${c.insurer_notified_ref ? html`<div class="sub">${c.insurer_notified_ref}</div>` : ''}` : (removed ? '' : html`<span class="c-soon"><strong>Not yet</strong></span> ${can.write ? html`<button class="btn btn-sm" data-action="told" data-id="${c.id}">Record</button>` : ''}`)}</td>
            <td class="act">${can.write && !removed ? html`<button class="btn btn-sm" data-action="edit" data-id="${c.id}">Edit</button> <button class="btn btn-sm" data-action="remove" data-id="${c.id}">Remove</button>` : ''}</td></tr>`;
        })}</tbody></table>` : emptyHtml('No convictions recorded', 'Record any penalty points or convictions as soon as you are told, without waiting for a licence check.')}`);
    };
    const reload = async () => { list = await api.listConvictions(d.id); draw(); };
    draw();
    on(body, {
      edit: (el) => {
        const c = list.find((x) => x.id === el.dataset.id);
        const specs = [
          { name: 'offence_code', label: 'Offence code', required: true, list: 'code-list', autocomplete: 'off', hint: 'For example SP30. Pick from the list or type your own.' },
          { name: 'description', label: 'Description' },
          { name: 'offence_date', label: 'Date of offence', type: 'date', required: true, max: todayStr() },
          { name: 'conviction_date', label: 'Date of conviction or penalty', type: 'date', hint: 'Leave blank if it is the same as the offence date.' },
          { name: 'points', label: 'Penalty points', type: 'number', required: true, min: '0', max: '12', step: '1' },
          { name: 'fine_amount', label: 'Fine (£)', type: 'number', min: '0', step: '0.01' },
          { name: 'disqualified_months', label: 'Disqualified for (months)', type: 'number', min: '0', step: '1' },
          { name: 'court', label: 'Court' },
          { name: 'vehicle_id', label: 'Vehicle involved', type: 'select', blank: 'Not known', options: vehicles.map((v) => [v.id, v.registration]) },
          { name: 'source', label: 'How we found out', type: 'select', required: true, options: opts(CONVICTION_SOURCE_LABEL) },
          { name: 'advised_on', label: 'Date we were told', type: 'date', required: true, max: todayStr() },
          { name: 'disclose_years', label: 'Insurer declaration period (years)', type: 'number', min: '0', max: '20', step: '1', hint: 'Leave blank for the standard 5 years from the conviction date.' },
          { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
        ];
        const dlg = openModal({
          title: c ? `Edit conviction ${c.offence_code}` : `Record a conviction: ${driverName(d)}`, submitLabel: 'Save', wide: true,
          body: html`${datalist('code-list', codes.map((x) => [x.code, x.description]))}${fieldsHtml(specs, c || { source: 'notice', advised_on: todayStr() })}`,
          onSubmit: async (f) => {
            const v = readForm(f, specs);
            v.offence_code = String(v.offence_code).toUpperCase().trim();
            await api.saveConviction(c ? v : { ...v, driver_id: d.id }, c?.id);
            toast(c ? 'Conviction saved.' : 'Conviction recorded. A task to tell the insurer has been added.');
            await reload();
          },
        });
        const f = dlg.querySelector('form');
        const fill = () => {
          const hit = codes.find((x) => x.code === f.elements.offence_code.value.toUpperCase().trim());
          if (!hit || c) return;
          if (!f.elements.description.value) f.elements.description.value = hit.description;
          if (f.elements.points.value === '') f.elements.points.value = hit.points_default;
        };
        f.elements.offence_code.addEventListener('input', fill); f.elements.offence_code.addEventListener('change', fill);
      },
      told: (el) => {
        const specs = [{ name: 'date', label: 'Date the insurer was told', type: 'date', required: true, max: todayStr() }, { name: 'ref', label: 'Reference given by the insurer', span: 2 }];
        openModal({
          title: 'Record that the insurer was told', submitLabel: 'Save', body: fieldsHtml(specs, { date: todayStr() }),
          onSubmit: async (f) => { const v = readForm(f, specs); await api.updateConviction(el.dataset.id, { insurer_notified_on: v.date, insurer_notified_ref: v.ref }); toast('Recorded.'); await reload(); },
        });
      },
      remove: (el) => {
        const specs = [{ name: 'reason', label: 'Why is it being removed?', type: 'textarea', required: true, span: 2, hint: 'For example: endorsement removed by DVLA, or recorded in error.' }];
        openModal({
          title: 'Remove this conviction?', submitLabel: 'Remove', danger: true, body: fieldsHtml(specs),
          onSubmit: async (f) => { const v = readForm(f, specs); await api.updateConviction(el.dataset.id, { status: 'removed', removal_reason: v.reason }); toast('Conviction removed. Its tasks are cleared.'); await reload(); },
        });
      },
    });
  },

  async employment(body, d, periods) {
    mount(body, html`<p class="muted">Every period this person has worked as a driver. Their licence details, convictions, incidents and documents stay with them across periods.</p>
      <table class="grid"><thead><tr><th>From</th><th>To</th><th>Employee number</th><th>Job title</th><th>Reason for leaving</th></tr></thead><tbody>${periods.map((p) => html`<tr>
        <td data-label="From">${fmtDate(p.start_date)}</td><td data-label="To">${p.end_date ? fmtDate(p.end_date) : html`<strong>Current</strong>`}</td>
        <td data-label="Employee number">${p.employee_number || ''}</td><td data-label="Job title">${p.job_title || ''}</td>
        <td data-label="Reason for leaving">${p.leaving_reason ? LEAVING_REASON_LABEL[p.leaving_reason] : ''}${p.notes ? html`<div class="sub">${p.notes}</div>` : ''}</td></tr>`)}</tbody></table>`);
  },

  async incidents(body, d) {
    const [list, vehicles] = await Promise.all([api.listIncidents({ driverId: d.id }), api.listVehicles()]);
    mount(body, html`${can.write ? html`<p><a class="btn btn-primary" href="#/incidents/new?driver=${d.id}">Report an accident, damage or fine</a></p>` : ''}
      ${list.length ? incidentTable(list, { vehicles: new Map(vehicles.map((v) => [v.id, v])), drivers: new Map([[d.id, d]]) }, { hideDriver: true })
        : emptyHtml('No incidents', 'Accidents, damage and fines involving this driver will appear here.')}`);
  },

  async documents(body, d) { await mountDocuments(body, { target: { driver_id: d.id }, categories: DRIVER_DOC_CATEGORIES }); },

  async compliance(body, d) {
    const ctx = { vehicles: new Map(), drivers: new Map([[d.id, d]]) };
    const load = async () => (await api.listTasks({ driverId: d.id })).filter((t) => t.driver_id === d.id);
    let tasks = await load();
    const byKey = (k) => tasks.find((t) => taskKey(t) === k);
    const draw = () => {
      if (!tasks.length) { mount(body, emptyHtml('Nothing tracked for this driver', d.employment_status === 'active' ? 'Compliance items are created from the types switched on for your organisation.' : 'Former drivers do not raise tasks.')); return; }
      mount(body, html`<table class="grid"><thead><tr><th>Item</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${tasks.map((t) => html`<tr>
        <td data-label="Item"><button class="task-title" data-action="open" data-key="${taskKey(t)}">${t.type_name}</button>${t.is_statutory ? html` <span class="tag">Statutory</span>` : ''}${t.applies_to !== 'driver' ? html`<div class="sub">${t.target_label}</div>` : ''}</td>
        <td data-label="Due">${t.due_date ? html`${fmtDate(t.due_date)}<div class="sub">${dueText(t.days_remaining)}</div>` : html`<span class="muted">Not set</span>`}</td>
        <td data-label="Status">${pill(t.status)}</td>
        <td class="act">${can.write ? html`<button class="btn btn-sm" data-action="open" data-key="${taskKey(t)}">${t.due_date ? 'Manage' : 'Set date'}</button>` : ''}</td></tr>`)}</tbody></table>`);
    };
    const refresh = async () => { tasks = await load(); draw(); };
    draw();
    on(body, { open: (el) => { const t = byKey(el.dataset.key); if (t) openTaskPanel(t, ctx, refresh); } });
  },

  async history(body, d) {
    const [L, entries] = await Promise.all([auditLookups(), api.listAuditFor({ driverId: d.id })]);
    mount(body, html`<h2>Change history</h2><p class="muted">Every significant change to this driver and their records, newest first.</p>${historyList(entries, L)}`);
  },
};
