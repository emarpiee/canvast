import type { EditorState } from "../app/editor-state";
import { desktopBridge } from "../storage/desktop-bridge";
import type { DocumentStore } from "../doc/document-store";
import type { LayoutCommand } from "../app/actions";
import type { AlignKey, SortKey } from "../doc/arrange";
import { ICONS } from "./icons";
import { GAP_LABEL, GAP_ORDER } from "../doc/arrange";
import type { GapKey } from "../doc/arrange";
import { LAYOUT_MENU } from "./toolbar";
import { captionedGroup, hoverNames, syncGroups, syncScroll } from "./bar";
import { placeBy, selectionBoxIn, uiScale, edgeBarsIn } from "./near-selection";
import { isContainer } from "../doc/containers";
import { closeMoreMenu, commandRows as rowsOf, MENU_GAP, openMoreMenu } from "./more-menu";
import { commands, pressCommand } from "../commands/registry";
import { REASON } from "../commands/types";
import type { Command } from "../commands/types";
import { mediaBarTop } from "./media-player";
import type { MenuItem } from "./more-menu";
import type { BoolOp } from "../doc/boolean";

/**
 * The Actions bar (ADR 0051, 0128): what you can DO to the selection, in one row at a fixed place (bottom centre, above the readout), never
 * attached to an item, so it neither covers the picture nor jumps about. The row is made of groups that show when they apply: Duplicate,
 * group, tag, library and file actions, resets, text to path, shapes combined (a button for each operation), sheet and attach commands,
 * align, distribute and grid with the space between objects, order, lock, hide, delete. Nothing is in a menu. What the selection LOOKS like
 * (colour, size, font) is the Properties bar's, at the top.
 */
export interface ContextActions {
  duplicate(): void;
  /** Take the turn off the selection; give stretched pictures their own proportions back. */
  resetRotation(): void;
  /** Make the current turn of the shapes their own (the new zero). */
  applyRotation(): void;
  resetProportions(): void;
  /** Give the selected pictures and note cards the size they are placed at (at this zoom), and whether that changes any. */
  resetSize(): void;
  canResetSize(): boolean;
  isPicture(id: string): boolean;
  isSizable(id: string): boolean;
  /** Give the selected the width or height of the smallest, the middle or the largest of them. */
  matchSize(axis: "w" | "h", pick: "smallest" | "medium" | "largest"): void;
  /** Why it would change nothing, in words. */
  resetSizeBlock(): string;
  /** What the selection can be reset from. */
  resettable(): { turned: boolean; stretched: boolean; bakeable: boolean };
  /** The one selected item is a file the app cannot show (kept as a card): its asset, and whether a tab can open it (ADR 0078). */
  fileSelection(): { hash: string; open: boolean; note: boolean; view: boolean } | null;
  /** The file selected on the canvas (a note, a PDF...), opened in the file panel. */
  editNote(): void;
  /** Texts on a card are selected (made by the Note tool before notes were files). */
  canMakeNoteFiles(): boolean;
  makeNoteFiles(): void;
  /** Any file of the library is picked: its original can be downloaded (several as a ZIP; ADR 0119). */
  canDownload(): boolean;
  /** Put the picked objects on a sheet; take a picked sheet away, keeping what is on it (ADR 0108). */
  releaseSheet(): void;
  canReleaseSheet(): boolean;
  putOnSheet(): void;
  /** Auto layout (ADR 0186) of the picked sheets: every one has it (true), not every one (false), no sheet is picked (null); and the switch. */
  autoLayout(): boolean | null;
  setAutoLayout(on: boolean): void;
  /** The picked things on a new sheet that lays them out and hugs them (what Shift+A does when no sheet is picked). */
  layoutOnSheet(): void;
  canSheetEach(): boolean;
  sheetEach(): void;
  fitSheet(): void;
  canFitSheet(): boolean;
  /** Comic pages (ADR 0206): how many panels of one page are selected (-1: a page itself, none of its panels), and what to do to them. */
  comicPanels(): number;
  cutPanels(dir: "across" | "down"): void;
  mergePanels(): void;
  /** Attach the picked objects to the object clicked next, and detach them (ADR 0109). */
  attach(): void;
  detach(): void;
  canDetach(): boolean;
  /** Copy the Markdown of the picked texts. */
  copyMarkdown(): void;
  pictureTools(): { still: boolean; canPaste: boolean } | null;
  /** Whether the selection can be adjusted, and is (null: it cannot); showing or hiding the Adjust panel; taking the adjustments away. */
  adjustState(): { adjusted: boolean } | null;
  toggleAdjust(): void;
  resetAdjust(): void;
  copyAdjust(): void;
  pasteAdjust(): void;
  copyRendered(): void;
  bake(): void;
  /** Edit in PhotoCraft (Settings > ArtCraft > PhotoCraft): the selected pictures or sheet (`offered`); null where it is not in the app. */
  photoCraft: { run(anchor: HTMLElement): void; offered(): boolean } | null;
  /** A picked SVG picture: its shapes can be made into vectors (a copy beside it). */
  svgPicture(): boolean;
  vectorise(): void;
  /** Picked paths can be saved as an SVG file. */
  canExportSvg(): boolean;
  saveSvgToLibrary(): void;
  /** The picked shapes that have a shape to save, and how many have an initial state saved (null: none can). Set (only where missing), Update (all) and Reset (ADR 0106). */
  initialState(): { count: number; saved: number } | null;
  setInitialState(onlyMissing: boolean): void;
  resetInitialState(): void;
  /** Export…: choose a size (from the shape) and save a sheet, a picture or shapes as a picture file (ADR 0147). */
  canExport(): boolean;
  exportPicture(): void;
  /** Whether the selection was exported before on this device (Export again). */
  canExportAgain(): boolean;
  exportAgain(): void;
  downloadFile(): void;
  openFile(): void;
  hasLibraryItems(): boolean;
  showInLibrary(): void;
  /** Open the Tags panel on the box for the selection. */
  tag(): void;
  group(): void;
  ungroup(): void;
  arrange(to: "front" | "back"): void;
  /** Combine the selected shapes into one (ADR 0101); whether two or more can be. */
  combine(op: BoolOp): void;
  canCombine(): boolean;
  /** The operation of the boolean group that is the selection, if it is one (ADR 0103), and taking it apart or making it one path. */
  booleanState(): BoolOp | null;
  /** How the picked shapes can join or leave a boolean group: "add" (a group picked with shapes beside it), "out" (shapes of the group being worked in), or null. */
  groupJoin(): "add" | "out" | null;
  addToGroup(): void;
  takeOutOfGroup(): void;
  releaseBoolean(): void;
  flattenBoolean(): void;
  /** Turn the selected text into paths (ADR 0102), and whether any is selected. */
  outline(): void;
  canOutline(): boolean;
  /** Fewer nodes for the picked paths, and pen strokes turned into paths. */
  simplify(): void;
  canSimplify(): boolean;
  splitPaths(): void;
  canSplitPaths(): boolean;
  strokeToPath(): void;
  canStrokeToPath(): boolean;
  /** The stroke of the picked paths as a shape (ADR 0143), plain or tapered. */
  outlineStroke(profile?: "taper"): void;
  /** A width profile that stays live (ADR 0150): on, or off when it is already the line's. */
  setWidthProfile(profile: "taper" | null): void;
  canOutlineStroke(): boolean;
  /** Masks (ADR 0144): cut the others by the top picked thing, by its opacity or brightness, or clip them to its outline; change or release a mask. */
  makeMask(mode: "alpha" | "luminance"): void;
  makeClippingMask(): void;
  canMakeMask(): boolean;
  /** Make the picked paths one vector network, or take a network back to a path (ADR 0146). */
  makeNetwork(): void;
  releaseNetwork(): void;
  canMakeNetwork(): boolean;
  canReleaseNetwork(): boolean;
  /** Divide the picked shapes into their regions, or open the Shape builder on them to merge and delete regions by dragging (ADR 0145). */
  divide(): void;
  shapeBuilder(): void;
  /** Fill the gaps the picked shapes close in: all at once, or one click at a time (ADR 0172). */
  canFillGaps(): boolean;
  fillGaps(): void;
  fillGap(): void;
  finishBuilder(apply: boolean): void;
  canDivide(): boolean;
  changeMask(change: { invert?: boolean; release?: true }): void;
  selectMask(): void;
  canReleaseMask(): boolean;
  selectedMask(): { mode: "alpha" | "luminance"; invert: boolean } | null;
  /** Set a picked text along a picked path (both picked), and take a text off its path (ADR 0131). */
  setOnPath(): void;
  canSetOnPath(): boolean;
  setInShape(): void;
  canSetInShape(): boolean;
  takeOffPath(): void;
  canTakeOffPath(): boolean;
  /** Arrange in a grid, align or distribute the selection. */
  layout(cmd: LayoutCommand): void;
  /** The space between objects in a grid (ADR 0074), and choosing another one (a grid just made is laid out again with it). */
  gap(): GapKey;
  setGap(gap: GapKey): void;
  /** The order rule of the sheet with auto layout every selected thing is on (ADR 0194): null when they are not on one; "stack" for none. */
  laidOutOrder(): string | null;
  /** Arrange in a grid keeps it tidy: the grid made as a sheet with auto layout, its order a rule. */
  keepTidy(): boolean;
  setKeepTidy(on: boolean): void;
  setFlag(flag: "hidden" | "locked"): void;
  deleteSelection(): void;
  /** Open the command palette, to find an option or action by its name. */
  findCommand(): void;
}

