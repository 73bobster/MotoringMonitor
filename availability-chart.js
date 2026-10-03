// Vehicle availability over a period: how many vehicles were available and unavailable each day, week or month,
// split into vans and HGVs. The calculation is a pure function so it can be tested on its own.
import { html, raw, esc, addDaysISO, parseISO, todayStr } from './ui.js';
import { daysInPeriod } from './insight.js';

// Buses, trailers and plant count with HGVs; everything else (vans, light goods, cars) counts with vans.
export const groupOf = (v) => (['hgv', 'bus', 'trailer', 'plant'].includes(v.category) ? 'hgv' : 'van');

// Was the vehicle out of service on this day? The day it comes back counts as available. A visit that starts and ends
// on the same day counts for that day. An open visit runs to today, then on to its expected return (a SORN runs on).
export function eventCoversDay(e, day, today) {
  if (e.cancelled_at || day < e.from_date) return false;
  if (e.returned_on) return day <= (e.returned_on > e.from_date ? addDaysISO(e.returned_on, -1) : e.from_date);
  if (day <= today) return true;
  if (e.expected_return) return day <= e.expected_return;
  return e.reason === 'off_road';
}

const mondayOf = (day) => addDaysISO(day, -((parseISO(day).getDay() + 6) % 7));
const fmt = (d, o) => parseISO(d).toLocaleDateString('en-GB', o);

