// Everything you can do to a task: record a renewal, set a date, snooze, dismiss, email,
// tell the insurer, record a fine as paid, and so on. Shared by Tasks and the vehicle and driver pages.
import * as api from './api.js';
import { state, can } from './state.js';
import { bookGarageModal, backInServiceModal, sornDeclaredModal, extendReturnModal, convertToOffRoadModal } from './availability.js';
import {
  html, mount, on, openModal, closeModal, fieldsHtml, readForm, toast, pill, plate, formatReg,
  fmtDate, fmtDateShort, fmtDateTime, dueText, todayStr, addDaysISO,
} from './ui.js';

export const merge = (text, vars) => String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
const isQuiet = (t) => t.status === 'snoozed' || t.status === 'dismissed';

export function taskWho(t, ctx = {}) {
  if (t.vehicle_id && t.applies_to === 'vehicle') {
    const v = ctx.vehicles?.get(t.vehicle_id);
    return html`${plate(v?.registration || String(t.target_label).split(' - ')[0])}${v?.nickname ? html` <span class="muted">${v.nickname}</span>` : ''}`;
  }
  return html`<span>${t.target_label}</span>`;
}

// What can be done with this task. Buttons with an href open another screen.
export function taskButtons(t) {
  if (isQuiet(t)) return [{ action: 'restore', label: 'Restore', primary: true }];
  const out = [];
  switch (t.type_code) {
    case 'INSURANCE_RENEWAL': out.push({ href: `#/insurance/${t.source_id}`, label: 'Open policy', primary: true }); break;
    case 'CONVICTION_INSURER_NOTICE':
      out.push({ action: 'notify-conviction', label: 'Record insurer told', primary: true }, { href: `#/drivers/${t.driver_id}?tab=convictions`, label: 'Open driver' }); break;
    case 'CONVICTION_LICENCE_END': case 'CONVICTION_TOTTING_END': case 'CONVICTION_DISCLOSURE_END':
      out.push({ href: `#/drivers/${t.driver_id}?tab=convictions`, label: 'Open driver' }); break;
    case 'INCIDENT_INSURER_NOTICE':
      out.push({ action: 'notify-incident', label: 'Record insurer told', primary: true }, { href: `#/incidents/${t.source_id}`, label: 'Open incident' }); break;
    case 'FINE_PAYMENT':
      out.push({ action: 'paid', label: 'Record paid', primary: true }, { href: `#/incidents/${t.source_id}`, label: 'Open fine' }); break;
    case 'FINE_NOMINATION':
      out.push({ action: 'nominated', label: 'Record driver named', primary: true }, { href: `#/incidents/${t.source_id}`, label: 'Open fine' }); break;
    case 'LEASE_END':
      out.push({ action: 'extend', label: 'Extend the term', primary: true }, { href: `#/vehicles/${t.source_id}?dispose=1`, label: 'Dispose of the vehicle' }, { href: `#/vehicles/${t.source_id}`, label: 'Open vehicle' }); break;
    case 'SERVICE_BOOKING':
      out.push({ action: 'book-garage', label: 'Book the garage', primary: true }, { href: `#/vehicles/${t.vehicle_id}?tab=availability`, label: 'Open vehicle' }); break;
    case 'VEHICLE_SORN':
      out.push({ action: 'sorn', label: 'Record SORN declared', primary: true }, { action: 'back-in-service', label: 'Back in service' }, { href: `#/vehicles/${t.vehicle_id}?tab=availability`, label: 'Open vehicle' }); break;
    case 'VEHICLE_RETURN_OVERDUE':
      out.push({ action: 'back-in-service', label: 'Back in service', primary: true }, { action: 'extend-return', label: 'Change expected return' }, { href: `#/vehicles/${t.vehicle_id}?tab=availability`, label: 'Open vehicle' }); break;
    case 'VEHICLE_LONG_ABSENCE':
      out.push({ action: 'convert-sorn', label: 'Record as off the road (SORN)', primary: true }, { action: 'back-in-service', label: 'Back in service' }, { href: `#/vehicles/${t.vehicle_id}?tab=availability`, label: 'Open vehicle' }); break;
    case 'VEHICLE_UNINSURED': out.push({ href: `#/vehicles/${t.source_id}?tab=insurance`, label: 'Add to a policy', primary: true }); break;
    case 'VEHICLE_DISPOSAL_INSURER':
      out.push({ action: 'notify-vehicle', label: 'Record insurer told', primary: true }, { href: `#/vehicles/${t.source_id}`, label: 'Open vehicle' }); break;
    default:
      out.push(t.due_date ? { action: 'renew', label: 'Record renewal', primary: true } : { action: 'setdate', label: 'Set due date', primary: true });
      if (t.due_date) out.push({ action: 'setdate', label: 'Correct due date' });
      out.push({ action: 'email', label: 'Email driver' });
  }
  if (t.due_date) out.push({ action: 'snooze', label: 'Snooze' }, { action: 'dismiss', label: 'Dismiss' });
  return out;
}
export const quickButton = (t) => taskButtons(t).find((b) => b.primary) || null;

