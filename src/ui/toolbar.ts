import type { EditorState, Tool } from "../app/editor-state";
import { PEN_COLORS, PEN_WIDTHS } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import { ICONS } from "./icons";

export interface ToolbarActions {
  importFiles(files: File[]): void;
  undo(): void;
  redo(): void;
  deleteSelection(): void;
}

const TOOLS: Array<{ tool: Tool; icon: string; label: string; key: string }> = [
  { tool: "hand", icon: ICONS.hand, label: "Hand (pan)", key: "H" },
  { tool: "select", icon: ICONS.pointer, label: "Select", key: "V" },
  { tool: "pen", icon: ICONS.pencil, label: "Pen", key: "P" },
  { tool: "lasso", icon: ICONS.lasso, label: "Lasso", key: "L" },
];

export function mountToolbar(root: HTMLElement, editor: EditorState, doc: DocumentStore, actions: ToolbarActions): void {
  root.innerHTML = `
    <div class="toolbar" role="toolbar" aria-label="Tools">
      <div class="tb-group" role="radiogroup" aria-label="Tool">
        ${TOOLS.map(
          (t) => `<button type="button" role="radio" data-tool="${t.tool}" aria-label="${t.label}" title="${t.label} (${t.key})">${t.icon}</button>`,
        ).join("")}
      </div>
      <div class="tb-group tb-options" data-for="pen">
        ${PEN_COLORS.map(
          (c) => `<button type="button" class="swatch" data-color="${c}" aria-label="Pen colour ${c}" title="Pen colour"><span style="background:${c}"></span></button>`,
        ).join("")}
        ${PEN_WIDTHS.map(
          (w) => `<button type="button" class="width" data-width="${w}" aria-label="Pen width ${w} px" title="Pen width ${w} px"><span style="height:${Math.max(2, w)}px"></span></button>`,
        ).join("")}
      </div>
      <div class="tb-group tb-options" data-for="lasso" role="radiogroup" aria-label="Lasso selects">
        <button type="button" role="radio" data-filter="strokes" title="Lasso selects strokes only">Strokes</button>
        <button type="button" role="radio" data-filter="all" title="Lasso selects strokes and fully enclosed media">All</button>
      </div>
      <div class="tb-group">
        <button type="button" data-action="import" aria-label="Import image" title="Import image">${ICONS.imagePlus}</button>
        <button type="button" data-action="undo" aria-label="Undo" title="Undo (Ctrl+Z)">${ICONS.undo}</button>
        <button type="button" data-action="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${ICONS.redo}</button>
        <button type="button" data-action="delete" aria-label="Delete selection" title="Delete selection (Del)">${ICONS.trash}</button>
      </div>
      <input type="file" accept="image/*" multiple hidden data-testid="import-input">
    </div>
    <div class="toast" role="status" aria-live="polite" hidden></div>
  `;
  const input = root.querySelector<HTMLInputElement>("input[type=file]")!;
  const toast = root.querySelector<HTMLElement>(".toast")!;
  input.addEventListener("change", () => {
    if (input.files?.length) actions.importFiles([...input.files]);
    input.value = "";
  });

  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    const d = b.dataset;
    if (d["tool"]) editor.setTool(d["tool"] as Tool);
    else if (d["color"]) {
      editor.penColor = d["color"];
      editor.changed();
    } else if (d["width"]) {
      editor.penWidthPx = Number(d["width"]);
      editor.changed();
    } else if (d["filter"]) {
      editor.lassoFilter = d["filter"] as "strokes" | "all";
      editor.changed();
    } else if (d["action"] === "import") input.click();
    else if (d["action"] === "undo") actions.undo();
    else if (d["action"] === "redo") actions.redo();
    else if (d["action"] === "delete") actions.deleteSelection();
  });

  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  const update = (): void => {
    for (const b of root.querySelectorAll<HTMLElement>("[data-tool]")) {
      b.setAttribute("aria-checked", String(b.dataset["tool"] === editor.tool));
    }
    for (const b of root.querySelectorAll<HTMLElement>("[data-color]")) b.classList.toggle("is-on", b.dataset["color"] === editor.penColor);
    for (const b of root.querySelectorAll<HTMLElement>("[data-width]")) b.classList.toggle("is-on", Number(b.dataset["width"]) === editor.penWidthPx);
    for (const b of root.querySelectorAll<HTMLElement>("[data-filter]")) {
      b.setAttribute("aria-checked", String(b.dataset["filter"] === editor.lassoFilter));
    }
    for (const g of root.querySelectorAll<HTMLElement>(".tb-options")) g.hidden = g.dataset["for"] !== editor.tool;
    root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled = !doc.canUndo;
    root.querySelector<HTMLButtonElement>('[data-action="redo"]')!.disabled = !doc.canRedo;
    root.querySelector<HTMLButtonElement>('[data-action="delete"]')!.disabled = editor.selection.size === 0;
    if (editor.message) {
      toast.textContent = editor.message;
      toast.hidden = false;
      editor.message = "";
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast.hidden = true), 5000);
    }
  };
  editor.subscribe(update);
  doc.subscribe(update);
  update();
}
