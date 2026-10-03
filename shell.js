// The signed-in frame: sidebar on desktop, tab bar on mobile, brand colours, org switcher.
import { html, mount, on, icon, openModal, closeModal, logoImg, wireLogos } from './ui.js';
import { state, can, ROLE_LABEL } from './state.js';
import * as api from './api.js';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', href: '#/dashboard' },
  { id: 'tasks', label: 'Tasks', href: '#/tasks' },
  { id: 'vehicles', label: 'Vehicles', href: '#/vehicles' },
  { id: 'drivers', label: 'Drivers', href: '#/drivers' },
  { id: 'incidents', label: 'Incidents', href: '#/incidents' },
  { id: 'garages', label: 'Garages', href: '#/garages' },
  { id: 'insurance', label: 'Insurance', href: '#/insurance' },
  { id: 'reports', label: 'Reports', href: '#/reports' },
  { id: 'audit', label: 'Audit log', href: '#/audit', when: () => can.audit },
  { id: 'settings', label: 'Settings', href: '#/settings', when: () => can.configure },
];
const TABS = ['dashboard', 'tasks', 'vehicles', 'drivers'];
const visibleNav = () => NAV.filter((n) => !n.when || n.when());

// ---- Brand ------------------------------------------------------------------
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// Colours come from organisations.brand.colours, e.g. {"primary": "#0E5A6B"}. Text on the brand colour is chosen for contrast.
export function applyBrand(org) {
  const root = document.documentElement;
  const primary = org?.brand?.colours?.primary;
  const lum = luminance(primary);
  if (lum === null) {
    root.style.removeProperty('--brand'); root.style.removeProperty('--brand-ink'); root.style.removeProperty('--accent');
  } else {
    root.style.setProperty('--brand', primary);
    root.style.setProperty('--brand-ink', lum > 0.4 ? '#111111' : '#FFFFFF');
  }
  const accent = org?.brand?.colours?.accent;
  if (luminance(accent) !== null) root.style.setProperty('--accent', accent);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', primary || '#FF0066');
  document.title = org ? `${org.name} fleet` : 'FleetMonitor';
}

// ---- Frame --------------------------------------------------------------------
const navLink = (n, cls) => html`<a class="${cls}" href="${n.href}" data-nav="${n.id}">${icon(n.id)}<span>${n.label}</span>${n.id === 'tasks' ? html`<span class="badge" data-badge="tasks" hidden></span>` : ''}</a>`;

export function renderShell({ onSwitchOrg, onSignOut }) {
  const org = state.org;
  const logo = api.logoUrl(org.brand);
  applyBrand(org);
  mount(document.getElementById('app'), html`
    <div class="shell">
      <aside class="side">
        <div class="side-brand"><a class="brand-link" href="#/dashboard" aria-label="${org.name}: go to the dashboard">${logoImg(logo, org.name, 'side-name')}</a></div>
        <nav class="side-nav" aria-label="Main">${visibleNav().map((n) => navLink(n, 'side-link'))}</nav>
        <div class="side-foot">
          ${state.memberships.length > 1 ? html`<label class="side-switch"><span>Organisation</span><select id="org-switch">${state.memberships.map((m) => html`<option value="${m.organisation_id}" ${m.organisation_id === org.id ? 'selected' : ''}>${m.organisation.name}</option>`)}</select></label>` : ''}
          <p class="side-user"><span class="side-email">${state.user.email}</span><span class="side-role">${ROLE_LABEL[state.role]}</span></p>
          <button class="side-signout" type="button" data-action="signout">Sign out</button>
        </div>
      </aside>
      <div class="content"><header class="mobile-brand"><a class="brand-link" href="#/dashboard" aria-label="${org.name}: go to the dashboard">${logoImg(logo, org.name)}</a></header><main id="main" tabindex="-1"></main></div>
      <nav class="tabbar" aria-label="Main">
        ${NAV.filter((n) => TABS.includes(n.id)).map((n) => navLink(n, 'tab-link'))}
        <button type="button" class="tab-link" data-action="more">${icon('more')}<span>More</span></button>
      </nav>
    </div>`);
  const root = document.getElementById('app');
  wireLogos(root);
  on(root, {
    signout: () => onSignOut(),
    more: () => openMenu(onSignOut),
  });
  root.querySelector('#org-switch')?.addEventListener('change', (e) => onSwitchOrg(e.target.value));
}

function openMenu(onSignOut) {
  const rest = visibleNav().filter((n) => !TABS.includes(n.id));
  const dlg = openModal({
    title: 'Menu',
    hideFooter: true,
    body: html`<nav class="menu-list" aria-label="More">${rest.map((n) => html`<a class="menu-link" href="${n.href}" data-action="go">${icon(n.id)}<span>${n.label}</span></a>`)}</nav>
      <p class="side-user"><span>${state.user.email}</span><span class="side-role">${ROLE_LABEL[state.role]}</span></p>
      <p><button class="btn" type="button" data-action="signout">Sign out</button></p>`,
  });
  dlg.onclick = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'go') { closeModal(); return; }
    if (el.dataset.action === 'signout') { closeModal(); onSignOut(); }
  };
}

export function setBadge(id, n) {
  document.querySelectorAll(`[data-badge="${id}"]`).forEach((el) => {
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = !n;
    el.setAttribute('aria-label', `${n} overdue`);
  });
}

export function setActive(section) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === section) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}
