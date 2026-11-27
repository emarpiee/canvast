// Behaviour: a pair's sign typed over selected words goes round them and they stay selected, so a second `*` makes them bold (as canvast's
// first notes editor did; Settings > Notes > Auto-surround selected text). Table cells do it too (table.ts). Test: notes.spec "selected words".
import { EditorSelection, type EditorState, type Extension, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** What a sign typed over selected words puts round them. */
export const WRAP_PAIRS: Readonly<Record<string, string>> = { '"': '"', "'": "'", "(": ")", "[": "]", "{": "}", "<": ">", "“": "”", "‘": "’", "«": "»", "*": "*", _: "_", "~": "~", "`": "`", "=": "=" };

/** Typed over selected words: the sign goes round them and they stay selected (a second `*` makes them bold). Null when it does not apply. */
export function wrapTyped(state: EditorState, text: string): Transaction | null {
  const close = WRAP_PAIRS[text];
  if (!close || state.selection.ranges.every((r) => r.empty)) return null;
  return state.update(
    state.changeByRange((r) => (r.empty ? { range: r } : { changes: [{ from: r.from, insert: text }, { from: r.to, insert: close }], range: EditorSelection.range(r.from + text.length, r.to + text.length) })),
    { userEvent: "input.type" },
  );
}

/** The behaviour, for the editor (`plain`: in plain text the Markdown marks are only signs). */
export const wrapSelection = (plain: boolean): Extension =>
  EditorView.inputHandler.of((view, _from, _to, text) => {
    if (plain && /[*_~`=]/.test(text)) return false;
    const tr = wrapTyped(view.state, text);
    return tr ? (view.dispatch(tr), true) : false;
  });