export function runAction(action, t, ctx, onChange) {
  const map = {
    renew: () => renewModal(t, ctx, onChange),
    setdate: () => setDateModal(t, ctx, onChange),
    email: () => emailModal(t, ctx, onChange),
    snooze: () => snoozeModal(t, ctx, onChange),
    dismiss: () => dismissModal(t, ctx, onChange),
    restore: async () => { await restoreTask(t); toast('Task restored.'); closeModal(); await onChange?.(); },
    'notify-conviction': () => told(t, ctx, onChange, 'Record that the insurer was told', (v) => api.updateConviction(t.source_id, { insurer_notified_on: v.date, insurer_notified_ref: v.ref }), 'Insurer notice recorded.'),
    'notify-incident': () => told(t, ctx, onChange, 'Record that the insurer was told', (v) => api.updateIncident(t.source_id, { insurer_notified_on: v.date, insurer_notified_ref: v.ref }), 'Insurer notice recorded.'),
    'notify-vehicle': () => told(t, ctx, onChange, 'Record that the insurer was told', (v) => api.saveVehicle({ disposal_insurer_notified_on: v.date }, t.source_id), 'Insurer notice recorded.', false),
    paid: () => paidModal(t, ctx, onChange),
    nominated: () => nominatedModal(t, ctx, onChange),
    extend: () => extendModal(t, ctx, onChange),
    'book-garage': async () => { const item = await api.getVehicleItem(t.vehicle_id, 'SERVICE'); closeModal(); await bookGarageModal(t.vehicle_id, item?.due_date, onChange); },
    sorn: () => { closeModal(); sornDeclaredModal(t.source_id, { onDone: onChange }); },
    'back-in-service': () => { closeModal(); return backInServiceModal(t.source_id, { onDone: onChange }); },
    'extend-return': () => { closeModal(); return extendReturnModal(t.source_id, { onDone: onChange }); },
    'convert-sorn': () => { closeModal(); return convertToOffRoadModal(t.source_id, { onDone: onChange }); },
  };
  return map[action]?.();
}

