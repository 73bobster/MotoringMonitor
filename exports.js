// Downloadable reports without any library: an Excel workbook (.xlsx) and a PDF, both built here.
//
// A report model looks like:
//   { title, subtitle, columns: [{ key, label, type: 'text' | 'date' | 'money' | 'int' | 'number', width }], rows: [{ key: value }], totals: { key: value } | null }
// Dates are ISO strings (yyyy-mm-dd). Money and numbers are numbers.

const enc = new TextEncoder();
const pad = (n, w = 2) => String(n).padStart(w, '0');

// ---- ZIP (stored, no compression) ----------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zipStore(files) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = []; const central = []; let offset = 0;
  const u16 = (v) => [v & 0xFF, (v >>> 8) & 0xFF];
  const u32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
  for (const f of files) {
    const name = enc.encode(f.name); const data = f.data; const crc = crc32(data);
    const local = Uint8Array.from([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
    parts.push(local, name, data);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

// ---- XLSX ------------------------------------------------------------------------------
const xml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = (i) => { let n = i + 1; let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - m) / 26); } return s; };
const serial = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };

// Cell styles (indexes into cellXfs in STYLES below)
const S = { title: 1, header: 2, text: 3, date: 4, money: 5, int: 6, number: 7, totalText: 8, totalMoney: 9, totalInt: 10, totalNumber: 11, note: 12 };
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="dd\\ mmm\\ yyyy"/><numFmt numFmtId="165" formatCode="&quot;£&quot;#,##0.00"/><numFmt numFmtId="166" formatCode="#,##0.0"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF555555"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF0066"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F1F1"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFDDDDDD"/></left><right style="thin"><color rgb="FFDDDDDD"/></right><top style="thin"><color rgb="FFDDDDDD"/></top><bottom style="thin"><color rgb="FFDDDDDD"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="165" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="3" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="166" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cell(ref, value, type, total) {
  const style = { text: S.text, date: S.date, money: S.money, int: S.int, number: S.number }[type] ?? S.text;
  const totalStyle = { text: S.totalText, date: S.totalText, money: S.totalMoney, int: S.totalInt, number: S.totalNumber }[type] ?? S.totalText;
  const s = total ? totalStyle : style;
  if (value === null || value === undefined || value === '') return `<c r="${ref}" s="${s}"/>`;
  if (type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(value))) return `<c r="${ref}" s="${s}"><v>${serial(value)}</v></c>`;
  if (['money', 'int', 'number'].includes(type) && Number.isFinite(Number(value))) return `<c r="${ref}" s="${s}"><v>${Number(value)}</v></c>`;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

