// Data layer: every call to Supabase goes through here.
// Every query is scoped to the current organisation. Row-level security is the real guard;
// the filter is there so a person who belongs to several organisations only sees the one they chose.
import { state } from './state.js';

let sb = null;
export const init = (client) => { sb = client; };
export const client = () => sb;
const org = () => state.org.id;

// ---- Errors -------------------------------------------------------------
export function friendly(err) {
  const msg = err?.message || String(err);
  if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (err?.code === '23505') {
    if (/registration/i.test(msg)) return 'A vehicle with that registration already exists.';
    if (/employee_number/i.test(msg)) return 'A current driver with that employee number already exists.';
    if (/licence_no/i.test(msg)) return 'A driver with that licence number already exists.';
    return 'That already exists.';
  }
  if (err?.code === '23503') return 'That is linked to a record that no longer exists. Refresh and try again.';
  if (err?.code === '23514') return 'One of the values is not allowed. Check the dates and numbers.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Could not reach the server. Check your connection and try again.';
  return msg;
}
const fail = (error) => { const e = new Error(friendly(error)); e.code = error.code; e.raw = error; throw e; };
const ok = ({ data, error }) => { if (error) fail(error); return data; };
// The API returns at most 1,000 rows per request, so long lists are read a page at a time.
// build() must return a fresh query with a stable order.
async function all(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = ok(await build().range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

// ---- Authentication -----------------------------------------------------
function authFail(error) {
  const msg = error?.message || '';
  let text = msg;
  if (/invalid login credentials/i.test(msg)) text = 'Email or password is incorrect.';
  else if (/email not confirmed/i.test(msg)) text = 'Confirm your email first. Check your inbox for the link we sent.';
  else if (/already registered|already been registered/i.test(msg)) text = 'An account with that email already exists. Sign in instead.';
  else if (/password should be at least|weak password/i.test(msg)) text = 'Choose a longer password (at least 8 characters).';
  else if (/rate limit|too many/i.test(msg)) text = 'Too many attempts. Wait a few minutes and try again.';
  const e = new Error(text); e.raw = error; throw e;
}
export const auth = {
  async getSession() { const { data, error } = await sb.auth.getSession(); if (error) authFail(error); return data.session; },
  async signIn(email, password) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); if (error) authFail(error); return data; },
  async signUp(email, password, redirectTo) {
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
    if (error) authFail(error);
    return data;
  },
  async signOut() { const { error } = await sb.auth.signOut(); if (error) authFail(error); },
  async resetPassword(email, redirectTo) { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo }); if (error) authFail(error); },
  async updatePassword(password) { const { error } = await sb.auth.updateUser({ password }); if (error) authFail(error); },
};

// ---- Organisation context -----------------------------------------------
export async function loadMemberships(userId) {
  // one request: each membership comes back with its organisation
  const rows = ok(await sb.from('memberships').select('*, organisation:organisations(*)').eq('user_id', userId).eq('status', 'active'));
  return rows.filter((m) => m.organisation);
}
export const acceptInvitation = async (token) => ok(await sb.rpc('accept_invitation', { p_token: token }));
// brand.logo_url is a full address; brand.logo_path is a file in the org-branding storage bucket.
export function logoUrl(brand) {
  if (!brand) return null;
  if (brand.logo_url) return brand.logo_url;
  if (brand.logo_path) return sb.storage.from('org-branding').getPublicUrl(brand.logo_path).data.publicUrl;
  return null;
}

// ---- Tasks and compliance ------------------------------------------------
export const listTasks = async ({ vehicleId, driverId } = {}) =>
  all(() => {
    let q = sb.from('compliance_tasks').select('*').eq('organisation_id', org());
    if (vehicleId) q = q.eq('vehicle_id', vehicleId);
    if (driverId) q = q.eq('driver_id', driverId);
    return q.order('due_date', { ascending: true, nullsFirst: false }).order('source_id').order('state_key');
  });
export const listComplianceTypes = async () =>
  ok(await sb.from('compliance_types').select('*').eq('organisation_id', org()).order('sort_order'));

export async function recordRenewal({ itemId, completedOn, newDueDate, reference, cost, notes }) {
  return ok(await sb.rpc('record_compliance_renewal', {
    p_item_id: itemId, p_completed_on: completedOn, p_new_due_date: newDueDate ?? null,
    p_reference: reference ?? null, p_cost: cost ?? null, p_document_id: null, p_notes: notes ?? null,
  }));
}
export const updateItem = async (id, patch) =>
  ok(await sb.from('compliance_items').update(patch).eq('id', id).eq('organisation_id', org()).select().single());
