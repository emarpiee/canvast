// Behaviour: Enter in a list opens the next item right below, never under a blank line of its own, even in a list with blank lines between
// its items (as notes apps do; the stock command spaces out every new item). Test: notes.spec "lists as notes apps write them".
import { Prec, type StateCommand, type Transaction } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";

/**
 * Enter in a list: the next item right below, never under a blank line of its own (the stock command spaces out every new item of a list
 * it calls loose).
 */
export const tightListEnter: StateCommand = ({ state, dispatch }) => {
  let made: Transaction | null = null;
  if (!insertNewlineContinueMarkup({ state, dispatch: (tr) => void (made = tr) })) return false;
  const tr = made as Transaction | null;
  if (!tr) return false;
  let fixed: { from: number; to: number; insert: string } | null = null;
  let count = 0;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    count++;
    const text = inserted.toString();
    const m = /^(\n[ \t>]*)(\n[ \t>]*(?:[-*+]|\d+[.)])[ \t].*)$/s.exec(text);
    if (m) fixed = { from: fromA, to: toA, insert: m[2]! };
  });
  const f = fixed as { from: number; to: number; insert: string } | null;
  if (count !== 1 || !f) return dispatch(tr), true;
  dispatch(state.update({ changes: f, selection: { anchor: f.from + f.insert.length }, scrollIntoView: true, userEvent: "input" }));
  return true;
};

/** The behaviour, for the editor: before the stock Markdown keys. */
export const listEnter = Prec.high(keymap.of([{ key: "Enter", run: tightListEnter }]));
