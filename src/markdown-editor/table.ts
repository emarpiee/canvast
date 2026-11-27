// Tables in live mode: a table is drawn as a table whose cells are edited in place (Tab and Shift+Tab move between them, Enter goes down a
// row, adding one at the end, Escape leaves the table), with buttons that add a row or a column. The Markdown stays the one truth: an edited
// cell writes the whole table back as one change (one undo step). The cursor never lands in the raw pipes; source mode edits those.
import { syntaxTree } from "@codemirror/language";
import { RangeSet, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { LiveContext } from "./live";
import { mediaElement } from "./live";
import { renderMarkdown } from "./render";
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
export const WIDTHS_LINE = /^<!--\s*table-cols:\s*([\d\s,auto]+?)\s*-->\s*$/;

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
      if (text === this.source) return void (next && edit(next.row, next.col));
      view.dispatch({ changes: { from: this.from, to: this.from + this.source.length, insert: text }, userEvent: "input.table" });
    };
    const drawCell = (cell: HTMLElement, md: string): void => {
      cell.dataset["md"] = md;
      cell.innerHTML = md ? cleanHtml(renderMarkdown(md, { html: true })).replace(/^<p>|<\/p>$/g, "") : "";
      for (const img of cell.querySelectorAll("img")) img.replaceWith(mediaElement(this.ctx, img.getAttribute("data-embed") ?? img.getAttribute("src") ?? "", img.alt, img.hasAttribute("data-embed")));
    };
    const rowCount = model.rows.length + 1;
    const cols = model.head.length;
    const mdAt = (row: number, col: number): string => (row === 0 ? model.head[col] : model.rows[row - 1]?.[col]) ?? "";

    // ---- One cell edited at a time, in a small editor of its own on the cell's Markdown (the note's keys, formats and undo there too) ----
    let editing: { row: number; col: number; close(): string } | null = null;
    /** Stop editing: the cell's words into the table (written back when they changed, or when `next` asks for another cell). */
    const finish = (next?: { row: number; col: number }): void => {
      if (!editing) return next ? void commit(next) : undefined;
      const { row, col } = editing;
      const md = editing.close();
      editing = null;
      set(row, col, md);
      drawCell(cellAt(row, col)!, md);
      commit(next);
    };
    /** Edit the cell at `row`, `col` (the cursor where `at` points in it, else at its end). */
    const edit = (row: number, col: number, at?: { x: number; y: number }): void => {
      clearCells();
      if (editing?.row === row && editing.col === col) return;
      if (editing) {
        const md = editing.close(), was = editing;
        editing = null;
        set(was.row, was.col, md);
        drawCell(cellAt(was.row, was.col)!, md);
      }
      const cell = cellAt(row, col);
      if (!cell || !this.ctx.cellEditor) return;
      // (the note's own selection goes to the table, so one selection shows: the cell's)
      if (view.state.selection.main.from !== this.from) view.dispatch({ selection: { anchor: this.from } });
      cell.textContent = "";
      cell.classList.add("is-editing");
      cell.parentElement!.classList.add("is-editing");
      const ed = this.ctx.cellEditor(cell, mdAt(row, col).replace(/\\\|/g, "|"), {
        move: (to) => {
          const i = row * cols + col;
          if (to === "out") {
            finish();
            const end = this.from + writeTable(model).length;
            view.dispatch({ selection: { anchor: Math.min(end + 1, view.state.doc.length) } });
            view.focus();
            return;
          }
          let r = row, c = col;
          if (to === "next" || to === "prev") {
            const k = i + (to === "next" ? 1 : -1);
            if (k < 0) return;
            if (k >= (model.rows.length + 1) * cols) model.rows.push(Array<string>(cols).fill(""));
            (r = Math.floor(k / cols)), (c = k % cols);
          } else {
            if (row + 1 >= model.rows.length + 1) model.rows.push(Array<string>(cols).fill(""));
            r = row + 1;
          }
          finish({ row: r, col: c });
        },
        blur: () => finish(),
        // (nothing left to undo in the cell: the note's own history, a sort or a moved row too)
        undo: () => (finish(), this.ctx.undo?.() ?? false),
        redo: () => (finish(), this.ctx.redo?.() ?? false),
      }, at);
      editing = { row, col, close: () => (cell.classList.remove("is-editing"), cell.parentElement!.classList.remove("is-editing"), ed.close().replace(/\|/g, "\\|").replace(/\n/g, "<br>")) };
    };

    // ---- Cells selected together: dragged across, or Shift+clicked (cleared, copied, cut or formatted at once) ----
    let range: { r0: number; c0: number; r1: number; c1: number } | null = null;
    const inRange = (r: number, c: number): boolean => !!range && r >= Math.min(range.r0, range.r1) && r <= Math.max(range.r0, range.r1) && c >= Math.min(range.c0, range.c1) && c <= Math.max(range.c0, range.c1);
    const paintRange = (): void => {
      for (const cell of table.querySelectorAll<HTMLElement>(".me-cell")) cell.parentElement!.classList.toggle("me-cell-selected", inRange(Number(cell.dataset["r"]), Number(cell.dataset["c"])));
    };
    const clearCells = (): void => {
      range = null;
      paintRange();
    };
    const eachSelected = (f: (r: number, c: number) => void): void => {
      if (!range) return;
      for (let r = Math.min(range.r0, range.r1); r <= Math.max(range.r0, range.r1); r++) for (let c = Math.min(range.c0, range.c1); c <= Math.max(range.c0, range.c1); c++) f(r, c);
    };
    const selectedTable = (): string => {
      const rows: string[][] = [];
      eachSelected((r, c) => {
        const i = r - Math.min(range!.r0, range!.r1);
        (rows[i] ??= []).push(mdAt(r, c));
      });
      const head = rows[0] ?? [];
      return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`)].join("\n");
    };
    const FORMAT_KEYS: Record<string, [string, string]> = { b: ["**", "**"], i: ["*", "*"], e: ["`", "`"], S: ["~~", "~~"], H: ["==", "=="] };
    wrap.tabIndex = -1;
    // typing: (keys on cells selected together write the table: clear, cut, a format on each)
    wrap.addEventListener("keydown", (e) => {
      if (!range || editing) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.shiftKey && mod ? e.key.toUpperCase() : e.key.toLowerCase();
      if (e.key === "Escape") return void (clearCells(), view.focus(), e.preventDefault());
      if (e.key === "Delete" || e.key === "Backspace" || (mod && key === "x")) {
        if (mod) void navigator.clipboard?.writeText(selectedTable()).catch(() => undefined);
        eachSelected((r, c) => set(r, c, ""));
      } else if (mod && key === "c") return void (navigator.clipboard?.writeText(selectedTable()).catch(() => undefined), e.preventDefault());
      else if (mod && FORMAT_KEYS[key]) {
        const [a, b] = FORMAT_KEYS[key]!;
        let all = true;
        eachSelected((r, c) => void (all &&= mdAt(r, c).startsWith(a) && mdAt(r, c).endsWith(b) && mdAt(r, c).length >= a.length + b.length));
        eachSelected((r, c) => {
          const md = mdAt(r, c);
          if (md) set(r, c, all ? md.slice(a.length, md.length - b.length) : `${a}${md}${b}`);
        });
      } else return;
      e.preventDefault();
      e.stopPropagation();
      const keep = range;
      commit();
      range = keep;
    });
    const cellOf = (t: EventTarget | null): HTMLElement | null => (t instanceof Element ? t.closest<HTMLElement>(".me-cell") : null);
    // view-state: (a press on a cell edits it; dragged on to other cells, or with Shift, it selects cells instead)
    table.addEventListener("pointerdown", (e) => {
      const cell = cellOf(e.target);
      if (!cell || e.button !== 0 || (e.target as HTMLElement).closest(".me-col-resize, .cm-editor")) return;
      const r = Number(cell.dataset["r"]), c = Number(cell.dataset["c"]);
      if (e.shiftKey && (editing || range)) {
        e.preventDefault();
        const from = range ? { r: range.r0, c: range.c0 } : { r: editing!.row, c: editing!.col };
        if (editing) finish();
        range = { r0: from.r, c0: from.c, r1: r, c1: c };
        paintRange();
        wrap.focus({ preventScroll: true });
        return;
      }
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY };
      let dragged = false;
      const move = (ev: PointerEvent): void => {
        const over = cellOf(document.elementFromPoint(ev.clientX, ev.clientY));
        if (!over || (!dragged && over === cell)) return;
        if (!dragged) {
          dragged = true;
          if (editing) finish();
        }
        range = { r0: r, c0: c, r1: Number(over.dataset["r"]), c1: Number(over.dataset["c"]) };
        paintRange();
      };
      const up = (): void => {
        document.removeEventListener("pointermove", move);
        if (dragged) return void wrap.focus({ preventScroll: true });
        edit(r, c, start);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up, { once: true });
    });

    const make = (tag: "th" | "td", md: string, row: number, col: number): HTMLElement => {
      // (the cell holds its words in an element of their own, beside a heading cell's grips)
      const box = document.createElement(tag);
      const cell = document.createElement("div");
      cell.className = "me-cell";
      box.append(cell);
      cell.dataset["r"] = String(row);
      cell.dataset["c"] = String(col);
      if (model.aligns[col]) box.style.textAlign = model.aligns[col]!;
      drawCell(cell, md);
      // view-state: (opens the table's list of actions; each writes the table through `commit`)
      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (editing) finish();
        openPopover(new DOMRect(e.clientX, e.clientY, 0, 0), actions(row, col), this.ctx.tableLabel);
      });
      return box;
    };
    /** The table's actions for the cell at `row` (0: the heading row), `col`. */
    const actions = (row: number, col: number): PopItem[] => {
      const L = this.ctx.tableWords;
      const cols = model.head.length, body = row - 1, last = model.rows.length - 1;
      const blank = (): string[] => Array<string>(cols).fill("");
      const eachRow = (f: (r: string[]) => void): void => [model.head, ...model.rows].forEach(f);
      const swapCols = (a: number, b: number): void => {
        eachRow((r) => ([r[a], r[b]] = [r[b]!, r[a]!]));
        [model.aligns[a], model.aligns[b]] = [model.aligns[b]!, model.aligns[a]!];
        [model.widths[a], model.widths[b]] = [model.widths[b] ?? null, model.widths[a] ?? null];
      };
      const sort = (dir: 1 | -1): void => void model.rows.sort((a, b) => dir * (a[col] ?? "").localeCompare(b[col] ?? "", undefined, { numeric: true, sensitivity: "base" }));
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
      ];
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
        if (to === from) return;
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
        if (to === from) return;
        const take = <T,>(list: T[]): void => void list.splice(to, 0, list.splice(from, 1)[0]!);
        [model.head, ...model.rows].forEach(take);
        take(model.aligns);
        take(model.widths);
        commit({ row: 0, col: to });
      }, { once: true });
    });
    box.append(grip, colGrip, scroll, addCol, addRow);
    wrap.append(box);
    const want = focusNext.get(view);
    if (want && want.at === this.from) {
      focusNext.delete(view);
      queueMicrotask(() => edit(want.row, want.col)); // (once the editor has put the new table in, before the next key)
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
  return field;
}
