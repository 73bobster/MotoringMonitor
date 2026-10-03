// Management dashboard: fleet status and what needs attention now, and what happened in the chosen period.
import * as api from './api.js';
import { can } from './state.js';
import { html, mount, plate, pill, loadingHtml, fmtDateShort, fmtMoney, fmtInt, dueText, todayStr, addDaysISO, plural } from './ui.js';
import { UNAVAIL_REASON_LABEL, availability, taskCategory, incidentTitle, incidentCost, driverName } from './domain.js';
import { loadPeriod, periodControlsHtml, wirePeriod, periodLabel, inPeriod, milesFromRows, eventDaysInPeriod, eventTouchesPeriod } from './insight.js';
import { buildAvailabilitySeries, chartSvg, chartLegendHtml, numbersTableHtml, detailText } from './availability-chart.js';

const sum = (list, f) => list.reduce((s, x) => s + Number(f(x) || 0), 0);
const link = (href, content, cls = '') => html`<a class="${cls}" href="${href}">${content}</a>`;
const DRIVERS_SHOWN = 10;

export async function dashboardView(main) {
  mount(main, html`<header class="page-head"><h1>Dashboard</h1></header>${loadingHtml('Loading the dashboard')}`);
  const p = loadPeriod();
  // everything in one round trip: the period's costs and mileage are fetched alongside the rest
  const fetchPeriod = (per) => Promise.all([api.listCostsBetween(per), api.milesInPeriod(per)]);
  const [tasks, vehicles, drivers, incidents, events, garages, convictions, first] = await Promise.all([
    api.listTasks(), api.listVehicles(), api.listDrivers(), api.listIncidents(), api.listUnavailability(), api.listGarages(),
    can.sensitive ? api.listConvictions() : [], fetchPeriod(p),
  ]);
  let [costs, mileRowsRaw] = first;
  const today = todayStr();
  const vById = new Map(vehicles.map((v) => [v.id, v]));
  const gById = new Map(garages.map((g) => [g.id, g]));
  const live = vehicles.filter((v) => v.status !== 'disposed' && !v.archived_at);
  const liveEvents = events.filter((e) => !e.cancelled_at);
  let showAllDrivers = false;
  let changing = 0;
  let observer = null; let drawnWidth = 0; let selectedBar = null;

  // The stacked bars are drawn to fit their container, and redrawn if it changes size (a phone turned sideways, say).
  function drawChart(series) {
    const box = main.querySelector('#avail-chart'); const detail = main.querySelector('#avail-detail');
    if (!box) return;
    const paint = () => {
      drawnWidth = Math.round(box.clientWidth) || 640;
      box.innerHTML = chartSvg(series, drawnWidth);
      if (selectedBar !== null) box.querySelector(`.bar[data-i="${selectedBar}"]`)?.classList.add('selected');
    };
    const show = (g) => {
      if (!g) return;
      box.querySelectorAll('.bar.selected').forEach((x) => x.classList.remove('selected'));
      g.classList.add('selected'); selectedBar = Number(g.dataset.i);
      detail.textContent = detailText(series, selectedBar);
    };
    selectedBar = null; paint();
    box.onclick = (e) => show(e.target.closest('.bar'));
    box.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(e.target.closest('.bar')); } };
    observer?.disconnect();
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(() => { const w = Math.round(box.clientWidth); if (w && Math.abs(w - drawnWidth) > 16) paint(); });
      observer.observe(box);
    }
  }

  function render() {
    // ---- as of today ----
    const open = tasks.filter((t) => t.status !== 'snoozed' && t.status !== 'dismissed');
    const overdue = open.filter((t) => t.status === 'overdue');
    const dueSoon = open.filter((t) => t.status === 'due_soon');
    const states = live.map((v) => ({ v, a: availability(v) }));
    const count = (k) => states.filter((s) => s.a.key === k).length;
    const atGarage = states.filter((s) => s.a.key === 'garage');
    const offRoad = states.filter((s) => s.a.key === 'sorn' || s.a.key === 'off_road_no_sorn');
    const available = states.filter((s) => s.a.key === 'available' || s.a.key === 'booked').length;
    const booked = live.filter((v) => v.next_booking_date && v.next_booking_date <= addDaysISO(today, 14));
    const unavailableNow = atGarage.length + offRoad.length;
    const noCover = live.filter((v) => v.status === 'active' && !v.insured_until && availability(v).key !== 'sorn');
    const attention = [...overdue.sort((a, b) => a.days_remaining - b.days_remaining), ...dueSoon.sort((a, b) => a.days_remaining - b.days_remaining)].slice(0, 8);

    // ---- the period ----
    const inc = incidents.filter((i) => inPeriod(i.incident_date, p));
    const accidents = inc.filter((i) => i.kind === 'accident');
    const damage = inc.filter((i) => i.kind === 'damage');
    const fines = inc.filter((i) => i.kind === 'fine');
    const repair = sum(inc, (i) => i.repair_cost); const third = sum(inc, (i) => i.third_party_cost); const excess = sum(inc, (i) => i.excess_paid);
    const insurerPaid = sum(inc, (i) => i.insurer_paid); const fineTotal = sum(fines, (i) => i.fine_amount);
    const incidentSpend = repair + third + fineTotal;
    const running = sum(costs, (c) => c.amount);
    const miles = milesFromRows(mileRowsRaw);
    const mileRows = [...miles.entries()].filter(([id]) => vById.get(id) && !vById.get(id).archived_at).map(([id, m]) => ({ id, ...m })).filter((m) => m.miles > 0);
    const totalMiles = sum(mileRows, (m) => m.miles);
    const touched = liveEvents.filter((e) => eventTouchesPeriod(e, p, today));
    const lostDays = sum(touched, (e) => eventDaysInPeriod(e, p, today));
    const garageVisits = touched.filter((e) => e.reason !== 'off_road');

    // ---- drivers: points, then accidents and damage together ----
    const rows = drivers.filter((d) => d.employment_status === 'active').map((d) => {
      const cs = convictions.filter((c) => c.driver_id === d.id && c.status === 'live' && c.points > 0);
      const a = accidents.filter((i) => i.driver_id === d.id).length; const dm = damage.filter((i) => i.driver_id === d.id).length;
      return { d, points: sum(cs.filter((c) => c.licence_until >= today), (c) => c.points), totting: sum(cs.filter((c) => c.totting_until >= today), (c) => c.points), accidents: a, damage: dm, combined: a + dm };
    }).sort((x, y) => (can.sensitive ? y.points - x.points : 0) || y.combined - x.combined || driverName(x.d).localeCompare(driverName(y.d)));
    const shown = showAllDrivers ? rows : rows.slice(0, DRIVERS_SHOWN);
    const series = buildAvailabilitySeries(vehicles, liveEvents, p, today);
    const t = series.totals;

    const fig = (label, value, sub, href, tone = '') => html`<a class="figure ${tone}" href="${href}"><span class="figure-value">${value}</span><span class="figure-label">${label}</span>${sub ? html`<span class="figure-sub">${sub}</span>` : ''}</a>`;

    mount(main, html`
      <header class="page-head"><h1>Dashboard</h1></header>
      ${periodControlsHtml(p)}
      <p class="muted period-note">Showing <strong>${periodLabel(p)}</strong>. Fleet status and tasks are as of today. Accidents, damage, costs and downtime cover the period.</p>

      <div class="figures">
        ${fig('Overdue tasks', overdue.length, overdue.length ? plural(overdue.filter((t) => t.is_statutory).length, 'statutory task') : 'Nothing overdue', '#/tasks?status=overdue', overdue.length ? 'tone-bad' : 'tone-good')}
        ${fig('Due soon', dueSoon.length, 'Inside the warning window', '#/tasks?status=due_soon', dueSoon.length ? 'tone-warn' : '')}
        ${fig('Available vehicles', `${available} of ${live.length}`, unavailableNow ? `${unavailableNow} out of service` : 'None out of service', '#/vehicles', unavailableNow ? 'tone-warn' : 'tone-good')}
        ${fig('Accidents and damage', accidents.length + damage.length, `${plural(accidents.length, 'accident')}, ${damage.length} damage`, '#/reports?report=damage')}
        ${fig('Cost in the period', fmtMoney(running + incidentSpend), `${fmtMoney(running)} running, ${fmtMoney(incidentSpend)} incidents`, '#/reports?report=damage')}
        ${fig('Miles in the period', fmtInt(totalMiles), mileRows.length ? `${fmtInt(Math.round(totalMiles / mileRows.length))} per vehicle` : 'No readings', '#/reports?report=mileage')}
      </div>

      <div class="dash-grid">
        <section class="dash-panel"><h2>Fleet status</h2>
          <table class="mini"><tbody>
            <tr><th>Available</th><td class="num">${available}</td></tr>
            <tr><th>At a garage</th><td class="num">${atGarage.length}</td></tr>
            <tr><th>Off the road (SORN)</th><td class="num">${count('sorn')}</td></tr>
            ${count('off_road_no_sorn') ? html`<tr class="bad"><th>Off the road, no SORN recorded</th><td class="num">${count('off_road_no_sorn')}</td></tr>` : ''}
            <tr><th>Booked in, next 14 days</th><td class="num">${booked.length}</td></tr>
            ${noCover.length ? html`<tr class="bad"><th>No insurance cover</th><td class="num">${noCover.length}</td></tr>` : ''}
          </tbody></table>
          ${atGarage.length + offRoad.length ? html`<h3>Out of service now</h3><ul class="plain">${[...atGarage, ...offRoad].map(({ v }) => {
            const late = v.unavailable_expected_return && v.unavailable_expected_return < today;
            return html`<li>${link(`#/vehicles/${v.id}?tab=availability`, plate(v.registration), 'plate-link')} <span class="muted">${UNAVAIL_REASON_LABEL[v.unavailable_reason]}${v.unavailable_reason === 'off_road' ? '' : ` at ${gById.get(v.unavailable_garage_id)?.name || 'a garage'}`}, since ${fmtDateShort(v.unavailable_since)}</span>
              ${v.unavailable_expected_return ? html`<span class="${late ? 'c-overdue' : 'muted'}"> ${late ? html`<strong>Back was due</strong>` : 'Back'} ${fmtDateShort(v.unavailable_expected_return)}</span>` : ''}</li>`;
          })}</ul>` : ''}
          ${booked.length ? html`<h3>Booked in</h3><ul class="plain">${booked.map((v) => html`<li>${link(`#/vehicles/${v.id}?tab=availability`, plate(v.registration), 'plate-link')} <span class="muted">${fmtDateShort(v.next_booking_date)}</span></li>`)}</ul>` : ''}
        </section>
        <section class="dash-panel"><h2>Needs attention</h2>
          ${attention.length ? html`<ul class="attn">${attention.map((t) => html`<li><a href="#/tasks?category=${taskCategory(t)}&status=${t.status}">
            <span class="attn-what">${t.vehicle_id && t.applies_to === 'vehicle' ? plate(vById.get(t.vehicle_id)?.registration || t.target_label.split(' - ')[0]) : html`<strong>${t.target_label}</strong>`}</span>
            <span class="attn-name">${t.type_name}</span><span class="attn-due">${pill(t.status)} <span class="muted">${dueText(t.days_remaining)}</span></span></a></li>`)}</ul>
            <p><a href="#/tasks">See all ${open.length} open tasks</a></p>` : html`<p class="muted">Nothing is overdue or due soon.</p>`}
        </section>
      </div>

      <section class="dash-panel wide avail-panel"><h2>Vehicle availability</h2>
        <p class="muted drivers-note">Vehicles available and unavailable, by ${series.unit}${series.unit === 'day' ? '' : ' (daily averages)'}. Unavailable is at the bottom of each bar, so you can see how much of the fleet was out of action. Vans and HGVs are different colours.</p>
        ${chartLegendHtml()}
        <div class="avail-chart" id="avail-chart"></div>
        <p class="chart-detail" id="avail-detail" aria-live="polite">Tap or click a bar for the numbers.</p>
        ${t.vehicleDays ? html`<p class="chart-summary"><strong>${t.pct}%</strong> of vehicle-days were available${t.pctVan != null && t.pctHgv != null ? html` (vans ${t.pctVan}%, HGVs ${t.pctHgv}%)` : ''}. <strong>${fmtInt(Math.round(t.unavailableDays))}</strong> vehicle-days out of service.</p>` : html`<p class="muted">There are no vehicles to show for this period.</p>`}
        <details class="chart-numbers"><summary>Show the numbers</summary>${numbersTableHtml(series)}</details>
      </section>

      <div class="dash-grid">
        <section class="dash-panel"><h2>Accidents, damage and fines</h2>
          <table class="mini"><tbody>
            <tr><th>Accidents</th><td class="num">${accidents.length}</td></tr><tr><th>Other damage</th><td class="num">${damage.length}</td></tr><tr><th>Fines</th><td class="num">${fines.length}</td></tr>
            <tr><th>Repair costs</th><td class="num">${fmtMoney(repair)}</td></tr><tr><th>Excess paid</th><td class="num">${fmtMoney(excess)}</td></tr>
            <tr><th>Paid by insurers</th><td class="num">${fmtMoney(insurerPaid)}</td></tr><tr><th>Cost to other parties</th><td class="num">${fmtMoney(third)}</td></tr>
            <tr><th>Fines</th><td class="num">${fmtMoney(fineTotal)}</td></tr>
            <tr class="total"><th>Cost to the company, before insurers</th><td class="num">${fmtMoney(incidentSpend)}</td></tr>
          </tbody></table>
          ${inc.length ? html`<h3>Most recent</h3><ul class="plain">${inc.slice(0, 5).map((i) => html`<li>${link(`#/incidents/${i.id}`, `${fmtDateShort(i.incident_date)} ${incidentTitle(i)}`)} ${i.vehicle_id && vById.get(i.vehicle_id) ? plate(vById.get(i.vehicle_id).registration) : ''} <span class="muted">${incidentCost(i) ? fmtMoney(incidentCost(i)) : ''}</span></li>`)}</ul>` : html`<p class="muted">Nothing recorded in this period.</p>`}
          <p><a href="#/reports?report=damage">Vehicle damage report</a> · <a href="#/reports?report=accidents">Accidents report</a></p>
        </section>
        <section class="dash-panel"><h2>Downtime and garages</h2>
          <table class="mini"><tbody><tr><th>Garage visits</th><td class="num">${garageVisits.length}</td></tr><tr><th>Vehicle-days out of service</th><td class="num">${lostDays}</td></tr>
            <tr><th>Vehicles affected</th><td class="num">${new Set(touched.map((e) => e.vehicle_id)).size}</td></tr></tbody></table>
          ${garageVisits.length ? html`<h3>Visits</h3><ul class="plain">${garageVisits.slice(0, 5).map((e) => html`<li>${vById.get(e.vehicle_id) ? plate(vById.get(e.vehicle_id).registration) : ''} <span class="muted">${UNAVAIL_REASON_LABEL[e.reason]} at ${gById.get(e.garage_id)?.name || 'a garage'}, ${fmtDateShort(e.from_date)}</span></li>`)}</ul>` : ''}
          <p><a href="#/reports?report=status">Vehicle status report</a> · <a href="#/garages">Garages</a></p>
        </section>
      </div>

      <section class="dash-panel wide"><h2>Drivers</h2>
        <p class="muted drivers-note">${can.sensitive ? 'Points are on the licence now. ' : ''}Accidents and damage are for the period. Sorted by ${can.sensitive ? 'points, then ' : ''}accidents and damage together.</p>
        ${rows.length ? html`<table class="grid keep compact drivers-summary"><thead><tr><th>Driver</th>${can.sensitive ? html`<th class="num">Points</th>` : ''}<th class="num">Accidents</th><th class="num">Damage</th><th class="num">Total</th></tr></thead><tbody>
          ${shown.map((r) => html`<tr>
            <td data-label="Driver">${link(`#/drivers/${r.d.id}`, driverName(r.d))}</td>
            ${can.sensitive ? html`<td data-label="Points" class="num ${r.totting >= 12 ? 'n-overdue' : r.totting >= 9 ? 'n-due_soon' : ''}">${r.points ? html`<strong>${r.points}</strong>` : html`<span class="muted">0</span>`}${r.totting >= 6 ? html`<div class="sub">${r.totting} totting up</div>` : ''}</td>` : ''}
            <td data-label="Accidents" class="num">${r.accidents || html`<span class="muted">0</span>`}</td>
            <td data-label="Damage" class="num">${r.damage || html`<span class="muted">0</span>`}</td>
            <td data-label="Total" class="num">${r.combined ? html`<strong>${r.combined}</strong>` : html`<span class="muted">0</span>`}</td></tr>`)}
        </tbody></table>
        ${rows.length > DRIVERS_SHOWN ? html`<p><button type="button" class="btn btn-sm" data-show-drivers>${showAllDrivers ? 'Show fewer drivers' : `Show all ${rows.length} drivers`}</button></p>` : ''}` : html`<p class="muted">There are no active drivers.</p>`}
      </section>`);
    wirePeriod(main, p, onPeriod);
    drawChart(series);
    main.querySelector('[data-show-drivers]')?.addEventListener('click', () => { showAllDrivers = !showAllDrivers; render(); });
  }

  // costs and mileage depend on the period, so they are fetched again when it changes
  async function onPeriod() {
    const mine = ++changing;
    const next = await fetchPeriod(p);
    if (mine !== changing) return; // the period was changed again meanwhile
    [costs, mileRowsRaw] = next;
    render();
  }
  render();
}