export const listRenewals = async (itemId) =>
  ok(await sb.from('compliance_renewals').select('*').eq('organisation_id', org()).eq('compliance_item_id', itemId).order('completed_on', { ascending: false }).limit(5));

export const setTaskState = async ({ source_type, source_id, type_code, due_date, state: st, snoozed_until, reason }) =>
  ok(await sb.from('task_states').upsert(
    { organisation_id: org(), source_type, source_id, type_code: type_code || '', due_date, state: st, snoozed_until: snoozed_until ?? null, reason },
    { onConflict: 'organisation_id,source_type,source_id,type_code,due_date' }));
export const clearTaskState = async (t) =>
  ok(await sb.from('task_states').delete().eq('organisation_id', org()).eq('source_type', t.source_type).eq('source_id', t.source_id).eq('type_code', t.state_key || '').eq('due_date', t.due_date));

// ---- Messages -------------------------------------------------------------
export const listTemplates = async () => ok(await sb.from('message_templates').select('*').eq('organisation_id', org()).eq('is_active', true));
export const listMessages = async (sourceType, sourceId) =>
  ok(await sb.from('message_log').select('*').eq('organisation_id', org()).eq('source_type', sourceType).eq('source_id', sourceId).order('created_at', { ascending: false }).limit(5));
export const logMessage = async (row) =>
  ok(await sb.from('message_log').insert({ ...row, organisation_id: org() }).select().single());

// ---- Depots ---------------------------------------------------------------
export const listDepots = async () =>
  ok(await sb.from('depots').select('*').eq('organisation_id', org()).is('archived_at', null).order('name'));
export const listAllDepots = async () =>
  ok(await sb.from('depots').select('*').eq('organisation_id', org()).order('name'));
export async function saveDepot(values, id) {
  if (id) return ok(await sb.from('depots').update(values).eq('id', id).eq('organisation_id', org()).select().single());
  return ok(await sb.from('depots').insert({ ...values, organisation_id: org() }).select().single());
}

// ---- Vehicles ---------------------------------------------------------------
export const listVehicles = async () =>
  ok(await sb.from('vehicle_overview').select('*').eq('organisation_id', org()).order('registration'));
export const getVehicle = async (id) =>
  ok(await sb.from('vehicle_overview').select('*').eq('organisation_id', org()).eq('id', id).maybeSingle());
export async function saveVehicle(values, id) {
  if (id) return ok(await sb.from('vehicles').update(values).eq('id', id).eq('organisation_id', org()).select().single());
  return ok(await sb.from('vehicles').insert({ ...values, organisation_id: org() }).select().single());
}
export const archiveVehicle = async (id) =>
  ok(await sb.from('vehicles').update({ archived_at: new Date().toISOString() }).eq('id', id).eq('organisation_id', org()).select().single());
export const restoreVehicle = async (id) =>
  ok(await sb.from('vehicles').update({ archived_at: null }).eq('id', id).eq('organisation_id', org()).select().single());
export const disposeVehicle = async ({ id, date, reason, salePrice, soldTo, notes }) =>
  ok(await sb.rpc('dispose_vehicle', { p_vehicle_id: id, p_date: date, p_reason: reason, p_sale_price: salePrice ?? null, p_sold_to: soldTo ?? null, p_notes: notes ?? null }));

// ---- Drivers ----------------------------------------------------------------
export const listDrivers = async () =>
  ok(await sb.from('drivers').select('*').eq('organisation_id', org()).is('archived_at', null).order('last_name').order('first_name'));
export const getDriver = async (id) =>
  ok(await sb.from('drivers').select('*').eq('organisation_id', org()).eq('id', id).maybeSingle());
export const getDriverSensitive = async (id) =>
  ok(await sb.from('driver_sensitive').select('*').eq('organisation_id', org()).eq('driver_id', id).maybeSingle());
export async function saveDriver(values, sensitive, id, forceSensitive = false) {
  let driver;
  if (id) {
    driver = ok(await sb.from('drivers').update(values).eq('id', id).eq('organisation_id', org()).select().single());
    // keep the current period of employment in step with the employee number and job title
    if ('employee_number' in values || 'job_title' in values) {
      ok(await sb.from('driver_periods').update({ employee_number: values.employee_number ?? null, job_title: values.job_title ?? null }).eq('organisation_id', org()).eq('driver_id', id).is('end_date', null));
    }
  } else driver = ok(await sb.from('drivers').insert({ ...values, organisation_id: org() }).select().single());
  if (sensitive && (forceSensitive || Object.values(sensitive).some((v) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length)))) {
    ok(await sb.from('driver_sensitive').upsert({ ...sensitive, driver_id: driver.id, organisation_id: org() }, { onConflict: 'driver_id' }));
  }
  return driver;
}
export const archiveDriver = async (id) =>
  ok(await sb.from('drivers').update({ archived_at: new Date().toISOString() }).eq('id', id).eq('organisation_id', org()).select().single());
