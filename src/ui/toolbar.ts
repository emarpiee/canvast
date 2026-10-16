import type { EditorState, Tool } from "../app/editor-state";
import { PEN_COLORS, PEN_WIDTHS } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import type { LayoutCommand } from "../app/actions";
import type { AlignKey, SortKey } from "../doc/arrange";
import type { PenKind } from "../interaction/pens";
import { ICONS } from "./icons";
import { swatchBackground } from "../render/ink";
import { penFromSlider, sliderFromPen } from "../interaction/pen-width";

export interface ToolbarActions {
  importFiles(files: File[]): void;
  /** Open the canvas search (ADR 0060). */
  openSearch(prefix?: string): void;
  undo(): void;
  redo(): void;
  /** Copy the Markdown of the selected text objects. */
  copyMarkdown(): void;
  /** Current zoom level, for the thickness lock. */
  depth(): { levels: bigint; frac: number };
  clearFlag(flag: "hidden" | "locked"): void;
  /** Set the thickness (screen px at this zoom) of the selected strokes: one undo step. */
  setSelectedWidth(px: number): void;
}

const TOOLS: Array<{ tool: Tool; icon: string; label: string; key: string }> = [
  { tool: "hand", icon: ICONS.hand, label: "Hand (pan)", key: "H" },
  { tool: "select", icon: ICONS.pointer, label: "Select", key: "V" },
  { tool: "pen", icon: ICONS.pencil, label: "Pen", key: "P" },
  { tool: "lasso", icon: ICONS.lasso, label: "Lasso", key: "L" },
  { tool: "text", icon: ICONS.type, label: "Text", key: "T" },
  { tool: "eraser", icon: ICONS.eraser, label: "Object eraser", key: "E" },
];

const PEN_MENU: Array<{ id: PenKind; label: string; title: string; icon: string }> = [
  { id: "fine", label: "Fine pen", title: "Fine pen: a clean line of one width", icon: ICONS.penTool },
  { id: "pencil", label: "Pencil", title: "Pencil: graphite made of three thin, soft passes that wander a little", icon: ICONS.pencilLine },
  { id: "ink", label: "Ink pen", title: "Ink pen: a broad nib, thick across it and thin along it; pressure or speed thins and thickens the line", icon: ICONS.penLine },
  { id: "marker", label: "Marker", title: "Marker: a wide, translucent line", icon: ICONS.highlighter },
];

export const LAYOUT_MENU: Array<{ head: string; items: Array<{ id: string; label: string; icon: string }> }> = [
  {
    head: "Arrange in a grid",
    items: [
      { id: "grid:name-asc", label: "By name, A to Z", icon: ICONS.arrowDownAZ },
      { id: "grid:name-desc", label: "By name, Z to A", icon: ICONS.arrowDownZA },
      { id: "grid:date", label: "By date added, newest first", icon: ICONS.calendarDays },
      { id: "grid:size", label: "By size, largest first", icon: ICONS.rulerIcon },
      { id: "grid:type", label: "By type", icon: ICONS.fileType },
      { id: "grid:stack", label: "In stacking order", icon: ICONS.layers2 },
    ],
  },
  {
    head: "Align",
    items: [
      { id: "align:left", label: "Left", icon: ICONS.alignHStart },
      { id: "align:centre", label: "Centre", icon: ICONS.alignHCenter },
      { id: "align:right", label: "Right", icon: ICONS.alignHEnd },
      { id: "align:top", label: "Top", icon: ICONS.alignVStart },
      { id: "align:middle", label: "Middle", icon: ICONS.alignVCenter },
      { id: "align:bottom", label: "Bottom", icon: ICONS.alignVEnd },
    ],
  },
  {
    head: "Distribute (3 or more)",
    items: [
      { id: "distribute:x", label: "Horizontally", icon: ICONS.distH },
      { id: "distribute:y", label: "Vertically", icon: ICONS.distV },
    ],
  },
];

