import { scrubNumbers } from "../colour-picker/scrub";
import { SAMPLE_SIZES } from "../interaction/eyedropper";
import { RATIO_PRESETS, formatRatio, parseRatio } from "../app/export-size";
import { esc } from "./format";
import { openMoreMenu } from "./more-menu";
import type { MenuItem } from "./more-menu";
import { createBar, isOff, syncGroups, syncScroll } from "./bar";
import { liveNumber } from "./live";
import { isContainer } from "../doc/containers";
import type { CanvasObject } from "../doc/model";
import type { TextLook, lookOf } from "../text/text-style";
import type { AlignChoice, CapChoice, DashChoice, JoinChoice } from "../doc/stroke-look";
import type { EditorState, Tool } from "../app/editor-state";
import { PEN_WIDTHS } from "../app/editor-state";
import type { PaintPatch } from "../app/actions";
import { SHAPE_KINDS } from "../doc/path";
import type { Paint } from "../doc/paint";
import { isGradient, paintCss } from "../doc/paint";
import { isTexture } from "../doc/texture";
import type { Arrow, ShapeKind } from "../doc/path";
import type { GradientStop } from "../doc/paint";
import { openColourPopover, openFontOptionsPopover, openOutlinePopover, openPaintPopover, openTextBoxPopover } from "./colour-popover";
import { BUNDLED_FONT_NAME, fontFor } from "../text/fonts";
import type { Adjust } from "../doc/adjust";
import { setAdjustPreviewing } from "../render/adjust-image";
import type { DocumentStore } from "../doc/document-store";
import type { LayoutCommand } from "../app/actions";
import type { AlignKey, SortKey } from "../doc/arrange";
import type { PenKind } from "../interaction/pens";
import { ICONS } from "./icons";
import { newInk, swatchBackground } from "../render/ink";
import { penFromSlider, sliderFromPen } from "../interaction/pen-width";

export interface ToolbarActions {
  importFiles(files: File[]): void;
  /** Save a screenshot of the canvas to the library (ADR 0080). */
  screenshot(): void;
  /** Open the canvas search (ADR 0060). */
  openSearch(prefix?: string): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Current zoom level, for the thickness lock. */
  depth(): { levels: bigint; frac: number };
  clearFlag(flag: "hidden" | "locked"): void;
  /** Set the thickness (screen px at this zoom) of the selected strokes and paths: one undo step. */
  setSelectedWidth(px: number, final?: boolean): void;
  /** The fill and outline of the first selected path, or null when no path is selected. */
  selectedPaint(): { fill: Paint | null; stroke: Paint | null } | null;
  /** Show (final false: while the picker is dragged) or store (final true) a new fill or outline on the selected paths. */
  paintSelected(patch: PaintPatch, final: boolean): void;
  /** The corners, ends and place of the first selected path's outline and its width in px at this zoom; null when no path is selected. */
  selectedOutline(): { join: JoinChoice; cap: CapChoice; align: AlignChoice; dash: DashChoice; closed: boolean; widthPx: number | null } | null;
  /** The paints the picked shapes use (each once, gradients included) and how many shapes are picked. */
  selectionPaints(): { count: number; items: Array<{ paint: Paint; fills: number; strokes: number; ids: string[] }> };
  /** Change one paint to another everywhere the picked shapes use it. */
  recolourSelected(from: Paint, to: Paint | null, final: boolean): void;
  /** The first picked polygon or star whose numbers can still be changed (null: none): its sides, points and star ratio (0-1). */
  /** How the first picked object on a sheet follows it (null: none is on one), and changing it (ADR 0108). */
  selectedPin(): { h: string; v: string } | null;
  /** The look of the text being edited, else of the Text tool (when it is the tool), else of the first picked text (null: none), and changing it (ADR 0126). */
  selectedTextStyle(): ReturnType<typeof lookOf> | null;
  setTextStyle(look: TextLook, final?: boolean): void;
  /** The fonts in the library a text can be set in (ADR 0127), and importing a font file into it (null: it was refused, and the person was told why). */
  fonts(): Promise<Array<{ hash: string; name: string; unusable: string }>>;
  importFont(file: File): Promise<string | null>;
  setPin(patch: { h?: string; v?: string }): void;
  /** The shape (width ÷ height) of the one picked sheet, and giving it another, keeping its area (ADR 0147). */
  sheetRatio(): number | null;
  setSheetRatio(ratio: number, final?: boolean): void;
  /** Where the one picked object on a sheet is and how big, in per cent of the sheet (null: none is), and moving or resizing it. */
  boxOnSheet(): { x: number; y: number; w: number; h: number; resizable: boolean } | null;
  moveOnSheet(x: number, y: number, final?: boolean): void;
  /** Whether the picked sheet scales what is on it when it is resized, and the switch for it (a property of the sheet). */
  sheetScale(): boolean;
  setSheetScale(on: boolean): void;
  resizeOnSheet(w: number, h: number, final?: boolean): void;
  /** Pictures (ADR 0118): crop the picked still, show it whole, and the adjustments of the picked pictures. */
  croppable(): boolean;
  cropped(): boolean;
  uncrop(): void;
  selectedAdjust(): { adjust: Adjust; stills: boolean; count: number } | null;
  /** The saved adjustments, and saving the numbers as one (ADR 0120). */
  adjustStyles(): { save(name: string, a: Adjust): Promise<void>; gradients(): Array<{ name: string; stops: readonly GradientStop[] }> };
  previewAdjust(a: Adjust): void;
  commitAdjust(a: Adjust, label: string): void;
  copyAdjust(): void;
  pasteAdjust(): void;
  canPasteAdjust(): boolean;
  copyRendered(): void;
  bake(): void;
  selectedShape(): { shape: "polygon" | "star"; sides: number; tips: number; inner: number } | null;
  /** Change the sides, points or ratio of the picked polygons and stars: one undo step. */
  shapeSelected(change: { sides?: number; tips?: number; inner?: number }, final?: boolean): void;
  /** The corner radius (px at this zoom) of the first picked path that has corners to round; `perCorner`: a rectangle, which takes one per corner. */
  /** The corner smoothing (0 to 100) of the first picked rounded shape; null when none. */
  selectedSmoothing(): number | null;
  setSmoothing(pct: number, final?: boolean): void;
  selectedCorners(): { radiusPx: number[]; nodes: number; mixed: boolean } | null;
  /** Round the corners of the picked paths: one value, or one for every corner (four for a rectangle: top left, top right, bottom right, bottom left). */
  cornersSelected(px: number[], final?: boolean): void;
  /** Store a new corner style, end style or position on the selected paths' outlines (one undo step). */
  /** Dash length, gap and start (in widths) of the first picked dashed path; null: none. */
  selectedDashNumbers(): { len: number; gap: number; offset: number } | null;
  /** The arrow heads (start, end) of the first picked open path; null: none picked. */
  selectedArrows(): { start: Arrow | "none"; end: Arrow | "none" } | null;
  setArrows(patch: { start?: Arrow | "none"; end?: Arrow | "none" }): void;
  /** The angle below which a sharp corner is cut (degrees), of the first picked path; null when none is picked. */
  selectedMiterAngle(): number | null;
  setMiterAngle(deg: number | null): void;
  /** Paint the brush mask in white (shows) or black (hides), or finish it. */
  paintMask(ink: "show" | "hide" | "done"): void;
  setDashNumbers(n: { len?: number; gap?: number; offset?: number }): void;
  outlineSelected(patch: { join?: JoinChoice; cap?: CapChoice; align?: AlignChoice; dash?: DashChoice }): void;
}

/**
 * The rail's tools (ADR 0168), one list for the canvas and the Painting view: `only` keeps a tool to one view (the Painting view's tools
 * that work on pixels, the canvas's that make what only a canvas has); a tool in both views acts on what it is used on there (the Eraser:
 * objects on the canvas and on a vector layer, paint on a paint layer).
 */
export const RAIL_TOOLS: ReadonlyArray<{ tool: Tool; icon: string; label: string; key: string; only?: "canvas" | "paint" }> = [
  { tool: "hand", icon: ICONS.hand, label: "Hand (pan)", key: "H" },
  { tool: "select", icon: ICONS.pointer, label: "Select", key: "V" },
  { tool: "node", icon: ICONS.nodeTool, label: "Edit nodes", key: "N" },
  { tool: "brush", icon: ICONS.paintbrush, label: "Brush", key: "B", only: "paint" },
  { tool: "pen", icon: ICONS.pencil, label: "Pen", key: "P" },
  { tool: "shape", icon: ICONS.shapeTool, label: "Shape and path", key: "U" },
  { tool: "sheet", icon: ICONS.sheetTool, label: "Sheet", key: "C", only: "canvas" },
  { tool: "lasso", icon: ICONS.lasso, label: "Lasso", key: "L" },
  { tool: "text", icon: ICONS.type, label: "Text", key: "T" },
  { tool: "note", icon: ICONS.stickyNote, label: "Note", key: "M", only: "canvas" },
  { tool: "fill", icon: ICONS.fillTool, label: "Fill bucket", key: "G", only: "paint" },
  { tool: "eyedropper", icon: ICONS.pipette, label: "Eyedropper", key: "I" },
  { tool: "eraser", icon: ICONS.eraser, label: "Object eraser", key: "E" },
];
const TOOLS = RAIL_TOOLS;

/**
 * Tools that share one place on the rail with a tool of both views (ADR 0168): the Painting view's own, chosen in a flyout beside the
 * button while one of them is the tool (the button stays lit and wears the icon of the one in use). The first is the button's.
 */
