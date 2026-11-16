import type { Command, Options, OptionSpec, Result, Risk } from "../commands/types";
import { REASON } from "../commands/types";

/**
 * The commands of the canvas (ADR 0205): tools, edit, arrange, shape, mask, path, export, view, panels, go to and workspace. Each has a
 * fixed id (the keymap's id when it has a key), a hint, a risk, its options and a reason when it cannot run. What it does is the app's,
 * reached through `CanvasActions`: this file draws nothing and imports no part of the interface, so every command works without its button.
 */
export type Panel = "adjust" | "layers" | "bookmarks" | "pattern" | "styles" | "tags";

/** One item as an outside caller reads it: `box` is its place on the view in px (null when it is off the view). */
export interface ItemRow { id: string; kind: string; name: string; box: { x: number; y: number; w: number; h: number } | null; selected: boolean; hidden?: boolean; locked?: boolean }
export const ITEMS_MAX = 1000;
export const MAKE_KINDS = ["rect", "ellipse", "line", "polygon", "star", "sheet", "text"] as const;
export type MakeKind = (typeof MAKE_KINDS)[number];

export interface CanvasActions {
  onCanvas(): boolean;
  selectionSize(): number;
  readOnly(): boolean;
  select(ids: readonly string[]): void;
  /** Select these items, or add them to the selection (`add`); entering the groups they are in when they are inside one. */
  selectItems(ids: readonly string[], add: boolean): void;
  /** Show (unhide) or unlock these items. */
  clearFlagOn(ids: readonly string[], flag: "hidden" | "locked"): void;
  /** These library files, in the Library. */
  revealInLibrary(hashes: readonly string[]): void;
  /** Every item id on the canvas now (what a command made is told from it). */
  itemIds(): ReadonlySet<string>;
  /** The keys of a command now (Settings > Shortcuts). */
  keys(id: string): string;
  /** The items on the view, every item of the canvas (at most `ITEMS_MAX`), or the selected ones, as an outside caller reads them. */
  items(which: "view" | "all" | "selection"): { rows: ItemRow[]; total: number };
  /** The view's size in px (where `item.create` places things). */
  viewSize(): { width: number; height: number };
  /** Make a shape, a sheet or a text in the box `b` (px of the view), as its tool makes it, selected. Whether it could. */
  make(kind: MakeKind, b: { x: number; y: number; w: number; h: number }, text: string): boolean;
  tools: ReadonlyArray<{ id: string; title: string; use(): void }>;

  undo(): void;
  redo(): void;
  copy(): void;
  copyFile: (() => Promise<void>) | null;
  canCopyFile(): boolean;
  cut(): void;
  paste(): Promise<void>;
  duplicate(): void;
  canRename(): boolean;
  rename(): Promise<void>;
  canDeleteEverywhere(): boolean;
  deleteEverywhere(): Promise<void>;
  deleteSelection(): void;
  anyHidden(): boolean;
  showHidden(): void;
  anyLocked(): boolean;
  unlockAll(): void;
  selectAll(): void;
  canRecolour(): boolean;
  recolour(): Promise<void>;

  group(): void;
  ungroup(): void;
  sheet(): void;
  autoLayout(): void;
  canReleaseSheet(): boolean;
  releaseSheet(): void;
  canFlip(): boolean;
  flip(axis: "x" | "y"): void;
  arrange(to: "front" | "back"): void;
  canDetach(): boolean;
  detach(): void;

  canNetwork(): boolean;
  network(): void;
  canReleaseNetwork(): boolean;
  releaseNetwork(): void;
  canDivide(): boolean;
  divide(): void;
  shapeBuilder(): void;
  canFillGaps(): boolean;
  fillGaps(): void;
  fillGap(): void;

  canMask(): boolean;
  clippingMask(): void;
  mask(kind: "alpha" | "luminance"): void;
  maskEditing(): boolean;
  startPaintedMask(showAll: boolean): void;
  paintMask(mode: "show" | "hide" | "done"): void;
  canReleaseMask(): boolean;
  selectMask(): void;
  invertMask(): void;
  releaseMask(): void;

  canOutline(): boolean;
  outline(): void;
  widthProfile(profile: "taper" | "taper-start" | "taper-end" | "swell" | null): void;

