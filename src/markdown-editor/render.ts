// Markdown as HTML, from the same parse tree the editor marks. It needs no DOM (it runs in Node too) and writes only what it was given: raw HTML
// in the Markdown is escaped unless `html` is on, and then the caller must clean what it shows (the editor's preview does: `cleanHtml`).
import type { SyntaxNode } from "@lezer/common";
import { parser } from "./syntax";

export interface RenderOptions {
  /** Raw HTML in the Markdown is kept (to be cleaned by whoever shows it); else it is shown as text. Default false. */
  html?: boolean;
  /** The address of a `[[target]]` link. Default `#` + the target; the target is also on the link as `data-wiki`. */
  wikiHref?: (target: string) => string;
  /** The address of an embed's picture (`![[cat.png]]`). Default the target itself; the target is also on it as `data-embed`. */
  embedSrc?: (target: string) => string;
  /** Text for a task's checkbox (screen readers). */
  taskLabel?: string;
  /** Mark each task's box with the offset of its `[ ]` in the source (`data-task`), so a click can tick the source. Default false. */
  taskOffsets?: boolean;
  /** A leading YAML block (`---` … `---`) is left out. Default true. */
  skipFrontmatter?: boolean;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ESC[c]!);
/** A link's address made safe to write: no `javascript:` or other script schemes. */
const safeUrl = (u: string): string => (/^\s*(javascript|vbscript|data:text\/html)/i.test(u) ? "#" : u);

