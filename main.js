// Boot: connect to Supabase, work out who is signed in and which organisation they are in, then run the app.
import { CONFIG } from './config.js';
import * as api from './api.js';
import { state, can, setMembership, clearState } from './state.js';
import { route, onRoute, start as startRouter } from './router.js';
import { renderShell, setActive, setBadge } from './shell.js';
import { showAuth, showNoAccess, showRecovery } from './auth.js';
import { html, mount, toast, errorHtml } from './ui.js';
import { tasksView } from './tasks.js';
import { vehiclesList, vehicleForm, vehicleDetail } from './vehicles.js';
import { driversList, driverForm, driverDetail } from './drivers.js';
import { incidentsList, incidentForm, incidentDetail } from './incidents.js';
import { insuranceList, policyForm, policyDetail } from './insurance.js';
import { settingsView } from './settings.js';
import { auditView } from './audit.js';
import { dashboardView } from './dashboard.js';
import { reportsView } from './reports.js';
import { garagesView } from './garages.js';
import { placeholder } from './placeholder.js';

const INVITE_KEY = 'fm:invite';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

// An invitation link looks like https://your-app/?invite=CODE. Keep the code until the person has signed in.
function captureInvite() {
  const params = new URLSearchParams(location.search);
  const code = params.get('invite');
  if (!code) return;
  store.set(INVITE_KEY, code);
  params.delete('invite');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
}

// ---- Routes ---------------------------------------------------------------------
route('/dashboard', 'dashboard', (m) => dashboardView(m));
route('/tasks', 'tasks', (m, p, q) => tasksView(m, q));
route('/garages', 'garages', (m) => garagesView(m));
route('/vehicles', 'vehicles', (m) => vehiclesList(m));
route('/vehicles/new', 'vehicles', (m) => vehicleForm(m, { id: 'new' }));
route('/vehicles/:id/edit', 'vehicles', (m, p) => vehicleForm(m, p));
route('/vehicles/:id', 'vehicles', (m, p, q) => vehicleDetail(m, p, q));
route('/drivers', 'drivers', (m) => driversList(m));
route('/drivers/new', 'drivers', (m) => driverForm(m, { id: 'new' }));
route('/drivers/:id/edit', 'drivers', (m, p) => driverForm(m, p));
route('/drivers/:id', 'drivers', (m, p, q) => driverDetail(m, p, q));
route('/incidents', 'incidents', (m) => incidentsList(m));
route('/incidents/new', 'incidents', (m, p, q) => incidentForm(m, { id: 'new' }, q));
route('/incidents/:id/edit', 'incidents', (m, p, q) => incidentForm(m, p, q));
route('/incidents/:id', 'incidents', (m, p) => incidentDetail(m, p));
route('/insurance', 'insurance', (m) => insuranceList(m));
route('/insurance/new', 'insurance', (m) => policyForm(m, { id: 'new' }));
route('/insurance/:id/edit', 'insurance', (m, p) => policyForm(m, p));
route('/insurance/:id', 'insurance', (m, p, q) => policyDetail(m, p, q));
route('/reports', 'reports', (m, p, q) => reportsView(m, p, q));
route('/audit', 'audit', (m) => auditView(m));
route('/settings', 'settings', (m) => settingsView(m));
onRoute(setActive);

// ---- Session flow -----------------------------------------------------------------
let entering = false;
let recovering = false;

function showFatal(err) {
  console.error(err);
  mount(document.getElementById('app'), html`<main id="main" class="auth-main">${errorHtml(err.message || 'Something went wrong.')}</main>`);
}

async function signOut() {
  try { await api.auth.signOut(); } catch (e) { console.error(e); }
  clearState();
  showAuth({ invite: store.get(INVITE_KEY) });
}

async function switchOrg(orgId) {
  const m = state.memberships.find((x) => x.organisation_id === orgId);
  if (!m) return;
  setMembership(m);
  mountApp();
  location.hash = '#/tasks';
}

function mountApp() {
  renderShell({ onSwitchOrg: switchOrg, onSignOut: signOut });
  api.listTasks().then((rows) => setBadge('tasks', rows.filter((t) => t.status === 'overdue').length)).catch(() => {});
  startRouter();
}

async function join(code) {
  await api.acceptInvitation(code);
  await enter({ user: state.user });
}

async function enter(session) {
  if (entering) return;
  entering = true;
  try {
    state.user = session.user;
    let notice = '';
    const invite = store.get(INVITE_KEY);
    if (invite) {
      try { await api.acceptInvitation(invite); } catch (e) { notice = e.message; }
      store.del(INVITE_KEY);
    }
    state.memberships = await api.loadMemberships(session.user.id);
    if (!state.memberships.length) {
      showNoAccess({ email: session.user.email, error: notice, onJoin: join, onSignOut: signOut });
      return;
    }
    setMembership(state.memberships.find((m) => m.organisation_id === store.get('fm:org')) || state.memberships[0]);
    mountApp();
    if (notice) toast(notice, 'error');
  } catch (err) {
    showFatal(err);
  } finally {
    entering = false;
  }
}

export async function boot(clientOverride) {
  document.addEventListener('click', (e) => { if (e.target.closest?.('[data-action="reload"]')) location.reload(); });
  const client = clientOverride || window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  api.init(client);
  captureInvite();

  // Do not await Supabase calls inside this callback: hand off to a timer instead.
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      recovering = true;
      setTimeout(() => showRecovery(async () => { recovering = false; const s = await api.auth.getSession(); if (s) await enter(s); }), 0);
    } else if (event === 'SIGNED_OUT') {
      clearState();
      setTimeout(() => showAuth({ invite: store.get(INVITE_KEY) }), 0);
    } else if (event === 'SIGNED_IN' && session && !recovering) {
      if (state.user?.id === session.user.id && state.org) return;
      setTimeout(() => enter(session), 0);
    }
  });

  try {
    const session = await api.auth.getSession();
    if (recovering) return;
    if (session) await enter(session);
    else showAuth({ mode: store.get(INVITE_KEY) ? 'signup' : 'signin', invite: store.get(INVITE_KEY) });
  } catch (err) {
    showFatal(err);
  }
}

if (typeof window !== 'undefined' && !window.__FM_TEST__) {
  if (window.supabase) boot();
  else showFatal(new Error('The Supabase library did not load. Check your connection and refresh the page.'));
}