// ---- Task panel -----------------------------------------------------------
export function openTaskPanel(t, ctx, onChange) {
  const quiet = isQuiet(t);
  const buttons = can.write ? taskButtons(t) : taskButtons(t).filter((b) => b.href);
  const dlg = openModal({
    title: t.type_name,
    hideFooter: true,
    body: html`
      <div class="panel-who">${taskWho(t, ctx)}</div>
      <dl class="facts">
        <div><dt>Status</dt><dd>${pill(t.status)}</dd></div>
        <div><dt>Due</dt><dd>${t.due_date ? html`${fmtDate(t.due_date)}<br><span class="muted">${dueText(t.days_remaining)}</span>` : 'No date set'}</dd></div>
        ${quiet ? html`<div><dt>${t.status === 'snoozed' ? `Snoozed until ${fmtDateShort(t.snoozed_until)}` : 'Dismissed'}</dt><dd>${t.state_reason}</dd></div>` : ''}
        ${t.is_statutory ? html`<div><dt>Requirement</dt><dd>Statutory</dd></div>` : ''}
      </dl>
      ${buttons.length ? html`<div class="panel-actions">${buttons.map((b) => b.href
        ? html`<a class="btn ${b.primary ? 'btn-primary' : ''}" href="${b.href}" data-action="go">${b.label}</a>`
        : html`<button class="btn ${b.primary ? 'btn-primary' : ''}" data-action="act" data-act="${b.action}">${b.label}</button>`)}</div>` : ''}
      <section class="panel-history" id="panel-history"><h3>History</h3><p class="muted">Loading</p></section>`,
  });
  on(dlg, {
    go: (el) => { closeModal(); location.hash = el.getAttribute('href'); },
    act: (el) => runAction(el.dataset.act, t, ctx, onChange),
  });
  loadHistory(t);
}