  canSvg(): boolean;
  copySvg(): Promise<void>;
  canExport(): boolean;
  openExport(): void;
  /** Export with these choices and no dialog (as Export again): format, background, quality, padding, and what is done with it. */
  exportNow(change: Readonly<Record<string, unknown>>): void;
  svgToLibrary(): Promise<void>;

  zoom(levels: number): void;
  pan(dir: "left" | "right" | "up" | "down", far: boolean): void;
  step(dir: "left" | "right" | "up" | "down"): void;
  focus(): void;
  flatten(): void;
  search(prefix: "" | "#" | "@"): void;
  searchLibrary(): void;
  palette(): void;
  bookmarkStep(by: 1 | -1): boolean;
  bookmarkGo(index: number): boolean;
  home(): void;
  fit(what: "selection" | "all"): void;
  canBack(): boolean;
  back(): void;
  canForward(): boolean;
  forward(): void;
  randomView(): void;
  toggleZen(): void;
  screenshot(): Promise<void>;
  bookmarkCount(): number;
  tour(): void;
  bookmarkSelection(): void;
  togglePanel(p: Panel): void;
  goTo(view: "canvas" | "assets"): void;
  showShortcuts(): void;

  canvasOpen(): boolean;
  newCanvas(): Promise<void>;
  newBoard(): Promise<void>;
  backup(): Promise<void>;
  switchWorkspace: (() => void) | null;
  checkLibraryFiles: ((quick: boolean) => void) | null;
  hidden: { isOpen(): boolean; lock(): Promise<void> } | null;
}

const IDS: OptionSpec = { name: "ids", type: "ids", doc: "the items to act on (default: the selection)" };
const LEVELS: OptionSpec = { name: "levels", type: "number", doc: "how far: one level is twice as close (default 1)", min: 0.01, max: 60 };