export function mountToolbar(root: HTMLElement, editor: EditorState, doc: DocumentStore, actions: ToolbarActions): void {
  root.innerHTML = `
    <div class="rail" role="radiogroup" aria-label="Tool" aria-orientation="vertical">
      ${TOOLS.map(
        (t) => `<button type="button" role="radio" data-tool="${t.tool}" aria-label="${t.label}" title="${t.label} (${t.key})">${t.icon}</button>`,
      ).join("")}
    </div>
    <div class="dock" role="toolbar" aria-label="History and panels">
      <div class="tb-group">
        <button type="button" data-action="undo" aria-label="Undo" title="Undo (Ctrl+Z)">${ICONS.undo}</button>
        <button type="button" data-action="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${ICONS.redo}</button>
      </div>
      <div class="tb-group">
        <button type="button" data-action="search" aria-label="Search the canvas" title="Search the canvas (/ name, # tag, @ bookmark)">${ICONS.search}</button>
        <button type="button" class="layers-toggle" data-layers aria-pressed="false" aria-label="Layers panel" title="Layers: show or hide the floating Layers panel">${ICONS.layers}</button>
        <button type="button" class="layers-toggle" data-bookmarks aria-pressed="false" aria-label="Bookmarks panel" title="Bookmarks: saved places and zooms on this canvas">${ICONS.bookmark}</button>
        <button type="button" data-action="import" aria-label="Import image" title="Import image, video or audio">${ICONS.imagePlus}</button>
      </div>
      <input type="file" accept="image/*,video/*,audio/*" multiple hidden data-testid="import-input">
    </div>
    <div class="toolbar" role="toolbar" aria-label="Tool options" hidden>
      <div class="tb-options-row">
      <div class="tb-group tb-options" data-for="pen text">
        ${PEN_COLORS.map(
          (c) => `<button type="button" class="swatch" data-color="${c}" aria-label="Pen colour ${c}" title="Pen and text colour"><span style="background:${swatchBackground(c)}"></span></button>`,
        ).join("")}
      </div>
      <div class="tb-group tb-options" data-for="pen" role="radiogroup" aria-label="Pen">
        ${PEN_MENU.map((k) => `<button type="button" role="radio" class="pen-kind" data-pen-kind="${k.id}" aria-label="${k.label}" title="${k.title}">${k.icon}</button>`).join("")}
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
        <button type="button" data-action="show-all" aria-label="Show all hidden" title="Show every hidden object">${ICONS.eye}</button>
        <button type="button" data-action="unlock-all" aria-label="Unlock all" title="Unlock every locked object">${ICONS.lockKeyholeOpen}</button>
        <button type="button" class="snap" data-align-box aria-pressed="false" aria-label="Axis-aligned selection box" title="Selection box: by default it turns with the selected objects when they share a rotation. On: it stays aligned to the canvas axes.">${ICONS.boxSelect}</button>
        <button type="button" class="snap" data-snap aria-pressed="true" aria-label="Snap to other objects" title="Snap to other objects: while moving, edges and centres line up with other objects (exactly, at any zoom), with a guide line">${ICONS.magnet}</button>
        <button type="button" class="ignore-fill" data-ignore-fill aria-pressed="false" aria-label="Ignore the object that fills the view" title="Ignore the object that fills the view: clicking, lasso and box select skip an object you have zoomed far into, so it cannot be picked or deleted by accident">${ICONS.pointerBan}</button>
      </div>
      <div class="tb-group tb-options" data-for="select text">
        <button type="button" data-action="copy-md" aria-label="Copy Markdown" title="Copy Markdown of the selected text" hidden>${ICONS.copy}</button>
      </div>
      <div class="tb-group tb-options" data-for="eraser">
        <input type="range" class="size" data-eraser-size min="4" max="128" step="1" aria-label="Eraser size" title="Eraser diameter (screen px)">
        <span class="size-out" data-eraser-out></span>
        <button type="button" class="snap" data-erase-groups aria-pressed="true" aria-label="Erase whole groups" title="On: a swipe takes a group as one object. Off: it takes only the members it touches.">${ICONS.group}</button>
      </div>
      <div class="tb-group tb-options" data-for="lasso" role="radiogroup" aria-label="Lasso selects">
        <button type="button" role="radio" data-filter="strokes" title="Lasso selects strokes only">Strokes</button>
        <button type="button" role="radio" data-filter="all" title="Lasso selects strokes and fully enclosed media">All</button>
      </div>
      </div>
    </div>
  `;
  const input = root.querySelector<HTMLInputElement>("input[type=file]")!;
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

  root.querySelector<HTMLInputElement>("[data-eraser-size]")!.addEventListener("input", (e) => {
    editor.eraserPx = Number((e.target as HTMLInputElement).value);
    editor.changed();
  });

  root.querySelector<HTMLInputElement>("[data-strength]")!.addEventListener("input", (e) => {
    editor.stabilizer = { ...editor.stabilizer, strength: Number((e.target as HTMLInputElement).value) };
    editor.changed();
  });

  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    const d = b.dataset;
    if (d["penKind"]) {
      editor.penKind = d["penKind"] as PenKind;
      editor.changed();
    } else if (d["tool"]) editor.setTool(d["tool"] as Tool);
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
    } else if (d["bookmarks"] !== undefined) {
      editor.bookmarksOpen = !editor.bookmarksOpen;
      editor.changed();
    } else if (d["layers"] !== undefined) {
      editor.layersOpen = !editor.layersOpen;
      editor.changed();
    } else if (d["eraseGroups"] !== undefined) {
      editor.eraseWholeGroups = !editor.eraseWholeGroups;
      editor.changed();
    } else if (d["alignBox"] !== undefined) {
      editor.alignBox = !editor.alignBox;
      editor.changed();
    } else if (d["snap"] !== undefined) {
      editor.snap = !editor.snap;
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
    else if (d["action"] === "search") actions.openSearch("");
    else if (d["action"] === "undo") actions.undo();
    else if (d["action"] === "redo") actions.redo();
    else if (d["action"] === "show-all") actions.clearFlag("hidden");
    else if (d["action"] === "unlock-all") actions.clearFlag("locked");
    else if (d["action"] === "copy-md") actions.copyMarkdown();
  });

  const update = (): void => {
    for (const b of root.querySelectorAll<HTMLElement>("[data-tool]")) {
      b.setAttribute("aria-checked", String(b.dataset["tool"] === editor.tool));
    }
    for (const b of root.querySelectorAll<HTMLElement>("[data-pen-kind]")) b.setAttribute("aria-checked", String(b.dataset["penKind"] === editor.penKind));
    for (const b of root.querySelectorAll<HTMLElement>("[data-color]")) b.classList.toggle("is-on", b.dataset["color"] === editor.penColor);
    for (const b of root.querySelectorAll<HTMLElement>("[data-width]")) b.classList.toggle("is-on", Number(b.dataset["width"]) === editor.penWidthPx);
    const size = root.querySelector<HTMLInputElement>("[data-size]")!;
    if (document.activeElement !== size) size.value = String(sliderFromPen(editor.penWidthPx));
    root.querySelector<HTMLElement>("[data-size-out]")!.textContent = `${editor.penWidthPx} px`;
    root.querySelector<HTMLElement>("[data-stab]")!.setAttribute("aria-pressed", String(editor.stabilizer.on));
    const strength = root.querySelector<HTMLInputElement>("[data-strength]")!;
    strength.hidden = !editor.stabilizer.on;
    if (document.activeElement !== strength) strength.value = String(editor.stabilizer.strength);
    const es = root.querySelector<HTMLInputElement>("[data-eraser-size]")!;
    if (document.activeElement !== es) es.value = String(editor.eraserPx);
    root.querySelector<HTMLElement>("[data-eraser-out]")!.textContent = `${editor.eraserPx} px`;
    root.querySelector<HTMLElement>("[data-erase-groups]")!.setAttribute("aria-pressed", String(editor.eraseWholeGroups));
    root.querySelector<HTMLElement>("[data-bookmarks]")!.setAttribute("aria-pressed", String(editor.bookmarksOpen));
    root.querySelector<HTMLElement>("[data-layers]")!.setAttribute("aria-pressed", String(editor.layersOpen));
    root.querySelector<HTMLElement>("[data-align-box]")!.setAttribute("aria-pressed", String(editor.alignBox));
    root.querySelector<HTMLElement>("[data-snap]")!.setAttribute("aria-pressed", String(editor.snap));
    root.querySelector<HTMLElement>("[data-ignore-fill]")!.setAttribute("aria-pressed", String(editor.ignoreFilling));
    root.querySelector<HTMLElement>("[data-follow]")!.setAttribute("aria-pressed", String(editor.followZoom));
    root.querySelector<HTMLElement>("[data-lock]")!.setAttribute("aria-pressed", String(editor.lock !== null));
    for (const b of root.querySelectorAll<HTMLElement>("[data-filter]")) {
      b.setAttribute("aria-checked", String(b.dataset["filter"] === editor.lassoFilter));
    }
    root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled = !doc.canUndo;
    root.querySelector<HTMLButtonElement>('[data-action="redo"]')!.disabled = !doc.canRedo;
    root.querySelector<HTMLButtonElement>('[data-action="copy-md"]')!.hidden = ![...editor.selection].some((id) => doc.get(id)?.kind === "text");
    // The options bar shows what the current tool offers and is gone when there is nothing to show.
    for (const g of root.querySelectorAll<HTMLElement>(".tb-options")) g.hidden = !g.dataset["for"]!.split(" ").includes(editor.tool) || ![...g.children].some((c) => !(c as HTMLElement).hidden);
    root.querySelector<HTMLElement>(".toolbar")!.hidden = ![...root.querySelectorAll<HTMLElement>(".tb-options")].some((g) => !g.hidden);
  };
  editor.subscribe(update);
  doc.subscribe(update);
  update();
}
