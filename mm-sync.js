// ─────────────────────────────────────────────────────────────────
// sync.js — MotoringMonitor data layer.
//
// Same job as the standalone tracker's sync.js, scaled up for a
// shared household: talk to Supabase, cache locally for offline use,
// queue writes made offline. The one new concept is "household" —
// almost everything is scoped to household_id rather than user_id
// directly, because multiple logins share the same data.
//
// Conflict rule stays last-write-wins, same reasoning as before.
// ─────────────────────────────────────────────────────────────────

const CACHE_KEY = 'mm-cache';
const QUEUE_KEY = 'mm-pending-queue';

let supabaseClient = null;
let currentUser = null;
let householdId = null;
let myRole = null; // 'owner' | 'member'

function readCache(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch (e) { console.error('cache read failed', key, e); return fallback; }
}
function writeCache(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.error('cache write failed', key, e); } }
function readQueue() { return readCache(QUEUE_KEY, []); }
function writeQueue(q) { writeCache(QUEUE_KEY, q); }

function getCache() { return readCache(CACHE_KEY, { people: [], vehicles: [], readings: [], runningCosts: [], drivingRecords: [], namedDrivers: [], insurancePolicies: [] }); }
function setCache(c) { writeCache(CACHE_KEY, c); }

// ── Init & auth ──────────────────────────────────────────────────
function init(url, anonKey) {
  supabaseClient = window.supabase.createClient(url, anonKey);
  window.addEventListener('online', flushQueue);
  return supabaseClient;
}

function onAuthChange(callback) {
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session ? session.user : null;
    if (currentUser) await bootstrapHousehold();
    callback(currentUser);
  });
  supabaseClient.auth.getSession().then(async ({ data }) => {
    currentUser = data.session ? data.session.user : null;
    if (currentUser) await bootstrapHousehold();
    callback(currentUser);
  });
}

async function signUp(email, password) { return supabaseClient.auth.signUp({ email, password }); }
async function signIn(email, password) { return supabaseClient.auth.signInWithPassword({ email, password }); }
async function signOut() { await supabaseClient.auth.signOut(); currentUser = null; householdId = null; myRole = null; }

// Every user gets their own household automatically. This RPC is
// idempotent — safe to call every sign-in, it's a no-op if one
// already exists.
async function bootstrapHousehold() {
  if (!navigator.onLine) {
    const cached = readCache('mm-household-id', null);
    if (cached) { householdId = cached; myRole = readCache('mm-role', 'owner'); }
    return;
  }
  const { data, error } = await supabaseClient.rpc('create_my_household');
  if (error) { console.error('household bootstrap failed', error); return; }
  householdId = data;
  writeCache('mm-household-id', householdId);
  const { data: memberRow } = await supabaseClient
    .from('household_members').select('role').eq('household_id', householdId).eq('user_id', currentUser.id).single();
  myRole = memberRow ? memberRow.role : 'owner';
  writeCache('mm-role', myRole);
}

async function joinHousehold(code) {
  const { data, error } = await supabaseClient.rpc('join_household', { code });
  if (error) throw error;
  await bootstrapHousehold();
  return data;
}

function getMyRole() { return myRole; }
function getCurrentUserEmail() { return currentUser ? currentUser.email : ''; }
function getJoinCode() { return readCache('mm-join-code', null); }

async function refreshJoinCode() {
  if (!householdId) return null;
  const { data } = await supabaseClient.from('households').select('join_code').eq('id', householdId).single();
  if (data) writeCache('mm-join-code', data.join_code);
  return data ? data.join_code : null;
}

