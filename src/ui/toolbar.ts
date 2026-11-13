import { scrubNumbers } from "../colour-picker/scrub";
import { RATIO_PRESETS, formatRatio, parseRatio } from "../app/export-size";
import { esc } from "./format";
import { openMoreMenu } from "./more-menu";
import type { MenuItem } from "./more-menu";
import { createBar, isOff, syncGroups, syncScroll } from "./bar";
import { assignSections } from "./bar-sections";
import { liveNumber } from "./live";
import { isContainer } from "../doc/containers";
import type { CanvasObject, LayoutPatch, SheetLayout } from "../doc/model";
import { LAYOUT_FLOWS } from "../doc/model";
import type { TextLook, lookOf } from "../text/text-style";
import type { AlignChoice, CapChoice, DashChoice, JoinChoice } from "../doc/stroke-look";
import type { EditorState, Tool } from "../app/editor-state";
import { PEN_WIDTHS } from "../app/editor-state";
import type { InLayoutPatch, InLayoutState, PaintPatch } from "../app/actions";
import { layoutTimes } from "../doc/edit-ops";
import { SHAPE_KINDS } from "../doc/path";
import type { Paint } from "../doc/paint";
import { isGradient, paintCss } from "../doc/paint";
import { isTexture } from "../doc/texture";
import type { Arrow, ShapeKind } from "../doc/path";
import type { GradientStop } from "../doc/paint";
import { openColourPopover, openFontOptionsPopover, openOutlinePopover, openPaintPopover, openTextBoxPopover, openTracksPopover } from "./colour-popover";
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
  /** The width ÷ height of the one selected sheet or shape (not a line), or null. */
  sheetRatio(): number | null;
  /** Whether that one is a sheet. */
  ratioOfSheet(): boolean;
  /** The workspace's custom ratios (saved styles of the kind "ratio"), in their order. */
  customRatios(): ReadonlyArray<{ name: string; ratio: number }>;
  /** Save a custom ratio: typed, or a size in px; the selected one's ratio is offered. */
  saveRatio(): void;
  /** Open the custom ratios in the Styles panel (rename, change, update, delete). */
  manageRatios(): void;
  setSheetRatio(ratio: number, final?: boolean): void;
  /** Where the one picked object on a sheet is and how big, in per cent of the sheet (null: none is), and moving or resizing it. */
  boxOnSheet(): { x: number; y: number; w: number; h: number; resizable: boolean } | null;
  moveOnSheet(x: number, y: number, final?: boolean): void;
  /** Whether the picked sheet scales what is on it when it is resized, and the switch for it (a property of the sheet). */
  sheetScale(): boolean;
  /** Auto layout (ADR 0186) of the one picked sheet (null: none, or it has none), with the screen px per unit of the sheet (its lengths are shown in px), and changing it. */
  autoLayout(): { layout: SheetLayout; ppu: number; /** How many items it lays out, and how many columns a grid or masonry has now. */ items: number; columns: number; /** Whether what is on it runs past its edge, across and down (ADR 0196). */ overflow: readonly [boolean, boolean] } | null;
  setAutoLayout(patch: LayoutPatch, final?: boolean): void;
  /** Saved layout styles (lengths in px as seen when saved), and saving one (ADR 0193). */
  layoutStyles(): ReadonlyArray<{ name: string; summary: string; data: SheetLayout }>;
  saveLayoutStyle(layoutPx: SheetLayout): void;
  /** How the first picked thing on a sheet with auto layout takes part in it (null: none is), and changing it. */
  inLayout(): InLayoutState | null;
  setInLayout(patch: InLayoutPatch): void;
  setSheetScale(on: boolean): void;
  resizeOnSheet(w: number, h: number, final?: boolean): void;
  /** Pictures (ADR 0118): crop the picked still, show it whole, and the adjustments of the picked pictures. */
  croppable(): boolean;
  cropped(): boolean;
  uncrop(): void;
  /** Flip the picked pictures (stills, video, GIF) in their boxes, and back. */
  selectedFlip(): { x: boolean; y: boolean } | null;
  flip(axis: "x" | "y"): void;
  unflip(): void;
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
  hasBalloon(): boolean;
  toggleBalloonPanel(): void;
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

