/**
 * The rich-text model of a text object and its canonical Markdown form.
 *
 * A text object stores Markdown (not editor HTML). The supported subset is
 * paragraphs, headings 1–3, bulleted and numbered list items, bold and
 * italic. `serialize(parse(md))` is the canonical form: the document keeps
 * only canonical Markdown, so the copied text, the stored text and what is
 * drawn always agree.
 *
 * Emphasis delimiters toggle styles (`*` italic, `**` bold, `***` both;
 * `_` is read like `*`). The serializer emits one delimiter run per style
 * change and keeps whitespace outside delimiters, which ordinary Markdown
 * readers parse the same way.
 */

export type BlockType = "p" | "h1" | "h2" | "h3" | "ul" | "ol";

export interface Span {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  /** Mention of a canvas object by stable id (`[[item:<id>|label]]`); `text` is the label and the span is never merged or styled. */
  readonly ref?: string;
}

export interface Block {
  readonly type: BlockType;
  readonly spans: readonly Span[];
}

/** Longest Markdown a text object may hold (characters). */
export const MAX_MARKDOWN_LENGTH = 100_000;

/** `[[item:<id>|label]]`; a plain `[` in text is always escaped, so this never matches ordinary text. */
const MENTION = /^\[\[item:([A-Za-z0-9_-]+)\|((?:[^\]\\]|\\.)*)\]\]/;

