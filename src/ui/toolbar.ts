import { toolHint } from "./tool-hint";
import type { AlignChoice, CapChoice, JoinChoice } from "../doc/stroke-look";
import type { EditorState, Tool } from "../app/editor-state";
import { PEN_WIDTHS } from "../app/editor-state";
import type { PaintPatch } from "../app/actions";
import { SHAPE_KINDS } from "../doc/path";
import type { Paint } from "../doc/paint";
import { paintCss } from "../doc/paint";
import type { ShapeKind } from "../doc/path";
import { openColourPopover, openOutlinePopover, openPaintPopover, recentColours } from "./colour-popover";
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
  /** Set the thickness (screen px at this zoom) of the selected strokes and paths: one undo step. */
  setSelectedWidth(px: number): void;
  /** The fill and outline of the first selected path, or null when no path is selected. */
  selectedPaint(): { fill: Paint | null; stroke: Paint | null } | null;
  /** Show (final false: while the picker is dragged) or store (final true) a new fill or outline on the selected paths. */
  paintSelected(patch: PaintPatch, final: boolean): void;
  /** The corners, ends and place of the first selected path's outline and its width in px at this zoom; null when no path is selected. */
  selectedOutline(): { join: JoinChoice; cap: CapChoice; align: AlignChoice; closed: boolean; widthPx: number | null } | null;
  /** The first picked shape whose numbers can still be changed (null: none): its kind, sides, points, star ratio (0-1) and corner radius in px at this zoom. */
  selectedShape(): { shape: "rect" | "polygon" | "star"; sides: number; tips: number; inner: number; radiusPx: number } | null;
  /** Change the sides, points, ratio or corner radius (px) of the picked shapes: one undo step. */
  shapeSelected(change: { sides?: number; tips?: number; inner?: number; radiusPx?: number }): void;
  /** Store a new corner style, end style or position on the selected paths' outlines (one undo step). */
  outlineSelected(patch: { join?: JoinChoice; cap?: CapChoice; align?: AlignChoice }): void;
}

