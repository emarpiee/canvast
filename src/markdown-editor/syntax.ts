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
        const bar = inner.indexOf("|");
        const targetEnd = bar < 0 ? end - 2 : open + bar;
        const children = [cx.elt("WikiMark", pos, open), cx.elt("WikiTarget", open, targetEnd)];
        if (bar >= 0) children.push(cx.elt("WikiMark", targetEnd, targetEnd + 1), cx.elt("WikiAlias", targetEnd + 1, end - 2));
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

/** Every extension, for `markdown({ extensions })` in the editor and for the renderer's parser. */
export const EXTENSIONS: MarkdownConfig[] = [...GFM, wiki, hashTag, highlight];

/** The parser the renderer uses: the same one the editor's language is built from. */
export const parser = baseParser.configure(EXTENSIONS);