// A returning driver is recognised by their licence number.
export async function findDriverByLicence(number) {
  const row = ok(await sb.from('driver_sensitive').select('driver_id').eq('organisation_id', org()).eq('licence_number', number).maybeSingle());
  return row ? getDriver(row.driver_id) : null;
}
export const listPeriods = async (driverId) =>
  ok(await sb.from('driver_periods').select('*').eq('organisation_id', org()).eq('driver_id', driverId).order('start_date', { ascending: false }));
export const leaveDriver = async ({ id, date, reason, notes }) =>
  ok(await sb.rpc('leave_driver', { p_driver_id: id, p_end_date: date, p_reason: reason, p_notes: notes ?? null }));
export const rehireDriver = async ({ id, startDate, employeeNumber, jobTitle }) =>
  ok(await sb.rpc('rehire_driver', { p_driver_id: id, p_start_date: startDate, p_employee_number: employeeNumber ?? null, p_job_title: jobTitle ?? null }));

export const currentLicences = async () =>
  ok(await sb.from('driver_current_licence').select('*').eq('organisation_id', org()));
export const listLicenceChecks = async (driverId) =>
  ok(await sb.from('licence_checks').select('*').eq('organisation_id', org()).eq('driver_id', driverId).order('checked_on', { ascending: false }).order('created_at', { ascending: false }));
export const addLicenceCheck = async (values) =>
  ok(await sb.from('licence_checks').insert({ ...values, organisation_id: org() }).select().single());

// ---- Convictions ------------------------------------------------------------
export const listConvictions = async (driverId) => {
  let q = sb.from('driver_convictions').select('*').eq('organisation_id', org());
  if (driverId) q = q.eq('driver_id', driverId);
  return ok(await q.order('offence_date', { ascending: false }));
};
export const listConvictionCodes = async () => ok(await sb.from('conviction_codes').select('*').order('code'));
export async function saveConviction(values, id) {
  if (id) return ok(await sb.from('driver_convictions').update(values).eq('id', id).eq('organisation_id', org()).select().single());
  return ok(await sb.from('driver_convictions').insert({ ...values, organisation_id: org() }).select().single());
}
export const updateConviction = (id, patch) => saveConviction(patch, id);

// ---- Incidents (accidents, damage and fines) --------------------------------------
export async function listIncidents({ vehicleId, driverId } = {}) {
  return all(() => {
    let q = sb.from('incidents').select('*').eq('organisation_id', org()).is('archived_at', null);
    if (vehicleId) q = q.eq('vehicle_id', vehicleId);
    if (driverId) q = q.eq('driver_id', driverId);
    return q.order('incident_date', { ascending: false }).order('id');
  });
}
export const getIncident = async (id) =>
  ok(await sb.from('incidents').select('*').eq('organisation_id', org()).eq('id', id).maybeSingle());
export async function saveIncident(values, id) {
  if (id) return ok(await sb.from('incidents').update(values).eq('id', id).eq('organisation_id', org()).select().single());
  return ok(await sb.from('incidents').insert({ ...values, organisation_id: org() }).select().single());
}
export const updateIncident = (id, patch) => saveIncident(patch, id);
export const archiveIncident = (id) => saveIncident({ archived_at: new Date().toISOString() }, id);

// ---- Insurance --------------------------------------------------------------------
export const listPolicies = async () =>
  ok(await sb.from('insurance_policies').select('*').eq('organisation_id', org()).is('archived_at', null).order('end_date', { ascending: false }));
export const getPolicy = async (id) =>
  ok(await sb.from('insurance_policies').select('*').eq('organisation_id', org()).eq('id', id).maybeSingle());
export async function savePolicy(values, id) {
  if (id) return ok(await sb.from('insurance_policies').update(values).eq('id', id).eq('organisation_id', org()).select().single());
  return ok(await sb.from('insurance_policies').insert({ ...values, organisation_id: org() }).select().single());
}
export async function listPolicyVehicles({ policyId, vehicleId } = {}) {
  let q = sb.from('policy_vehicles').select('*').eq('organisation_id', org());
  if (policyId) q = q.eq('policy_id', policyId);
  if (vehicleId) q = q.eq('vehicle_id', vehicleId);
  return ok(await q.order('start_date', { ascending: false, nullsFirst: false }));
}
export const addPolicyVehicle = async (values) =>
  ok(await sb.from('policy_vehicles').insert({ ...values, organisation_id: org() }).select().single());
