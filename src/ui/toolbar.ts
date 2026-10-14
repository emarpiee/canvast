import type { EditorState, Tool } from "../app/editor-state";
import { PEN_COLORS, PEN_WIDTHS } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import { ICONS } from "./icons";
import { penFromSlider, sliderFromPen } from "../interaction/pen-width";

export interface ToolbarActions {
  importFiles(files: File[]): void;
  undo(): void;
  redo(): void;
  deleteSelection(): void;
  /** Copy the Markdown of the selected text objects. */
  copyMarkdown(): void;
  /** Current zoom level, for the thickness lock. */
  depth(): { levels: bigint; frac: number };
  /** Set the thickness (screen px at this zoom) of the selected strokes: one undo step. */
  setSelectedWidth(px: number): void;
}

const TOOLS: Array<{ tool: Tool; icon: string; label: string; key: string }> = [
  { tool: "hand", icon: ICONS.hand, label: "Hand (pan)", key: "H" },
  { tool: "select", icon: ICONS.pointer, label: "Select", key: "V" },
  { tool: "pen", icon: ICONS.pencil, label: "Pen", key: "P" },
  { tool: "lasso", icon: ICONS.lasso, label: "Lasso", key: "L" },
  { tool: "text", icon: ICONS.type, label: "Text", key: "T" },
];