const TOOLS: Array<{ tool: Tool; icon: string; label: string; key: string }> = [
  { tool: "hand", icon: ICONS.hand, label: "Hand (pan)", key: "H" },
  { tool: "select", icon: ICONS.pointer, label: "Select", key: "V" },
  { tool: "node", icon: ICONS.nodeTool, label: "Edit nodes", key: "N" },
  { tool: "pen", icon: ICONS.pencil, label: "Pen", key: "P" },
  { tool: "shape", icon: ICONS.shapeTool, label: "Shape and path", key: "U" },
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

const SHAPE_MENU: Array<{ id: ShapeKind; label: string; title: string; icon: string }> = [
  { id: "rect", label: "Rectangle", title: "Rectangle: drag; Shift for a square, Alt to draw from the centre", icon: ICONS.rectangleHorizontal },
  { id: "ellipse", label: "Ellipse", title: "Ellipse: drag; Shift for a circle, Alt to draw from the centre", icon: ICONS.ellipseShape },
  { id: "line", label: "Line", title: "Line: drag; Shift for steps of 45 degrees, Alt to draw from the middle", icon: ICONS.lineShape },
  { id: "polygon", label: "Polygon", title: "Polygon: drag; the number of sides is set beside it", icon: ICONS.polygonShape },
  { id: "star", label: "Star", title: "Star: drag; the number of points is set beside it", icon: ICONS.starShape },
];
void SHAPE_KINDS;

export const LAYOUT_MENU: Array<{ head: string; items: Array<{ id: string; label: string; icon: string }> }> = [
  {
    head: "Arrange in a grid",
    items: [
      { id: "grid:name-asc", label: "By name, A to Z", icon: ICONS.arrowDownAZ },
      { id: "grid:name-desc", label: "By name, Z to A", icon: ICONS.arrowDownZA },
      { id: "grid:date", label: "By date added, newest first", icon: ICONS.calendarDays },
      { id: "grid:size", label: "By size, largest first", icon: ICONS.rulerIcon },
      { id: "grid:type", label: "By type", icon: ICONS.fileType },
      { id: "grid:stack", label: "In stacking order", icon: ICONS.chevronsUpDown },
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
        <button type="button" class="layers-toggle" data-tags aria-pressed="false" aria-label="Tags panel" title="Tags: tag items on this canvas, and rename or delete a tag">${ICONS.tag}</button>
        <button type="button" class="layers-toggle" data-bookmarks aria-pressed="false" aria-label="Bookmarks panel" title="Bookmarks: saved places and zooms on this canvas">${ICONS.bookmark}</button>
        <button type="button" data-action="import" aria-label="Import files" title="Import files: pictures, video, audio, or any other file (kept as a card you can download)">${ICONS.imagePlus}</button>
      </div>
      <input type="file" multiple hidden data-testid="import-input">
    </div>
    <div class="toolbar" role="toolbar" aria-label="Tool options" hidden>
      <div class="tb-options-row">
      <div class="tb-group tb-options" data-for="pen text">
        <span class="tb-recents" data-recents role="group" aria-label="Recent colours"></span>
        <button type="button" class="swatch swatch-current" data-colour-open aria-haspopup="dialog" aria-expanded="false" aria-label="Pen colour" title="Pen and text colour: open the colour picker"><span data-colour-chip></span></button>
      </div>
      <div class="tb-group tb-options" data-for="shape path" role="radiogroup" aria-label="Shape or path">
        ${SHAPE_MENU.map((k) => `<button type="button" role="radio" class="shape-kind" data-shape-kind="${k.id}" aria-label="${k.label}" title="${k.title}">${k.icon}</button>`).join("")}
        <button type="button" role="radio" class="shape-kind" data-tool="path" aria-label="Path (curves)" title="Path (curves): click corners, drag for a curve, click the first node to close (B)">${ICONS.pathTool}</button>
      </div>
      <div class="tb-group tb-options" data-for="shape">
        <label class="tb-count" data-sides-wrap hidden>Sides <input type="number" data-sides min="3" max="24" step="1" inputmode="numeric" aria-label="Polygon sides"></label>
        <label class="tb-count" data-tips-wrap hidden>Points <input type="number" data-tips min="3" max="24" step="1" inputmode="numeric" aria-label="Star points"></label>
      </div>
      <div class="tb-group tb-options" data-for="select node" data-shape-props>
        <label class="tb-count" data-sel-radius-wrap hidden>Radius <input type="number" data-sel-radius min="0" step="1" inputmode="decimal" aria-label="Corner radius (px)" title="Corner radius, in px at this zoom"></label>
        <label class="tb-count" data-sel-sides-wrap hidden>Sides <input type="number" data-sel-sides min="3" max="24" step="1" inputmode="numeric" aria-label="Polygon sides"></label>
        <label class="tb-count" data-sel-tips-wrap hidden>Points <input type="number" data-sel-tips min="3" max="24" step="1" inputmode="numeric" aria-label="Star points"></label>
        <label class="tb-count" data-sel-inner-wrap hidden>Ratio <input type="number" data-sel-inner min="5" max="95" step="1" inputmode="numeric" aria-label="Star ratio (percent)" title="Inner radius as a percent of the outer one"></label>
      </div>
      <div class="tb-group tb-options" data-for="shape path select node">
        <button type="button" class="swatch swatch-paint" data-paint="fill" aria-haspopup="dialog" aria-expanded="false" aria-label="Fill" title="Fill colour: open the colour picker"><span data-paint-chip></span><b class="swatch-name">Fill</b></button>
        <button type="button" class="swatch swatch-paint" data-paint="stroke" aria-haspopup="dialog" aria-expanded="false" aria-label="Outline" title="Outline colour: open the colour picker"><span data-paint-chip></span><b class="swatch-name">Outline</b></button>
      <button type="button" class="swatch swatch-outline" data-outline-options aria-haspopup="dialog" aria-expanded="false" aria-label="Outline options" title="Outline options: width, position (inside, centre, outside), corners and ends">${ICONS.outlineOptions}</button>
      </div>
      <div class="tb-group tb-options" data-for="shape path">
        <input type="range" class="size" data-shape-width min="0" max="100" step="1" aria-label="Outline width" title="Outline width (screen px at this zoom)">
        <span class="size-out" data-shape-out></span>
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
        <button type="button" data-action="copy-md" aria-label="Copy Markdown" title="Copy Markdown of the selected text" hidden>${ICONS.clipboardCopy}</button>
      </div>
      <div class="tb-group tb-options" data-for="eraser">
        <input type="range" class="size" data-eraser-size min="4" max="128" step="1" aria-label="Eraser size" title="Eraser diameter (screen px)">
        <span class="size-out" data-eraser-out></span>
        <button type="button" class="snap" data-erase-groups aria-pressed="true" aria-label="Erase whole groups" title="On: a swipe takes a group as one object. Off: it takes only the members it touches.">${ICONS.shapes}</button>
      </div>
      <div class="tb-group tb-options" data-for="lasso" role="radiogroup" aria-label="Lasso selects">
        <button type="button" role="radio" data-filter="strokes" title="Lasso selects strokes only">Strokes</button>
        <button type="button" role="radio" data-filter="all" title="Lasso selects strokes and fully enclosed media">All</button>
      </div>
      </div>
      <p class="tool-hint" data-testid="tool-hint" aria-live="polite" hidden></p>
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

  root.querySelector<HTMLInputElement>("[data-shape-width]")!.addEventListener("input", (e) => {
    editor.shapeWidthPx = penFromSlider(Number((e.target as HTMLInputElement).value));
    editor.changed();
  });
  root.querySelector<HTMLInputElement>("[data-sides]")!.addEventListener("input", (e) => {
    const v = Math.round(Number((e.target as HTMLInputElement).value));
    if (v >= 3 && v <= 24) {
      editor.shapeSides = v;
      editor.changed();
    }
  });
  root.querySelector<HTMLInputElement>("[data-tips]")!.addEventListener("input", (e) => {
    const v = Math.round(Number((e.target as HTMLInputElement).value));
    if (v >= 3 && v <= 24) {
      editor.shapeTips = v;
      editor.changed();
    }
  });

  // The fill and outline chips: the colours the next shape gets (Shape and Path tools), or those of the selected paths.
  const editsSelection = (): boolean => editor.tool === "select" || editor.tool === "node";
  const paintNow = (which: "fill" | "stroke"): Paint | null => (editsSelection() ? (actions.selectedPaint()?.[which] ?? null) : which === "fill" ? editor.shapeFill : editor.shapeStroke);
  const setPaint = (which: "fill" | "stroke", value: Paint | null, final: boolean): void => {
    if (editsSelection()) actions.paintSelected({ [which]: value }, final);
    else {
      if (which === "fill") editor.shapeFill = value;
      else editor.shapeStroke = value;
      editor.changed();
    }
  };
  const openPaint = (anchor: HTMLElement, which: "fill" | "stroke"): void => {
    editor.gradientFocus = which; // the handles on the canvas are this paint's
    openPaintPopover(anchor, {
      name: which === "fill" ? "Fill" : "Outline",
      paint: paintNow(which),
      noneLabel: which === "fill" ? "No fill" : "No outline",
      onInput: (p) => setPaint(which, p, false),
      onChange: (p) => setPaint(which, p, true),
      onClose: () => {
        if (editsSelection()) actions.paintSelected({}, true); // drop a preview that was never stored
      },
    });
  };

  // The numbers of the picked shape (a polygon's sides, a star's points and ratio, a corner radius): changed after the shape is drawn.
  const shapeInput = (sel: string, apply: (v: number) => { sides?: number; tips?: number; inner?: number; radiusPx?: number } | null): void => {
    root.querySelector<HTMLInputElement>(sel)!.addEventListener("change", (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      const change = Number.isFinite(v) ? apply(v) : null;
      if (change) actions.shapeSelected(change);
    });
  };
  shapeInput("[data-sel-radius]", (v) => (v >= 0 ? { radiusPx: v } : null));
  shapeInput("[data-sel-sides]", (v) => (v >= 3 && v <= 24 ? { sides: Math.round(v) } : null));
  shapeInput("[data-sel-tips]", (v) => (v >= 3 && v <= 24 ? { tips: Math.round(v) } : null));
  shapeInput("[data-sel-inner]", (v) => (v >= 5 && v <= 95 ? { inner: v / 100 } : null));

  const openOutline = (anchor: HTMLElement): void => {
    const sel = editsSelection() ? actions.selectedOutline() : null;
    if (editsSelection() && !sel) return;
    openOutlinePopover(anchor, {
      widthPx: sel ? sel.widthPx : editor.shapeWidthPx,
      join: sel ? sel.join : (editor.shapeJoin ?? "miter"),
      cap: sel ? sel.cap : editor.shapeCap,
      align: sel ? sel.align : editor.shapeAlign,
      closed: sel ? sel.closed : editor.tool === "shape" && editor.shapeKind !== "line",
      onWidth: (px) => {
        if (sel) actions.setSelectedWidth(px);
        else {
          editor.shapeWidthPx = px;
          editor.changed();
        }
      },
      onStyle: (patch) => {
        if (sel) actions.outlineSelected(patch);
        else {
          if (patch.join) editor.shapeJoin = patch.join;
          if (patch.cap) editor.shapeCap = patch.cap;
          if (patch.align) editor.shapeAlign = patch.align;
          editor.changed();
        }
      },
    });
  };

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
    } else if (d["shapeKind"]) {
      editor.shapeKind = d["shapeKind"] as ShapeKind;
      if (editor.tool === "path") editor.setTool("shape");
      editor.changed();
    } else if (d["outlineOptions"] !== undefined) {
      openOutline(b);
    } else if (d["paint"]) {
      openPaint(b, d["paint"] as "fill" | "stroke");
    } else if (d["colourOpen"] !== undefined) {
      openColourPopover(b, {
        name: "Pen colour",
        value: editor.penColor,
        onInput: (hex) => {
          editor.penColor = hex;
          editor.changed();
        },
        onChange: () => editor.changed(), // the recent colours changed
      });
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
    } else if (d["tags"] !== undefined) {
      editor.tagsOpen = !editor.tagsOpen;
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
      // (Shape and Path are one place on the rail: the Shape button stays lit on the Path tool, which is chosen in the options beside the shapes)
      const on = b.dataset["tool"] === editor.tool || (b.dataset["tool"] === "shape" && editor.tool === "path" && !b.closest(".tb-options"));
      b.setAttribute("aria-checked", String(on));
    }
    for (const b of root.querySelectorAll<HTMLElement>("[data-pen-kind]")) b.setAttribute("aria-checked", String(b.dataset["penKind"] === editor.penKind));
    const recent = recentColours();
    const recents = root.querySelector<HTMLElement>("[data-recents]")!;
    if (recents.dataset["list"] !== recent.join()) {
      recents.dataset["list"] = recent.join();
      recents.innerHTML = recent
        .map((c) => `<button type="button" class="swatch" data-color="${c}" aria-label="Pen colour ${c.toUpperCase()}" title="${c.toUpperCase()}"><span style="background:${swatchBackground(c)}"></span></button>`)
        .join("");
    }
    for (const b of root.querySelectorAll<HTMLElement>("[data-color]")) b.classList.toggle("is-on", (b.dataset["color"] ?? "").toLowerCase() === editor.penColor.toLowerCase());
    root.querySelector<HTMLElement>("[data-colour-chip]")!.style.background = swatchBackground(editor.penColor);
    for (const b of root.querySelectorAll<HTMLElement>("[data-shape-kind]")) b.setAttribute("aria-checked", String(editor.tool === "shape" && b.dataset["shapeKind"] === editor.shapeKind));
    const sides = root.querySelector<HTMLInputElement>("[data-sides]")!;
    const tips = root.querySelector<HTMLInputElement>("[data-tips]")!;
    root.querySelector<HTMLElement>("[data-sides-wrap]")!.hidden = editor.shapeKind !== "polygon";
    root.querySelector<HTMLElement>("[data-tips-wrap]")!.hidden = editor.shapeKind !== "star";
    if (document.activeElement !== sides) sides.value = String(editor.shapeSides);
    if (document.activeElement !== tips) tips.value = String(editor.shapeTips);
    const shp = editor.tool === "select" || editor.tool === "node" ? actions.selectedShape() : null;
    for (const [key, shown, value] of [["radius", !!shp, shp ? Math.round(shp.radiusPx * 100) / 100 : 0], ["sides", shp?.shape === "polygon", shp?.sides ?? 0], ["tips", shp?.shape === "star", shp?.tips ?? 0], ["inner", shp?.shape === "star", shp ? Math.round(shp.inner * 100) : 0]] as const) {
      root.querySelector<HTMLElement>(`[data-sel-${key}-wrap]`)!.hidden = !shown;
      const input = root.querySelector<HTMLInputElement>(`[data-sel-${key}]`)!;
      if (shown && document.activeElement !== input) input.value = String(value);
    }
    const sw = root.querySelector<HTMLInputElement>("[data-shape-width]")!;
    if (document.activeElement !== sw) sw.value = String(sliderFromPen(editor.shapeWidthPx));
    root.querySelector<HTMLElement>("[data-shape-out]")!.textContent = `${editor.shapeWidthPx} px`;
    // The paint chips show the next shape's colours, or the selected paths' (and are there only when something has them).
    const sel = editor.tool === "select" || editor.tool === "node" ? actions.selectedPaint() : null;
    root.querySelector<HTMLElement>("[data-outline-options]")!.hidden = (editor.tool === "select" || editor.tool === "node") && !sel;
    for (const b of root.querySelectorAll<HTMLButtonElement>("[data-paint]")) {
      const which = b.dataset["paint"] as "fill" | "stroke";
      const value = sel ? sel[which] : which === "fill" ? editor.shapeFill : editor.shapeStroke;
      b.hidden = (editor.tool === "select" || editor.tool === "node") && !sel;
      b.classList.toggle("is-none", value === null);
      (b.querySelector("[data-paint-chip]") as HTMLElement).style.setProperty("--paint", value === null ? "linear-gradient(transparent, transparent)" : typeof value === "string" ? `linear-gradient(${swatchBackground(value)}, ${swatchBackground(value)})` : paintCss(value));
    }
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
    root.querySelector<HTMLElement>("[data-tags]")!.setAttribute("aria-pressed", String(editor.tagsOpen));
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
    // On Select the pen-size slider sets the thickness of selected strokes: with only shapes (or pictures, text) picked it is not theirs to set
    // (a shape's width is in Outline options), so it is not offered.
    const penSize = root.querySelector<HTMLElement>("[data-size]")!.closest<HTMLElement>(".tb-options")!;
    penSize.dataset["for"] = editor.tool === "select" && editor.selection.size > 0 && ![...editor.selection].some((id) => doc.get(id)?.kind === "stroke") ? "pen" : "pen select";
    // The options bar shows what the current tool offers and is gone when there is nothing to show.
    for (const g of root.querySelectorAll<HTMLElement>(".tb-options")) g.hidden = !g.dataset["for"]!.split(" ").includes(editor.tool) || ![...g.children].some((c) => !(c as HTMLElement).hidden);
    const hint = root.querySelector<HTMLElement>("[data-testid=tool-hint]")!;
    const said = toolHint(editor, doc);
    hint.hidden = said === null;
    if (said !== null && hint.textContent !== said) hint.textContent = said;
    root.querySelector<HTMLElement>(".toolbar")!.hidden = !said && ![...root.querySelectorAll<HTMLElement>(".tb-options")].some((g) => !g.hidden);
  };
  editor.subscribe(update);
  doc.subscribe(update);
  update();
}
