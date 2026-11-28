// Behaviour: Clear formatting (the selection bar's last button, as notes apps have it): the selected words lose their inline marks (bold,
// italic, strikethrough, highlight in any colour, code, math), the words themselves and their links kept. Test: notes.spec "selected words".
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** The inline marks taken off: `**`, `__`, `*`, `_`, `~~`, `==`, `` ` ``, `$`, and `<mark class="hl-…">…</mark>`. */
export function stripMarks(text: string): string {
  return text
    .replace(/<mark(?:\s+class="hl-\w+")?>([\s\S]*?)<\/mark>/g, "$1")
    .replace(/(\*\*|__|~~|==)([\s\S]*?)\1/g, "$2")
    .replace(/(?<![\w*])([*_])(?!\s)([^*_\n]+?)(?<!\s)\1(?![\w*])/g, "$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\$([^$\n]+)\$/g, "$1");
}

/** Clear the formatting of the selection (each range), its marks just outside it too. */
export function clearFormat(view: EditorView): boolean {
  const { state } = view;
  view.dispatch(
    state.changeByRange((r) => {
      if (r.empty) return { range: r };
      // (the marks round the selection belong to it: `**words**` with only the words selected)
      let from = r.from, to = r.to;
      for (const m of ["**", "~~", "==", "*", "_", "`", "$"]) {
        if (state.sliceDoc(from - m.length, from) === m && state.sliceDoc(to, to + m.length) === m) (from -= m.length), (to += m.length);
      }
      const open = /<mark(?:\s+class="hl-\w+")?>$/.exec(state.sliceDoc(Math.max(0, from - 40), from));
      if (open && state.sliceDoc(to, to + 7) === "</mark>") (from -= open[0].length), (to += 7);
      const insert = stripMarks(state.sliceDoc(from, to));
      return { changes: { from, to, insert }, range: EditorSelection.range(from, from + insert.length) };
    }),
    { userEvent: "input.format" },
  );
  return true;
}
