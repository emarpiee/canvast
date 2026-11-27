// How Markdown reads in both editing modes: headings at their sizes, emphasis, strong, struck and highlighted words, links in the accent,
// inline code as a chip, marks quieter, and code blocks in the code font. Live mode hides the marks on top of this; source mode shows them.
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import type { Extension, Range } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const style = HighlightStyle.define([
  { tag: t.heading1, class: "me-t-h1" },
  { tag: t.heading2, class: "me-t-h2" },
  { tag: t.heading3, class: "me-t-h3" },
  { tag: t.heading4, class: "me-t-h4" },
  { tag: t.heading5, class: "me-t-h5" },
  { tag: t.heading6, class: "me-t-h6" },
  { tag: t.emphasis, class: "me-t-em" },
  { tag: t.strong, class: "me-t-strong" },
  { tag: t.strikethrough, class: "me-t-strike" },
  { tag: t.special(t.content), class: "me-t-hl" },
  { tag: [t.link, t.url], class: "me-t-link" },
  { tag: t.monospace, class: "me-t-mono" },
  { tag: t.quote, class: "me-t-quote" },
  { tag: [t.processingInstruction, t.contentSeparator, t.meta], class: "me-t-mark" },
  { tag: t.labelName, class: "me-t-tag" },
]);

/** Code blocks' lines in the code font (their tokens are coloured by `code.ts`). */
const codeLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const out: Range<Decoration>[] = [];
      const line = Decoration.line({ class: "me-code-line" });
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (n) => {
            if (n.name !== "FencedCode" && n.name !== "CodeBlock") return;
            const a = view.state.doc.lineAt(n.from).number, b = view.state.doc.lineAt(Math.max(n.from, n.to - 1)).number;
            for (let l = a; l <= b; l++) out.push(line.range(view.state.doc.line(l).from));
            return false;
          },
        });
      }
      return Decoration.set(out, true);
    }
  },
  { decorations: (v) => v.decorations },
);

/** List items hang: a wrapped line starts under the item's words, not under its mark. */
const LIST_LINE = /^(\s*(?:>\s?)*\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX/>-]\]\s+)?)/;
const hangingLists = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const out: Range<Decoration>[] = [];
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = view.state.doc.lineAt(pos);
          pos = line.to + 1;
          const m = LIST_LINE.exec(line.text);
          if (m) out.push(Decoration.line({ class: "me-list-line", attributes: { style: `--me-hang: ${m[1]!.replace(/\t/g, "    ").length}ch` } }).range(line.from));
        }
      }
      return Decoration.set(out, true);
    }
  },
  { decorations: (v) => v.decorations },
);

export const markdownLook: Extension = [syntaxHighlighting(style), codeLines, hangingLists];
