// What the toolbar, the keys and the `/` menu do to the text: each a CodeMirror command (true when it did something), one undo step.
import { EditorSelection, EditorState, type ChangeSpec, type Extension, type SelectionRange, type StateCommand, type Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";

export type Command = (view: EditorView) => boolean;

/** The names of every format and insert command, for `editor.run(name)`, the toolbar and the `/` menu. */
export type FormatName =
  | "bold" | "italic" | "strike" | "highlight" | "code" | "math" | "link"
  | "heading1" | "heading2" | "heading3" | "heading4" | "paragraph"
  | "bulletList" | "orderedList" | "taskList" | "toggleTask" | "quote" | "codeBlock" | "table" | "rule" | "callout" | "mathBlock";

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

/** `[selection]()`, the cursor between the brackets of the address. */
export const insertLink: Command = (view) => {
  const { state } = view;
  view.dispatch(state.update(state.changeByRange((r) => {
    const words = state.sliceDoc(r.from, r.to);
    return { changes: { from: r.from, to: r.to, insert: `[${words}]()` }, range: EditorSelection.cursor(r.from + words.length + 3) };
  }), { scrollIntoView: true, userEvent: "input.format" }));
  return true;
};

/** A line's block mark: a heading's `#`, a quote's `>`, a list's `-`, `1.` or `- [ ]` (any task state). */
const LINE_MARK = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX>/-]\]\s+|[-*+]\s+|\d{1,9}[.)]\s+)?/;
const linesOf = (state: EditorState, ranges: readonly SelectionRange[] = state.selection.ranges) => {
  const set = new Set<number>();
  for (const r of ranges) for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) set.add(l);
  return [...set].sort((a, b) => a - b).map((n) => state.doc.line(n));
};

/** Each selected line turned into a block (its old mark replaced), or back to text when all of them were that block already. */
function lineMark(make: (n: number) => string, same: RegExp): Command {
  return (view) => {
    const { state } = view;
    const list = linesOf(state);
    const allHave = list.every((l) => same.test(l.text.replace(/^\s*/, "")));
    const changes: ChangeSpec[] = list.map((line, i) => {
      const m = LINE_MARK.exec(line.text)!;
      const from = line.from + m[1]!.length;
      return { from, to: from + (m[2]?.length ?? 0), insert: allHave ? "" : make(i) };
    });
    const set = state.changes(changes);
    // (the cursor after what went in at a line's start, so typing goes on after the mark)
    view.dispatch(state.update({ changes: set, selection: state.selection.map(set, 1), scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

export const heading = (level: number): Command => lineMark(() => `${"#".repeat(level)} `, new RegExp(`^#{${level}}\\s`));
export const paragraph: Command = lineMark(() => "", /^$/);
export const bulletList = lineMark(() => "- ", /^[-*+]\s+(?!\[[ xX>/-]\])/);
export const orderedList = lineMark((n) => `${n + 1}. `, /^\d{1,9}[.)]\s/);
export const taskList = lineMark(() => "- [ ] ", /^[-*+]\s+\[[ xX>/-]\]\s/);
export const quote = lineMark(() => "> ", /^>/);

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

/** A block on lines of its own at the cursor; the cursor `back` characters before its end (or after it). */
export function insertBlock(text: string, back = 0): Command {
  return (view) => {
    const { state } = view;
    const r = state.selection.main;
    const line = state.doc.lineAt(r.from);
    const before = line.text.slice(0, r.from - line.from).trim() ? "\n\n" : r.from === line.from && line.number > 1 && state.doc.line(line.number - 1).text.trim() ? "\n" : "";
    const after = state.sliceDoc(r.to, state.doc.lineAt(r.to).to).trim() ? "\n\n" : "";
    const insert = `${before}${text}${after}`;
    view.dispatch(state.update({ changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.cursor(r.from + before.length + text.length - back), scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}
export const codeBlock: Command = insertBlock("```\n\n```", 4);
export const table: Command = insertBlock("| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n", 0);
export const rule: Command = insertBlock("---\n", 0);
export const callout: Command = insertBlock("> [!note]\n> ", 0);
export const mathBlock: Command = insertBlock("$$\n\n$$", 3);

/** Every named command. */
export const COMMANDS: Readonly<Record<FormatName, Command>> = {
  bold: toggleInline("**"),
  italic: toggleInline("*"),
  strike: toggleInline("~~"),
  highlight: toggleInline("=="),
  code: toggleInline("`"),
  math: toggleInline("$"),
  link: insertLink,
  heading1: heading(1),
  heading2: heading(2),
  heading3: heading(3),
  heading4: heading(4),
  paragraph,
  bulletList,
  orderedList,
  taskList,
  toggleTask: toggleCheckbox,
  quote,
  codeBlock,
  table,
  rule,
  callout,
  mathBlock,
};

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

/** Numbered lists keep counting in order whatever is moved, pasted or deleted in them: the touched lists are numbered again in the same step. */
export const renumberLists: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.isUserEvent("undo") || tr.isUserEvent("redo")) return tr;
  const doc = tr.newDoc;
  const touched = new Set<number>();
  const ranges: Array<[number, number]> = [];
  tr.changes.iterChangedRanges((_a, _b, fromB, toB) => {
    ranges.push([fromB, toB]);
    for (let l = doc.lineAt(fromB).number; l <= doc.lineAt(Math.min(toB, doc.length)).number; l++) touched.add(l);
  });
  /** Whether a change put this line's start in (a line moved, pasted or left in the first place by a deletion): its number was not written there. */
  const placed = (n: number): boolean => ranges.some(([f, t]) => f <= doc.line(n).from && t > doc.line(n).from && t - f > 1);
  const item = (n: number) => (n >= 1 && n <= doc.lines ? /^(\s*(?:>\s?)*)(\d{1,9})([.)])(\s)/.exec(doc.line(n).text) : null);
  const changes: ChangeSpec[] = [];
  const done = new Set<number>();
  for (const t of touched) {
    // (the list round a touched line: items of its indent, met going up and down until a line that is not one)
    let n = item(t) ? t : item(t + 1) ? t + 1 : item(t - 1) ? t - 1 : 0;
    if (!n || done.has(n)) continue;
    const indent = item(n)![1]!;
    const sameList = (k: number): boolean => {
      const m = item(k);
      return !!m && m[1] === indent;
    };
    const skip = (k: number, dir: number): number => {
      while (k >= 1 && k <= doc.lines && !item(k) && /^\s+\S/.test(doc.line(k).text) && doc.line(k).text.search(/\S/) > indent.length) k += dir;
      return k;
    };
    let first = n;
    for (let k = skip(n - 1, -1); sameList(k); k = skip(k - 1, -1)) first = k;
    let num = Number(item(first)![2]);
    if (placed(first) && doc.lines !== tr.startState.doc.lines) num = 1;
    for (let k = first; sameList(k); k = skip(k + 1, 1)) {
      done.add(k);
      const m = item(k)!;
      const line = doc.line(k);
      if (Number(m[2]) !== num) changes.push({ from: line.from + m[1]!.length, to: line.from + m[1]!.length + m[2]!.length, insert: String(num) });
      num++;
    }
  }
  return changes.length ? [tr, { changes, sequential: true }] : tr;
});
