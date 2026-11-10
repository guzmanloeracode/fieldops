import type { AssistantRecordRef } from "@fieldops/shared";
import Link from "next/link";
import type { ReactNode } from "react";

// The small Markdown subset Ask FieldOps answers in (PRD §9.3): paragraphs, "-" and "1." lists, **bold**, `code`
// and simple tables. Everything renders as React text nodes, so raw HTML in an answer stays text. Links come only
// from the app: job numbers, and the names of records the tools returned (customers, invoices). Markdown links in
// the answer are shown as their text, so a model can't point anywhere.

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface LinkTarget {
  href: string;
  type: AssistantRecordRef["type"];
}

/** Record names to link: every ref with a page of its own, longest label first. */
function linkTargets(refs: AssistantRecordRef[]): Map<string, LinkTarget> {
  const out = new Map<string, LinkTarget>();
  for (const r of refs) {
    if (r.label.trim().length < 3 || r.type === "expense") continue;
    if (!out.has(r.label)) out.set(r.label, { href: r.href, type: r.type });
  }
  return out;
}

function recordLink(label: string, target: LinkTarget, key: string): ReactNode {
  return (
    <Link
      key={key}
      href={target.href}
      prefetch={false}
      data-testid="assistant-record-link"
      data-record-type={target.type}
      className="text-primary font-medium underline underline-offset-2"
    >
      {label}
    </Link>
  );
}

/** Links job numbers and known record names inside a run of plain text. */
function linkify(text: string, targets: Map<string, LinkTarget>, key: string): ReactNode[] {
  const labels = [...targets.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  const pattern = new RegExp(`(?<![\\w-])(${[...labels, "JOB-\\d{6}"].join("|")})(?![\\w-])`, "g");
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(pattern)) {
    const label = m[1]!;
    if (m.index > last) out.push(text.slice(last, m.index));
    const target = targets.get(label) ?? { href: `/jobs/${label}`, type: "job" as const };
    out.push(recordLink(label, target, `${key}-l${i++}`));
    last = m.index + label.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Bold, code and Markdown links (shown as their text), then record links in the plain parts. */
function inline(text: string, targets: Map<string, LinkTarget>, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const token = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\([^)]*\)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(token)) {
    if (m.index > last) out.push(...linkify(text.slice(last, m.index), targets, `${key}-t${i}`));
    if (m[1] !== undefined) {
      out.push(<strong key={`${key}-b${i}`}>{linkify(m[1], targets, `${key}-b${i}`)}</strong>);
    } else if (m[2] !== undefined) {
      out.push(
        <code key={`${key}-c${i}`} className="bg-muted rounded px-1 text-[0.9em]">
          {m[2]}
        </code>,
      );
    } else {
      out.push(...linkify(m[3]!, targets, `${key}-a${i}`));
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) out.push(...linkify(text.slice(last), targets, `${key}-t${i}`));
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
const isDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

/** Splits an answer into blocks. Tolerates a partly streamed answer. */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    if (line.trim().startsWith("|") && i + 1 < lines.length && isDivider(lines[i + 1]!)) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(cells(lines[i++]!));
      i--;
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      const prev = blocks.at(-1);
      const item = (bullet ?? numbered)![1]!;
      if (prev && prev.kind === kind) prev.items.push(item);
      else blocks.push({ kind, items: [item] });
      continue;
    }
    // Headings aren't part of the subset; show them as bold paragraphs.
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const content = heading ? `**${heading[1]}**` : line;
    const prev = blocks.at(-1);
    if (prev?.kind === "p" && lines[i - 1]?.trim()) prev.lines.push(content);
    else blocks.push({ kind: "p", lines: [content] });
  }
  return blocks;
}

export function MarkdownLite({ text, refs }: { text: string; refs: AssistantRecordRef[] }) {
  const targets = linkTargets(refs);
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {parseBlocks(text).map((b, i) => {
        const key = `b${i}`;
        if (b.kind === "p") {
          return (
            <p key={key}>
              {b.lines.flatMap((l, j) => [
                ...(j > 0 ? [<br key={`${key}-br${j}`} />] : []),
                ...inline(l, targets, `${key}-${j}`),
              ])}
            </p>
          );
        }
        if (b.kind === "table") {
          return (
            <div key={key} className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr>
                    {b.head.map((h, j) => (
                      <th key={j} scope="col" className="border-b px-2 py-1 font-semibold">
                        {inline(h, targets, `${key}-h${j}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j}>
                      {r.map((c, k) => (
                        <td key={k} className="border-b px-2 py-1">
                          {inline(c, targets, `${key}-r${j}-${k}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        const List = b.kind;
        return (
          <List
            key={key}
            className={List === "ul" ? "list-disc space-y-1 pl-5" : "list-decimal space-y-1 pl-5"}
          >
            {b.items.map((item, j) => (
              <li key={j}>{inline(item, targets, `${key}-i${j}`)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

/** The answer as plain text, for the screen reader announcement. */
export function plainText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|?\s*:?-{2,}.*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+\n/g, "\n")
    .trim();
}
