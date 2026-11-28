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

/** What a format never cuts into: a link, a wiki link, a picture, an address, code and math (a format's marks go round the whole of it). */
const ATOMS = /^(Link|WikiLink|Embed|Image|Autolink|URL|InlineCode|InlineMath)$/;
/** The atom `pos` is strictly inside, or null. */
function atomAt(state: EditorState, pos: number): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 0); n; n = n.parent) if (ATOMS.test(n.name) && n.from < pos && pos < n.to) found = { from: n.from, to: n.to };
  return found;
}
/** A line's block mark (heading, quote, list, task) and the spaces after it: a format starts after them. */
const LEAD = /^\s*(?:(?:>\s?)+)?\s*(?:#{1,6}\s+|[-*+]\s+\[[ xX>/-]\]\s+|[-*+]\s+|\d{1,9}[.)]\s+)?/;

/**
 * The parts of a selection a format takes: its ends moved out of any link, picture, code or math they fall in (never cut into one), one part
 * per line (a format's marks do not run across lines), each without its line's block mark and the spaces at its ends.
 */
function partsOf(state: EditorState, from: number, to: number): Array<{ from: number; to: number }> {
  from = atomAt(state, from)?.from ?? from;
  to = atomAt(state, to)?.to ?? to;
  const out: Array<{ from: number; to: number }> = [];
  for (let l = state.doc.lineAt(from).number; l <= state.doc.lineAt(to).number; l++) {
    const line = state.doc.line(l);
    let a = Math.max(from, line.from + (LEAD.exec(line.text)?.[0].length ?? 0)), b = Math.min(to, line.to);
    while (a < b && /\s/.test(state.sliceDoc(a, a + 1))) a++;
    while (b > a && /\s/.test(state.sliceDoc(b - 1, b))) b--;
    if (b > a) out.push({ from: a, to: b });
  }
  return out;
}
/** Whether a part already has format `m`: its marks just outside it, or selected with it. */
const hasMarks = (state: EditorState, p: { from: number; to: number }, m: string): "outside" | "inside" | null => {
  if (state.sliceDoc(p.from - m.length, p.from) === m && state.sliceDoc(p.to, p.to + m.length) === m) return "outside";
  const t = state.sliceDoc(p.from, p.to);
  return t.length >= 2 * m.length && t.startsWith(m) && t.endsWith(m) ? "inside" : null;
};

/**
 * A format's marks round the selection, or off it when they are there (just outside it, or selected with it): round each of its lines, a
 * link, wiki link, picture or code it touches taken whole. With nothing selected: in a link (or picture, code) the whole of it takes the
 * format; inside a span of the format its marks come off; inside a word the word takes it; elsewhere an empty pair, the cursor between
 * (pressed again, the pair goes), and just before the closing mark of a span being typed, the cursor steps out.
 */
export function toggleInline(m: string): Command {
  return (view) => {
    const { state } = view;
    view.dispatch(
      state.update(
        state.changeByRange((r) => {
          const { from, to } = r;
          if (from === to) {
            // (the cursor inside a span of this format: its marks come off)
            const span = spanAt(state, from, m);
            // (just before the closing mark of the span being typed, `*x|*`: the cursor steps out, as notes apps do)
            if (span && from === span.to - span.close) return { range: EditorSelection.cursor(span.to) };
            if (span) return { changes: [{ from: span.from, to: span.from + span.open }, { from: span.to - span.close, to: span.to }], range: EditorSelection.cursor(from - span.open) };
            // (in a link, a picture or code: the whole of it, on or off, the cursor kept in it)
            const atom = m === "`" ? null : atomAt(state, from);
            if (atom) {
              const on = hasMarks(state, atom, m) === "outside";
              const changes = on ? [{ from: atom.from - m.length, to: atom.from }, { from: atom.to, to: atom.to + m.length }] : [{ from: atom.from, insert: m }, { from: atom.to, insert: m }];
              return { changes, range: EditorSelection.cursor(from + (on ? -m.length : m.length)) };
            }
            // (inside a word: the word takes the format, the cursor where it was)
            const word = wordAround(state, from);
            if (word) return { changes: [{ from: word.from, insert: m }, { from: word.to, insert: m }], range: EditorSelection.cursor(from + m.length) };
            if (state.sliceDoc(from, from + m.length) === m) {
              if (emptyPairAt(state, from, m) && !MARKERS.some((w) => w.length > m.length && emptyPairAt(state, from, w))) return { changes: { from: from - m.length, to: from + m.length }, range: EditorSelection.cursor(from - m.length) };
              const line = state.doc.lineAt(from);
              if (insideOpen(state.sliceDoc(line.from, from), m)) return { range: EditorSelection.cursor(from + m.length) };
            }
            return { changes: { from, insert: m + m }, range: EditorSelection.cursor(from + m.length) };
          }
          const parts = partsOf(state, from, to);
          if (!parts.length) return { range: r };
          // (all its parts have the format: it comes off each; else each part without it takes it)
          const off = parts.every((p) => hasMarks(state, p, m));
          const changes: Array<{ from: number; to?: number; insert?: string }> = [];
          for (const p of parts) {
            const has = hasMarks(state, p, m);
            if (off && has === "outside") changes.push({ from: p.from - m.length, to: p.from }, { from: p.to, to: p.to + m.length });
            else if (off && has === "inside") changes.push({ from: p.from, to: p.from + m.length }, { from: p.to - m.length, to: p.to });
            else if (!off && !has) changes.push({ from: p.from, insert: m }, { from: p.to, insert: m });
          }
          const set = state.changes(changes);
          const first = parts[0]!, last = parts[parts.length - 1]!;
          const a = first.from - (off && hasMarks(state, first, m) === "outside" ? m.length : 0);
          const b = last.to + (off && hasMarks(state, last, m) === "outside" ? m.length : 0);
          return { changes: set, range: EditorSelection.range(set.mapPos(a, 1), set.mapPos(b, -1)) };
        }),
        { scrollIntoView: true, userEvent: "input.format" },
      ),
    );
    return true;
  };
}