export const endPolicyVehicle = async (id, endDate) =>
  ok(await sb.from('policy_vehicles').update({ end_date: endDate }).eq('id', id).eq('organisation_id', org()).select().single());
export const listClaims = async (policyId) =>
  ok(await sb.from('insurance_claims').select('*').eq('organisation_id', org()).eq('policy_id', policyId).is('archived_at', null).order('incident_date', { ascending: false }));
export async function saveClaim(values, id) {
  if (id) return ok(await sb.from('insurance_claims').update(values).eq('id', id).eq('organisation_id', org()).select().single());
  return ok(await sb.from('insurance_claims').insert({ ...values, organisation_id: org() }).select().single());
}
export const listContacts = async () =>
  ok(await sb.from('contacts').select('*').eq('organisation_id', org()).is('archived_at', null).order('name'));
export const saveContact = async (values) =>
  ok(await sb.from('contacts').insert({ ...values, organisation_id: org() }).select().single());

// ---- Assignments, readings and costs -------------------------------------------------
export async function listAssignments({ vehicleId, driverId }) {
  return all(() => {
    let q = sb.from('vehicle_assignments').select('*').eq('organisation_id', org());
    if (vehicleId) q = q.eq('vehicle_id', vehicleId);
    if (driverId) q = q.eq('driver_id', driverId);
    return q.order('start_date', { ascending: false }).order('id');
  });
}
export const addAssignment = async (values) =>
  ok(await sb.from('vehicle_assignments').insert({ ...values, organisation_id: org() }).select().single());
export const endAssignment = async (id, endDate) =>
  ok(await sb.from('vehicle_assignments').update({ end_date: endDate }).eq('id', id).eq('organisation_id', org()).select().single());
export async function primaryDriver(vehicleId) {
  const a = ok(await sb.from('vehicle_assignments').select('driver_id').eq('organisation_id', org()).eq('vehicle_id', vehicleId).eq('assignment_type', 'primary').is('end_date', null).maybeSingle());
  return a ? getDriver(a.driver_id) : null;
}
export const listReadings = async (vehicleId) =>
  ok(await sb.from('odometer_readings').select('*').eq('organisation_id', org()).eq('vehicle_id', vehicleId).order('reading_date', { ascending: false }).order('mileage', { ascending: false }).limit(50));
export const addReading = async (values) =>
  ok(await sb.from('odometer_readings').insert({ ...values, organisation_id: org() }).select().single());
export const listCosts = async (vehicleId) =>
  ok(await sb.from('vehicle_costs').select('*').eq('organisation_id', org()).eq('vehicle_id', vehicleId).order('cost_date', { ascending: false }).limit(100));
export const addCost = async (values) =>
  ok(await sb.from('vehicle_costs').insert({ ...values, organisation_id: org() }).select().single());

// ---- Documents ------------------------------------------------------------------------
const FOLDER = { vehicle_id: 'vehicles', driver_id: 'drivers', policy_id: 'policies', incident_id: 'incidents' };
const safeName = (n) => String(n || 'file').normalize('NFKD').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file';

export async function listDocuments(target) {
  let q = sb.from('documents').select('*').eq('organisation_id', org()).is('archived_at', null);
  for (const [k, v] of Object.entries(target)) q = q.eq(k, v);
  return ok(await q.order('created_at', { ascending: false }));
}
// Stores the file in the private bucket (path starts with the organisation id), then records it.
export async function uploadDocument({ file, name, category, target }) {
  const key = Object.keys(target)[0];
  const path = `${org()}/${FOLDER[key]}/${target[key]}/${crypto.randomUUID()}-${safeName(name || file.name)}`;
  const up = await sb.storage.from('fleet-documents').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (up.error) fail(up.error);
  try {
    return ok(await sb.from('documents').insert({
      organisation_id: org(), ...target, category, file_name: name || file.name, storage_path: path, mime_type: file.type || null, size_bytes: file.size,
    }).select().single());
  } catch (e) {
    await sb.storage.from('fleet-documents').remove([path]).catch(() => {});
    throw e;
  }
}
export async function documentUrl(path) {
  const { data, error } = await sb.storage.from('fleet-documents').createSignedUrl(path, 300);
  if (error) fail(error);
  return data.signedUrl;
}
export const archiveDocument = async (id) =>
  ok(await sb.from('documents').update({ archived_at: new Date().toISOString() }).eq('id', id).eq('organisation_id', org()).select().single());

