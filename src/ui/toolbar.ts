import { scrubNumbers } from "../colour-picker/scrub";
import type { AlignChoice, CapChoice, DashChoice, JoinChoice } from "../doc/stroke-look";
import type { EditorState, Tool } from "../app/editor-state";
import { PEN_WIDTHS } from "../app/editor-state";
import type { PaintPatch } from "../app/actions";
import { SHAPE_KINDS } from "../doc/path";
import type { Paint } from "../doc/paint";
import { paintCss } from "../doc/paint";
import type { ShapeKind } from "../doc/path";
import { moreButton, openMoreMenu } from "./more-menu";
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
  selectedOutline(): { join: JoinChoice; cap: CapChoice; align: AlignChoice; dash: DashChoice; closed: boolean; widthPx: number | null } | null;
  /** The picked shapes that have a shape of their own to save, and how many of them have an initial shape saved (null: none can). */
  initialShapeState(): { count: number; saved: number } | null;
  /** Save the picked shapes' shape as their initial one (or replace it), and put them back to it. */
  setInitialShape(onlyMissing?: boolean): void;
  resetToInitialShape(): void;
  /** The paints the picked shapes use (each once, gradients included) and how many shapes are picked. */
  selectionPaints(): { count: number; items: Array<{ paint: Paint; fills: number; strokes: number; ids: string[] }> };
  /** Change one paint to another everywhere the picked shapes use it. */
  recolourSelected(from: Paint, to: Paint | null, final: boolean): void;
  /** The first picked polygon or star whose numbers can still be changed (null: none): its sides, points and star ratio (0-1). */
  /** How the first picked object on a sheet follows it (null: none is on one), and changing it; fitting a picked sheet to what is on it (ADR 0108). */
  selectedPin(): { h: string; v: string } | null;
  /** The line height and letter spacing (em) of the first picked text, and changing them for every picked text. */
  selectedTextStyle(): { lineHeight: number; tracking: number } | null;
  setTextStyle(patch: { lineHeight?: number; tracking?: number }): void;
  setPin(patch: { h?: string; v?: string }): void;
  canFitSheet(): boolean;
  sheetSelection(): void;
  canDetach(): boolean;
  detachSelection(): void;
  fitSheet(): void;
  selectedShape(): { shape: "polygon" | "star"; sides: number; tips: number; inner: number } | null;
  /** Change the sides, points or ratio of the picked polygons and stars: one undo step. */
  shapeSelected(change: { sides?: number; tips?: number; inner?: number }, final?: boolean): void;
  /** The corner radius (px at this zoom) of the first picked path that has corners to round; `perCorner`: a rectangle, which takes one per corner. */
  selectedCorners(): { radiusPx: number[]; nodes: number; mixed: boolean } | null;
  /** Round the corners of the picked paths: one value, or one for every corner (four for a rectangle: top left, top right, bottom right, bottom left). */
  cornersSelected(px: number[], final?: boolean): void;
  /** Store a new corner style, end style or position on the selected paths' outlines (one undo step). */
  outlineSelected(patch: { join?: JoinChoice; cap?: CapChoice; align?: AlignChoice; dash?: DashChoice }): void;
}

