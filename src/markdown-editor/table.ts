// Tables in live mode: a table is drawn as a table whose cells are edited in place (Tab and Shift+Tab move between them, Enter goes down a
// row, adding one at the end, Escape leaves the table), with buttons that add a row or a column. The Markdown stays the one truth: an edited
// cell writes the whole table back as one change (one undo step). The cursor never lands in the raw pipes; source mode edits those.
import { redo, undo } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { RangeSet, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { CellEditor, LiveContext } from "./live";
import { mediaElement } from "./live";
import { WIDTHS_LINE, cellHtml, renderMarkdown } from "./render";
import { cleanHtml } from "./clean";
import { openPopover, type PopItem } from "./popover";

type Align = "left" | "center" | "right" | "";
interface Model {
  head: string[];
  aligns: Align[];
  rows: string[][];
  /** Column widths set by dragging (px, null: as wide as its words), kept in a comment line after the table. */
  widths: Array<number | null>;
}

/** The comment after a table that keeps its column widths: `<!-- table-cols: 120,auto,80 -->`. */
export { WIDTHS_LINE };

/** A row's cells, split at the pipes that are not escaped or in code. */
export function cellsOf(line: string): string[] {
  const s = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  const out: string[] = [];
  let cur = "", code = false, wiki = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    // (a bar inside code or a [[link]] is no cell's edge: a link written unescaped by another app stays one cell, written back escaped)
    if (c === "\\" && s[i + 1] === "|") (cur += "\\|"), i++;
    else if (c === "`") (code = !code), (cur += c);
    else if (c === "[" && s[i + 1] === "[") (wiki = true), (cur += "[["), i++;
    else if (c === "]" && s[i + 1] === "]") (wiki = false), (cur += "]]"), i++;
    else if (c === "|" && wiki) cur += "\\|";
    else if (c === "|" && !code) out.push(cur.trim()), (cur = "");
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function parseTable(src: string): Model {
  const lines = src.split("\n");
  const w = WIDTHS_LINE.exec(lines[lines.length - 1] ?? "");
  if (w) lines.pop();
  const widths = w ? w[1]!.split(",").map((x) => (/^\s*\d+\s*$/.test(x) ? Number(x) : null)) : [];
  const head = cellsOf(lines[0] ?? "");
  const aligns = cellsOf(lines[1] ?? "").map((d): Align => (/^:-+:$/.test(d) ? "center" : /-:$/.test(d) ? "right" : /^:-/.test(d) ? "left" : ""));
  const width = Math.max(head.length, aligns.length);
  const pad = (r: string[]): string[] => [...r, ...Array<string>(Math.max(0, width - r.length)).fill("")];
  return { head: pad(head), aligns: pad(aligns) as Align[], rows: lines.slice(2).filter((l) => l.trim()).map((l) => pad(cellsOf(l))), widths: Array.from({ length: width }, (_, i) => widths[i] ?? null) };
}

export function writeTable(m: Model): string {
  const row = (cells: string[]): string => `| ${cells.map((c) => c.replace(/\n/g, " ")).join(" | ")} |`;
  const sep = m.aligns.map((a) => (a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---"));
  const widths = m.widths.some((x) => x !== null) ? [`<!-- table-cols: ${m.widths.map((x) => x ?? "auto").join(",")} -->`] : [];
  return [row(m.head), `| ${sep.join(" | ")} |`, ...m.rows.map(row), ...widths].join("\n");
}

/** Where each cell's words are on a row's line: [from, to) offsets, the spaces round them left out (an empty cell: a place between them). */
export function cellSpans(line: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  // (a table in a quote or a list: its rows start after the quote's marks)
  const first = line.search(/[^\s>]/);
  if (first < 0) return out;
  const piped = line[first] === "|";
  let start = piped ? first + 1 : first, code = false;
  const push = (from: number, to: number): void => {
    let a = from, b = to;
    while (a < b && /\s/.test(line[a]!)) a++;
    while (b > a && /\s/.test(line[b - 1]!)) b--;
    if (a === b) a = b = Math.min(from + (line[from] === " " ? 1 : 0), to);
    out.push([a, b]);
  };
  let wiki = false;
  for (let i = start; i < line.length; i++) {
    const c = line[i]!;
    if (c === "\\" && line[i + 1] === "|") i++;
    else if (c === "`") code = !code;
    else if (c === "[" && line[i + 1] === "[") (wiki = true), i++;
    else if (c === "]" && line[i + 1] === "]") (wiki = false), i++;
    else if (c === "|" && !code && !wiki) {
      push(start, i);
      start = i + 1;
    }
  }
  if (line.slice(start).trim() || !/(?<!\\)\|\s*$/.test(line)) push(start, line.length);
  return out;
}

/**
 * Where each cell's text is on a row's line, as a cell's editor edits it: [from, to) with one space of padding left out each side (spaces
 * typed at its ends stay its own), so what is typed goes back exactly.
 */
export function cellRegions(line: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const first = line.search(/[^\s>]/);
  if (first < 0) return out;
  const piped = line[first] === "|";
  let start = piped ? first + 1 : first, code = false;
  const push = (from: number, to: number): void => {
    const a = line[from] === " " && from < to ? from + 1 : from;
    const b = to > a && line[to - 1] === " " ? to - 1 : to;
    out.push([a, Math.max(a, b)]);
  };
  let wiki = false;
  for (let i = start; i < line.length; i++) {
    const c = line[i]!;
    if (c === "\\" && line[i + 1] === "|") i++;
    else if (c === "`") code = !code;
    else if (c === "[" && line[i + 1] === "[") (wiki = true), i++;
    else if (c === "]" && line[i + 1] === "]") (wiki = false), i++;
    else if (c === "|" && !code && !wiki) {
      push(start, i);
      start = i + 1;
    }
  }
  if (line.slice(start).trim() || !/(?<!\\)\|\s*$/.test(line)) push(start, line.length);
  return out;
}

/** A cell's text in the file and in its editor: the editor's lines are the file's `<br>`. */
// (and a table's escaped pipe, \\|, is a plain | in the editor: in a link, a picture's size, or as words; it goes back escaped)
const toEditor = (raw: string): string => raw.replace(/<br\s*\/?>/gi, "\n").replace(/\\\|/g, "|");
const toFile = (text: string): string => text.replace(/\r?\n/g, "<br>").replace(/(?<!\\)\|/g, "\\|");

/**
 * One drawn table. It stays on the page while the note changes (`update`), so a cell being edited keeps its editor: the cell's editor is a
 * window onto that cell's words in the note, its every change written there at once (`ctx.cellEditor`), so the note keeps one document and
 * one history. The table's own actions (rows, columns, sort, widths) write the whole table back as one change.
 */
class TableView {
  readonly dom = document.createElement("div");
  model: Model;
  private editing: { row: number; col: number; ed: CellEditor } | null = null;
  private range: { r0: number; c0: number; r1: number; c1: number } | null = null;
  /** Whole rows or columns selected from their grips (a click; Ctrl+click adds or takes one, Shift+click the ones between). */
  private lines: { kind: "row" | "col"; set: Set<number>; anchor: number } | null = null;
  private table!: HTMLTableElement;

  constructor(readonly view: EditorView, readonly ctx: LiveContext, public source: string, public from: number) {
    this.model = parseTable(source);
    this.dom.className = "me-table";
    this.dom.contentEditable = "false";
    this.dom.tabIndex = -1;
    this.render();
    this.listen();
  }

  /** The note changed: the table's text is now `source`, at `from`. Only what changed is drawn again; the cell being edited follows. */
  update(source: string, from: number): void {
    this.source = source;
    this.from = from;
    // (in place: the drawn table's buttons and grips read this one model; its shape is compared with what was drawn, since the table's
    // own actions change the model before they write it)
    const m = Object.assign(this.model, parseTable(source));
    const same = this.shapeOf() === this.drawnShape;
    if (!same) {
      const ed = this.editing;
      this.render();
      if (ed) {
        const cell = this.cellAt(ed.row, ed.col);
        if (cell) {
          cell.textContent = "";
          cell.classList.add("is-editing");
          cell.parentElement!.classList.add("is-editing");
          // (the cell's editor moves into the cell drawn again)
          cell.append(...(this.editingHost ? [...this.editingHost.childNodes] : []));
          this.editingHost = cell;
          ed.ed.setText(this.editorText(ed.row, ed.col));
          ed.ed.refocus();
        } else this.stopEditing();
      }
      return;
    }
    for (let r = 0; r <= m.rows.length; r++) {
      for (let c = 0; c < m.head.length; c++) {
        const md = this.mdAt(r, c);
        // (the cell's own typing is in it already: its spaces at the ends, which the table's text trims, stay)
        if (this.editing?.row === r && this.editing.col === c) {
          if (!this.writing) this.editing.ed.setText(this.editorText(r, c));
        } else if (this.cellAt(r, c)?.dataset["md"] !== md) this.drawCell(this.cellAt(r, c)!, md);
      }
    }
  }

  destroy(): void {
    this.editing?.ed.destroy();
    this.editing = null;
  }

  private mdAt(row: number, col: number): string {
    return (row === 0 ? this.model.head[col] : this.model.rows[row - 1]?.[col]) ?? "";
  }
  private cellAt(row: number, col: number): HTMLElement | null {
    return this.table.querySelector(`[data-r="${row}"][data-c="${col}"]`);
  }
  private drawCell(cell: HTMLElement, md: string): void {
    cell.dataset["md"] = md;
    // (a cell whose lines hold a list, a quote or a callout draws those blocks; words alone stay in the line)
    const blocks = md ? cellHtml(md, { html: true }) : null;
    cell.innerHTML = blocks !== null ? cleanHtml(blocks) : md ? cleanHtml(renderMarkdown(md, { html: true })).replace(/^<p>|<\/p>$/g, "") : "";
    // (a wiki link that finds no note looks as it does in the note's words)
    for (const link of cell.querySelectorAll<HTMLElement>("a[data-wiki]")) if (this.ctx.exists?.(link.dataset["wiki"]!) === false) link.classList.add("me-wikilink-broken");
    for (const img of cell.querySelectorAll("img")) img.replaceWith(mediaElement(this.ctx, img.getAttribute("data-embed") ?? img.getAttribute("src") ?? "", img.alt, img.hasAttribute("data-embed"), Number(img.getAttribute("width")) || null));
  }
  /** A change from the cell being edited is being written into the note. */
  private writing = false;
  /** The element holding the cell's editor. */
  private editingHost: HTMLElement | null = null;

  /** Where the cell's text is in the note now ([from, to), cellRegions), or null when its row is short of it. */
  private spanOf(row: number, col: number): [number, number] | null {
    const doc = this.view.state.doc;
    const first = doc.lineAt(this.from).number;
    const line = doc.line(first + (row === 0 ? 0 : row + 1));
    const span = cellRegions(line.text)[col];
    return span ? [line.from + span[0], line.from + span[1]] : null;
  }
  /** The cell's text as its editor shows it. */
  private editorText(row: number, col: number): string {
    const span = this.spanOf(row, col);
    return span ? toEditor(this.view.state.sliceDoc(...span)) : "";
  }

  /** Write the model back (one change: one undo step), then edit `next`. */
  commit(next?: { row: number; col: number }): void {
    const text = writeTable(this.model);
    if (text !== this.source) this.view.dispatch({ changes: { from: this.from, to: this.from + this.source.length, insert: text }, userEvent: "input.table" });
    if (next) this.edit(next.row, next.col);
  }

  stopEditing(): void {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    ed.ed.destroy();
    this.editingHost = null;
    const cell = this.cellAt(ed.row, ed.col);
    if (cell) {
      cell.classList.remove("is-editing");
      cell.parentElement!.classList.remove("is-editing");
      this.drawCell(cell, this.mdAt(ed.row, ed.col));
    }
  }

  /** Edit the cell at `row`, `col`, the cursor where `at` points in it (else at its end). */
  edit(row: number, col: number, at?: { x: number; y: number }): void {
    this.clearCells();
    if (this.editing?.row === row && this.editing.col === col) return void this.editing.ed.focus(at);
    this.stopEditing();
    if (!this.ctx.cellEditor) return;
    // (a short row is filled out first, so the cell has a place in the note)
    if (!this.spanOf(row, col)) this.commit();
    const cell = this.cellAt(row, col);
    if (!cell || !this.spanOf(row, col)) return;
    // (the note's own selection goes to the table, so one selection shows: the cell's)
    const sel = this.view.state.selection.main;
    if (!sel.empty || sel.from !== this.from) this.view.dispatch({ selection: { anchor: this.from } });
    cell.textContent = "";
    cell.classList.add("is-editing");
    cell.parentElement!.classList.add("is-editing");
    this.editingHost = cell;
    const ed = this.ctx.cellEditor(cell, this.editorText(row, col), {
      change: (text, userEvent) => {
        const span = this.spanOf(row, col);
        if (!span) return;
        // (the cell's text written back over its place, as the smallest change: its lines as <br>)
        const old = this.view.state.sliceDoc(...span);
        let next = toFile(text);
        if (old === next) return;
        if (span[0] === span[1]) {
          // (an empty cell written `||`: its words get a space each side, as tables are written)
          if (this.view.state.sliceDoc(span[0] - 1, span[0]) === "|") next = ` ${next}`;
          if (this.view.state.sliceDoc(span[1], span[1] + 1) === "|") next += " ";
        }
        let a = 0;
        while (a < old.length && a < next.length && old[a] === next[a]) a++;
        let b = 0;
        while (b < old.length - a && b < next.length - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b++;
        this.writing = true;
        try {
          this.view.dispatch({ changes: { from: span[0] + a, to: span[1] - b, insert: next.slice(a, next.length - b) }, userEvent });
        } finally {
          this.writing = false;
        }
      },
      move: (to) => this.move(row, col, to),
      blur: () => {
        if (this.editing?.ed === ed) this.stopEditing();
      },
    });
    this.editing = { row, col, ed };
    ed.focus(at);
  }

  private move(row: number, col: number, to: "next" | "prev" | "down" | "out"): void {
    const cols = this.model.head.length;
    if (to === "out") {
      this.stopEditing();
      const end = this.from + this.source.length;
      this.view.dispatch({ selection: { anchor: Math.min(end + 1, this.view.state.doc.length) } });
      this.view.focus();
      return;
    }
    let r = row, c = col;
    if (to === "down") r = row + 1;
    else {
      const k = row * cols + col + (to === "next" ? 1 : -1);
      if (k < 0) return;
      (r = Math.floor(k / cols)), (c = k % cols);
    }
    if (r > this.model.rows.length) {
      // (past the last row: a new one)
      this.stopEditing();
      this.model.rows.push(Array<string>(cols).fill(""));
      return this.commit({ row: r, col: c });
    }
    this.edit(r, c);
  }

  private set(row: number, col: number, md: string): void {
    if (row === 0) this.model.head[col] = md;
    else this.model.rows[row - 1]![col] = md;
  }

  // ---- Cells selected together: dragged across, or Shift+clicked (cleared, copied, cut or formatted at once) ----
  private inRange(r: number, c: number): boolean {
    if (this.lines) return this.lines.set.has(this.lines.kind === "row" ? r : c);
    const g = this.range;
    return !!g && r >= Math.min(g.r0, g.r1) && r <= Math.max(g.r0, g.r1) && c >= Math.min(g.c0, g.c1) && c <= Math.max(g.c0, g.c1);
  }
  private paintRange(): void {
    for (const cell of this.table.querySelectorAll<HTMLElement>(".me-cell")) cell.parentElement!.classList.toggle("me-cell-selected", this.inRange(Number(cell.dataset["r"]), Number(cell.dataset["c"])));
  }
  private clearCells(): void {
    this.range = null;
    this.lines = null;
    this.paintRange();
  }
  /** Select row (1…: body rows) or column `i` from its grip, as the library selects items: alone, Ctrl to add or take, Shift for a run. */
  selectLine(kind: "row" | "col", i: number, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): void {
    this.stopEditing();
    this.range = null;
    const l = this.lines?.kind === kind ? this.lines : null;
    if (l && e.shiftKey) for (let k = Math.min(l.anchor, i); k <= Math.max(l.anchor, i); k++) l.set.add(k);
    else if (l && (e.ctrlKey || e.metaKey)) (l.set.has(i) ? l.set.delete(i) : l.set.add(i), (l.anchor = i));
    else this.lines = { kind, set: new Set([i]), anchor: i };
    if (this.lines && !this.lines.set.size) this.lines = null;
    this.paintRange();
    this.dom.focus({ preventScroll: true });
  }
  private eachSelected(f: (r: number, c: number) => void): void {
    if (this.lines) {
      const rows = this.model.rows.length, cols = this.model.head.length;
      for (const k of this.lines.set) for (let j = 0; j < (this.lines.kind === "row" ? cols : rows + 1); j++) this.lines.kind === "row" ? f(k, j) : f(j, k);
      return;
    }
    const g = this.range;
    if (!g) return;
    for (let r = Math.min(g.r0, g.r1); r <= Math.max(g.r0, g.r1); r++) for (let c = Math.min(g.c0, g.c1); c <= Math.max(g.c0, g.c1); c++) f(r, c);
  }
  private selectedTable(): string {
    const rows: string[][] = [];
    const top = this.range ? Math.min(this.range.r0, this.range.r1) : this.lines?.kind === "row" ? Math.min(...this.lines.set) : 0;
    this.eachSelected((r, c) => void (rows[r - top] ??= []).push(this.mdAt(r, c)));
    const head = rows[0] ?? [];
    return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`)].join("\n");
  }

  private listen(): void {
    const FORMAT_KEYS: Record<string, [string, string]> = { b: ["**", "**"], i: ["*", "*"], e: ["`", "`"], S: ["~~", "~~"], H: ["==", "=="] };
    // typing: (keys on cells selected together write the table: clear, cut, a format on each; Ctrl+Z is the note's)
    this.dom.addEventListener("keydown", (e) => {
      if ((!this.range && !this.lines) || this.editing) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.shiftKey && mod ? e.key.toUpperCase() : e.key.toLowerCase();
      if (e.key === "Escape") return void (this.clearCells(), this.view.focus(), e.preventDefault());
      if (mod && (key === "z" || key === "y" || key === "Z")) return void (e.preventDefault(), (key === "z" ? undo : redo)(this.view));
      // (whole rows or columns selected: Backspace or Delete removes them; the heading row stays, and the last column)
      if (this.lines && (e.key === "Delete" || e.key === "Backspace")) {
        const { kind, set } = this.lines;
        if (kind === "row") this.model.rows = this.model.rows.filter((_r, i) => !set.has(i + 1));
        else if (set.size < this.model.head.length) {
          const keep = (_x: unknown, i: number): boolean => !set.has(i);
          this.model.head = this.model.head.filter(keep);
          this.model.aligns = this.model.aligns.filter(keep);
          this.model.widths = this.model.widths.filter(keep);
          this.model.rows = this.model.rows.map((r) => r.filter(keep));
        }
        e.preventDefault();
        e.stopPropagation();
        this.lines = null;
        return void this.commit();
      }
      if (e.key === "Delete" || e.key === "Backspace" || (mod && key === "x")) {
        if (mod) void navigator.clipboard?.writeText(this.selectedTable()).catch(() => undefined);
        this.eachSelected((r, c) => this.set(r, c, ""));
      } else if (mod && key === "c") return void (navigator.clipboard?.writeText(this.selectedTable()).catch(() => undefined), e.preventDefault());
      else if (mod && FORMAT_KEYS[key]) {
        const [a, b] = FORMAT_KEYS[key]!;
        let all = true;
        this.eachSelected((r, c) => void (all &&= this.mdAt(r, c).startsWith(a) && this.mdAt(r, c).endsWith(b) && this.mdAt(r, c).length >= a.length + b.length));
        this.eachSelected((r, c) => {
          const md = this.mdAt(r, c);
          if (md) this.set(r, c, all ? md.slice(a.length, md.length - b.length) : `${a}${md}${b}`);
        });
      } else return;
      e.preventDefault();
      e.stopPropagation();
      const keep = this.range, lines = this.lines;
      this.commit();
      this.range = keep;
      this.lines = lines;
      this.paintRange();
    });
    const cellOf = (t: EventTarget | null): HTMLElement | null => (t instanceof Element ? t.closest<HTMLElement>(".me-cell") : null);
    // view-state: (a press on a cell edits it; dragged on to other cells, or with Shift, it selects cells instead; presses in the cell being
    // edited place its cursor. mousedown, not pointerdown: only that keeps the browser from a text selection of its own in the table)
    this.dom.addEventListener("mousedown", (e) => {
      const cell = cellOf(e.target);
      if (!cell || e.button !== 0 || (e.target as HTMLElement).closest(".me-col-resize")) return;
      const r = Number(cell.dataset["r"]), c = Number(cell.dataset["c"]);
      // (in the cell being edited a press is its editor's, to place the cursor or select words; dragged out of it, it selects cells)
      const inEditor = cell.classList.contains("is-editing");
      if (!inEditor) e.preventDefault();
      if (e.shiftKey && !inEditor && (this.editing || this.range)) {
        const from = this.range ? { r: this.range.r0, c: this.range.c0 } : { r: this.editing!.row, c: this.editing!.col };
        this.stopEditing();
        this.range = { r0: from.r, c0: from.c, r1: r, c1: c };
        this.paintRange();
        this.dom.focus({ preventScroll: true });
        return;
      }
      const start = { x: e.clientX, y: e.clientY };
      let dragged = false;
      if (!inEditor) this.edit(r, c, start);
      const move = (ev: MouseEvent): void => {
        // (the cell under the pointer by where the cells are: what floats over the table, the cell editor's bar, never hides one)
        const over = [...this.table.querySelectorAll<HTMLElement>(".me-cell")].find((el) => {
          const b = el.parentElement!.getBoundingClientRect();
          return ev.clientX >= b.left && ev.clientX < b.right && ev.clientY >= b.top && ev.clientY < b.bottom;
        });
        const same = !!over && Number(over.dataset["r"]) === r && Number(over.dataset["c"]) === c;
        if (!dragged && (same || !over)) return void (!inEditor && same && this.editing?.ed.extend({ x: ev.clientX, y: ev.clientY }));
        if (!over) return;
        if (!dragged) {
          dragged = true;
          this.stopEditing();
          getSelection()?.removeAllRanges();
        }
        this.range = { r0: r, c0: c, r1: Number(over.dataset["r"]), c1: Number(over.dataset["c"]) };
        this.paintRange();
      };
      const up = (): void => {
        document.removeEventListener("mousemove", move);
        if (dragged) this.dom.focus({ preventScroll: true });
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up, { once: true });
    });
  }

  /**
   * A grip at the table's top-left corner: dragged, the whole table goes where it is let go in the note (a line shows where). Let go inside
   * a sentence or a paragraph, it splits it: the table stands on lines of its own, blank lines round it, so it stays a table.
   */
  private mover(): HTMLElement {
    const handle = document.createElement("span");
    handle.className = "me-table-move";
    handle.title = this.ctx.moveTableLabel;
    handle.setAttribute("aria-label", this.ctx.moveTableLabel);
    handle.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="3" cy="3" r="1.1"/><circle cx="9" cy="3" r="1.1"/><circle cx="3" cy="9" r="1.1"/><circle cx="9" cy="9" r="1.1"/><circle cx="6" cy="6" r="1.1"/></svg>';
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.stopEditing();
      handle.setPointerCapture(e.pointerId);
      const view = this.view;
      const line = document.createElement("div");
      line.className = "me-table-drop";
      line.style.background = getComputedStyle(view.dom).getPropertyValue("--me-accent"); // (on the page's top, outside the editor's tokens)
      document.body.append(line);
      let at: number | null = null;
      const end = (): number => this.from + this.source.length;
      const move = (ev: PointerEvent): void => {
        const pos = view.posAtCoords({ x: ev.clientX, y: ev.clientY });
        // (not on the table itself, nor right at its edges: nowhere it would move)
        at = pos === null || (pos >= this.from - 1 && pos <= end() + 1) ? null : pos;
        line.hidden = at === null;
        if (at === null) return;
        const c = view.coordsAtPos(at) ?? view.coordsAtPos(view.state.doc.lineAt(at).from);
        const content = view.contentDOM.getBoundingClientRect();
        if (!c) return void (line.hidden = true);
        Object.assign(line.style, { left: `${content.left}px`, width: `${content.width}px`, top: `${c.top - 2}px` });
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", () => {
        handle.removeEventListener("pointermove", move);
        line.remove();
        if (at === null) return;
        const doc = view.state.doc;
        const from = this.from, to = Math.min(doc.length, end() + (doc.sliceString(end(), end() + 1) === "\n" ? 1 : 0));
        const table = doc.sliceString(this.from, end());
        const before = doc.sliceString(Math.max(0, at - 2), at), after = doc.sliceString(at, at + 2);
        const lead = at === 0 ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
        const trail = at === doc.length ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
        const insert = `${lead}${table}${trail}`;
        const changes = view.state.changes([{ from, to }, { from: at, insert }]);
        view.dispatch({ changes, selection: { anchor: changes.mapPos(at, 1) }, scrollIntoView: true, userEvent: "move.table" });
        view.focus();
      }, { once: true });
    });
    return handle;
  }

  /** The table's shape: what makes it be drawn again whole (its size, alignments and widths). */
  private shapeOf(): string {
    return `${this.model.head.length}×${this.model.rows.length}|${this.model.aligns.join()}|${this.model.widths.join()}`;
  }
  private drawnShape = "";
  private render(): void {
    this.drawnShape = this.shapeOf();
    const view = this.view;
    const model = this.model;
    const commit = (next?: { row: number; col: number }): void => this.commit(next);
    const table = (this.table = document.createElement("table"));
    this.dom.textContent = "";
    const make = (tag: "th" | "td", md: string, row: number, col: number): HTMLElement => {
      // (the cell holds its words in an element of their own, beside a heading cell's grips)
      const box = document.createElement(tag);
      const cell = document.createElement("div");
      cell.className = "me-cell me-doc";
      box.append(cell);
      cell.dataset["r"] = String(row);
      cell.dataset["c"] = String(col);
      if (model.aligns[col]) box.style.textAlign = model.aligns[col]!;
      this.drawCell(cell, md);
      // view-state: (opens the table's list of actions; each writes the table through `commit`)
      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.stopEditing();
        openPopover(new DOMRect(e.clientX, e.clientY, 0, 0), actions(row, col), this.ctx.tableLabel);
      });
      return box;
    };
    /** The table's actions for the cell at `row` (0: the heading row), `col`. */
    const actions = (row: number, col: number): PopItem[] => {
      const L = this.ctx.tableWords;
      this.stopEditing();
      const cols = model.head.length, body = row - 1, last = model.rows.length - 1;
      const blank = (): string[] => Array<string>(cols).fill("");
      const eachRow = (f: (r: string[]) => void): void => [model.head, ...model.rows].forEach(f);
      const swapCols = (a: number, b: number): void => {
        eachRow((r) => ([r[a], r[b]] = [r[b]!, r[a]!]));
        [model.aligns[a], model.aligns[b]] = [model.aligns[b]!, model.aligns[a]!];
        [model.widths[a], model.widths[b]] = [model.widths[b] ?? null, model.widths[a] ?? null];
      };
      // (by the words as they read: marks, link targets and tags' signs left out)
      const words = (md: string): string => md.replace(/!?\[\[([^\]|]*)\|?([^\]]*)\]\]/g, (_m, t: string, a: string) => a || t).replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_~=`#>]|<br\s*\/?>/g, "").trim();
      const sort = (dir: 1 | -1): void => void model.rows.sort((a, b) => dir * words(a[col] ?? "").localeCompare(words(b[col] ?? ""), undefined, { numeric: true, sensitivity: "base" }));
      const align = (a: Align): void => void (model.aligns[col] = a);
      return [
        { id: "table.rowAbove", label: L.rowAbove, disabled: row === 0, pick: () => (model.rows.splice(body, 0, blank()), commit({ row, col })) },
        { id: "table.rowBelow", label: L.rowBelow, pick: () => (model.rows.splice(body + 1, 0, blank()), commit({ row: row + 1, col })) },
        { id: "table.colBefore", label: L.colBefore, pick: () => (eachRow((r) => r.splice(col, 0, "")), model.aligns.splice(col, 0, ""), model.widths.splice(col, 0, null), commit({ row, col })) },
        { id: "table.colAfter", label: L.colAfter, pick: () => (eachRow((r) => r.splice(col + 1, 0, "")), model.aligns.splice(col + 1, 0, ""), model.widths.splice(col + 1, 0, null), commit({ row, col: col + 1 })) },
        { id: "table.rowUp", label: L.rowUp, sep: true, disabled: body <= 0, pick: () => ([model.rows[body - 1], model.rows[body]] = [model.rows[body]!, model.rows[body - 1]!], commit({ row: row - 1, col })) },
        { id: "table.rowDown", label: L.rowDown, disabled: row === 0 || body >= last, pick: () => ([model.rows[body + 1], model.rows[body]] = [model.rows[body]!, model.rows[body + 1]!], commit({ row: row + 1, col })) },
        { id: "table.colLeft", label: L.colLeft, disabled: col === 0, pick: () => (swapCols(col, col - 1), commit({ row, col: col - 1 })) },
        { id: "table.colRight", label: L.colRight, disabled: col >= cols - 1, pick: () => (swapCols(col, col + 1), commit({ row, col: col + 1 })) },
        { id: "table.dupRow", label: L.dupRow, sep: true, disabled: row === 0, pick: () => (model.rows.splice(body + 1, 0, [...model.rows[body]!]), commit({ row: row + 1, col })) },
        { id: "table.dupCol", label: L.dupCol, pick: () => (eachRow((r) => r.splice(col + 1, 0, r[col] ?? "")), model.aligns.splice(col + 1, 0, model.aligns[col] ?? ""), model.widths.splice(col + 1, 0, model.widths[col] ?? null), commit({ row, col: col + 1 })) },
        { id: "table.alignLeft", label: L.alignLeft, sep: true, on: model.aligns[col] === "left", pick: () => (align(model.aligns[col] === "left" ? "" : "left"), commit()) },
        { id: "table.alignCenter", label: L.alignCenter, on: model.aligns[col] === "center", pick: () => (align(model.aligns[col] === "center" ? "" : "center"), commit()) },
        { id: "table.alignRight", label: L.alignRight, on: model.aligns[col] === "right", pick: () => (align(model.aligns[col] === "right" ? "" : "right"), commit()) },
        { id: "table.sortUp", label: L.sortUp, sep: true, disabled: model.rows.length < 2, pick: () => (sort(1), commit()) },
        { id: "table.sortDown", label: L.sortDown, disabled: model.rows.length < 2, pick: () => (sort(-1), commit()) },
        { id: "table.delRow", label: L.delRow, sep: true, disabled: row === 0, pick: () => (model.rows.splice(body, 1), commit()) },
        { id: "table.delCol", label: L.delCol, disabled: cols <= 1, pick: () => (eachRow((r) => r.splice(col, 1)), model.aligns.splice(col, 1), model.widths.splice(col, 1), commit()) },
        { id: "table.copy", label: L.copy, sep: true, pick: () => void navigator.clipboard?.writeText(writeTable(model)).catch(() => undefined) },
        { id: "table.duplicate", label: L.duplicate, pick: () => view.dispatch({ changes: { from: this.from + this.source.length, insert: `\n\n${writeTable(model)}` }, userEvent: "input.table" }) },
        // (Turn into: a line per row, its cells apart by " — "; the heading row too unless it is only Column 1, Column 2…)
        ...([["table.toList", L.toList, () => "- "], ["table.toNumbered", L.toNumbered, (i: number) => `${i + 1}. `], ["table.toTasks", L.toTasks, () => "- [ ] "], ["table.toLines", L.toLines, () => ""]] as const).map(
          ([id, label, mark], i): PopItem => ({ id, label, ...(i === 0 ? { sep: true } : {}), pick: () => {
            const rows = [...(model.head.every((h, k) => !h || h === `Column ${k + 1}`) ? [] : [model.head]), ...model.rows].map((r) => r.filter(Boolean).join(" — ").replace(/<br\s*\/?>/gi, " ")).filter(Boolean);
            const insert = rows.map((r, k) => `${mark(k)}${r}`).join("\n");
            view.dispatch({ changes: { from: this.from, to: this.from + this.source.length, insert }, selection: { anchor: this.from + insert.length }, userEvent: "input.table" });
            view.focus();
          } }),
        ),
      ];
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
    // Column widths: a handle on each heading cell's right edge sets its column's (kept in the comment after the table); a grip above a
    // heading cell drags its column to another place.
    const colgroup = document.createElement("colgroup");
    for (const w of model.widths) {
      const c = document.createElement("col");
      if (w) c.style.width = `${w}px`;
      colgroup.append(c);
    }
    if (model.widths.some((w) => w)) table.style.tableLayout = "fixed";
    table.append(colgroup, thead, tbody);
    [...htr.cells].forEach((th, c) => {
      const grip = document.createElement("span");
      grip.className = "me-col-resize";
      grip.contentEditable = "false";
      grip.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        grip.setPointerCapture(e.pointerId);
        const x0 = e.clientX, w0 = th.getBoundingClientRect().width;
        const cols = [...colgroup.children] as HTMLElement[];
        // (every column at its width now, so only this one changes)
        [...htr.cells].forEach((h, i) => (cols[i]!.style.width = `${Math.round(h.getBoundingClientRect().width)}px`));
        table.style.tableLayout = "fixed";
        const move = (ev: PointerEvent): void => void (cols[c]!.style.width = `${Math.max(48, Math.round(w0 + ev.clientX - x0))}px`);
        grip.addEventListener("pointermove", move);
        grip.addEventListener("pointerup", () => {
          grip.removeEventListener("pointermove", move);
          model.widths = cols.map((col) => parseInt(col.style.width) || null);
          commit();
        }, { once: true });
      });
      th.append(grip);
    });
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
      model.widths.push(null);
      for (const r of model.rows) r.push("");
      commit({ row: 0, col: model.head.length - 1 });
    });
    // (the table framed, a bar on its right edge adds a column and one under it a row, as wide and tall as the table)
    const box = document.createElement("div");
    box.className = "me-table-box";
    const scroll = document.createElement("div");
    scroll.className = "me-table-scroll";
    scroll.append(table);
    // A grip at the left of the row under the pointer: dragged up or down, the row moves there.
    const grip = document.createElement("span");
    grip.className = "me-table-grip";
    grip.setAttribute("aria-hidden", "true");
    grip.innerHTML = '<svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor"><circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/><circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="2" cy="10" r="1"/><circle cx="6" cy="10" r="1"/></svg>';
    let gripRow = -1;
    const bodyRows = (): HTMLElement[] => [...tbody.rows];
    const placeGrip = (i: number): void => {
      const tr = bodyRows()[i];
      gripRow = tr ? i : -1;
      grip.hidden = !tr;
      if (!tr) return;
      grip.style.top = `${tr.getBoundingClientRect().top - box.getBoundingClientRect().top}px`;
      grip.style.height = `${tr.getBoundingClientRect().height}px`;
    };
    // view-state: (shows the grip beside the row under the pointer)
    tbody.addEventListener("mousemove", (e) => {
      const tr = (e.target as HTMLElement).closest("tr");
      if (tr) placeGrip(bodyRows().indexOf(tr as HTMLTableRowElement));
    });
    grip.hidden = true;
    grip.addEventListener("pointerdown", (e) => {
      if (gripRow < 0) return;
      e.preventDefault();
      const from = gripRow;
      let to = from;
      grip.setPointerCapture(e.pointerId);
      grip.classList.add("is-dragging");
      const move = (ev: PointerEvent): void => {
        const rows = bodyRows();
        to = rows.findIndex((r) => ev.clientY < r.getBoundingClientRect().bottom);
        if (to < 0) to = rows.length - 1;
        rows.forEach((r, i) => r.classList.toggle("me-drop-target", i === to && to !== from));
      };
      const up = (): void => {
        grip.removeEventListener("pointermove", move);
        grip.classList.remove("is-dragging");
        for (const r of bodyRows()) r.classList.remove("me-drop-target");
        // (a click on the grip, not dragged: the row is selected)
        if (to === from) return void this.selectLine("row", from + 1, e);
        const [row] = model.rows.splice(from, 1);
        model.rows.splice(to, 0, row!);
        commit();
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up, { once: true });
    });
    // A grip above the column under the pointer: dragged left or right, the column moves there.
    const colGrip = document.createElement("span");
    colGrip.className = "me-col-grip";
    colGrip.setAttribute("aria-hidden", "true");
    colGrip.innerHTML = '<svg width="12" height="8" viewBox="0 0 12 8" fill="currentColor"><circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/><circle cx="10" cy="2" r="1"/><circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="10" cy="6" r="1"/></svg>';
    colGrip.hidden = true;
    let gripCol = -1;
    const placeColGrip = (c: number): void => {
      const th = htr.cells[c];
      gripCol = th ? c : -1;
      colGrip.hidden = !th;
      if (!th) return;
      const r = th.getBoundingClientRect(), b = box.getBoundingClientRect();
      colGrip.style.left = `${r.left - b.left}px`;
      colGrip.style.width = `${r.width}px`;
    };
    // view-state: (shows the grip above the column under the pointer)
    table.addEventListener("mousemove", (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLTableCellElement>("th, td");
      if (cell) placeColGrip(cell.cellIndex);
    });
    colGrip.addEventListener("pointerdown", (e) => {
      if (gripCol < 0) return;
      e.preventDefault();
      colGrip.setPointerCapture(e.pointerId);
      colGrip.classList.add("is-dragging");
      const from = gripCol;
      let to = from;
      const move = (ev: PointerEvent): void => {
        const cells = [...htr.cells];
        to = cells.findIndex((h) => ev.clientX < h.getBoundingClientRect().right);
        if (to < 0) to = cells.length - 1;
        cells.forEach((h, i) => h.classList.toggle("me-drop-target", i === to && to !== from));
      };
      colGrip.addEventListener("pointermove", move);
      colGrip.addEventListener("pointerup", () => {
        colGrip.removeEventListener("pointermove", move);
        colGrip.classList.remove("is-dragging");
        for (const h of htr.cells) h.classList.remove("me-drop-target");
        if (to === from) return void this.selectLine("col", from, e);
        const take = <T,>(list: T[]): void => void list.splice(to, 0, list.splice(from, 1)[0]!);
        [model.head, ...model.rows].forEach(take);
        take(model.aligns);
        take(model.widths);
        commit({ row: 0, col: to });
      }, { once: true });
    });
    box.append(grip, colGrip, scroll, addCol, addRow, this.mover());
    this.dom.append(box);
  }
}

const tables = new WeakMap<HTMLElement, TableView>();

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
    const t = new TableView(view, this.ctx, this.source, this.from);
    tables.set(t.dom, t);
    return t.dom;
  }
  /** The same table, changed: drawn again in place (the cell being edited keeps its editor). */
  override updateDOM(dom: HTMLElement): boolean {
    const t = tables.get(dom);
    if (!t) return false;
    t.update(this.source, this.from);
    return true;
  }
  override destroy(dom: HTMLElement): void {
    tables.get(dom)?.destroy();
  }
}

