// Reports: vehicle damage, accidents, vehicle mileage and vehicle status. On screen, any period, to Excel or PDF.
import * as api from './api.js';
import { html, mount, on, plate, loadingHtml, emptyHtml, fmtDateShort, fmtMoney, fmtInt, todayStr, plural, toast } from './ui.js';
import { UNAVAIL_REASON_LABEL, INCIDENT_KIND_LABEL, VEHICLE_STATUS_LABEL, availability, driverName, vehicleTitle, incidentTitle } from './domain.js';
import { loadPeriod, periodControlsHtml, wirePeriod, periodLabel, inPeriod, milesFromRows, leaseProjection, eventDaysInPeriod, eventTouchesPeriod } from './insight.js';
import { downloadExcel, downloadPdf } from './exports.js';

export const REPORTS = [
  ['damage', 'Vehicle damage', 'Damage to vehicles, including damage from accidents, with repair costs, insurer payments and time off the road.'],
  ['accidents', 'Accidents', 'Every accident in the period: who, where, fault, injuries, police and insurer details, and costs.'],
  ['mileage', 'Vehicle mileage', 'Miles driven by each vehicle in the period, from odometer readings, with lease mileage against the cap.'],
  ['status', 'Vehicle status', 'Where every vehicle is now (available, at a garage, off the road with or without a SORN), and time out of service in the period.'],
];
const yes = (b) => (b === true ? 'Yes' : b === false ? 'No' : '');
const totalDays = (e, today) => { const end = e.returned_on || (e.from_date > today ? e.from_date : today); return Math.max(0, Math.round((new Date(`${end}T00:00:00`) - new Date(`${e.from_date}T00:00:00`)) / 86400000)); };
const sum = (rows, k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
const num = (v) => (v == null ? null : Number(v));

// Builds the report model that both the screen and the downloads use.
export function buildReport(key, data, p, today = todayStr()) {
  const { vehicles, drivers, incidents, depots, miles, events, garages } = data;
  const vById = new Map(vehicles.map((v) => [v.id, v])); const dById = new Map(drivers.map((d) => [d.id, d]));
  const depotName = (id) => depots.find((d) => d.id === id)?.name || '';
  const gName = (id) => garages.find((g) => g.id === id)?.name || '';
  const reg = (id) => vById.get(id)?.registration || '';
  const sub = (extra) => `${periodLabel(p)}${extra ? `. ${extra}` : ''}`;

  if (key === 'damage' || key === 'accidents') {
    const kinds = key === 'damage' ? ['damage', 'accident'] : ['accident'];
    const list = incidents.filter((i) => kinds.includes(i.kind) && inPeriod(i.incident_date, p)).sort((a, b) => b.incident_date.localeCompare(a.incident_date));
    const rows = list.map((i) => {
      const off = events.filter((e) => e.incident_id === i.id).reduce((s, e) => s + totalDays(e, today), 0);
      return { id: i.id, vehicle_id: i.vehicle_id, date: i.incident_date, vehicle: reg(i.vehicle_id), driver: driverName(dById.get(i.driver_id)), what: INCIDENT_KIND_LABEL[i.kind], location: i.location || '',
        description: i.description || '', at_fault: yes(i.at_fault), injuries: i.injuries ? 'Yes' : '', police: i.police_reference || '', insurer_told: i.insurer_notified_on || null,
        repair: num(i.repair_cost), excess: num(i.excess_paid), insurer: num(i.insurer_paid), third: num(i.third_party_cost), days: off || null, repaired: i.repaired_on || null, status: ({ open: 'Open', claim_in_progress: 'Claim in progress', resolved: 'Resolved', closed: 'Closed' })[i.status] };
    });
    const totals = { date: `Total (${rows.length})`, repair: sum(rows, 'repair'), excess: sum(rows, 'excess'), insurer: sum(rows, 'insurer'), third: sum(rows, 'third'), days: sum(rows, 'days') };
    const faultCount = list.filter((i) => i.at_fault === true).length;
    if (key === 'damage') {
      return { key, title: 'Vehicle damage', subtitle: sub(`Damage to vehicles, including damage from accidents. ${plural(list.filter((i) => i.kind === 'accident').length, 'accident')} and ${list.filter((i) => i.kind === 'damage').length} other damage records.`),
        columns: [{ key: 'date', label: 'Date', type: 'date', width: 12 }, { key: 'vehicle', label: 'Vehicle', type: 'text', width: 10 }, { key: 'driver', label: 'Driver', type: 'text', width: 16 }, { key: 'what', label: 'Cause', type: 'text', width: 9 },
          { key: 'description', label: 'What happened', type: 'text', width: 34 }, { key: 'at_fault', label: 'At fault', type: 'text', width: 7 }, { key: 'repair', label: 'Repair cost', type: 'money', width: 11 }, { key: 'excess', label: 'Excess paid', type: 'money', width: 11 },
          { key: 'insurer', label: 'Paid by insurer', type: 'money', width: 11 }, { key: 'third', label: 'Other parties', type: 'money', width: 11 }, { key: 'days', label: 'Days off road', type: 'int', width: 7 }, { key: 'repaired', label: 'Repaired', type: 'date', width: 12 }, { key: 'status', label: 'Status', type: 'text', width: 12 }],
        rows, totals, summary: [['Records', rows.length], ['Repair costs', fmtMoney(totals.repair)], ['Paid by insurers', fmtMoney(totals.insurer)], ['Days off the road', fmtInt(totals.days)]] };
    }
    return { key, title: 'Accidents', subtitle: sub(`${plural(rows.length, 'accident')}, ${faultCount} with the driver at fault.`),
      columns: [{ key: 'date', label: 'Date', type: 'date', width: 12 }, { key: 'vehicle', label: 'Vehicle', type: 'text', width: 10 }, { key: 'driver', label: 'Driver', type: 'text', width: 16 }, { key: 'location', label: 'Where', type: 'text', width: 20 },
        { key: 'at_fault', label: 'At fault', type: 'text', width: 7 }, { key: 'injuries', label: 'Injuries', type: 'text', width: 8 }, { key: 'police', label: 'Police ref', type: 'text', width: 12 }, { key: 'insurer_told', label: 'Insurer told', type: 'date', width: 12 },
        { key: 'repair', label: 'Repair cost', type: 'money', width: 11 }, { key: 'excess', label: 'Excess paid', type: 'money', width: 11 }, { key: 'insurer', label: 'Paid by insurer', type: 'money', width: 11 }, { key: 'third', label: 'Other parties', type: 'money', width: 11 }, { key: 'status', label: 'Status', type: 'text', width: 12 }],
      rows, totals, summary: [['Accidents', rows.length], ['At fault', faultCount], ['With injuries', list.filter((i) => i.injuries).length], ['Repair costs', fmtMoney(totals.repair)]] };
  }

  if (key === 'mileage') {
    const m = miles || new Map();
    const rows = vehicles.filter((v) => !v.archived_at).map((v) => {
      const r = m.get(v.id); const lease = leaseProjection(v, v.latest_mileage, today);
      return { vehicle_id: v.id, vehicle: v.registration, model: vehicleTitle(v), depot: depotName(v.depot_id), driver: driverName(dById.get(v.primary_driver_id)),
        readings: r?.start && r?.end ? `${fmtInt(r.start.mileage)} (${fmtDateShort(r.start.reading_date)}) to ${fmtInt(r.end.mileage)} (${fmtDateShort(r.end.reading_date)})` : 'No readings',
        miles: r && r.miles ? r.miles : 0, per_day: r?.perDay ?? null, latest: v.latest_mileage ?? null, cap: lease?.cap ?? null, projected: lease?.projected ?? null,
        note: lease ? (lease.over ? 'Projected over the cap' : 'Within the cap') : (v.status === 'disposed' ? 'Disposed' : '') };
    }).sort((a, b) => b.miles - a.miles || a.vehicle.localeCompare(b.vehicle));
    const driving = rows.filter((r) => r.miles > 0);
    const totals = { vehicle: `Total (${rows.length})`, miles: sum(rows, 'miles'), per_day: driving.length ? sum(driving, 'per_day') / driving.length : null };
    return { key, title: 'Vehicle mileage', subtitle: sub(`${fmtInt(totals.miles)} miles across ${plural(driving.length, 'vehicle')} with readings in the period.`),
      columns: [{ key: 'vehicle', label: 'Vehicle', type: 'text', width: 10 }, { key: 'model', label: 'Make and model', type: 'text', width: 20 }, { key: 'depot', label: 'Depot', type: 'text', width: 16 }, { key: 'driver', label: 'Driver', type: 'text', width: 16 },
        { key: 'readings', label: 'Readings used', type: 'text', width: 32 }, { key: 'miles', label: 'Miles in period', type: 'int', width: 9 }, { key: 'per_day', label: 'Miles per day', type: 'number', width: 8 }, { key: 'latest', label: 'Latest odometer', type: 'int', width: 10 },
        { key: 'cap', label: 'Lease mileage cap', type: 'int', width: 9 }, { key: 'projected', label: 'Projected at lease end', type: 'int', width: 11 }, { key: 'note', label: 'Note', type: 'text', width: 14 }],
      rows, totals, summary: [['Fleet miles', fmtInt(totals.miles)], ['Vehicles with readings', driving.length], ['Average per vehicle', driving.length ? fmtInt(Math.round(totals.miles / driving.length)) : '0']] };
  }

  // status
  const rows = vehicles.filter((v) => !v.archived_at).map((v) => {
    const a = availability(v); const mine = events.filter((e) => e.vehicle_id === v.id);
    const e = mine.find((x) => x.id === v.unavailable_event_id);
    const touched = mine.filter((x) => eventTouchesPeriod(x, p, today));
    let where = ''; let since = null; let expected = null;
    if (a.key === 'garage') { where = `${gName(v.unavailable_garage_id)}${e ? `: ${UNAVAIL_REASON_LABEL[e.reason]}` : ''}`; since = v.unavailable_since; expected = v.unavailable_expected_return; }
    else if (a.key === 'sorn' || a.key === 'off_road_no_sorn') { where = e?.location_note || 'Off the road'; since = v.unavailable_since; }
    else if (a.key === 'booked') { where = 'Booked in'; since = v.next_booking_date; }
    else if (a.key === 'disposed') { since = v.disposed_date; where = v.sold_to || ''; }
    return { vehicle_id: v.id, vehicle: v.registration, model: vehicleTitle(v), depot: depotName(v.depot_id), driver: driverName(dById.get(v.primary_driver_id)), status: a.label, where, since, expected,
      sorn: a.key === 'sorn' ? v.sorn_declared_on : null, days: touched.reduce((s, x) => s + eventDaysInPeriod(x, p, today), 0) || null, visits: touched.filter((x) => x.reason !== 'off_road').length || null,
      insured: v.insured_until || null, order: { garage: 0, off_road_no_sorn: 1, sorn: 2, booked: 3, available: 4, disposed: 5 }[a.key] ?? 6 };
  }).sort((a, b) => a.order - b.order || a.vehicle.localeCompare(b.vehicle));
  const n = (k) => rows.filter((r) => r.status === k).length;
  const totals = { vehicle: `Total (${rows.length})`, days: sum(rows, 'days'), visits: sum(rows, 'visits') };
  const live = rows.filter((r) => r.status !== 'Disposed');
  return { key, title: 'Vehicle status', subtitle: sub(`Status is as of ${fmtDateShort(today)}. Days out of service and garage visits are for the period.`),
    columns: [{ key: 'vehicle', label: 'Vehicle', type: 'text', width: 10 }, { key: 'model', label: 'Make and model', type: 'text', width: 20 }, { key: 'depot', label: 'Depot', type: 'text', width: 16 }, { key: 'driver', label: 'Driver', type: 'text', width: 16 },
      { key: 'status', label: 'Status', type: 'text', width: 20 }, { key: 'where', label: 'Where and why', type: 'text', width: 30 }, { key: 'since', label: 'Since or booked for', type: 'date', width: 12 }, { key: 'expected', label: 'Expected back', type: 'date', width: 12 },
      { key: 'sorn', label: 'SORN declared', type: 'date', width: 12 }, { key: 'days', label: 'Days out in period', type: 'int', width: 8 }, { key: 'visits', label: 'Garage visits', type: 'int', width: 8 }, { key: 'insured', label: 'Insured until', type: 'date', width: 12 }],
    rows, totals, summary: [['Vehicles', live.length], ['Available', n('Available') + n('Available, booked in')], ['At the garage', n('At the garage')], ['Off the road', n('Off the road (SORN)') + n('Off the road, no SORN yet') + n('Off the road, no record')], ['Disposed', n('Disposed')]] };
}

// ---- Screen -------------------------------------------------------------------------------------
const fmt = { date: (v) => fmtDateShort(v), money: (v) => fmtMoney(v), int: (v) => fmtInt(v), number: (v) => Number(v).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }), text: (v) => v };
const cellHtml = (c, v) => (v === null || v === undefined || v === '' ? '' : (['date', 'money', 'int', 'number'].includes(c.type) && c.type !== 'date' && Number.isFinite(Number(v)) ? fmt[c.type](v) : (c.type === 'date' && /^\d{4}-/.test(String(v)) ? fmt.date(v) : String(v))));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function reportsView(main, params, query) {
  mount(main, html`<header class="page-head"><h1>Reports</h1></header>${loadingHtml('Loading reports')}`);
  const [vehicles, drivers, incidents, depots, allEvents, garages] = await Promise.all([
    api.listVehicles(), api.listDrivers(), api.listIncidents(), api.listAllDepots(), api.listUnavailability(), api.listGarages(),
  ]);
  const data = { vehicles, drivers, incidents, depots, events: allEvents.filter((e) => !e.cancelled_at), garages, miles: new Map() };
  const key = REPORTS.some((r) => r[0] === query.report) ? query.report : 'damage';
  const info = REPORTS.find((r) => r[0] === key);
  const p = loadPeriod();
  let model = null;

  let drawing = 0;
  async function draw() {
    const mine = ++drawing;
    if (key === 'mileage') { const rows = await api.milesInPeriod(p); if (mine !== drawing) return; data.miles = milesFromRows(rows); }
    model = buildReport(key, data, p);
    const money = (c) => ['money', 'int', 'number'].includes(c.type);
    mount(main, html`
      <header class="page-head"><h1>Reports</h1></header>
      <nav class="tabs" aria-label="Reports">${REPORTS.map(([k, l]) => html`<a class="tab" href="#/reports?report=${k}" ${k === key ? html`aria-current="page"` : ''}>${l}</a>`)}</nav>
      ${periodControlsHtml(p)}
      <p class="muted period-note">${info[2]}</p>
      <div class="report-actions"><button class="btn btn-primary" data-action="excel">Download Excel</button><button class="btn" data-action="pdf">Download PDF</button></div>
      <div class="figures small">${model.summary.map(([l, v]) => html`<div class="figure"><span class="figure-value">${v}</span><span class="figure-label">${l}</span></div>`)}</div>
      ${model.rows.length ? html`<div class="scroll"><table class="grid keep report"><thead><tr>${model.columns.map((c) => html`<th class="${money(c) ? 'num' : ''}">${c.label}</th>`)}</tr></thead><tbody>
        ${model.rows.map((r) => html`<tr>${model.columns.map((c) => html`<td data-label="${c.label}" class="${money(c) ? 'num' : ''}">${c.key === 'vehicle' && r.vehicle_id ? html`<a class="plate-link" href="#/vehicles/${r.vehicle_id}">${plate(r.vehicle)}</a>` : (c.key === 'date' && r.id ? html`<a href="#/incidents/${r.id}">${cellHtml(c, r[c.key])}</a>` : cellHtml(c, r[c.key]))}</td>`)}</tr>`)}
      </tbody>${model.totals ? html`<tfoot><tr>${model.columns.map((c) => html`<td class="${money(c) ? 'num' : ''} totals">${cellHtml(c, model.totals[c.key])}</td>`)}</tr></tfoot>` : ''}</table></div>`
        : emptyHtml('Nothing to report', 'No records fall in this period. Try a longer period.')}`);
    wirePeriod(main, p, () => draw());
  }
  await draw();
  on(main, {
    excel: () => { downloadExcel(model, `${slug(model.title)}-${p.from}-to-${p.to}`); toast('Excel file downloaded.'); },
    pdf: () => { downloadPdf(model, `${slug(model.title)}-${p.from}-to-${p.to}`); toast('PDF downloaded.'); },
  });
}
