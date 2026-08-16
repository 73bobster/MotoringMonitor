// app.js — UI wiring for LeasedMileage.

let householdId = null;
let vehicles = [];        // [{...vehicle row, latestReading}]
let editingVehicleId = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function showScreen(name) {
  $('#screen-auth').classList.toggle('hidden', name !== 'auth');
  $('#screen-main').classList.toggle('hidden', name !== 'main');
  $('#screen-vehicle').classList.toggle('hidden', name !== 'vehicle');
}

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  $('.app-shell').appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// ---------- Auth screen ----------

let authMode = 'login';       // 'login' | 'register'
let householdMode = 'new';    // 'new' | 'join'

function setAuthMode(mode) {
  authMode = mode;
  $('#tab-login').classList.toggle('active', mode === 'login');
  $('#tab-register').classList.toggle('active', mode === 'register');
  $('#household-picker').classList.toggle('hidden', mode !== 'register');
  $('#auth-submit').textContent = mode === 'login' ? 'Log in' : 'Create account';
}

function setHouseholdMode(mode) {
  householdMode = mode;
  $('#hh-new-tab').classList.toggle('active', mode === 'new');
  $('#hh-join-tab').classList.toggle('active', mode === 'join');
  $('#hh-join-code').classList.toggle('hidden', mode !== 'join');
}

async function handleAuthSubmit() {
  const email = $('#auth-email').value.trim();
  const password = $('#auth-password').value;
  const errorEl = $('#auth-error');
  errorEl.textContent = '';

  if (!email || !password) {
    errorEl.textContent = 'Enter an email and password';
    return;
  }

  try {
    if (authMode === 'login') {
      await Sync.signIn(email, password);
    } else {
      await Sync.signUp(email, password);
      if (householdMode === 'new') {
        await Sync.createHousehold();
      } else {
        const code = $('#hh-join-code').value.trim();
        if (!code) {
          errorEl.textContent = 'Enter a household join code';
          return;
        }
        await Sync.joinHousehold(code);
      }
    }
    await bootMainScreen();
  } catch (err) {
    errorEl.textContent = err.message || 'Something went wrong. Try again.';
  }
}

// ---------- Main screen ----------

async function bootMainScreen() {
  householdId = await Sync.getMyHouseholdId();
  if (!householdId) {
    // Registered but no household row yet (e.g. race after signUp) — create one.
    householdId = await Sync.createHousehold();
  }
  await loadVehicles();
  showScreen('main');
}

async function loadVehicles() {
  const rows = await Sync.fetchVehicles(householdId);
  vehicles = await Promise.all(rows.map(async (v) => {
    const readings = await Sync.fetchReadings(v.id); // oldest first
    const latestReading = readings.length ? readings[readings.length - 1] : null;
    return { ...v, readings, latestReading };
  }));
  renderVehicles();
}

function daysBetween(a, b) {
  return (b - a) / 86400000;
}

const EWMA_ALPHA = 0.2;

function monthsBetween(days) {
  return Math.round((days || 0) / 30.44);
}

// Ported directly from MotoringMonitor so both apps agree on the number.
// `readings` must be oldest-first.
function ewmaPace(readings) {
  if (readings.length < 2) return null;
  let pace = null;
  for (let i = 1; i < readings.length; i++) {
    const days = (new Date(readings[i].date) - new Date(readings[i - 1].date)) / 86400000;
    if (days <= 0) continue;
    const rate = (readings[i].mileage - readings[i - 1].mileage) / days;
    pace = pace === null ? rate : (EWMA_ALPHA * rate + (1 - EWMA_ALPHA) * pace);
  }
  return pace;
}

function calcProgress(vehicle) {
  const readings = vehicle.readings || [];
  const latest = vehicle.latestReading;
  const currentMileage = latest ? latest.mileage : 0;

  let totalDays = 0, daysElapsed = 0, daysRemaining = 0;
  if (vehicle.term_start && vehicle.term_end) {
    const start = new Date(vehicle.term_start), end = new Date(vehicle.term_end), today = new Date();
    totalDays = Math.max(1, Math.round((end - start) / 86400000));
    daysElapsed = Math.min(totalDays, Math.max(0, Math.round((today - start) / 86400000)));
    daysRemaining = Math.max(0, totalDays - daysElapsed);
  }

  const recentPace = ewmaPace(readings);
  const lifetimeRate = daysElapsed > 0 ? currentMileage / daysElapsed : 0;
  const rate = recentPace !== null ? recentPace : lifetimeRate;

  const forecastMiles = currentMileage + rate * daysRemaining;
  const capped = vehicle.capped_miles;
  const variance = capped ? forecastMiles - capped : 0;
  const excessCost = variance > 0 ? variance * (vehicle.cost_per_excess_mile || 0) : 0;

  const milesPct = capped ? Math.min(150, (currentMileage / capped) * 100) : 0;
  const timePct = totalDays > 0 ? Math.min(100, (daysElapsed / totalDays) * 100) : 0;

  const hasCapData = capped != null && vehicle.term_start && vehicle.term_end;

  return { current: currentMileage, milesPct, timePct, forecastMiles, excessCost, hasCapData, variance, totalDays, daysElapsed };
}

