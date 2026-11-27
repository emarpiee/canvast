// Behaviour: ( [ { typed with nothing selected close themselves, a closing one typed before its twin steps over it; quotes only in code
// (as notes apps do).
import type { EditorState, Extension, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

/** Brackets typed with nothing selected close themselves (quotes only in code); a closing one typed before its twin steps over it. */
export function autoPair(state: EditorState, text: string, inCode: (pos: number) => boolean): TransactionSpec | null {
  const r = state.selection.main;
  if (state.selection.ranges.length > 1 || !r.empty) return null;
  const next = state.sliceDoc(r.from, r.from + 1);
  const opens: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const quote = text === '"' || text === "'";
  if ((text === ")" || text === "]" || text === "}" || (quote && inCode(r.from))) && next === text) return { selection: { anchor: r.from + 1 }, userEvent: "input.type" };
  const close = opens[text] ?? (quote && inCode(r.from) ? text : undefined);
  if (!close || /\w/.test(next)) return null;
  return { changes: { from: r.from, insert: text + close }, selection: { anchor: r.from + 1 }, userEvent: "input.type" };
}

/** Whether `pos` is in code (a code block or a code span): quotes pair there. */
const inCode = (state: EditorState, pos: number): boolean => {
  for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) if (/^(FencedCode|CodeBlock|InlineCode)$/.test(n.name)) return true;
  return false;
};

/** The behaviour, for the editor. */
export const autoPairs: Extension = EditorView.inputHandler.of((view, _from, _to, text) => {
  const spec = autoPair(view.state, text, (pos) => inCode(view.state, pos));
  return spec ? (view.dispatch(spec), true) : false;
});