export function mountToolbar(root: HTMLElement, editor: EditorState, doc: DocumentStore, actions: ToolbarActions): void {
  root.innerHTML = `
    <div class="toolbar" role="toolbar" aria-label="Tools">
      <div class="tb-group" role="radiogroup" aria-label="Tool">
        ${TOOLS.map(
          (t) => `<button type="button" role="radio" data-tool="${t.tool}" aria-label="${t.label}" title="${t.label} (${t.key})">${t.icon}</button>`,
        ).join("")}
      </div>
      <div class="tb-group tb-options" data-for="pen text">
        ${PEN_COLORS.map(
          (c) => `<button type="button" class="swatch" data-color="${c}" aria-label="Pen colour ${c}" title="Pen and text colour"><span style="background:${c}"></span></button>`,
        ).join("")}
      </div>
      <div class="tb-group tb-options" data-for="pen">
        ${PEN_WIDTHS.map(
          (w) => `<button type="button" class="width" data-width="${w}" aria-label="Pen width ${w} px" title="Pen width ${w} px"><span style="height:${Math.max(2, w)}px"></span></button>`,
        ).join("")}
      </div>
      <div class="tb-group tb-options" data-for="pen select">
        <input type="range" class="size" data-size min="0" max="100" step="1" aria-label="Pen size" title="Pen size (screen px at this zoom); on Select it sets the thickness of the selected strokes">
        <span class="size-out" data-size-out></span>
      </div>
      <div class="tb-group tb-options" data-for="pen">
        <button type="button" class="stab" data-stab aria-pressed="false" aria-label="Stabilizer" title="Stabilizer: smooths hand wobble; the brush follows the pointer on a rope">${ICONS.waves}</button>
        <input type="range" class="size" data-strength min="1" max="100" step="1" aria-label="Stabilizer strength" title="Stabilizer strength (rope length)" hidden>
        <button type="button" class="follow" data-follow aria-pressed="false" aria-label="Pen size follows zoom" title="Pen size follows zoom: while drawing, the pen keeps its size on screen when you zoom (the line gets thinner or thicker along its length)">${ICONS.scaling}</button>
      </div>
      <div class="tb-group tb-options" data-for="pen select">
        <button type="button" class="lock" data-lock aria-pressed="false" aria-label="Lock thickness" title="Lock thickness: new strokes keep this width on the canvas at any zoom; resizing a stroke keeps its line width">${ICONS.lock}</button>
      </div>
      <div class="tb-group tb-options" data-for="select">
        <button type="button" class="ignore-fill" data-ignore-fill aria-pressed="false" aria-label="Ignore the object that fills the view" title="Ignore the object that fills the view: clicking, lasso and box select skip an object you have zoomed far into, so it cannot be picked or deleted by accident">${ICONS.pointerBan}</button>
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
        <button type="button" data-action="copy-md" aria-label="Copy Markdown" title="Copy Markdown of the selected text" hidden>${ICONS.copy}</button>
      </div>
      <input type="file" accept="image/*" multiple hidden data-testid="import-input">
    </div>
    <div class="toast" role="status" aria-live="polite" data-testid="toast" hidden></div>
  `;
  const input = root.querySelector<HTMLInputElement>("input[type=file]")!;
  const toast = root.querySelector<HTMLElement>(".toast")!;
  input.addEventListener("change", () => {
    if (input.files?.length) actions.importFiles([...input.files]);
    input.value = "";
  });

  // Continuous pen size: a new size is the new lock reference, like a preset.
  root.querySelector<HTMLInputElement>("[data-size]")!.addEventListener("input", (e) => {
    editor.penWidthPx = penFromSlider(Number((e.target as HTMLInputElement).value));
    if (editor.lock) editor.lock = { ...actions.depth(), px: editor.penWidthPx };
    editor.changed();
  });

  // On Select the slider also sets the selected strokes' thickness, once on release (one undo step).
  root.querySelector<HTMLInputElement>("[data-size]")!.addEventListener("change", () => {
    if (editor.tool === "select") actions.setSelectedWidth(editor.penWidthPx);
  });

  root.querySelector<HTMLInputElement>("[data-strength]")!.addEventListener("input", (e) => {
    editor.stabilizer = { ...editor.stabilizer, strength: Number((e.target as HTMLInputElement).value) };
    editor.changed();
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
      if (editor.lock) editor.lock = { ...actions.depth(), px: editor.penWidthPx }; // a new size is the new reference
      editor.changed();
    } else if (d["stab"] !== undefined) {
      editor.stabilizer = { ...editor.stabilizer, on: !editor.stabilizer.on };
      editor.changed();
    } else if (d["ignoreFill"] !== undefined) {
      editor.ignoreFilling = !editor.ignoreFilling;
      editor.changed();
    } else if (d["follow"] !== undefined) {
      editor.followZoom = !editor.followZoom;
      editor.changed();
    } else if (d["lock"] !== undefined) {
      editor.lock = editor.lock ? null : { ...actions.depth(), px: editor.penWidthPx };
      editor.changed();
    } else if (d["filter"]) {
      editor.lassoFilter = d["filter"] as "strokes" | "all";
      editor.changed();
    } else if (d["action"] === "import") input.click();
    else if (d["action"] === "undo") actions.undo();
    else if (d["action"] === "redo") actions.redo();
    else if (d["action"] === "delete") actions.deleteSelection();
    else if (d["action"] === "copy-md") actions.copyMarkdown();
  });

  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  const update = (): void => {
    for (const b of root.querySelectorAll<HTMLElement>("[data-tool]")) {
      b.setAttribute("aria-checked", String(b.dataset["tool"] === editor.tool));
    }
    for (const b of root.querySelectorAll<HTMLElement>("[data-color]")) b.classList.toggle("is-on", b.dataset["color"] === editor.penColor);
    for (const b of root.querySelectorAll<HTMLElement>("[data-width]")) b.classList.toggle("is-on", Number(b.dataset["width"]) === editor.penWidthPx);
    const size = root.querySelector<HTMLInputElement>("[data-size]")!;
    if (document.activeElement !== size) size.value = String(sliderFromPen(editor.penWidthPx));
    root.querySelector<HTMLElement>("[data-size-out]")!.textContent = `${editor.penWidthPx} px`;
    root.querySelector<HTMLElement>("[data-stab]")!.setAttribute("aria-pressed", String(editor.stabilizer.on));
    const strength = root.querySelector<HTMLInputElement>("[data-strength]")!;
    strength.hidden = !editor.stabilizer.on;
    if (document.activeElement !== strength) strength.value = String(editor.stabilizer.strength);
    root.querySelector<HTMLElement>("[data-ignore-fill]")!.setAttribute("aria-pressed", String(editor.ignoreFilling));
    root.querySelector<HTMLElement>("[data-follow]")!.setAttribute("aria-pressed", String(editor.followZoom));
    root.querySelector<HTMLElement>("[data-lock]")!.setAttribute("aria-pressed", String(editor.lock !== null));
    for (const b of root.querySelectorAll<HTMLElement>("[data-filter]")) {
      b.setAttribute("aria-checked", String(b.dataset["filter"] === editor.lassoFilter));
    }
    for (const g of root.querySelectorAll<HTMLElement>(".tb-options")) g.hidden = !g.dataset["for"]!.split(" ").includes(editor.tool);
    root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled = !doc.canUndo;
    root.querySelector<HTMLButtonElement>('[data-action="redo"]')!.disabled = !doc.canRedo;
    root.querySelector<HTMLButtonElement>('[data-action="delete"]')!.disabled = editor.selection.size === 0;
    root.querySelector<HTMLButtonElement>('[data-action="copy-md"]')!.hidden = ![...editor.selection].some((id) => doc.get(id)?.kind === "text");
    // In Assets view, that view shows (and consumes) messages instead.
    if (editor.message && document.body.dataset["view"] !== "assets") {
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