export function canvasCommands(a: CanvasActions): Command[] {
  const canvas = (): string | null => (a.onCanvas() ? null : REASON.notOnCanvas);
  const picked = (): string | null => canvas() ?? (a.selectionSize() > 0 ? null : REASON.noSelection);
  const when = (base: () => string | null, ok: () => boolean, no: string) => (): string | null => base() ?? (ok() ? null : no);
  const writable = (base: () => string | null) => (): string | null => base() ?? (a.readOnly() ? REASON.readOnly : null);

  /** A command on the selected items: `ids` picks them first; what it made is told by the ids that are new after it. */
  const onItems = (fn: () => void | Promise<void>) => async (o: Options): Promise<Result> => {
    const ids = o["ids"] as string[] | undefined;
    if (ids) {
      const there = a.itemIds();
      const gone = ids.filter((id) => !there.has(id));
      if (gone.length) return { ok: false, error: `No item ${gone.slice(0, 3).map((g) => `"${g}"`).join(", ")} on this canvas.` };
      a.select(ids);
    }
    const before = a.itemIds();
    await fn();
    const made = [...a.itemIds()].filter((id) => !before.has(id));
    return made.length ? { ok: true, made } : { ok: true };
  };
  const cmd = (id: string, group: string, title: string, hint: string, risk: Risk, why: () => string | null, exec: NonNullable<Command["exec"]>, extra: Partial<Command> = {}): Command => {
    const keys = a.keys(id);
    return { id, group, title, hint, risk, why, exec, ...(keys ? { keys } : {}), ...extra };
  };
  const item = (id: string, group: string, title: string, hint: string, fn: () => void | Promise<void>, why: () => string | null = picked, extra: Partial<Command> = {}): Command =>
    cmd(id, group, title, hint, "edit", why, onItems(fn), { options: [IDS], ...extra });

  const list: Command[] = [
    ...a.tools.map((t) => cmd(t.id, "Tool", t.title, `Use the ${t.title.replace(/ \(.*\)$/, "").toLowerCase()} tool`, "edit", canvas, () => t.use())),
    cmd("edit.undo", "Edit", "Undo", "Take back the last change", "edit", canvas, () => a.undo(), { keys: a.keys("edit.undo") || "Ctrl+Z", words: "back revert" }),
    cmd("edit.redo", "Edit", "Redo", "Do it again", "edit", canvas, () => a.redo(), { keys: a.keys("edit.redo") || "Ctrl+Shift+Z", words: "again" }),
    cmd("edit.recolourOldInk", "Edit", "Change the old default ink to the canvas ink", "Old near-black drawings readable again", "edit", when(canvas, a.canRecolour, "Nothing has the old default ink."), () => a.recolour(), { words: "recolour near-black dark outline theme light old drawings readable" }),
    item("edit.copy", "Edit", "Copy", "To paste elsewhere", () => a.copy(), picked, { keys: "Ctrl+C"}),
    ...(a.copyFile ? [item("edit.copyFile", "Edit", "Copy file", "The real file, for a file manager", () => a.copyFile!(), when(picked, a.canCopyFile, "No library file is selected."), { words: "real file clipboard file manager"})] : []),
    item("edit.cut", "Edit", "Cut", "Copy, then remove", () => a.cut(), picked, { keys: "Ctrl+X" }),
    cmd("edit.paste", "Edit", "Paste", "From the clipboard", "edit", canvas, onItems(() => a.paste()), { keys: "Ctrl+V" }),
    item("edit.duplicate", "Edit", "Duplicate", "A copy beside it", () => a.duplicate(), picked, { words: "copy" }),
    item("edit.rename", "Edit", "Rename", "Give it a new name", () => a.rename(), writable(when(canvas, a.canRename, "No picture is selected.")), { words: "file name picture image library layer" }),
    cmd("edit.deleteEverywhere", "Edit", "Delete everywhere", "From every canvas and the library", "confirm", writable(when(picked, a.canDeleteEverywhere, "No library file is selected.")), onItems(() => a.deleteEverywhere()), { options: [IDS], words: "remove erase library every canvas file", asks: true }),
    cmd("edit.delete", "Edit", "Delete the selection", "From this canvas", "confirm", picked, onItems(() => a.deleteSelection()), { options: [IDS], words: "remove erase" }),
    cmd("edit.showHidden", "Edit", "Show all hidden", "Items hidden on this canvas", "edit", when(canvas, a.anyHidden, "Nothing is hidden on this canvas."), () => a.showHidden(), { words: "unhide reveal eye" }),
    cmd("edit.unlockAll", "Edit", "Unlock all", "So they can be moved", "edit", when(canvas, a.anyLocked, "Nothing is locked."), () => a.unlockAll(), { words: "unlock locked" }),
    cmd("select.items", "Edit", "Select items", "These items, or add them to the selection", "edit", canvas, (o) => {
      const ids = o["ids"] as string[];
      const there = a.itemIds();
      const gone = ids.filter((id) => !there.has(id));
      if (gone.length) return { ok: false, error: `No item ${gone.slice(0, 3).map((g) => `"${g}"`).join(", ")} on this canvas.` };
      a.selectItems(ids, o["add"] === true);
      return { ok: true };
    }, { options: [{ name: "ids", type: "ids", doc: "the items", required: true }, { name: "add", type: "boolean", doc: "add them to what is selected" }] }),
    ...(["hidden", "locked"] as const).map((flag) => cmd(flag === "hidden" ? "item.unhide" : "item.unlock", "Edit", flag === "hidden" ? "Show items" : "Unlock items", flag === "hidden" ? "Hidden items on this canvas, shown again" : "So they can be moved", "edit", canvas, (o) => a.clearFlagOn(o["ids"] as string[], flag), { options: [{ name: "ids", type: "ids", doc: "the items", required: true }] })),
    cmd("library.reveal", "Go to", "Show in the Library", "These files, in the Library", "edit", () => null, (o) => a.revealInLibrary(o["hashes"] as string[]), { options: [{ name: "hashes", type: "ids", doc: "the library files", required: true }] }),
    cmd("edit.selectAll", "Edit", "Select everything", "All on this canvas", "edit", canvas, () => a.selectAll(), { words: "all"}),
    cmd("item.create", "Edit", "Make an item", "A shape, a sheet or a text, at a place on the view", "edit", writable(canvas), (o) => {
      const v = a.viewSize();
      const kind = o["kind"] as MakeKind;
      const w = typeof o["w"] === "number" ? o["w"] : kind === "text" ? 320 : 240;
      const h = typeof o["h"] === "number" ? o["h"] : kind === "line" ? 0 : 160;
      const x = typeof o["x"] === "number" ? o["x"] : (v.width - w) / 2;
      const y = typeof o["y"] === "number" ? o["y"] : (v.height - h) / 2;
      const text = typeof o["text"] === "string" ? o["text"].trim() : "";
      if (kind === "text" && !text) return { ok: false, error: "A text needs its words (text)." };
      if (kind !== "text" && Math.hypot(w, h) < 4) return { ok: false, error: "Too small to make: give w and h of a few px at least." };
      const before = a.itemIds();
      if (!a.make(kind, { x, y, w, h }, text)) return { ok: false, error: "Nothing could be made now (a tool is in use, or the canvas cannot be changed)." };
      const made = [...a.itemIds()].filter((id) => !before.has(id));
      return made.length ? { ok: true, made } : { ok: false, error: "Nothing was made." };
    }, { options: [
      { name: "kind", type: "choice", doc: "what to make", choices: MAKE_KINDS, required: true },
      { name: "x", type: "number", doc: "its left, in px of the view (default: centred)", min: -100000, max: 100000 },
      { name: "y", type: "number", doc: "its top, in px of the view (default: centred)", min: -100000, max: 100000 },
      { name: "w", type: "number", doc: "its width in px (default 240; a line goes from x, y to x + w, y + h)", min: -100000, max: 100000 },
      { name: "h", type: "number", doc: "its height in px (default 160)", min: -100000, max: 100000 },
      { name: "text", type: "text", doc: "a text's words (Markdown)" },
    ], words: "add new draw create shape rectangle ellipse line star sheet frame text" }),
    cmd("read.items", "Read", "List the items", "Their id, kind, name and place on the view", "read", canvas, (o) => {
      const { rows, total } = a.items(o["all"] === true ? "all" : "view");
      return { ok: true, value: { items: rows, total }, ...(rows.length < total ? { note: `The first ${rows.length} of ${total}.` } : {}) };
    }, { options: [{ name: "all", type: "boolean", doc: `every item of the canvas, not only those on the view (at most ${ITEMS_MAX.toLocaleString()})` }] }),
    cmd("read.selection", "Read", "List the selected items", "Their id, kind, name and place on the view", "read", canvas, () => {
      const { rows, total } = a.items("selection");
      return { ok: true, value: { items: rows, total } };
    }),

    item("edit.group", "Arrange", "Group", "Move them as one", () => a.group()),
    item("edit.ungroup", "Arrange", "Ungroup", "Separate them again", () => a.ungroup()),
    item("edit.sheet", "Arrange", "Put the selection on a sheet", "A frame around them", () => a.sheet(), picked, { words: "frame wrap", keys: a.keys("edit.sheet") || "Ctrl+Alt+G" }),
    item("edit.autoLayout", "Arrange", "Auto layout", "Lay them out in a row, a column or a grid", () => a.autoLayout(), picked, { words: "flow row column wrap grid hug gap padding flex" }),
    item("edit.releaseSheet", "Arrange", "Release the sheet", "Its items stay where they are", () => a.releaseSheet(), when(canvas, a.canReleaseSheet, "No sheet is selected."), { words: "unframe" }),
    item("edit.flipH", "Arrange", "Flip horizontally", "Mirror left to right", () => a.flip("x"), when(canvas, a.canFlip, "Nothing that flips is selected."), { words: "mirror reverse" }),
    item("edit.flipV", "Arrange", "Flip vertically", "Mirror top to bottom", () => a.flip("y"), when(canvas, a.canFlip, "Nothing that flips is selected."), { words: "mirror upside down" }),
    item("edit.flatten", "Arrange", "Flatten", "Text to paths, a boolean group to one path", () => a.flatten()),
    item("edit.front", "Arrange", "Bring to front", "Above everything", () => a.arrange("front")),
    item("edit.back", "Arrange", "Send to back", "Behind everything", () => a.arrange("back")),
    item("edit.detach", "Arrange", "Detach from what it follows", "It stays where it is", () => a.detach(), when(canvas, a.canDetach, "Nothing selected follows another item.")),

    item("shape.network", "Shape", "Vector network", "Join paths into one network", () => a.network(), when(canvas, a.canNetwork, "Select paths to join."), { words: "join paths regions graph" }),
    item("shape.releaseNetwork", "Shape", "Release the network", "Back to separate paths", () => a.releaseNetwork(), when(canvas, a.canReleaseNetwork, "No network is selected."), { words: "paths edges" }),
    item("shape.divide", "Shape", "Divide into regions", "Cut overlapping shapes apart", () => a.divide(), when(canvas, a.canDivide, "Select overlapping shapes."), { words: "pathfinder cut overlap" }),
    item("shape.builder", "Shape", "Shape builder", "Merge or delete regions by clicking", () => a.shapeBuilder(), when(canvas, a.canDivide, "Select overlapping shapes."), { words: "merge regions overlap unite delete" }),
    item("shape.fillGaps", "Shape", "Fill gaps", "Fill every enclosed space", () => a.fillGaps(), when(canvas, a.canFillGaps, "Select drawn lines around a space."), { words: "holes empty space between enclosed paint bucket" }),
    item("shape.fillGap", "Shape", "Fill a gap", "Click the space to fill", () => a.fillGap(), when(canvas, a.canFillGaps, "Select drawn lines around a space."), { words: "hole empty space between enclosed paint bucket click" }),

    item("mask.clip", "Mask", "Clipping mask", "Show the pictures only inside the top shape", () => a.clippingMask(), when(canvas, a.canMask, "Select a shape over pictures."), { words: "clip cut shape" }),
    item("mask.alpha", "Mask", "Mask by opacity", "The top item's opacity hides the rest", () => a.mask("alpha"), when(canvas, a.canMask, "Select a shape over pictures."), { words: "alpha cut transparent" }),
    item("mask.luminance", "Mask", "Mask by brightness", "The top item's brightness hides the rest", () => a.mask("luminance"), when(canvas, a.canMask, "Select a shape over pictures."), { words: "luminance greyscale light dark cut" }),
    item("mask.paintedShow", "Mask", "Painted mask: show everything, paint black to hide", "Then paint to hide", () => a.startPaintedMask(true), when(picked, () => !a.maskEditing(), "A mask is being painted."), { words: "paint erase reveal" }),
    item("mask.paintedHide", "Mask", "Painted mask: hide everything, paint white to show", "Then paint to show", () => a.startPaintedMask(false), when(picked, () => !a.maskEditing(), "A mask is being painted."), { words: "paint reveal" }),
    cmd("mask.paintWhite", "Mask", "Paint the mask in white", "Paint to show", "edit", when(canvas, a.maskEditing, "No mask is being painted."), () => a.paintMask("show"), { words: "show reveal" }),
    cmd("mask.paintBlack", "Mask", "Paint the mask in black", "Paint to hide", "edit", when(canvas, a.maskEditing, "No mask is being painted."), () => a.paintMask("hide"), { words: "hide" }),
    cmd("mask.paintDone", "Mask", "Done painting the mask", "Keep the painted mask", "edit", when(canvas, a.maskEditing, "No mask is being painted."), () => a.paintMask("done"), { words: "finish stop" }),
    item("mask.select", "Mask", "Select the mask", "To move or edit it", () => a.selectMask(), when(canvas, a.canReleaseMask, "No masked item is selected."), { words: "select edit move"}),
    item("mask.invert", "Mask", "Invert the mask", "Swap what shows and what hides", () => a.invertMask(), when(canvas, a.canReleaseMask, "No masked item is selected."), { words: "swap show hide" }),
    item("mask.release", "Mask", "Release the mask", "Everything shows again", () => a.releaseMask(), when(canvas, a.canReleaseMask, "No masked item is selected."), { words: "remove unmask" }),

    item("path.outline", "Path", "Outline stroke", "Turn the line into a shape", () => a.outline(), when(canvas, a.canOutline, "Select a path with a stroke."), { words: "stroke to shape expand" }),
    ...(["taper", "taper-start", "taper-end", "swell"] as const).map((p) => item(`path.width-${p}`, "Path", `Width: ${p.replace("-", " ")}`, "A line that changes width", () => a.widthProfile(p), when(canvas, a.canOutline, "Select a path with a stroke."), { words: "variable width thin thick shape" })),
    item("path.width-even", "Path", "Width: even", "One width all along", () => a.widthProfile(null), when(canvas, a.canOutline, "Select a path with a stroke."), { words: "variable width taper remove" }),

    item("export.copySvg", "Export", "Copy the selection as SVG", "Vector text to paste", () => a.copySvg(), when(canvas, a.canSvg, "Select shapes or paths."), { words: "vector clipboard text"}),
    cmd("export.open", "Export", "Export… (choose a size)", "Save as a picture file", "edit", when(canvas, a.canExport, "Select what to export, or open a canvas."), () => a.openExport(), { words: "picture png jpeg webp size dpi print sheet image save"}),
    cmd("export.picture", "Export", "Export the selection as a picture", "With these choices, no dialog", "confirm", when(canvas, a.canExport, "Select what to export, or open a canvas."), (o) => {
      const change: Record<string, unknown> = {};
      if (o["format"]) change["format"] = o["format"];
      if (o["background"]) change["bg"] = o["background"];
      if (o["quality"] !== undefined) change["quality"] = o["quality"];
      if (o["padding"] !== undefined) change["pad"] = o["padding"];
      if (o["action"]) change["action"] = o["action"];
      a.exportNow(change);
    }, { options: [
      { name: "format", type: "choice", doc: "the file's kind", choices: ["png", "webp", "jpeg", "svg", "pdf"] },
      { name: "background", type: "text", doc: "transparent, white, black or #rrggbb" },
      { name: "quality", type: "number", doc: "JPEG and WebP quality", min: 10, max: 100 },
      { name: "padding", type: "number", doc: "room around it, in px", min: 0, max: 1000 },
      { name: "action", type: "choice", doc: "download it, copy it, or put it in the library", choices: ["download", "copy", "library"] },
    ] }),
    item("export.svgToLibrary", "Export", "Save the selection to the library as SVG", "A new library item", () => a.svgToLibrary(), when(canvas, a.canSvg, "Select shapes or paths."), { words: "vector assets" }),

    cmd("view.zoomIn", "View", "Zoom in", "Closer", "edit", canvas, (o) => a.zoom(Number(o["levels"] ?? 1)), { keys: a.keys("view.zoomIn") || "+", options: [LEVELS] }),
    cmd("view.zoomOut", "View", "Zoom out", "Further away", "edit", canvas, (o) => a.zoom(-Number(o["levels"] ?? 1)), { keys: a.keys("view.zoomOut") || "−", options: [LEVELS] }),
    ...(["left", "right", "up", "down"] as const).map((d) =>
      cmd(`view.pan${d[0]!.toUpperCase()}${d.slice(1)}`, "View", `Pan ${d}`, `Move the view ${d}`, "edit", canvas, (o) => a.pan(d, o["far"] === true), { options: [{ name: "far", type: "boolean", doc: "half the view at once, not an eighth" }] }),
    ),
    ...(["up", "left", "down", "right"] as const).map((d) => cmd(`nav.${d}`, "View", `Step ${d}`, `To the nearest item ${d === "up" || d === "down" ? (d === "up" ? "above" : "below") : `on the ${d}`}`, "edit", canvas, () => a.step(d))),
    cmd("find.canvas", "Find", "Search the canvas", "By file or layer name", "read", canvas, () => a.search(""), { words: "find name layer file" }),
    cmd("find.tag", "Find", "Search the canvas by tag", "Items with a tag", "read", canvas, () => a.search("#"), { words: "find tag" }),
    cmd("find.bookmark", "Find", "Search the canvas for a bookmark", "Go to a bookmark by name", "read", canvas, () => a.search("@"), { words: "find bookmark" }),
    cmd("find.library", "Find", "Search the library", "Go to the Library and search it", "read", () => null, () => a.searchLibrary(), { words: "find assets files" }),
    cmd("find.palette", "Find", "The command palette", "Every command, by name", "read", () => null, () => a.palette(), { words: "commands" }),
    cmd("bookmark.prev", "View", "Go to the previous bookmark", "The bookmark before", "edit", when(canvas, () => a.bookmarkCount() > 0, "There are no bookmarks."), () => (a.bookmarkStep(-1) ? { ok: true } : { ok: false, error: "That bookmark's place no longer exists." })),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => cmd(`bookmark.${n}`, "View", `Go to bookmark ${n}`, `The bookmark at place ${n} in the list`, "edit", when(canvas, () => a.bookmarkCount() >= n, `There is no bookmark ${n}.`), () => (a.bookmarkGo(n - 1) ? { ok: true } : { ok: false, error: "That bookmark's place no longer exists." }))),
    cmd("bookmark.next", "View", "Go to the next bookmark", "The bookmark after", "edit", when(canvas, () => a.bookmarkCount() > 0, "There are no bookmarks."), () => (a.bookmarkStep(1) ? { ok: true } : { ok: false, error: "That bookmark's place no longer exists." })),
    cmd("view.home", "View", "Return to the origin", "Back to the start", "edit", canvas, () => a.home(), { keys: a.keys("view.home") || "0", words: "home reset"}),
    cmd("view.focus", "View", "Fit the selection in view", "Again: everything visible", "edit", canvas, () => a.focus(), { keys: a.keys("view.focus") || "F"}),
    cmd("view.fitAll", "View", "Fit everything in view", "Zoom to see it all", "edit", canvas, () => a.fit("all")),
    cmd("view.fitSelection", "View", "Zoom to the selection", "The selected items fill the view", "edit", picked, () => a.fit("selection")),
    cmd("view.back", "View", "Previous view", "Where the view was before", "edit", when(canvas, a.canBack, "There is no earlier view."), () => a.back(), { words: "back camera"}),
    cmd("view.forward", "View", "Next view", "Where the view went next", "edit", when(canvas, a.canForward, "There is no later view."), () => a.forward(), { words: "forward camera"}),
    cmd("view.random", "View", "Go to a random empty view", "Somewhere far away and empty", "edit", canvas, () => a.randomView(), { words: "dice random far away"}),
    cmd("view.zen", "View", "Zen mode", "Hide the bars, or show them", "edit", () => null, () => a.toggleZen(), { keys: a.keys("view.zen"), words: "focus hide bars" }),
    cmd("view.screenshot", "View", "Take a screenshot", "A picture of the view, to the library", "edit", canvas, () => a.screenshot(), { words: "picture capture" }),
    cmd("view.tour", "View", "Play the bookmarks as a tour", "One bookmark after another", "edit", when(canvas, () => a.bookmarkCount() > 0, "There are no bookmarks."), () => a.tour(), { words: "present"}),
    item("bookmark.selection", "View", "Bookmark the selected objects", "A bookmark that frames them", () => a.bookmarkSelection(), picked, { words: "save view selection" }),
    ...(["adjust", "layers", "bookmarks", "pattern", "styles", "tags"] as const).map((p) =>
      cmd(`panel.${p}`, "Panel", p[0]!.toUpperCase() + p.slice(1), `Show or hide the ${p} panel`, "edit", canvas, () => a.togglePanel(p), { words: "toggle show hide"}),
    ),
    cmd("go.canvas", "Go to", "Canvas view", "The endless canvas", "edit", () => null, () => a.goTo("canvas")),
    cmd("go.library", "Go to", "Library", "Every file of the workspace", "edit", () => null, () => a.goTo("assets"), { words: "assets files pictures"}),
    cmd("find.help", "Go to", "Shortcuts", "The list of keys", "edit", () => null, () => a.showShortcuts(), { keys: a.keys("find.help") || "?", words: "keys keyboard help"}),

    cmd("workspace.newCanvas", "Workspace", "New canvas", "On this board", "edit", () => (a.canvasOpen() ? null : REASON.noCanvas), () => a.newCanvas(), { words: "add" }),
    cmd("workspace.newBoard", "Workspace", "New board", "With its first canvas", "edit", () => null, () => a.newBoard(), { words: "add" }),
    cmd("workspace.backup", "Workspace", "Export a backup (.canvast)", "The whole workspace in one file", "confirm", () => null, () => a.backup(), { words: "save archive", job: true }),
  ];
  if (a.switchWorkspace) {
    const sw = a.switchWorkspace;
    list.push(cmd("workspace.switch", "Workspace", "Switch workspace…", "Open another workspace folder", "confirm", () => null, () => sw(), { words: "open folder new recent workspace change"}));
  }
  if (a.checkLibraryFiles) {
    const check = a.checkLibraryFiles;
    list.push(
      cmd("workspace.checkFiles", "Workspace", "Check library files", "Find damaged or missing files", "read", () => null, () => check(false), { words: "verify damaged corrupt missing integrity hash folder", job: true }),
      cmd("workspace.checkFilesQuick", "Workspace", "Check library files (quick)", "Find missing files by size", "read", () => null, () => check(true), { words: "verify damaged missing size fast folder", job: true }),
    );
  }
  if (a.hidden) {
    const h = a.hidden;
    list.push(cmd("hidden.lock", "Workspace", "Lock hidden items", "Hide them again behind the password", "edit", () => (h.isOpen() ? null : REASON.hiddenLocked), () => h.lock(), { words: "encrypt password hide close" }));
  }
  return list;
}

