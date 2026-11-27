// Behaviour: a format key (Ctrl+B, Ctrl+I, Ctrl+E…) or button with nothing selected. Inside a span of that format its marks come off; inside
// a word the word takes the format, the cursor staying where it was in it (as canvast's first notes editor did); elsewhere an empty pair
// goes in with the cursor between, pressed again it goes, and just before the closing mark of a span being typed the cursor steps out (as
// notes apps do). With words selected: marks round them, or off when they are there. Test: notes.spec "selected words".
import { EditorSelection, type EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { Command } from "../commands";

/** The markers a format can be, longest first (an empty `****` is bold, not two italics). */
const MARKERS = ["**", "~~", "==", "*", "_", "`", "$"];

/** An empty pair of `m` at `at` (`**|**`). */
const emptyPairAt = (state: EditorState, at: number, m: string): boolean => state.sliceDoc(at - m.length, at) === m && state.sliceDoc(at, at + m.length) === m;
/** Whether the text before the cursor on its line leaves `m` open (an odd count; a lone `*` not touching another). */
function insideOpen(text: string, m: string): boolean {
  let count = 0;
  for (let i = text.indexOf(m); i >= 0; i = text.indexOf(m, i + m.length)) if (m !== "*" || (text[i - 1] !== "*" && text[i + 1] !== "*")) count++;
  return count % 2 === 1;
}

/** The node each format's marks make. */
const FORMAT_NODE: Readonly<Record<string, string>> = { "**": "StrongEmphasis", "*": "Emphasis", _: "Emphasis", "~~": "Strikethrough", "==": "Highlight", "`": "InlineCode", $: "InlineMath" };
/** The span of format `m` round `pos` (its marks' lengths), or null. */
function spanAt(state: EditorState, pos: number, m: string): { from: number; to: number; open: number; close: number } | null {
  const name = FORMAT_NODE[m];
  for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 0); n; n = n.parent) {
    if (n.name !== name) continue;
    const first = n.firstChild, last = n.lastChild;
    if (!first || !last || first === last) return null;
    if (pos <= first.from || pos >= last.to) return null;
    return { from: n.from, to: n.to, open: first.to - first.from, close: last.to - last.from };
  }
  return null;
}
/** The word the cursor is inside (letters on both sides), or null at a word's edge or between words. */
function wordAround(state: EditorState, pos: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(pos);
  const at = pos - line.from, t = line.text;
  const isWord = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}_'’-]/u.test(c);
  if (!isWord(t[at - 1]) || !isWord(t[at])) return null;
  let a = at, b = at;
  while (a > 0 && isWord(t[a - 1])) a--;
  while (b < t.length && isWord(t[b])) b++;
  return { from: line.from + a, to: line.from + b };
}

/**
 * A format's marks round the selection, or off it when they are there (just outside it, or selected with it). With nothing selected: inside
 * a span of the format its marks come off; inside a word the word takes it; elsewhere an empty pair, the cursor between (pressed again, the
 * pair goes), and just before the closing mark of a span being typed, the cursor steps out.
 */
export function toggleInline(m: string): Command {
  return (view) => {
    const { state } = view;
    view.dispatch(
      state.update(
        state.changeByRange((r) => {
          const { from, to } = r;
          if (from === to) {
            // (the cursor inside a span of this format: its marks come off; inside a word: the word takes the format, the cursor where it was)
            const span = spanAt(state, from, m);
            if (span) return { changes: [{ from: span.from, to: span.from + span.open }, { from: span.to - span.close, to: span.to }], range: EditorSelection.cursor(from - span.open) };
            const word = wordAround(state, from);
            if (word) return { changes: [{ from: word.from, insert: m }, { from: word.to, insert: m }], range: EditorSelection.cursor(from + m.length) };
            if (state.sliceDoc(from, from + m.length) === m) {
              if (emptyPairAt(state, from, m) && !MARKERS.some((w) => w.length > m.length && emptyPairAt(state, from, w))) return { changes: { from: from - m.length, to: from + m.length }, range: EditorSelection.cursor(from - m.length) };
              const line = state.doc.lineAt(from);
              if (insideOpen(state.sliceDoc(line.from, from), m)) return { range: EditorSelection.cursor(from + m.length) };
            }
            return { changes: { from, insert: m + m }, range: EditorSelection.cursor(from + m.length) };
          }
          if (state.sliceDoc(from - m.length, from) === m && state.sliceDoc(to, to + m.length) === m) {
            return { changes: [{ from: from - m.length, to: from }, { from: to, to: to + m.length }], range: EditorSelection.range(from - m.length, to - m.length) };
          }
          const sel = state.sliceDoc(from, to);
          if (sel.length >= 2 * m.length && sel.startsWith(m) && sel.endsWith(m)) return { changes: { from, to, insert: sel.slice(m.length, -m.length) }, range: EditorSelection.range(from, to - 2 * m.length) };
          return { changes: [{ from, insert: m }, { from: to, insert: m }], range: EditorSelection.range(from + m.length, to + m.length) };
        }),
        { scrollIntoView: true, userEvent: "input.format" },
      ),
    );
    return true;
  };
}