const GAP_HINT: Record<GapKey, string> = { none: "Objects touch", tight: "A thin space between objects", normal: "A normal space between objects", wide: "A wide space between objects", wider: "The widest space between objects" };
const GAP_SHORT: Record<GapKey, string> = { none: "0", tight: "S", normal: "M", wide: "L", wider: "XL" };
const OPS: Array<{ op: BoolOp; icon: string; label: string; aria: string }> = [
  { op: "union", icon: ICONS.squaresUnite, label: "Union", aria: "Union: join the shapes into one" },
  { op: "intersect", icon: ICONS.squaresIntersect, label: "Intersect", aria: "Intersect: keep only where the shapes overlap" },
  { op: "subtract", icon: ICONS.squaresSubtract, label: "Subtract", aria: "Subtract: take the shapes in front away from the one at the back" },
  { op: "exclude", icon: ICONS.squaresExclude, label: "Exclude overlap", aria: "Exclude overlap: keep everything but where the shapes overlap" },
];

export function mountContextBar(host: HTMLElement, editor: EditorState, doc: DocumentStore, actions: ContextActions, hidden: () => boolean, placement: () => "bottom" | "follow" = () => "bottom", /** Only these groups (by name), or all: a pinned view's bar (Pins). */ onlyGroups: () => readonly string[] | null = () => null): { update(): void; /** Its wrapper: placed where the view in use is (app/main.ts). */ wrap: HTMLElement } {
  const bar = document.createElement("div");
  bar.className = "ctx-bar";
  bar.dataset["testid"] = "context-bar";
  bar.dataset["cmdGroup"] = "Actions";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Selection actions");
  bar.hidden = true;
  const btn = (act: string, icon: string, label: string, extra = ""): string => `<button type="button" data-ctx="${act}" ${extra} aria-label="${label}" title="${label}">${icon}</button>`;
  // (each group shows its name over its buttons, so a thing is found by the name of its group: ADR 0197)
  const group = (name: string, ...items: string[]): string => captionedGroup(name, items.join(""));
  const layoutButtons = (head: string): string =>
    LAYOUT_MENU.find((g) => g.head.startsWith(head))!.items.map((i) => btn("layout", i.icon, head === "Align" ? `Align ${i.label.toLowerCase()}` : head === "Arrange" ? `Arrange in a grid: ${i.label.toLowerCase()}` : `Distribute ${i.label.toLowerCase()}`, `data-layout="${i.id}"`)).join("");
  bar.innerHTML =
    group("Objects", btn("library", ICONS.library, "View in the library"), btn("duplicate", ICONS.copy, "Duplicate"), btn("group", ICONS.group, "Group"), btn("ungroup", ICONS.ungroup, "Ungroup"), btn("tag", ICONS.tag, "Tag the selection")) +
    group("Files",
      btn("exportmenu", ICONS.exportMenu, "Export and copy out: save as a picture or SVG, download the file, copy the Markdown of a text", 'aria-haspopup="menu" aria-expanded="false"'),
      btn("editnote", ICONS.filePenLine, "Edit note (or double-click it)"),
      btn("viewfile", ICONS.bookOpen, "Open it here (or double-click it)"),
      btn("makenote", ICONS.fileInput, "Make note files: the texts on a card become notes in the library, edited in the note panel"),
      btn("open", ICONS.externalLink, desktopBridge() ? "Open in default app" : "Open in a new tab"),
      btn("copypng", ICONS.clipboardPlain, "Copy the picture to the clipboard as it looks now (crop and adjustments included)"),
      btn("bake", ICONS.copyPlus, "Make a new picture of it as it looks now, beside it"),
      btn("photocraft", ICONS.photoCraft, "Edit in PhotoCraft: the selected pictures (each in its own document, or as layers of one) or sheet (each object a layer); what it saves comes back to the library and the canvas"),
      btn("vectorise", ICONS.vectorPolygon, "Turn this SVG picture into editable vector shapes, in its place (the file stays in the library)")) +
    // (the adjustments, for any picture, shape or text: one group, with their copy and paste: ADR 0198)
    group("Adjust",
      btn("adjust", ICONS.slidersVertical, "Adjust the picture", 'aria-pressed="false"'),
      btn("adjustreset", ICONS.listRestart, "Reset the adjustments"),
      btn("copyadj", ICONS.clipboardList, "Copy the adjustments of the picture"),
      btn("pasteadj", ICONS.clipboardPaste, "Paste the copied adjustments on the selected pictures")) +
    group("Regions", btn("builderdone", ICONS.check, "Done: keep the regions as they are now (Enter)"), btn("buildercancel", ICONS.x, "Cancel the Shape builder (Esc)")) +
    group("Edit shapes", btn("pathmenu", ICONS.pathMenu, "Path tools: simplify, outline stroke, taper, vector network, divide, shape builder, text to path", 'aria-haspopup="menu" aria-expanded="false"'), btn("maskmenu", ICONS.maskMenu, "Masks: make one from the top shape, or change the one selected", 'aria-haspopup="menu" aria-expanded="false"'), btn("boolmenu", ICONS.boolMenu, "Shapes: join, intersect, subtract or exclude the selected shapes, and manage the group they make", 'aria-haspopup="menu" aria-expanded="false"'), btn("sheetmenu", ICONS.sheetMenu, "Sheets: put the selected objects on a sheet, release the sheet, fit it to what is on it", 'aria-haspopup="menu" aria-expanded="false"')) +
    group("Arrange", btn("alignmenu", ICONS.alignMenu, "Align and distribute: a list of the ways to line the selected objects up", 'aria-haspopup="menu" aria-expanded="false"'), btn("arrangemenu", ICONS.arrangeMenu, "Arrange in a grid: the ways to order the objects, and the space between them", 'aria-haspopup="menu" aria-expanded="false"'), btn("sizemenu", ICONS.sizeMenu, "Size: reset it, or give the selected the same width or height", 'aria-haspopup="menu" aria-expanded="false"'), btn("statemenu", ICONS.stateMenu, "Initial state: save the shape as it is now, replace the saved one, or go back to it", 'aria-haspopup="menu" aria-expanded="false"'), btn("front", ICONS.bringToFront, "Bring to front"), btn("back", ICONS.sendToBack, "Send to back"), btn("unrotate", ICONS.rotateCcw, "Reset rotation"), btn("baserot", ICONS.rotateCwSquare, "Apply rotation: make the current turn the shape's own, the new zero (it looks the same; its box fits it)"), btn("unstretch", ICONS.ratio, "Reset proportions (the picture's own shape)")) +
    group("Attach",
      btn("attach", ICONS.link, "Attach the selected objects to another object: they follow the object you click next when it moves", 'aria-pressed="false"'),
      btn("detach", ICONS.unlink, "Detach the selected objects: they stop following another object")) +
    group("Selection", btn("lock", ICONS.lockKeyhole, "Lock selection"), btn("hide", ICONS.eyeOff, "Hide selection"), btn("delete", ICONS.trash, "Delete selection")) +
    group("Find", btn("find", ICONS.findCommand, "Find an option or action by its name (Ctrl+K)"));
  // The bar is placed inside a wrapper, which the selection options bar (ui/toolbar.ts) joins: one parent for both, so they line up.
  const wrap = document.createElement("div");
  wrap.className = "ctx-wrap";
  wrap.append(bar);
  host.appendChild(wrap);
  // With a hover choice (Settings > Appearance > Actions bar group names) the names float over or under the bar while the pointer is on it: a
  // layer of their own in the wrapper, so neither the bar nor the options bar beside it changes size or moves (ADR 0197).
  const placeNames = hoverNames(bar, wrap).place;
  // Tools that are for some kinds of thing only (the others are for any): with a mixed pick, a chip at the start shows the tools of one kind (ADR 0152).
  const FOR_KINDS: Record<string, string> = { library: "image", open: "image", adjust: "image,path,stroke,text", adjustreset: "image,path,stroke,text", copyadj: "image,path,stroke,text", pasteadj: "image,path,stroke,text", copypng: "image", bake: "image", vectorise: "image", exportmenu: "image,path,stroke,text", pathmenu: "path,stroke,text", boolmenu: "path", statemenu: "path" };
  for (const [act, kinds] of Object.entries(FOR_KINDS)) bar.querySelector<HTMLElement>(`[data-ctx="${act}"]`)?.setAttribute("data-for", kinds);
  // With a mixed pick the kind chosen in the Properties bar (`editor.subject`, its chips: All, Picture, Shape ...) also chooses which tools show here: one set of chips, not two.
  const BAR_KINDS: Record<string, readonly string[]> = { picture: ["image", "media"], shape: ["path"], stroke: ["stroke"], text: ["text"], sheet: [] };
  const q = (act: string, extra = ""): HTMLButtonElement => bar.querySelector<HTMLButtonElement>(`[data-ctx="${act}"]${extra}`)!;
  const each = (act: string, f: (b: HTMLButtonElement) => void): void => bar.querySelectorAll<HTMLButtonElement>(`[data-ctx="${act}"]`).forEach(f);

  // The Actions bar's commands (ADR 0205): each of its buttons and menu rows runs one by id, as the palette, a macro and an outside caller do.
  // What the canvas has already (group, masks, paths, networks) is the canvas's command (src/app/canvas-commands.ts), not a second one.
  const sel = (): string | null => (editor.selection.size ? null : REASON.noSelection);
  const can = (f: () => boolean, no: string) => (): string | null => sel() ?? (f() ? null : no);
  const cmd = (id: string, title: string, hint: string, icon: string, exec: () => void, why: () => string | null = sel, extra: Partial<Command> = {}): Command => ({ id, group: "Actions", kind: "selection", title, hint, icon, risk: "edit", why, exec, ...extra });
  const layoutBlocked = (): string | null => sel() ?? (actions.laidOutOrder() !== null ? "Their sheet places them: see its alignment." : null);
  const picture = (): string | null => sel() ?? (actions.pictureTools() ? null : "Select a picture.");
  const barCommands = (): Command[] => [
    ...LAYOUT_MENU.find((g) => g.head.startsWith("Align"))!.items.map((i) => cmd(`layout.${i.id}`, `Align ${i.label}`, i.hint, i.icon, () => actions.layout({ align: i.id.split(":")[1] as AlignKey }), layoutBlocked)),
    ...LAYOUT_MENU.find((g) => g.head.startsWith("Distribute"))!.items.map((i) => cmd(`layout.${i.id}`, `Distribute ${i.label}`, i.hint, i.icon, () => actions.layout({ distribute: i.id.split(":")[1] as "x" | "y" }), () => layoutBlocked() ?? (editor.selection.size < 3 ? "Select three or more." : null))),
    ...LAYOUT_MENU.find((g) => g.head.startsWith("Arrange"))!.items.map((i) => cmd(`layout.${i.id}`, i.label, i.hint, i.icon, () => actions.layout({ grid: i.id.split(":")[1] as SortKey }))),
    ...GAP_ORDER.map((g) => cmd(`layout.gap:${g}`, `Space: ${GAP_LABEL[g].toLowerCase()}`, GAP_HINT[g], `<span class="menu-gap">${GAP_SHORT[g]}</span>`, () => { actions.setGap(g); update(); }, () => (actions.laidOutOrder() !== null ? "Their sheet sets the space." : null))),
    cmd("layout.keepTidy", "Keep it tidy", "As auto layout: it stays a grid", ICONS.autoLayout, () => { actions.setKeepTidy(!actions.keepTidy()); update(); }, () => (actions.laidOutOrder() !== null ? "Their sheet keeps it." : null)),
    cmd("size.reset", "Reset size", "As placed, at this zoom", ICONS.imageUpscale, () => actions.resetSize(), () => sel() ?? (actions.canResetSize() ? null : actions.resetSizeBlock())),
    ...(["w", "h"] as const).flatMap((axis) => (["smallest", "medium", "largest"] as const).map((pick) => {
      const word = axis === "w" ? "Width" : "Height";
      return cmd(`size.match:${axis}:${pick}`, `${word} of the ${pick}`, `All take its ${word.toLowerCase()}, in proportion`, axis === "w" ? ICONS.sameWidth : ICONS.sameHeight, () => actions.matchSize(axis, pick), () => sel() ?? ([...editor.selection].filter((id) => actions.isSizable(id)).length < 2 ? "Select two or more that can be sized." : null));
    })),
    cmd("sheet.each", "Put each on its own sheet", "A sheet for each selected object", ICONS.sheetEach, () => actions.sheetEach(), can(() => actions.canSheetEach(), "Select objects that are not on sheets.")),
    cmd("comic.cutAcross", "Cut across", "Each selected panel in two, a gutter across its middle", ICONS.cutAcross, () => actions.cutPanels("across"), can(() => actions.comicPanels() > 0, "Select panels of a comic page.")),
    cmd("comic.cutDown", "Cut down", "Each selected panel in two, a gutter down its middle", ICONS.cutDown, () => actions.cutPanels("down"), can(() => actions.comicPanels() > 0, "Select panels of a comic page.")),
    cmd("comic.merge", "Merge panels", "The selected panels become one", ICONS.comicPanel, () => actions.mergePanels(), can(() => actions.comicPanels() > 1, "Select two or more panels of one comic page.")),
    cmd("sheet.fit", "Fit the sheet to its contents", "The sheet shrinks or grows to what is on it", ICONS.shrink, () => actions.fitSheet(), can(() => actions.canFitSheet(), "Select a sheet with something on it.")),
    cmd("sheet.autoLayout", "Auto layout", "A row, a column, a wrap or a grid (Shift+A)", ICONS.autoLayout, () => actions.setAutoLayout(actions.autoLayout() !== true), can(() => actions.autoLayout() !== null, "Select a sheet.")),
    cmd("sheet.autoLayoutNew", "Auto layout on a new sheet", "Round them, laid out as a row (Shift+A)", ICONS.autoLayout, () => { closeMoreMenu(); actions.layoutOnSheet(); }),
    cmd("export.again", "Export again", "As last time, no dialog", ICONS.repeat2, () => { closeMoreMenu(); actions.exportAgain(); }, can(() => actions.canExport() && actions.canExportAgain(), "Nothing was exported yet."), { risk: "confirm"}),
    cmd("export.download", "Download the file", "Its file; several go in a ZIP", ICONS.download, () => actions.downloadFile(), can(() => actions.canDownload(), "Select a library file."), { risk: "confirm"}),
    cmd("text.copyMarkdown", "Copy Markdown", "The Markdown of the selected text", ICONS.markdown, () => actions.copyMarkdown(), can(() => [...editor.selection].some((id) => doc.get(id)?.kind === "text"), "Select text.")),
    cmd("state.set", "Set initial state", "To come back to it later", ICONS.stateSet, () => actions.setInitialState(true), can(() => { const st = actions.initialState(); return !!st && st.saved < st.count; }, "Every selected shape has one.")),
    cmd("state.update", "Update initial state", "Save the shape as it is now", ICONS.refresh, () => actions.setInitialState(false), can(() => (actions.initialState()?.saved ?? 0) > 0, "No initial state is saved.")),
    cmd("state.reset", "Reset to initial state", "Back to how it was saved", ICONS.stateReset, () => actions.resetInitialState(), can(() => (actions.initialState()?.saved ?? 0) > 0, "No initial state is saved.")),
    ...OPS.map((o) => cmd(`bool.${o.op}`, o.label, o.aria.slice(o.aria.indexOf(": ") + 2), o.icon, () => actions.combine(o.op), can(() => actions.canCombine() || actions.booleanState() !== null, "Select two or more shapes."))),
    cmd("bool.addToGroup", "Add to the group", "They take the group's operation", ICONS.squarePlus, () => actions.addToGroup(), can(() => actions.groupJoin() === "add", "Select a boolean group and shapes.")),
    cmd("bool.takeOut", "Take out of the group", "The shapes stay where they are", ICONS.squareOut, () => actions.takeOutOfGroup(), can(() => actions.groupJoin() === "out", "Select shapes of a boolean group.")),
    cmd("bool.flatten", "Flatten the boolean group", "Make the group one path (Ctrl+E)", ICONS.merge, () => actions.flattenBoolean(), can(() => actions.booleanState() !== null, "Select a boolean group.")),
    cmd("bool.release", "Release the boolean group", "The shapes stay as they are", ICONS.releaseBoolean, () => actions.releaseBoolean(), can(() => actions.booleanState() !== null, "Select a boolean group.")),
    cmd("path.split", "Split into pieces", "Each outline, with its holes, its own object", ICONS.splitPieces, () => actions.splitPaths(), can(() => actions.canSplitPaths(), "Select a path of several outlines.")),
    cmd("path.simplify", "Simplify", "Fewer nodes, the same shape", ICONS.chartSpline, () => actions.simplify(), can(() => actions.canSimplify(), "Select a path.")),
    cmd("path.strokeToPath", "Pen stroke to path", "Turn the pen stroke into an editable path", ICONS.pencilRuler, () => actions.strokeToPath(), can(() => actions.canStrokeToPath(), "Select a pen stroke.")),
    cmd("text.toPath", "Text to path", "Convert the text to a path (Ctrl+E)", ICONS.replace, () => actions.outline(), can(() => actions.canOutline(), "Select text.")),
    cmd("text.onPath", "Text along a path", "Select the text and the path", ICONS.route, () => actions.setOnPath(), can(() => actions.canSetOnPath(), "Select a text and a path.")),
    cmd("text.inShape", "Text inside the shape", "It flows inside the closed shape", ICONS.textInShape, () => actions.setInShape(), can(() => actions.canSetInShape(), "Select a text and a closed shape.")),
    cmd("text.offPath", "Text off its path or shape", "The text is set straight again", ICONS.routeOff, () => actions.takeOffPath(), can(() => actions.canTakeOffPath(), "Select text on a path or in a shape.")),
    cmd("shape.builderDone", "Done", "Keep what the Shape builder made", ICONS.check, () => actions.finishBuilder(true), () => (editor.builder || editor.gapFill ? null : "The Shape builder is not on.")),
    cmd("shape.builderCancel", "Cancel", "Leave the Shape builder without changes", ICONS.x, () => actions.finishBuilder(false), () => (editor.builder || editor.gapFill ? null : "The Shape builder is not on.")),
    cmd("item.tag", "Tag", "Add tags to the selected", ICONS.tag, () => actions.tag()),
    cmd("item.showInLibrary", "View in the library", "The selected pictures' files in the Library", ICONS.library, () => actions.showInLibrary(), can(() => actions.hasLibraryItems(), "Select a library file.")),
    cmd("item.open", "Open the file", "In the app that opens it on this computer", ICONS.externalLink, () => actions.openFile(), can(() => !!actions.fileSelection()?.open, "Select a library file.")),
    cmd("item.editNote", "Open in its view", "A note, a PDF or a 3D model in its own view", ICONS.filePenLine, () => actions.editNote(), can(() => { const f = actions.fileSelection(); return !!f && (f.note || f.view); }, "Select a note, a PDF or a model.")),
    cmd("item.makeNotes", "Make a note file", "A note file for each selected note card", ICONS.fileInput, () => actions.makeNoteFiles(), can(() => actions.canMakeNoteFiles(), "Select note cards.")),
    cmd("item.attach", "Attach", "Make it follow another object", ICONS.link, () => actions.attach()),
    cmd("picture.vectorise", "Vectorise", "Make the SVG picture shapes you can edit", ICONS.vectorPolygon, () => actions.vectorise(), can(() => actions.svgPicture(), "Select an SVG picture.")),
    cmd("picture.adjust", "Adjust the picture", "Exposure, contrast, colour and more", ICONS.slidersVertical, () => actions.toggleAdjust(), can(() => !!actions.adjustState(), "Select a picture.")),
    cmd("picture.resetAdjust", "Reset adjustments", "The picture as it was", ICONS.listRestart, () => actions.resetAdjust(), can(() => !!actions.adjustState()?.adjusted, "The picture has no adjustments.")),
    cmd("picture.copyAdjust", "Copy adjustments", "To paste on other pictures", ICONS.clipboardList, () => actions.copyAdjust(), picture),
    cmd("picture.pasteAdjust", "Paste adjustments", "The copied adjustments on these pictures", ICONS.clipboardPaste, () => actions.pasteAdjust(), can(() => !!actions.pictureTools()?.canPaste, "No adjustments were copied.")),
    cmd("picture.copyRendered", "Copy as a picture", "As it looks, to paste elsewhere", ICONS.clipboardPlain, () => actions.copyRendered(), can(() => !!actions.pictureTools()?.still, "Select a still picture.")),
    cmd("picture.bake", "Bake", "A new picture file with the changes in it", ICONS.copyPlus, () => actions.bake(), can(() => !!actions.pictureTools()?.still, "Select a still picture.")),
    ...(actions.photoCraft ? [cmd("picture.photocraft", "Edit in PhotoCraft", "In the photo editor", ICONS.photoCraft, () => actions.photoCraft!.run(q("photocraft")), can(() => actions.photoCraft!.offered(), "Select pictures or a sheet."))] : []),
    cmd("item.resetRotation", "Reset rotation", "Straight again", ICONS.rotateCcw, () => actions.resetRotation(), can(() => actions.resettable().turned, "It is not turned.")),
    cmd("item.applyRotation", "Make this the upright", "Its turn becomes its base", ICONS.rotateCwSquare, () => actions.applyRotation(), can(() => actions.resettable().bakeable, "Nothing to make the upright.")),
    cmd("item.resetProportions", "Reset proportions", "Its own width and height again", ICONS.ratio, () => actions.resetProportions(), can(() => actions.resettable().stretched, "It is not stretched.")),
    cmd("item.lock", "Lock or unlock", "So it cannot be moved", ICONS.lockKeyhole, () => actions.setFlag("locked")),
    cmd("item.hide", "Hide or show", "Hidden on this canvas", ICONS.eyeOff, () => actions.setFlag("hidden")),
  ];
  commands.setProvider("actions", barCommands);
  /** The command each plain button of the bar runs (the menus' buttons open their menu; their rows are commands). */
  const CTX_COMMAND: Readonly<Record<string, string>> = {
    builderdone: "shape.builderDone", buildercancel: "shape.builderCancel", tag: "item.tag", library: "item.showInLibrary", open: "item.open", editnote: "item.editNote", viewfile: "item.editNote",
    makenote: "item.makeNotes", attach: "item.attach", detach: "edit.detach", vectorise: "picture.vectorise", adjust: "picture.adjust", adjustreset: "picture.resetAdjust", copyadj: "picture.copyAdjust",
    pasteadj: "picture.pasteAdjust", copypng: "picture.copyRendered", bake: "picture.bake", photocraft: "picture.photocraft", unrotate: "item.resetRotation", baserot: "item.applyRotation",
    unstretch: "item.resetProportions", duplicate: "edit.duplicate", group: "edit.group", ungroup: "edit.ungroup", front: "edit.front", back: "edit.back", lock: "item.lock", hide: "item.hide",
    delete: "edit.delete", find: "find.palette",
  };
  for (const [ctx, id] of Object.entries(CTX_COMMAND)) each(ctx, (b) => (b.dataset["command"] = id));
  /** The names the rows had before they were commands (`data-id`: what tests and scripts choose them by). */
  const ROW_ID: Readonly<Record<string, string>> = {
    "size.reset": "size:reset", "layout.keepTidy": "keeptidy", "edit.sheet": "puton", "sheet.each": "eachsheet", "edit.releaseSheet": "unsheet", "sheet.fit": "fitsheet", "sheet.autoLayout": "autolayout", "sheet.autoLayoutNew": "autolayout",
    "export.open": "exportpic", "export.again": "exportagain", "export.download": "download", "export.svgToLibrary": "svglibrary", "text.copyMarkdown": "copymd", "state.set": "stateset", "state.update": "stateupdate", "state.reset": "statereset",
    "bool.addToGroup": "addgroup", "bool.takeOut": "takeout", "bool.flatten": "flatten", "bool.release": "release", "mask.clip": "clipmask", "mask.alpha": "maskalpha", "mask.luminance": "maskluma", "mask.select": "selectmask",
    "mask.invert": "invertmask", "mask.release": "releasemask", "path.split": "splitpieces", "path.simplify": "simplify", "path.strokeToPath": "strokepath", "path.outline": "outlinestroke", "path.width-taper": "taper",
    "shape.network": "makenet", "shape.releaseNetwork": "releasenet", "shape.divide": "divide", "shape.builder": "shapebuilder", "shape.fillGaps": "fillgaps", "shape.fillGap": "fillgap", "text.toPath": "outline",
    "text.onPath": "onpath", "text.inShape": "inshape", "text.offPath": "offpath",
  };
  const rowId = (id: string): string => ROW_ID[id] ?? id.replace(/^layout\./, "").replace(/^size\.match:/, "size:").replace(/^bool\./, "op:");
  const commandRows = (list: ReadonlyArray<string | readonly [string, Partial<MenuItem>]>): MenuItem[] => rowsOf(list.map((x) => (typeof x === "string" ? ([x, { id: rowId(x) }] as const) : ([x[0], { id: rowId(x[0]), ...x[1] }] as const))));
  const menu = (b: HTMLElement, title: string, items: () => MenuItem[]): void => openMoreMenu(b, items(), title, { keepOpen: true, refresh: items });
  const tick = (id: string, checked: boolean): readonly [string, Partial<MenuItem>] => [id, { checked }];
  const sep = (id: string): readonly [string, Partial<MenuItem>] => [id, { sep: true }];

  bar.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ctx]");
    if (!b || (b as HTMLButtonElement).disabled) return;
    const plain = CTX_COMMAND[b.dataset["ctx"] ?? ""];
    if (plain) return void pressCommand(plain);
    switch (b.dataset["ctx"]) {
      case "alignmenu":
        // One menu for Align and Distribute; it stays open while several are tried (the shared grouped-tools menu, more-menu.ts)
        menu(b, "Align and distribute", () => commandRows(LAYOUT_MENU.filter((g) => /^(Align|Distribute)/.test(g.head)).flatMap((g) => g.items.map((i) => `layout.${i.id}`))));
        break;
      case "sizemenu": {
        // Reset size and the same size as another of the selected, in one menu that stays open; what would change nothing says why
        const ids = (): string[] => [...editor.selection];
        menu(b, "Size", () => commandRows([
          ...(ids().some((id) => actions.isPicture(id)) ? ["size.reset"] : []),
          ...(ids().filter((id) => actions.isSizable(id)).length < 2 ? [] : (["w", "h"] as const).flatMap((axis) => (["smallest", "medium", "largest"] as const).map((pick, i) => (i === 0 ? sep(`size.match:${axis}:${pick}`) : `size.match:${axis}:${pick}`)))),
        ]));
        break;
      }
      case "arrangemenu": {
        // The grid orders and the space between the items in one menu that stays open; the space is ticked
        // (things a sheet lays out: an order is the sheet's rule, ticked when it is the one; the space is the sheet's gap)
        const orders = LAYOUT_MENU.find((g) => g.head.startsWith("Arrange"))!.items;
        menu(b, "Arrange in a grid", () => {
          const order = actions.laidOutOrder();
          if (order !== null) return commandRows(orders.map((i) => [`layout.${i.id}`, { checked: i.id === `grid:${order}`, hint: "The sheet keeps this order" }] as const));
          return commandRows([
            ...orders.map((i) => (actions.keepTidy() ? ([`layout.${i.id}`, { hint: "On a sheet that keeps it" }] as const) : `layout.${i.id}`)),
            ...GAP_ORDER.map((g) => tick(`layout.gap:${g}`, g === actions.gap())),
            ["layout.keepTidy", { sep: true, checked: actions.keepTidy() }] as const,
          ]);
        });
        break;
      }
      case "sheetmenu":
        // Put on a sheet, release it, fit it to what is on it: one menu that stays open; only what applies to the pick is listed
        menu(b, "Sheets", () => commandRows([
          ["edit.sheet", { label: "Put on a sheet", hint: "On a new sheet (Ctrl+Alt+G)", icon: ICONS.sheetSelection }] as const,
          ...(actions.canSheetEach() ? ["sheet.each"] : []),
          ...(actions.canReleaseSheet() ? [["edit.releaseSheet", { hint: "Keeps what is on it", icon: ICONS.releaseSheet }] as const] : []),
          ...(actions.canFitSheet() ? ["sheet.fit"] : []),
          // (a comic page's panels: cut and merge, as the Panel tool does by hand)
          ...(actions.comicPanels() > 0 ? ["comic.cutAcross", "comic.cutDown"] : []),
          ...(actions.comicPanels() > 1 ? ["comic.merge"] : []),
          actions.autoLayout() !== null ? tick("sheet.autoLayout", actions.autoLayout() === true) : "sheet.autoLayoutNew",
        ]));
        break;
      case "exportmenu":
        // What takes the picked things out of the canvas, in one menu that stays open: only what applies to the pick is listed
        menu(b, "Export", () => commandRows([
          ...(actions.canExport() ? [["export.open", { label: "Export…", hint: "PNG, WebP, JPEG, SVG or PDF, at a size", icon: ICONS.imageUp }] as const] : []),
          ...(actions.canExport() && actions.canExportAgain() ? ["export.again"] : []),
          ...(actions.canDownload() ? ["export.download"] : []),
          ...(actions.canExportSvg() ? [["export.svgToLibrary", { label: "Save to library", hint: "An SVG in the library, to place again", icon: ICONS.save }] as const] : []),
          ...([...editor.selection].some((id) => doc.get(id)?.kind === "text") ? ["text.copyMarkdown"] : []),
        ]));
        break;
      case "statemenu":
        // Save, replace or go back to the picked shapes' initial state (ADR 0106): one menu that stays open; only what applies is listed
        menu(b, "Initial state", () => {
          const st = actions.initialState();
          if (!st) return [];
          return commandRows([...(st.saved < st.count ? ["state.set"] : []), ...(st.saved > 0 ? ["state.update", "state.reset"] : [])]);
        });
        break;
      case "boolmenu":
        // The boolean operations, and what to do with the group they make: one menu that stays open and shows the operation in use
        menu(b, "Shapes", () => {
          const cur = actions.booleanState();
          const join = actions.groupJoin();
          return commandRows([
            ...(actions.canCombine() || cur !== null ? OPS.map((o) => tick(`bool.${o.op}`, cur === o.op)) : []),
            ...(join === "add" ? ["bool.addToGroup"] : []),
            ...(join === "out" ? ["bool.takeOut"] : []),
            ...(cur !== null ? [["bool.flatten", { label: "Flatten" }] as const, ["bool.release", { label: "Release" }] as const] : []),
          ]);
        });
        break;
      case "maskmenu":
        menu(b, "Masks", () => commandRows([
          ...(actions.canMakeMask() ? [
            ["mask.clip", { icon: ICONS.venetianMask }] as const,
            ["mask.alpha", { icon: ICONS.circleDashed }] as const,
            ["mask.luminance", { icon: ICONS.contrast }] as const,
          ] : []),
          ...(actions.canReleaseMask() ? [
            ["mask.select", { icon: ICONS.scanEye }] as const,
            ["mask.invert", { hint: "Show what it hides and hide what it shows", icon: ICONS.circleSlash, checked: actions.selectedMask()?.invert ?? false }] as const,
            ["mask.release", { hint: "What it cut is whole again", icon: ICONS.circleMinus }] as const,
          ] : []),
        ]));
        break;
      case "pathmenu": {
        // The tools that make, change or take apart paths and vector shapes, in one menu that stays open; only the ones that apply to the pick are listed
        const free = (): boolean => editor.builder === null && editor.gapFill === null; // (while the Shape builder or Fill a gap is on, Done and Cancel are on the bar)
        menu(b, "Path tools", () => commandRows([
          ...(actions.canSplitPaths() ? ["path.split"] : []),
          ...(actions.canSimplify() ? ["path.simplify"] : []),
          ...(actions.canStrokeToPath() ? ["path.strokeToPath"] : []),
          ...(actions.canOutlineStroke() ? [
            ["path.outline", { hint: "Make the line a shape of its own", icon: ICONS.stamp }] as const,
            ["path.width-taper", { label: "Taper", icon: ICONS.feather }] as const,
          ] : []),
          ...(actions.canMakeNetwork() ? [["shape.network", { icon: ICONS.network }] as const] : []),
          ...(actions.canReleaseNetwork() ? [["shape.releaseNetwork", { hint: "Its edges are an ordinary path again", icon: ICONS.unplug }] as const] : []),
          ...(actions.canDivide() && free() ? [
            ["shape.divide", { label: "Divide", icon: ICONS.slice }] as const,
            ["shape.builder", { icon: ICONS.puzzle }] as const,
          ] : []),
          ...(actions.canFillGaps() && free() ? [
            ["shape.fillGaps", { icon: ICONS.paintRoller }] as const,
            ["shape.fillGap", { label: "Fill a gap…", icon: ICONS.mousePointerClick }] as const,
          ] : []),
          ...(actions.canOutline() ? ["text.toPath"] : []),
          ...(actions.canSetOnPath() ? ["text.onPath"] : []),
          ...(actions.canSetInShape() ? ["text.inShape"] : []),
          ...(actions.canTakeOffPath() ? ["text.offPath"] : []),
        ]));
        break;
      }
    }
  });
  // The bar must not start a drag or a selection change on the canvas below it.
  bar.addEventListener("pointerdown", (e) => e.stopPropagation());

  // "Follows the selection": just under the selection box (above it when there is no room), kept inside the window; at the bottom (the default) the stylesheet places it.
  const follow = (): void => {
    const box = editor.selectionBoxOnScreen;
    const on = placement() === "follow" && box !== null && !bar.hidden;
    wrap.classList.toggle("is-following", on);
    bar.classList.toggle("is-following", on);
    if (!on) {
      wrap.style.left = wrap.style.top = wrap.style.bottom = "";
      // At the bottom a media player may come down onto this bar (its picture is low): the bar then stands just above the player.
      const playerEl = document.querySelector<HTMLElement>("[data-testid=media-bar]:not([hidden])");
      if (box && playerEl && !bar.hidden) {
        const k = uiScale();
        const home = host.getBoundingClientRect();
        const room = home.height / k;
        const playerTop = mediaBarTop(Math.max(...box.frame.corners.map((c) => c[1] / k)), playerEl.offsetHeight, room);
        const mine = bar.getBoundingClientRect();
        const [top, bottom] = [(mine.top - home.top) / k, (mine.bottom - home.top) / k];
        if (bottom > playerTop - MENU_GAP && top < playerTop + playerEl.offsetHeight + MENU_GAP) wrap.style.bottom = `${Math.round(room - playerTop + MENU_GAP)}px`;
      }
      return;
    }
    wrap.style.bottom = "";
    const b = selectionBoxIn(host, editor)!;
    const [w, h, room] = [wrap.offsetWidth, bar.offsetHeight, b.roomH];
    const edge = MENU_GAP;
    // A media player stands right under its picture and never moves from there (ui/media-player.ts): this bar goes above the picture; with no room
    // above, under the player; with no room there either (a picture that fills the view), just above the player, over the picture.
    const playerEl = document.querySelector<HTMLElement>("[data-testid=media-bar]:not([hidden])");
    const at = placeBy(b, w, h, "below", edge, edge, edgeBarsIn(host, wrap)); // (the one rule with the value chips over the selection, ui/near-selection.ts: off the bars on the edges too)
    let top = at.top;
    if (playerEl) {
      const above = b.top - MENU_GAP - h;
      const playerTop = mediaBarTop(b.bottom, playerEl.offsetHeight, room); // (worked out here, not read from the page: it is never a frame behind)
      const handle = 3 * MENU_GAP; // (clear of the picture's name and turn handle)
      const under = playerTop + playerEl.offsetHeight + MENU_GAP;
      top = above - handle >= edge ? above - handle : under + h <= room - edge ? under : Math.max(edge, playerTop - MENU_GAP - h);
    }
    const left = at.left;
    wrap.style.left = `${Math.round(left)}px`;
    wrap.style.top = `${Math.round(top)}px`;
  };
  const update = (): void => {
    const show = !hidden() && editor.selection.size > 0 && (editor.editsSelection || editor.tool === "lasso") && !editor.gesturing;
    if (!show) {
      if (!bar.hidden) bar.hidden = true;
      return;
    }
    const sel = [...editor.selection].map((id) => doc.get(id)).filter((o) => !!o);
    const many = sel.length >= 2;
    q("group").hidden = !many || sel.every((o) => (o!.groups?.length ?? 0) > 0 && new Set(sel.map((x) => x!.groups?.[0])).size === 1);
    q("ungroup").hidden = !sel.some((o) => o!.groups?.length);
    const lined = many || (sel.length === 1 && ((sel[0]!.groups?.length ?? 0) > 0 || sel[0]!.parent !== undefined)); // (one thing inside a group or on a sheet is lined up with it)
    q("arrangemenu").hidden = !many;
    q("alignmenu").hidden = !lined;
    const cur = actions.booleanState();
    const join = actions.groupJoin();
    q("boolmenu").hidden = !(actions.canCombine() || cur !== null || join !== null);
    q("pathmenu").hidden = !(actions.canSimplify() || actions.canStrokeToPath() || actions.canOutlineStroke() || actions.canMakeNetwork() || actions.canReleaseNetwork() || ((actions.canDivide() || actions.canFillGaps()) && editor.builder === null && editor.gapFill === null) || actions.canOutline() || actions.canSetOnPath() || actions.canTakeOffPath());
    for (const k of ["builderdone", "buildercancel"]) q(k).hidden = editor.builder === null && editor.gapFill === null;
    q("maskmenu").hidden = !(actions.canMakeMask() || actions.canReleaseMask());

    const reset = actions.resettable();
    q("library").hidden = !actions.hasLibraryItems();
    const file = actions.fileSelection();
    q("open").hidden = !file?.open;
    q("editnote").hidden = !file?.note;
    q("viewfile").hidden = !file?.view || file.note;
    q("makenote").hidden = !actions.canMakeNoteFiles();
    q("attach").hidden = false;
    q("attach").setAttribute("aria-pressed", String(editor.attachMode));
    q("detach").hidden = !actions.canDetach();
    q("vectorise").hidden = !actions.svgPicture();
    const pic = actions.pictureTools();
    // (Adjust: the Adjust panel, for what can be adjusted; "adjusted" in its name when it is)
    const adj = actions.adjustState();
    q("adjust").hidden = !adj;
    q("adjust").setAttribute("aria-pressed", String(editor.adjustOpen));
    q("adjust").classList.toggle("is-applied", !!adj?.adjusted);
    q("adjust").setAttribute("aria-label", adj?.adjusted ? "Adjust the picture (adjusted)" : "Adjust the picture");
    q("adjustreset").hidden = !adj?.adjusted;
    q("copyadj").hidden = !pic;
    q("pasteadj").hidden = !pic;
    q("pasteadj").disabled = !pic?.canPaste;
    q("copypng").hidden = !pic?.still;
    q("bake").hidden = !pic?.still;
    q("photocraft").hidden = !actions.photoCraft?.offered();
    q("exportmenu").hidden = !(actions.canExport() || actions.canDownload() || actions.canExportSvg() || sel.some((o) => o!.kind === "text"));
    q("statemenu").hidden = !actions.initialState();
    q("unrotate").hidden = !reset.turned;
    q("baserot").hidden = !reset.bakeable;
    q("unstretch").hidden = !reset.stretched;
    q("sizemenu").hidden = !sel.some((o) => o!.kind === "image") && [...editor.selection].filter((id) => actions.isSizable(id)).length < 2;
    // with two or more kinds picked, the kind chosen in the Properties bar shows only its tools (All, or none chosen: everything)
    const kinds = new Set(sel.map((o) => (isContainer(o) ? "sheet" : o!.kind === "path" ? "shape" : o!.kind === "image" ? "picture" : o!.kind))); // (as the Properties bar tells them apart)
    const only = kinds.size > 1 && editor.subject && editor.subject !== "all" ? (BAR_KINDS[editor.subject] ?? null) : null;
    for (const el of bar.querySelectorAll<HTMLElement>("[data-for]")) el.toggleAttribute("data-off", only !== null && !el.dataset["for"]!.split(",").some((k) => only.includes(k)));
    // (a pinned view's bar has only the groups it names: Pins, ADR 0208)
    const groups = onlyGroups();
    bar.hidden = false;
    syncGroups(bar, (g) => !groups || groups.includes(g.getAttribute("aria-label") ?? ""));
    syncScroll(bar);
    if (bar.matches(":hover, :focus-within")) placeNames();
    follow();
  };
  editor.subscribe(update);
  return { update, wrap };
}
