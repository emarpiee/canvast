// Tables in live mode: a table is drawn as a table whose cells are edited in place (Tab and Shift+Tab move between them, Enter goes down a
// row, adding one at the end, Escape leaves the table), with buttons that add a row or a column. The Markdown stays the one truth: an edited
// cell writes the whole table back as one change (one undo step). The cursor never lands in the raw pipes; source mode edits those.
import { syntaxTree } from "@codemirror/language";
import { RangeSet, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { LiveContext } from "./live";
import { mediaElement } from "./live";
import { renderMarkdown } from "./render";

type Align = "left" | "center" | "right" | "";
interface Model {
  head: string[];
  aligns: Align[];
  rows: string[][];
}

/** A row's cells, split at the pipes that are not escaped or in code. */
export function cellsOf(line: string): string[] {
  const s = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  const out: string[] = [];
  let cur = "", code = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\" && s[i + 1] === "|") (cur += "\\|"), i++;
    else if (c === "`") (code = !code), (cur += c);
    else if (c === "|" && !code) out.push(cur.trim()), (cur = "");
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function parseTable(src: string): Model {
  const lines = src.split("\n");
  const head = cellsOf(lines[0] ?? "");
  const aligns = cellsOf(lines[1] ?? "").map((d): Align => (/^:-+:$/.test(d) ? "center" : /-:$/.test(d) ? "right" : /^:-/.test(d) ? "left" : ""));
  const width = Math.max(head.length, aligns.length);
  const pad = (r: string[]): string[] => [...r, ...Array<string>(Math.max(0, width - r.length)).fill("")];
  return { head: pad(head), aligns: pad(aligns) as Align[], rows: lines.slice(2).filter((l) => l.trim()).map((l) => pad(cellsOf(l))) };
}

export function writeTable(m: Model): string {
  const row = (cells: string[]): string => `| ${cells.map((c) => c.replace(/\n/g, " ")).join(" | ")} |`;
  const sep = m.aligns.map((a) => (a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---"));
  return [row(m.head), `| ${sep.join(" | ")} |`, ...m.rows.map(row)].join("\n");
}

/** The cell each view should focus once its table is drawn again (after an edit wrote it back). */
const focusNext = new WeakMap<EditorView, { at: number; row: number; col: number }>();

class TableWidget extends WidgetType {
  constructor(readonly source: string, readonly from: number, readonly ctx: LiveContext) {
    super();
  }
  override eq(o: TableWidget): boolean {
    return o.source === this.source && o.from === this.from;
  }
  override ignoreEvent(): boolean {
    return true;
  }
  override toDOM(view: EditorView): HTMLElement {
    const model = parseTable(this.source);
    const wrap = document.createElement("div");
    wrap.className = "me-table";
    wrap.contentEditable = "false";
    const table = document.createElement("table");
    const cellAt = (row: number, col: number): HTMLElement | null => table.querySelector(`[data-r="${row}"][data-c="${col}"]`);
    /** Write the model back (one change) and focus `next` once the table is drawn again. */
    const commit = (next?: { row: number; col: number }): void => {
      const text = writeTable(model);
      if (next) focusNext.set(view, { at: this.from, ...next });
      if (text === this.source) return void (next && cellAt(next.row, next.col)?.focus());
      view.dispatch({ changes: { from: this.from, to: this.from + this.source.length, insert: text }, userEvent: "input.table" });
    };
    const read = (cell: HTMLElement): string => (cell.dataset["editing"] ? (cell.textContent ?? "").replace(/\|/g, "\\|") : cell.dataset["md"] ?? "");
    const drawCell = (cell: HTMLElement, md: string): void => {
      cell.dataset["md"] = md;
      cell.innerHTML = md ? renderMarkdown(md).replace(/^<p>|<\/p>$/g, "") : "";
      for (const img of cell.querySelectorAll("img")) img.replaceWith(mediaElement(this.ctx, img.getAttribute("data-embed") ?? img.getAttribute("src") ?? "", img.alt, img.hasAttribute("data-embed")));
    };
    const rowCount = model.rows.length + 1;
    const make = (tag: "th" | "td", md: string, row: number, col: number): HTMLElement => {
      const cell = document.createElement(tag);
      cell.dataset["r"] = String(row);
      cell.dataset["c"] = String(col);
      cell.contentEditable = "true";
      cell.spellcheck = true;
      if (model.aligns[col]) cell.style.textAlign = model.aligns[col]!;
      drawCell(cell, md);
      // typing: (a cell shows its Markdown while it is edited, and writes it back when left)
      cell.addEventListener("focus", () => {
        cell.dataset["editing"] = "1";
        cell.textContent = (cell.dataset["md"] ?? "").replace(/\\\|/g, "|");
      });
      cell.addEventListener("blur", () => {
        const md = read(cell);
        delete cell.dataset["editing"];
        set(row, col, md);
        drawCell(cell, md);
        if (!focusNext.has(view)) commit();
      });
      cell.addEventListener("keydown", (e) => {
        const cols = model.head.length;
        const go = (r: number, c: number): void => {
          set(row, col, read(cell));
          delete cell.dataset["editing"];
          commit({ row: r, col: c });
        };
        if (e.key === "Tab") {
          e.preventDefault();
          const i = row * cols + col + (e.shiftKey ? -1 : 1);
          if (i < 0) return;
          if (i >= rowCount * cols) model.rows.push(Array<string>(cols).fill(""));
          go(Math.floor(i / cols), i % cols);
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (row + 1 >= rowCount) model.rows.push(Array<string>(cols).fill(""));
          go(row + 1, col);
        } else if (e.key === "Escape") {
          e.preventDefault();
          set(row, col, read(cell));
          delete cell.dataset["editing"];
          focusNext.delete(view);
          commit();
          const end = this.from + writeTable(model).length;
          view.dispatch({ selection: { anchor: Math.min(end + 1, view.state.doc.length) } });
          view.focus();
        }
        e.stopPropagation();
      });
      return cell;
    };
    const set = (row: number, col: number, md: string): void => {
      if (row === 0) model.head[col] = md;
      else model.rows[row - 1]![col] = md;
    };
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    model.head.forEach((md, c) => htr.append(make("th", md, 0, c)));
    thead.append(htr);
    const tbody = document.createElement("tbody");
    model.rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      r.forEach((md, c) => tr.append(make("td", md, i + 1, c)));
      tbody.append(tr);
    });
    table.append(thead, tbody);
    const button = (cls: string, label: string, run: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `me-table-add ${cls}`;
      b.title = label;
      b.setAttribute("aria-label", label);
      b.textContent = "+";
      // view-state: (the button keeps the focus where it was)
      b.addEventListener("mousedown", (e) => e.preventDefault());
      // typing: (adds a row or a column to the note's table)
      b.addEventListener("click", run);
      return b;
    };
    const addRow = button("me-table-add-row", this.ctx.addRowLabel, () => {
      model.rows.push(Array<string>(model.head.length).fill(""));
      commit({ row: model.rows.length, col: 0 });
    });
    const addCol = button("me-table-add-col", this.ctx.addColumnLabel, () => {
      model.head.push("");
      model.aligns.push("");
      for (const r of model.rows) r.push("");
      commit({ row: 0, col: model.head.length - 1 });
    });
    const scroll = document.createElement("div");
    scroll.className = "me-table-scroll";
    scroll.append(table);
    wrap.append(scroll, addCol, addRow);
    const want = focusNext.get(view);
    if (want && want.at === this.from) {
      focusNext.delete(view);
      queueMicrotask(() => cellAt(want.row, want.col)?.focus()); // (once the editor has put the new table in, before the next key)
    }
    return wrap;
  }
}

/** Tables drawn as tables (a block replacement, which only a state field may make), and kept out of the cursor's way. */
export function tableField(ctx: LiveContext): Extension {
  const build = (state: EditorState): DecorationSet => {
    const out: Range<Decoration>[] = [];
    syntaxTree(state).iterate({
      enter: (ref) => {
        if (ref.name === "Table") {
          const from = state.doc.lineAt(ref.from).from, to = state.doc.lineAt(ref.to).to;
          out.push(Decoration.replace({ widget: new TableWidget(state.sliceDoc(from, to), from, ctx), block: true }).range(from, to));
          return false;
        }
        // (only blocks hold tables)
        return ref.name === "Document" || ref.name === "Blockquote" || ref.name === "ListItem" || ref.name === "BulletList" || ref.name === "OrderedList";
      },
    });
    return Decoration.set(out, true);
  };
  const field = StateField.define<DecorationSet>({
    create: build,
    update: (deco, tr) => (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? build(tr.state) : deco),
    provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f) as RangeSet<Decoration>)],
  });
  return field;
}
