import type { ReactNode } from "react";

// A chat bubble is not a document. The agent's house style is **bold**, the odd
// bullet list and the occasional link — so that is exactly what this renders,
// and anything else stays literal text. Forty lines instead of a parser, and no
// dangerouslySetInnerHTML: every node below is React's own.

const INLINE =
  /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s)]+)/g;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    const k = `${key}-${i}`;
    if (/^(\*\*|__)[\s\S]+\1$/.test(part)) return <strong key={k} className="font-semibold">{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$|^_[^_]+_$/.test(part)) return <em key={k}>{part.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(part)) return <code key={k} className="rounded bg-black/5 px-1 py-0.5 font-mono text-[13px] dark:bg-white/10">{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    const href = link ? link[2] : /^https?:\/\//.test(part) ? part : null;
    if (href) return <a key={k} href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{link ? link[1] : part}</a>;
    return <span key={k}>{part}</span>;
  });
}

/** Blocks: runs of `- x` / `1. x` become one list, everything else a paragraph. */
export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    const { items, ordered } = list;
    out.push(
      <Tag key={`l${out.length}`} className={`my-1 space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
        {items.map((it, i) => <li key={i}>{inline(it, `${out.length}-${i}`)}</li>)}
      </Tag>,
    );
    list = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    // A heading in a bubble is just an emphatic line.
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) { out.push(<p key={`h${out.length}`} className="font-semibold">{inline(heading[1], `h${out.length}`)}</p>); continue; }
    if (line.trim()) out.push(<p key={`p${out.length}`} className="whitespace-pre-wrap">{inline(line, `p${out.length}`)}</p>);
  }
  flush();

  return <>{out}</>;
}