// ── Pull everything from the cloud ──────────────────────────────
async function refreshFromCloud() {
  if (!householdId || !navigator.onLine) return getCache();
  const [people, vehicles, readings, runningCosts, drivingRecords, namedDrivers, insurancePolicies] = await Promise.all([
    supabaseClient.from('people').select('*').eq('household_id', householdId).eq('archived', false),
    supabaseClient.from('vehicles').select('*').eq('household_id', householdId).eq('archived', false),
    supabaseClient.from('readings').select('*').eq('household_id', householdId),
    supabaseClient.from('running_costs').select('*').eq('household_id', householdId),
    supabaseClient.from('driving_records').select('*').eq('household_id', householdId),
    supabaseClient.from('vehicle_named_drivers').select('*'),
    supabaseClient.from('insurance_policies').select('*').eq('household_id', householdId),
  ]);
  const cache = {
    people: people.data || [], vehicles: vehicles.data || [],
    readings: readings.data || [], runningCosts: runningCosts.data || [],
    drivingRecords: drivingRecords.data || [], namedDrivers: namedDrivers.data || [],
    insurancePolicies: insurancePolicies.data || [],
  };
  setCache(cache);
  await refreshJoinCode();
  return cache;
}

// ── Write queue (same pattern as the standalone tracker) ────────
function enqueue(op) { const q = readQueue(); q.push(op); writeQueue(q); }

let flushing = false;
async function flushQueue() {
  if (flushing || !navigator.onLine || !currentUser || !supabaseClient) return;
  flushing = true;
  try {
    let q = readQueue();
    const remaining = [];
    for (const op of q) {
      try {
        if (op.type === 'upsert') {
          const { error } = await supabaseClient.from(op.table).upsert(op.payload);
          if (error) throw error;
        } else if (op.type === 'delete') {
          const { error } = await supabaseClient.from(op.table).delete().eq('id', op.id);
          if (error) throw error;
        }
      } catch (e) {
        console.warn('queued op failed, will retry later', op, e);
        remaining.push(op);
      }
    }
    writeQueue(remaining);
    if (remaining.length === 0) await refreshFromCloud();
  } finally { flushing = false; }
}
function pendingCount() { return readQueue().length; }

// ── People ────────────────────────────────────────────────────────
async function addPerson(fields) {
  const cache = getCache();
  const person = { id: crypto.randomUUID(), household_id: householdId, archived: false, ...fields };
  cache.people.push(person); setCache(cache);
  enqueue({ type: 'upsert', table: 'people', payload: person });
  await flushQueue();
  return person;
}
async function savePerson(fields) {
  // generic upsert — pass an existing id to edit, omit it to create
  const cache = getCache();
  const existing = fields.id ? cache.people.find(p => p.id === fields.id) : null;
  const person = { id: crypto.randomUUID(), household_id: householdId, archived: false, ...(existing||{}), ...fields };
  const idx = cache.people.findIndex(p => p.id === person.id);
  if (idx >= 0) cache.people[idx] = person; else cache.people.push(person);
  setCache(cache);
  enqueue({ type: 'upsert', table: 'people', payload: person });
  await flushQueue();
  return person;
}
async function archivePerson(id) {
  const cache = getCache();
  const p = cache.people.find(x => x.id === id);
  if (p) { p.archived = true; setCache(cache); }
  enqueue({ type: 'upsert', table: 'people', payload: { ...p } });
  await flushQueue();
}

// ── Vehicles ──────────────────────────────────────────────────────
async function saveVehicle(fields) {
  const cache = getCache();
  const existing = fields.id ? cache.vehicles.find(v => v.id === fields.id) : null;
  const vehicle = { id: crypto.randomUUID(), household_id: householdId, archived: false, ...(existing || {}), ...fields, updated_at: new Date().toISOString() };
  const idx = cache.vehicles.findIndex(v => v.id === vehicle.id);
  if (idx >= 0) cache.vehicles[idx] = vehicle; else cache.vehicles.push(vehicle);
  setCache(cache);
  enqueue({ type: 'upsert', table: 'vehicles', payload: vehicle });
  await flushQueue();
  return vehicle;
}
async function archiveVehicle(id) {
  const cache = getCache();
  const v = cache.vehicles.find(x => x.id === id);
  if (v) { v.archived = true; setCache(cache); }
  enqueue({ type: 'upsert', table: 'vehicles', payload: { ...v } });
  await flushQueue();
}
async function setNamedDrivers(vehicleId, personIds) {
  // simplest correct approach: delete-then-reinsert this vehicle's rows
  const cache = getCache();
  cache.namedDrivers = cache.namedDrivers.filter(nd => nd.vehicle_id !== vehicleId);
  personIds.forEach(pid => cache.namedDrivers.push({ vehicle_id: vehicleId, person_id: pid }));
  setCache(cache);
  if (navigator.onLine) {
    await supabaseClient.from('vehicle_named_drivers').delete().eq('vehicle_id', vehicleId);
    if (personIds.length) await supabaseClient.from('vehicle_named_drivers').insert(personIds.map(pid => ({ vehicle_id: vehicleId, person_id: pid })));
  }
}

