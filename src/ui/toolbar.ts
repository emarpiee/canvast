import { scrubNumbers } from "../colour-picker/scrub";
import { esc } from "./format";
import { createBar, syncGroups, syncScroll } from "./bar";
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
import { paintCss } from "../doc/paint";
import type { Arrow, ShapeKind } from "../doc/path";
import type { GradientStop } from "../doc/paint";
import { openColourPopover, openFontOptionsPopover, openOutlinePopover, openPaintPopover, openTextBoxPopover, recentColours } from "./colour-popover";
import { fontFor } from "../text/fonts";
import type { Adjust } from "../doc/adjust";
import { setAdjustPreviewing } from "../render/adjust-image";
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
  /** How the first picked object on a sheet follows it (null: none is on one), and changing it (ADR 0108). */
  selectedPin(): { h: string; v: string } | null;
  /** The look of the text being edited, else of the Text tool (when it is the tool), else of the first picked text (null: none), and changing it (ADR 0126). */
  selectedTextStyle(): ReturnType<typeof lookOf> | null;
  setTextStyle(look: TextLook, final?: boolean): void;
  /** The fonts in the library a text can be set in (ADR 0127), and importing a font file into it (null: it was refused, and the person was told why). */
  fonts(): Promise<Array<{ hash: string; name: string; unusable: string }>>;
  importFont(file: File): Promise<string | null>;
  setPin(patch: { h?: string; v?: string }): void;
  /** Size in px of the one picked sheet, and giving it another (ADR 0121). */
  sheetSize(): { w: number; h: number } | null;
  resizeSheet(w: number, h: number, final?: boolean): void;
  /** Where the one picked object on a sheet is and how big, in px from the sheet's corner (null: none is), and moving or resizing it. */
  boxOnSheet(): { x: number; y: number; w: number; h: number; resizable: boolean } | null;
  moveOnSheet(x: number, y: number, final?: boolean): void;
  resizeOnSheet(w: number, h: number, final?: boolean): void;
  /** Pictures (ADR 0118): crop the picked still, show it whole, and the adjustments of the picked pictures. */
  croppable(): boolean;
  cropped(): boolean;
  uncrop(): void;
  selectedAdjust(): { adjust: Adjust; stills: boolean; count: number } | null;
  /** The saved adjustments, and saving the numbers as one (ADR 0120). */
  adjustStyles(): { save(name: string, a: Adjust): Promise<void>; gradients(): Array<{ name: string; stops: readonly GradientStop[] }>; saveGradient(stops: readonly GradientStop[]): Promise<void> };
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