const TOOLS: Array<{ tool: Tool; icon: string; label: string; key: string }> = [
  { tool: "hand", icon: ICONS.hand, label: "Hand (pan)", key: "H" },
  { tool: "select", icon: ICONS.pointer, label: "Select", key: "V" },
  { tool: "node", icon: ICONS.nodeTool, label: "Edit nodes", key: "N" },
  { tool: "pen", icon: ICONS.pencil, label: "Pen", key: "P" },
  { tool: "shape", icon: ICONS.shapeTool, label: "Shape and path", key: "U" },
  { tool: "sheet", icon: ICONS.sheetTool, label: "Sheet", key: "C" },
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
      <div class="tb-group tb-options" data-for="pen text" data-label="Colour">
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
        <label class="tb-count" data-scrub="radius" data-sel-radius-wrap hidden title="Drag the name left or right to change it">Radius <input type="text" data-sel-radius size="8" inputmode="decimal" aria-label="Corner radius (px)" title="Corner radius, in px at this zoom. Several values (one for every corner) set them each; double-click the dot on the shape to open its corners out."></label>
        <label class="tb-count" data-scrub="sides" data-sel-sides-wrap hidden title="Drag the name left or right to change it">Sides <input type="number" data-sel-sides min="3" max="24" step="1" inputmode="numeric" aria-label="Polygon sides"></label>
        <label class="tb-count" data-scrub="tips" data-sel-tips-wrap hidden title="Drag the name left or right to change it">Points <input type="number" data-sel-tips min="3" max="24" step="1" inputmode="numeric" aria-label="Star points"></label>
        <label class="tb-count" data-text-wrap hidden title="Line height: a multiple of the text size. Drag the name to change it.">Line <input type="number" data-text-line min="0.5" max="5" step="0.05" aria-label="Line height"></label>
        <label class="tb-count" data-text-wrap hidden title="Letter spacing: a share of the text size. Drag the name to change it.">Letters <input type="number" data-text-track min="-50" max="200" step="1" aria-label="Letter spacing (percent of the text size)"></label>
        <label class="tb-count" data-pin-wrap hidden title="How it follows its sheet when the sheet is resized">Pin
          <select data-pin-h aria-label="Pin horizontally: how it follows the sheet's width"><option value="left">Left</option><option value="right">Right</option><option value="both">Left and right</option><option value="center">Centre</option><option value="scale">Scale</option></select>
          <select data-pin-v aria-label="Pin vertically: how it follows the sheet's height"><option value="top">Top</option><option value="bottom">Bottom</option><option value="both">Top and bottom</option><option value="center">Middle</option><option value="scale">Scale</option></select></label>
        <button type="button" data-attach hidden aria-label="Attach the picked objects to another object" title="Attach: the picked objects follow the object you click next when it moves">${ICONS.link}</button>
        <button type="button" data-detach hidden aria-label="Detach the picked objects" title="Detach: the picked objects stop following another object">${ICONS.unlink}</button>
        <button type="button" data-put-on-sheet hidden aria-label="Put the picked objects on a sheet" title="Put the picked objects on a sheet (Ctrl+Alt+G)">${ICONS.sheetSelection}</button>
        <button type="button" data-fit-sheet hidden aria-label="Fit the sheet to what is on it" title="Fit the sheet to what is on it">${ICONS.shrink}</button>
        <label class="tb-count" data-scrub="inner" data-sel-inner-wrap hidden title="Drag the name left or right to change it">Ratio <input type="number" data-sel-inner min="5" max="95" step="1" inputmode="numeric" aria-label="Star ratio (percent)" title="Inner radius as a percent of the outer one"></label>
      </div>
      <div class="tb-group tb-options" data-for="select node">
        <button type="button" class="initial-btn" data-initial hidden aria-haspopup="menu" aria-expanded="false" aria-label="Initial shape" title="Initial shape: save the shape as it is now, and come back to it later">${ICONS.pin}</button>
      </div>
      <div class="tb-group tb-options" data-for="select node" data-sel-colours hidden></div>
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
      <div class="tb-group tb-options" data-for="pen select" data-label="Size">
        ${PEN_WIDTHS.map(
          (w) => `<button type="button" class="width" data-pen-only data-width="${w}" aria-label="Pen width ${w} px" title="Pen width ${w} px"><span style="height:${Math.max(2, w)}px"></span></button>`,
        ).join("")}
        <input type="range" class="size" data-size min="0" max="100" step="1" aria-label="Pen size" title="Pen size (screen px at this zoom); on Select it sets the thickness of the selected strokes">
        <span class="size-out" data-size-out></span>
      </div>
      <div class="tb-group tb-options" data-for="pen" data-label="Smooth">
        <button type="button" class="stab" data-stab aria-pressed="false" aria-label="Stabilizer" title="Stabilizer: smooths hand wobble; the brush follows the pointer on a rope">${ICONS.waves}</button>
        <input type="range" class="size" data-strength min="1" max="100" step="1" aria-label="Stabilizer strength" title="Stabilizer strength (rope length)" hidden>
      </div>
      <div class="tb-group tb-options" data-for="pen select" data-label="Keep size">
        <button type="button" class="follow" data-pen-only data-follow aria-pressed="false" aria-label="Pen size follows zoom" title="Pen size follows zoom: while drawing, the pen keeps its size on screen when you zoom (the line gets thinner or thicker along its length)">${ICONS.scaling}</button>
        <button type="button" class="lock" data-lock-radius aria-pressed="false" hidden aria-label="Lock corner radius" title="Lock corner radius: resizing a shape keeps its corner radius (off: the radius scales with the shape, so it keeps its look)">${ICONS.squareRoundCorner}</button>
        <button type="button" class="lock" data-lock aria-pressed="false" aria-label="Lock thickness" title="Lock thickness: new strokes keep this width on the canvas at any zoom; resizing a stroke keeps its line width">${ICONS.lock}</button>
      </div>
      <div class="tb-group tb-options" data-for="select">
        <button type="button" class="snap" data-snap aria-pressed="true" aria-label="Snap to other objects" title="Snap to other objects: while moving, edges and centres line up with other objects (exactly, at any zoom), with a guide line">${ICONS.magnet}</button>
        ${moreButton("Selection tool options", "data-select-more")}
      </div>
      <div class="tb-group tb-options" data-for="select text">
        <button type="button" data-action="copy-md" aria-label="Copy Markdown" title="Copy Markdown of the selected text" hidden>${ICONS.clipboardCopy}</button>
      </div>
      <div class="tb-group tb-options" data-for="eraser" data-label="Size">
        <input type="range" class="size" data-eraser-size min="4" max="128" step="1" aria-label="Eraser size" title="Eraser diameter (screen px)">
        <span class="size-out" data-eraser-out></span>
        <button type="button" class="snap" data-erase-parts aria-pressed="false" aria-label="Erase parts of strokes" title="On: the eraser cuts out only what it sweeps over of a freehand stroke. Off: it takes whole objects.">${ICONS.scissors}</button>
        <button type="button" class="snap" data-erase-groups aria-pressed="true" aria-label="Erase whole groups" title="On: a swipe takes a group as one object. Off: it takes only the members it touches.">${ICONS.shapes}</button>
      </div>
      <div class="tb-group tb-options" data-for="lasso" role="radiogroup" aria-label="Lasso selects" data-label="Select">
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

  scrubNumbers(root);
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
  root.querySelector<HTMLInputElement>("[data-sel-radius]")!.addEventListener("change", (e) => {
    const parts = (e.target as HTMLInputElement).value.trim().split(/[\s,]+/).map(Number);
    if (parts.every((v) => Number.isFinite(v) && v >= 0) && (parts.length === 1 || parts.length === actions.selectedCorners()?.nodes)) actions.cornersSelected(parts);
  });
  root.querySelector<HTMLInputElement>("[data-text-line]")!.addEventListener("change", (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(v)) actions.setTextStyle({ lineHeight: v });
  });
  root.querySelector<HTMLInputElement>("[data-text-track]")!.addEventListener("change", (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(v)) actions.setTextStyle({ tracking: v / 100 });
  });
  root.querySelector<HTMLSelectElement>("[data-pin-h]")!.addEventListener("change", (e) => actions.setPin({ h: (e.target as HTMLSelectElement).value }));
  root.querySelector<HTMLSelectElement>("[data-pin-v]")!.addEventListener("change", (e) => actions.setPin({ v: (e.target as HTMLSelectElement).value }));
  root.querySelector<HTMLElement>("[data-fit-sheet]")!.addEventListener("click", () => actions.fitSheet());
  root.querySelector<HTMLElement>("[data-put-on-sheet]")!.addEventListener("click", () => actions.sheetSelection());
  root.querySelector<HTMLElement>("[data-attach]")!.addEventListener("click", () => {
    editor.attachMode = !editor.attachMode;
    editor.changed();
  });
  root.querySelector<HTMLElement>("[data-detach]")!.addEventListener("click", () => actions.detachSelection());
  shapeInput("[data-sel-sides]", (v) => (v >= 3 && v <= 24 ? { sides: Math.round(v) } : null));
  shapeInput("[data-sel-tips]", (v) => (v >= 3 && v <= 24 ? { tips: Math.round(v) } : null));
  shapeInput("[data-sel-inner]", (v) => (v >= 5 && v <= 95 ? { inner: v / 100 } : null));

  // Drag a number's name to change it, live (one undo step when released): the quick way to a radius, a count, a ratio.
  const scrubs: Record<string, { to(start: number, dx: number): number; apply(v: number, final: boolean): void }> = {
    radius: { to: (v, dx) => Math.max(0, v + dx), apply: (v, f) => actions.cornersSelected([v], f) },
    sides: { to: (v, dx) => Math.max(3, Math.min(24, Math.round(v + dx / 12))), apply: (v, f) => actions.shapeSelected({ sides: v }, f) },
    tips: { to: (v, dx) => Math.max(3, Math.min(24, Math.round(v + dx / 12))), apply: (v, f) => actions.shapeSelected({ tips: v }, f) },
    inner: { to: (v, dx) => Math.max(5, Math.min(95, Math.round(v + dx / 2))), apply: (v, f) => actions.shapeSelected({ inner: v / 100 }, f) },
  };
  let scrub: { label: HTMLElement; input: HTMLInputElement; key: string; start: number; x: number; moved: boolean; last: number } | null = null;
  root.addEventListener("pointerdown", (e) => {
    const label = (e.target as HTMLElement).closest<HTMLElement>("[data-scrub]");
    if (!label || (e.target as HTMLElement).tagName === "INPUT" || e.button !== 0) return;
    const input = label.querySelector<HTMLInputElement>("input")!;
    scrub = { label, input, key: label.dataset["scrub"]!, start: parseFloat(input.value) || 0, x: e.clientX, moved: false, last: NaN };
    label.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  root.addEventListener("pointermove", (e) => {
    if (!scrub) return;
    const dx = e.clientX - scrub.x;
    if (!scrub.moved && Math.abs(dx) < 3) return;
    scrub.moved = true;
    const v = scrubs[scrub.key]!.to(scrub.start, dx);
    if (v === scrub.last) return;
    scrub.last = v;
    scrub.input.value = String(Math.round(v * 100) / 100);
    scrubs[scrub.key]!.apply(v, false);
  });
  const endScrub = (e: PointerEvent, cancelled: boolean): void => {
    const sc = scrub;
    scrub = null;
    if (!sc) return;
    if (sc.label.hasPointerCapture(e.pointerId)) sc.label.releasePointerCapture(e.pointerId);
    if (!sc.moved) return sc.input.focus(); // a plain click on the name goes to the field
    if (cancelled || Number.isNaN(sc.last)) {
      editor.preview = { kind: "none" };
      editor.changed();
    } else scrubs[sc.key]!.apply(sc.last, true);
  };
  // (the click that ends a drag on a name would focus its field: not after a drag)
  let dragged = false;
  root.addEventListener("click", (e) => {
    if (dragged && (e.target as HTMLElement).closest("[data-scrub]") && (e.target as HTMLElement).tagName !== "INPUT") e.preventDefault();
    dragged = false;
  }, true);
  root.addEventListener("pointerup", (e) => {
    dragged = scrub?.moved ?? false;
    endScrub(e, false);
  });
  root.addEventListener("pointercancel", (e) => endScrub(e, true));

  let colourEditing = false;
  const SEL_CHIPS = 6;
  const chipPaint = (p: Paint): string => (typeof p === "string" ? `linear-gradient(${swatchBackground(p)}, ${swatchBackground(p)})` : paintCss(p));
  const paintName = (p: Paint): string => (typeof p === "string" ? p.toUpperCase() : "Gradient");
  const usage = (it: { fills: number; strokes: number }): string =>
    [it.fills ? `${it.fills} ${it.fills === 1 ? "fill" : "fills"}` : "", it.strokes ? `${it.strokes} ${it.strokes === 1 ? "outline" : "outlines"}` : ""].filter(Boolean).join(" and ");
  // Change a colour everywhere the picked shapes use it: the paint chooser, shown on the colour's chip.
  const editColour = (anchor: HTMLElement, index: number): void => {
    const item = actions.selectionPaints().items[index];
    if (!item) return;
    let current: Paint = item.paint;
    colourEditing = true;
    openPaintPopover(anchor, {
      name: "Selection colour",
      paint: item.paint,
      noneLabel: "No colour",
      onInput: (p) => actions.recolourSelected(current, p, false),
      onChange: (p) => {
        actions.recolourSelected(current, p, true);
        if (p !== null) current = p;
      },
      onClose: () => {
        colourEditing = false;
        editor.preview = { kind: "none" };
        editor.changed();
      },
    });
  };
  // Pointing at a colour lights up the shapes that use it.
  const light = (e: Event): void => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-sel-colour]");
    editor.highlight = b ? new Set(actions.selectionPaints().items[Number(b.dataset["selColour"])]?.ids ?? []) : null;
    editor.changed();
  };
  root.addEventListener("pointerover", (e) => { if ((e.target as HTMLElement).closest("[data-sel-colour]")) light(e); });
  root.addEventListener("pointerout", (e) => { if ((e.target as HTMLElement).closest("[data-sel-colour]") && editor.highlight) { editor.highlight = null; editor.changed(); } });
  root.addEventListener("focusin", (e) => { if ((e.target as HTMLElement).closest("[data-sel-colour]")) light(e); });
  root.addEventListener("focusout", () => { if (editor.highlight) { editor.highlight = null; editor.changed(); } });
  const openOutline = (anchor: HTMLElement): void => {
    const sel = editsSelection() ? actions.selectedOutline() : null;
    if (editsSelection() && !sel) return;
    openOutlinePopover(anchor, {
      widthPx: sel ? sel.widthPx : editor.shapeWidthPx,
      join: sel ? sel.join : (editor.shapeJoin ?? "miter"),
      cap: sel ? sel.cap : editor.shapeCap,
      align: sel ? sel.align : editor.shapeAlign,
      dash: sel ? sel.dash : editor.shapeDash,
      closed: sel ? sel.closed : editor.tool === "shape" && editor.shapeKind !== "line",
      onWidth: (px) => {
        if (sel) actions.setSelectedWidth(px);
        else {
          // 0 is no outline for the next shape (the width is kept for when it is turned on); a width turns one on
          if (px === 0) editor.shapeStroke = null;
          else {
            editor.shapeWidthPx = px;
            if (editor.shapeStroke === null && editor.shapeKind !== "line") editor.shapeStroke = "#1f2329";
          }
          editor.changed();
        }
      },
      onStyle: (patch) => {
        if (sel) actions.outlineSelected(patch);
        else {
          if (patch.join) editor.shapeJoin = patch.join;
          if (patch.cap) editor.shapeCap = patch.cap;
          if (patch.align) editor.shapeAlign = patch.align;
          if (patch.dash) {
            editor.shapeDash = patch.dash;
            if (patch.dash === "dotted") editor.shapeCap = "round"; // (a dot needs round ends)
          }
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
    } else if (d["selColour"] !== undefined) {
      editColour(b, Number(d["selColour"]));
    } else if (d["selColourMore"] !== undefined) {
      // The colours that did not fit as chips, in a list: the colour and what uses it.
      const rest = actions.selectionPaints().items.slice(SEL_CHIPS);
      openMoreMenu(b, rest.map((it, k) => ({ label: `${paintName(it.paint)} · ${usage(it)}`, icon: `<span class="menu-swatch" style="--paint:${chipPaint(it.paint)}"></span>`, run: () => editColour(b, SEL_CHIPS + k) })), "Colours of the selection");
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
    } else if (d["eraseParts"] !== undefined) {
      editor.eraseParts = !editor.eraseParts;
      editor.changed();
    } else if (d["eraseGroups"] !== undefined) {
      editor.eraseWholeGroups = !editor.eraseWholeGroups;
      editor.changed();
    } else if (d["initial"] !== undefined) {
      const st = actions.initialShapeState();
      if (!st) return;
      const some = st.saved > 0;
      openMoreMenu(b, [
        ...(st.saved < st.count ? [{ label: some ? "Set initial shape (where there is none)" : "Set initial shape", aria: "Set initial shape: save the shape as it is now", run: () => actions.setInitialShape(true) }] : []),
        { label: "Update initial shape", aria: "Update initial shape: replace the saved shape with the shape as it is now", disabled: !some, run: () => actions.setInitialShape(false) },
        { label: "Reset to initial shape", aria: "Reset to initial shape: put the shape back as it was saved", disabled: !some, run: () => actions.resetToInitialShape() },
      ], "Initial shape");
    } else if (d["selectMore"] !== undefined) {
      // What is seldom wanted on Select, kept out of the bar: bringing things back, and two ways the selection behaves.
      openMoreMenu(b, [
        { label: "Show all hidden", icon: ICONS.eye, run: () => actions.clearFlag("hidden") },
        { label: "Unlock all", icon: ICONS.lockKeyholeOpen, run: () => actions.clearFlag("locked") },
        { label: "Axis-aligned selection box", aria: "Axis-aligned selection box: by default the box turns with the selected objects when they share a rotation", icon: ICONS.boxSelect, checked: editor.alignBox, run: () => { editor.alignBox = !editor.alignBox; editor.changed(); } },
        { label: "Ignore the object that fills the view", icon: ICONS.pointerBan, checked: editor.ignoreFilling, run: () => { editor.ignoreFilling = !editor.ignoreFilling; editor.changed(); } },
      ], "Selection tool options");
    } else if (d["snap"] !== undefined) {
      editor.snap = !editor.snap;
      editor.changed();
    } else if (d["follow"] !== undefined) {
      editor.followZoom = !editor.followZoom;
      editor.changed();
    } else if (d["lockRadius"] !== undefined) {
      editor.lockRadius = !editor.lockRadius;
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
    const pick = editor.tool === "select" || editor.tool === "node";
    const still = editor.preview.kind === "none"; // (not while something is being dragged: the numbers wait for it to end)
    const shp = pick && still ? actions.selectedShape() : null;
    const crn = pick && still ? actions.selectedCorners() : null;
    const round2 = (v: number): string => String(Math.round(v * 100) / 100);
    const fields: Array<[string, boolean, string]> = [
      ["radius", !!crn, crn && !crn.mixed ? round2(crn.radiusPx[0] ?? 0) : ""],
      ["sides", shp?.shape === "polygon", String(shp?.sides ?? 0)],
      ["tips", shp?.shape === "star", String(shp?.tips ?? 0)],
      ["inner", shp?.shape === "star", String(shp ? Math.round(shp.inner * 100) : 0)],
    ];
    const txt = pick && still ? actions.selectedTextStyle() : null;
    for (const w of root.querySelectorAll<HTMLElement>("[data-text-wrap]")) w.hidden = !txt;
    if (txt) {
      const line = root.querySelector<HTMLInputElement>("[data-text-line]")!, track = root.querySelector<HTMLInputElement>("[data-text-track]")!;
      if (document.activeElement !== line) line.value = String(Math.round(txt.lineHeight * 100) / 100);
      if (document.activeElement !== track) track.value = String(Math.round(txt.tracking * 100));
    }
    const pin = pick && still ? actions.selectedPin() : null;
    root.querySelector<HTMLElement>("[data-pin-wrap]")!.hidden = !pin;
    if (pin) {
      const h = root.querySelector<HTMLSelectElement>("[data-pin-h]")!, v = root.querySelector<HTMLSelectElement>("[data-pin-v]")!;
      if (document.activeElement !== h) h.value = pin.h;
      if (document.activeElement !== v) v.value = pin.v;
    }
    root.querySelector<HTMLElement>("[data-attach]")!.hidden = !(pick && still && editor.selection.size > 0);
    root.querySelector<HTMLElement>("[data-attach]")!.setAttribute("aria-pressed", String(editor.attachMode));
    root.querySelector<HTMLElement>("[data-detach]")!.hidden = !(pick && still && actions.canDetach());
    root.querySelector<HTMLElement>("[data-put-on-sheet]")!.hidden = !(pick && still && editor.selection.size > 0);
    root.querySelector<HTMLElement>("[data-fit-sheet]")!.hidden = !(pick && still && actions.canFitSheet());
    for (const [key, shown, value] of fields) {
      if (!still && pick) continue;
      root.querySelector<HTMLElement>(`[data-sel-${key}-wrap]`)!.hidden = !shown;
      const input = root.querySelector<HTMLInputElement>(`[data-sel-${key}]`)!;
      if (shown && document.activeElement !== input) input.value = value;
      if (key === "radius") input.placeholder = crn?.mixed ? "Mixed" : "";
    }
    // The colours the picked shapes use, as chips (several shapes picked): one change reaches every shape that uses that colour or gradient.
    const colours = root.querySelector<HTMLElement>("[data-sel-colours]")!;
    if (pick && still && !colourEditing) {
      const used = actions.selectionPaints();
      const all = used.count >= 2 ? used.items : [];
      const items = all.slice(0, SEL_CHIPS);
      const key = JSON.stringify(all.map((it) => [it.paint, it.fills, it.strokes]));
      if (colours.dataset["list"] !== key) {
        colours.dataset["list"] = key;
        colours.innerHTML =
          items
            .map((it, i) => {
              return `<button type="button" class="swatch swatch-paint" data-sel-colour="${i}"${it.fills ? "" : " data-ring"} aria-haspopup="dialog" aria-expanded="false" aria-label="${paintName(it.paint)}, used by ${usage(it)}" title="${paintName(it.paint)}: used by ${usage(it)}; change it everywhere in the selection"><span data-paint-chip style="--paint:${chipPaint(it.paint)}"></span></button>`;
            })
            .join("") +
          (all.length > SEL_CHIPS ? `<button type="button" class="swatch swatch-more" data-sel-colour-more aria-haspopup="menu" aria-expanded="false" aria-label="${all.length - SEL_CHIPS} more colours" title="${all.length - SEL_CHIPS} more colours of the selection">+${all.length - SEL_CHIPS}</button>` : "");
      }
    }
    const sw = root.querySelector<HTMLInputElement>("[data-shape-width]")!;
    if (document.activeElement !== sw) sw.value = String(sliderFromPen(editor.shapeWidthPx));
    root.querySelector<HTMLElement>("[data-shape-out]")!.textContent = `${editor.shapeWidthPx} px`;
    // The paint chips show the next shape's colours, or the selected paths' (and are there only when something has them).
    const sel = editor.tool === "select" || editor.tool === "node" ? actions.selectedPaint() : null;
    const several = (editor.tool === "select" || editor.tool === "node") && editor.preview.kind === "none" ? actions.selectionPaints().count >= 2 : false;
    const initialBtn = root.querySelector<HTMLElement>("[data-initial]")!;
    if (editor.preview.kind === "none") {
      const st = (editor.tool === "select" || editor.tool === "node") ? actions.initialShapeState() : null;
      initialBtn.hidden = !st;
      initialBtn.setAttribute("aria-pressed", String(!!st && st.saved > 0)); // (lit when a shape is saved)
    }
    root.querySelector<HTMLElement>("[data-outline-options]")!.hidden = (editor.tool === "select" || editor.tool === "node") && !sel;
    for (const b of root.querySelectorAll<HTMLButtonElement>("[data-paint]")) {
      const which = b.dataset["paint"] as "fill" | "stroke";
      const value = sel ? sel[which] : which === "fill" ? editor.shapeFill : editor.shapeStroke;
      b.hidden = (editor.tool === "select" || editor.tool === "node") && (!sel || several);
      b.classList.toggle("is-none", value === null);
      (b.querySelector("[data-paint-chip]") as HTMLElement).style.setProperty("--paint", value === null ? "linear-gradient(transparent, transparent)" : typeof value === "string" ? `linear-gradient(${swatchBackground(value)}, ${swatchBackground(value)})` : paintCss(value));
    }
    for (const b of root.querySelectorAll<HTMLElement>("[data-width]")) b.classList.toggle("is-on", Number(b.dataset["width"]) === editor.penWidthPx);
    for (const b of root.querySelectorAll<HTMLElement>("[data-pen-only]")) b.hidden = editor.tool !== "pen"; // (the pen's own presets and zoom behaviour: not for strokes already drawn)
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
    root.querySelector<HTMLElement>("[data-erase-parts]")!.setAttribute("aria-pressed", String(editor.eraseParts));
    root.querySelector<HTMLElement>("[data-bookmarks]")!.setAttribute("aria-pressed", String(editor.bookmarksOpen));
    root.querySelector<HTMLElement>("[data-layers]")!.setAttribute("aria-pressed", String(editor.layersOpen));
    root.querySelector<HTMLElement>("[data-tags]")!.setAttribute("aria-pressed", String(editor.tagsOpen));
    root.querySelector<HTMLElement>("[data-snap]")!.setAttribute("aria-pressed", String(editor.snap));
    root.querySelector<HTMLElement>("[data-follow]")!.setAttribute("aria-pressed", String(editor.followZoom));
    root.querySelector<HTMLElement>("[data-lock]")!.setAttribute("aria-pressed", String(editor.lock !== null));
    const lockR = root.querySelector<HTMLElement>("[data-lock-radius]")!;
    lockR.setAttribute("aria-pressed", String(editor.lockRadius));
    if (editor.preview.kind === "none") lockR.hidden = !(editor.tool === "select" && actions.selectedCorners() !== null); // (there when a picked shape has corners)
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
    root.querySelector<HTMLElement>(".toolbar")!.hidden = ![...root.querySelectorAll<HTMLElement>(".tb-options")].some((g) => !g.hidden);
  };
  editor.subscribe(update);
  doc.subscribe(update);
  update();
}