const FAMILIES = {
  brush: [{ tool: "brush", icon: ICONS.paintbrush, label: "Brush", title: "Brush (B)" }, { tool: "pencil", icon: ICONS.pencilPixel, label: "Pencil", title: "Pencil: hard pixel edges, no smoothing; Auto erase in its options (Shift+B)" }],
  select: [{ tool: "select", icon: ICONS.pointer, label: "Select", title: "Select (V)" }, { tool: "marquee", icon: ICONS.marqueeRect, label: "Rectangle marquee", title: "Rectangle marquee: select pixels in a rectangle; Shift adds, Alt takes away (M)" }, { tool: "marqueeEllipse", icon: ICONS.marqueeEllipse, label: "Ellipse marquee", title: "Ellipse marquee: select pixels in an ellipse; Shift adds, Alt takes away (Shift+M)" }],
  fill: [{ tool: "fill", icon: ICONS.fillTool, label: "Fill bucket", title: "Fill bucket: fill the region of about the colour clicked (G)" }, { tool: "gradient", icon: ICONS.gradientTool, label: "Gradient", title: "Gradient: drag from where the paint colour is to where it is clear (Shift+G)" }],
  lasso: [{ tool: "lasso", icon: ICONS.lasso, label: "Lasso", title: "Lasso: on a paint layer, select pixels inside a line drawn round them (L)" }, { tool: "lassoPoly", icon: ICONS.lassoPoly, label: "Polygonal lasso", title: "Polygonal lasso: click the corners; click the first one, double-click or Enter to close (Shift+L)" }, { tool: "wand", icon: ICONS.wand, label: "Magic wand", title: "Magic wand: select the pixels of about the colour clicked (W)" }],
} as const satisfies Record<string, ReadonlyArray<{ tool: Tool; icon: string; label: string; title: string }>>;
type Family = keyof typeof FAMILIES;
const familyOf = (t: Tool): Family | undefined => (Object.keys(FAMILIES) as Family[]).find((f) => FAMILIES[f].some((m) => m.tool === t));

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

export const LAYOUT_MENU: Array<{ head: string; items: Array<{ id: string; label: string; icon: string; hint?: string }> }> = [
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
      { id: "align:left", hint: "Line up the left edges", label: "Left", icon: ICONS.alignHStart },
      { id: "align:centre", hint: "Line up the centres, left to right", label: "Centre", icon: ICONS.alignHCenter },
      { id: "align:right", hint: "Line up the right edges", label: "Right", icon: ICONS.alignHEnd },
      { id: "align:top", hint: "Line up the top edges", label: "Top", icon: ICONS.alignVStart },
      { id: "align:middle", hint: "Line up the centres, top to bottom", label: "Middle", icon: ICONS.alignVCenter },
      { id: "align:bottom", hint: "Line up the bottom edges", label: "Bottom", icon: ICONS.alignVEnd },
    ],
  },
  {
    head: "Distribute (3 or more)",
    items: [
      { id: "distribute:x", hint: "Even gaps from side to side", label: "Horizontally", icon: ICONS.distH },
      { id: "distribute:y", hint: "Even gaps from top to bottom", label: "Vertically", icon: ICONS.distV },
    ],
  },
];

const TEXT_ALIGNS = [
  { id: "left", label: "Align left", icon: ICONS.textAlignLeft },
  { id: "center", label: "Align centre", icon: ICONS.textAlignCenter },
  { id: "right", label: "Align right", icon: ICONS.textAlignRight },
  { id: "justify", label: "Justify", icon: ICONS.textAlignJustify },
] as const;
const TEXT_FITS = [
  { id: "width", label: "Auto width", title: "Auto width: the box is as wide as the words (a click makes one)", icon: ICONS.textAutoWidth },
  { id: "fixed", label: "Fixed width", title: "Fixed width: the words wrap at the box's width (drag a box to make one)", icon: ICONS.textFixedWidth },
] as const;

const KIND_LABEL: Record<string, string> = { all: "All", sheet: "Sheet", shape: "Shape", text: "Text", picture: "Picture", stroke: "Stroke" };
/** The kind of picked item the Properties bar sorts its controls by. */
const kindOf = (o: CanvasObject): string => (isContainer(o) ? "sheet" : o.kind === "path" ? "shape" : o.kind === "image" ? "picture" : o.kind);

/** The features of a font worth offering, with the words that name them (a font only shows the ones it has). */
const FONT_FEATURES: Record<string, string> = { liga: "Ligatures", dlig: "Discretionary ligatures", smcp: "Small capitals", c2sc: "Capitals to small capitals", tnum: "Tabular numbers", pnum: "Proportional numbers", onum: "Old-style numbers", lnum: "Lining numbers", frac: "Fractions", zero: "Slashed zero", case: "Case-sensitive forms", sups: "Superscript", subs: "Subscript", titl: "Titling forms", swsh: "Swashes", salt: "Stylistic alternates", ordn: "Ordinals" };

