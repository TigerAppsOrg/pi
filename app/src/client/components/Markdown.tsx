import { Fragment, type ReactNode } from "react";
import { IconExternal } from "./Icons";

/**
 * A deliberately small markdown renderer for chat prose: paragraphs, lists
 * (nested), headings, tables, blockquotes, rules, fenced code, and inline
 * bold/italic/strike/code/links. No raw HTML, no dependencies.
 */

const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const ORDERED_RE = /^\s*\d+[.)]\s/;
const HR_RE = /^\s*([-*_])\s*(?:\1\s*){2,}$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
/** A separator row: `|---|:--:|`, with or without the outer pipes. */
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

type Align = "left" | "center" | "right";

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern =
    /(\*\*[^*]+\*\*|~~[^~]+~~|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("~~")) {
      out.push(<del key={key}>{tok.slice(2, -2)}</del>);
    } else if (tok.startsWith("`")) {
      out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("[")) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (lm) {
        const external = /^https?:\/\//i.test(lm[2]);
        out.push(
          <a key={key} href={lm[2]} target="_blank" rel="noreferrer">
            {lm[1]}
            {external && <IconExternal size={12} />}
          </a>
        );
      } else out.push(tok);
    } else {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = m.index! + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ── lists ────────────────────────────────────────────────────────── */

type ListRow = { indent: number; ordered: boolean; text: string };
type ListNode = { ordered: boolean; items: ListItem[] };
type ListItem = { text: string; child: ListNode | null };

/** Reads one list (and everything nested under it) starting at `start`. */
function buildList(
  rows: ListRow[],
  start: number,
  indent: number
): [ListNode, number] {
  const ordered = rows[start].ordered;
  const items: ListItem[] = [];
  let i = start;
  while (i < rows.length && rows[i].indent >= indent) {
    if (rows[i].indent > indent) {
      const [child, next] = buildList(rows, i, rows[i].indent);
      if (items.length) items[items.length - 1].child = child;
      i = next;
      continue;
    }
    // A switch between bullets and numbers at the same depth starts a new list.
    if (rows[i].ordered !== ordered) break;
    items.push({ text: rows[i].text, child: null });
    i++;
  }
  return [{ ordered, items }, i];
}

function renderList(node: ListNode, key: string): ReactNode {
  const children = node.items.map((item, j) => (
    <li key={j}>
      {inline(item.text, `${key}-${j}`)}
      {item.child && renderList(item.child, `${key}-${j}n`)}
    </li>
  ));
  return node.ordered ? (
    <ol key={key}>{children}</ol>
  ) : (
    <ul key={key}>{children}</ul>
  );
}

/* ── tables ───────────────────────────────────────────────────────── */

/** Splits a pipe row into cells, honouring `\|` escapes. */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function alignOf(spec: string): Align {
  const s = spec.trim();
  if (s.startsWith(":") && s.endsWith(":")) return "center";
  if (s.endsWith(":")) return "right";
  return "left";
}

const ALIGN_CLASS: Record<Align, string | undefined> = {
  left: undefined,
  center: "ta-c",
  right: "ta-r",
};

/* ── blocks ───────────────────────────────────────────────────────── */

/** True when the line opens a block that a paragraph must not swallow. */
function startsBlock(line: string, next: string | undefined): boolean {
  return (
    line.startsWith("```") ||
    HR_RE.test(line) ||
    HEADING_RE.test(line) ||
    LIST_RE.test(line) ||
    QUOTE_RE.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_SEP_RE.test(next))
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(
        <pre key={key++}>
          <code>{code.join("\n")}</code>
        </pre>
      );
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push(<hr key={key++} />);
      i++;
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      const depth = Math.min(heading[1].length, 4);
      const Tag = `h${depth}` as "h1" | "h2" | "h3" | "h4";
      blocks.push(
        <Tag key={key++}>{inline(heading[2], `h${key}`)}</Tag>
      );
      i++;
      continue;
    }

    // A table is a header row of pipes followed by a `|---|` separator with a
    // matching number of columns.
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      TABLE_SEP_RE.test(lines[i + 1]) &&
      splitRow(lines[i + 1]).length === splitRow(line).length
    ) {
      const headers = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(alignOf);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div className="table-wrap" key={key++}>
          <table>
            <thead>
              <tr>
                {headers.map((h, c) => (
                  <th key={c} className={ALIGN_CLASS[aligns[c] ?? "left"]}>
                    {inline(h, `th${key}-${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {headers.map((_, c) => (
                    <td key={c} className={ALIGN_CLASS[aligns[c] ?? "left"]}>
                      {inline(row[c] ?? "", `td${key}-${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        quoted.push(lines[i].match(QUOTE_RE)![1]);
        i++;
      }
      // paragraphs inside the quote, split on blank lines
      const paras: string[][] = [[]];
      for (const q of quoted) {
        if (q.trim() === "") paras.push([]);
        else paras[paras.length - 1].push(q);
      }
      blocks.push(
        <blockquote key={key++}>
          {paras
            .filter((p) => p.length)
            .map((p, j) => (
              <p key={j}>{inline(p.join(" "), `bq${key}-${j}`)}</p>
            ))}
        </blockquote>
      );
      continue;
    }

    if (LIST_RE.test(line)) {
      const rows: ListRow[] = [];
      while (i < lines.length && LIST_RE.test(lines[i])) {
        const m = lines[i].match(LIST_RE)!;
        rows.push({
          indent: m[1].replace(/\t/g, "  ").length,
          ordered: ORDERED_RE.test(lines[i]),
          text: m[2],
        });
        i++;
      }
      let at = 0;
      while (at < rows.length) {
        const [node, next] = buildList(rows, at, rows[at].indent);
        blocks.push(renderList(node, `l${key++}`));
        at = next;
      }
      continue;
    }

    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !startsBlock(lines[i], lines[i + 1])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p, `p${key}-${j}`)}
          </Fragment>
        ))}
      </p>
    );
  }

  return <div className="md">{blocks}</div>;
}