function renderVehicles() {
  const list = $('#cars-list');
  list.innerHTML = '';

  if (!vehicles.length) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>Add your first car</h3>
        <p>Track its mileage against the lease cap from right here.</p>
      </div>`;
    return;
  }

  for (const v of vehicles) {
    const p = calcProgress(v);
    const card = document.createElement('div');
    card.className = 'car-card';

    let bars = '';
    let forecast = '';
    if (p.hasCapData) {
      // Matches MotoringMonitor exactly: the miles bar's colour is driven
      // by forecast variance (are you on pace to go over?), not a raw
      // percentage-used threshold. The time bar never changes colour.
      const milesColor = p.variance > 0 ? 'var(--miles-over)' : 'var(--miles-under)';
      bars = `
        <div class="bar-row">
          <div class="bar-row-labels"><span>Miles</span><span>${p.current.toLocaleString()} used</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, p.milesPct)}%;background:${milesColor}"></div></div>
        </div>
        <div class="bar-row">
          <div class="bar-row-labels"><span>Time</span><span>${monthsBetween(p.daysElapsed)} of ${monthsBetween(p.totalDays)} mo</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${p.timePct}%;background:var(--time-bar)"></div></div>
        </div>
        ${p.milesPct > p.timePct + 5 ? '<p class="pace-note">Using miles faster than the term is passing.</p>' : ''}`;
      forecast = `
        <div class="forecast-strip">
          <div class="col"><div class="label">Forecast</div><div class="value">${Math.round(p.forecastMiles).toLocaleString()} mi</div></div>
          <div class="col"><div class="label">Est. excess</div><div class="value">£${Math.round(p.excessCost).toLocaleString()}</div></div>
        </div>`;
    }

    const lastLoggedText = v.latestReading
      ? `${v.latestReading.mileage.toLocaleString()} mi · logged ${formatRelativeDate(v.latestReading.date)}`
      : `${(v.opening_mileage ?? 0).toLocaleString()} mi · no readings yet`;

    card.innerHTML = `
      <div class="car-card-top" data-open-vehicle="${v.id}">
        <div>
          <p class="car-name">${escapeHtml(v.nickname)}</p>
          <p class="car-sub">${lastLoggedText}</p>
        </div>
        <i class="ti ti-car" style="font-size:18px;color:var(--ink-soft)" aria-hidden="true"></i>
      </div>
      ${bars}
      ${forecast}
      <div class="entry-row">
        <input type="number" inputmode="numeric" placeholder="New reading" data-reading-input="${v.id}" />
        <button class="btn btn-primary" data-add-reading="${v.id}">Add</button>
      </div>
      <div class="entry-feedback" data-feedback="${v.id}"></div>
    `;
    list.appendChild(card);
  }

  attachCardListeners();
}

function attachCardListeners() {
  $$('[data-open-vehicle]').forEach((el) => {
    el.addEventListener('click', () => openVehicleScreen(el.dataset.openVehicle));
  });
  $$('[data-add-reading]').forEach((el) => {
    el.addEventListener('click', () => handleAddReading(el.dataset.addReading));
  });
}

async function handleAddReading(vehicleId) {
  const input = $(`[data-reading-input="${vehicleId}"]`);
  const feedback = $(`[data-feedback="${vehicleId}"]`);
  const value = parseFloat(input.value);
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const current = vehicle.latestReading ? vehicle.latestReading.mileage : vehicle.opening_mileage;

  feedback.className = 'entry-feedback';
  feedback.textContent = '';
  input.classList.remove('invalid');

  if (isNaN(value)) {
    input.classList.add('invalid');
    feedback.className = 'entry-feedback error';
    feedback.innerHTML = `<i class="ti ti-x" aria-hidden="true"></i> Enter a mileage`;
    return;
  }

  try {
    const result = await Sync.addReading(householdId, vehicleId, value, current);
    if (!result.ok) {
      input.classList.add('invalid');
      feedback.className = 'entry-feedback error';
      feedback.innerHTML = `<i class="ti ti-x" aria-hidden="true"></i> ${result.message}`;
      return;
    }
    input.value = '';
    feedback.className = 'entry-feedback success';
    feedback.innerHTML = `<i class="ti ti-check" aria-hidden="true"></i> Reading saved`;
    await loadVehicles();
  } catch (err) {
    feedback.className = 'entry-feedback error';
    feedback.innerHTML = `<i class="ti ti-x" aria-hidden="true"></i> Couldn't save — check your connection`;
  }
}

