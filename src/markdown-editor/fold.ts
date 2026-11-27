// Folding: a heading folds what is under it up to the next heading of its level or higher, a list item its indented children, a callout
// what is under its title. An arrow beside each (shown on the line under the pointer or the cursor, and while folded) folds and unfolds it;
// Ctrl+Alt+F and Ctrl+Alt+U fold and unfold at the cursor. A callout written `> [!type]-` starts folded.
import { codeFolding, foldEffect, foldService, foldedRanges, syntaxTree, unfoldEffect } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";

const HEADING = /^(#{1,6})\s/;
const CALLOUT = /^\s*>\s?\[!\w+\]([-+])?/;

/** What folds under the line starting at `from`, or null. */
export function foldRangeAt(state: EditorState, from: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(from);
  const h = HEADING.exec(line.text);
  if (h) {
    let end = state.doc.lines;
    for (let n = line.number + 1; n <= state.doc.lines; n++) {
      const m = HEADING.exec(state.doc.line(n).text);
      if (m && m[1]!.length <= h[1]!.length && !inCode(state, state.doc.line(n).from)) {
        end = n - 1;
        break;
      }
    }
    while (end > line.number && !state.doc.line(end).text.trim()) end--;
    return end > line.number ? { from: line.to, to: state.doc.line(end).to } : null;
  }
  if (CALLOUT.test(line.text)) {
    let end = line.number;
    while (end < state.doc.lines && /^\s*>/.test(state.doc.line(end + 1).text)) end++;
    return end > line.number ? { from: line.to, to: state.doc.line(end).to } : null;
  }
  // (a list item with a block under its first line)
  for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(line.from + line.text.search(/\S|$/), 1); n; n = n.parent) {
    if (n.name !== "ListItem") continue;
    if (state.doc.lineAt(n.from).number !== line.number) return null;
    for (let c = n.firstChild; c; c = c.nextSibling) if (c.from > line.to && c.name !== "ListMark") return n.to > line.to ? { from: line.to, to: state.doc.lineAt(n.to).to } : null;
    return null;
  }
  return null;
}
const inCode = (state: EditorState, pos: number): boolean => {
  for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) if (n.name === "FencedCode" || n.name === "CodeBlock") return true;
  return false;
};

const foldedAt = (state: EditorState, r: { from: number; to: number }): boolean => {
  let found = false;
  foldedRanges(state).between(r.from, r.from, (a, b) => void (a === r.from && b === r.to && (found = true)));
  return found;
};

class Arrow extends WidgetType {
  constructor(readonly folded: boolean, readonly at: number) {
    super();
  }
  override eq(o: Arrow): boolean {
    return o.folded === this.folded && o.at === this.at;
  }
  override toDOM(view: EditorView): HTMLElement {
    const b = document.createElement("span");
    b.className = `me-fold${this.folded ? " is-folded" : ""}`;
    b.setAttribute("aria-hidden", "true");
    b.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    // view-state: (folds or unfolds what is under the line: only what is shown changes)
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const r = foldRangeAt(view.state, this.at);
      if (r) view.dispatch({ effects: (foldedAt(view.state, r) ? unfoldEffect : foldEffect).of(r) });
    });
    return b;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

const arrows = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state) || u.transactions.some((t) => t.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)))) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const out: Range<Decoration>[] = [];
      const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = view.state.doc.lineAt(pos);
          if ((HEADING.test(line.text) || CALLOUT.test(line.text) || /^\s*([-*+]|\d+[.)])\s/.test(line.text)) && !inCode(view.state, line.from)) {
            const r = foldRangeAt(view.state, line.from);
            if (r) {
              const folded = foldedAt(view.state, r);
              out.push(Decoration.line({ class: `me-foldable${line.number === cursorLine ? " me-fold-cursor" : ""}${folded ? " me-folded" : ""}` }).range(line.from));
              out.push(Decoration.widget({ widget: new Arrow(folded, line.from), side: -1 }).range(line.from));
            }
          }
          pos = line.to + 1;
        }
      }
      return Decoration.set(out, true);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Fold or unfold what is under the cursor's line. */
export const foldAtCursor = (fold: boolean) => (view: EditorView): boolean => {
  const r = foldRangeAt(view.state, view.state.doc.lineAt(view.state.selection.main.head).from);
  if (!r || foldedAt(view.state, r) === fold) return false;
  view.dispatch({ effects: (fold ? foldEffect : unfoldEffect).of(r) });
  return true;
};

/** Callouts written folded (`> [!note]-`) start folded. */
export function initialFolds(view: EditorView): void {
  const effects = [];
  for (let n = 1; n <= view.state.doc.lines; n++) {
    const line = view.state.doc.line(n);
    const m = CALLOUT.exec(line.text);
    if (m?.[1] === "-") {
      const r = foldRangeAt(view.state, line.from);
      if (r) effects.push(foldEffect.of(r));
    }
  }
  if (effects.length) view.dispatch({ effects });
}

export const folding: Extension = [
  foldService.of((state, lineStart) => foldRangeAt(state, lineStart)),
  codeFolding({ placeholderText: "…" }),
  arrows,
];
