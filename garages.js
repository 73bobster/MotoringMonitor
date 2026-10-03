// Garages: the master list used to say where a vehicle is when it is not available.
import * as api from './api.js';
import { can } from './state.js';
import { html, mount, on, fieldsHtml, readForm, openModal, toast, loadingHtml, emptyHtml, plate } from './ui.js';
import { GARAGE_SERVICE_LABEL, UNAVAIL_REASON_LABEL } from './domain.js';

export async function garagesView(main) {
  mount(main, html`<header class="page-head"><h1>Garages</h1></header>${loadingHtml()}`);
  let [garages, vehicles] = await Promise.all([api.listGarages(), api.listVehicles()]);
  const ui = { archived: false };
  const specs = [
    { name: 'name', label: 'Garage name', required: true, span: 2 },
    { name: 'contact_name', label: 'Contact name' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'email', label: 'Email', type: 'email', span: 2 },
    { name: 'address', label: 'Address', type: 'textarea', rows: 2, span: 2 },
    { name: 'postcode', label: 'Postcode' },
  ];
  function draw() {
    const rows = garages.filter((g) => ui.archived || !g.archived_at);
    mount(main, html`
      <header class="page-head"><h1>Garages</h1>${can.write ? html`<button class="btn btn-primary" data-action="edit">Add garage</button>` : ''}</header>
      <p class="muted">The garages you use, with the work each one does. When a vehicle is out of service you choose its garage from this list, with the suitable ones first. Use Unknown garage when you do not know where it is.</p>
      <div class="filters"><label class="check small"><input type="checkbox" id="g-arch" ${ui.archived ? 'checked' : ''}> <span>Include archived garages</span></label></div>
      <table class="grid"><thead><tr><th>Garage</th><th>Contact</th><th>Types of work</th><th>At the garage now</th><th></th></tr></thead><tbody>
        ${rows.map((g) => {
          const there = vehicles.filter((v) => v.unavailable_garage_id === g.id && !v.archived_at && v.status !== 'disposed');
          return html`<tr>
            <td data-label="Garage"><strong>${g.name}</strong>${g.is_unknown ? html` <span class="tag">Built in</span>` : ''}${g.archived_at ? html` <span class="tag">Archived</span>` : ''}
              ${g.address || g.postcode ? html`<div class="sub">${[g.address, g.postcode].filter(Boolean).join(', ')}</div>` : ''}${g.is_unknown && g.notes ? html`<div class="sub">${g.notes}</div>` : ''}</td>
            <td data-label="Contact">${g.contact_name || ''}${g.phone ? html`<div class="sub">${g.phone}</div>` : ''}${g.email ? html`<div class="sub"><a href="mailto:${g.email}">${g.email}</a></div>` : ''}</td>
            <td data-label="Types of work">${g.is_unknown ? '' : (g.services || []).map((s) => GARAGE_SERVICE_LABEL[s]).join(', ') || html`<span class="muted">Not set</span>`}</td>
            <td data-label="At the garage now">${there.length ? there.map((v) => html`<a class="plate-link" href="#/vehicles/${v.id}?tab=availability">${plate(v.registration)}</a> `) : html`<span class="muted">None</span>`}</td>
            <td class="act">${can.write && !g.is_unknown ? html`<button class="btn btn-sm" data-action="edit" data-id="${g.id}">Edit</button> <button class="btn btn-sm" data-action="${g.archived_at ? 'restore' : 'archive'}" data-id="${g.id}">${g.archived_at ? 'Restore' : 'Archive'}</button>` : ''}</td></tr>`;
        })}</tbody></table>`);
    main.querySelector('#g-arch').addEventListener('change', (e) => { ui.archived = e.target.checked; draw(); });
  }
  const reload = async () => { [garages, vehicles] = await Promise.all([api.listGarages(), api.listVehicles()]); draw(); };
  draw();
  on(main, {
    edit: (el) => {
      const g = garages.find((x) => x.id === el.dataset.id);
      openModal({
        title: g ? `Edit ${g.name}` : 'Add garage', submitLabel: 'Save', wide: true,
        body: html`${fieldsHtml(specs, g || {})}
          <fieldset class="pick"><legend>Types of work this garage does</legend>${Object.entries(GARAGE_SERVICE_LABEL).map(([k, l]) => html`<label class="check"><input type="checkbox" name="svc" value="${k}" ${(g?.services || []).includes(k) ? 'checked' : ''}> <span>${l}</span></label>`)}</fieldset>
          <p class="hint">These are used to suggest the right garage when a vehicle goes in for ${UNAVAIL_REASON_LABEL.servicing.toLowerCase()}, tyres, an MOT and so on.</p>`,
        onSubmit: async (f) => {
          const v = readForm(f, specs);
          v.services = [...f.querySelectorAll('input[name="svc"]:checked')].map((i) => i.value);
          await api.saveGarage(v, g?.id);
          toast('Garage saved.');
          await reload();
        },
      });
    },
    archive: (el) => {
      const g = garages.find((x) => x.id === el.dataset.id);
      const there = vehicles.filter((v) => v.unavailable_garage_id === g.id).length;
      openModal({
        title: `Archive ${g.name}?`, submitLabel: 'Archive garage', danger: true,
        body: html`<p>It will no longer be offered when a vehicle goes in.${there ? ` ${there} vehicle(s) are there now and stay recorded against it.` : ''} Past visits keep their garage.</p>`,
        onSubmit: async () => { await api.saveGarage({ archived_at: new Date().toISOString() }, g.id); toast('Garage archived.'); await reload(); },
      });
    },
    restore: async (el) => { await api.saveGarage({ archived_at: null }, el.dataset.id); toast('Garage restored.'); await reload(); },
  });
}
