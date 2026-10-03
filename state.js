// Who is signed in, which organisation they are working in, and what their role allows.
// The database enforces all of this; these helpers only decide what to show.

export const state = { user: null, memberships: [], membership: null, org: null, role: null };

export const ROLE_LABEL = { superuser: 'Superuser', fleet_admin: 'Fleet admin', fleet_manager: 'Fleet manager', reviewer: 'Reviewer' };

const WRITERS = ['superuser', 'fleet_admin', 'fleet_manager'];
export const can = {
  get write() { return WRITERS.includes(state.role); },
  get sensitive() { return WRITERS.includes(state.role); },
  get audit() { return ['superuser', 'fleet_admin'].includes(state.role); },
  get override() { return ['superuser', 'fleet_admin'].includes(state.role); },
  get configure() { return state.role === 'superuser'; },
};

export function setMembership(m) {
  state.membership = m;
  state.org = m.organisation;
  state.role = m.role;
  try { localStorage.setItem('fm:org', m.organisation_id); } catch { /* storage unavailable */ }
}

export function clearState() {
  state.user = null; state.memberships = []; state.membership = null; state.org = null; state.role = null;
}
