import { Fragment, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * Small, safe Markdown renderer for chat replies.
 * Supports headings, **bold**, *italic*, `code`, fenced code blocks, bullet and numbered lists, and links.
 * It builds React elements only, so no raw HTML from the model is ever inserted.
 */

const URL_PATTERN = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/g;

/** Remove tracking parameters (utm_*) from a link. */
function cleanUrl(url: string): string {
  return url.replace(/[?&]utm_[^&#]*/gi, '').replace(/\?&/, '?').replace(/\?$/, '');
}

function linkText(text: string, key: string): ReactNode[] {
  return text.split(URL_PATTERN).map((part, i) => {
    if (i % 2 === 0) {
      return <Fragment key={`${key}-${i}`}>{part}</Fragment>;
    }
    const trailing = part.match(/[.,;:!?)\]]+$/)?.[0] ?? '';
    const url = cleanUrl(trailing ? part.slice(0, -trailing.length) : part);
    const href = /^https?:\/\//.test(url) ? url : `https://${url}`;
    return (
      <Fragment key={`${key}-${i}`}>
        <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-[#c96442] underline underline-offset-2 hover:text-[#a8502f]">
          {url}
        </a>
        {trailing}
      </Fragment>
    );
  });
}

/** Code block with its own Copy button. Same background as the chat, so it blends in. */
function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked by the browser */
    }
  };
  return (
    <div className="overflow-hidden rounded-xl border border-[#e8e6dc] bg-[#faf9f5]">
      <div className="flex justify-end px-2 pt-2">
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-[#6b6a64] transition hover:bg-[#f0eee6]"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-words px-4 pb-4 text-[14px] leading-6 text-[#1f1e1d]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Inline formatting: `code`, **bold**, *italic*, then links in the rest. */
function inline(text: string, key: string): ReactNode[] {
  const tokens = text.split(/(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g);
  return tokens.map((token, i) => {
    const k = `${key}-${i}`;
    const md = token.match(/^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (md) {
      return (
        <a key={k} href={cleanUrl(md[2])} target="_blank" rel="noopener noreferrer" className="text-[#c96442] underline underline-offset-2 hover:text-[#a8502f]">
          {md[1]}
        </a>
      );
    }
    if (/^`[^`\n]+`$/.test(token)) {
      return <code key={k} className="rounded bg-[#f0eee6] px-1.5 py-0.5 font-mono text-[13px] text-[#1f1e1d]">{token.slice(1, -1)}</code>;
    }
    if (/^\*\*[^*\n]+\*\*$/.test(token)) {
      return <strong key={k} className="font-semibold">{linkText(token.slice(2, -2), k)}</strong>;
    }
    if (/^\*[^*\n]+\*$/.test(token)) {
      return <em key={k}>{linkText(token.slice(1, -1), k)}</em>;
    }
    return <Fragment key={k}>{linkText(token, k)}</Fragment>;
  });
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const k = `b${key++}`;

    // Fenced code block
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(<CodeBlock key={k} code={code.join('\n')} />);
      continue;
    }

    // Heading
    const heading = line.match(/^\s*(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const cls = level === 1 ? 'text-[22px] font-semibold leading-snug pt-3' : level === 2 ? 'text-[19px] font-semibold pt-2' : 'text-[16px] font-semibold pt-1';
      blocks.push(<div key={k} className={`${cls} text-[#1f1e1d]`}>{inline(heading[2], k)}</div>);
      i++;
      continue;
    }

    // Table: header row, separator row, then body rows
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      const header = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(cells(lines[i]));
        i++;
      }
      blocks.push(
        <div key={k} className="overflow-x-auto rounded-xl border border-[#e8e6dc]">
          <table className="w-full border-collapse text-left text-[14px] leading-6">
            <thead className="bg-[#f5f4ee]">
              <tr>
                {header.map((h, n) => <th key={n} className="border-b border-[#e8e6dc] px-3 py-2 font-semibold">{inline(h, `${k}-h${n}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-[#f0eee6] last:border-0">
                  {r.map((c, ci) => <td key={ci} className="px-3 py-2 align-top">{inline(c, `${k}-${ri}-${ci}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Bullet list
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={k} className="ml-5 list-disc space-y-1.5 marker:text-[#9c9a92]">
          {items.map((item, n) => <li key={n}>{inline(item, `${k}-${n}`)}</li>)}
        </ul>,
      );
      continue;
    }

    // Numbered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={k} className="ml-5 list-decimal space-y-1.5 marker:text-[#6b6a64]">
          {items.map((item, n) => <li key={n}>{inline(item, `${k}-${n}`)}</li>)}
        </ol>,
      );
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: consecutive plain lines, shown with line breaks
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*(```|#{1,3}\s|[-*•]\s|\d+[.)]\s)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={k} className="whitespace-pre-line">
        {inline(para.join('\n'), k)}
      </p>,
    );
  }

  return <div className="space-y-4 text-[16px] leading-7 text-[#1f1e1d]">{blocks}</div>;
}