export function buildXlsx(model) {
  const cols = model.columns;
  const rows = [];
  const text = (r, c, v, style) => `<c r="${colName(c)}${r}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  let r = 1;
  rows.push(`<row r="${r}">${text(r, 0, model.title, S.title)}</row>`); r += 1;
  if (model.subtitle) { rows.push(`<row r="${r}">${text(r, 0, model.subtitle, S.note)}</row>`); r += 1; }
  r += 1;
  const headerRow = r;
  rows.push(`<row r="${r}" ht="30" customHeight="1">${cols.map((c, i) => text(r, i, c.label, S.header)).join('')}</row>`); r += 1;
  for (const row of model.rows) { rows.push(`<row r="${r}">${cols.map((c, i) => cell(`${colName(i)}${r}`, row[c.key], c.type, false)).join('')}</row>`); r += 1; }
  if (model.totals) { rows.push(`<row r="${r}">${cols.map((c, i) => cell(`${colName(i)}${r}`, model.totals[c.key], c.type, true)).join('')}</row>`); r += 1; }
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(8, Math.min(60, (c.width || 14) + 2))}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A${headerRow}:${colName(cols.length - 1)}${headerRow + model.rows.length}"/><pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToHeight="0"/></worksheet>`;
  const sheetName = xml(String(model.title).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report');
  const files = [
    { name: '[Content_Types].xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
    { name: '_rels/.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: enc.encode(STYLES) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet) },
  ];
  return zipStore(files);
}

// ---- PDF (Courier, so every character is the same width and tables line up exactly) ---------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function cellText(v, type) {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'date') { if (!/^\d{4}-\d{2}-\d{2}/.test(String(v))) return String(v); const [y, m, d] = String(v).slice(0, 10).split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; }
  if (type === 'money') return `£${Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (type === 'int') return Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 });
  if (type === 'number') return Number(v).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return String(v);
}
// PDF text is single-byte Windows-1252: keep Latin-1 characters and swap the common extras.
const latin = (s) => String(s).replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...').replace(/[^\u0020-\u00FF]/g, '?');
const esc = (s) => latin(s).replace(/([\\()])/g, '\\$1');
function wrap(text, width) {
  const words = latin(text).split(/\s+/).filter(Boolean); const lines = []; let line = '';
  for (const w of words) {
    let word = w;
    while (word.length > width) { if (line) { lines.push(line); line = ''; } lines.push(word.slice(0, width)); word = word.slice(width); }
    if (!line) line = word; else if ((line + ' ' + word).length <= width) line += ` ${word}`; else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export function buildPdf(model, generated = new Date()) {
  const W = 842; const H = 595; const M = 36; const FS = 8; const CW = FS * 0.6; const LH = 10.5;
  const avail = Math.floor((W - 2 * M) / CW); // characters per line
  const cols = model.columns.map((c) => ({ ...c, w: Math.max(5, c.width || 12) }));
  const gutter = 2;
  let total = cols.reduce((s, c) => s + c.w, 0) + gutter * (cols.length - 1);
  if (total > avail) { const k = (avail - gutter * (cols.length - 1)) / cols.reduce((s, c) => s + c.w, 0); cols.forEach((c) => { c.w = Math.max(4, Math.floor(c.w * k)); }); total = cols.reduce((s, c) => s + c.w, 0) + gutter * (cols.length - 1); }
  const xs = []; let x = M; for (const c of cols) { xs.push(x); x += (c.w + gutter) * CW; }
  const tableW = total * CW;

  const pages = []; let ops = []; let y = H - M;
  const newPage = () => { ops = []; pages.push(ops); y = H - M; };
  const text = (px, py, s, font = 'F1', size = FS, color = '0 g') => ops.push(`${color} BT /${font} ${size} Tf ${px.toFixed(2)} ${py.toFixed(2)} Td (${esc(s)}) Tj ET`);
  const drawHeader = () => {
    const heads = cols.map((c) => wrap(c.label, c.w).slice(0, 2));
    const n = Math.max(...heads.map((h) => h.length));
    ops.push(`1 0 0.4 rg ${M} ${(y - n * LH - 2.5).toFixed(2)} ${tableW.toFixed(2)} ${(n * LH + 5).toFixed(2)} re f`);
    cols.forEach((c, i) => heads[i].forEach((lab, k) => {
      const px = ['money', 'int', 'number'].includes(c.type) ? xs[i] + (c.w - lab.length) * CW : xs[i];
      text(px, y - 9 - k * LH, lab, 'F2', FS, '1 g');
    }));
    y -= n * LH + 7;
  };
  newPage();
  text(M, y - 12, model.title, 'F2', 15); y -= 20;
  if (model.subtitle) { text(M, y - 8, model.subtitle, 'F1', 9, '0.35 g'); y -= 16; }
  y -= 6;
  drawHeader();
  const drawRow = (row, isTotal) => {
    const cells = cols.map((c) => {
      const raw = isTotal ? model.totals[c.key] : row[c.key];
      const t = cellText(raw, c.type);
      return ['money', 'int', 'number', 'date'].includes(c.type) ? [t.slice(-c.w)] : wrap(t, c.w);
    });
    const lines = Math.max(...cells.map((c) => c.length));
    const h = lines * LH + 4;
    if (y - h < M + 18) { newPage(); drawHeader(); }
    if (isTotal) ops.push(`0.945 g ${M} ${(y - h + 1).toFixed(2)} ${tableW.toFixed(2)} ${h.toFixed(2)} re f`);
    cells.forEach((lns, i) => lns.forEach((ln, k) => {
      const right = ['money', 'int', 'number'].includes(cols[i].type);
      text(right ? xs[i] + (cols[i].w - ln.length) * CW : xs[i], y - 8 - k * LH, ln, isTotal ? 'F2' : 'F1');
    }));
    y -= h;
    ops.push(`0.88 G 0.4 w ${M} ${y.toFixed(2)} m ${(M + tableW).toFixed(2)} ${y.toFixed(2)} l S`);
  };
  if (!model.rows.length) { text(M, y - 10, 'Nothing to show for this selection.', 'F1', 9, '0.35 g'); y -= 18; }
  model.rows.forEach((r) => drawRow(r, false));
  if (model.totals) drawRow(null, true);

  const stamp = `${generated.getDate()} ${MONTHS[generated.getMonth()]} ${generated.getFullYear()}`;
  const count = pages.length;
  pages.forEach((p, i) => p.push(`0.35 g BT /F1 7 Tf ${M} 20 Td (${esc(`Generated ${stamp}`)}) Tj ET`, `0.35 g BT /F1 7 Tf ${W - M - 40} 20 Td (${esc(`Page ${i + 1} of ${count}`)}) Tj ET`));

  // objects: 1 catalog, 2 pages, 3 font, 4 bold font, then (page, contents) pairs
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>';
  const kids = [];
  pages.forEach((p, i) => {
    const pn = 5 + i * 2; const cn = pn + 1; kids.push(`${pn} 0 R`);
    objs[pn] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cn} 0 R >>`;
    const stream = p.join('\n');
    objs[cn] = { stream };
  });
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  objs[5 + pages.length * 2] = `<< /Title (${esc(model.title)}) /Producer (FleetMonitor) >>`;
  const infoNum = 5 + pages.length * 2;

  const chunks = []; const offsets = []; let pos = 0;
  const push = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF; chunks.push(b); pos += b.length; };
  push('%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n');
  for (let n = 1; n <= infoNum; n++) {
    offsets[n] = pos;
    const o = objs[n];
    if (o && o.stream !== undefined) push(`${n} 0 obj\n<< /Length ${o.stream.length} >>\nstream\n${o.stream}\nendstream\nendobj\n`);
    else push(`${n} 0 obj\n${o}\nendobj\n`);
  }
  const xref = pos;
  let table = `xref\n0 ${infoNum + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= infoNum; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(`${table}trailer\n<< /Size ${infoNum + 1} /Root 1 0 R /Info ${infoNum} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ---- Saving ---------------------------------------------------------------------------------
export function save(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const downloadExcel = (model, filename) => save(buildXlsx(model), `${filename}.xlsx`, XLSX_MIME);
export const downloadPdf = (model, filename) => save(buildPdf(model), `${filename}.pdf`, 'application/pdf');