const PUNCT = /[!-/:-@[-`{-~]/;

export function parse(md: string): Block[] {
  const blocks: Block[] = [];
  let cur: { type: BlockType; text: string } | null = null;
  const end = (): void => {
    if (cur) {
      const spans = parseInline(cur.text.trim());
      if (spans.length) blocks.push({ type: cur.type, spans });
    }
    cur = null;
  };
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      end();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const ul = /^[-*+]\s+(.*)$/.exec(line);
    const ol = /^\d{1,9}[.)]\s+(.*)$/.exec(line);
    if (h) {
      end();
      cur = { type: (["h1", "h2", "h3"] as const)[Math.min(h[1]!.length, 3) - 1]!, text: h[2]!.replace(/\s+#+$/, "") };
      end();
    } else if (ul || ol) {
      end();
      cur = { type: ul ? "ul" : "ol", text: (ul ?? ol)![1]! };
    } else if (cur) {
      cur.text += " " + line; // soft line break
    } else {
      cur = { type: "p", text: line };
    }
  }
  end();
  return blocks;
}

function parseInline(s: string): Span[] {
  const out: Span[] = [];
  let bold = false;
  let italic = false;
  let text = "";
  const flush = (): void => {
    if (text) out.push({ text, bold, italic });
    text = "";
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const m = ch === "[" ? MENTION.exec(s.slice(i)) : null;
    if (m) {
      flush();
      out.push({ text: m[2]!.replace(/\\(.)/g, "$1"), bold: false, italic: false, ref: m[1]! });
      i += m[0].length - 1;
    } else if (ch === "\\" && i + 1 < s.length && PUNCT.test(s[i + 1]!)) {
      text += s[++i];
    } else if (ch === "*" || ch === "_") {
      let n = 1;
      while (s[i + n] === ch) n++;
      if (n > 3) {
        text += ch.repeat(n);
      } else {
        flush();
        if (n !== 2) italic = !italic;
        if (n !== 1) bold = !bold;
      }
      i += n - 1;
    } else {
      text += ch;
    }
  }
  flush();
  return normalizeSpans(out);
}

/**
 * Canonical spans: whitespace runs collapse to one space, whitespace takes
 * the styles shared by its neighbours (it is invisible, and this keeps it
 * outside emphasis delimiters), block edges are trimmed, and adjacent spans
 * of equal style merge.
 */
export function normalizeSpans(spans: readonly Span[]): Span[] {
  const chars: Array<{ c: string; bold: boolean; italic: boolean; ref?: string }> = [];
  // A mention is one unit (its whole label in `c`), so it never merges and edge trimming only sees real spaces.
  for (const s of spans) {
    if (s.ref !== undefined) chars.push({ c: s.text.replace(/\s+/g, " ").trim() || "?", bold: false, italic: false, ref: s.ref });
    else for (const c of s.text.replace(/\s+/g, " ")) chars.push({ c, bold: s.bold, italic: s.italic });
  }
  let a = 0;
  let b = chars.length;
  while (a < b && chars[a]!.c === " ") a++;
  while (b > a && chars[b - 1]!.c === " ") b--;
  const t = chars.slice(a, b).filter((ch, i, arr) => !(ch.c === " " && ch.ref === undefined && arr[i - 1]?.c === " " && arr[i - 1]?.ref === undefined));
  for (let i = 0; i < t.length; i++) {
    if (t[i]!.c !== " " || t[i]!.ref !== undefined) continue;
    const prev = t[i - 1]!;
    const next = t[i + 1]!;
    t[i] = { c: " ", bold: prev.bold && next.bold, italic: prev.italic && next.italic };
  }
  const out: Span[] = [];
  for (const ch of t) {
    const last = out[out.length - 1];
    if (ch.ref !== undefined) out.push({ text: ch.c, bold: false, italic: false, ref: ch.ref });
    else if (last && last.ref === undefined && last.bold === ch.bold && last.italic === ch.italic) out[out.length - 1] = { ...last, text: last.text + ch.c };
    else out.push({ text: ch.c, bold: ch.bold, italic: ch.italic });
  }
  return out;
}

const ESCAPE = /[\\*_`[\]<&~]/g;

function escapeText(s: string, blockStart: boolean): string {
  let e = s.replace(ESCAPE, "\\$&");
  if (blockStart) e = e.replace(/^([#>+-])/, "\\$1").replace(/^(\d+)([.)])/, "$1\\$2");
  return e;
}

/** The text without Markup, mentions as their labels, on one line (names in lists). */
export function plainText(md: string, max = 40): string {
  return parse(md).map((b) => b.spans.map((s) => s.text).join("")).join(" ").slice(0, max);
}

/** Ids mentioned in Markdown, each once, in order of appearance. */
export function mentionIds(md: string): string[] {
  const ids = new Set<string>();
  for (const b of parse(md)) for (const s of b.spans) if (s.ref !== undefined) ids.add(s.ref);
  return [...ids];
}

export function serialize(blocks: readonly Block[]): string {
  const out: string[] = [];
  let n = 0;
  blocks.forEach((b, i) => {
    const spans = normalizeSpans(b.spans);
    if (!spans.length) return;
    n = b.type === "ol" ? (blocks[i - 1]?.type === "ol" && out.length ? n + 1 : 1) : 0;
    const prefix = { p: "", h1: "# ", h2: "## ", h3: "### ", ul: "- ", ol: `${n}. ` }[b.type];
    let s = prefix;
    let bold = false;
    let italic = false;
    const delim = (nb: boolean, ni: boolean): string => (bold !== nb ? "**" : "") + (italic !== ni ? "*" : "");
    spans.forEach((sp, j) => {
      s += delim(sp.bold, sp.italic) + (sp.ref !== undefined ? `[[item:${sp.ref}|${sp.text.replace(/[\\\][]/g, "\\$&")}]]` : escapeText(sp.text, j === 0));
      bold = sp.bold;
      italic = sp.italic;
    });
    s += delim(false, false);
    if (b.type[0] === "h") s = s.replace(/(\s)(#+)$/, (_, w: string, h: string) => w + h.replace(/#/g, "\\#")); // a closing run of # would be dropped on reading
    const list = b.type === "ul" || b.type === "ol";
    const sameList = list && out.length && blocks[i - 1]?.type === b.type;
    out.push((out.length ? (sameList ? "\n" : "\n\n") : "") + s);
  });
  return out.join("");
}

/** Canonical form of any Markdown string. */
export function canonical(md: string): string {
  return serialize(parse(md));
}