const TOOLS: Array<{ tool: Tool; icon: string; label: string; key: string }> = [
  { tool: "hand", icon: ICONS.hand, label: "Hand (pan)", key: "H" },
  { tool: "select", icon: ICONS.pointer, label: "Select", key: "V" },
  { tool: "node", icon: ICONS.nodeTool, label: "Edit nodes", key: "N" },
  { tool: "pen", icon: ICONS.pencil, label: "Pen", key: "P" },
  { tool: "shape", icon: ICONS.shapeTool, label: "Shape and path", key: "U" },
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

const KIND_LABEL: Record<string, string> = { sheet: "Sheet", shape: "Shape", text: "Text", picture: "Picture", stroke: "Stroke" };
/** The kind of picked item the Properties bar sorts its controls by. */
const kindOf = (o: CanvasObject): string => (isContainer(o) ? "sheet" : o.kind === "path" ? "shape" : o.kind === "image" ? "picture" : o.kind);

/** Paper and screen sizes for a sheet, in px at 96 to the inch (ADR 0121 left them out; ADR 0133). */
const SHEET_PRESETS: ReadonlyArray<{ group: string; items: ReadonlyArray<{ name: string; w: number; h: number }> }> = [
  { group: "Paper", items: [{ name: "A5", w: 559, h: 794 }, { name: "A4", w: 794, h: 1123 }, { name: "A4 landscape", w: 1123, h: 794 }, { name: "A3", w: 1123, h: 1587 }, { name: "A3 landscape", w: 1587, h: 1123 }, { name: "A2", w: 1587, h: 2245 }, { name: "Letter", w: 816, h: 1056 }, { name: "Letter landscape", w: 1056, h: 816 }, { name: "Legal", w: 816, h: 1344 }, { name: "Tabloid", w: 1056, h: 1632 }] },
  { group: "Screen", items: [{ name: "HD 720p", w: 1280, h: 720 }, { name: "Full HD", w: 1920, h: 1080 }, { name: "4K", w: 3840, h: 2160 }, { name: "Phone portrait", w: 390, h: 844 }, { name: "Tablet", w: 1024, h: 768 }, { name: "Desktop", w: 1440, h: 900 }] },
  { group: "Social", items: [{ name: "Square post", w: 1080, h: 1080 }, { name: "Story", w: 1080, h: 1920 }, { name: "Link preview", w: 1200, h: 630 }, { name: "Banner", w: 1500, h: 500 }, { name: "Icon", w: 512, h: 512 }] },
];

/** The features of a font worth offering, with the words that name them (a font only shows the ones it has). */
const FONT_FEATURES: Record<string, string> = { liga: "Ligatures", dlig: "Discretionary ligatures", smcp: "Small capitals", c2sc: "Capitals to small capitals", tnum: "Tabular numbers", pnum: "Proportional numbers", onum: "Old-style numbers", lnum: "Lining numbers", frac: "Fractions", zero: "Slashed zero", case: "Case-sensitive forms", sups: "Superscript", subs: "Subscript", titl: "Titling forms", swsh: "Swashes", salt: "Stylistic alternates", ordn: "Ordinals" };

export function mountToolbar(root: HTMLElement, editor: EditorState, doc: DocumentStore, actions: ToolbarActions): void {
  root.innerHTML = `
    <div class="rail" data-cmd-group="Tools" role="radiogroup" aria-label="Tool" aria-orientation="vertical">
      ${TOOLS.map(
        (t) => `<button type="button" role="radio" data-tool="${t.tool}" aria-label="${t.label}" title="${t.label} (${t.key})">${t.icon}</button>`,
      ).join("")}
    </div>
    <div class="dock" data-cmd-group="Dock" role="toolbar" aria-label="History and panels">
      <div class="tb-group">
        <button type="button" data-action="undo" aria-label="Undo" title="Undo (Ctrl+Z)">${ICONS.undo}</button>
        <button type="button" data-action="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${ICONS.redo}</button>
      </div>
      <div class="tb-group">
        <button type="button" data-action="search" aria-label="Search the canvas" title="Search the canvas (Ctrl+F; # tag, @ bookmark)">${ICONS.search}</button>
        <button type="button" class="layers-toggle" data-layers aria-pressed="false" aria-label="Layers panel" title="Layers: show or hide the floating Layers panel">${ICONS.layers}</button>
        <button type="button" class="layers-toggle" data-tags aria-pressed="false" aria-label="Tags panel" title="Tags: tag items on this canvas, and rename or delete a tag">${ICONS.tag}</button>
        <button type="button" class="layers-toggle" data-styles aria-pressed="false" aria-label="Styles panel" title="Styles: saved adjustments (and more soon) to apply to the selected items">${ICONS.swatchBook}</button>
        <button type="button" class="layers-toggle" data-bookmarks aria-pressed="false" aria-label="Bookmarks panel" title="Bookmarks: saved places and zooms on this canvas">${ICONS.bookmark}</button>
        <button type="button" data-action="import" aria-label="Import files" title="Import files: pictures, video, audio, or any other file (kept as a card you can download)">${ICONS.imagePlus}</button>
      </div>
      <input type="file" multiple hidden data-testid="import-input">
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
        <span class="tb-recents" data-recents data-no-command role="group" aria-label="Recent colours"></span>
        <button type="button" class="swatch swatch-current" data-colour-open aria-haspopup="dialog" aria-expanded="false" aria-label="Pen colour" title="Pen colour: open the colour picker (new text takes it too, until its own colour is set)"><span data-colour-chip></span></button>
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
        <label class="tb-count" data-kind="shape" data-scrub="radius" data-sel-radius-wrap hidden title="Drag the name left or right to change it">Radius <input type="text" data-sel-radius size="8" inputmode="decimal" aria-label="Corner radius (px)" title="Corner radius, in px at this zoom. Several values (one for every corner) set them each; double-click the dot on the shape to open its corners out."></label>
        <label class="tb-count" data-kind="shape" data-scrub="smooth" data-sel-smooth-wrap hidden title="Drag the name left or right to change it">Smooth <input type="number" data-sel-smooth min="0" max="100" step="5" inputmode="numeric" aria-label="Corner smoothing (%)" title="Corner smoothing: the rounded corners start farther out and blend into the line"></label>
        <label class="tb-count" data-kind="shape" data-scrub="sides" data-sel-sides-wrap hidden title="Drag the name left or right to change it">Sides <input type="number" data-sel-sides min="3" max="24" step="1" inputmode="numeric" aria-label="Polygon sides"></label>
        <label class="tb-count" data-kind="shape" data-scrub="tips" data-sel-tips-wrap hidden title="Drag the name left or right to change it">Points <input type="number" data-sel-tips min="3" max="24" step="1" inputmode="numeric" aria-label="Star points"></label>
        <label class="tb-count" data-kind="any" data-pin-wrap hidden title="How it follows its sheet when the sheet is resized">Pin
          <select data-pin-h aria-label="Pin horizontally: how it follows the sheet's width"><option value="left">Left</option><option value="right">Right</option><option value="both">Left and right</option><option value="center">Centre</option><option value="scale">Scale</option></select>
          <select data-pin-v aria-label="Pin vertically: how it follows the sheet's height"><option value="top">Top</option><option value="bottom">Bottom</option><option value="both">Top and bottom</option><option value="center">Middle</option><option value="scale">Scale</option></select></label>
        <button type="button" data-kind="picture" data-crop hidden aria-pressed="false" aria-label="Crop the picture" title="Crop: drag a side or a corner of the picture; drag outward to bring back what was cut. Enter or Escape finishes.">${ICONS.crop}</button>
        <button type="button" data-kind="picture" data-uncrop hidden aria-label="Show the whole picture" title="Show the whole picture again (the crop is removed)">${ICONS.fullscreen}</button>
        <button type="button" data-kind="picture" data-adjust hidden aria-haspopup="dialog" aria-expanded="false" aria-label="Adjust the picture" title="Adjust the picture: exposure, contrast, colour, blur and more. The original is not changed.">${ICONS.slidersVertical}</button>
        <button type="button" data-kind="picture" data-adjust-reset hidden aria-label="Reset the adjustments" title="Reset the adjustments of the picked pictures">${ICONS.listRestart}</button>
        <span class="tb-count" data-kind="any" data-on-sheet hidden title="Where it is on its sheet, in px from the sheet's top-left corner">On sheet
          X <input type="number" data-on-x step="any" inputmode="decimal" aria-label="Position from the left of the sheet (px)"> Y <input type="number" data-on-y step="any" inputmode="decimal" aria-label="Position from the top of the sheet (px)">
          <span data-on-size>W <input type="number" data-on-w min="0" step="any" inputmode="decimal" aria-label="Width (px)"> H <input type="number" data-on-h min="0" step="any" inputmode="decimal" aria-label="Height (px)"></span></span>
        <span class="tb-count" data-kind="sheet" data-sheet-size hidden title="Size of the sheet; only the sheet changes, what is on it follows its pin">Size
          <input type="number" data-sheet-w min="0" step="any" inputmode="decimal" aria-label="Sheet width"> × <input type="number" data-sheet-h min="0" step="any" inputmode="decimal" aria-label="Sheet height">
          <select data-sheet-unit aria-label="Unit of the sheet size"><option value="1">px</option><option value="96">in</option><option value="3.7795275590551185">mm</option><option value="37.795275590551185">cm</option></select>
          <select data-sheet-preset aria-label="Sheet size preset" title="A paper or screen size: the sheet takes it (its top-left corner stays)"><option value="">Preset…</option>${SHEET_PRESETS.map((g) => `<optgroup label="${g.group}">${g.items.map((i) => `<option value="${i.w},${i.h}">${i.name} (${i.w} × ${i.h})</option>`).join("")}</optgroup>`).join("")}</select>
          <button type="button" data-sheet-scale aria-pressed="false" aria-label="Scale contents with the sheet" title="Scale contents: when the sheet is resized, everything on it grows with it, whatever its pins say">${ICONS.sheetScale}</button></span>
        <label class="tb-count" data-kind="shape" data-scrub="inner" data-sel-inner-wrap hidden title="Drag the name left or right to change it">Ratio <input type="number" data-sel-inner min="5" max="95" step="1" inputmode="numeric" aria-label="Star ratio (percent)" title="Inner radius as a percent of the outer one"></label>
      </div>
      <div class="tb-group tb-options" data-for="text note select node" data-kind="text">
        <button type="button" class="swatch swatch-paint" data-text-colour data-text-wrap hidden aria-haspopup="dialog" aria-expanded="false" aria-label="Text colour" title="Text colour: open the colour picker (with transparency)"><span data-paint-chip></span></button>
        <label class="tb-count" data-text-wrap hidden title="Font: the bundled one, or a font file from the library (import one here)"><select data-text-font aria-label="Font"></select></label>
        <button type="button" data-text-font-options data-text-wrap hidden aria-haspopup="dialog" aria-expanded="false" aria-label="Font options" title="Font options: kerning, the features of the font (ligatures, small capitals, numerals...) and the axes of a variable font">${ICONS.fontOptions}</button>
        <input type="file" hidden accept=".ttf,.otf,.woff,.woff2" data-testid="font-input">
        <label class="tb-count" data-text-wrap hidden title="Text size, in px at this zoom. Drag the name to change it.">Size <input type="number" data-text-size min="1" max="2000" step="any" inputmode="decimal" aria-label="Text size (px at this zoom)"></label>
        <button type="button" class="swatch swatch-paint" data-text-outline data-text-wrap hidden aria-haspopup="dialog" aria-expanded="false" aria-label="Text outline" title="Text outline: the colour of the line round the letters (none to take it away)"><span data-paint-chip></span></button>
        <label class="tb-count" data-text-wrap hidden title="Outline width, in px at this zoom (0: none)">Outline <input type="number" data-text-outline-w min="0" max="2000" step="any" inputmode="decimal" aria-label="Text outline width (px at this zoom)"></label>
        <button type="button" data-text-box data-text-wrap hidden aria-haspopup="dialog" aria-expanded="false" aria-label="Paragraph and box options" title="Paragraph and box: space between paragraphs, first line, case, most lines, set height">${ICONS.textBox}</button>
        <label class="tb-count" data-text-wrap hidden title="Line height: a multiple of the text size. Drag the name to change it.">Line <input type="number" data-text-line min="0.5" max="5" step="0.05" aria-label="Line height"></label>
        <label class="tb-count" data-text-wrap hidden title="Letter spacing: a share of the text size. Drag the name to change it.">Letters <input type="number" data-text-track min="-50" max="200" step="1" aria-label="Letter spacing (percent of the text size)"></label>
      </div>
      <div class="tb-group tb-options" data-for="text note select node" data-kind="text" role="radiogroup" aria-label="Text alignment">
        ${TEXT_ALIGNS.map((a) => `<button type="button" role="radio" class="shape-kind" data-text-wrap hidden data-text-align="${a.id}" aria-label="${a.label}" title="${a.label}">${a.icon}</button>`).join("")}
      </div>
      <div class="tb-group tb-options" data-for="text note select node" data-kind="text" role="radiogroup" aria-label="Text width">
        ${TEXT_FITS.map((a) => `<button type="button" role="radio" class="shape-kind" data-text-wrap hidden data-text-fit="${a.id}" aria-label="${a.label}" title="${a.title}">${a.icon}</button>`).join("")}
      </div>
      <div class="tb-group tb-options" data-for="select node" data-kind="shape" role="group" aria-label="Initial shape">
        <button type="button" data-initial-set hidden aria-label="Set initial shape: save the shape as it is now" title="Set initial shape: save the shape as it is now, to come back to it later">${ICONS.pin}</button>
        <button type="button" data-initial-update hidden aria-label="Update initial shape: replace the saved shape with the shape as it is now" title="Update initial shape: replace the saved shape with the shape as it is now">${ICONS.save}</button>
        <button type="button" data-initial-reset hidden aria-label="Reset to initial shape: put the shape back as it was saved" title="Reset to initial shape: put the shape back as it was saved">${ICONS.resetShape}</button>
      </div>
      <div class="tb-group tb-options" data-for="select node" data-sel-colours data-no-command hidden role="group" aria-label="Colours of the selection"></div>
      <div class="tb-group tb-options" data-for="shape path select node" data-kind="shape sheet">
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
        <button type="button" class="snap" data-kind="tool" data-ignore-fill aria-pressed="false" aria-label="Ignore the object that fills the view" title="Ignore the object that fills the view: zoomed far into an object it cannot be picked or deleted by accident">${ICONS.pointerBan}</button>
        <button type="button" data-kind="tool" data-action="show-all" aria-label="Show all hidden" title="Show all hidden objects">${ICONS.eye}</button>
        <button type="button" data-kind="tool" data-action="unlock-all" aria-label="Unlock all" title="Unlock all locked objects">${ICONS.lockKeyholeOpen}</button>
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
  // The colours of a selection are a second bar of their own, just under this one (the same bar component, ADR 0128).
  const colourBar = createBar("Colours of the selection", "Colours");
  colourBar.row.append(root.querySelector("[data-sel-colours]")!);
  // The Outline options button sits beside the Outline colour: in this bar, after the chips, when several shapes are picked.
  const outlineBtn = root.querySelector<HTMLElement>("[data-outline-options]")!;
  const outlineHome = outlineBtn.parentElement!;
  root.querySelector(".toolbar")!.after(colourBar.el);
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
    const html = [`<option value="">Inter (built in)</option>`]
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
      onInput: (p) => p !== null && actions.setTextStyle(typeof p === "string" ? { color: p, gradient: null } : { gradient: p }, false),
      onChange: (p) => p !== null && actions.setTextStyle(typeof p === "string" ? { color: p, gradient: null } : { gradient: p }),
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
  const sheetUnit = (): number => Number(sheetField("[data-sheet-unit]").value) || 1;
  const sheetApply = (final: boolean): void => {
    const w = Number(sheetField("[data-sheet-w]").value) * sheetUnit(), h = Number(sheetField("[data-sheet-h]").value) * sheetUnit();
    if (w > 0 && h > 0) actions.resizeSheet(w, h, final);
  };
  for (const f of ["[data-sheet-w]", "[data-sheet-h]"]) liveNumber(sheetField(f), (_v, final) => sheetApply(final));
  const onSheet = (sel: string): HTMLInputElement => root.querySelector<HTMLInputElement>(sel)!;
  for (const f of ["[data-on-x]", "[data-on-y]"]) liveNumber(onSheet(f), (_v, final) => actions.moveOnSheet(Number(onSheet("[data-on-x]").value), Number(onSheet("[data-on-y]").value), final));
  for (const f of ["[data-on-w]", "[data-on-h]"]) liveNumber(onSheet(f), (_v, final) => actions.resizeOnSheet(Number(onSheet("[data-on-w]").value), Number(onSheet("[data-on-h]").value), final));
  sheetField("[data-sheet-unit]").addEventListener("change", () => editor.changed()); // (the same size, said in another unit)
  sheetField("[data-sheet-preset]").addEventListener("change", (e) => {
    const sel = e.target as HTMLSelectElement;
    const [w, h] = sel.value.split(",").map(Number);
    sel.value = "";
    if (w && h) actions.resizeSheet(w, h, true);
  });
  root.querySelector<HTMLElement>("[data-sheet-scale]")!.addEventListener("click", (e) => {
    editor.scaleSheetContents = !editor.scaleSheetContents;
    (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(editor.scaleSheetContents));
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

  // Drag a number's name to change it, live (one undo step when released): the quick way to a radius, a count, a ratio.
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
    if (!label || e.button !== 0) return;
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

  let colourEditing = false;
  // Every colour of the selection has its chip (the row scrolls when there are many): none is kept in a menu.
  const SEL_CHIPS = Infinity;
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
    if (d["subject"]) {
      editor.subject = d["subject"];
      editor.changed();
    } else if (d["maskInk"]) {
      actions.paintMask(d["maskInk"] as "show" | "hide" | "done");
    } else if (d["penKind"]) {
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
    } else if (d["eraseParts"] !== undefined) {
      editor.eraseParts = !editor.eraseParts;
      editor.changed();
    } else if (d["eraseGroups"] !== undefined) {
      editor.eraseWholeGroups = !editor.eraseWholeGroups;
      editor.changed();
    } else if (d["initialSet"] !== undefined) {
      actions.setInitialShape(true);
    } else if (d["initialUpdate"] !== undefined) {
      actions.setInitialShape(false);
    } else if (d["initialReset"] !== undefined) {
      actions.resetToInitialShape();
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
    else if (d["action"] === "undo") actions.undo();
    else if (d["action"] === "redo") actions.redo();
    else if (d["action"] === "show-all") actions.clearFlag("hidden");
    else if (d["action"] === "unlock-all") actions.clearFlag("locked");
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
    const smoothing = pick && still ? actions.selectedSmoothing() : null;
    const round2 = (v: number): string => String(Math.round(v * 100) / 100);
    const fields: Array<[string, boolean, string]> = [
      ["radius", !!crn, crn && !crn.mixed ? round2(crn.radiusPx[0] ?? 0) : ""],
      ["smooth", smoothing !== null, String(smoothing ?? 0)],
      ["sides", shp?.shape === "polygon", String(shp?.sides ?? 0)],
      ["tips", shp?.shape === "star", String(shp?.tips ?? 0)],
      ["inner", shp?.shape === "star", String(shp ? Math.round(shp.inner * 100) : 0)],
    ];
    const txt = (pick && still) || editor.tool === "text" || editor.tool === "note" ? actions.selectedTextStyle() : null;
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
      for (const [f, v] of [["[data-on-x]", on.x], ["[data-on-y]", on.y], ["[data-on-w]", on.w], ["[data-on-h]", on.h]] as const) {
        const el = onSheet(f);
        if (document.activeElement !== el) el.value = String(Math.round(v * 100) / 100);
      }
    }
    const sz = pick && still ? actions.sheetSize() : null;
    root.querySelector<HTMLElement>("[data-sheet-size]")!.hidden = !sz;
    if (sz) {
      const u = Number(root.querySelector<HTMLSelectElement>("[data-sheet-unit]")!.value) || 1;
      const round = (v: number): string => String(Math.round((v / u) * 1000) / 1000);
      for (const [f, v] of [["[data-sheet-w]", sz.w], ["[data-sheet-h]", sz.h]] as const) {
        const el = root.querySelector<HTMLInputElement>(f)!;
        if (document.activeElement !== el) el.value = round(v);
      }
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
            .join("");
      }
    }
    const sw = root.querySelector<HTMLInputElement>("[data-shape-width]")!;
    if (document.activeElement !== sw) sw.value = String(sliderFromPen(editor.shapeWidthPx));
    root.querySelector<HTMLElement>("[data-shape-out]")!.textContent = `${editor.shapeWidthPx} px`;
    // The paint chips show the next shape's colours, or the selected paths' (and are there only when something has them).
    const sel = editor.tool === "select" || editor.tool === "node" ? actions.selectedPaint() : null;
    const several = (editor.tool === "select" || editor.tool === "node") && editor.preview.kind === "none" ? actions.selectionPaints().count >= 2 : false;
    if (editor.preview.kind === "none") {
      const st = (editor.tool === "select" || editor.tool === "node") ? actions.initialShapeState() : null;
      root.querySelector<HTMLElement>("[data-initial-set]")!.hidden = !st || st.saved >= st.count;
      root.querySelector<HTMLElement>("[data-initial-update]")!.hidden = !st || st.saved === 0;
      root.querySelector<HTMLElement>("[data-initial-reset]")!.hidden = !st || st.saved === 0;
    }
    const outlineAt = several ? root.querySelector<HTMLElement>("[data-sel-colours]")! : outlineHome;
    if (outlineBtn.parentElement !== outlineAt) outlineAt.append(outlineBtn);
    outlineBtn.hidden = (editor.tool === "select" || editor.tool === "node") && !sel;
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
    root.querySelector<HTMLElement>("[data-styles]")!.setAttribute("aria-pressed", String(editor.stylesOpen));
    root.querySelector<HTMLElement>("[data-snap]")!.setAttribute("aria-pressed", String(editor.snap));
    root.querySelector<HTMLElement>("[data-box-axis]")!.setAttribute("aria-pressed", String(editor.alignBox));
    root.querySelector<HTMLElement>("[data-ignore-fill]")!.setAttribute("aria-pressed", String(editor.ignoreFilling));
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
    // On Select the pen-size slider sets the thickness of selected strokes: with only shapes (or pictures, text) picked it is not theirs to set
    // (a shape's width is in Outline options), so it is not offered.
    const penSize = root.querySelector<HTMLElement>("[data-size]")!.closest<HTMLElement>(".tb-options")!;
    penSize.dataset["for"] = editor.tool === "select" && editor.selection.size > 0 && ![...editor.selection].some((id) => doc.get(id)?.kind === "stroke") ? "pen" : "pen select";
    // One row, one kind at a time (ADR 0128): when the picked items are of different kinds, chips at the start choose which kind's
    // properties the row shows; what is for another kind is switched off, never moved into a menu.
    const picking = (editor.tool === "select" || editor.tool === "node") && editor.preview.kind === "none";
    const kinds = picking ? [...new Set([...editor.selection].flatMap((id) => { const o = doc.get(id); return o ? [kindOf(o)] : []; }))] : [];
    const chosen = kinds.includes(editor.subject ?? "") ? editor.subject! : (kinds[0] ?? null);
    const chips = root.querySelector<HTMLElement>(".tb-subject")!;
    const chipHtml = kinds.length > 1 ? kinds.map((k) => `<button type="button" role="radio" class="tb-chip" data-subject="${k}" aria-checked="${k === chosen}" title="Edit the ${KIND_LABEL[k]!.toLowerCase()} properties of the selection">${KIND_LABEL[k]}</button>`).join("") : "";
    if (chips.dataset["html"] !== chipHtml) {
      chips.dataset["html"] = chipHtml;
      chips.innerHTML = chipHtml;
    }
    chips.hidden = !chipHtml;
    if (picking) {
      for (const el of root.querySelectorAll<HTMLElement>(".toolbar [data-kind]")) {
        const ks = el.dataset["kind"]!.split(" ");
        el.toggleAttribute("data-off", !(ks.includes("any") || (chosen ? ks.includes(chosen) : ks.includes("tool"))));
      }
    } else for (const el of root.querySelectorAll<HTMLElement>(".toolbar [data-off]")) el.removeAttribute("data-off");
    // The bar shows what the current tool offers and is gone when there is nothing to show.
    const row = root.querySelector<HTMLElement>(".tb-options-row")!;
    root.querySelector<HTMLElement>("[data-mask-paint]")!.dataset["for"] = editor.maskEdit ? "pen" : ""; // (only while a brush mask is painted)
    for (const b of root.querySelectorAll<HTMLElement>("[data-mask-ink]")) b.setAttribute("aria-pressed", String(b.dataset["maskInk"] !== "done" && editor.maskEdit?.ink === (b.dataset["maskInk"] === "show" ? "#ffffff" : "#000000")));
    syncGroups(row, (g) => g.dataset["for"]!.split(" ").includes(editor.tool));
    root.querySelector<HTMLElement>(".toolbar")!.hidden = ![...row.querySelectorAll<HTMLElement>(":scope > .tb-group")].some((g) => !g.hidden);
    syncScroll(row);
    syncGroups(colourBar.row, (g) => g.dataset["for"]!.split(" ").includes(editor.tool));
    colourBar.el.hidden = ![...colourBar.row.querySelectorAll<HTMLElement>(":scope > .tb-group")].some((g) => !g.hidden);
    syncScroll(colourBar.row);
  };
  editor.subscribe(update);
  doc.subscribe(update);
  update();
}
