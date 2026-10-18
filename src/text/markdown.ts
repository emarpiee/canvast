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
  /** Where the words link to (`[words](https://…)`, only http, https and mailto); they are drawn underlined. */
  readonly link?: string;
}

export const MAX_LINK_LENGTH = 2000;
const LINK_URL = /^(https?:\/\/|mailto:)[^\s<>"()\\]+$/i;
/** Whether `url` may be a link of a text: a plain web or mail address (nothing a page could run). */
export const isLinkUrl = (url: string): boolean => url.length <= MAX_LINK_LENGTH && LINK_URL.test(url);
/** A web address made safe to write between the parentheses of a Markdown link: the characters that would end it are percent-encoded. */
export const linkUrlOf = (url: string): string => url.replace(/[()\s<>"\\]/g, (c) => encodeURIComponent(c).replace(/\(/g, "%28").replace(/\)/g, "%29"));

export const SCALE_RANGE = [0.1, 10] as const;
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const clampScale = (v: number): number => Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], v));
/** The look of a span apart from its emphasis, as one comparable key (spans with the same key merge). */
const looks = (s: Span): string => `${s.bold ? 1 : 0}${s.italic ? 1 : 0}${s.underline ? 1 : 0}${s.strike ? 1 : 0}|${s.color ?? ""}|${s.scale && s.scale !== 1 ? s.scale : ""}|${s.link ?? ""}`;

export interface Block {
  readonly type: BlockType;
  readonly spans: readonly Span[];
  /** How deep a list item sits (0 = the list itself, up to MAX_LIST_LEVEL); absent = 0. Written as two spaces of indent per level. */
  readonly level?: number;
}

export const MAX_LIST_LEVEL = 5;

/**
 * The number each block of a numbered list shows (0 for any other block). A list item counts on from the one before at its level; going
 * out to a shallower level goes on with that level's count, going in starts at 1, and a bullet or a paragraph at a level ends its count.
 */
export function listNumbers(blocks: readonly Block[]): number[] {
  const counts = new Map<number, number>();
  return blocks.map((b) => {
    const level = b.level ?? 0;
    if (b.type !== "ul" && b.type !== "ol") {
      counts.clear();
      return 0;
    }
    for (const l of [...counts.keys()]) if (l > level) counts.delete(l);
    if (b.type === "ul") {
      counts.delete(level);
      return 0;
    }
    const n = (counts.get(level) ?? 0) + 1;
    counts.set(level, n);
    return n;
  });
}

/** Longest Markdown a text object may hold (characters). */
export const MAX_MARKDOWN_LENGTH = 100_000;

