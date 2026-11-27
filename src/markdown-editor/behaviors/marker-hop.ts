// Behaviour: Alt+] and Alt+[ (Ctrl+. and Ctrl+, on a Mac) step the cursor over the next or previous run of marks on its line, to leave a
// formatted word without the arrow keys (as notes apps do).
import type { Command } from "../commands";

/** The marks a cursor hops over. */
const HOP = /[*_~=`$]+/g;
/** Alt+] and Alt+[: the cursor to the far side of the next (or previous) run of marks on its line. */
export const hopMarker = (dir: 1 | -1): Command => (view) => {
  const { state } = view;
  const r = state.selection.main;
  const line = state.doc.lineAt(r.head);
  const at = r.head - line.from;
  let target: number | null = null;
  for (const m of line.text.matchAll(HOP)) {
    const a = m.index!, b = a + m[0].length;
    if (dir > 0 && b > at && (a >= at || at < b)) {
      target = b;
      break;
    }
    if (dir < 0 && a < at) target = a;
  }
  if (target === null) return false;
  view.dispatch({ selection: { anchor: line.from + target }, scrollIntoView: true });
  return true;
};