async function loadHistory(t) {
  const box = document.getElementById('panel-history');
  if (!box) return;
  try {
    const [renewals, messages] = await Promise.all([
      t.source_type === 'compliance_item' ? api.listRenewals(t.source_id) : [],
      can.write ? api.listMessages(t.source_type, t.source_id) : [],
    ]);
    if (!box.isConnected) return;
    const rows = [
      ...renewals.map((r) => ({ at: r.created_at, text: `Renewed on ${fmtDateShort(r.completed_on)}, next due ${r.new_due_date ? fmtDateShort(r.new_due_date) : 'not set'}${r.reference ? ` (${r.reference})` : ''}` })),
      ...messages.map((m) => ({ at: m.created_at, text: `${m.channel === 'email' ? 'Email' : m.channel} to ${m.recipient_address || 'recipient'}: ${m.status === 'manual_sent' ? 'sent manually' : m.status}` })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    mount(box, html`<h3>History</h3>${rows.length
      ? html`<ul class="history">${rows.map((r) => html`<li><span class="muted">${fmtDateTime(r.at)}</span> ${r.text}</li>`)}</ul>`
      : html`<p class="muted">Nothing recorded for this task yet.</p>`}`);
  } catch {
    if (box.isConnected) mount(box, html`<h3>History</h3><p class="muted">History isn't available right now.</p>`);
  }
}

// ---- Small forms -----------------------------------------------------------------
function form(t, ctx, { title, submitLabel = 'Save', specs, values = {}, intro = '', hint = '', onSave, done }, onChange) {
  openModal({
    title, submitLabel,
    body: html`<div class="panel-who">${taskWho(t, ctx)}</div>${intro ? html`<p class="muted">${intro}</p>` : ''}${fieldsHtml(specs, values)}${hint ? html`<p class="hint">${hint}</p>` : ''}`,
    onSubmit: async (f) => {
      const v = readForm(f, specs);
      const result = await onSave(v);
      toast(typeof done === 'function' ? done(v, result) : done);
      await onChange?.();
    },
  });
}

export function renewModal(t, ctx, onChange) {
  const specs = [
    { name: 'completed_on', label: 'Completed on', type: 'date', required: true, max: todayStr() },
    { name: 'new_due_date', label: 'New due date', type: 'date', hint: 'Leave blank to use the standard interval for this item.' },
    { name: 'reference', label: 'Certificate or reference number', type: 'text', span: 2 },
    { name: 'cost', label: 'Cost (£)', type: 'number', step: '0.01', min: '0', inputmode: 'decimal' },
    { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
  ];
  form(t, ctx, {
    title: `Record renewal: ${t.type_name}`, submitLabel: 'Record renewal', specs, values: { completed_on: todayStr() },
    onSave: (v) => api.recordRenewal({ itemId: t.source_id, completedOn: v.completed_on, newDueDate: v.new_due_date, reference: v.reference, cost: v.cost, notes: v.notes }),
    done: (v, row) => `Renewal recorded. Next due ${row?.due_date ? fmtDateShort(row.due_date) : 'date not set'}.`,
  }, onChange);
}

export function setDateModal(t, ctx, onChange) {
  const specs = [
    { name: 'due_date', label: 'Due date', type: 'date', required: true },
    { name: 'reference', label: 'Certificate or reference number', type: 'text', span: 2 },
  ];
  form(t, ctx, {
    title: `${t.due_date ? 'Correct' : 'Set'} due date: ${t.type_name}`, specs, values: { due_date: t.due_date },
    hint: 'Use Record renewal when the item has actually been done. This only changes the date.',
    onSave: (v) => api.updateItem(t.source_id, { due_date: v.due_date, ...(v.reference ? { reference: v.reference } : {}) }),
    done: 'Due date saved.',
  }, onChange);
}

export function snoozeModal(t, ctx, onChange) {
  const specs = [
    { name: 'snoozed_until', label: 'Snooze until', type: 'date', required: true, min: addDaysISO(todayStr(), 1) },
    { name: 'reason', label: 'Reason', type: 'textarea', required: true, span: 2, hint: 'For example: booked in for Thursday. The reason is kept in the audit log.' },
  ];
  form(t, ctx, {
    title: `Snooze: ${t.type_name}`, submitLabel: 'Snooze', specs, values: { snoozed_until: addDaysISO(todayStr(), 7) },
    onSave: (v) => api.setTaskState({ source_type: t.source_type, source_id: t.source_id, type_code: t.state_key, due_date: t.due_date, state: 'snoozed', snoozed_until: v.snoozed_until, reason: v.reason }),
    done: (v) => `Snoozed until ${fmtDateShort(v.snoozed_until)}.`,
  }, onChange);
}

export function dismissModal(t, ctx, onChange) {
  const specs = [{ name: 'reason', label: 'Reason', type: 'textarea', required: true, span: 2, hint: 'Dismissing hides this task for this due date only. The reason is kept in the audit log.' }];
  form(t, ctx, {
    title: `Dismiss: ${t.type_name}`, submitLabel: 'Dismiss', specs,
    onSave: (v) => api.setTaskState({ source_type: t.source_type, source_id: t.source_id, type_code: t.state_key, due_date: t.due_date, state: 'dismissed', snoozed_until: null, reason: v.reason }),
    done: 'Task dismissed.',
  }, onChange);
}

export const restoreTask = (t) => api.clearTaskState(t);

function told(t, ctx, onChange, title, save, doneMsg, withRef = true) {
  const specs = [{ name: 'date', label: 'Date the insurer was told', type: 'date', required: true, max: todayStr() }, ...(withRef ? [{ name: 'ref', label: 'Reference given by the insurer', type: 'text', span: 2 }] : [])];
  form(t, ctx, { title, submitLabel: 'Save', specs, values: { date: todayStr() }, onSave: save, done: doneMsg }, onChange);
}

function paidModal(t, ctx, onChange) {
  const specs = [
    { name: 'paid_on', label: 'Paid on', type: 'date', required: true, max: todayStr() },
    { name: 'paid_by', label: 'Paid by', type: 'select', required: true, options: [['company', 'The company'], ['driver', 'The driver']] },
    { name: 'recharge_to_driver', label: 'Recharge this to the driver', type: 'checkbox', span: 2 },
  ];
  form(t, ctx, {
    title: 'Record fine as paid', specs, values: { paid_on: todayStr(), paid_by: 'company' },
    onSave: (v) => api.updateIncident(t.source_id, { paid_on: v.paid_on, paid_by: v.paid_by, recharge_to_driver: !!v.recharge_to_driver }),
    done: 'Fine recorded as paid.',
  }, onChange);
}

function nominatedModal(t, ctx, onChange) {
  const specs = [{ name: 'nominated_on', label: 'Date the driver was named', type: 'date', required: true, max: todayStr() }];
  form(t, ctx, {
    title: 'Record that the driver was named', specs, values: { nominated_on: todayStr() },
    onSave: (v) => api.updateIncident(t.source_id, { nominated_on: v.nominated_on }),
    done: 'Recorded.',
  }, onChange);
}

function extendModal(t, ctx, onChange) {
  const specs = [{ name: 'term_end', label: 'New end date', type: 'date', required: true, min: t.due_date || undefined }];
  form(t, ctx, {
    title: 'Extend the term', specs, values: { term_end: t.due_date ? addDaysISO(t.due_date, 90) : '' },
    intro: 'Moves the lease, rental or finance end date. The task reappears ahead of the new date.',
    onSave: (v) => api.saveVehicle({ term_end: v.term_end }, t.source_id),
    done: (v) => `Term now ends ${fmtDateShort(v.term_end)}.`,
  }, onChange);
}

// ---- Email -----------------------------------------------------------------------
const DEFAULT_BODY = 'Hi {{driver_name}},\n\n{{item_name}} for {{registration}} is due on {{due_date}}. Please speak to the office to arrange it.\n\nThanks,\n{{org_name}}';

export async function emailModal(t, ctx, onChange) {
  const vehicles = ctx?.vehicles || new Map();
  const drivers = ctx?.drivers || new Map();
  let driver = null; let vehicle = null;
  if (t.driver_id) driver = drivers.get(t.driver_id) || await api.getDriver(t.driver_id);
  else if (t.vehicle_id) {
    vehicle = vehicles.get(t.vehicle_id) || await api.getVehicle(t.vehicle_id);
    driver = await api.primaryDriver(t.vehicle_id);
  }
  const tpl = (await api.listTemplates()).find((x) => x.code === 'driver_reminder' && x.channel === 'email') || null;
  const vars = {
    driver_name: driver?.first_name || 'there',
    registration: vehicle ? formatReg(vehicle.registration) : 'your driver record',
    item_name: t.type_name,
    due_date: fmtDate(t.due_date) || 'a date to be confirmed',
    org_name: state.org.name,
    target_label: t.target_label,
    days_remaining: String(t.days_remaining ?? ''),
  };
  const specs = [
    { name: 'to', label: 'To', type: 'email', required: true, span: 2, hint: driver?.email ? '' : (driver ? `${driver.first_name} has no email address on file. Enter one to continue.` : 'No driver is assigned to this vehicle. Enter an email address to continue.') },
    { name: 'subject', label: 'Subject', type: 'text', required: true, span: 2 },
    { name: 'body', label: 'Message', type: 'textarea', rows: 9, required: true, span: 2 },
  ];
  const values = { to: driver?.email || '', subject: merge(tpl?.subject || 'Action needed: {{item_name}} due {{due_date}}', vars), body: merge(tpl?.body || DEFAULT_BODY, vars) };
  const dlg = openModal({
    title: `Email about ${t.type_name}`,
    submitLabel: 'Mark as sent',
    body: html`<p class="muted">This opens your email app with the message ready to send. Once you've sent it, choose Mark as sent to record it on the task.</p>${fieldsHtml(specs, values)}<p><a class="btn" id="mailto-link" href="mailto:">Open in email app</a></p>`,
    onSubmit: async (f) => {
      const v = readForm(f, specs);
      await api.logMessage({
        source_type: t.source_type, source_id: t.source_id, due_date: t.due_date, channel: 'email',
        recipient_kind: driver ? 'driver' : 'other', driver_id: driver?.id ?? null, recipient_address: v.to,
        template_id: tpl?.id ?? null, subject: v.subject, body: v.body, status: 'manual_sent',
        sent_by: state.user.id, sent_at: new Date().toISOString(),
      });
      toast('Recorded as sent.');
      await onChange?.();
    },
  });
  const f = dlg.querySelector('form');
  const link = dlg.querySelector('#mailto-link');
  const refresh = () => {
    link.href = `mailto:${encodeURIComponent(f.elements.to.value)}?subject=${encodeURIComponent(f.elements.subject.value)}&body=${encodeURIComponent(f.elements.body.value)}`;
  };
  f.addEventListener('input', refresh);
  refresh();
}