function formatRelativeDate(dateStr) {
  const date = new Date(dateStr);
  const days = Math.floor(daysBetween(date, new Date()));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return '1 week ago';
  if (weeks < 5) return `${weeks} weeks ago`;
  return date.toLocaleDateString();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ---------- Vehicle add/edit screen ----------

function openVehicleScreen(vehicleId) {
  editingVehicleId = vehicleId || null;
  const v = vehicleId ? vehicles.find((x) => x.id === vehicleId) : null;

  $('#vehicle-title').textContent = v ? v.nickname : 'Add car';
  $('#vf-nickname').value = v ? v.nickname || '' : '';
  $('#vf-make').value = v ? v.make || '' : '';
  $('#vf-term-start').value = v ? v.term_start || '' : '';
  $('#vf-term-end').value = v ? v.term_end || '' : '';
  $('#vf-capped-miles').value = v ? v.capped_miles ?? '' : '';
  $('#vf-cost-per-excess').value = v ? v.cost_per_excess_mile ?? '' : '';
  $('#vf-opening-mileage').value = v ? v.opening_mileage ?? '' : '';
  $('#vehicle-form-error').textContent = '';

  showScreen('vehicle');
}

function readVehicleForm() {
  return {
    nickname: $('#vf-nickname').value.trim(),
    make: $('#vf-make').value.trim(),
    term_start: $('#vf-term-start').value || null,
    term_end: $('#vf-term-end').value || null,
    capped_miles: $('#vf-capped-miles').value === '' ? null : parseFloat($('#vf-capped-miles').value),
    cost_per_excess_mile: $('#vf-cost-per-excess').value === '' ? null : parseFloat($('#vf-cost-per-excess').value),
    opening_mileage: $('#vf-opening-mileage').value === '' ? null : parseFloat($('#vf-opening-mileage').value),
  };
}

async function handleSaveVehicle() {
  const errorEl = $('#vehicle-form-error');
  const fields = readVehicleForm();

  if (!fields.nickname) {
    errorEl.textContent = 'Give the car a nickname';
    return;
  }
  if (fields.term_start && fields.term_end && fields.term_start > fields.term_end) {
    errorEl.textContent = 'Term end must be after term start';
    return;
  }

  try {
    if (editingVehicleId) {
      await Sync.updateVehicle(editingVehicleId, fields);
    } else {
      await Sync.addVehicle(householdId, fields);
    }
    await loadVehicles();
    showScreen('main');
  } catch (err) {
    errorEl.textContent = err.message || "Couldn't save the car. Try again.";
  }
}

// ---------- Wire up ----------

window.addEventListener('DOMContentLoaded', async () => {
  $('#tab-login').addEventListener('click', () => setAuthMode('login'));
  $('#tab-register').addEventListener('click', () => setAuthMode('register'));
  $('#hh-new-tab').addEventListener('click', () => setHouseholdMode('new'));
  $('#hh-join-tab').addEventListener('click', () => setHouseholdMode('join'));
  $('#auth-submit').addEventListener('click', handleAuthSubmit);

  $('#add-car-btn').addEventListener('click', () => openVehicleScreen(null));
  $('#vehicle-back').addEventListener('click', () => showScreen('main'));
  $('#vehicle-back-bottom').addEventListener('click', () => showScreen('main'));
  $('#vehicle-save').addEventListener('click', handleSaveVehicle);
  $('#logout-btn').addEventListener('click', async () => {
    await Sync.signOut();
    showScreen('auth');
  });

  window.addEventListener('online', async () => {
    $('#offline-banner').classList.add('hidden');
    const { flushed } = await Sync.flushQueue();
    if (flushed) { toast(`Synced ${flushed} saved offline`); await loadVehicles(); }
  });
  window.addEventListener('offline', () => $('#offline-banner').classList.remove('hidden'));
  if (!navigator.onLine) $('#offline-banner').classList.remove('hidden');

  try {
    const session = await Sync.getSession();
    if (session) {
      await bootMainScreen();
    } else {
      showScreen('auth');
    }
  } catch (err) {
    showScreen('auth');
    $('#auth-error').textContent = err.message || 'Could not connect. Check your setup.';
  }
});
