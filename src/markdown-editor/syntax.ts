// The Markdown this package reads: CommonMark with GitHub's tables, task lists, strikethrough and bare links, plus what notes apps write:
// `[[wiki links]]` (`[[Plan|shown]]`, `[[Plan#Part]]`), embeds (`![[cat.png]]`), `#tags` and `==highlights==`. The editor and the renderer
// share this one parser, so what the preview shows is what the editor marks.
import { GFM, parser as baseParser, type InlineContext, type MarkdownConfig } from "@lezer/markdown";
import { tags } from "@lezer/highlight";

const BANG = 33, HASH = 35, EQ = 61, OPEN = 91, CLOSE = 93;

/** Where a `[[` link closes (the position after `]]`), or -1: on one line, no `[` or `]` inside. */
function wikiEnd(cx: InlineContext, from: number): number {
  for (let p = from; p < cx.end; p++) {
    const c = cx.char(p);
    if (c === 10 || c === OPEN) return -1;
    if (c === CLOSE) return cx.char(p + 1) === CLOSE && p > from ? p + 2 : -1;
  }
  return -1;
}

/** `[[target|alias]]` and `![[target|alias]]`: marks, target and alias as nodes of their own. */
const wiki: MarkdownConfig = {
  defineNodes: [
    { name: "WikiLink", style: tags.link },
    { name: "Embed", style: tags.link },
    { name: "WikiMark", style: tags.processingInstruction },
    { name: "WikiTarget", style: tags.link },
    { name: "WikiAlias", style: tags.link },
  ],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        const embed = next === BANG && cx.char(pos + 1) === OPEN && cx.char(pos + 2) === OPEN;
        if (!embed && !(next === OPEN && cx.char(pos + 1) === OPEN)) return -1;
        const open = pos + (embed ? 3 : 2);
        const end = wikiEnd(cx, open);
        if (end < 0) return -1;
        const inner = cx.slice(open, end - 2);
        // (in a table the bar is written \\|, so it is no column's edge: the same bar)
        const bar = inner.search(/\\?\|/);
        const barLen = bar >= 0 && inner[bar] === "\\" ? 2 : 1;
        const targetEnd = bar < 0 ? end - 2 : open + bar;
        const children = [cx.elt("WikiMark", pos, open), cx.elt("WikiTarget", open, targetEnd)];
        if (bar >= 0) children.push(cx.elt("WikiMark", targetEnd, targetEnd + barLen), cx.elt("WikiAlias", targetEnd + barLen, end - 2));
        children.push(cx.elt("WikiMark", end - 2, end));
        return cx.addElement(cx.elt(embed ? "Embed" : "WikiLink", pos, end, children));
      },
    },
  ],
};

/** A tag's letters: anything but space and punctuation other than `_ - /`. */
const TAG_CHAR = /[\p{L}\p{N}_\-/]/u;
/** `#tag` at the start or after a space; at least one letter that is not a digit (`#1` is no tag). */
const hashTag: MarkdownConfig = {
  defineNodes: [{ name: "Tag", style: tags.labelName }, { name: "TagMark", style: tags.processingInstruction }],
  parseInline: [
    {
      name: "Tag",
      parse(cx, next, pos) {
        if (next !== HASH) return -1;
        const before = pos > cx.offset ? cx.slice(pos - 1, pos) : "";
        if (before && !/\s|[([{]/.test(before)) return -1;
        let end = pos + 1;
        while (end < cx.end && TAG_CHAR.test(String.fromCodePoint(cx.char(end)))) end++;
        const name = cx.slice(pos + 1, end);
        if (!name || /^[\d/_-]+$/.test(name)) return -1;
        return cx.addElement(cx.elt("Tag", pos, end, [cx.elt("TagMark", pos, pos + 1)]));
      },
    },
  ],
};

const PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\p{P}\p{S}]/u;
const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };
/** `==marked words==`, as strikethrough's `~~`. */
const highlight: MarkdownConfig = {
  defineNodes: [{ name: "Highlight", style: tags.special(tags.content) }, { name: "HighlightMark", style: tags.processingInstruction }],
  parseInline: [
    {
      name: "Highlight",
      after: "Emphasis",
      parse(cx, next, pos) {
        if (next !== EQ || cx.char(pos + 1) !== EQ || cx.char(pos + 2) === EQ) return -1;
        const before = cx.slice(pos - 1, pos), after = cx.slice(pos + 2, pos + 3);
        const sBefore = /\s|^$/.test(before), sAfter = /\s|^$/.test(after);
        const pBefore = PUNCT.test(before), pAfter = PUNCT.test(after);
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, !sAfter && (!pAfter || sBefore || pBefore), !sBefore && (!pBefore || sAfter || pAfter));
      },
    },
  ],
};