export function buildAvailabilitySeries(vehicles, events, p, today = todayStr()) {
  const fleet = vehicles.filter((v) => !v.archived_at);
  const byVehicle = new Map();
  for (const e of events) { if (e.cancelled_at) continue; if (!byVehicle.has(e.vehicle_id)) byVehicle.set(e.vehicle_id, []); byVehicle.get(e.vehicle_id).push(e); }
  const n = Math.min(daysInPeriod(p), 3700);
  const unit = n <= 31 ? 'day' : n <= 140 ? 'week' : 'month';
  const keyOf = (day) => (unit === 'day' ? day : unit === 'week' ? mondayOf(day) : day.slice(0, 7));

  const buckets = []; const index = new Map();
  for (let i = 0; i < n; i++) {
    const day = addDaysISO(p.from, i);
    const c = { availVan: 0, availHgv: 0, unavVan: 0, unavHgv: 0 };
    for (const v of fleet) {
      if (v.date_acquired && v.date_acquired > day) continue;     // not in the fleet yet
      if (v.disposed_date && v.disposed_date <= day) continue;     // already gone
      const out = (byVehicle.get(v.id) || []).some((e) => eventCoversDay(e, day, today));
      c[`${out ? 'unav' : 'avail'}${groupOf(v) === 'hgv' ? 'Hgv' : 'Van'}`] += 1;
    }
    const key = keyOf(day);
    if (!index.has(key)) {
      index.set(key, buckets.length);
      buckets.push({ key, first: day, days: 0, availVan: 0, availHgv: 0, unavVan: 0, unavHgv: 0 });
    }
    const b = buckets[index.get(key)];
    b.days += 1; for (const k of ['availVan', 'availHgv', 'unavVan', 'unavHgv']) b[k] += c[k];
  }
  const sums = { availVan: 0, availHgv: 0, unavVan: 0, unavHgv: 0 };
  for (const b of buckets) {
    for (const k of Object.keys(sums)) { sums[k] += b[k]; b[k] /= b.days; }   // weeks and months show the daily average
    b.avail = b.availVan + b.availHgv; b.unav = b.unavVan + b.unavHgv; b.total = b.avail + b.unav;
    b.label = unit === 'day' ? fmt(b.first, { day: 'numeric', month: 'short' }) : unit === 'week' ? fmt(b.key, { day: 'numeric', month: 'short' }) : fmt(`${b.key}-01`, { month: 'short', year: '2-digit' });
    b.title = unit === 'day' ? fmt(b.first, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      : unit === 'week' ? `Week of ${fmt(b.key, { weekday: 'short', day: 'numeric', month: 'short' })}${b.days < 7 ? ` (${b.days} days in the period)` : ''}`
        : `${fmt(`${b.key}-01`, { month: 'long', year: 'numeric' })}${b.days < 28 ? ` (${b.days} days in the period)` : ''}`;
  }
  const pct = (a, u) => (a + u ? Math.round((a / (a + u)) * 1000) / 10 : null);
  return {
    unit, buckets,
    totals: {
      vehicleDays: sums.availVan + sums.availHgv + sums.unavVan + sums.unavHgv,
      unavailableDays: sums.unavVan + sums.unavHgv,
      pct: pct(sums.availVan + sums.availHgv, sums.unavVan + sums.unavHgv),
      pctVan: pct(sums.availVan, sums.unavVan), pctHgv: pct(sums.availHgv, sums.unavHgv),
    },
  };
}

const num = (x, unit) => (unit === 'day' ? String(Math.round(x)) : String(Math.round(x * 10) / 10));
export function detailText(series, i) {
  const b = series.buckets[i]; const u = series.unit;
  return `${b.title}: ${u === 'day' ? '' : 'on average '}${num(b.avail, u)} available (${num(b.availVan, u)} vans, ${num(b.availHgv, u)} HGV) and ${num(b.unav, u)} unavailable (${num(b.unavVan, u)} vans, ${num(b.unavHgv, u)} HGV).`;
}

// The stacked bars as an SVG sized to its container. Unavailable is at the bottom of each bar so it is easy to compare.
// Bottom to top: HGV unavailable, vans unavailable, HGV available, vans available. HGV segments are also hatched.
export function chartSvg(series, width = 640) {
  const n = series.buckets.length; const h = width < 480 ? 220 : 260;
  const m = { l: 30, r: 6, t: 8, b: 26 }; const pw = Math.max(40, width - m.l - m.r); const ph = h - m.t - m.b;
  const max = Math.max(1, Math.ceil(Math.max(...series.buckets.map((b) => b.total))));
  const slot = pw / n; const bw = Math.max(2, Math.min(slot * 0.72, 44));
  const y = (v) => m.t + ph - (v / max) * ph;
  const ticks = [...new Set([0, Math.round(max / 2), max])];
  const step = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(pw / 62))));
  let out = `<svg viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="group" aria-label="Vehicles available and unavailable by ${series.unit}">`;
  out += '<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="5" fill="#fff" fill-opacity=".55"/></pattern></defs>';
  for (const t of ticks) out += `<line class="grid-line" x1="${m.l}" x2="${width - m.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="axis-text" x="${m.l - 5}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${t}</text>`;
  series.buckets.forEach((b, i) => {
    const x0 = m.l + i * slot; const x = x0 + (slot - bw) / 2;
    out += `<g class="bar" data-i="${i}" tabindex="0" role="button" aria-label="${esc(detailText(series, i))}"><rect class="hit" x="${x0.toFixed(1)}" y="${m.t}" width="${slot.toFixed(1)}" height="${ph}"/>`;
    let acc = 0;
    for (const [k, cls, hgv] of [['unavHgv', 'seg-un-hgv', true], ['unavVan', 'seg-un-van', false], ['availHgv', 'seg-av-hgv', true], ['availVan', 'seg-av-van', false]]) {
      const v = b[k]; if (v <= 0) continue;
      const top = y(acc + v); const hh = y(acc) - top;
      out += `<rect class="${cls}" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, hh).toFixed(1)}"/>`;
      if (hgv) out += `<rect class="hatch" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, hh).toFixed(1)}" fill="url(#hatch)"/>`;
      acc += v;
    }
    out += '</g>';
    if (i % step === 0) out += `<text class="axis-text" x="${(x0 + slot / 2).toFixed(1)}" y="${h - 8}" text-anchor="middle">${esc(b.label)}</text>`;
  });
  return `${out}</svg>`;
}

export const chartLegendHtml = () => html`<div class="chart-legend"><span><i class="swatch sw-un-van"></i>Vans unavailable</span><span><i class="swatch sw-un-hgv"></i>HGV unavailable</span><span><i class="swatch sw-av-van"></i>Vans available</span><span><i class="swatch sw-av-hgv"></i>HGV available</span></div>`;

export function numbersTableHtml(series) {
  const u = series.unit;
  return html`<div class="scroll"><table class="grid keep compact"><thead><tr><th>${u === 'day' ? 'Day' : u === 'week' ? 'Week' : 'Month'}</th><th class="num">Vans available</th><th class="num">HGV available</th><th class="num">Vans unavailable</th><th class="num">HGV unavailable</th><th class="num">% available</th></tr></thead><tbody>
    ${series.buckets.map((b) => html`<tr><td data-label="Period">${b.title}</td><td class="num">${num(b.availVan, u)}</td><td class="num">${num(b.availHgv, u)}</td><td class="num">${num(b.unavVan, u)}</td><td class="num">${num(b.unavHgv, u)}</td><td class="num">${b.total ? `${Math.round((b.avail / b.total) * 100)}%` : ''}</td></tr>`)}
  </tbody></table></div>`;
}
export { raw };