const TOOLS: Array<{ tool: Tool; icon: string; label: string; key: string }> = [
  { tool: "hand", icon: ICONS.hand, label: "Hand (pan)", key: "H" },
  { tool: "select", icon: ICONS.pointer, label: "Select", key: "V" },
  { tool: "node", icon: ICONS.nodeTool, label: "Edit nodes", key: "N" },
  { tool: "pen", icon: ICONS.pencil, label: "Pen", key: "P" },
  { tool: "shape", icon: ICONS.shapeTool, label: "Shape and path", key: "U" },
  { tool: "balloon", icon: ICONS.speechBalloon, label: "Speech balloon", key: "K" },
  { tool: "sheet", icon: ICONS.sheetTool, label: "Sheet", key: "C" },
  { tool: "lasso", icon: ICONS.lasso, label: "Lasso", key: "L" },
  { tool: "text", icon: ICONS.type, label: "Text", key: "T" },
  { tool: "note", icon: ICONS.stickyNote, label: "Note", key: "M" },
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

/**
 * The icon a tool shows on the rail (a shape tool: the kind of shape; a pen: the kind of pen): what its cursor carries too. Null for the tools
 * whose cursor is the system's own (the arrow, the hand, the text cursor).
 */
export function toolIcon(tool: Tool, shapeKind: string, penKind: string): string | null {
  if (tool === "select" || tool === "hand" || tool === "text" || tool === "note") return null;
  if (tool === "shape") return SHAPE_MENU.find((s) => s.id === shapeKind)?.icon ?? ICONS.shapeTool;
  if (tool === "pen") return PEN_MENU.find((s) => s.id === penKind)?.icon ?? ICONS.pencil;
  if (tool === "path") return ICONS.pathTool;
  return TOOLS.find((t) => t.tool === tool)?.icon ?? null;
}

export const LAYOUT_MENU: Array<{ head: string; items: Array<{ id: string; label: string; icon: string; hint: string }> }> = [
  {
    head: "Arrange in a grid",
    items: [
      { id: "grid:name-asc", label: "By name, A to Z", hint: "In a grid, by name", icon: ICONS.arrowDownAZ },
      { id: "grid:name-desc", label: "By name, Z to A", hint: "In a grid, by name", icon: ICONS.arrowDownZA },
      { id: "grid:date", label: "By date added, newest first", hint: "In a grid, by date", icon: ICONS.calendarDays },
      { id: "grid:size", label: "By size, largest first", hint: "In a grid, by size", icon: ICONS.rulerIcon },
      { id: "grid:type", label: "By type", hint: "In a grid, by kind", icon: ICONS.fileType },
      { id: "grid:stack", label: "In stacking order", hint: "In a grid, front to back", icon: ICONS.chevronsUpDown },
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

/** The Properties bar, for the ways it can be shown (ui/properties-layout.ts): the bar and its row, a call after every update, and an update. */
export interface PropertiesBar {
  bar: HTMLElement;
  row: HTMLElement;
  /** The bar of the colours of a selection of several shapes (under the Properties bar). */
  colours: HTMLElement;
  onUpdate(fn: () => void): void;
  refresh(): void;
}

export function mountToolbar(root: HTMLElement, editor: EditorState, doc: DocumentStore, actions: ToolbarActions): PropertiesBar {
  root.innerHTML = `
    <div class="rail" data-cmd-group="Tools">
      <!-- What a tool with kinds offers while it is the tool: beside its button, not in the Properties bar -->
      <div class="rail-fly" data-fly="shape" hidden role="radiogroup" aria-label="Shape or path">
        ${SHAPE_MENU.map((k) => `<button type="button" role="radio" class="shape-kind" data-shape-kind="${k.id}" aria-label="${k.label}" title="${k.title}">${k.icon}</button>`).join("")}
        <button type="button" role="radio" class="shape-kind" data-tool="path" aria-label="Path (curves)" title="Path (curves): click corners, drag for a curve, click the first node to close (B)">${ICONS.pathTool}</button>
      </div>
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
        (t) => `<button type="button" role="radio" data-tool="${t.tool}"${t.tool === "shape" || t.tool === "pen" ? ' aria-haspopup="true" aria-expanded="false"' : ""} aria-label="${t.label}" title="${t.label} (${t.key})">${t.icon}</button>${t.tool === "note" ? `<button type="button" data-action="import" aria-label="Import files" title="Import files: pictures, video, audio, or any other file (kept as a card you can download)">${ICONS.arrowDownToLine}</button>` : ""}`,
      ).join("")}
      </div>
      <span class="rail-sep" role="separator"></span>
      <div class="rail-tools" role="group" aria-label="Screenshot and search">
        <button type="button" data-action="screenshot" aria-label="Screenshot" title="Screenshot: save the selection to the library, or the whole view when nothing is selected (format, folder and tags in Settings > Screenshot)">${ICONS.camera}</button>
        <button type="button" data-action="search" aria-label="Search the canvas" title="Search the canvas (Ctrl+F; # tag, @ bookmark)">${ICONS.search}</button>
      </div>
      <input type="file" multiple hidden data-testid="import-input">
    </div>
    <div class="dock" data-cmd-group="Dock" role="toolbar" aria-label="Panels">
      <div class="tb-group">
        <button type="button" class="layers-toggle" data-adjust-panel aria-pressed="false" aria-label="Adjust panel" title="Adjust: show or hide the panel for the exposure, contrast, colour and more of the selected pictures">${ICONS.slidersVertical}</button>
        <button type="button" class="layers-toggle" data-layers aria-pressed="false" aria-label="Layers panel" title="Layers: show or hide the floating Layers panel">${ICONS.layers}</button>
        <button type="button" class="layers-toggle" data-tags aria-pressed="false" aria-label="Tags panel" title="Tags: tag items on this canvas, and rename or delete a tag">${ICONS.tag}</button>
        <button type="button" class="layers-toggle" data-styles aria-pressed="false" aria-label="Styles panel" title="Styles: saved adjustments (and more soon) to apply to the selected items">${ICONS.swatchBook}</button>
        <button type="button" class="layers-toggle" data-pattern-panel aria-pressed="false" aria-label="Pattern panel" title="Pattern: make waves, blobs, tiles and other patterns on a sheet or shape, with settings and a random button">${ICONS.mountainSnow}</button>
        <button type="button" class="layers-toggle" data-bookmarks aria-pressed="false" aria-label="Bookmarks panel" title="Bookmarks: saved places and zooms on this canvas">${ICONS.bookmark}</button>
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
      <div class="tb-group tb-options" data-for="pen" role="group" aria-label="Colour">
        <button type="button" class="swatch swatch-current" data-colour-open aria-haspopup="dialog" aria-expanded="false" aria-label="Pen colour" title="Pen colour: open the colour picker (new text takes it too, until its own colour is set)"><span data-colour-chip></span></button>
      </div>
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
        <button type="button" data-kind="picture" data-flip="x" hidden aria-pressed="false" aria-label="Flip horizontally" title="Flip horizontally: mirror the picture left to right in its box">${ICONS.flipHorizontal}</button>
        <button type="button" data-kind="picture" data-flip="y" hidden aria-pressed="false" aria-label="Flip vertically" title="Flip vertically: mirror the picture top to bottom in its box">${ICONS.flipVertical}</button>
        <button type="button" data-kind="picture" data-unflip hidden aria-label="Reset flip" title="Reset flip: show the picture the right way round again">${ICONS.resetFlip}</button>
        <span class="tb-count" data-kind="any" data-on-sheet hidden title="Where it is on its sheet, in per cent of the sheet: X and Y from its top-left corner, W and H of its width and height">On sheet
          <label>X <input type="number" data-on-x step="any" inputmode="decimal" aria-label="Position from the left of the sheet (per cent of its width)"></label> <label>Y <input type="number" data-on-y step="any" inputmode="decimal" aria-label="Position from the top of the sheet (per cent of its height)"></label>
          <span data-on-size><label>W <input type="number" data-on-w min="0" step="any" inputmode="decimal" aria-label="Width (per cent of the sheet's width)"></label> <label>H <input type="number" data-on-h min="0" step="any" inputmode="decimal" aria-label="Height (per cent of the sheet's height)"></label></span> %</span>
        <span class="tb-count" data-kind="sheet shape" data-sheet-size hidden title="The shape of its box: width ÷ height. A sheet has a shape, not a size; the size is chosen when it is exported (Export in the Actions bar)">
          <label>Ratio <input type="text" data-sheet-ratio size="11" spellcheck="false" autocomplete="off" inputmode="text" aria-label="Shape: width to height, like 16:9, 1.5 or A4" title="Type a ratio (16:9, 3/2, 1.5, A4, letter, square) or a size in px (2000 x 1920, or 2000x1920px, becomes 25 : 24), then Enter. Add portrait or landscape to turn it."></label>
          <select data-sheet-preset aria-label="Shape preset" title="A common shape: the sheet or shape takes it, keeping its area and its top-left corner"><option value="">Shapes…</option><optgroup label="Custom" data-custom-ratios></optgroup>${["Basic", "Screen", "Paper", "Social"].map((g) => `<optgroup label="${g}">${RATIO_PRESETS.filter((r) => r.group === g).map((r) => `<option value="${r.ratio}">${r.label}</option>`).join("")}</optgroup>`).join("")}</select>
          <button type="button" data-sheet-turn aria-label="Turn it on its side: swap its width and height" title="Turn it on its side: portrait ⇄ landscape (the same area)">${ICONS.arrowRightLeft}</button>
          <button type="button" data-sheet-scale aria-pressed="false" aria-label="Scale contents with the sheet" title="Scale contents (kept with this sheet): when the sheet is resized, everything on it grows with it, whatever its pins say">${ICONS.sheetScale}</button></span>
        <span class="tb-count" data-kind="sheet" data-auto-layout hidden title="Auto layout: how what is on the sheet is placed. Lengths in px as seen now">
          <span class="seg" role="radiogroup" aria-label="Flow">${[["row", "Row: items left to right", ICONS.flowRow], ["column", "Column: items top to bottom", ICONS.flowColumn], ["wrap", "Wrap: rows that break at the sheet's width", ICONS.flowWrap], ["grid", "Grid: columns and rows", ICONS.flowGrid], ["masonry", "Masonry: columns of one width, each item in the shortest", ICONS.flowMasonry], ["justified", "Justified rows: each row one height, as wide as the sheet", ICONS.flowJustified]].map(([v, t, i]) => `<button type="button" role="radio" data-layout-flow="${v}" aria-checked="false" aria-label="${t}" title="${t}">${i}</button>`).join("")}</span>
          <label>Gap <input type="number" data-layout-gap="0" min="0" step="any" inputmode="decimal" aria-label="Gap between items along the flow (px)" title="Gap between items along the flow"></label><label><input type="number" data-layout-gap="1" min="0" step="any" inputmode="decimal" aria-label="Gap between lines (px)" title="Gap between lines (a wrap or a grid)"></label>
          <label>Pad <input type="number" data-layout-pad="h" min="0" step="any" inputmode="decimal" aria-label="Padding left and right (px)" title="Padding left and right"></label><label><input type="number" data-layout-pad="v" min="0" step="any" inputmode="decimal" aria-label="Padding top and bottom (px)" title="Padding top and bottom"></label>
          <span data-layout-pad-sides hidden>${[["t", "top"], ["r", "right"], ["b", "bottom"], ["l", "left"]].map(([k, n]) => `<label>${n!.charAt(0).toUpperCase()} <input type="number" data-layout-pad="${k}" min="0" step="any" inputmode="decimal" aria-label="Padding ${n} (px)" title="Padding ${n}"></label>`).join("")}</span>
          <button type="button" data-layout-pad-each aria-pressed="false" aria-label="Padding of each side" title="Padding of each side: top, right, bottom, left">${ICONS.maximize}</button>
          <select data-layout-align aria-label="Items across the flow" title="Items across the flow: at the start, the centre or the end of their line (and the block of lines in a sheet with room for them)"><option value="start">Start</option><option value="centre">Centre</option><option value="end">End</option></select>
          <select data-layout-justify aria-label="Items along the flow" title="Items along the flow, in a sheet with room for them: packed at the start, the centre or the end, or spread between"><option value="start">Pack start</option><option value="centre">Pack centre</option><option value="end">Pack end</option><option value="between">Spread</option></select>
          <label title="The sheet's size: it fits what is on it, or you set its width (or height) and the other side fits, or you set both (what does not fit is cut off at its edge)">Size <select data-layout-size aria-label="Sheet size"><option value="fit">Fits contents</option><option value="w">Set width</option><option value="h">Set height</option><option value="fixed">Set size</option></select></label>
          <button type="button" data-layout-overflow hidden title="Some of what is on the sheet runs past its edge and is cut off: click to make the sheet fit it">Doesn't fit: Fit</button>
          <label data-layout-columns-wrap hidden>Columns <input type="number" data-layout-columns min="1" max="1024" step="1" inputmode="numeric" placeholder="auto" aria-label="Columns" title="Columns of the grid or masonry (empty: chosen as the list beside it says)"></label>
          <select data-layout-colsby hidden aria-label="Columns when none are set" title="Columns when none are set: by the number of items (about as many as rows), or by their shapes (a board about as wide as tall, or one that fills a sheet whose size is set)"><option value="count">Auto: by count</option><option value="shape">Auto: by shape</option></select>
          <button type="button" data-layout-tracks hidden aria-haspopup="dialog" aria-expanded="false" aria-label="Columns and rows" title="Columns and rows: each as large as what is in it, a set size, or a share of the room">${ICONS.layoutTracks}</button>
          <label data-layout-rowh-wrap hidden>Row <input type="number" data-layout-rowh min="1" step="any" inputmode="decimal" aria-label="Row height aimed at (px)" title="The height a row aims at before it is made as wide as the sheet"></label>
          <select data-layout-sort aria-label="Order of the items" title="Order of the items: the stacking order (as Layers lists it), or kept by a rule as things are added"><option value="">Stacking order</option><option value="name-asc">Name A–Z</option><option value="name-desc">Name Z–A</option><option value="date">Newest first</option><option value="size">Largest first</option><option value="type">By kind</option></select>
          <button type="button" data-layout-styles aria-haspopup="menu" aria-label="Layout styles" title="Layout styles: your saved layouts, and save this one">${ICONS.layoutStyles}</button></span>
        <span class="tb-count" data-kind="any" data-in-layout hidden title="How it takes part in its sheet's auto layout">In layout
          <select data-in-fill aria-label="Size in the layout: its own, or stretched to the room" title="Its size in the layout: its own, or stretched to the room along an axis"><option value="none">Own size</option><option value="x">Fill width</option><option value="y">Fill height</option><option value="both">Fill both</option></select>
          <button type="button" data-in-free aria-pressed="false" aria-label="Keep out of the layout" title="Keep out of the layout: it stays where it is put, the others flow round it">${ICONS.layoutFree}</button>
          <span data-in-span-wrap hidden>Span <input type="number" data-in-span="0" min="1" max="1024" step="1" inputmode="numeric" aria-label="Columns it spans" title="Columns it spans"><input type="number" data-in-span="1" min="1" max="1024" step="1" inputmode="numeric" aria-label="Rows it spans" title="Rows it spans"></span>
          <span data-in-limits hidden>${[["0", "W"], ["1", "H"]].map(([i, a]) => `<span data-in-limit-axis="${i}"><label>Min ${a} <input type="number" data-in-min="${i}" min="0" max="100" step="1" inputmode="numeric" aria-label="Least ${a === "W" ? "width" : "height"}, % of the room" title="Its least ${a === "W" ? "width" : "height"} as it fills, in % of the room inside the sheet (0: none)"></label><label>Max ${a} <input type="number" data-in-max="${i}" min="0" max="100" step="1" inputmode="numeric" aria-label="Most ${a === "W" ? "width" : "height"}, % of the room" title="Its most ${a === "W" ? "width" : "height"} as it fills, in % of the room inside the sheet (0: none)"></label></span>`).join("")}</span></span>
        <label class="tb-count" data-kind="shape" data-scrub="inner" data-sel-inner-wrap hidden title="Drag the field left or right to change it">Ratio <input type="number" data-sel-inner min="5" max="95" step="1" inputmode="numeric" aria-label="Star ratio (percent)" title="Inner radius as a percent of the outer one"></label>
      </div>
      <div class="tb-group tb-options" data-for="text note select node" data-kind="text">
        <button type="button" data-balloon-panel hidden aria-label="Speech balloon and text in shape" title="Speech balloon and text in shape: body, tails, words, padding, alignment, connectors">${ICONS.speechBalloon}</button>
        <button type="button" data-text-box data-text-wrap hidden aria-haspopup="dialog" aria-expanded="false" aria-label="Paragraph and box options" title="Paragraph and box: space between paragraphs, first line, case, most lines, set height">${ICONS.textBox}</button>
        <button type="button" class="swatch swatch-paint" data-text-colour data-text-wrap hidden aria-haspopup="dialog" aria-expanded="false" aria-label="Text colour" title="Text colour: open the colour picker (with transparency)"><span data-paint-chip></span></button>
        <label class="tb-count" data-text-wrap hidden title="Font: the bundled one, or a font file from the library (import one here)"><select data-text-font aria-label="Font"></select></label>
        <button type="button" data-text-font-options data-text-wrap hidden aria-haspopup="dialog" aria-expanded="false" aria-label="Font options" title="Font options: kerning, the features of the font (ligatures, small capitals, numerals...) and the axes of a variable font">${ICONS.fontOptions}</button>
        <input type="file" hidden accept=".ttf,.otf,.woff,.woff2" data-testid="font-input">
        <label class="tb-count" data-text-wrap hidden title="Text size, in px at this zoom. Drag the field to change it.">Size <input type="number" data-text-size min="1" max="2000" step="any" inputmode="decimal" aria-label="Text size (px at this zoom)"></label>
        <button type="button" class="swatch swatch-paint" data-text-outline data-text-wrap hidden aria-haspopup="dialog" aria-expanded="false" aria-label="Text outline" title="Text outline: the colour of the line round the letters (none to take it away)"><span data-paint-chip></span></button>
        <label class="tb-count" data-text-wrap hidden title="Outline width, in px at this zoom (0: none)">Outline <input type="number" data-text-outline-w min="0" max="2000" step="any" inputmode="decimal" aria-label="Text outline width (px at this zoom)"></label>
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
      <div class="tb-group tb-options" data-for="shape balloon path select node" data-kind="shape sheet picture">
        <button type="button" data-balloon-panel hidden aria-label="Speech balloon and text in shape" title="Speech balloon and text in shape: body, tails, words, padding, alignment, connectors">${ICONS.speechBalloon}</button>
        <button type="button" class="swatch swatch-paint" data-kind="shape sheet" data-paint="fill" aria-haspopup="dialog" aria-expanded="false" aria-label="Fill" title="Fill colour: open the colour picker"><span data-paint-chip></span><b class="swatch-name">Fill</b></button>
        <button type="button" class="swatch swatch-paint" data-paint="stroke" aria-haspopup="dialog" aria-expanded="false" aria-label="Outline" title="Outline colour: open the colour picker"><span data-paint-chip></span><b class="swatch-name">Outline</b></button>
      <label class="tb-count" data-scrub="outline-w" data-outline-w-wrap hidden title="Outline width, in px at this zoom (0: none). Drag the field left or right to change it">Width <input type="number" data-outline-w min="0" step="0.5" inputmode="decimal" aria-label="Outline width (px at this zoom)"></label>
      <button type="button" class="swatch swatch-outline" data-outline-options aria-haspopup="dialog" aria-expanded="false" aria-label="Outline options" title="Outline options: width, position (inside, centre, outside), corners and ends">${ICONS.outlineOptions}</button>
      </div>
      <div class="tb-group tb-options" data-for="shape balloon path">
        <input type="range" class="size" data-shape-width min="0" max="100" step="1" aria-label="Outline width" title="Outline width (screen px at this zoom); all the way left: no outline">
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
      <div class="tb-group tb-options" data-for="select node" role="group" aria-label="Select options">
        <button type="button" class="snap" data-kind="tool" data-ignore-fill aria-pressed="false" aria-label="Ignore the object that fills the view" title="Ignore the object that fills the view: zoomed far into an object it cannot be selected or deleted by accident">${ICONS.pointerBan}</button>
      </div>
      <div class="tb-group tb-options" data-for="eraser" role="group" aria-label="Size">
        <input type="range" class="size" data-eraser-size min="4" max="128" step="1" aria-label="Eraser size" title="Eraser diameter (screen px)">
        <span class="size-out" data-eraser-out></span>
        <button type="button" class="snap" data-erase-parts aria-pressed="false" aria-label="Erase parts of strokes" title="On: the eraser cuts out only what it sweeps over of a freehand stroke. Off: it takes whole objects.">${ICONS.scissors}</button>
        <button type="button" class="snap" data-erase-groups aria-pressed="true" aria-label="Erase whole groups" title="On: a swipe takes a group as one object. Off: it takes only the members it touches.">${ICONS.shapes}</button>
      </div>
      <div class="tb-group tb-options" data-for="lasso" role="radiogroup" aria-label="Lasso selects">
        <button type="button" role="radio" data-filter="strokes" title="Lasso selects strokes only">Strokes</button>
        <button type="button" role="radio" data-filter="all" title="Lasso selects strokes and fully enclosed media">All</button>
      </div>
      </div>
    </div>
  `;
  // The Properties bar may be placed outside this root (in a chip's popover, the Properties panel or beside the selection: ui/properties-layout.ts):
  // its controls are found, and its events heard, wherever it is.
  // (the same holds for the bar of the colours of a selection, made just below: `own` lists both)
  const barEl = root.querySelector<HTMLElement>(".toolbar")!;
  const barRow = barEl.querySelector<HTMLElement>(".tb-options-row")!;
  const own: HTMLElement[] = [barEl];
  const away = (): HTMLElement[] => own.filter((el) => !root.contains(el));
  function q<E extends Element = Element>(sel: string): E | null {
    return root.querySelector<E>(sel) ?? away().map((el) => el.querySelector<E>(sel)).find((e) => e) ?? null;
  }
  function qa<E extends Element = Element>(sel: string): E[] {
    return [...root.querySelectorAll<E>(sel), ...away().flatMap((el) => [...el.querySelectorAll<E>(sel)])];
  }
  function listen<K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, capture = false): void {
    root.addEventListener(type, fn, capture);
    for (const el of own) el.addEventListener(type, (e) => { if (!root.contains(el)) fn(e); }, capture);
  }
  // Each control's section (ADR 0198), for the ways the bar can be shown (value chips, the Properties panel, beside the selection): a control's
  // own, else its group's.
  assignSections(barRow, [
    ["[data-sel-radius-wrap], [data-sel-smooth-wrap], [data-sel-sides-wrap], [data-sel-tips-wrap], [data-sel-inner-wrap]", "shape"],
    ["[data-pin-wrap], [data-on-sheet]", "position"],
    ["[data-crop], [data-uncrop], [data-flip], [data-unflip]", "picture"],
    ["[data-sheet-size]", "size"],
    ["[data-auto-layout] > label:has([data-layout-gap]), [data-auto-layout] > label:has([data-layout-pad]), [data-layout-pad-sides], [data-layout-pad-each]", "spacing"],
    ["[data-layout-columns-wrap], [data-layout-colsby], [data-layout-tracks], [data-layout-rowh-wrap], [data-layout-sort]", "columns"],
    ["[data-auto-layout]", "layout"],
    ["[data-in-layout]", "inlayout"],
    [".tb-subject", "kind"],
    ["[data-mask-paint]", "mask"],
    ['.tb-group[data-for="pen"][aria-label="Colour"]', "look"],
    ['.tb-group[data-for="shape"]', "shape"],
    // (Text is three chips: the font, the outline round the letters, the paragraph)
    ["[data-text-outline], label:has([data-text-outline-w])", "textoutline"],
    ['label:has([data-text-line]), label:has([data-text-track]), [data-text-box], .tb-group[data-kind="text"][role="radiogroup"]', "paragraph"],
    ['.tb-group[data-kind="text"]', "text"],
    ['.tb-group[data-for="shape balloon path select node"]', "look"],
    ['.tb-group[data-for="shape balloon path"]', "look"],
    ['.tb-group[aria-label="Size"][data-for="pen select"], .tb-group[aria-label="Smooth"], .tb-group[aria-label="Keep size"]', "brush"],
    ['.tb-group[data-for="eraser"]', "eraser"],
    ['.tb-group[data-for="lasso"]', "lasso"],
  ]);
  // The colours of a selection are a second bar of their own, just under this one (the same bar component, ADR 0128).
  const colourBar = createBar("Colours of the selection", "Colours");
  own.push(colourBar.el);
  colourBar.row.append(q("[data-sel-colours]")!);
  // The Outline options button sits beside the Outline colour: in this bar, after the chips, when several shapes are picked.
  const outlineBtn = q<HTMLElement>("[data-outline-options]")!;
  // (the outline's width beside it, between the Outline colour and its options: the quick way to the width every outline has)
  const outlineW = q<HTMLElement>("[data-outline-w-wrap]")!;
  const outlineWInput = outlineW.querySelector<HTMLInputElement>("input")!;
  const outlineHome = outlineBtn.parentElement!;
  barEl.after(colourBar.el);
  // On a phone the colours of the selection share the row of the Properties bar (one row less at the top); wider, they are a bar of their own under it.
  const phoneWidth = window.matchMedia("(max-width: 640px)");
  const placeColours = (): void => {
    const group = q<HTMLElement>("[data-sel-colours]")!;
    const home = phoneWidth.matches ? barRow : colourBar.row;
    if (group.parentElement !== home) home.append(group);
  };
  placeColours();
  // The corner-radius lock, snap and the axis-aligned box are a bar of their own beside the Actions bar. It joins that bar's wrapper (the same parent, so the
  // two line up) in `update`, once the Actions bar exists (it is mounted after this one); its clicks are handled here.
  const pickBar = createBar("Selection options", "Selection");
  const pickGroup = q<HTMLElement>('.tb-group[aria-label="Selection options"]')!;
  pickGroup.prepend(q("[data-lock-radius]")!); // (the lock of the corner radius is one of them: it is about how a shape resizes)
  pickBar.row.append(pickGroup);
  const pq = (sel: string): HTMLElement => pickGroup.querySelector<HTMLElement>(sel)!;
  const input = q<HTMLInputElement>("input[type=file]")!;
  input.addEventListener("change", () => {
    if (input.files?.length) actions.importFiles([...input.files]);
    input.value = "";
  });

  // Continuous pen size: a new size is the new lock reference, like a preset.
  q<HTMLInputElement>("[data-size]")!.addEventListener("input", (e) => {
    editor.penWidthPx = penFromSlider(Number((e.target as HTMLInputElement).value));
    if (editor.lock) editor.lock = { ...actions.depth(), px: editor.penWidthPx };
    if (editor.tool === "select") actions.setSelectedWidth(editor.penWidthPx, false); // live: the selected strokes follow the slider
    editor.changed();
  });

  // On Select the slider also sets the selected strokes' thickness, once on release (one undo step).
  q<HTMLInputElement>("[data-size]")!.addEventListener("change", () => {
    if (editor.tool === "select") actions.setSelectedWidth(editor.penWidthPx, true);
  });

  scrubNumbers(barEl); // (the bar's own: it works wherever the bar is placed)
  // As the Width field of the outline options: the far left is no outline (the width is kept), any other place a width that turns one on.
  q<HTMLInputElement>("[data-shape-width]")!.addEventListener("input", (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (v === 0) editor.shapeStroke = null;
    else {
      editor.shapeWidthPx = penFromSlider(v);
      if (editor.shapeStroke === null && editor.shapeKind !== "line") editor.shapeStroke = "#1f2329";
    }
    editor.changed();
  });
  q<HTMLInputElement>("[data-sides]")!.addEventListener("input", (e) => {
    const v = Math.round(Number((e.target as HTMLInputElement).value));
    if (v >= 3 && v <= 24) {
      editor.shapeSides = v;
      editor.changed();
    }
  });
  q<HTMLInputElement>("[data-tips]")!.addEventListener("input", (e) => {
    const v = Math.round(Number((e.target as HTMLInputElement).value));
    if (v >= 3 && v <= 24) {
      editor.shapeTips = v;
      editor.changed();
    }
  });

  // The fill and outline chips: the colours the next shape gets (Shape and Path tools), or those of the selected paths.
  const editsSelection = (): boolean => editor.editsSelection;
  const paintNow = (which: "fill" | "stroke"): Paint | null => (editsSelection() ? (actions.selectedPaint()?.[which] ?? null) : which === "fill" ? editor.shapeFill : editor.shapeStroke);
  const setPaint = (which: "fill" | "stroke", value: Paint | null, final: boolean): void => {
    if (editsSelection()) actions.paintSelected({ [which]: value }, final);
    // (what the tool has just made is edited, and its colour is also the tool's for the next one: ADR 0198)
    if (editsSelection() && !(final && editor.editsMade)) return;
    {
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
    liveNumber(q<HTMLInputElement>(sel)!, (v, final) => {
      const change = apply(v);
      if (change) actions.shapeSelected(change, final);
    });
  };
  // (one value, or one for every corner)
  const radiusInput = q<HTMLInputElement>("[data-sel-radius]")!;
  const radiusApply = (final: boolean): void => {
    const parts = radiusInput.value.trim().split(/[\s,]+/).map(Number);
    if (parts.every((v) => Number.isFinite(v) && v >= 0) && (parts.length === 1 || parts.length === actions.selectedCorners()?.nodes)) actions.cornersSelected(parts, final);
  };
  radiusInput.addEventListener("input", () => radiusApply(false));
  radiusInput.addEventListener("change", () => radiusApply(true));
  // The font list is read from the library when the menu is opened (and after an import); the selected font is always shown.
  const fontSelect = q<HTMLSelectElement>("[data-text-font]")!;
  const fontInput = q<HTMLInputElement>("[data-testid=font-input]")!;
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
  liveNumber(q<HTMLInputElement>("[data-text-size]")!, (v, final) => v > 0 && actions.setTextStyle({ sizePx: v }, final));
  // (these buttons keep the focus where it is, so a text being edited stays open and takes the change)
  for (const b of qa<HTMLElement>("[data-text-align], [data-text-fit]")) b.addEventListener("mousedown", (e) => e.preventDefault());
  for (const b of qa<HTMLElement>("[data-text-align]")) b.addEventListener("click", () => actions.setTextStyle({ align: b.dataset["textAlign"] as "left" }));
  for (const b of qa<HTMLElement>("[data-text-fit]")) b.addEventListener("click", () => actions.setTextStyle({ autoWidth: b.dataset["textFit"] === "width" }));
  q<HTMLElement>("[data-text-colour]")!.addEventListener("click", (e) => {
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
  q<HTMLElement>("[data-text-outline]")!.addEventListener("click", (e) => {
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
  liveNumber(q<HTMLInputElement>("[data-text-outline-w]")!, (v, final) => {
    const t = actions.selectedTextStyle();
    actions.setTextStyle({ outline: v > 0 ? { c: t?.outline?.c ?? t?.color ?? "#000000", w: outlineWidthEm(v) } : null }, final);
  });
  q<HTMLElement>("[data-text-font-options]")!.addEventListener("click", (e) => {
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
  for (const b of qa<HTMLElement>("[data-balloon-panel]")) b.addEventListener("click", () => actions.toggleBalloonPanel());
  q<HTMLElement>("[data-text-box]")!.addEventListener("click", (e) => {
    const t = actions.selectedTextStyle();
    if (!t) return;
    openTextBoxPopover(e.currentTarget as HTMLElement, {
      paraGap: t.paraGap, indent: t.indent, caps: t.caps, maxLines: t.maxLines, heightPx: t.heightPx, valign: t.valign, card: t.card, pathOpts: t.pathOpts, shapeOpts: t.shapeOpts,
      onChange: (patch, final) => actions.setTextStyle(patch, final),
    });
  });
  liveNumber(q<HTMLInputElement>("[data-text-line]")!, (v, final) => actions.setTextStyle({ lineHeight: v }, final));
  liveNumber(q<HTMLInputElement>("[data-text-track]")!, (v, final) => actions.setTextStyle({ tracking: v / 100 }, final));
  q<HTMLSelectElement>("[data-pin-h]")!.addEventListener("change", (e) => actions.setPin({ h: (e.target as HTMLSelectElement).value }));
  q<HTMLSelectElement>("[data-pin-v]")!.addEventListener("change", (e) => actions.setPin({ v: (e.target as HTMLSelectElement).value }));
  const sheetField = (sel: string): HTMLInputElement => q<HTMLInputElement>(sel)!;
  const onSheet = (sel: string): HTMLInputElement => q<HTMLInputElement>(sel)!;
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
  // The custom ratios lead the list, with saving one and managing them; the built-in ones follow as they are.
  const customGroup = q<HTMLOptGroupElement>("[data-custom-ratios]")!;
  const showCustom = (): void => {
    const list = actions.customRatios();
    const html = `${list.map((c) => `<option value="c:${c.ratio}">${esc(c.name)} ${esc(formatRatio(c.ratio))}</option>`).join("")}<option value="save">Save this ratio…</option>${list.length ? `<option value="manage">Manage custom ratios…</option>` : ""}`;
    if (customGroup.dataset["html"] !== html) {
      customGroup.dataset["html"] = html;
      customGroup.innerHTML = html;
    }
  };
  sheetField("[data-sheet-preset]").addEventListener("change", (e) => {
    const sel = e.target as HTMLSelectElement;
    const pick = sel.value;
    sel.value = "";
    if (pick === "save") return actions.saveRatio();
    if (pick === "manage") return actions.manageRatios();
    // (a custom ratio is given as it was saved, upright or on its side)
    if (pick.startsWith("c:")) return actions.setSheetRatio(Number(pick.slice(2)), true);
    const r = Number(pick);
    const now = actions.sheetRatio();
    if (r > 0 && now !== null) actions.setSheetRatio(now < 1 ? 1 / r : r, true); // (a sheet on its side stays on its side)
  });
  q<HTMLElement>("[data-sheet-turn]")!.addEventListener("click", () => {
    const now = actions.sheetRatio();
    if (now !== null) actions.setSheetRatio(1 / now, true);
  });
  q<HTMLElement>("[data-sheet-scale]")!.addEventListener("click", () => {
    actions.setSheetScale(!actions.sheetScale());
  });
  // Auto layout (ADR 0186): the flow, the gap and padding (typed in px as seen now, kept in the sheet's units), the alignment, hugging, columns.
  const layoutEl = <T extends HTMLElement>(sel: string): T => q<T>(`[data-auto-layout] ${sel}`)!;
  const toUnits = (px: number): number => { const al = actions.autoLayout(); return al && al.ppu > 0 && al.ppu < Infinity ? Math.max(0, px) / al.ppu : NaN; };
  for (const b of qa<HTMLElement>("[data-layout-flow]")) b.addEventListener("click", () => actions.setAutoLayout({ flow: b.dataset["layoutFlow"] as SheetLayout["flow"] }));
  for (const i of [0, 1] as const) liveNumber(layoutEl(`[data-layout-gap="${i}"]`), (v, final) => { const al = actions.autoLayout(), u = toUnits(v); if (al && Number.isFinite(u)) actions.setAutoLayout({ gap: i === 0 ? [u, al.layout.gap[1]] : [al.layout.gap[0], u] }, final); });
  const PAD: Record<string, number[]> = { t: [0], r: [1], b: [2], l: [3], h: [1, 3], v: [0, 2] };
  for (const [k, at] of Object.entries(PAD)) liveNumber(layoutEl(`[data-layout-pad="${k}"]`), (v, final) => {
    const al = actions.autoLayout(), u = toUnits(v);
    if (!al || !Number.isFinite(u)) return;
    const pad = [...al.layout.pad] as [number, number, number, number];
    for (const i of at) pad[i] = u;
    actions.setAutoLayout({ pad }, final);
  });
  layoutEl<HTMLElement>("[data-layout-pad-each]").addEventListener("click", (e) => {
    const b = e.currentTarget as HTMLElement;
    b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
    editor.changed(); // (the bar is drawn again: the fields of each side show or go)
  });
  layoutEl<HTMLSelectElement>("[data-layout-align]").addEventListener("change", (e) => actions.setAutoLayout({ align: (e.target as HTMLSelectElement).value as SheetLayout["align"] }));
  layoutEl<HTMLSelectElement>("[data-layout-justify]").addEventListener("change", (e) => actions.setAutoLayout({ justify: (e.target as HTMLSelectElement).value as SheetLayout["justify"] }));
  layoutEl<HTMLSelectElement>("[data-layout-size]").addEventListener("change", (e) => {
    const v = (e.target as HTMLSelectElement).value;
    actions.setAutoLayout({ hug: v === "fit" ? [true, true] : v === "w" ? [false, true] : v === "h" ? [true, false] : [false, false] });
  });
  layoutEl<HTMLElement>("[data-layout-overflow]").addEventListener("click", () => {
    const al = actions.autoLayout();
    if (al) actions.setAutoLayout({ hug: [al.layout.hug[0] || al.overflow[0], al.layout.hug[1] || al.overflow[1]] });
  });
  liveNumber(layoutEl("[data-layout-columns]"), (v, final) => { if (final) actions.setAutoLayout(Number.isFinite(v) && v >= 1 ? { columns: Math.round(v) } : { columns: undefined, cols: undefined }); }, Number, true);
  layoutEl<HTMLSelectElement>("[data-layout-colsby]").addEventListener("change", (e) => actions.setAutoLayout({ columnsBy: (e.target as HTMLSelectElement).value as "count" | "shape" }));
  liveNumber(layoutEl("[data-layout-rowh]"), (v, final) => { const u = toUnits(v); if (Number.isFinite(u) && u > 0) actions.setAutoLayout({ rowHeight: u }, final); });
  layoutEl<HTMLSelectElement>("[data-layout-sort]").addEventListener("change", (e) => { const v = (e.target as HTMLSelectElement).value; actions.setAutoLayout({ sort: v ? (v as SheetLayout["sort"]) : undefined }); });
  layoutEl<HTMLElement>("[data-layout-tracks]").addEventListener("click", (e) => {
    const al = actions.autoLayout();
    if (!al) return;
    const n = al.layout.cols?.length || al.layout.columns || al.columns;
    openTracksPopover(e.currentTarget as HTMLElement, {
      cols: al.layout.cols ?? Array.from({ length: Math.max(1, n) }, () => ({ size: "hug" as const })),
      rows: al.layout.rows ?? [],
      ppu: al.ppu,
      onChange: (cols, rows, final) => actions.setAutoLayout({ cols, columns: cols.length, ...(rows.length ? { rows } : { rows: undefined }) }, final),
    });
  });
  // Layout styles (ADR 0193): kept in px as seen when saved, given in px as seen now, as the numbers of the bar are.
  layoutEl<HTMLElement>("[data-layout-styles]").addEventListener("click", (e) => {
    const al = actions.autoLayout();
    if (!al || !(al.ppu > 0 && al.ppu < Infinity)) return;
    const saved = actions.layoutStyles();
    openMoreMenu(e.currentTarget as HTMLElement, [
      ...saved.map((st): MenuItem => ({ label: st.name, hint: st.summary, icon: ICONS.layoutStyles, run: () => actions.setAutoLayout(layoutTimes(st.data, 1 / al.ppu, 1 / al.ppu)) })),
      ...(saved.length ? [] : [{ label: "No layout styles yet", hint: "Save this one with the row below", icon: ICONS.layoutStyles, disabled: true, run: () => undefined } satisfies MenuItem]),
      { label: "Save this layout as a style", hint: "Kept in Styles, for any sheet", icon: ICONS.save, sep: true, run: () => actions.saveLayoutStyle(layoutTimes(al.layout, al.ppu, al.ppu)) },
    ], "Layout styles");
  });
  for (const i of [0, 1] as const) liveNumber(q<HTMLInputElement>(`[data-in-span="${i}"]`)!, (v, final) => {
    const il = actions.inLayout();
    if (!final || !il || !(v >= 1)) return;
    actions.setInLayout({ span: i === 0 ? [Math.round(v), il.span[1]] : [il.span[0], Math.round(v)] });
  });
  for (const k of ["min", "max"] as const) for (const i of [0, 1] as const) liveNumber(q<HTMLInputElement>(`[data-in-${k}="${i}"]`)!, (v, final) => {
    const il = actions.inLayout();
    if (!final || !il || !(v >= 0)) return;
    const pair = [...il[k]] as [number, number];
    pair[i] = Math.min(100, v) / 100;
    actions.setInLayout({ [k]: pair });
  });
  q<HTMLSelectElement>("[data-in-fill]")!.addEventListener("change", (e) => actions.setInLayout({ fill: (e.target as HTMLSelectElement).value as "none" | "x" | "y" | "both" }));
  q<HTMLElement>("[data-in-free]")!.addEventListener("click", () => { const il = actions.inLayout(); if (il) actions.setInLayout({ free: !il.free }); });
  q<HTMLElement>("[data-crop]")!.addEventListener("click", () => {
    const id = [...editor.selection][0];
    editor.cropId = editor.cropId ? null : (id ?? null);
    editor.changed();
  });
  q<HTMLElement>("[data-uncrop]")!.addEventListener("click", () => actions.uncrop());
  for (const b of qa<HTMLElement>("[data-flip]")) b.addEventListener("click", () => actions.flip(b.dataset["flip"] as "x" | "y"));
  q<HTMLElement>("[data-unflip]")!.addEventListener("click", () => actions.unflip());
  shapeInput("[data-sel-sides]", (v) => (v >= 3 && v <= 24 ? { sides: Math.round(v) } : null));
  shapeInput("[data-sel-tips]", (v) => (v >= 3 && v <= 24 ? { tips: Math.round(v) } : null));
  liveNumber(q<HTMLInputElement>("[data-sel-smooth]")!, (v, final) => v >= 0 && v <= 100 && actions.setSmoothing(v, final));
  liveNumber(outlineWInput, (v, final) => v >= 0 && actions.setSelectedWidth(v, final));
  shapeInput("[data-sel-inner]", (v) => (v >= 5 && v <= 95 ? { inner: v / 100 } : null));

  // Drag a number's field to change it, live (one undo step when released): the quick way to a radius, a count, a ratio.
  const scrubs: Record<string, { to(start: number, dx: number): number; apply(v: number, final: boolean): void }> = {
    radius: { to: (v, dx) => Math.max(0, v + dx), apply: (v, f) => actions.cornersSelected([v], f) },
    smooth: { to: (v, dx) => Math.max(0, Math.min(100, Math.round(v + dx / 2))), apply: (v, f) => actions.setSmoothing(v, f) },
    sides: { to: (v, dx) => Math.max(3, Math.min(24, Math.round(v + dx / 12))), apply: (v, f) => actions.shapeSelected({ sides: v }, f) },
    tips: { to: (v, dx) => Math.max(3, Math.min(24, Math.round(v + dx / 12))), apply: (v, f) => actions.shapeSelected({ tips: v }, f) },
    inner: { to: (v, dx) => Math.max(5, Math.min(95, Math.round(v + dx / 2))), apply: (v, f) => actions.shapeSelected({ inner: v / 100 }, f) },
    "outline-w": { to: (v, dx) => Math.max(0, Math.round((v + dx / 4) * 2) / 2), apply: (v, f) => actions.setSelectedWidth(v, f) },
  };
  let scrub: { label: HTMLElement; input: HTMLInputElement; key: string; start: number; x: number; moved: boolean; last: number } | null = null;
  listen("pointerdown", (e) => {
    const label = (e.target as HTMLElement).closest<HTMLElement>("[data-scrub]");
    if (!label || e.button !== 0 || (e.target as HTMLElement).tagName !== "INPUT") return; // (the field scrubs, under a finger too; its name is only a label, so a bar that scrolls sideways scrolls from it)
    const input = label.querySelector<HTMLInputElement>("input")!;
    if ((e.target as HTMLElement).tagName === "INPUT" && document.activeElement === input) return; // (being typed in)
    scrub = { label, input, key: label.dataset["scrub"]!, start: parseFloat(input.value) || 0, x: e.clientX, moved: false, last: NaN };
    label.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  listen("pointermove", (e) => {
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
  listen("click", (e) => {
    if (dragged && (e.target as HTMLElement).closest("[data-scrub]") && (e.target as HTMLElement).tagName !== "INPUT") e.preventDefault();
    dragged = false;
  }, true);
  listen("pointerup", (e) => {
    dragged = scrub?.moved ?? false;
    endScrub(e, false);
  });
  listen("pointercancel", (e) => endScrub(e, true));

  /** The tool whose kinds were closed by pressing its own button (until the tool changes). */
  let flyShut: "shape" | "pen" | null = null;
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
  listen("pointerover", (e) => { if ((e.target as HTMLElement).closest("[data-sel-colour]")) light(e); });
  listen("pointerout", (e) => { if ((e.target as HTMLElement).closest("[data-sel-colour]") && editor.highlight) { editor.highlight = null; editor.changed(); } });
  listen("focusin", (e) => { if ((e.target as HTMLElement).closest("[data-sel-colour]")) light(e); });
  listen("focusout", () => { if (editor.highlight) { editor.highlight = null; editor.changed(); } });
  const openOutline = (anchor: HTMLElement): void => {
    const sel = editsSelection() ? actions.selectedOutline() : null;
    if (editsSelection() && !sel) return;
    openOutlinePopover(anchor, {
      widthPx: sel ? sel.widthPx : editor.shapeStroke === null && editor.shapeKind !== "line" ? 0 : editor.shapeWidthPx,
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

  q<HTMLInputElement>("[data-eraser-size]")!.addEventListener("input", (e) => {
    editor.eraserPx = Number((e.target as HTMLInputElement).value);
    editor.changed();
  });

  q<HTMLInputElement>("[data-strength]")!.addEventListener("input", (e) => {
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
      // the button of a tool with kinds (Shape, Pen), pressed while it is the tool, closes its kinds; pressed again, opens them
      const t = d["tool"] as Tool;
      const fam = t === "shape" ? "shape" : t === "pen" ? "pen" : null;
      const same = fam !== null && !!b.closest(".rail") && (fam === "shape" ? editor.tool === "shape" || editor.tool === "path" : editor.tool === "pen");
      flyShut = same ? (flyShut === fam ? null : fam) : null;
      editor.setTool(t);
      editor.changed();
    } else if (d["color"]) {
      editor.penColor = d["color"];
      editor.changed();
    } else if (d["shapeKind"]) {
      editor.shapeKind = d["shapeKind"] as typeof editor.shapeKind;
      editor.made.clear(); // (another kind: the next shape is being prepared, its options are the tool's: ADR 0198)
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
    } else if (d["filter"]) {
      editor.lassoFilter = d["filter"] as "strokes" | "all";
      editor.changed();
    } else if (d["action"] === "import") input.click();
    else if (d["action"] === "search") actions.openSearch("");
    else if (d["action"] === "screenshot") actions.screenshot();
    else if (d["action"] === "undo") actions.undo();
    else if (d["action"] === "redo") actions.redo();
  };
  listen("click", onClick);
  pickGroup.addEventListener("click", onClick);

  const update = (): void => {
    for (const b of qa<HTMLElement>("[data-tool]")) {
      // (Shape and Path are one place on the rail: the Shape button stays lit on the Path tool, which is chosen in the options beside the shapes)
      const on = b.dataset["tool"] === editor.tool || (b.dataset["tool"] === "shape" && editor.tool === "path" && !b.closest(".tb-options"));
      b.setAttribute("aria-checked", String(on));
    }
    // The tools with kinds: their kinds open beside the button while the tool is active, and the button wears the icon of the kind in use.
    const flyAt = (name: "shape" | "pen", tool: string, on: boolean, icon: string): void => {
      const fly = q<HTMLElement>(`[data-fly="${name}"]`)!;
      const btn = q<HTMLElement>(`.rail [data-tool="${tool}"]`)!;
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
    for (const b of qa<HTMLElement>("[data-pen-kind]")) b.setAttribute("aria-checked", String(b.dataset["penKind"] === editor.penKind));
    q<HTMLElement>("[data-colour-chip]")!.style.background = newInk(editor.penColor);
    for (const b of qa<HTMLElement>("[data-shape-kind]")) b.setAttribute("aria-checked", String(editor.tool === "shape" && b.dataset["shapeKind"] === editor.shapeKind));
    const sides = q<HTMLInputElement>("[data-sides]")!;
    const tips = q<HTMLInputElement>("[data-tips]")!;
    q<HTMLElement>("[data-sides-wrap]")!.hidden = editor.shapeKind !== "polygon";
    q<HTMLElement>("[data-tips-wrap]")!.hidden = editor.shapeKind !== "star";
    if (document.activeElement !== sides) sides.value = String(editor.shapeSides);
    if (document.activeElement !== tips) tips.value = String(editor.shapeTips);
    const pick = editor.editsSelection;
    const still = !editor.gesturing;
    for (const b of qa<HTMLElement>("[data-balloon-panel]")) b.hidden = !(pick && still && actions.hasBalloon());
    // (a field is left as it is while it is typed in, and while a value from one is being shown: the document has the old number until it is settled)
    const free = (el: Element): boolean => document.activeElement !== el && editor.preview.kind !== "replace"; // (not while something is being dragged: the numbers wait for it to end)
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
    const txt = (pick && still) || editor.editingText || editor.tool === "text" ? actions.selectedTextStyle() : null;
    for (const w of qa<HTMLElement>("[data-text-wrap]")) w.hidden = !txt;
    if (txt) {
      wantFonts(txt.assetId ?? "");
      if (free(fontSelect)) paintFonts();
      const size = q<HTMLInputElement>("[data-text-size]")!;
      if (free(size)) size.value = txt.sizePx === null ? "" : String(Math.round(txt.sizePx * 100) / 100);
      for (const b of qa<HTMLElement>("[data-text-align]")) b.setAttribute("aria-checked", String(b.dataset["textAlign"] === txt.align));
      for (const b of qa<HTMLElement>("[data-text-fit]")) b.setAttribute("aria-checked", String((b.dataset["textFit"] === "width") === txt.autoWidth));
      q<HTMLElement>("[data-text-colour] [data-paint-chip]")!.style.background = txt.gradient ? paintCss(txt.gradient) : swatchBackground(txt.color);
      q<HTMLElement>("[data-text-outline] [data-paint-chip]")!.style.background = txt.outline ? swatchBackground(txt.outline.c) : "transparent";
      const ow = q<HTMLInputElement>("[data-text-outline-w]")!;
      if (free(ow)) ow.value = txt.outline && txt.sizePx !== null ? String(Math.round(txt.outline.w * txt.sizePx * 100) / 100) : "0";
      const line = q<HTMLInputElement>("[data-text-line]")!, track = q<HTMLInputElement>("[data-text-track]")!;
      if (free(line)) line.value = String(Math.round(txt.lineHeight * 100) / 100);
      if (free(track)) track.value = String(Math.round(txt.tracking * 100));
    }
    const pin = pick && still ? actions.selectedPin() : null;
    q<HTMLElement>("[data-pin-wrap]")!.hidden = !pin;
    if (pin) {
      const h = q<HTMLSelectElement>("[data-pin-h]")!, v = q<HTMLSelectElement>("[data-pin-v]")!;
      if (free(h)) h.value = pin.h;
      if (free(v)) v.value = pin.v;
    }
    const crop = q<HTMLElement>("[data-crop]")!;
    crop.hidden = !(pick && still && actions.croppable());
    crop.setAttribute("aria-pressed", String(editor.cropId !== null));
    // A dot on the button says the picture already has it (and the label says so for a screen reader).
    const cropped = pick && still && actions.cropped();
    crop.classList.toggle("is-applied", cropped);
    crop.setAttribute("aria-label", cropped ? "Crop the picture (cropped)" : "Crop the picture");
    q<HTMLElement>("[data-uncrop]")!.hidden = !(pick && still && actions.cropped());
    const flip = pick && still ? actions.selectedFlip() : null;
    for (const b of qa<HTMLElement>("[data-flip]")) {
      b.hidden = !flip;
      b.setAttribute("aria-pressed", String(!!flip?.[b.dataset["flip"] as "x" | "y"]));
    }
    q<HTMLElement>("[data-unflip]")!.hidden = !(flip && (flip.x || flip.y));
    const on = pick && still ? actions.boxOnSheet() : null;
    q<HTMLElement>("[data-on-sheet]")!.hidden = !on;
    if (on) {
      q<HTMLElement>("[data-on-size]")!.hidden = !on.resizable;
      for (const f of ["[data-on-x]", "[data-on-y]", "[data-on-w]", "[data-on-h]"]) onSheet(f).dataset["scrubStep"] = "0.1"; // (a dragged pixel is a tenth of a per cent)
      for (const [f, v] of [["[data-on-x]", on.x], ["[data-on-y]", on.y], ["[data-on-w]", on.w], ["[data-on-h]", on.h]] as const) {
        const el = onSheet(f);
        if (free(el)) el.value = String(Math.round(v * 100) / 100);
      }
    }
    // Auto layout (ADR 0186): the picked sheet's, in px as seen now
    const al = pick && still ? actions.autoLayout() : null;
    q<HTMLElement>("[data-auto-layout]")!.hidden = !al;
    if (al) {
      const l = al.layout, px = (u: number): string => String(Math.round(u * al.ppu * 10) / 10);
      for (const b of qa<HTMLElement>("[data-layout-flow]")) b.setAttribute("aria-checked", String(b.dataset["layoutFlow"] === l.flow));
      for (const i of [0, 1] as const) { const f = layoutEl<HTMLInputElement>(`[data-layout-gap="${i}"]`); if (free(f)) f.value = px(l.gap[i]); }
      // (each side when they differ, or when asked)
      const eachBtn = layoutEl<HTMLElement>("[data-layout-pad-each]");
      const uneven = l.pad[0] !== l.pad[2] || l.pad[1] !== l.pad[3];
      const each = uneven || eachBtn.getAttribute("aria-pressed") === "true";
      layoutEl<HTMLElement>("[data-layout-pad-sides]").hidden = !each;
      for (const k of ["h", "v"]) layoutEl<HTMLElement>(`[data-layout-pad="${k}"]`).parentElement!.hidden = each;
      eachBtn.setAttribute("aria-pressed", String(each));
      for (const [k, v] of [["t", l.pad[0]], ["r", l.pad[1]], ["b", l.pad[2]], ["l", l.pad[3]], ["h", l.pad[3]], ["v", l.pad[0]]] as const) { const f = layoutEl<HTMLInputElement>(`[data-layout-pad="${k}"]`); if (free(f)) f.value = px(v); }
      layoutEl<HTMLSelectElement>("[data-layout-align]").value = l.align;
      layoutEl<HTMLSelectElement>("[data-layout-justify]").value = l.justify;
      // (the size: fits, one side set (the width, or a column's height), or both set; the other one-side choice only when it is the sheet's)
      const sizeSel = layoutEl<HTMLSelectElement>("[data-layout-size]");
      sizeSel.value = l.hug[0] && l.hug[1] ? "fit" : !l.hug[0] && !l.hug[1] ? "fixed" : l.hug[1] ? "w" : "h";
      for (const o of sizeSel.options) if (o.value === "w" || o.value === "h") o.hidden = o.value !== sizeSel.value && (o.value === "w") === (l.flow === "column");
      layoutEl<HTMLElement>("[data-layout-overflow]").hidden = !(al.overflow[0] || al.overflow[1]);
      layoutEl<HTMLElement>("[data-layout-columns-wrap]").hidden = l.flow !== "grid" && l.flow !== "masonry";
      layoutEl<HTMLElement>("[data-layout-tracks]").hidden = l.flow !== "grid";
      const colsBy = layoutEl<HTMLSelectElement>("[data-layout-colsby]");
      colsBy.hidden = (l.flow !== "grid" && l.flow !== "masonry") || !!(l.cols?.length || l.columns);
      colsBy.value = l.columnsBy ?? "count";
      layoutEl<HTMLElement>("[data-layout-rowh-wrap]").hidden = l.flow !== "justified";
      const rowh = layoutEl<HTMLInputElement>("[data-layout-rowh]");
      if (free(rowh)) rowh.value = l.rowHeight === undefined ? "" : px(l.rowHeight);
      const sortSel = layoutEl<HTMLSelectElement>("[data-layout-sort]");
      sortSel.value = l.sort ?? "";
      const cols = layoutEl<HTMLInputElement>("[data-layout-columns]");
      if (free(cols)) cols.value = l.cols?.length ? String(l.cols.length) : l.columns === undefined ? "" : String(l.columns);
      // (packing along the flow needs room along it: a sheet that fits its contents that way has none, and neither have a masonry's
      // columns, which fill the width: then the choice is not shown, as other choices that do not apply)
      layoutEl<HTMLSelectElement>("[data-layout-justify]").hidden = l.flow === "masonry" || l.hug[l.flow === "column" ? 1 : 0];
      void LAYOUT_FLOWS;
    }
    const il = pick && still ? actions.inLayout() : null;
    q<HTMLElement>("[data-in-layout]")!.hidden = !il;
    if (il) {
      const fill = q<HTMLSelectElement>("[data-in-fill]")!;
      fill.value = il.fill;
      fill.disabled = !il.stretch;
      // (a picture keeps its shape: it fills the room as far as its shape allows, so only Own size and Fill the room are offered)
      for (const o of fill.options) if (o.value === "x" || o.value === "y") o.hidden = il.keepShape && o.value !== il.fill;
      fill.querySelector<HTMLOptionElement>('option[value="both"]')!.textContent = il.keepShape ? "Fill the room" : "Fill both";
      q<HTMLElement>("[data-in-free]")!.setAttribute("aria-pressed", String(il.free));
      q<HTMLElement>("[data-in-span-wrap]")!.hidden = !il.grid || il.free;
      for (const i of [0, 1] as const) { const f = q<HTMLInputElement>(`[data-in-span="${i}"]`)!; if (free(f)) f.value = String(il.span[i]); }
      const fills = [il.fill === "x" || il.fill === "both", il.fill === "y" || il.fill === "both"];
      q<HTMLElement>("[data-in-limits]")!.hidden = il.free || !fills.some(Boolean);
      for (const i of [0, 1] as const) {
        q<HTMLElement>(`[data-in-limit-axis="${i}"]`)!.hidden = !fills[i];
        for (const k of ["min", "max"] as const) { const f = q<HTMLInputElement>(`[data-in-${k}="${i}"]`)!; if (free(f)) f.value = String(Math.round(il[k][i] * 100)); }
      }
    }
    const ratio = pick && still ? actions.sheetRatio() : null;
    q<HTMLElement>("[data-sheet-size]")!.hidden = ratio === null;
    if (ratio !== null) {
      showRatio();
      showCustom();
      const scale = q<HTMLElement>("[data-sheet-scale]")!;
      scale.hidden = !actions.ratioOfSheet(); // (what is on a sheet: a shape holds nothing)
      scale.setAttribute("aria-pressed", String(actions.sheetScale()));
    }
    for (const [key, shown, value] of fields) {
      if (!still && pick) continue;
      q<HTMLElement>(`[data-sel-${key}-wrap]`)!.hidden = !shown;
      const input = q<HTMLInputElement>(`[data-sel-${key}]`)!;
      if (shown && free(input)) input.value = value;
      if (key === "radius") input.placeholder = crn?.mixed ? "Mixed" : "";
    }
    // The colours the picked shapes use, as chips (several shapes picked): one change reaches every shape that uses that colour or gradient.
    const colours = q<HTMLElement>("[data-sel-colours]")!;
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
    const sw = q<HTMLInputElement>("[data-shape-width]")!;
    const noOutline = editor.shapeStroke === null && editor.shapeKind !== "line"; // (a line gets the ink when it has no outline)
    if (free(sw)) sw.value = noOutline ? "0" : String(Math.max(1, sliderFromPen(editor.shapeWidthPx)));
    q<HTMLElement>("[data-shape-out]")!.textContent = noOutline ? "None" : `${editor.shapeWidthPx} px`;
    // The paint chips show the next shape's colours, or the selected paths' (and are there only when something has them).
    const sel = editor.editsSelection ? actions.selectedPaint() : null;
    const several = editor.editsSelection && !editor.gesturing ? actions.selectionPaints().count >= 2 : false;
    if (!editor.gesturing) {
    }
    const outlineAt = several ? q<HTMLElement>("[data-sel-colours]")! : outlineHome;
    if (outlineBtn.parentElement !== outlineAt) outlineAt.append(outlineW, outlineBtn);
    outlineBtn.hidden = editor.editsSelection && !sel;
    const ol = editor.editsSelection && sel && !editor.gesturing ? actions.selectedOutline() : null;
    outlineW.hidden = !ol;
    if (ol && free(outlineWInput)) {
      outlineWInput.value = ol.widthPx === null ? "" : String(Math.round(ol.widthPx * 100) / 100);
      outlineWInput.placeholder = ol.widthPx === null ? "Mixed" : "";
    }
    for (const b of qa<HTMLButtonElement>("[data-paint]")) {
      const which = b.dataset["paint"] as "fill" | "stroke";
      const value = sel ? sel[which] : which === "fill" ? editor.shapeFill : editor.shapeStroke;
      b.hidden = editor.editsSelection && (!sel || several);
      b.classList.toggle("is-none", value === null);
      (b.querySelector("[data-paint-chip]") as HTMLElement).style.setProperty("--paint", value === null ? "linear-gradient(transparent, transparent)" : typeof value === "string" ? `linear-gradient(${sel ? value : newInk(value)}, ${sel ? value : newInk(value)})` : paintCss(value)); // (what the next shape gets is the colour it will have)
    }
    for (const b of qa<HTMLElement>("[data-width]")) b.classList.toggle("is-on", Number(b.dataset["width"]) === editor.penWidthPx);
    for (const b of qa<HTMLElement>("[data-pen-only]")) b.hidden = editor.tool !== "pen"; // (the pen's own presets and zoom behaviour: not for strokes already drawn)
    const size = q<HTMLInputElement>("[data-size]")!;
    if (free(size)) size.value = String(sliderFromPen(editor.penWidthPx));
    q<HTMLElement>("[data-size-out]")!.textContent = `${editor.penWidthPx} px`;
    q<HTMLElement>("[data-stab]")!.setAttribute("aria-pressed", String(editor.stabilizer.on));
    const strength = q<HTMLInputElement>("[data-strength]")!;
    strength.hidden = !editor.stabilizer.on;
    if (free(strength)) strength.value = String(editor.stabilizer.strength);
    const es = q<HTMLInputElement>("[data-eraser-size]")!;
    if (free(es)) es.value = String(editor.eraserPx);
    q<HTMLElement>("[data-eraser-out]")!.textContent = `${editor.eraserPx} px`;
    q<HTMLElement>("[data-erase-groups]")!.setAttribute("aria-pressed", String(editor.eraseWholeGroups));
    q<HTMLElement>("[data-erase-parts]")!.setAttribute("aria-pressed", String(editor.eraseParts));
    q<HTMLElement>("[data-bookmarks]")!.setAttribute("aria-pressed", String(editor.bookmarksOpen));
    q<HTMLElement>("[data-layers]")!.setAttribute("aria-pressed", String(editor.layersOpen));
    q<HTMLElement>("[data-adjust-panel]")!.setAttribute("aria-pressed", String(editor.adjustOpen));
    q<HTMLElement>("[data-pattern-panel]")!.setAttribute("aria-pressed", String(editor.patternOpen));
    q<HTMLElement>("[data-tags]")!.setAttribute("aria-pressed", String(editor.tagsOpen));
    q<HTMLElement>("[data-styles]")!.setAttribute("aria-pressed", String(editor.stylesOpen));
    pq("[data-snap]").setAttribute("aria-pressed", String(editor.snap));
    pq("[data-box-axis]").setAttribute("aria-pressed", String(editor.alignBox));
    q<HTMLElement>("[data-ignore-fill]")!.setAttribute("aria-pressed", String(editor.ignoreFilling));
    q<HTMLElement>("[data-follow]")!.setAttribute("aria-pressed", String(editor.followZoom));
    q<HTMLElement>("[data-lock]")!.setAttribute("aria-pressed", String(editor.lock !== null));
    const lockR = pq("[data-lock-radius]");
    lockR.setAttribute("aria-pressed", String(editor.lockRadius));
    if (!editor.gesturing) lockR.hidden = !(editor.editsSelection && editor.tool !== "node" && actions.selectedCorners() !== null); // (there when a picked shape has corners)
    for (const b of qa<HTMLElement>("[data-filter]")) {
      b.setAttribute("aria-checked", String(b.dataset["filter"] === editor.lassoFilter));
    }
    q<HTMLButtonElement>('[data-action="undo"]')!.disabled = !doc.canUndo;
    q<HTMLButtonElement>('[data-action="redo"]')!.disabled = !doc.canRedo;
    // On Select the pen-size slider sets the thickness of selected strokes: with only shapes (or pictures, text) picked it is not theirs to set
    // (a shape's width is in Outline options), so it is not offered.
    const penSize = q<HTMLElement>("[data-size]")!.closest<HTMLElement>(".tb-options")!;
    penSize.dataset["for"] = editor.tool === "select" && editor.selection.size > 0 && ![...editor.selection].some((id) => doc.get(id)?.kind === "stroke") ? "pen" : "pen select";
    // One row, one kind at a time (ADR 0128): when the picked items are of different kinds, chips at the start choose which kind's
    // properties the row shows; what is for another kind is switched off, never moved into a menu.
    const picking = editor.editsSelection && !editor.gesturing;
    const kinds = picking ? [...new Set([...editor.selection].flatMap((id) => { const o = doc.get(id); return o ? [kindOf(o)] : []; }))] : [];
    // (`all`, chosen by its chip, shows only what is for any kind in this row; the Actions bar below follows the same choice)
    const chosen = editor.subject === "all" && kinds.length > 1 ? "all" : kinds.includes(editor.subject ?? "") ? editor.subject! : (kinds[0] ?? null);
    const chips = q<HTMLElement>(".tb-subject")!;
    const chipHtml = kinds.length > 1 ? ["all", ...kinds].map((k) => `<button type="button" role="radio" class="tb-chip" data-subject="${k}" aria-checked="${k === chosen}" title="${k === "all" ? "Everything selected: the tools for all of it" : `Edit the ${KIND_LABEL[k]!.toLowerCase()} properties of the selection`}">${KIND_LABEL[k]}</button>`).join("") : "";
    if (chips.dataset["html"] !== chipHtml) {
      chips.dataset["html"] = chipHtml;
      chips.innerHTML = chipHtml;
    }
    chips.hidden = !chipHtml;
    if (picking) {
      for (const el of [...qa<HTMLElement>(".toolbar [data-kind]"), ...pickGroup.querySelectorAll<HTMLElement>("[data-kind]")]) {
        const ks = el.dataset["kind"]!.split(" ");
        el.toggleAttribute("data-off", !(ks.includes("any") || (chosen ? ks.includes(chosen) : ks.includes("tool"))));
      }
    } else for (const el of [...qa<HTMLElement>(".toolbar [data-off]"), ...pickGroup.querySelectorAll<HTMLElement>("[data-off]")]) el.removeAttribute("data-off");
    // The bar shows what the current tool offers and is gone when there is nothing to show.
    const row = barRow;
    q<HTMLElement>("[data-mask-paint]")!.dataset["for"] = editor.maskEdit ? "pen" : ""; // (only while a brush mask is painted)
    for (const b of qa<HTMLElement>("[data-mask-ink]")) b.setAttribute("aria-pressed", String(b.dataset["maskInk"] !== "done" && editor.maskEdit?.ink === (b.dataset["maskInk"] === "show" ? "#ffffff" : "#000000")));
    // (while a text is typed in, the bar offers the text's options, whatever tool is active; while what a tool has just made is selected, its
    // options, as with the Select tool: ADR 0198)
    const rowTool = editor.editingText ? "text" : editor.editsMade ? "select" : editor.tool;
    syncGroups(row, (g) => g.dataset["for"]!.split(" ").includes(rowTool));
    barEl.hidden = ![...row.querySelectorAll<HTMLElement>(":scope > .tb-group")].some((g) => !g.hidden);
    syncScroll(row);
    syncGroups(colourBar.row, (g) => g.dataset["for"]!.split(" ").includes(rowTool));
    colourBar.el.hidden = ![...colourBar.row.querySelectorAll<HTMLElement>(":scope > .tb-group")].some((g) => !g.hidden);
    syncScroll(colourBar.row);
    const wrap = document.querySelector(".ctx-wrap");
    if (wrap && pickBar.el.parentElement !== wrap) wrap.append(pickBar.el);
    pickGroup.hidden = ![...pickGroup.children].some((c) => !isOff(c as HTMLElement));
    pickBar.el.hidden = !(rowTool === "select" || rowTool === "node") || editor.selection.size === 0 || pickGroup.hidden;
    for (const fn of afterUpdate) fn();
  };
  const afterUpdate: Array<() => void> = [];
  editor.subscribe(update);
  doc.subscribe(update);
  phoneWidth.addEventListener("change", () => {
    placeColours();
    update();
  });
  update();
  return { bar: barEl, row: barRow, colours: colourBar.el, onUpdate: (fn) => void afterUpdate.push(fn), refresh: update };
}