/** The YAML block at the start of a note: its length, or 0. */
export function frontmatterLength(md: string): number {
  const m = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(md);
  return m ? m[0].length : 0;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", hellip: "…", mdash: "—", ndash: "–" };
const entityText = (e: string): string => {
  const m = /^&(?:#(\d+)|#x([\da-f]+)|(\w+));$/i.exec(e);
  if (!m) return e;
  if (m[1] || m[2]) return String.fromCodePoint(parseInt(m[1] ?? m[2]!, m[1] ? 10 : 16) || 0xfffd);
  return ENTITIES[m[3]!] ?? e;
};

/** Marks that are syntax only: never shown. */
const MARKS = new Set(["EmphasisMark", "CodeMark", "LinkMark", "HeaderMark", "QuoteMark", "ListMark", "StrikethroughMark", "HighlightMark", "TableDelimiter", "WikiMark", "TagMark", "CodeInfo", "LinkTitle", "LinkLabel", "URL"]);

/** Render Markdown to HTML. */
export function renderMarkdown(md: string, opts: RenderOptions = {}): string {
  const skip = opts.skipFrontmatter === false ? 0 : frontmatterLength(md);
  const src = skip ? md.slice(0, skip).replace(/[^\n]/g, "\n") + md.slice(skip) : md; // (blank lines in its place: offsets stay those of the source)
  const tree = parser.parse(src);
  const wikiHref = opts.wikiHref ?? ((t: string) => `#${encodeURIComponent(t)}`);
  const embedSrc = opts.embedSrc ?? ((t: string) => t);
  const text = (from: number, to: number): string => src.slice(from, to);

  /** The inline content of `node` between `from` and `to`: its text with its children rendered. */
  const inline = (node: SyntaxNode, from = node.from, to = node.to): string => {
    let out = "";
    let at = from;
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.to <= from || c.from >= to) continue;
      out += plain(text(at, c.from));
      out += inlineNode(c);
      at = c.to;
      if (c.name === "QuoteMark") while (at < to && (src[at] === " " || src[at] === "\t")) at++; // (a quote's next line: its words after `> `)
    }
    return out + plain(text(at, to));
  };
  /** Words between elements: a line break inside a paragraph is a line of its own (as notes apps show it), a backslash at a line's end too. */
  const plain = (s: string): string => escapeHtml(s.replace(/\n[ \t]*/g, "\n")).replace(/(?: {2,}|\\)?\n/g, "<br>");

  const inlineNode = (n: SyntaxNode): string => {
    switch (n.name) {
      case "Emphasis":
        return `<em>${inner(n)}</em>`;
      case "StrongEmphasis":
        return `<strong>${inner(n)}</strong>`;
      case "Strikethrough":
        return `<del>${inner(n)}</del>`;
      case "Highlight":
        return `<mark>${inner(n)}</mark>`;
      case "InlineCode": {
        const t = text(n.from, n.to).replace(/^`+|`+$/g, "");
        return `<code>${escapeHtml(/^ .* $/.test(t) && t.trim() ? t.slice(1, -1) : t)}</code>`;
      }
      case "Escape":
        return escapeHtml(text(n.from + 1, n.to));
      case "Entity":
        return escapeHtml(entityText(text(n.from, n.to)));
      case "HardBreak":
        return "<br>";
      case "HTMLTag":
        return opts.html ? text(n.from, n.to) : escapeHtml(text(n.from, n.to));
      case "Autolink": {
        const url = n.getChild("URL");
        const u = url ? text(url.from, url.to) : "";
        const href = /^[^\s@]+@[^\s@]+$/.test(u) ? `mailto:${u}` : u;
        return `<a href="${escapeHtml(safeUrl(href))}">${escapeHtml(u)}</a>`;
      }
      case "URL": {
        // (a bare address, GitHub's autolink)
        const u = text(n.from, n.to);
        const href = /^www\./i.test(u) ? `https://${u}` : /^[^\s@:]+@[^\s@]+$/.test(u) ? `mailto:${u}` : u;
        return `<a href="${escapeHtml(safeUrl(href))}">${escapeHtml(u)}</a>`;
      }
      case "Link":
      case "Image":
        return linkOrImage(n);
      case "WikiLink": {
        const target = child(n, "WikiTarget");
        const alias = child(n, "WikiAlias");
        const shown = alias ?? target.split("#")[0]!.split("/").pop()!;
        return `<a href="${escapeHtml(wikiHref(target.trim()))}" data-wiki="${escapeHtml(target.trim())}">${escapeHtml(shown || target)}</a>`;
      }
      case "Embed": {
        const target = child(n, "WikiTarget").trim();
        const alias = child(n, "WikiAlias");
        const size = alias && /^\d+(x\d+)?$/.test(alias.trim()) ? alias.trim().split("x") : null;
        const alt = size ? target.split("/").pop()! : (alias ?? target.split("/").pop()!);
        const dims = size ? ` width="${size[0]}"${size[1] ? ` height="${size[1]}"` : ""}` : "";
        return `<img src="${escapeHtml(embedSrc(target))}" alt="${escapeHtml(alt)}" data-embed="${escapeHtml(target)}"${dims}>`;
      }
      case "InlineMath":
        return `<span class="math" data-tex="${escapeHtml(text(n.from + 1, n.to - 1))}">${escapeHtml(text(n.from, n.to))}</span>`;
      case "Tag": {
        const t = text(n.from + 1, n.to);
        return `<span class="tag" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`;
      }
      default:
        return MARKS.has(n.name) ? "" : inline(n);
    }
  };
  /** Inside an element, without its opening and closing marks. */
  const inner = (n: SyntaxNode): string => {
    const first = n.firstChild, last = n.lastChild;
    const from = first && MARKS.has(first.name) ? first.to : n.from;
    const to = last && last !== first && MARKS.has(last.name) ? last.from : n.to;
    return inline(n, from, to);
  };
  const child = (n: SyntaxNode, name: string): string => {
    const c = n.getChild(name);
    return c ? text(c.from, c.to) : "";
  };
  const linkOrImage = (n: SyntaxNode): string => {
    const marks = n.getChildren("LinkMark");
    const url = n.getChild("URL");
    const title = n.getChild("LinkTitle");
    const label = n.getChild("LinkLabel");
    // [text] is between the first two marks
    const close = marks.find((m) => text(m.from, m.to) === "]");
    const words = close ? inline(n, marks[0]!.to, close.from) : "";
    let href = url ? text(url.from, url.to) : "";
    if (href.startsWith("<") && href.endsWith(">")) href = href.slice(1, -1);
    if (!url && label) href = refs.get(norm(text(label.from + 1, label.to - 1))) ?? "";
    else if (!url && close && !label) href = refs.get(norm(text(marks[0]!.to, close.from))) ?? "";
    if (!url && !href) return escapeHtml(text(n.from, n.to)); // (a reference never defined: words as written)
    const t = title ? ` title="${escapeHtml(text(title.from + 1, title.to - 1))}"` : "";
    if (n.name === "Image") {
      const alt = close ? text(marks[0]!.to, close.from) : "";
      const size = /^(.*?)\|(\d+)(?:x(\d+))?$/.exec(alt); // (`![cat|200](cat.png)`: a width, as notes apps write it)
      const dims = size ? ` width="${size[2]}"${size[3] ? ` height="${size[3]}"` : ""}` : "";
      return `<img src="${escapeHtml(safeUrl(href))}" alt="${escapeHtml(size ? size[1]! : alt)}"${t}${dims}>`;
    }
    return `<a href="${escapeHtml(safeUrl(href))}"${t}>${words}</a>`;
  };

  // Link reference definitions first (`[name]: address`), used by links anywhere.
  const norm = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();
  const refs = new Map<string, string>();
  tree.iterate({
    enter: (n) => {
      if (n.name !== "LinkReference") return;
      const label = n.node.getChild("LinkLabel"), url = n.node.getChild("URL");
      if (label && url) refs.set(norm(text(label.from + 1, label.to - 1)), text(url.from, url.to).replace(/^<|>$/g, ""));
      return false;
    },
  });

  const block = (n: SyntaxNode): string => {
    switch (n.name) {
      case "Paragraph":
        return `<p>${inline(n).trim()}</p>`;
      case "ATXHeading1": case "ATXHeading2": case "ATXHeading3": case "ATXHeading4": case "ATXHeading5": case "ATXHeading6": {
        const lv = n.name.slice(-1);
        const marks = n.getChildren("HeaderMark");
        const from = marks[0] ? marks[0].to : n.from;
        const to = marks.length > 1 && marks[marks.length - 1]!.from > from ? marks[marks.length - 1]!.from : n.to;
        return `<h${lv}>${inline(n, from, to).trim()}</h${lv}>`;
      }
      case "SetextHeading1": case "SetextHeading2": {
        const lv = n.name.slice(-1);
        const mark = n.getChild("HeaderMark");
        return `<h${lv}>${inline(n, n.from, mark ? mark.from : n.to).trim()}</h${lv}>`;
      }
      case "Blockquote": {
        // (`> [!type] Title`: a callout, a card of its type's colour)
        const head = /^\s*>\s?\[!(\w+)\][-+]?[ \t]*([^\n]*)/.exec(text(n.from, n.to));
        if (!head) return `<blockquote>${blocks(n)}</blockquote>`;
        const type = head[1]!.toLowerCase();
        const title = head[2]!.trim() || type.charAt(0).toUpperCase() + type.slice(1);
        const inner = blocks(n).replace(/^<p>\[!\w+\][-+]?[^<]*?(?:<br>|<\/p>)/, (m) => (m.endsWith("<br>") ? "<p>" : ""));
        return `<div class="callout" data-callout="${escapeHtml(type)}"><div class="callout-title">${escapeHtml(title)}</div>${inner}</div>`;
      }
      case "BulletList":
        return `<ul>${blocks(n)}</ul>`;
      case "OrderedList": {
        const mark = n.firstChild?.getChild("ListMark");
        const start = mark ? parseInt(text(mark.from, mark.to), 10) : 1;
        return `<ol${start !== 1 && !isNaN(start) ? ` start="${start}"` : ""}>${blocks(n)}</ol>`;
      }
      case "ListItem": {
        const task = n.getChild("Task");
        // (a tight list's item holds its words, not a paragraph: shown as words)
        const tight = !n.parent || !isLoose(n.parent);
        // (`[-]` cancelled, `[/]` in progress, `[>]` forwarded: task states read as links)
        const first = n.getChild("Paragraph");
        const st = !task && first ? /^\[([-/>])\][ \t]/.exec(text(first.from, first.to)) : null;
        if (st && first) {
          const kind = st[1] === "-" ? "cancelled" : st[1] === "/" ? "progress" : "forwarded";
          return `<li class="task ${kind}"><span class="task-state task-${kind}"></span> ${inline(first, first.from + 3).trim()}${blocks(n, (c) => c.from !== first.from && c.name !== "ListMark")}</li>`;
        }
        if (task) {
          const marker = task.getChild("TaskMarker");
          const on = marker ? /x/i.test(text(marker.from, marker.to)) : false;
          const at = opts.taskOffsets && marker ? ` data-task="${marker.from}"` : "";
          const label = opts.taskLabel ? ` aria-label="${escapeHtml(opts.taskLabel)}"` : "";
          const words = inline(task, marker ? marker.to : task.from).trim();
          const rest = blocks(n, (c) => c.name !== "Task" && c.name !== "ListMark");
          return `<li class="task${on ? " done" : ""}"><input type="checkbox"${on ? " checked" : ""}${at}${label}> ${words}${rest}</li>`;
        }
        return `<li>${blocks(n, (c) => c.name !== "ListMark", tight)}</li>`;
      }
      case "FencedCode": {
        const info = n.getChild("CodeInfo");
        const lang = info ? text(info.from, info.to).trim().split(/\s+/)[0]! : "";
        const code = n.getChildren("CodeText").map((c) => text(c.from, c.to)).join("");
        const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
        return `<pre${cls}><code${cls}>${escapeHtml(dedent(code, n))}</code></pre>`;
      }
      case "CodeBlock": {
        const code = text(n.from, n.to).split("\n").map((l) => l.replace(/^( {4}|\t)/, "")).join("\n");
        return `<pre><code>${escapeHtml(code)}</code></pre>`;
      }
      case "HorizontalRule":
        return "<hr>";
      case "BlockMath": {
        const tex = text(n.from, n.to).trim().replace(/^\$\$|\$\$$/g, "").trim();
        return `<div class="math math-block" data-tex="${escapeHtml(tex)}">${escapeHtml(text(n.from, n.to))}</div>`;
      }
      case "HTMLBlock":
        return opts.html ? text(n.from, n.to) : `<p>${escapeHtml(text(n.from, n.to))}</p>`;
      case "Table":
        return table(n);
      case "LinkReference": case "CommentBlock": case "ProcessingInstructionBlock":
        return "";
      default:
        return blocks(n);
    }
  };
  /** A fenced block's lines without the fence's own indent (a fence inside a list item). */
  const dedent = (code: string, n: SyntaxNode): string => {
    const line = src.lastIndexOf("\n", n.from - 1) + 1;
    const indent = n.from - line;
    return indent ? code.split("\n").map((l) => l.replace(new RegExp(`^ {0,${indent}}`), "")).join("\n") : code;
  };
  /** A list is loose when a blank line is between two of its items or inside one. */
  const isLoose = (list: SyntaxNode): boolean => {
    for (let item = list.firstChild; item; item = item.nextSibling) {
      if (item.nextSibling && /\n[ \t]*\n/.test(text(item.to - 1, item.nextSibling.from + 1))) return true;
      let blocksIn = 0;
      for (let c = item.firstChild; c; c = c.nextSibling) if (c.name !== "ListMark" && c.name !== "Task") blocksIn++;
      if (blocksIn > 1 && /\n[ \t]*\n/.test(text(item.from, item.to).trimEnd())) return true;
    }
    return false;
  };
  const blocks = (n: SyntaxNode, keep: (c: SyntaxNode) => boolean = () => true, tight = false): string => {
    let out = "";
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (!keep(c) || MARKS.has(c.name)) continue;
      out += tight && c.name === "Paragraph" ? inline(c).trim() : block(c);
    }
    return out;
  };
  const table = (n: SyntaxNode): string => {
    const delim = [...n.getChildren("TableDelimiter")].find((d) => /-/.test(text(d.from, d.to)));
    const aligns = delim
      ? text(delim.from, delim.to).replace(/^\s*\||\|\s*$/g, "").split("|").map((c) => {
          const t = c.trim();
          return t.startsWith(":") && t.endsWith(":") ? "center" : t.endsWith(":") ? "right" : t.startsWith(":") ? "left" : "";
        })
      : [];
    const row = (r: SyntaxNode, tag: "th" | "td"): string => {
      const cells = r.getChildren("TableCell");
      const count = Math.max(cells.length, aligns.length);
      let out = "";
      for (let i = 0; i < count; i++) {
        const c = cells[i];
        const a = aligns[i] ? ` style="text-align:${aligns[i]}"` : "";
        out += `<${tag}${a}>${c ? inline(c).trim() : ""}</${tag}>`;
      }
      return `<tr>${out}</tr>`;
    };
    const head = n.getChild("TableHeader");
    const body = n.getChildren("TableRow");
    return `<table>${head ? `<thead>${row(head, "th")}</thead>` : ""}${body.length ? `<tbody>${body.map((r) => row(r, "td")).join("")}</tbody>` : ""}</table>`;
  };

  return blocks(tree.topNode);
}