const PUNCT = /[!-/:-@[-`{-~]/;

export function parse(md: string): Block[] {
  const blocks: Block[] = [];
  let cur: { type: BlockType; text: string; level: number } | null = null;
  const end = (): void => {
    if (cur) {
      const spans = parseInline(cur.text.trim());
      if (spans.length) blocks.push({ type: cur.type, spans, ...(cur.level ? { level: cur.level } : {}) });
    }
    cur = null;
  };
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const lead = /^[ \t]*/.exec(raw)![0].replace(/\t/g, "  ").length;
    if (!line) {
      end();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const ul = /^[-*+]\s+(.*)$/.exec(line);
    const ol = /^\d{1,9}[.)]\s+(.*)$/.exec(line);
    if (h) {
      end();
      cur = { type: (["h1", "h2", "h3"] as const)[Math.min(h[1]!.length, 3) - 1]!, text: h[2]!.replace(/\s+#+$/, ""), level: 0 };
      end();
    } else if (ul || ol) {
      end();
      cur = { type: ul ? "ul" : "ol", text: (ul ?? ol)![1]!, level: Math.min(MAX_LIST_LEVEL, Math.floor(lead / 2)) };
    } else if (cur) {
      cur.text += " " + line; // soft line break
    } else {
      cur = { type: "p", text: line, level: 0 };
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

type Look = Omit<Span, "text">;

/** The runs of an inline string, before they are tidied: `init` is the look the string starts in (the inside of a link starts in the look round it). */
function parseRuns(s: string, init: Look = { bold: false, italic: false }): Span[] {
  const out: Span[] = [];
  let bold = init.bold;
  let italic = init.italic;
  let underline = init.underline === true;
  let strike = init.strike === true;
  let color: string | undefined = init.color;
  let scale: number | undefined = init.scale;
  const link = init.link;
  let text = "";
  const flush = (): void => {
    if (text) out.push({ text, bold, italic, ...(underline ? { underline } : {}), ...(strike ? { strike } : {}), ...(color ? { color } : {}), ...(scale && scale !== 1 ? { scale } : {}), ...(link ? { link } : {}) });
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
    } else if (ch === "[" && !link) {
      // [words](address): the words are read in the look round them, with the address on every run
      const m = /^\[((?:\\.|[^\]\\])*)\]\(([^()\s]*)\)/.exec(s.slice(i, i + MAX_LINK_LENGTH + 2000));
      let url = "";
      try {
        url = m ? decodeURI(m[2]!) : "";
      } catch {
        url = m ? m[2]! : "";
      }
      if (m && isLinkUrl(m[2]!)) {
        flush();
        out.push(...parseRuns(m[1]!, { bold, italic, underline, strike, ...(color ? { color } : {}), ...(scale ? { scale } : {}), link: linkUrlOf(url) }));
        i += m[0].length - 1;
      } else text += ch;
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
  return out;
}

const parseInline = (s: string): Span[] => normalizeSpans(parseRuns(s));

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
    const { underline, strike, color, scale, link, ...rest } = c;
    return { ...rest, ...(underline ? { underline } : {}), ...(strike ? { strike } : {}), ...(color ? { color } : {}), ...(scale && scale !== 1 ? { scale: clampScale(scale) } : {}), ...(link ? { link } : {}) };
  };
  for (let i = 0; i < t.length; i++) {
    if (t[i]!.c !== " ") continue;
    const prev = t[i - 1]!;
    const next = t[i + 1]!;
    // a space takes the looks its neighbours share (it is invisible, and this keeps it outside the marks)
    t[i] = { c: " ", bold: prev.bold && next.bold, italic: prev.italic && next.italic, ...(prev.underline && next.underline ? { underline: true } : {}), ...(prev.strike && next.strike ? { strike: true } : {}), ...(prev.color && prev.color === next.color ? { color: prev.color } : {}), ...(prev.scale && prev.scale === next.scale ? { scale: prev.scale } : {}), ...(prev.link && prev.link === next.link ? { link: prev.link } : {}) };
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
  const kept = blocks.filter((b) => normalizeSpans(b.spans).length);
  const numbers = listNumbers(kept);
  kept.forEach((b, i) => {
    const spans = normalizeSpans(b.spans);
    const level = b.type === "ul" || b.type === "ol" ? Math.min(MAX_LIST_LEVEL, b.level ?? 0) : 0;
    const prefix = "  ".repeat(level) + { p: "", h1: "# ", h2: "## ", h3: "### ", ul: "- ", ol: `${numbers[i]}. ` }[b.type];
    let s = prefix;
    let bold = false;
    let italic = false;
    let under = false;
    let strike = false;
    let spanKey = "";
    let linkNow: string | undefined;
    const spanTag = (c: string | undefined, k: number | undefined): string => `<span style="${[c ? `color:${c}` : "", k && k !== 1 ? `font-size:${Math.round(k * 10000) / 100}%` : ""].filter(Boolean).join(";")}">`;
    const delim = (sp: Span | null): string => {
      const nb = sp?.bold ?? false, ni = sp?.italic ?? false, nu = sp?.underline ?? false, ns = sp?.strike ?? false;
      const key = sp && (sp.color || (sp.scale && sp.scale !== 1)) ? spanTag(sp.color, sp.scale) : "";
      // (tags close in the opposite order to the one they opened in: the span first, then the underline)
      const d = (bold !== nb ? "**" : "") + (italic !== ni ? "*" : "") + (strike !== ns ? "~~" : "") + (key !== spanKey && spanKey ? "</span>" : "") + (under !== nu ? (nu ? "<u>" : "</u>") : "") + (key !== spanKey ? key : "");
      bold = nb;
      italic = ni;
      strike = ns;
      under = nu;
      spanKey = key;
      return d;
    };
    const closeLink = (): string => (linkNow ? `](${linkNow})` : "");
    spans.forEach((sp, j) => {
      let pre = "";
      if (sp.link !== linkNow) {
        // the marks are closed before a link starts or ends, so none runs across its edge
        pre = delim(null) + closeLink() + (sp.link ? "[" : "");
        linkNow = sp.link;
      }
      s += pre + delim(sp) + escapeText(sp.text, j === 0 && !sp.link);
    });
    s += delim(null) + closeLink();
    if (b.type[0] === "h") s = s.replace(/(\s)(#+)$/, (_, w: string, h: string) => w + h.replace(/#/g, "\\#")); // a closing run of # would be dropped on reading
    const list = b.type === "ul" || b.type === "ol";
    const prev = kept[i - 1];
    const sameList = list && out.length && prev && (prev.type === b.type || (prev.level ?? 0) !== (b.level ?? 0)) && (prev.type === "ul" || prev.type === "ol");
    out.push((out.length ? (sameList ? "\n" : "\n\n") : "") + s);
  });
  return out.join("");
}

/** Canonical form of any Markdown string. */
export function canonical(md: string): string {
  return serialize(parse(md));
}