export function mountToolbar(root: HTMLElement, editor: EditorState, doc: DocumentStore, actions: ToolbarActions): void {
  root.innerHTML = `
    <div class="rail" data-cmd-group="Tools">
      <!-- What a tool with kinds offers while it is the tool: beside its button, not in the Properties bar -->
      <div class="rail-fly" data-fly="shape" hidden role="radiogroup" aria-label="Shape or path">
        ${SHAPE_MENU.map((k) => `<button type="button" role="radio" class="shape-kind" data-shape-kind="${k.id}" aria-label="${k.label}" title="${k.title}">${k.icon}</button>`).join("")}
        <button type="button" role="radio" class="shape-kind" data-tool="path" aria-label="Path (curves)" title="Path (curves): click corners, drag for a curve, click the first node to close (B)">${ICONS.pathTool}</button>
      </div>
      ${(Object.keys(FAMILIES) as Family[]).map((f) => `<div class="rail-fly" data-fly="${f}" data-only="paint" hidden role="radiogroup" aria-label="${FAMILIES[f].map((m) => m.label).join(", ")}">${FAMILIES[f].map((m) => `<button type="button" role="radio" data-tool="${m.tool}" aria-label="${m.label}" title="${m.title}">${m.icon}</button>`).join("")}</div>`).join("")}
      <div class="rail-fly" data-fly="pen" hidden role="radiogroup" aria-label="Pen">
        ${PEN_MENU.map((k) => `<button type="button" role="radio" class="pen-kind" data-pen-kind="${k.id}" aria-label="${k.label}" title="${k.title}">${k.icon}</button>`).join("")}
      </div>
      <div class="rail-tools" role="group" aria-label="History">
        <button type="button" data-action="undo" aria-label="Undo" title="Undo (Ctrl+Z)">${ICONS.undo}</button>
        <button type="button" data-action="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${ICONS.redo}</button>
      </div>
      <span class="rail-sep" role="separator"></span>
      <div class="rail-tools" role="radiogroup" aria-label="Tool" aria-orientation="vertical">
      ${TOOLS.map(
        // (Import sits with the tools that put something on the canvas: after the Note tool)
        (t) => `<button type="button" role="radio" data-tool="${t.tool}"${t.only ? ` data-only="${t.only}"` : ""}${t.tool === "shape" || t.tool === "pen" ? ' aria-haspopup="true" aria-expanded="false"' : ""} aria-label="${t.label}" title="${t.label} (${t.key})">${t.icon}</button>${t.tool === "note" ? `<button type="button" data-action="import" data-only="canvas" aria-label="Import files" title="Import files: pictures, video, audio, or any other file (kept as a card you can download)">${ICONS.arrowDownToLine}</button>` : ""}`,
      ).join("")}
      </div>
      <span class="rail-sep" role="separator" data-only="canvas"></span>
      <div class="rail-tools" role="group" aria-label="Screenshot and search" data-only="canvas">
        <button type="button" data-action="screenshot" aria-label="Screenshot" title="Screenshot: save the selection to the library, or the whole view when nothing is selected (format, folder and tags in Settings > Screenshot)">${ICONS.camera}</button>
        <button type="button" data-action="search" aria-label="Search the canvas" title="Search the canvas (Ctrl+F; # tag, @ bookmark)">${ICONS.search}</button>
      </div>
      <input type="file" multiple hidden data-testid="import-input">
    </div>
    <div class="dock" data-cmd-group="Dock" role="toolbar" aria-label="Panels">
      <div class="tb-group">
        <button type="button" class="layers-toggle" data-only="canvas" data-adjust-panel aria-pressed="false" aria-label="Adjust panel" title="Adjust: show or hide the panel for the exposure, contrast, colour and more of the picked pictures">${ICONS.slidersVertical}</button>
        <button type="button" class="layers-toggle" data-layers aria-pressed="false" aria-label="Layers panel" title="Layers: show or hide the floating Layers panel">${ICONS.layers}</button>
        <button type="button" class="layers-toggle" data-only="canvas" data-tags aria-pressed="false" aria-label="Tags panel" title="Tags: tag items on this canvas, and rename or delete a tag">${ICONS.tag}</button>
        <button type="button" class="layers-toggle" data-only="canvas" data-styles aria-pressed="false" aria-label="Styles panel" title="Styles: saved adjustments (and more soon) to apply to the selected items">${ICONS.swatchBook}</button>
        <button type="button" class="layers-toggle" data-only="canvas" data-pattern-panel aria-pressed="false" aria-label="Pattern panel" title="Pattern: make waves, blobs, tiles and other patterns on a sheet or shape, with settings and a random button">${ICONS.mountainSnow}</button>
        <button type="button" class="layers-toggle" data-only="canvas" data-bookmarks aria-pressed="false" aria-label="Bookmarks panel" title="Bookmarks: saved places and zooms on this canvas">${ICONS.bookmark}</button>
      </div>
    </div>
    <div class="toolbar" data-cmd-group="Properties" role="toolbar" aria-label="Tool options" hidden>
      <div class="tb-options-row">
      <div class="tb-group tb-options tb-subject" data-for="select node" role="radiogroup" aria-label="Edit which kind of item" hidden></div>
      <div class="tb-group tb-options" data-for="" data-mask-paint role="group" aria-label="Paint the mask">
        <button type="button" data-mask-ink="show" aria-label="Paint the mask in white: the Pen shows" title="Paint the mask in white: the Pen shows">${ICONS.sun}</button>
        <button type="button" data-mask-ink="hide" aria-label="Paint the mask in black: the Pen hides" title="Paint the mask in black: the Pen hides">${ICONS.moon}</button>
        <button type="button" data-mask-ink="done" aria-label="Done painting the mask" title="Done painting the mask">${ICONS.check}</button>
      </div>
      <div class="tb-group tb-options" data-for="pen brush pencil eyedropper fill gradient" role="group" aria-label="Colour">
        <button type="button" class="swatch swatch-current" data-colour-open aria-haspopup="dialog" aria-expanded="false" aria-label="Pen colour" title="Pen colour: open the colour picker (new text takes it too, until its own colour is set)"><span data-colour-chip></span></button>
      </div>
      <div class="tb-group tb-options" data-for="brush pencil eraser select marquee marqueeEllipse lasso lassoPoly wand fill gradient" data-paint-options data-only="paint" role="group" aria-label="Brush"></div>
      <div class="tb-group tb-options" data-for="shape">
        <label class="tb-count" data-sides-wrap hidden>Sides <input type="number" data-sides min="3" max="24" step="1" inputmode="numeric" aria-label="Polygon sides"></label>
        <label class="tb-count" data-tips-wrap hidden>Points <input type="number" data-tips min="3" max="24" step="1" inputmode="numeric" aria-label="Star points"></label>
      </div>
      <div class="tb-group tb-options" data-for="select node" data-shape-props>
        <label class="tb-count" data-kind="shape picture" data-scrub="radius" data-sel-radius-wrap hidden title="Drag the field left or right to change it">Radius <input type="text" data-sel-radius size="8" inputmode="decimal" aria-label="Corner radius (px)" title="Corner radius, in px at this zoom. Several values (one for every corner) set them each; double-click the dot on the shape to open its corners out."></label>
        <label class="tb-count" data-kind="shape" data-scrub="smooth" data-sel-smooth-wrap hidden title="Drag the field left or right to change it">Smooth <input type="number" data-sel-smooth min="0" max="100" step="5" inputmode="numeric" aria-label="Corner smoothing (%)" title="Corner smoothing: the rounded corners start farther out and blend into the line"></label>
        <label class="tb-count" data-kind="shape" data-scrub="sides" data-sel-sides-wrap hidden title="Drag the field left or right to change it">Sides <input type="number" data-sel-sides min="3" max="24" step="1" inputmode="numeric" aria-label="Polygon sides"></label>
        <label class="tb-count" data-kind="shape" data-scrub="tips" data-sel-tips-wrap hidden title="Drag the field left or right to change it">Points <input type="number" data-sel-tips min="3" max="24" step="1" inputmode="numeric" aria-label="Star points"></label>
        <label class="tb-count" data-kind="any" data-pin-wrap hidden title="How it follows its sheet when the sheet is resized">Pin
          <select data-pin-h aria-label="Pin horizontally: how it follows the sheet's width"><option value="left">Left</option><option value="right">Right</option><option value="both">Left and right</option><option value="center">Centre</option><option value="scale">Scale</option></select>
          <select data-pin-v aria-label="Pin vertically: how it follows the sheet's height"><option value="top">Top</option><option value="bottom">Bottom</option><option value="both">Top and bottom</option><option value="center">Middle</option><option value="scale">Scale</option></select></label>
        <button type="button" data-kind="picture" data-crop hidden aria-pressed="false" aria-label="Crop the picture" title="Crop: drag a side or a corner of the picture; drag outward to bring back what was cut. Enter or Escape finishes.">${ICONS.crop}</button>
        <button type="button" data-kind="picture" data-uncrop hidden aria-label="Show the whole picture" title="Show the whole picture again (the crop is removed)">${ICONS.fullscreen}</button>
        <button type="button" data-kind="picture shape stroke text" data-adjust hidden aria-haspopup="dialog" aria-expanded="false" aria-label="Adjust the picture" title="Adjust the picture, shape or text: exposure, contrast, colour, blur and more. The original is not changed.">${ICONS.slidersVertical}</button>
        <button type="button" data-kind="picture shape stroke text" data-adjust-reset hidden aria-label="Reset the adjustments" title="Reset the adjustments of the picked pictures">${ICONS.listRestart}</button>
        <span class="tb-count" data-kind="any" data-on-sheet hidden title="Where it is on its sheet, in per cent of the sheet: X and Y from its top-left corner, W and H of its width and height">On sheet
          <label>X <input type="number" data-on-x step="any" inputmode="decimal" aria-label="Position from the left of the sheet (per cent of its width)"></label> <label>Y <input type="number" data-on-y step="any" inputmode="decimal" aria-label="Position from the top of the sheet (per cent of its height)"></label>
          <span data-on-size><label>W <input type="number" data-on-w min="0" step="any" inputmode="decimal" aria-label="Width (per cent of the sheet's width)"></label> <label>H <input type="number" data-on-h min="0" step="any" inputmode="decimal" aria-label="Height (per cent of the sheet's height)"></label></span> %</span>
        <span class="tb-count" data-kind="sheet" data-sheet-size hidden title="The shape of the sheet: width ÷ height. A sheet has a shape, not a size; the size is chosen when it is exported (Export in the Actions bar)">
          <span class="tb-shape" data-sheet-shape aria-hidden="true"></span>
          <label>Ratio <input type="text" data-sheet-ratio size="11" spellcheck="false" autocomplete="off" inputmode="text" aria-label="Sheet shape: width to height, like 16:9, 1.5 or A4" title="Type a ratio (16:9, 3/2, 1.5, A4, letter, square) or a size in px (2000 x 1920 becomes 25 : 24), then Enter. Add portrait or landscape to turn it."></label>
          <select data-sheet-preset aria-label="Sheet shape preset" title="A common shape: the sheet takes it, keeping its area and its top-left corner"><option value="">Shapes…</option>${["Basic", "Screen", "Paper", "Social"].map((g) => `<optgroup label="${g}">${RATIO_PRESETS.filter((r) => r.group === g).map((r) => `<option value="${r.ratio}">${r.label}</option>`).join("")}</optgroup>`).join("")}</select>
          <button type="button" data-sheet-turn aria-label="Turn the sheet on its side: swap its width and height" title="Turn it on its side: portrait ⇄ landscape (the same area)">${ICONS.arrowRightLeft}</button>
          <button type="button" data-sheet-scale aria-pressed="false" aria-label="Scale contents with the sheet" title="Scale contents (kept with this sheet): when the sheet is resized, everything on it grows with it, whatever its pins say">${ICONS.sheetScale}</button></span>
        <label class="tb-count" data-kind="shape" data-scrub="inner" data-sel-inner-wrap hidden title="Drag the field left or right to change it">Ratio <input type="number" data-sel-inner min="5" max="95" step="1" inputmode="numeric" aria-label="Star ratio (percent)" title="Inner radius as a percent of the outer one"></label>
      </div>
      <div class="tb-group tb-options" data-for="text note select node" data-kind="text">
        <button type="button" class="swatch swatch-paint" data-text-colour data-text-wrap hidden aria-haspopup="dialog" aria-expanded="false" aria-label="Text colour" title="Text colour: open the colour picker (with transparency)"><span data-paint-chip></span></button>
        <label class="tb-count" data-text-wrap hidden title="Font: the bundled one, or a font file from the library (import one here)"><select data-text-font aria-label="Font"></select></label>
        <button type="button" data-text-font-options data-text-wrap hidden aria-haspopup="dialog" aria-expanded="false" aria-label="Font options" title="Font options: kerning, the features of the font (ligatures, small capitals, numerals...) and the axes of a variable font">${ICONS.fontOptions}</button>
        <input type="file" hidden accept=".ttf,.otf,.woff,.woff2" data-testid="font-input">
        <label class="tb-count" data-text-wrap hidden title="Text size, in px at this zoom. Drag the field to change it.">Size <input type="number" data-text-size min="1" max="2000" step="any" inputmode="decimal" aria-label="Text size (px at this zoom)"></label>
        <button type="button" class="swatch swatch-paint" data-text-outline data-text-wrap hidden aria-haspopup="dialog" aria-expanded="false" aria-label="Text outline" title="Text outline: the colour of the line round the letters (none to take it away)"><span data-paint-chip></span></button>
        <label class="tb-count" data-text-wrap hidden title="Outline width, in px at this zoom (0: none)">Outline <input type="number" data-text-outline-w min="0" max="2000" step="any" inputmode="decimal" aria-label="Text outline width (px at this zoom)"></label>
        <button type="button" data-text-box data-text-wrap hidden aria-haspopup="dialog" aria-expanded="false" aria-label="Paragraph and box options" title="Paragraph and box: space between paragraphs, first line, case, most lines, set height">${ICONS.textBox}</button>
        <label class="tb-count" data-text-wrap hidden title="Line height: a multiple of the text size. Drag the field to change it.">Line <input type="number" data-text-line min="0.5" max="5" step="0.05" aria-label="Line height"></label>
        <label class="tb-count" data-text-wrap hidden title="Letter spacing: a share of the text size. Drag the field to change it.">Letters <input type="number" data-text-track min="-50" max="200" step="1" aria-label="Letter spacing (percent of the text size)"></label>
      </div>
      <div class="tb-group tb-options" data-for="text note select node" data-kind="text" role="radiogroup" aria-label="Text alignment">
        ${TEXT_ALIGNS.map((a) => `<button type="button" role="radio" class="shape-kind" data-text-wrap hidden data-text-align="${a.id}" aria-label="${a.label}" title="${a.label}">${a.icon}</button>`).join("")}
      </div>
      <div class="tb-group tb-options" data-for="text note select node" data-kind="text" role="radiogroup" aria-label="Text width">
        ${TEXT_FITS.map((a) => `<button type="button" role="radio" class="shape-kind" data-text-wrap hidden data-text-fit="${a.id}" aria-label="${a.label}" title="${a.title}">${a.icon}</button>`).join("")}
      </div>
      <div class="tb-group tb-options" data-for="select node" data-sel-colours data-no-command hidden role="group" aria-label="Colours of the selection"></div>
      <div class="tb-group tb-options" data-for="shape path select node" data-kind="shape sheet picture">
        <button type="button" class="swatch swatch-paint" data-kind="shape sheet" data-paint="fill" aria-haspopup="dialog" aria-expanded="false" aria-label="Fill" title="Fill colour: open the colour picker"><span data-paint-chip></span><b class="swatch-name">Fill</b></button>
        <button type="button" class="swatch swatch-paint" data-paint="stroke" aria-haspopup="dialog" aria-expanded="false" aria-label="Outline" title="Outline colour: open the colour picker"><span data-paint-chip></span><b class="swatch-name">Outline</b></button>
      <button type="button" class="swatch swatch-outline" data-outline-options aria-haspopup="dialog" aria-expanded="false" aria-label="Outline options" title="Outline options: width, position (inside, centre, outside), corners and ends">${ICONS.outlineOptions}</button>
      </div>
      <div class="tb-group tb-options" data-for="shape path">
        <input type="range" class="size" data-shape-width min="0" max="100" step="1" aria-label="Outline width" title="Outline width (screen px at this zoom)">
        <span class="size-out" data-shape-out></span>
      </div>
      <div class="tb-group tb-options" data-for="pen select" data-kind="stroke tool" role="group" aria-label="Size">
        ${PEN_WIDTHS.map(
          (w) => `<button type="button" class="width" data-pen-only data-width="${w}" aria-label="Pen width ${w} px" title="Pen width ${w} px"><span style="height:${Math.max(2, w)}px"></span></button>`,
        ).join("")}
        <input type="range" class="size" data-size min="0" max="100" step="1" aria-label="Pen size" title="Pen size (screen px at this zoom); on Select it sets the thickness of the selected strokes">
        <span class="size-out" data-size-out></span>
      </div>
      <div class="tb-group tb-options" data-for="pen" role="group" aria-label="Smooth">
        <button type="button" class="stab" data-stab aria-pressed="false" aria-label="Stabilizer" title="Stabilizer: smooths hand wobble; the brush follows the pointer on a rope">${ICONS.waves}</button>
        <input type="range" class="size" data-strength min="1" max="100" step="1" aria-label="Stabilizer strength" title="Stabilizer strength (rope length)" hidden>
      </div>
      <div class="tb-group tb-options" data-for="pen select" data-kind="stroke shape tool" role="group" aria-label="Keep size">
        <button type="button" class="follow" data-kind="stroke tool" data-pen-only data-follow aria-pressed="false" aria-label="Pen size follows zoom" title="Pen size follows zoom: while drawing, the pen keeps its size on screen when you zoom (the line gets thinner or thicker along its length)">${ICONS.scaling}</button>
        <button type="button" class="lock" data-kind="shape" data-lock-radius aria-pressed="false" hidden aria-label="Lock corner radius" title="Lock corner radius: resizing a shape keeps its corner radius (off: the radius scales with the shape, so it keeps its look)">${ICONS.squareRoundCorner}</button>
        <button type="button" class="lock" data-kind="stroke tool" data-lock aria-pressed="false" aria-label="Lock thickness" title="Lock thickness: new strokes keep this width on the canvas at any zoom; resizing a stroke keeps its line width">${ICONS.lock}</button>
      </div>
      <div class="tb-group tb-options" data-for="select node" role="group" aria-label="Selection options">
        <button type="button" class="snap" data-kind="any" data-snap aria-pressed="true" aria-label="Snap to other objects" title="Snap to other objects: while moving, edges and centres line up with other objects (exactly, at any zoom), with a guide line">${ICONS.magnet}</button>
        <button type="button" class="snap" data-kind="any" data-box-axis aria-pressed="false" aria-label="Axis-aligned selection box" title="Axis-aligned selection box: by default the box turns with the selected objects when they share a rotation">${ICONS.boxSelect}</button>
      </div>
      <div class="tb-group tb-options" data-for="select node" role="group" aria-label="Pick options">
        <button type="button" class="snap" data-kind="tool" data-ignore-fill aria-pressed="false" aria-label="Ignore the object that fills the view" title="Ignore the object that fills the view: zoomed far into an object it cannot be picked or deleted by accident">${ICONS.pointerBan}</button>
      </div>
      <div class="tb-group tb-options" data-for="eraser" role="group" aria-label="Size">
        <input type="range" class="size" data-eraser-size min="4" max="128" step="1" aria-label="Eraser size" title="Eraser diameter (screen px)">
        <span class="size-out" data-eraser-out></span>
        <button type="button" class="snap" data-erase-parts aria-pressed="false" aria-label="Erase parts of strokes" title="On: the eraser cuts out only what it sweeps over of a freehand stroke. Off: it takes whole objects.">${ICONS.scissors}</button>
        <button type="button" class="snap" data-erase-groups aria-pressed="true" aria-label="Erase whole groups" title="On: a swipe takes a group as one object. Off: it takes only the members it touches.">${ICONS.shapes}</button>
      </div>
      <div class="tb-group tb-options" data-for="eyedropper" role="group" aria-label="Eyedropper">
        <select data-sample-size aria-label="Sample size" title="Sample size: the colour of one pixel, or the mean of a square round it">${SAMPLE_SIZES.map((n) => `<option value="${n}">${n === 1 ? "Point" : `${n} × ${n} mean`}</option>`).join("")}</select>
      </div>
      <div class="tb-group tb-options" data-for="eyedropper" data-only="paint" role="radiogroup" aria-label="Sample from">
        <button type="button" role="radio" data-sample-layer="all" title="Sample the page as it looks, every layer">All layers</button>
        <button type="button" role="radio" data-sample-layer="layer" title="Sample the picked layer alone">Layer</button>
      </div>
      <div class="tb-group tb-options" data-for="lasso" role="radiogroup" aria-label="Lasso selects">
        <button type="button" role="radio" data-filter="strokes" title="Lasso selects strokes only">Strokes</button>
        <button type="button" role="radio" data-filter="all" title="Lasso selects strokes and fully enclosed media">All</button>
      </div>
      </div>
    </div>
  `;
  // The colours of a selection are a second bar of their own, just under this one (the same bar component, ADR 0128).
  const colourBar = createBar("Colours of the selection", "Colours");
  colourBar.row.append(root.querySelector("[data-sel-colours]")!);
  // The Outline options button sits beside the Outline colour: in this bar, after the chips, when several shapes are picked.
  const outlineBtn = root.querySelector<HTMLElement>("[data-outline-options]")!;
  const outlineHome = outlineBtn.parentElement!;
  root.querySelector(".toolbar")!.after(colourBar.el);
  // On a phone the colours of the selection share the row of the Properties bar (one row less at the top); wider, they are a bar of their own under it.
  const phoneWidth = window.matchMedia("(max-width: 640px)");
  const placeColours = (): void => {
    const group = root.querySelector<HTMLElement>("[data-sel-colours]")!;
    const home = phoneWidth.matches ? root.querySelector<HTMLElement>(".tb-options-row")! : colourBar.row;
    if (group.parentElement !== home) home.append(group);
  };
  placeColours();
  // The corner-radius lock, snap and the axis-aligned box are a bar of their own beside the Actions bar. It joins that bar's wrapper (the same parent, so the
  // two line up) in `update`, once the Actions bar exists (it is mounted after this one); its clicks are handled here.
  const pickBar = createBar("Selection options", "Selection");
  const pickGroup = root.querySelector<HTMLElement>('.tb-group[aria-label="Selection options"]')!;
  pickGroup.prepend(root.querySelector("[data-lock-radius]")!); // (the lock of the corner radius is one of them: it is about how a shape resizes)
  pickBar.row.append(pickGroup);
  const pq = (sel: string): HTMLElement => pickGroup.querySelector<HTMLElement>(sel)!;
  const input = root.querySelector<HTMLInputElement>("input[type=file]")!;
  input.addEventListener("change", () => {
    if (input.files?.length) actions.importFiles([...input.files]);
    input.value = "";
  });

  // Continuous pen size: a new size is the new lock reference, like a preset.
  root.querySelector<HTMLInputElement>("[data-size]")!.addEventListener("input", (e) => {
    editor.penWidthPx = penFromSlider(Number((e.target as HTMLInputElement).value));
    if (editor.lock) editor.lock = { ...actions.depth(), px: editor.penWidthPx };
    if (editor.tool === "select") actions.setSelectedWidth(editor.penWidthPx, false); // live: the selected strokes follow the slider
    editor.changed();
  });

  // On Select the slider also sets the selected strokes' thickness, once on release (one undo step).
  root.querySelector<HTMLInputElement>("[data-size]")!.addEventListener("change", () => {
    if (editor.tool === "select") actions.setSelectedWidth(editor.penWidthPx, true);
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
    editor.changed(); // (the hint line says whose gradient they are)
    openPaintPopover(anchor, {
      name: which === "fill" ? "Fill" : "Outline",
      paint: paintNow(which),
      noneLabel: which === "fill" ? "No fill" : "No outline",
      // a picture or objects fill the picked shapes (ADR 0154)
      ...(which === "fill" && editsSelection() ? { modes: ["none", "solid", "linear", "radial", "angular", "image", "objects"] as const } : {}),
      onInput: (p) => setPaint(which, p, false),
      onChange: (p) => setPaint(which, p, true),
      onClose: () => {
        if (editsSelection()) actions.paintSelected({}, true); // drop a preview that was never stored
      },
    });
  };

  // The numbers of the picked shape (a polygon's sides, a star's points and ratio, a corner radius): changed after the shape is drawn.
  const shapeInput = (sel: string, apply: (v: number) => { sides?: number; tips?: number; inner?: number; radiusPx?: number } | null): void => {
    liveNumber(root.querySelector<HTMLInputElement>(sel)!, (v, final) => {
      const change = apply(v);
      if (change) actions.shapeSelected(change, final);
    });
  };
  // (one value, or one for every corner)
  const radiusInput = root.querySelector<HTMLInputElement>("[data-sel-radius]")!;
  const radiusApply = (final: boolean): void => {
    const parts = radiusInput.value.trim().split(/[\s,]+/).map(Number);
    if (parts.every((v) => Number.isFinite(v) && v >= 0) && (parts.length === 1 || parts.length === actions.selectedCorners()?.nodes)) actions.cornersSelected(parts, final);
  };
  radiusInput.addEventListener("input", () => radiusApply(false));
  radiusInput.addEventListener("change", () => radiusApply(true));
  // The font list is read from the library when the menu is opened (and after an import); the selected font is always shown.
  const fontSelect = root.querySelector<HTMLSelectElement>("[data-text-font]")!;
  const fontInput = root.querySelector<HTMLInputElement>("[data-testid=font-input]")!;
  let fontList: Array<{ hash: string; name: string; unusable: string }> = [];
  let fontHtml = "";
  const paintFonts = (): void => {
    const now = actions.selectedTextStyle()?.assetId ?? "";
    const known = new Set(fontList.map((f) => f.hash));
    const html = [`<option value="">${BUNDLED_FONT_NAME}</option>`]
      .concat(fontList.map((f) => `<option value="${f.hash}"${f.unusable ? " disabled" : ""}>${esc(f.name)}${f.unusable ? " (cannot be read)" : ""}</option>`))
      .concat(now && !known.has(now) ? [`<option value="${now}">A font that is not in this library</option>`] : [])
      .concat([`<option value="__import">Add a font file…</option>`])
      .join("");
    if (html !== fontHtml) fontSelect.innerHTML = fontHtml = html;
    fontSelect.value = now;
  };
  const askedFor = new Set<string>();
  const askFonts = (): void => void actions.fonts().then((l) => {
    fontList = l;
    askedFor.add("");
    if (document.activeElement !== fontSelect) paintFonts();
  });
  // The list is read before the menu opens (a menu already open is not rebuilt under the pointer): the first time a text is shown, when the
  // font it is set in is not in the list yet, and when the pointer comes near.
  const wantFonts = (now: string): void => {
    if (askedFor.has("") && (!now || fontList.some((f) => f.hash === now) || askedFor.has(now))) return;
    askedFor.add(now);
    askFonts();
  };
  fontSelect.addEventListener("pointerenter", askFonts);
  fontSelect.addEventListener("pointerdown", askFonts);
  fontSelect.addEventListener("focus", askFonts);
  fontSelect.addEventListener("change", () => {
    if (fontSelect.value === "__import") {
      fontSelect.value = actions.selectedTextStyle()?.assetId ?? "";
      fontInput.click();
    } else actions.setTextStyle({ assetId: fontSelect.value || null });
  });
  fontInput.addEventListener("change", () => {
    const f = fontInput.files?.[0];
    fontInput.value = "";
    if (f) void actions.importFont(f).then((hash) => {
      if (hash) actions.setTextStyle({ assetId: hash });
      askFonts();
    });
  });
  liveNumber(root.querySelector<HTMLInputElement>("[data-text-size]")!, (v, final) => v > 0 && actions.setTextStyle({ sizePx: v }, final));
  // (these buttons keep the focus where it is, so a text being edited stays open and takes the change)
  for (const b of root.querySelectorAll<HTMLElement>("[data-text-align], [data-text-fit]")) b.addEventListener("mousedown", (e) => e.preventDefault());
  for (const b of root.querySelectorAll<HTMLElement>("[data-text-align]")) b.addEventListener("click", () => actions.setTextStyle({ align: b.dataset["textAlign"] as "left" }));
  for (const b of root.querySelectorAll<HTMLElement>("[data-text-fit]")) b.addEventListener("click", () => actions.setTextStyle({ autoWidth: b.dataset["textFit"] === "width" }));
  root.querySelector<HTMLElement>("[data-text-colour]")!.addEventListener("click", (e) => {
    const anchor = e.currentTarget as HTMLElement;
    openPaintPopover(anchor, {
      name: "Text colour",
      paint: actions.selectedTextStyle()?.gradient ?? actions.selectedTextStyle()?.color ?? null,
      noneLabel: "No colour",
      modes: ["solid", "linear", "radial"],
      onInput: (p) => p !== null && actions.setTextStyle(typeof p === "string" ? { color: p, gradient: null } : isGradient(p) ? { gradient: p } : {}, false),
      onChange: (p) => p !== null && actions.setTextStyle(typeof p === "string" ? { color: p, gradient: null } : isGradient(p) ? { gradient: p } : {}),
    });
  });
  // The line round the letters: its colour here, its width beside it (px at this zoom, kept as a share of the size).
  const outlineWidthEm = (px: number): number => {
    const size = actions.selectedTextStyle()?.sizePx;
    return size ? px / size : 0.05;
  };
  root.querySelector<HTMLElement>("[data-text-outline]")!.addEventListener("click", (e) => {
    const t = actions.selectedTextStyle();
    openPaintPopover(e.currentTarget as HTMLElement, {
      name: "Text outline",
      paint: t?.outline?.c ?? null,
      noneLabel: "No outline",
      modes: ["none", "solid"],
      onInput: (p) => actions.setTextStyle({ outline: typeof p === "string" ? { c: p, w: actions.selectedTextStyle()?.outline?.w ?? 0.05 } : null }, false),
      onChange: (p) => actions.setTextStyle({ outline: typeof p === "string" ? { c: p, w: actions.selectedTextStyle()?.outline?.w ?? 0.05 } : null }),
    });
  });
  liveNumber(root.querySelector<HTMLInputElement>("[data-text-outline-w]")!, (v, final) => {
    const t = actions.selectedTextStyle();
    actions.setTextStyle({ outline: v > 0 ? { c: t?.outline?.c ?? t?.color ?? "#000000", w: outlineWidthEm(v) } : null }, final);
  });
  root.querySelector<HTMLElement>("[data-text-font-options]")!.addEventListener("click", (e) => {
    const t = actions.selectedTextStyle();
    if (!t) return;
    const font = fontFor(t.assetId ?? undefined);
    const have = new Set(font.features());
    const offered = [...have].filter((tag) => FONT_FEATURES[tag] || /^ss(0[1-9]|1\d|20)$/.test(tag) || /^cv\d\d$/.test(tag));
    openFontOptionsPopover(e.currentTarget as HTMLElement, {
      family: font.names.family,
      style: font.names.style,
      kerning: t.kerning,
      features: offered.map((tag) => ({ tag, label: FONT_FEATURES[tag] ?? (tag.startsWith("ss") ? `Stylistic set ${Number(tag.slice(2))}` : `Character variant ${Number(tag.slice(2))}`), on: t.features.includes(tag) })),
      axes: font.axes.map((a) => ({ ...a, value: t.axes?.[a.tag] ?? a.def })),
      onChange: (patch, final) => actions.setTextStyle({ ...patch, ...(patch.axes && Object.keys(patch.axes).length === 0 ? { axes: null } : {}) }, final),
    });
  });
  root.querySelector<HTMLElement>("[data-text-box]")!.addEventListener("click", (e) => {
    const t = actions.selectedTextStyle();
    if (!t) return;
    openTextBoxPopover(e.currentTarget as HTMLElement, {
      paraGap: t.paraGap, indent: t.indent, caps: t.caps, maxLines: t.maxLines, heightPx: t.heightPx, valign: t.valign, card: t.card,
      onChange: (patch, final) => actions.setTextStyle(patch, final),
    });
  });
  liveNumber(root.querySelector<HTMLInputElement>("[data-text-line]")!, (v, final) => actions.setTextStyle({ lineHeight: v }, final));
  liveNumber(root.querySelector<HTMLInputElement>("[data-text-track]")!, (v, final) => actions.setTextStyle({ tracking: v / 100 }, final));
  root.querySelector<HTMLSelectElement>("[data-pin-h]")!.addEventListener("change", (e) => actions.setPin({ h: (e.target as HTMLSelectElement).value }));
  root.querySelector<HTMLSelectElement>("[data-pin-v]")!.addEventListener("change", (e) => actions.setPin({ v: (e.target as HTMLSelectElement).value }));
  const sheetField = (sel: string): HTMLInputElement => root.querySelector<HTMLInputElement>(sel)!;
  const onSheet = (sel: string): HTMLInputElement => root.querySelector<HTMLInputElement>(sel)!;
  for (const f of ["[data-on-x]", "[data-on-y]"]) liveNumber(onSheet(f), (_v, final) => actions.moveOnSheet(Number(onSheet("[data-on-x]").value), Number(onSheet("[data-on-y]").value), final));
  for (const f of ["[data-on-w]", "[data-on-h]"]) liveNumber(onSheet(f), (_v, final) => actions.resizeOnSheet(Number(onSheet("[data-on-w]").value), Number(onSheet("[data-on-h]").value), final));
  // The shape of a sheet: typed (16:9, A4 portrait …), picked from the shapes, or turned on its side. Anything else keeps what it was.
  const ratioField = sheetField("[data-sheet-ratio]");
  const showRatio = (): void => {
    const r = actions.sheetRatio();
    if (r !== null && document.activeElement !== ratioField) ratioField.value = formatRatio(r);
  };
  const commitRatio = (): void => {
    const r = parseRatio(ratioField.value);
    ratioField.toggleAttribute("aria-invalid", r === null);
    if (r === null) {
      editor.message = `“${ratioField.value}” is not a shape. Try 16:9, 3/2, 1.5, A4 or square.`;
      editor.changed();
      ratioField.value = formatRatio(actions.sheetRatio() ?? 1);
      ratioField.removeAttribute("aria-invalid");
      return;
    }
    actions.setSheetRatio(r, true);
    ratioField.value = formatRatio(actions.sheetRatio() ?? r);
  };
  ratioField.addEventListener("change", commitRatio);
  ratioField.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ratioField.blur();
    else if (e.key === "Escape") {
      ratioField.value = formatRatio(actions.sheetRatio() ?? 1);
      ratioField.blur();
      e.stopPropagation();
    }
  });
  sheetField("[data-sheet-preset]").addEventListener("change", (e) => {
    const sel = e.target as HTMLSelectElement;
    const r = Number(sel.value);
    sel.value = "";
    const now = actions.sheetRatio();
    if (r > 0 && now !== null) actions.setSheetRatio(now < 1 ? 1 / r : r, true); // (a sheet on its side stays on its side)
  });
  root.querySelector<HTMLElement>("[data-sheet-turn]")!.addEventListener("click", () => {
    const now = actions.sheetRatio();
    if (now !== null) actions.setSheetRatio(1 / now, true);
  });
  root.querySelector<HTMLElement>("[data-sheet-scale]")!.addEventListener("click", () => {
    actions.setSheetScale(!actions.sheetScale());
  });
  root.querySelector<HTMLElement>("[data-crop]")!.addEventListener("click", () => {
    const id = [...editor.selection][0];
    editor.cropId = editor.cropId ? null : (id ?? null);
    editor.changed();
  });
  root.querySelector<HTMLElement>("[data-uncrop]")!.addEventListener("click", () => actions.uncrop());
  root.querySelector<HTMLElement>("[data-adjust-reset]")!.addEventListener("click", () => actions.commitAdjust({}, "Reset adjustments"));
  root.querySelector<HTMLElement>("[data-adjust]")!.addEventListener("click", () => {
    if (!actions.selectedAdjust() && !editor.adjustOpen) return;
    editor.adjustOpen = !editor.adjustOpen; // the Adjust panel (ui/adjust-panel.ts, ADR 0123)
    editor.changed();
  });
  shapeInput("[data-sel-sides]", (v) => (v >= 3 && v <= 24 ? { sides: Math.round(v) } : null));
  shapeInput("[data-sel-tips]", (v) => (v >= 3 && v <= 24 ? { tips: Math.round(v) } : null));
  liveNumber(root.querySelector<HTMLInputElement>("[data-sel-smooth]")!, (v, final) => v >= 0 && v <= 100 && actions.setSmoothing(v, final));
  shapeInput("[data-sel-inner]", (v) => (v >= 5 && v <= 95 ? { inner: v / 100 } : null));

  // Drag a number's field to change it, live (one undo step when released): the quick way to a radius, a count, a ratio.
  const scrubs: Record<string, { to(start: number, dx: number): number; apply(v: number, final: boolean): void }> = {
    radius: { to: (v, dx) => Math.max(0, v + dx), apply: (v, f) => actions.cornersSelected([v], f) },
    smooth: { to: (v, dx) => Math.max(0, Math.min(100, Math.round(v + dx / 2))), apply: (v, f) => actions.setSmoothing(v, f) },
    sides: { to: (v, dx) => Math.max(3, Math.min(24, Math.round(v + dx / 12))), apply: (v, f) => actions.shapeSelected({ sides: v }, f) },
    tips: { to: (v, dx) => Math.max(3, Math.min(24, Math.round(v + dx / 12))), apply: (v, f) => actions.shapeSelected({ tips: v }, f) },
    inner: { to: (v, dx) => Math.max(5, Math.min(95, Math.round(v + dx / 2))), apply: (v, f) => actions.shapeSelected({ inner: v / 100 }, f) },
  };
  let scrub: { label: HTMLElement; input: HTMLInputElement; key: string; start: number; x: number; moved: boolean; last: number } | null = null;
  root.addEventListener("pointerdown", (e) => {
    const label = (e.target as HTMLElement).closest<HTMLElement>("[data-scrub]");
    if (!label || e.button !== 0 || (e.target as HTMLElement).tagName !== "INPUT") return; // (the field scrubs, under a finger too; its name is only a label, so a bar that scrolls sideways scrolls from it)
    const input = label.querySelector<HTMLInputElement>("input")!;
    if ((e.target as HTMLElement).tagName === "INPUT" && document.activeElement === input) return; // (being typed in)
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
    if (!sc.moved) {
      sc.input.focus(); // a plain click goes to the field
      sc.input.select();
      return;
    }
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

  /** The tool whose kinds were closed by pressing its own button (until the tool changes). */
  let flyShut: "shape" | "pen" | Family | null = null;
  let colourEditing = false;
  // The first colours of the selection have a chip each; the others are one button, "+N", that opens them as a list (so the row stays short, and none is lost).
  const SEL_CHIPS = 7;
  const chipPaint = (p: Paint): string => (typeof p === "string" ? `linear-gradient(${swatchBackground(p)}, ${swatchBackground(p)})` : paintCss(p));
  const paintName = (p: Paint): string => (typeof p === "string" ? p.toUpperCase() : isTexture(p) ? (p.src.kind === "asset" ? "Picture" : "Objects") : "Gradient");
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
      // a pen stroke has one flat colour: no gradient to offer when strokes are all that is picked
      ...([...editor.selection].every((id) => doc.get(id)?.kind === "stroke") ? { modes: ["solid"] as const } : {}),
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
      dashNumbers: sel ? actions.selectedDashNumbers() ?? { len: 3, gap: 2, offset: 0 } : null,
      onDashNumbers: (n) => actions.setDashNumbers(n),
      miterAngle: sel ? actions.selectedMiterAngle() : null,
      onMiterAngle: (deg) => actions.setMiterAngle(deg),
      arrows: sel ? actions.selectedArrows() : null,
      onArrows: (patch) => actions.setArrows(patch),
      closed: sel ? sel.closed : editor.tool === "shape" && editor.shapeKind !== "line",
      onWidth: (px, final) => {
        if (sel) actions.setSelectedWidth(px, final);
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

  root.querySelector<HTMLSelectElement>("[data-sample-size]")!.addEventListener("change", (e) => {
    editor.sampleSize = Number((e.target as HTMLSelectElement).value);
    editor.changed();
  });
  root.querySelector<HTMLInputElement>("[data-eraser-size]")!.addEventListener("input", (e) => {
    editor.eraserPx = Number((e.target as HTMLInputElement).value);
    editor.changed();
  });

  root.querySelector<HTMLInputElement>("[data-strength]")!.addEventListener("input", (e) => {
    editor.stabilizer = { ...editor.stabilizer, strength: Number((e.target as HTMLInputElement).value) };
    editor.changed();
  });

  const onClick = (e: Event): void => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    const d = b.dataset;
    if (d["subject"]) {
      editor.subject = d["subject"];
      editor.changed();
    } else if (d["maskInk"]) {
      actions.paintMask(d["maskInk"] as "show" | "hide" | "done");
    } else if (d["penKind"]) {
      editor.penKind = d["penKind"] as PenKind;
      editor.changed();
    } else if (d["tool"]) {
      // the button of a tool with kinds (Shape, Pen, Brush), pressed while it is the tool, closes its kinds; pressed again, opens them
      const t = d["tool"] as Tool;
      const fam = t === "shape" ? "shape" : t === "pen" ? "pen" : (familyOf(t) ?? null);
      const same = fam !== null && !!b.closest(".rail-tools") && (fam === "shape" ? editor.tool === "shape" || editor.tool === "path" : fam === "pen" ? editor.tool === "pen" : familyOf(editor.tool) === fam);
      flyShut = same ? (flyShut === fam ? null : fam) : null;
      editor.setTool(t);
      editor.changed();
    } else if (d["color"]) {
      editor.penColor = d["color"];
      editor.changed();
    } else if (d["shapeKind"]) {
      editor.shapeKind = d["shapeKind"] as ShapeKind;
      if (editor.tool === "path") editor.setTool("shape");
      editor.changed();
    } else if (d["selColour"] !== undefined) {
      editColour(b, Number(d["selColour"]));
    } else if (d["selMore"] !== undefined) {
      // the colours past the chips, as a list: each opens the paint chooser, on this button
      const rest = actions.selectionPaints().items.slice(SEL_CHIPS);
      openMoreMenu(b, rest.map((it, j): MenuItem => ({ label: paintName(it.paint), hint: usage(it), icon: `<span class="menu-swatch" style="--paint:${chipPaint(it.paint)}"></span>`, aria: `${paintName(it.paint)}, used by ${usage(it)}: change it`, run: () => editColour(b, SEL_CHIPS + j) })), "More colours of the selection", { compact: true });
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
    } else if (d["styles"] !== undefined) {
      editor.stylesOpen = !editor.stylesOpen;
      editor.changed();
    } else if (d["tags"] !== undefined) {
      editor.tagsOpen = !editor.tagsOpen;
      editor.changed();
    } else if (d["layers"] !== undefined) {
      editor.layersOpen = !editor.layersOpen;
      editor.changed();
    } else if (d["patternPanel"] !== undefined) {
      editor.patternOpen = !editor.patternOpen;
      editor.changed();
    } else if (d["adjustPanel"] !== undefined) {
      editor.adjustOpen = !editor.adjustOpen;
      editor.changed();
    } else if (d["eraseParts"] !== undefined) {
      editor.eraseParts = !editor.eraseParts;
      editor.changed();
    } else if (d["eraseGroups"] !== undefined) {
      editor.eraseWholeGroups = !editor.eraseWholeGroups;
      editor.changed();
    } else if (d["boxAxis"] !== undefined) {
      editor.alignBox = !editor.alignBox;
      editor.changed();
    } else if (d["ignoreFill"] !== undefined) {
      editor.ignoreFilling = !editor.ignoreFilling;
      editor.changed();
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
    } else if (d["sampleLayer"]) {
      editor.sampleLayer = d["sampleLayer"] === "layer";
      editor.changed();
    } else if (d["filter"]) {
      editor.lassoFilter = d["filter"] as "strokes" | "all";
      editor.changed();
    } else if (d["action"] === "import") input.click();
    else if (d["action"] === "search") actions.openSearch("");
    else if (d["action"] === "screenshot") actions.screenshot();
    else if (d["action"] === "undo") actions.undo();
    else if (d["action"] === "redo") actions.redo();
  };
  root.addEventListener("click", onClick);
  pickGroup.addEventListener("click", onClick);

  const update = (): void => {
    for (const b of root.querySelectorAll<HTMLElement>("[data-tool]")) {
      // (Shape and Path are one place on the rail: the Shape button stays lit on the Path tool, which is chosen in the options beside the shapes)
      const t = b.dataset["tool"] as Tool;
      const on = t === editor.tool || (t === "shape" && editor.tool === "path" && !b.closest(".tb-options")) || (!!b.closest(".rail-tools") && familyOf(t) !== undefined && familyOf(t) === familyOf(editor.tool));
      b.setAttribute("aria-checked", String(on));
    }
    // The tools with kinds: their kinds open beside the button while the tool is active, and the button wears the icon of the kind in use.
    const flyAt = (name: "shape" | "pen" | Family, tool: string, on: boolean, icon: string): void => {
      const fly = root.querySelector<HTMLElement>(`[data-fly="${name}"]`)!;
      const btn = root.querySelector<HTMLElement>(`.rail-tools [data-tool="${tool}"]`)!;
      if (fly.dataset["only"] === "paint") {
        // (the Painting view's kinds: on the canvas the button is a plain tool)
        on &&= document.body.dataset["view"] === "paint";
        btn.toggleAttribute("aria-haspopup", document.body.dataset["view"] === "paint");
      }
      if (!on && flyShut === name) flyShut = null; // (another tool: the kinds open again next time)
      fly.hidden = !on || flyShut === name;
      if (!fly.hidden) fly.style.top = `${btn.offsetTop + (btn.offsetHeight - fly.offsetHeight) / 2}px`; // (centred on its button, whatever the bar's own padding)
      btn.setAttribute("aria-expanded", String(!fly.hidden)); // (the same state a menu button reports)
      if (btn.dataset["icon"] !== icon) {
        btn.dataset["icon"] = icon;
        btn.innerHTML = icon;
      }
    };
    flyAt("shape", "shape", editor.tool === "shape" || editor.tool === "path", editor.tool === "path" ? ICONS.pathTool : (SHAPE_MENU.find((k) => k.id === editor.shapeKind)?.icon ?? ICONS.shapeTool));
    flyAt("pen", "pen", editor.tool === "pen", PEN_MENU.find((k) => k.id === editor.penKind)?.icon ?? ICONS.pencil);
    for (const f of Object.keys(FAMILIES) as Family[]) {
      const m = FAMILIES[f].find((x) => x.tool === editor.tool);
      flyAt(f, FAMILIES[f][0].tool, !!m, (m ?? FAMILIES[f][0]).icon);
    }
    for (const b of root.querySelectorAll<HTMLElement>("[data-pen-kind]")) b.setAttribute("aria-checked", String(b.dataset["penKind"] === editor.penKind));
    root.querySelector<HTMLElement>("[data-colour-chip]")!.style.background = newInk(editor.penColor);
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
    const smoothing = pick && still ? actions.selectedSmoothing() : null;
    const round2 = (v: number): string => String(Math.round(v * 100) / 100);
    const fields: Array<[string, boolean, string]> = [
      ["radius", !!crn, crn && !crn.mixed ? round2(crn.radiusPx[0] ?? 0) : ""],
      ["smooth", smoothing !== null, String(smoothing ?? 0)],
      ["sides", shp?.shape === "polygon", String(shp?.sides ?? 0)],
      ["tips", shp?.shape === "star", String(shp?.tips ?? 0)],
      ["inner", shp?.shape === "star", String(shp ? Math.round(shp.inner * 100) : 0)],
    ];
    const txt = (pick && still) || editor.editingText || editor.tool === "text" || editor.tool === "note" ? actions.selectedTextStyle() : null;
    for (const w of root.querySelectorAll<HTMLElement>("[data-text-wrap]")) w.hidden = !txt;
    if (txt) {
      wantFonts(txt.assetId ?? "");
      if (document.activeElement !== fontSelect) paintFonts();
      const size = root.querySelector<HTMLInputElement>("[data-text-size]")!;
      if (document.activeElement !== size) size.value = txt.sizePx === null ? "" : String(Math.round(txt.sizePx * 100) / 100);
      for (const b of root.querySelectorAll<HTMLElement>("[data-text-align]")) b.setAttribute("aria-checked", String(b.dataset["textAlign"] === txt.align));
      for (const b of root.querySelectorAll<HTMLElement>("[data-text-fit]")) b.setAttribute("aria-checked", String((b.dataset["textFit"] === "width") === txt.autoWidth));
      root.querySelector<HTMLElement>("[data-text-colour] [data-paint-chip]")!.style.background = txt.gradient ? paintCss(txt.gradient) : swatchBackground(txt.color);
      root.querySelector<HTMLElement>("[data-text-outline] [data-paint-chip]")!.style.background = txt.outline ? swatchBackground(txt.outline.c) : "transparent";
      const ow = root.querySelector<HTMLInputElement>("[data-text-outline-w]")!;
      if (document.activeElement !== ow) ow.value = txt.outline && txt.sizePx !== null ? String(Math.round(txt.outline.w * txt.sizePx * 100) / 100) : "0";
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
    const crop = root.querySelector<HTMLElement>("[data-crop]")!;
    crop.hidden = !(pick && still && actions.croppable());
    crop.setAttribute("aria-pressed", String(editor.cropId !== null));
    // A dot on the button says the picture already has it (and the label says so for a screen reader).
    const cropped = pick && still && actions.cropped();
    crop.classList.toggle("is-applied", cropped);
    crop.setAttribute("aria-label", cropped ? "Crop the picture (cropped)" : "Crop the picture");
    root.querySelector<HTMLElement>("[data-uncrop]")!.hidden = !(pick && still && actions.cropped());
    const adj = pick && still ? actions.selectedAdjust() : null;
    const adjustBtn = root.querySelector<HTMLElement>("[data-adjust]")!;
    adjustBtn.hidden = !adj;
    adjustBtn.setAttribute("aria-pressed", String(editor.adjustOpen));
    const adjusted = !!adj && Object.keys(adj.adjust).length > 0;
    adjustBtn.classList.toggle("is-applied", adjusted);
    adjustBtn.setAttribute("aria-label", adjusted ? "Adjust the picture (adjusted)" : "Adjust the picture");
    root.querySelector<HTMLElement>("[data-adjust-reset]")!.hidden = !adj || Object.keys(adj.adjust).length === 0;
    const on = pick && still ? actions.boxOnSheet() : null;
    root.querySelector<HTMLElement>("[data-on-sheet]")!.hidden = !on;
    if (on) {
      root.querySelector<HTMLElement>("[data-on-size]")!.hidden = !on.resizable;
      for (const f of ["[data-on-x]", "[data-on-y]", "[data-on-w]", "[data-on-h]"]) onSheet(f).dataset["scrubStep"] = "0.1"; // (a dragged pixel is a tenth of a per cent)
      for (const [f, v] of [["[data-on-x]", on.x], ["[data-on-y]", on.y], ["[data-on-w]", on.w], ["[data-on-h]", on.h]] as const) {
        const el = onSheet(f);
        if (document.activeElement !== el) el.value = String(Math.round(v * 100) / 100);
      }
    }
    const ratio = pick && still ? actions.sheetRatio() : null;
    root.querySelector<HTMLElement>("[data-sheet-size]")!.hidden = ratio === null;
    if (ratio !== null) {
      showRatio();
      const shape = root.querySelector<HTMLElement>("[data-sheet-shape]")!;
      shape.style.setProperty("--shape", String(Math.min(Math.max(ratio, 0.2), 5)));
      root.querySelector<HTMLElement>("[data-sheet-scale]")!.setAttribute("aria-pressed", String(actions.sheetScale()));
    }
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
      // (a pen stroke alone has no Fill or Outline button, so its colour is a chip too)
      const oneStroke = used.count === 1 && [...editor.selection].every((id) => doc.get(id)?.kind === "stroke");
      const all = used.count >= 2 || oneStroke ? used.items : [];
      const items = all.slice(0, SEL_CHIPS);
      const key = JSON.stringify(all.map((it) => [it.paint, it.fills, it.strokes]));
      if (colours.dataset["list"] !== key) {
        colours.dataset["list"] = key;
        colours.innerHTML =
          items
            .map((it, i) => {
              return `<button type="button" class="swatch swatch-paint" data-sel-colour="${i}"${it.fills ? "" : " data-ring"} aria-haspopup="dialog" aria-expanded="false" aria-label="${paintName(it.paint)}, used by ${usage(it)}" title="${paintName(it.paint)}: used by ${usage(it)}; change it everywhere in the selection"><span data-paint-chip style="--paint:${chipPaint(it.paint)}"></span></button>`;
            })
            .join("") + (all.length > items.length ? `<button type="button" class="tb-chip" data-sel-more aria-haspopup="menu" aria-expanded="false" aria-label="${all.length - items.length} more colours of the selection" title="${all.length - items.length} more colours of the selection: choose one to change it">+${all.length - items.length}</button>` : "");
      }
    }
    const sw = root.querySelector<HTMLInputElement>("[data-shape-width]")!;
    if (document.activeElement !== sw) sw.value = String(sliderFromPen(editor.shapeWidthPx));
    root.querySelector<HTMLElement>("[data-shape-out]")!.textContent = `${editor.shapeWidthPx} px`;
    // The paint chips show the next shape's colours, or the selected paths' (and are there only when something has them).
    const sel = editor.tool === "select" || editor.tool === "node" ? actions.selectedPaint() : null;
    const several = (editor.tool === "select" || editor.tool === "node") && editor.preview.kind === "none" ? actions.selectionPaints().count >= 2 : false;
    if (editor.preview.kind === "none") {
    }
    const outlineAt = several ? root.querySelector<HTMLElement>("[data-sel-colours]")! : outlineHome;
    if (outlineBtn.parentElement !== outlineAt) outlineAt.append(outlineBtn);
    outlineBtn.hidden = (editor.tool === "select" || editor.tool === "node") && !sel;
    for (const b of root.querySelectorAll<HTMLButtonElement>("[data-paint]")) {
      const which = b.dataset["paint"] as "fill" | "stroke";
      const value = sel ? sel[which] : which === "fill" ? editor.shapeFill : editor.shapeStroke;
      b.hidden = (editor.tool === "select" || editor.tool === "node") && (!sel || several);
      b.classList.toggle("is-none", value === null);
      (b.querySelector("[data-paint-chip]") as HTMLElement).style.setProperty("--paint", value === null ? "linear-gradient(transparent, transparent)" : typeof value === "string" ? `linear-gradient(${sel ? value : newInk(value)}, ${sel ? value : newInk(value)})` : paintCss(value)); // (what the next shape gets is the colour it will have)
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
    root.querySelector<HTMLElement>("[data-adjust-panel]")!.setAttribute("aria-pressed", String(editor.adjustOpen));
    root.querySelector<HTMLElement>("[data-pattern-panel]")!.setAttribute("aria-pressed", String(editor.patternOpen));
    root.querySelector<HTMLElement>("[data-tags]")!.setAttribute("aria-pressed", String(editor.tagsOpen));
    root.querySelector<HTMLElement>("[data-styles]")!.setAttribute("aria-pressed", String(editor.stylesOpen));
    pq("[data-snap]").setAttribute("aria-pressed", String(editor.snap));
    pq("[data-box-axis]").setAttribute("aria-pressed", String(editor.alignBox));
    root.querySelector<HTMLElement>("[data-ignore-fill]")!.setAttribute("aria-pressed", String(editor.ignoreFilling));
    root.querySelector<HTMLElement>("[data-follow]")!.setAttribute("aria-pressed", String(editor.followZoom));
    root.querySelector<HTMLElement>("[data-lock]")!.setAttribute("aria-pressed", String(editor.lock !== null));
    const lockR = pq("[data-lock-radius]");
    lockR.setAttribute("aria-pressed", String(editor.lockRadius));
    if (editor.preview.kind === "none") lockR.hidden = !(editor.tool === "select" && actions.selectedCorners() !== null); // (there when a picked shape has corners)
    root.querySelector<HTMLSelectElement>("[data-sample-size]")!.value = String(editor.sampleSize);
    for (const b of root.querySelectorAll<HTMLElement>("[data-sample-layer]")) b.setAttribute("aria-checked", String((b.dataset["sampleLayer"] === "layer") === editor.sampleLayer));
    for (const b of root.querySelectorAll<HTMLElement>("[data-filter]")) {
      b.setAttribute("aria-checked", String(b.dataset["filter"] === editor.lassoFilter));
    }
    root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled = !actions.canUndo();
    root.querySelector<HTMLButtonElement>('[data-action="redo"]')!.disabled = !actions.canRedo();
    // On Select the pen-size slider sets the thickness of selected strokes: with only shapes (or pictures, text) picked it is not theirs to set
    // (a shape's width is in Outline options), so it is not offered.
    const penSize = root.querySelector<HTMLElement>("[data-size]")!.closest<HTMLElement>(".tb-options")!;
    penSize.dataset["for"] = editor.tool === "select" && editor.selection.size > 0 && ![...editor.selection].some((id) => doc.get(id)?.kind === "stroke") ? "pen" : "pen select";
    // One row, one kind at a time (ADR 0128): when the picked items are of different kinds, chips at the start choose which kind's
    // properties the row shows; what is for another kind is switched off, never moved into a menu.
    const picking = (editor.tool === "select" || editor.tool === "node") && editor.preview.kind === "none";
    const kinds = picking ? [...new Set([...editor.selection].flatMap((id) => { const o = doc.get(id); return o ? [kindOf(o)] : []; }))] : [];
    // (`all`, chosen by its chip, shows only what is for any kind in this row; the Actions bar below follows the same choice)
    const chosen = editor.subject === "all" && kinds.length > 1 ? "all" : kinds.includes(editor.subject ?? "") ? editor.subject! : (kinds[0] ?? null);
    const chips = root.querySelector<HTMLElement>(".tb-subject")!;
    const chipHtml = kinds.length > 1 ? ["all", ...kinds].map((k) => `<button type="button" role="radio" class="tb-chip" data-subject="${k}" aria-checked="${k === chosen}" title="${k === "all" ? "Everything picked: the tools for all of it" : `Edit the ${KIND_LABEL[k]!.toLowerCase()} properties of the selection`}">${KIND_LABEL[k]}</button>`).join("") : "";
    if (chips.dataset["html"] !== chipHtml) {
      chips.dataset["html"] = chipHtml;
      chips.innerHTML = chipHtml;
    }
    chips.hidden = !chipHtml;
    if (picking) {
      for (const el of [...root.querySelectorAll<HTMLElement>(".toolbar [data-kind]"), ...pickGroup.querySelectorAll<HTMLElement>("[data-kind]")]) {
        const ks = el.dataset["kind"]!.split(" ");
        el.toggleAttribute("data-off", !(ks.includes("any") || (chosen ? ks.includes(chosen) : ks.includes("tool"))));
      }
    } else for (const el of [...root.querySelectorAll<HTMLElement>(".toolbar [data-off]"), ...pickGroup.querySelectorAll<HTMLElement>("[data-off]")]) el.removeAttribute("data-off");
    // The bar shows what the current tool offers and is gone when there is nothing to show.
    const row = root.querySelector<HTMLElement>(".tb-options-row")!;
    root.querySelector<HTMLElement>("[data-mask-paint]")!.dataset["for"] = editor.maskEdit ? "pen" : ""; // (only while a brush mask is painted)
    for (const b of root.querySelectorAll<HTMLElement>("[data-mask-ink]")) b.setAttribute("aria-pressed", String(b.dataset["maskInk"] !== "done" && editor.maskEdit?.ink === (b.dataset["maskInk"] === "show" ? "#ffffff" : "#000000")));
    const rowTool = editor.editingText ? "text" : editor.tool; // (while a text is typed in, the bar offers the text's options, whatever tool is active)
    syncGroups(row, (g) => g.dataset["for"]!.split(" ").includes(rowTool));
    root.querySelector<HTMLElement>(".toolbar")!.hidden = ![...row.querySelectorAll<HTMLElement>(":scope > .tb-group")].some((g) => !g.hidden);
    syncScroll(row);
    syncGroups(colourBar.row, (g) => g.dataset["for"]!.split(" ").includes(rowTool));
    colourBar.el.hidden = ![...colourBar.row.querySelectorAll<HTMLElement>(":scope > .tb-group")].some((g) => !g.hidden);
    syncScroll(colourBar.row);
    const wrap = document.querySelector(".ctx-wrap");
    if (wrap && pickBar.el.parentElement !== wrap) wrap.append(pickBar.el);
    pickGroup.hidden = ![...pickGroup.children].some((c) => !isOff(c as HTMLElement));
    pickBar.el.hidden = !(rowTool === "select" || rowTool === "node") || editor.selection.size === 0 || pickGroup.hidden;
  };
  editor.subscribe(update);
  doc.subscribe(update);
  phoneWidth.addEventListener("change", () => {
    placeColours();
    update();
  });
  update();
}
