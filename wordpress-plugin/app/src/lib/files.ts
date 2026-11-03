import { BANGLA_FONT, exportExcelRows, exportWord } from '@/lib/export';

/** A file the assistant prepared in a reply, shown as a download card. */
export type ReplyFile =
  | { kind: 'slides'; title: string; slides: { title: string; bullets: string[]; notes?: string }[] }
  | { kind: 'document'; title: string; content: string }
  | { kind: 'sheet'; title: string; rows: string[][] };

const BLOCK = /```(slides|document|sheet)[ \t]*\n([\s\S]*?)```/g;

/** Split a reply into normal text and file blocks. A block that is not valid JSON stays in the text. */
export function parseFileBlocks(text: string): { text: string; files: ReplyFile[] } {
  const files: ReplyFile[] = [];
  const rest = text.replace(BLOCK, (whole, kind: string, body: string) => {
    try {
      if (kind === 'document') {
        files.push({ kind: 'document', title: 'Document', content: body.trim() });
        return '';
      }
      const data = JSON.parse(body.trim());
      if (kind === 'slides' && Array.isArray(data?.slides)) {
        files.push({
          kind: 'slides',
          title: String(data.title || 'Presentation'),
          slides: data.slides.map((s: { title?: unknown; bullets?: unknown; notes?: unknown }) => ({
            title: String(s.title ?? ''),
            bullets: Array.isArray(s.bullets) ? s.bullets.map(String) : [],
            notes: s.notes ? String(s.notes) : undefined,
          })),
        });
        return '';
      }
      if (kind === 'sheet' && Array.isArray(data?.rows)) {
        files.push({
          kind: 'sheet',
          title: String(data.title || 'Sheet'),
          rows: data.rows.map((r: unknown[]) => (Array.isArray(r) ? r.map(c => String(c ?? '')) : [String(r)])),
        });
        return '';
      }
    } catch {
      /* not valid, keep it as text */
    }
    return whole;
  });
  return { text: rest.replace(/\n{3,}/g, '\n\n').trim(), files };
}

/** PowerPoint (.pptx) with Noto Sans Bengali text. */
export async function buildPptx(file: Extract<ReplyFile, { kind: 'slides' }>): Promise<Blob> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = file.title;

  const cover = pptx.addSlide();
  cover.background = { color: 'FAF9F5' };
  cover.addText(file.title, { x: 0.8, y: 2.6, w: 11.7, h: 1.6, fontFace: BANGLA_FONT, fontSize: 40, bold: true, color: '1F1E1D', align: 'left' });

  for (const item of file.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addText(item.title, { x: 0.6, y: 0.4, w: 12.1, h: 1.0, fontFace: BANGLA_FONT, fontSize: 30, bold: true, color: '1F1E1D' });
    if (item.bullets.length) {
      slide.addText(
        item.bullets.map(b => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.8, y: 1.7, w: 11.7, h: 5.2, fontFace: BANGLA_FONT, fontSize: 20, color: '1F1E1D', valign: 'top', paraSpaceAfter: 10 },
      );
    }
    if (item.notes) slide.addNotes(item.notes);
  }
  return (await pptx.write({ outputType: 'blob' })) as Blob;
}

/** Run the right builder for a file and save it. */
export async function downloadReplyFile(file: ReplyFile) {
  if (file.kind === 'document') {
    await exportWord(file.content, file.title);
  } else if (file.kind === 'sheet') {
    await exportExcelRows(file.rows, file.title);
  } else {
    const blob = await buildPptx(file);
    const { saveBlob, safeName } = await import('@/lib/export');
    saveBlob(blob, `${safeName(file.title)}.pptx`);
  }
}
