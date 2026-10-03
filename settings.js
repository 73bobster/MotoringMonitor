// Settings (superuser only). Depots now; users, compliance types, templates and branding come later.
import * as api from './api.js';
import { can } from './state.js';
import { html, mount, on, openModal, fieldsHtml, readForm, toast, loadingHtml, emptyHtml } from './ui.js';

export async function settingsView(main) {
  if (!can.configure) { mount(main, html`<header class="page-head"><h1>Settings</h1></header>${emptyHtml("You don't have access to settings", 'Only the superuser can change settings.')}`); return; }
  mount(main, html`<header class="page-head"><h1>Settings</h1></header>${loadingHtml()}`);
  let [depots, vehicles, drivers] = await Promise.all([api.listAllDepots(), api.listVehicles(), api.listDrivers()]);
  const usage = (id) => ({ v: vehicles.filter((x) => x.depot_id === id && !x.archived_at && x.status !== 'disposed').length, d: drivers.filter((x) => x.depot_id === id && x.employment_status === 'active').length });

  const specs = [
    { name: 'name', label: 'Depot name', required: true, span: 2 },
    { name: 'address', label: 'Address', type: 'textarea', rows: 2, span: 2 },
    { name: 'postcode', label: 'Postcode' },
    { name: 'phone', label: 'Phone', type: 'tel' },
  ];
  function draw() {
    mount(main, html`
      <header class="page-head"><h1>Settings</h1></header>
      <section>
        <div class="section-head"><h2>Depots</h2><button class="btn btn-primary" data-action="add">Add depot</button></div>
        <p class="muted">The master list of depots. Vehicles and drivers choose from this list.</p>
        ${depots.length ? html`<table class="grid"><thead><tr><th>Depot</th><th>Address</th><th class="num">Vehicles</th><th class="num">Drivers</th><th></th></tr></thead><tbody>
          ${depots.map((d) => { const u = usage(d.id); return html`<tr>
            <td data-label="Depot"><strong>${d.name}</strong>${d.archived_at ? html` <span class="tag">Archived</span>` : ''}</td>
            <td data-label="Address">${[d.address, d.postcode].filter(Boolean).join(', ')}${d.phone ? html`<div class="sub">${d.phone}</div>` : ''}</td>
            <td data-label="Vehicles" class="num">${u.v}</td><td data-label="Drivers" class="num">${u.d}</td>
            <td class="act"><button class="btn btn-sm" data-action="edit" data-id="${d.id}">Edit</button>
              <button class="btn btn-sm" data-action="${d.archived_at ? 'restore' : 'archive'}" data-id="${d.id}">${d.archived_at ? 'Restore' : 'Archive'}</button></td></tr>`; })}
        </tbody></table>` : emptyHtml('No depots yet', 'Add the sites your vehicles and drivers work from.')}
      </section>
      <section class="later"><h2>Coming later</h2><p class="muted">Users and roles, task types and reminder timings, message templates, and branding will be managed here.</p></section>`);
  }
  const reload = async () => { [depots, vehicles, drivers] = await Promise.all([api.listAllDepots(), api.listVehicles(), api.listDrivers()]); draw(); };
  const open = (d) => openModal({
    title: d ? 'Edit depot' : 'Add depot', submitLabel: 'Save', body: fieldsHtml(specs, d || {}),
    onSubmit: async (f) => { const v = readForm(f, specs); await api.saveDepot(v, d?.id); toast('Depot saved.'); await reload(); },
  });
  draw();
  on(main, {
    add: () => open(null),
    edit: (el) => open(depots.find((d) => d.id === el.dataset.id)),
    archive: (el) => {
      const d = depots.find((x) => x.id === el.dataset.id); const u = usage(d.id);
      openModal({
        title: `Archive ${d.name}?`, submitLabel: 'Archive depot', danger: true,
        body: html`<p>It will no longer be offered when choosing a depot.${u.v + u.d ? ` ${u.v} vehicle(s) and ${u.d} driver(s) are still assigned to it. They keep it until you change them.` : ''}</p>`,
        onSubmit: async () => { await api.saveDepot({ archived_at: new Date().toISOString() }, d.id); toast('Depot archived.'); await reload(); },
      });
    },
    restore: async (el) => { await api.saveDepot({ archived_at: null }, el.dataset.id); toast('Depot restored.'); await reload(); },
  });
}
