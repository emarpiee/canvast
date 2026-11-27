// Behaviour: Alt+Up and Alt+Down move the line (or the selected lines) up or down, the Markdown reordered in the file (as notes apps do).
// Test: notes.spec "lists as notes apps write them".
import { moveLineDown, moveLineUp } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

export const moveLines = keymap.of([
  { key: "Alt-ArrowUp", run: moveLineUp },
  { key: "Alt-ArrowDown", run: moveLineDown },
]);
