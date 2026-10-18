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
 *
 * Three more looks are kept as the forms other Markdown readers know: `~~strikethrough~~`, `<u>underline</u>` and
 * `<span style="color:#rrggbb;font-size:150%">a colour and a size of its own</span>` (a size is a share of the block's size, 10% to 1000%).
 * They are read as states like the emphasis marks, so `<span>` does not nest.
 */

export type BlockType = "p" | "h1" | "h2" | "h3" | "ul" | "ol";

export interface Span {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  /** Underlined; absent = not. */
  readonly underline?: boolean;
  /** Struck through; absent = not. */
  readonly strike?: boolean;
  /** A colour of its own ("#rrggbb" or "#rrggbbaa"); absent = the text's. */
  readonly color?: string;
  /** Size as a multiple of the block's size, 0.1 to 10; absent = 1. */
  readonly scale?: number;
}

export const SCALE_RANGE = [0.1, 10] as const;
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const clampScale = (v: number): number => Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], v));
/** The look of a span apart from its emphasis, as one comparable key (spans with the same key merge). */
const looks = (s: Span): string => `${s.bold ? 1 : 0}${s.italic ? 1 : 0}${s.underline ? 1 : 0}${s.strike ? 1 : 0}|${s.color ?? ""}|${s.scale && s.scale !== 1 ? s.scale : ""}`;

export interface Block {
  readonly type: BlockType;
  readonly spans: readonly Span[];
}

/** Longest Markdown a text object may hold (characters). */
export const MAX_MARKDOWN_LENGTH = 100_000;

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

const SPAN_OPEN = /^<span style="([^"<>]*)">/;

/** The colour and size a `<span style="...">` says (anything else in it is ignored). */
function spanStyle(css: string): { color?: string; scale?: number } {
  const out: { color?: string; scale?: number } = {};
  for (const decl of css.split(";")) {
    const m = /^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i.exec(decl);
    if (!m) continue;
    if (m[1]!.toLowerCase() === "color" && HEX.test(m[2]!)) out.color = m[2]!.toLowerCase();
    const pct = m[1]!.toLowerCase() === "font-size" ? /^(\d+(?:\.\d+)?)%$/.exec(m[2]!) : null;
    if (pct) out.scale = clampScale(Number(pct[1]) / 100);
  }
  return out;
}

function parseInline(s: string): Span[] {
  const out: Span[] = [];
  let bold = false;
  let italic = false;
  let underline = false;
  let strike = false;
  let color: string | undefined;
  let scale: number | undefined;
  let text = "";
  const flush = (): void => {
    if (text) out.push({ text, bold, italic, ...(underline ? { underline } : {}), ...(strike ? { strike } : {}), ...(color ? { color } : {}), ...(scale && scale !== 1 ? { scale } : {}) });
    text = "";
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\" && i + 1 < s.length && PUNCT.test(s[i + 1]!)) {
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
    } else if (ch === "~" && s[i + 1] === "~") {
      flush();
      strike = !strike;
      i += 1;
    } else if (ch === "<") {
      const rest = s.slice(i, i + 200);
      const open = SPAN_OPEN.exec(rest);
      if (rest.startsWith("<u>")) {
        flush();
        underline = true;
        i += 2;
      } else if (rest.startsWith("</u>")) {
        flush();
        underline = false;
        i += 3;
      } else if (open) {
        flush();
        ({ color, scale } = spanStyle(open[1]!));
        i += open[0].length - 1;
      } else if (rest.startsWith("</span>")) {
        flush();
        color = scale = undefined;
        i += 6;
      } else text += ch;
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
  type Ch = { c: string } & Omit<Span, "text">;
  const chars: Ch[] = [];
  for (const s of spans) {
    const { text, ...look } = s;
    for (const c of text.replace(/\s+/g, " ")) chars.push({ c, ...look });
  }
  let a = 0;
  let b = chars.length;
  while (a < b && chars[a]!.c === " ") a++;
  while (b > a && chars[b - 1]!.c === " ") b--;
  const t = chars.slice(a, b).filter((ch, i, arr) => !(ch.c === " " && arr[i - 1]?.c === " "));
  const tidy = (c: Ch): Ch => {
    const { underline, strike, color, scale, ...rest } = c;
    return { ...rest, ...(underline ? { underline } : {}), ...(strike ? { strike } : {}), ...(color ? { color } : {}), ...(scale && scale !== 1 ? { scale: clampScale(scale) } : {}) };
  };
  for (let i = 0; i < t.length; i++) {
    if (t[i]!.c !== " ") continue;
    const prev = t[i - 1]!;
    const next = t[i + 1]!;
    // a space takes the looks its neighbours share (it is invisible, and this keeps it outside the marks)
    t[i] = { c: " ", bold: prev.bold && next.bold, italic: prev.italic && next.italic, ...(prev.underline && next.underline ? { underline: true } : {}), ...(prev.strike && next.strike ? { strike: true } : {}), ...(prev.color && prev.color === next.color ? { color: prev.color } : {}), ...(prev.scale && prev.scale === next.scale ? { scale: prev.scale } : {}) };
  }
  const out: Span[] = [];
  for (const raw of t) {
    const ch = tidy(raw);
    const { c, ...look } = ch;
    const last = out[out.length - 1];
    if (last && looks(last) === looks(look as Span)) out[out.length - 1] = { ...last, text: last.text + c };
    else out.push({ text: c, ...look } as Span);
  }
  return out;
}

const ESCAPE = /[\\*_`[\]<&~]/g;

function escapeText(s: string, blockStart: boolean): string {
  let e = s.replace(ESCAPE, "\\$&");
  if (blockStart) e = e.replace(/^([#>+-])/, "\\$1").replace(/^(\d+)([.)])/, "$1\\$2");
  return e;
}

/** The text without Markup on one line (names in lists). */
export function plainText(md: string, max = 40): string {
  return parse(md).map((b) => b.spans.map((s) => s.text).join("")).join(" ").slice(0, max);
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
    let under = false;
    let strike = false;
    let spanKey = "";
    const spanTag = (c: string | undefined, k: number | undefined): string => `<span style="${[c ? `color:${c}` : "", k && k !== 1 ? `font-size:${Math.round(k * 10000) / 100}%` : ""].filter(Boolean).join(";")}">`;
    const delim = (sp: Span | null): string => {
      const nb = sp?.bold ?? false, ni = sp?.italic ?? false, nu = sp?.underline ?? false, ns = sp?.strike ?? false;
      const key = sp && (sp.color || (sp.scale && sp.scale !== 1)) ? spanTag(sp.color, sp.scale) : "";
      const d = (bold !== nb ? "**" : "") + (italic !== ni ? "*" : "") + (strike !== ns ? "~~" : "") + (under !== nu ? (nu ? "<u>" : "</u>") : "") + (key !== spanKey ? (spanKey ? "</span>" : "") + key : "");
      bold = nb;
      italic = ni;
      strike = ns;
      under = nu;
      spanKey = key;
      return d;
    };
    spans.forEach((sp, j) => {
      s += delim(sp) + escapeText(sp.text, j === 0);
    });
    s += delim(null);
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