/** Tables drawn as tables (a block replacement, which only a state field may make), and kept out of the cursor's way. */
export function tableField(ctx: LiveContext): Extension {
  const build = (state: EditorState): DecorationSet => {
    const out: Range<Decoration>[] = [];
    syntaxTree(state).iterate({
      enter: (ref) => {
        if (ref.name === "Table") {
          const from = state.doc.lineAt(ref.from).from;
          let to = state.doc.lineAt(ref.to).to;
          // (the comment that keeps its column widths, on the line after it, belongs to it)
          const next = state.doc.lineAt(to).number < state.doc.lines ? state.doc.line(state.doc.lineAt(to).number + 1) : null;
          if (next && WIDTHS_LINE.test(next.text)) to = next.to;
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
  // (typed right after a table (a note that ends with one) or right before it: on a line of its own there, never into the table's rows.
  // The drawn table leaves the browser no place for its caret there, so a key raises no input at all: the key itself is taken.)
  const edgeOf = (view: EditorView, at: number): "after" | "before" | null => {
    let edge: "after" | "before" | null = null;
    view.state.field(field).between(at, at, (a, b) => void (edge = b === at ? "after" : a === at ? "before" : edge));
    return edge;
  };
  const type = (view: EditorView, text: string): boolean => {
    const sel = view.state.selection.main;
    const edge = sel.empty ? edgeOf(view, sel.from) : null;
    if (!edge) return false;
    const insert = edge === "after" ? `\n${text}` : `${text}\n`;
    view.dispatch({ changes: { from: sel.from, insert }, selection: { anchor: sel.from + (edge === "after" ? insert.length : text.length) }, scrollIntoView: true, userEvent: "input.type" });
    return true;
  };
  const typing = [
    EditorView.inputHandler.of((view, from, to, text) => from === to && type(view, text)),
    EditorView.domEventHandlers({
      keydown: (e, view) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
        const text = e.key === "Enter" ? "" : e.key.length === 1 ? e.key : null;
        if (text === null || !type(view, text)) return false;
        e.preventDefault();
        return true;
      },
    }),
  ];
  return [field, typing];
}
