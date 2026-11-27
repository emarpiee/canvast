// Behaviour: Alt+Q (Ctrl+Q on a Mac) joins a hard-wrapped paragraph into one line, so the editor wraps it (as notes apps do).
import type { Command } from "../commands";

/** Alt+Q: the paragraph the cursor is in joined into one line (a hard-wrapped one, so the editor wraps it). */
export const reflowParagraph: Command = (view) => {
  const { state } = view;
  const isProse = (t: string): boolean => !!t.trim() && !/^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\||<)/.test(t);
  let first = state.doc.lineAt(state.selection.main.head).number;
  if (!isProse(state.doc.line(first).text)) return false;
  let last = first;
  while (first > 1 && isProse(state.doc.line(first - 1).text)) first--;
  while (last < state.doc.lines && isProse(state.doc.line(last + 1).text)) last++;
  if (first === last) return false;
  const from = state.doc.line(first).from, to = state.doc.line(last).to;
  view.dispatch({ changes: { from, to, insert: state.sliceDoc(from, to).split("\n").map((l) => l.trim()).join(" ") }, userEvent: "input.reflow" });
  return true;
};