// ---- Audit ------------------------------------------------------------------------------
// History for one vehicle or driver: every significant change across all their records, newest first.
// Mileage readings are left out on purpose.
export async function listAuditFor({ vehicleId, driverId, limit = 100 }) {
  let q = sb.from('audit_log').select('*').eq('organisation_id', org()).neq('table_name', 'odometer_readings');
  if (vehicleId) q = q.eq('vehicle_id', vehicleId);
  if (driverId) q = q.eq('driver_id', driverId);
  return ok(await q.order('occurred_at', { ascending: false }).limit(limit));
}
export async function searchAudit({ from, to, vehicleId, driverId, includeReadings = false, limit = 200 }) {
  let q = sb.from('audit_log').select('*').eq('organisation_id', org());
  if (from) q = q.gte('occurred_at', new Date(`${from}T00:00:00`).toISOString());
  if (to) { const end = new Date(`${to}T00:00:00`); end.setDate(end.getDate() + 1); q = q.lt('occurred_at', end.toISOString()); }
  if (vehicleId) q = q.eq('vehicle_id', vehicleId);
  if (driverId) q = q.eq('driver_id', driverId);
  if (!includeReadings) q = q.neq('table_name', 'odometer_readings');
  return ok(await q.order('occurred_at', { ascending: false }).limit(limit));
}

// ---- Garages and vehicle availability ---------------------------------------------------
export const listGarages = async () =>
  ok(await sb.from('garages').select('*').eq('organisation_id', org()).order('name'));
export async function saveGarage(values, id) {
  if (id) return ok(await sb.from('garages').update(values).eq('id', id).eq('organisation_id', org()).select().single());
  return ok(await sb.from('garages').insert({ ...values, organisation_id: org() }).select().single());
}
export const listUnavailability = async (vehicleId) =>
  all(() => {
    let q = sb.from('vehicle_unavailability').select('*').eq('organisation_id', org());
    if (vehicleId) q = q.eq('vehicle_id', vehicleId);
    return q.order('from_date', { ascending: false }).order('id');
  });
export const outOfService = async (a) =>
  ok(await sb.rpc('vehicle_out_of_service', {
    p_vehicle_id: a.vehicleId, p_reason: a.reason, p_garage_id: a.garageId ?? null, p_from: a.from, p_expected_return: a.expectedReturn ?? null,
    p_incident_id: a.incidentId ?? null, p_location_note: a.locationNote ?? null, p_notes: a.notes ?? null, p_sorn_declared_on: a.sornDeclaredOn ?? null,
  }));
export const backInService = async ({ eventId, returnedOn, notes }) =>
  ok(await sb.rpc('vehicle_back_in_service', { p_event_id: eventId, p_returned_on: returnedOn, p_notes: notes ?? null }));
export const convertToOffRoad = async ({ eventId, sornDeclaredOn }) =>
  ok(await sb.rpc('vehicle_convert_to_off_road', { p_event_id: eventId, p_sorn_declared_on: sornDeclaredOn }));
export const updateUnavailability = async (id, patch) =>
  ok(await sb.from('vehicle_unavailability').update(patch).eq('id', id).eq('organisation_id', org()).select().single());
// The compliance item (for example the SERVICE or MOT item) on a vehicle, by type code.
export async function getVehicleItem(vehicleId, code) {
  const types = ok(await sb.from('compliance_types').select('id').eq('organisation_id', org()).eq('code', code));
  if (!types.length) return null;
  return ok(await sb.from('compliance_items').select('*').eq('organisation_id', org()).eq('vehicle_id', vehicleId).eq('compliance_type_id', types[0].id).maybeSingle());
}

// ---- Fleet-wide data for the dashboard and reports ---------------------------------------
// Running costs dated inside a period.
export const listCostsBetween = async ({ from, to }) =>
  all(() => sb.from('vehicle_costs').select('*').eq('organisation_id', org()).gte('cost_date', from).lte('cost_date', to).order('cost_date', { ascending: false }).order('id'));
// Odometer readings at the start and end of a period for each vehicle, worked out in the database.
export const milesInPeriod = async ({ from, to }) =>
  ok(await sb.rpc('mileage_in_period', { p_org: org(), p_from: from, p_to: to }));
export const cancelBooking = async ({ eventId, notes }) =>
  ok(await sb.rpc('vehicle_cancel_booking', { p_event_id: eventId, p_notes: notes ?? null }));
