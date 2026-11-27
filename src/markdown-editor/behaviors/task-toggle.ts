// Behaviour: Ctrl+L makes a line a task and ticks it (as notes apps do); a click on a drawn box ticks it. Test: notes.spec "lists as notes
// apps write them".
import type { ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { linesOf, type Command } from "../commands";

/**
 * Ctrl+L: on each selected line, a task box ticked (`[ ]` and `[/]` → `[x]`) or unticked (`[x]` → `[ ]`); a line with none gets one (a list
 * item after its mark, any other after its indent and quote marks). Forwarded `[>]` and cancelled `[-]` are left as they are.
 */
export const toggleCheckbox: Command = (view) => {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  for (const line of linesOf(state)) {
    const task = /^(\s*(?:>\s?)*\s*[-*+]\s+\[)([ xX/>-])\]/.exec(line.text);
    if (task) {
      const at = line.from + task[1]!.length;
      if (task[2] === ">" || task[2] === "-") continue;
      changes.push({ from: at, to: at + 1, insert: /[xX]/.test(task[2]!) ? " " : "x" });
      continue;
    }
    const list = /^(\s*(?:>\s?)*\s*)([-*+]|\d{1,9}[.)])(\s+)/.exec(line.text);
    if (list) changes.push({ from: line.from + list[0].length, insert: "[ ] " });
    else {
      const lead = /^(\s*(?:>\s?)*\s*)/.exec(line.text)![0];
      changes.push({ from: line.from + lead.length, insert: "- [ ] " });
    }
  }
  if (!changes.length) return false;
  view.dispatch(state.update({ changes, userEvent: "input.task" }));
  return true;
};

/** A task's box at `at` ticked or not (a click on the box): `[ ]`/`[/]` ↔ `[x]`. */
export function toggleTask(view: EditorView, at: number): boolean {
  const line = view.state.doc.lineAt(at);
  const m = /^(\s*(?:>\s?)*\s*[-*+]\s+\[)([ xX/])\]/.exec(line.text);
  if (!m) return false;
  const pos = line.from + m[1]!.length;
  view.dispatch({ changes: { from: pos, to: pos + 1, insert: /[xX]/.test(m[2]!) ? " " : "x" }, userEvent: "input.task" });
  return true;
}