/** The ids the canvas commands had before they had fixed ones (made from kind and title): old macros still find them. */
export const OLD_CANVAS_IDS: Readonly<Record<string, string>> = {
  "edit:undo": "edit.undo", "edit:redo": "edit.redo", "edit:copy": "edit.copy", "edit:copy-file": "edit.copyFile", "edit:cut": "edit.cut", "edit:paste": "edit.paste",
  "edit:duplicate": "edit.duplicate", "edit:rename": "edit.rename", "edit:delete-everywhere": "edit.deleteEverywhere", "edit:delete-the-selection": "edit.delete",
  "edit:show-all-hidden": "edit.showHidden", "edit:unlock-all": "edit.unlockAll", "edit:select-everything": "edit.selectAll",
  "arrange:group": "edit.group", "arrange:ungroup": "edit.ungroup", "arrange:put-the-selection-on-a-sheet": "edit.sheet", "arrange:auto-layout": "edit.autoLayout",
  "arrange:release-the-sheet": "edit.releaseSheet", "arrange:flip-horizontally": "edit.flipH", "arrange:flip-vertically": "edit.flipV", "arrange:bring-to-front": "edit.front",
  "arrange:send-to-back": "edit.back", "arrange:detach-from-what-it-follows": "edit.detach", "shape:vector-network": "shape.network", "shape:release-the-network": "shape.releaseNetwork",
  "shape:divide-into-regions": "shape.divide", "shape:shape-builder": "shape.builder", "shape:fill-gaps": "shape.fillGaps", "shape:fill-a-gap": "shape.fillGap",
  "mask:clipping-mask": "mask.clip", "mask:mask-by-opacity": "mask.alpha", "mask:mask-by-brightness": "mask.luminance", "mask:select-the-mask": "mask.select",
  "mask:invert-the-mask": "mask.invert", "mask:release-the-mask": "mask.release", "path:outline-stroke": "path.outline",
  "export:copy-the-selection-as-svg": "export.copySvg", "export:save-the-selection-to-the-library-as-svg": "export.svgToLibrary",
  "find:find-canvas": "find.canvas", "view:zoom-in": "view.zoomIn", "view:zoom-out": "view.zoomOut", "view:return-to-the-origin": "view.home", "view:fit-the-selection-in-view": "view.focus",
  "view:fit-everything-in-view": "view.fitAll", "view:previous-view": "view.back", "view:next-view": "view.forward", "view:go-to-a-random-empty-view": "view.random",
  "view:zen-mode": "view.zen", "view:take-a-screenshot": "view.screenshot", "view:play-the-bookmarks-as-a-tour": "view.tour", "view:bookmark-the-selected-objects": "bookmark.selection",
  "panel:adjust": "panel.adjust", "panel:layers": "panel.layers", "panel:bookmarks": "panel.bookmarks", "panel:pattern": "panel.pattern", "panel:styles": "panel.styles", "panel:tags": "panel.tags",
  "go:canvas-view": "go.canvas", "go:library": "go.library", "go:shortcuts": "find.help", "workspace:new-canvas": "workspace.newCanvas", "workspace:new-board": "workspace.newBoard",
  "workspace:export-a-backup-canvast": "workspace.backup", "workspace:lock-hidden-items": "hidden.lock",
};
