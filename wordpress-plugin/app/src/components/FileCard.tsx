import { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Presentation } from 'lucide-react';
import { downloadReplyFile, type ReplyFile } from '@/lib/files';
import { exportPdf } from '@/lib/export';

const META = {
  slides: { label: 'PowerPoint (.pptx)', Icon: Presentation },
  document: { label: 'Word (.docx)', Icon: FileText },
  sheet: { label: 'Excel (.xlsx)', Icon: FileSpreadsheet },
} as const;

function detail(file: ReplyFile): string {
  if (file.kind === 'slides') return `${file.slides.length + 1} slides`;
  if (file.kind === 'sheet') return `${file.rows.length} rows`;
  return 'Document';
}

/** Download card shown under a reply that prepared a file. */
export function FileCard({ file }: { file: ReplyFile }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { label, Icon } = META[file.kind];

  const download = async (asPdf = false) => {
    setBusy(true);
    setError('');
    try {
      if (asPdf && file.kind === 'document') {
        await exportPdf(file.content, file.title);
      } else {
        await downloadReplyFile(file);
      }
    } catch (err) {
      console.error('File export failed', err);
      setError('Could not create the file. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex max-w-sm items-center gap-3 rounded-2xl border border-[#e8e6dc] bg-white p-3 shadow-sm">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f0eee6] text-[#c96442]">
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-[#1f1e1d]">{file.title}</div>
        <div className="text-xs text-[#6b6a64]">{label} · {detail(file)}</div>
        {error && <div className="text-xs text-red-600">{error}</div>}
      </div>
      <div className="flex shrink-0 flex-col gap-1.5">
        <button
          onClick={() => download(false)}
          disabled={busy}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-[#c96442] px-3 text-sm font-semibold text-white transition hover:bg-[#a8502f] disabled:opacity-50"
        >
          <Download size={15} />
          {busy ? 'Preparing…' : file.kind === 'document' ? 'Word' : 'Download'}
        </button>
        {file.kind === 'document' && (
          <button
            onClick={() => download(true)}
            disabled={busy}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-[#e8e6dc] px-3 text-xs font-semibold text-[#1f1e1d] transition hover:bg-[#f0eee6] disabled:opacity-50"
          >
            PDF
          </button>
        )}
      </div>
    </div>
  );
}
