// What the toolbar, the keys and the `/` menu do to the text: each a CodeMirror command (true when it did something), one undo step.
import { EditorSelection, type ChangeSpec, type EditorState, type SelectionRange } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { toggleInline } from "./behaviors/format-toggle";
import { toggleCheckbox } from "./behaviors/task-toggle";

export type Command = (view: EditorView) => boolean;

/** The names of every format and insert command, for `editor.run(name)`, the toolbar and the `/` menu. */
export type FormatName =
  | "bold" | "italic" | "strike" | "highlight" | "code" | "math" | "link"
  | "heading1" | "heading2" | "heading3" | "heading4" | "paragraph"
  | "bulletList" | "orderedList" | "taskList" | "toggleTask" | "quote" | "codeBlock" | "table" | "rule" | "callout" | "mathBlock";

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
export const linesOf = (state: EditorState, ranges: readonly SelectionRange[] = state.selection.ranges) => {
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
/**
 * Turn into a block: with words selected, the whole lines they are on become the block's content (never lost); with none, the empty block
 * at the cursor (`empty`). The result is selected, as Turn into leaves it.
 */
function blockOf(make: (lines: string[]) => string, empty: Command): Command {
  return (view) => {
    const { state } = view;
    const r = state.selection.main;
    if (r.empty) return empty(view);
    const first = state.doc.lineAt(r.from), last = state.doc.lineAt(r.to);
    const lines = state.sliceDoc(first.from, last.to).split("\n");
    const insert = make(lines);
    view.dispatch(state.update({ changes: { from: first.from, to: last.to, insert }, selection: EditorSelection.range(first.from, first.from + insert.length), scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}
/** A line's own words: its quote, list or heading mark taken off. */
const bare = (l: string): string => l.replace(LINE_MARK, "$1").trim();
export const codeBlock: Command = blockOf((ls) => `\`\`\`\n${ls.join("\n")}\n\`\`\``, insertBlock("```\n\n```", 4));
/** One row per selected line (cells apart by tabs, as a sheet copies them), under a heading row of Column 1, Column 2, …. */
export const table: Command = blockOf((ls) => {
  const rows = ls.filter((l) => l.trim()).map((l) => (/\t/.test(l) ? l.split("\t") : [bare(l)]).map((c) => c.trim().replace(/(?<!\\)\|/g, "\\|")));
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const row = (cells: string[]): string => `| ${Array.from({ length: cols }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  return [row(Array.from({ length: cols }, (_, i) => `Column ${i + 1}`)), `| ${Array<string>(cols).fill("---").join(" | ")} |`, ...rows.map(row)].join("\n");
}, insertBlock("| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n", 0));
export const rule: Command = insertBlock("---\n", 0);
export const callout: Command = blockOf((ls) => ["> [!note]", ...ls.map((l) => `> ${l.replace(/^\s*>\s?/, "")}`)].join("\n"), insertBlock("> [!note]\n> ", 0));
export const mathBlock: Command = blockOf((ls) => `$$\n${ls.join("\n")}\n$$`, insertBlock("$$\n\n$$", 3));

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

