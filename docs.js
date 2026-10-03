// Document panel used on vehicles, drivers, incidents and policies.
// Upload from files, a whole folder, the phone camera, a webcam, or by drag and drop.
import * as api from './api.js';
import { can } from './state.js';
import { html, mount, on, openModal, toast, fmtDateShort, fmtInt, loadingHtml } from './ui.js';
import { DOC_CATEGORY_LABEL } from './domain.js';

const MAX_BYTES = 10 * 1024 * 1024;       // matches the storage bucket limit
const SHRINK_ABOVE = 1.5 * 1024 * 1024;   // photos bigger than this are resized before upload
const ALLOWED = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/i;

const sizeText = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

// Phone photos are often 4 to 8 MB. Resize to at most 2400 px on the long side, saved as JPEG.
async function prepare(file) {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size < SHRINK_ABOVE || typeof createImageBitmap !== 'function') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (blob && blob.size < file.size) return new File([blob], `${file.name.replace(/\.\w+$/, '')}.jpg`, { type: 'image/jpeg' });
  } catch { /* fall back to the original file */ }
  return file;
}

// Live webcam (or phone camera) preview with a Capture button.
async function webcam(onFile) {
  if (!navigator.mediaDevices?.getUserMedia) { toast('This browser cannot open the camera here. Use Take photo or Choose files instead.', 'error'); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch {
    toast('The camera is blocked or not available. Allow camera access in the browser, or choose a file instead.', 'error');
    return;
  }
  const dlg = openModal({
    title: 'Take a photo', submitLabel: 'Capture',
    body: html`<video id="cam" class="camera" autoplay playsinline muted></video><p class="hint">Point the camera at the document, then choose Capture.</p>`,
    onSubmit: async () => {
      const video = dlg.querySelector('#cam');
      if (!video.videoWidth) throw new Error('The camera is still starting. Wait a second and try again.');
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      onFile([new File([blob], `photo-${stamp}.jpg`, { type: 'image/jpeg' })]);
    },
  });
  dlg.querySelector('#cam').srcObject = stream;
  const prev = dlg.onclose;
  dlg.onclose = () => { stream.getTracks().forEach((t) => t.stop()); prev?.(); };
}

// target: { vehicle_id } | { driver_id } | { policy_id } | { incident_id }
export async function mountDocuments(container, { target, categories }) {
  mount(container, loadingHtml('Loading documents'));
  let docs = await api.listDocuments(target);
  let category = categories[0];
  const statusItems = [];

  const draw = () => mount(container, html`
    ${can.write ? html`<div class="dropzone" id="dropzone">
      <div class="field"><label for="doc-category">Type of document</label>
        <select id="doc-category">${categories.map((c) => html`<option value="${c}" ${c === category ? 'selected' : ''}>${DOC_CATEGORY_LABEL[c]}</option>`)}</select></div>
      <p class="muted">Drop photos or PDFs here, or add them with a button. Photos are shrunk to fit; each file can be up to 10 MB.</p>
      <div class="doc-buttons">
        <label class="btn">Choose files<input type="file" id="doc-files" multiple accept="image/*,application/pdf" hidden></label>
        <label class="btn">Choose a folder<input type="file" id="doc-folder" multiple webkitdirectory hidden></label>
        <label class="btn">Take photo<input type="file" id="doc-camera" accept="image/*" capture="environment" hidden></label>
        <button type="button" class="btn" data-action="webcam">Use webcam</button>
      </div>
      <ul class="upload-status" id="upload-status" aria-live="polite">${statusItems.map((s) => html`<li class="${s.cls}">${s.text}</li>`)}</ul>
    </div>` : ''}
    ${docs.length ? html`<table class="grid"><thead><tr><th>Document</th><th>Type</th><th>Added</th><th class="num">Size</th><th></th></tr></thead><tbody>
      ${docs.map((d) => html`<tr>
        <td data-label="Document"><button class="task-title" data-action="view" data-id="${d.id}">${d.file_name}</button></td>
        <td data-label="Type">${DOC_CATEGORY_LABEL[d.category] || d.category}</td>
        <td data-label="Added">${fmtDateShort(d.created_at)}</td>
        <td data-label="Size" class="num">${d.size_bytes ? sizeText(d.size_bytes) : ''}</td>
        <td class="act">${can.write ? html`<button class="btn btn-sm" data-action="remove" data-id="${d.id}">Remove</button>` : ''}</td></tr>`)}
    </tbody></table>` : html`<div class="empty"><h2>No documents yet</h2><p>${can.write ? 'Add the first one above.' : 'Nothing has been uploaded here.'}</p></div>`}`);

  async function addFiles(files) {
    for (const original of files) {
      const item = { text: `Uploading ${original.name}`, cls: 'busy' };
      statusItems.unshift(item); redrawStatus();
      try {
        if (original.size === 0) throw new Error('the file is empty');
        const file = await prepare(original);
        if (!ALLOWED.test(file.type)) throw new Error('only photos and PDFs can be uploaded');
        if (file.size > MAX_BYTES) throw new Error(`it is ${sizeText(file.size)}, over the 10 MB limit`);
        await api.uploadDocument({ file, name: file.name, category, target });
        item.text = `Added ${file.name}`; item.cls = 'done';
      } catch (e) {
        item.text = `Could not add ${original.name}: ${e.message}`; item.cls = 'failed';
      }
      redrawStatus();
    }
    docs = await api.listDocuments(target);
    draw(); wire();
  }
  function redrawStatus() {
    const ul = container.querySelector('#upload-status');
    if (ul) mount(ul, html`${statusItems.slice(0, 8).map((s) => html`<li class="${s.cls}">${s.text}</li>`)}`);
  }

  function wire() {
    container.querySelector('#doc-category')?.addEventListener('change', (e) => { category = e.target.value; });
    for (const id of ['doc-files', 'doc-folder', 'doc-camera']) {
      const input = container.querySelector(`#${id}`);
      input?.addEventListener('change', () => { const files = Array.from(input.files || []); input.value = ''; if (files.length) addFiles(files); });
    }
    const dz = container.querySelector('#dropzone');
    if (dz) {
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('over'));
      dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); const files = Array.from(e.dataTransfer?.files || []); if (files.length) addFiles(files); });
    }
    on(container, {
      webcam: () => webcam(addFiles),
      view: async (el) => {
        const d = docs.find((x) => x.id === el.dataset.id);
        if (!d) return;
        const w = window.open('', '_blank');
        try {
          const url = await api.documentUrl(d.storage_path);
          if (w) { w.opener = null; w.location = url; } else window.location.assign(url);
        } catch (e) { w?.close(); toast(e.message, 'error'); }
      },
      remove: (el) => {
        const d = docs.find((x) => x.id === el.dataset.id);
        if (!d) return;
        openModal({
          title: 'Remove this document?', submitLabel: 'Remove', danger: true,
          body: html`<p>${d.file_name} will no longer be listed. The file is kept for the audit trail.</p>`,
          onSubmit: async () => { await api.archiveDocument(d.id); docs = await api.listDocuments(target); draw(); wire(); toast('Document removed.'); },
        });
      },
    });
  }
  draw(); wire();
}