// ── Readings ──────────────────────────────────────────────────────
async function addReading(vehicleId, date, mileage) {
  const cache = getCache();
  const reading = { id: crypto.randomUUID(), household_id: householdId, vehicle_id: vehicleId, date, mileage, created_at: new Date().toISOString() };
  cache.readings.push(reading); setCache(cache);
  enqueue({ type: 'upsert', table: 'readings', payload: reading });
  await flushQueue();
  return reading;
}
async function deleteReading(id) {
  if (myRole !== 'owner') throw new Error('Only the household owner can delete readings');
  const cache = getCache();
  cache.readings = cache.readings.filter(r => r.id !== id); setCache(cache);
  enqueue({ type: 'delete', table: 'readings', id });
  await flushQueue();
}

// ── Running costs ─────────────────────────────────────────────────
async function addRunningCost(vehicleId, fields) {
  const cache = getCache();
  const cost = { id: crypto.randomUUID(), household_id: householdId, vehicle_id: vehicleId, created_at: new Date().toISOString(), ...fields };
  cache.runningCosts.push(cost); setCache(cache);
  enqueue({ type: 'upsert', table: 'running_costs', payload: cost });
  await flushQueue();
  return cost;
}

// ── Insurance policies (multiple over time, per vehicle) ─────────
async function saveInsurancePolicy(fields) {
  const cache = getCache();
  cache.insurancePolicies = cache.insurancePolicies || [];
  const existing = fields.id ? cache.insurancePolicies.find(p => p.id === fields.id) : null;
  const policy = { id: crypto.randomUUID(), household_id: householdId, is_current: true, ...(existing||{}), ...fields };
  const idx = cache.insurancePolicies.findIndex(p => p.id === policy.id);
  if (idx >= 0) cache.insurancePolicies[idx] = policy; else cache.insurancePolicies.push(policy);
  setCache(cache);
  enqueue({ type: 'upsert', table: 'insurance_policies', payload: policy });
  await flushQueue();
  return policy;
}
async function deleteInsurancePolicy(id) {
  if (myRole !== 'owner') throw new Error('Only the household owner can delete');
  const cache = getCache();
  cache.insurancePolicies = (cache.insurancePolicies||[]).filter(p => p.id !== id);
  setCache(cache);
  enqueue({ type: 'delete', table: 'insurance_policies', id });
  await flushQueue();
}

// ── Driving records (offences / accidents) ──────────────────────
async function addDrivingRecord(personId, fields) {
  const cache = getCache();
  const rec = { id: crypto.randomUUID(), household_id: householdId, person_id: personId, created_at: new Date().toISOString(), ...fields };
  cache.drivingRecords.push(rec); setCache(cache);
  enqueue({ type: 'upsert', table: 'driving_records', payload: rec });
  await flushQueue();
  return rec;
}
async function saveDrivingRecord(fields) {
  // generic upsert — pass an existing id to edit
  const cache = getCache();
  const existing = fields.id ? cache.drivingRecords.find(r => r.id === fields.id) : null;
  const rec = { id: crypto.randomUUID(), household_id: householdId, created_at: new Date().toISOString(), ...(existing||{}), ...fields };
  const idx = cache.drivingRecords.findIndex(r => r.id === rec.id);
  if (idx >= 0) cache.drivingRecords[idx] = rec; else cache.drivingRecords.push(rec);
  setCache(cache);
  enqueue({ type: 'upsert', table: 'driving_records', payload: rec });
  await flushQueue();
  return rec;
}
async function deleteDrivingRecord(id) {
  if (myRole !== 'owner') throw new Error('Only the household owner can delete records');
  const cache = getCache();
  cache.drivingRecords = cache.drivingRecords.filter(r => r.id !== id); setCache(cache);
  enqueue({ type: 'delete', table: 'driving_records', id });
  await flushQueue();
}