const DOLLAR = 36;
/** Math: `$…$` in words (not `$ 5` or `5$`), and `$$` … `$$` blocks whose fences are lines of their own (or `$$…$$` alone on a line). */
const math: MarkdownConfig = {
  defineNodes: [{ name: "InlineMath", style: tags.special(tags.string) }, { name: "BlockMath", block: true, style: tags.special(tags.string) }, { name: "MathMark", style: tags.processingInstruction }],
  parseInline: [
    {
      name: "InlineMath",
      before: "Emphasis",
      parse(cx, next, pos) {
        if (next !== DOLLAR || cx.char(pos + 1) === DOLLAR || /\s/.test(cx.slice(pos + 1, pos + 2))) return -1;
        for (let p = pos + 1; p < cx.end; p++) {
          const c = cx.char(p);
          if (c === 10) return -1;
          if (c === 92) {
            p++;
            continue;
          }
          if (c === DOLLAR) {
            if (p === pos + 1 || /\s/.test(cx.slice(p - 1, p)) || /\d/.test(cx.slice(p + 1, p + 2))) return -1;
            return cx.addElement(cx.elt("InlineMath", pos, p + 1, [cx.elt("MathMark", pos, pos + 1), cx.elt("MathMark", p, p + 1)]));
          }
        }
        return -1;
      },
    },
  ],
  parseBlock: [
    {
      name: "BlockMath",
      before: "FencedCode",
      parse(cx, line) {
        const text = line.text.slice(line.pos);
        if (!text.startsWith("$$")) return false;
        const start = cx.lineStart + line.pos;
        const one = /^\$\$(.+)\$\$\s*$/.exec(text);
        if (one) {
          const end = cx.lineStart + line.text.length;
          cx.addElement(cx.elt("BlockMath", start, end, [cx.elt("MathMark", start, start + 2), cx.elt("MathMark", end - 2 - (text.length - text.trimEnd().length), end - (text.length - text.trimEnd().length))]));
          cx.nextLine();
          return true;
        }
        if (text.trim() !== "$$") return false;
        const marks = [cx.elt("MathMark", start, start + 2)];
        let end = cx.lineStart + line.text.length;
        while (cx.nextLine()) {
          end = cx.lineStart + line.text.length;
          if (line.text.trim() === "$$") {
            marks.push(cx.elt("MathMark", cx.lineStart + line.text.indexOf("$$"), cx.lineStart + line.text.indexOf("$$") + 2));
            cx.nextLine();
            break;
          }
        }
        cx.addElement(cx.elt("BlockMath", start, end, marks));
        return true;
      },
    },
  ],
};

const CARET = 94;
/**
 * Footnotes, as notes apps write them: a reference `[^1]` (any label), an inline footnote `^[its words]`, and a definition `[^1]: words` on a
 * line of its own (its next lines indented belong to it).
 */
const footnotes: MarkdownConfig = {
  defineNodes: [{ name: "FootnoteRef", style: tags.link }, { name: "InlineFootnote", style: tags.link }, { name: "FootnoteDef", block: true }, { name: "FootnoteLabel", style: tags.labelName }, { name: "FootnoteMark", style: tags.processingInstruction }],
  parseInline: [
    {
      name: "FootnoteRef",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== OPEN || cx.char(pos + 1) !== CARET) return -1;
        for (let p = pos + 2; p < cx.end; p++) {
          const c = cx.char(p);
          if (c === 10 || c === 32 || c === OPEN) return -1;
          if (c === CLOSE) return p > pos + 2 && cx.char(p + 1) !== 58 ? cx.addElement(cx.elt("FootnoteRef", pos, p + 1, [cx.elt("FootnoteMark", pos, pos + 2), cx.elt("FootnoteLabel", pos + 2, p), cx.elt("FootnoteMark", p, p + 1)])) : -1;
        }
        return -1;
      },
    },
    {
      name: "InlineFootnote",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== CARET || cx.char(pos + 1) !== OPEN) return -1;
        let depth = 0;
        for (let p = pos + 1; p < cx.end; p++) {
          const c = cx.char(p);
          if (c === 10) return -1;
          if (c === OPEN) depth++;
          else if (c === CLOSE && --depth === 0) return p > pos + 2 ? cx.addElement(cx.elt("InlineFootnote", pos, p + 1, [cx.elt("FootnoteMark", pos, pos + 2), cx.elt("FootnoteMark", p, p + 1)])) : -1;
        }
        return -1;
      },
    },
  ],
  parseBlock: [
    {
      name: "FootnoteDef",
      before: "LinkReference",
      parse(cx, line) {
        const m = /^\[\^([^\]\s]+)\]:[ \t]?/.exec(line.text.slice(line.pos));
        if (!m) return false;
        const start = cx.lineStart + line.pos;
        const label = cx.elt("FootnoteLabel", start + 2, start + 2 + m[1]!.length);
        const marks = [cx.elt("FootnoteMark", start, start + m[0].length), label];
        let end = cx.lineStart + line.text.length;
        // (its next lines, indented, are its own, paragraphs after a blank line too, as notes apps read them: four spaces or a tab)
        const indented = (t: string): boolean => /^(\t| {2,})\S/.test(t);
        while (cx.nextLine()) {
          if (indented(line.text)) end = cx.lineStart + line.text.length;
          else if (!line.text.trim() && indented(cx.peekLine())) continue;
          else break;
        }
        cx.addElement(cx.elt("FootnoteDef", start, end, marks));
        return true;
      },
    },
  ],
};

/** Every extension, for `markdown({ extensions })` in the editor and for the renderer's parser. */
export const EXTENSIONS: MarkdownConfig[] = [...GFM, wiki, hashTag, highlight, math, footnotes];

/** The parser the renderer uses: the same one the editor's language is built from. */
export const parser = baseParser.configure(EXTENSIONS);
