/**
 * Export a chat reply as PDF, Word or Excel. Everything is created in the browser when the user asks,
 * so nothing is stored on the server.
 */

/** File name from a title: no characters that break a download. */
export const safeName = (t: string) => {
  const ascii = t.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
  return ascii || `bdchat-${new Date().toISOString().slice(0, 10)}`;
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Bold (**text**) and inline code, escaped. */
function inlineHtml(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/** Markdown reply to simple HTML for printing. */
function markdownToHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let code: string[] | null = null;
  let para: string[] = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inlineHtml(para.join('\n')).replace(/\n/g, '<br>')}</p>`); para = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (code) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; }
      else { flushPara(); closeList(); code = []; }
      continue;
    }
    if (code) { code.push(line); continue; }
    const h = line.match(/^\s*(#{1,3})\s+(.*)$/);
    if (h) { flushPara(); closeList(); out.push(`<h${h[1].length + 1}>${inlineHtml(h[2])}</h${h[1].length + 1}>`); continue; }
    if (/^\s*[-*•]\s+/.test(line)) { flushPara(); if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inlineHtml(line.replace(/^\s*[-*•]\s+/, ''))}</li>`); continue; }
    if (/^\s*\d+[.)]\s+/.test(line)) { flushPara(); if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inlineHtml(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>`); continue; }
    if (line.trim() === '') { flushPara(); closeList(); continue; }
    closeList();
    para.push(line);
  }
  if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  flushPara();
  closeList();
  return out.join('\n');
}

export const BANGLA_FONT = 'Noto Sans Bengali';

/** Font file bytes for embedding in Word. */
async function fontBytes(): Promise<Uint8Array> {
  const dataUrl = (await import('@/assets/fonts/NotoSansBengali-Regular.ttf?inline')).default;
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** PDF: built here with a styled layout (cover, coloured headings, page numbers) and downloaded directly. */
export async function exportPdf(text: string, title = 'BD ChatGPT reply') {
  const [{ default: jsPDF }, { default: html2canvas }, fontMod] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
    import('@/assets/fonts/NotoSansBengali-Regular.ttf?inline'),
  ]);

  const fontStyle = document.createElement('style');
  fontStyle.textContent = `@font-face { font-family: 'NotoBn'; src: url('${fontMod.default}') format('truetype'); }`;
  document.head.appendChild(fontStyle);

  const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dhaka' }).format(new Date());
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#ffffff;';
  host.innerHTML = `<style>
    .pdf-root { font-family: 'NotoBn', sans-serif; color: #1f1e1d; font-size: 13px; line-height: 1.85; padding: 0 40px; }
    .cover { border-bottom: 3px solid #c96442; padding: 40px 0 18px; margin-bottom: 22px; }
    .brand { color: #c96442; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; font-size: 11px; }
    .cover h1 { font-size: 26px; margin: 10px 0 6px; color: #1f1e1d; }
    .cover .date { color: #8a8781; font-size: 12px; }
    .body h1, .body h2 { font-size: 19px; color: #c96442; margin: 24px 0 8px; border-bottom: 1px solid #ebe7de; padding-bottom: 4px; }
    .body h3 { font-size: 16px; color: #1f1e1d; margin: 18px 0 6px; }
    .body h4 { font-size: 14px; color: #8a4a2f; margin: 14px 0 4px; }
    .body p { margin: 8px 0; }
    .body ul, .body ol { padding-left: 22px; margin: 6px 0; }
    .body li { margin: 3px 0; }
    .body strong { color: #1f1e1d; }
    .body blockquote { border-left: 3px solid #c96442; padding-left: 12px; color: #4a4843; margin: 10px 0; }
    .body pre { background: #f5f3ec; border-radius: 6px; padding: 10px 12px; white-space: pre-wrap; font-family: monospace; font-size: 12px; }
    .body code { background: #f5f3ec; border-radius: 4px; padding: 1px 4px; font-family: monospace; font-size: 12px; }
    .body table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    .body th { background: #f5f3ec; text-align: left; }
    .body th, .body td { border: 1px solid #e3dfd4; padding: 6px 8px; }
  </style>
  <div class="pdf-root">
    <div class="cover"><div class="brand">BD ChatGPT</div><h1>${esc(title)}</h1><div class="date">${date}</div></div>
    <div class="body">${markdownToHtml(text)}</div>
  </div>`;
  document.body.appendChild(host);

  try {
    await document.fonts.ready;
    const root = host.querySelector('.pdf-root') as HTMLElement;
    // Draw the page as an image in the browser (keeps the Bangla font exact), then cut it into A4 pages.
    const canvas = await html2canvas(root, { scale: 2, backgroundColor: '#ffffff', useCORS: true, windowWidth: 794 });
    const ctx = canvas.getContext('2d');
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const left = 36;
    const top = 36;
    const contentW = 595.28 - left * 2;
    const contentH = 841.89 - top - 48;
    const pxPerPt = canvas.width / contentW;
    const slicePx = Math.floor(contentH * pxPerPt);
    // Cut at a blank row near the page bottom so no line is split across two pages.
    const blankRow = (row: number) => {
      if (!ctx) return true;
      const px = ctx.getImageData(0, row, canvas.width, 1).data;
      for (let i = 0; i < px.length; i += 16) {
        if (px[i] < 235 || px[i + 1] < 235 || px[i + 2] < 235) return false;
      }
      return true;
    };
    let y = 0;
    let pageNo = 0;
    while (y < canvas.height) {
      let h = Math.min(slicePx, canvas.height - y);
      if (y + h < canvas.height) {
        for (let back = 0; back < 320 && h - back > slicePx / 2; back++) {
          if (blankRow(y + h - back)) { h = h - back; break; }
        }
      }
      const part = document.createElement('canvas');
      part.width = canvas.width;
      part.height = h;
      part.getContext('2d')?.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (pageNo > 0) pdf.addPage();
      pageNo++;
      pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', left, top, contentW, h / pxPerPt);
      y += h;
    }
    const pages = pdf.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      pdf.setPage(i);
      pdf.setFontSize(9);
      pdf.setTextColor('#8a8781');
      pdf.text(`Page ${i} of ${pages}`, 297, 818, { align: 'center' });
    }
    const file = title.replace(/[^\p{L}\p{N}\- ]+/gu, '').trim().slice(0, 60) || 'bdchat-reply';
    pdf.save(`${file}.pdf`);
  } finally {
    host.remove();
    fontStyle.remove();
  }
}

/** Word (.docx). Noto Sans Bengali is embedded when possible; if embedding fails, the file is still created. */
export async function exportWord(text: string, title = 'BD ChatGPT reply') {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import('docx');
  const FONT = BANGLA_FONT;
  const runs = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(part =>
    part.startsWith('**') && part.endsWith('**')
      ? new TextRun({ text: part.slice(2, -2), bold: true, font: FONT })
      : new TextRun({ text: part, font: FONT }));

  const buildChildren = () => {
    const children: InstanceType<typeof Paragraph>[] = [];
    for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
      const line = raw.replace(/`/g, '');
      const h = line.match(/^\s*(#{1,3})\s+(.*)$/);
      if (h) {
        const level = h[1].length === 1 ? HeadingLevel.HEADING_1 : h[1].length === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
        children.push(new Paragraph({ heading: level, children: runs(h[2]) }));
      } else if (/^\s*[-*•]\s+/.test(line)) {
        children.push(new Paragraph({ bullet: { level: 0 }, children: runs(line.replace(/^\s*[-*•]\s+/, '')) }));
      } else {
        children.push(new Paragraph({ children: line.trim() ? runs(line) : [] }));
      }
    }
    return children;
  };

  let blob: Blob;
  try {
    const data = await fontBytes();
    blob = await Packer.toBlob(new Document({
      creator: 'BD ChatGPT', title,
      fonts: [{ name: FONT, data: data as never }],
      sections: [{ children: buildChildren() }],
    }));
  } catch (err) {
    console.warn('Word font embedding failed, saving without it', err);
    blob = await Packer.toBlob(new Document({
      creator: 'BD ChatGPT', title,
      sections: [{ children: buildChildren() }],
    }));
  }
  saveBlob(blob, `${safeName(title)}.docx`);
}

/** Excel (.xlsx). Markdown tables become sheet rows; other lines go one per row. */
export async function exportExcel(text: string) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Reply');
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let hasTable = false;
  for (const line of lines) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|?\s*:?-{2,}/.test(line)) continue; // separator row
      hasTable = true;
      ws.addRow(line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim().replace(/\*\*/g, '')));
    } else if (!hasTable && line.trim()) {
      ws.addRow([line.replace(/\*\*/g, '').replace(/^\s*#{1,3}\s+/, '')]);
    }
  }
  await saveWorkbook(wb, ws, 'bdchat');
}

/** Excel from rows (used by the download card). */
export async function exportExcelRows(rows: string[][], title = 'bdchat') {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet');
  rows.forEach(r => ws.addRow(r));
  await saveWorkbook(wb, ws, title);
}

async function saveWorkbook(wb: { xlsx: { writeBuffer: () => Promise<ArrayBuffer> } }, ws: { columns: { width?: number }[]; eachRow: (fn: (row: { eachCell: (fn: (cell: { font?: unknown; alignment?: unknown }) => void) => void }) => void) => void }, title: string) {
  ws.columns.forEach(col => { col.width = 24; });
  ws.eachRow(row => {
    row.eachCell(cell => {
      cell.font = { name: BANGLA_FONT, size: 11 };
      cell.alignment = { wrapText: true, vertical: 'top' };
    });
  });
  const buffer = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeName(title)}.xlsx`);
}