// ── Data export (CSV, no backend needed) ─────────────────────────
function toCSV(rows, columns) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = columns.join(',');
  const lines = rows.map(r => columns.map(c => esc(typeof c === 'function' ? c(r) : r[c])).join(','));
  return [header, ...lines].join('\r\n');
}
function exportCSV() {
  const cache = getCache();
  const vehicleRef = id => { const v = cache.vehicles.find(x => x.id === id); return v ? (v.registration || v.nickname) : id; };
  const personRef = id => { const p = cache.people.find(x => x.id === id); return p ? p.nickname : id; };

  const vColumns = ['registration','nickname','make','model','variant','fuel_type','engine_capacity','year_of_manufacture','mpg',
    'ownership_type','company_car','date_acquired','upfront_cost','monthly_repayment','term_start','term_end',
    'capped_miles','cost_per_excess_mile','purchase_price','purchase_date','valuation_override',
    'tax_status','tax_due_date','mot_status','mot_due_date'];
  const vehiclesCSVFinal = toCSV(cache.vehicles.map(v => ({ ...v, primary_driver: personRef(v.primary_driver_id) })), [...vColumns, 'primary_driver']);

  const peopleCSV = toCSV(cache.people, ['nickname','email','mobile']);

  const readingsCSV = toCSV(cache.readings.map(r => ({ ...r, vehicle: vehicleRef(r.vehicle_id) })), ['vehicle','date','mileage']);

  const costsCSV = toCSV(cache.runningCosts.map(c => ({ ...c, vehicle: vehicleRef(c.vehicle_id) })), ['vehicle','category','date','cost','mileage','note']);

  const policiesCSV = toCSV((cache.insurancePolicies||[]).map(p => ({ ...p, vehicle: vehicleRef(p.vehicle_id) })),
    ['vehicle','insurer','policy_number','annual_cost','start_date','end_date','renewal_date','claims_phone','general_phone','is_current']);

  const recordsCSV = toCSV(cache.drivingRecords.map(r => ({ ...r, person: personRef(r.person_id) })),
    ['person','kind','offence_code','points','date','licence_clear_date','insurance_disclosure_date','description','cost','at_fault','claim_reference']);

  const blob = new Blob(
    [`VEHICLES\r\n${vehiclesCSVFinal}\r\n\r\nPEOPLE\r\n${peopleCSV}\r\n\r\nREADINGS\r\n${readingsCSV}\r\n\r\nRUNNING COSTS\r\n${costsCSV}\r\n\r\nINSURANCE POLICIES\r\n${policiesCSV}\r\n\r\nDRIVING RECORDS\r\n${recordsCSV}\r\n`],
    { type: 'text/csv' }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'motoringmonitor-export.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ── Leave / delete household (account-level actions) ────────────
async function leaveHousehold(householdIdToLeave) {
  await supabaseClient.from('household_members').delete().eq('household_id', householdIdToLeave).eq('user_id', currentUser.id);
}

window.DataLayer = {
  init, onAuthChange, signUp, signIn, signOut,
  bootstrapHousehold, joinHousehold, getMyRole, getCurrentUserEmail, getJoinCode, refreshJoinCode,
  getCache, refreshFromCloud, flushQueue, pendingCount,
  addPerson, savePerson, archivePerson,
  saveVehicle, archiveVehicle, setNamedDrivers,
  addReading, deleteReading,
  addRunningCost,
  addDrivingRecord, saveDrivingRecord, deleteDrivingRecord,
  saveInsurancePolicy, deleteInsurancePolicy,
  exportCSV, leaveHousehold,
};
