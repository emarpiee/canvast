// What the toolbar, the keys and the `/` menu do to the text: each a CodeMirror command (true when it did something), one undo step.
import { EditorSelection, type ChangeSpec, type EditorState, type SelectionRange, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export type Command = (view: EditorView) => boolean;

/** The names of every format and insert command, for `editor.run(name)`, the toolbar and the `/` menu. */
export type FormatName =
  | "bold" | "italic" | "strike" | "highlight" | "code" | "link"
  | "heading1" | "heading2" | "heading3" | "paragraph"
  | "bulletList" | "orderedList" | "taskList" | "toggleTask" | "quote" | "codeBlock" | "table" | "rule";

const WORD = /[\p{L}\p{N}_'’-]/u;

/** The word round an empty cursor, or the range itself. */
function wordAt(state: EditorState, r: SelectionRange): { from: number; to: number } {
  if (!r.empty) return { from: r.from, to: r.to };
  const line = state.doc.lineAt(r.head);
  let from = r.head, to = r.head;
  while (from > line.from && WORD.test(line.text[from - line.from - 1]!)) from--;
  while (to < line.to && WORD.test(line.text[to - line.from]!)) to++;
  return { from, to };
}

/** Put `mark` round the selection (or the word at the cursor), or take it off when it is there already. With nothing to wrap, the marks go in with the cursor between. */
export function toggleInline(mark: string, close = mark): Command {
  return (view) => {
    const { state } = view;
    const tr = state.changeByRange((r) => {
      const { from, to } = wordAt(state, r);
      const before = state.sliceDoc(from - mark.length, from), after = state.sliceDoc(to, to + close.length);
      // (already marked just outside: off)
      if (before === mark && after === close) {
        return { changes: [{ from: from - mark.length, to: from }, { from: to, to: to + close.length }], range: EditorSelection.range(r.anchor - mark.length, r.head - mark.length) };
      }
      const inside = state.sliceDoc(from, to);
      // (the marks selected with the words: off)
      if (inside.length >= mark.length + close.length && inside.startsWith(mark) && inside.endsWith(close)) {
        return { changes: { from, to, insert: inside.slice(mark.length, inside.length - close.length) }, range: EditorSelection.range(from, to - mark.length - close.length) };
      }
      const changes: ChangeSpec = [{ from, insert: mark }, { from: to, insert: close }];
      if (from === to) return { changes, range: EditorSelection.cursor(from + mark.length) };
      const shift = (p: number): number => (p >= to ? p + mark.length + close.length : p >= from ? p + mark.length : p);
      return { changes, range: r.empty ? EditorSelection.cursor(shift(r.head)) : EditorSelection.range(from + mark.length, to + mark.length) };
    });
    view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

/** `[words](address)`: the selection as a link's words, the cursor in its address. */
export const insertLink: Command = (view) => {
  const { state } = view;
  view.dispatch(
    state.update(
      state.changeByRange((r) => {
        const { from, to } = wordAt(state, r);
        const words = state.sliceDoc(from, to);
        if (/^(https?:\/\/|mailto:)\S+$/.test(words)) return { changes: { from, to, insert: `[](${words})` }, range: EditorSelection.cursor(from + 1) };
        return { changes: { from, to, insert: `[${words}]()` }, range: EditorSelection.cursor(from + words.length + 3) };
      }),
      { scrollIntoView: true, userEvent: "input.format" },
    ),
  );
  return true;
};

/** A line's block mark: a heading's `#`s, a quote's `>`, a list's `-`, `1.` or `- [ ]`. */
const LINE_MARK = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d{1,9}[.)]\s+)?/;

/** Each selected line led by `mark` (made by `make` from its number in the run), or bare again when all of them had it already (`same`). */
function lineMark(make: (n: number) => string, same: RegExp): Command {
  return (view) => {
    const { state } = view;
    const lines = new Set<number>();
    for (const r of state.selection.ranges) for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) lines.add(l);
    const list = [...lines].sort((a, b) => a - b).map((n) => state.doc.line(n));
    const allHave = list.every((l) => same.test(l.text.replace(/^\s*/, "")));
    const changes: ChangeSpec[] = [];
    list.forEach((line, i) => {
      const m = LINE_MARK.exec(line.text)!;
      const from = line.from + m[1]!.length, to = from + (m[2]?.length ?? 0);
      changes.push({ from, to, insert: allHave ? "" : make(i) });
    });
    view.dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

export const heading = (level: number): Command => lineMark(() => `${"#".repeat(level)} `, new RegExp(`^#{${level}}\\s`));
export const paragraph: Command = lineMark(() => "", /^$/);
export const bulletList = lineMark(() => "- ", /^[-*+]\s+(?!\[[ xX]\])/);
export const orderedList = lineMark((n) => `${n + 1}. `, /^\d{1,9}[.)]\s/);
export const taskList = lineMark(() => "- [ ] ", /^[-*+]\s+\[[ xX]\]\s/);
export const quote = lineMark(() => "> ", /^>/);

/** A task's box ticked or not (`- [ ]` ↔ `- [x]`) on each selected line that is a task; at `at` alone when given (a click on the box). */
export function toggleTask(view: EditorView, at?: number): boolean {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const lines = at !== undefined ? [state.doc.lineAt(at)] : state.selection.ranges.map((r) => state.doc.lineAt(r.head));
  for (const line of lines) {
    const m = /^(\s*[-*+]\s+\[)([ xX])\]/.exec(line.text);
    if (m) changes.push({ from: line.from + m[1]!.length, to: line.from + m[1]!.length + 1, insert: m[2] === " " ? "x" : " " });
  }
  if (!changes.length) return false;
  view.dispatch(state.update({ changes, userEvent: "input.task" }));
  return true;
}

/** A block inserted on lines of its own at the cursor; the cursor at `cursorAt` in it. */
function insertBlock(text: string, cursorAt: number): Command {
  return (view) => {
    const { state } = view;
    const r = state.selection.main;
    const line = state.doc.lineAt(r.from);
    const selected = state.sliceDoc(r.from, r.to);
    const body = text.replace("$SEL", selected);
    const before = line.text.slice(0, r.from - line.from).trim() ? "\n\n" : r.from > 0 && state.doc.lineAt(r.from).number > 1 && state.doc.line(line.number - 1).text.trim() ? "\n" : "";
    const insert = `${before}${body}\n`;
    view.dispatch(state.update({ changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.cursor(r.from + before.length + cursorAt + selected.length), scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}
export const codeBlock: Command = insertBlock("```\n$SEL\n```", 4);
export const table: Command = insertBlock("| Column | Column |\n| --- | --- |\n|  |  |", 2);
export const rule: Command = insertBlock("---\n", 5);

/** Every named command. */
export const COMMANDS: Readonly<Record<FormatName, Command>> = {
  bold: toggleInline("**"),
  italic: toggleInline("*"),
  strike: toggleInline("~~"),
  highlight: toggleInline("=="),
  code: toggleInline("`"),
  link: insertLink,
  heading1: heading(1),
  heading2: heading(2),
  heading3: heading(3),
  paragraph,
  bulletList,
  orderedList,
  taskList,
  toggleTask: (v) => toggleTask(v),
  quote,
  codeBlock,
  table,
  rule,
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
