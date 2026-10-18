import type { EditorState } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import type { LayoutCommand } from "../app/actions";
import type { AlignKey, SortKey } from "../doc/arrange";
import { ICONS } from "./icons";
import { GAP_LABEL, GAP_ORDER } from "../doc/arrange";
import type { GapKey } from "../doc/arrange";
import { LAYOUT_MENU } from "./toolbar";
import { syncGroups } from "./bar";
import { closeMoreMenu, openMoreMenu } from "./more-menu";
import type { MenuItem } from "./more-menu";
import type { BoolOp } from "../doc/boolean";

/**
 * The Actions bar (ADR 0051, 0128): what you can DO to the selection, in one row at a fixed place (bottom centre, above the readout), never
 * attached to an item, so it neither covers the picture nor jumps about. The row is made of groups that show when they apply: Duplicate,
 * group, tag, library and file actions, resets, text to path, shapes combined (a button for each operation), sheet and attach commands,
 * align, distribute and grid with the space between items, order, lock, hide, delete. Nothing is in a menu. What the selection LOOKS like
 * (colour, size, font) is the Properties bar's, at the top.
 */
export interface ContextActions {
  duplicate(): void;
  /** Take the turn off the selection; give stretched pictures their own proportions back. */
  resetRotation(): void;
  resetProportions(): void;
  /** What the selection can be reset from. */
  resettable(): { turned: boolean; stretched: boolean };
  /** The one selected item is a file the app cannot show (kept as a card): its asset, and whether a tab can open it (ADR 0078). */
  fileSelection(): { hash: string; open: boolean } | null;
  /** Any file of the library is picked: its original can be downloaded (several as a ZIP; ADR 0119). */
  canDownload(): boolean;
  /** Put the picked objects on a sheet; take a picked sheet away, keeping what is on it (ADR 0108). */
  releaseSheet(): void;
  canReleaseSheet(): boolean;
  putOnSheet(): void;
  fitSheet(): void;
  canFitSheet(): boolean;
  /** Attach the picked objects to the object clicked next, and detach them (ADR 0109). */
  attach(): void;
  detach(): void;
  canDetach(): boolean;
  /** Copy the Markdown of the picked texts. */
  copyMarkdown(): void;
  pictureTools(): { still: boolean; canPaste: boolean } | null;
  copyAdjust(): void;
  pasteAdjust(): void;
  copyRendered(): void;
  bake(): void;
  /** A picked SVG picture: its shapes can be made into vectors (a copy beside it). */
  svgPicture(): boolean;
  vectorise(): void;
  /** Picked paths can be saved as an SVG file. */
  canExportSvg(): boolean;
  exportSvg(): void;
  /** Export…: choose a size (from the shape) and save a sheet, a picture or shapes as a picture file (ADR 0147). */
  canExport(): boolean;
  exportPicture(): void;
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
  finishBuilder(apply: boolean): void;
  canDivide(): boolean;
  changeMask(change: { invert?: boolean; release?: true }): void;
  selectMask(): void;
  canReleaseMask(): boolean;
  selectedMask(): { mode: "alpha" | "luminance"; invert: boolean } | null;
  /** Set a picked text along a picked path (both picked), and take a text off its path (ADR 0131). */
  setOnPath(): void;
  canSetOnPath(): boolean;
  takeOffPath(): void;
  canTakeOffPath(): boolean;
  /** Arrange in a grid, align or distribute the selection. */
  layout(cmd: LayoutCommand): void;
  /** The space between items in a grid (ADR 0074), and choosing another one (a grid just made is laid out again with it). */
  gap(): GapKey;
  setGap(gap: GapKey): void;
  setFlag(flag: "hidden" | "locked"): void;
  deleteSelection(): void;
}

const GAP_HINT: Record<GapKey, string> = { none: "Items touch", tight: "A thin space between items", normal: "A normal space between items", wide: "A wide space between items", wider: "The widest space between items" };
const GAP_SHORT: Record<GapKey, string> = { none: "0", tight: "S", normal: "M", wide: "L", wider: "XL" };
const OPS: Array<{ op: BoolOp; icon: string; label: string; aria: string }> = [
  { op: "union", icon: ICONS.squaresUnite, label: "Union", aria: "Union: join the shapes into one" },
  { op: "intersect", icon: ICONS.squaresIntersect, label: "Intersect", aria: "Intersect: keep only where the shapes overlap" },
  { op: "subtract", icon: ICONS.squaresSubtract, label: "Subtract", aria: "Subtract: take the shapes in front away from the one at the back" },
  { op: "exclude", icon: ICONS.squaresExclude, label: "Exclude overlap", aria: "Exclude overlap: keep everything but where the shapes overlap" },
];

export function mountContextBar(host: HTMLElement, editor: EditorState, doc: DocumentStore, actions: ContextActions, hidden: () => boolean): { update(): void } {
  const bar = document.createElement("div");
  bar.className = "ctx-bar";
  bar.dataset["testid"] = "context-bar";
  bar.dataset["cmdGroup"] = "Actions";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Selection actions");
  bar.hidden = true;
  const btn = (act: string, icon: string, label: string, extra = ""): string => `<button type="button" data-ctx="${act}" ${extra} aria-label="${label}" title="${label}">${icon}</button>`;
  const group = (name: string, ...items: string[]): string => `<div class="tb-group" role="group" aria-label="${name}">${items.join("")}</div>`;
  const layoutButtons = (head: string): string =>
    LAYOUT_MENU.find((g) => g.head.startsWith(head))!.items.map((i) => btn("layout", i.icon, head === "Align" ? `Align ${i.label.toLowerCase()}` : head === "Arrange" ? `Arrange in a grid: ${i.label.toLowerCase()}` : `Distribute ${i.label.toLowerCase()}`, `data-layout="${i.id}"`)).join("");
  bar.innerHTML =
    `<div class="tb-group ctx-kinds" role="group" aria-label="Show the tools for" data-kinds-bar hidden></div>` +
    group("Items", btn("duplicate", ICONS.copy, "Duplicate"), btn("group", ICONS.group, "Group"), btn("ungroup", ICONS.ungroup, "Ungroup"), btn("tag", ICONS.tag, "Tag the selection")) +
    group("Files",
      btn("library", ICONS.library, "View in the library"),
      btn("download", ICONS.download, "Download the original file (several files: one ZIP; an edited picture comes with its original)"),
      btn("open", ICONS.externalLink, "Open in a new tab"),
      btn("copyadj", ICONS.clipboardList, "Copy the adjustments of the picture"),
      btn("pasteadj", ICONS.clipboardPaste, "Paste the copied adjustments on the picked pictures"),
      btn("copypng", ICONS.clipboardPlain, "Copy the picture to the clipboard as it looks now (crop and adjustments included)"),
      btn("bake", ICONS.copyPlus, "Make a new picture of it as it looks now, beside it"),
      btn("vectorise", ICONS.vectorPolygon, "Make editable vector shapes from this SVG picture (the picture stays)"),
      btn("exportpic", ICONS.imageUp, "Export…: choose a size and save it as a picture (PNG, WebP, JPEG or SVG)"),
      btn("exportsvg", ICONS.fileCode, "Save the shapes as an SVG file"),
      btn("copymd", ICONS.clipboardCopy, "Copy Markdown of the selected text")) +
    group("Reset", btn("unrotate", ICONS.rotateCcw, "Reset rotation"), btn("unstretch", ICONS.ratio, "Reset proportions (the picture's own shape)")) +
    group("Path tools", btn("pathmenu", ICONS.pathMenu, "Path tools: simplify, outline stroke, taper, vector network, divide, shape builder, text to path", 'aria-haspopup="menu" aria-expanded="false"')) +
    group("Regions", btn("builderdone", ICONS.check, "Done: keep the regions as they are now (Enter)"), btn("buildercancel", ICONS.x, "Cancel the Shape builder (Esc)")) +
    group("Mask", btn("maskmenu", ICONS.maskMenu, "Masks: make one from the top shape, or change the one picked", 'aria-haspopup="menu" aria-expanded="false"')) +
    group("Shapes", btn("boolmenu", ICONS.boolMenu, "Shapes: join, intersect, subtract or exclude the picked shapes, and manage the group they make", 'aria-haspopup="menu" aria-expanded="false"')) +
    group("Sheet and attach",
      btn("puton", ICONS.sheetSelection, "Put the picked objects on a sheet (Ctrl+Alt+G)"),
      btn("unsheet", ICONS.releaseSheet, "Release the sheet: keep what is on it, take the sheet away (a clipping mask goes back to being its shape)"),
      btn("fitsheet", ICONS.shrink, "Fit the sheet to what is on it"),
      btn("attach", ICONS.link, "Attach the picked objects to another object: they follow the object you click next when it moves", 'aria-pressed="false"'),
      btn("detach", ICONS.unlink, "Detach the picked objects: they stop following another object")) +
    group("Align", btn("alignmenu", ICONS.alignMenu, "Align and distribute: a list of the ways to line the picked things up", 'aria-haspopup="menu" aria-expanded="false"')) +
    group("Grid", btn("arrangemenu", ICONS.arrangeMenu, "Arrange in a grid: the ways to order the items, and the space between them", 'aria-haspopup="menu" aria-expanded="false"')) +
    group("Order", btn("front", ICONS.bringToFront, "Bring to front"), btn("back", ICONS.sendToBack, "Send to back")) +
    group("Selection", btn("lock", ICONS.lockKeyhole, "Lock selection"), btn("hide", ICONS.eyeOff, "Hide selection"), btn("delete", ICONS.trash, "Delete selection"));
  host.appendChild(bar);
  // Tools that are for some kinds of thing only (the others are for any): with a mixed pick, a chip at the start shows the tools of one kind (ADR 0152).
  const FOR_KINDS: Record<string, string> = { library: "image", download: "image", open: "image", copyadj: "image", pasteadj: "image", copypng: "image", bake: "image", vectorise: "image", exportsvg: "path,stroke", copymd: "text", pathmenu: "path,stroke,text", boolmenu: "path" };
  for (const [act, kinds] of Object.entries(FOR_KINDS)) bar.querySelector<HTMLElement>(`[data-ctx="${act}"]`)?.setAttribute("data-for", kinds);
  const KIND_LABEL: Record<string, string> = { image: "Pictures", media: "Media", path: "Shapes", stroke: "Strokes", text: "Texts" };
  const kindOf = (k: string): string => (k === "video" || k === "gif" || k === "audio" ? "media" : k);
  let kindFilter = "all";
  let chipsFor = "";
  const kindsBar = bar.querySelector<HTMLElement>("[data-kinds-bar]")!;
  const q = (act: string, extra = ""): HTMLButtonElement => bar.querySelector<HTMLButtonElement>(`[data-ctx="${act}"]${extra}`)!;
  const each = (act: string, f: (b: HTMLButtonElement) => void): void => bar.querySelectorAll<HTMLButtonElement>(`[data-ctx="${act}"]`).forEach(f);

  bar.addEventListener("click", (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>("[data-kindsel]");
    if (chip) {
      kindFilter = chip.dataset["kindsel"]!;
      update();
      return;
    }
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ctx]");
    if (!b || (b as HTMLButtonElement).disabled) return;
    switch (b.dataset["ctx"]) {
      case "alignmenu": {
        // One menu for Align and Distribute; it stays open while several are tried (the shared grouped-tools menu, more-menu.ts)
        const rows = (head: string, prefix: string): MenuItem[] => LAYOUT_MENU.find((g) => g.head.startsWith(head))!.items.map((i) => ({
          id: i.id, label: `${prefix}${i.label}`, ...(i.hint ? { hint: i.hint } : {}), icon: i.icon,
          disabled: i.id.startsWith("distribute") && editor.selection.size < 3,
          run: () => { const [kind, arg] = i.id.split(":") as [string, string]; actions.layout(kind === "align" ? { align: arg as AlignKey } : { distribute: arg as "x" | "y" }); },
        }));
        openMoreMenu(b, [...rows("Align", "Align "), ...rows("Distribute", "Distribute ")], "Align and distribute", { keepOpen: true });
        break;
      }
      case "arrangemenu": {
        // The grid orders and the space between the items in one menu that stays open (the same grouped-tools menu as Align); the space is ticked
        const items = (): MenuItem[] => [
          ...LAYOUT_MENU.find((g) => g.head.startsWith("Arrange"))!.items.map((i): MenuItem => ({ id: i.id, label: i.label, ...(i.hint ? { hint: i.hint } : {}), icon: i.icon, run: () => actions.layout({ grid: i.id.split(":")[1] as SortKey }) })),
          ...GAP_ORDER.map((g): MenuItem => ({ id: `gap:${g}`, label: `Space: ${GAP_LABEL[g].toLowerCase()}`, hint: GAP_HINT[g], icon: `<span class="menu-gap">${GAP_SHORT[g]}</span>`, checked: g === actions.gap(), run: () => { actions.setGap(g); update(); } })),
        ];
        openMoreMenu(b, items(), "Arrange in a grid", { keepOpen: true, refresh: items });
        break;
      }
      case "boolmenu": {
        // The boolean operations, and what to do with the group they make: one menu that stays open and shows the operation in use
        const items = (): MenuItem[] => {
          const cur = actions.booleanState();
          const join = actions.groupJoin();
          const row = (id: string, label: string, hint: string, icon: string, run: () => void, extra: Partial<MenuItem> = {}): MenuItem => ({ id, label, hint, icon, run, ...extra });
          return [
            ...(actions.canCombine() || cur !== null ? OPS.map((o) => row(`op:${o.op}`, o.label, o.aria.slice(o.aria.indexOf(": ") + 2), o.icon, () => actions.combine(o.op), { checked: cur === o.op })) : []),
            ...(join === "add" ? [row("addgroup", "Add to the group", "The shapes become shapes of it, with its operation", ICONS.squarePlus, () => actions.addToGroup())] : []),
            ...(join === "out" ? [row("takeout", "Take out of the group", "The shapes stay where they are", ICONS.squareOut, () => actions.takeOutOfGroup())] : []),
            ...(cur !== null ? [row("flatten", "Flatten", "Make the group one path (Ctrl+E)", ICONS.merge, () => actions.flattenBoolean()), row("release", "Release", "Take the group apart; the shapes stay as they are", ICONS.releaseBoolean, () => actions.releaseBoolean())] : []),
          ];
        };
        openMoreMenu(b, items(), "Shapes", { keepOpen: true, refresh: items });
        break;
      }
      case "maskmenu": {
        const items = (): MenuItem[] => {
          const row = (id: string, label: string, hint: string, icon: string, run: () => void, extra: Partial<MenuItem> = {}): MenuItem => ({ id, label, hint, icon, run, ...extra });
          const make = actions.canMakeMask();
          const has = actions.canReleaseMask();
          return [
            ...(make ? [
              row("clipmask", "Clipping mask", "The top shape cuts what else is picked to its outline", ICONS.venetianMask, () => actions.makeClippingMask()),
              row("maskalpha", "Mask by opacity", "The top thing shows the others only where it is solid", ICONS.circleDashed, () => actions.makeMask("alpha")),
              row("maskluma", "Mask by brightness", "The top thing shows the others where it is light", ICONS.contrast, () => actions.makeMask("luminance")),
            ] : []),
            ...(has ? [
              row("selectmask", "Pick the mask", "Pick the mask of the picked things, to move or edit it", ICONS.scanEye, () => actions.selectMask()),
              row("invertmask", "Invert the mask", "Show what it hides and hide what it shows", ICONS.circleSlash, () => actions.changeMask({ invert: !(actions.selectedMask()?.invert ?? false) }), { checked: actions.selectedMask()?.invert ?? false }),
              row("releasemask", "Release the mask", "What it cut is whole again", ICONS.circleMinus, () => actions.changeMask({ release: true })),
            ] : []),
          ];
        };
        openMoreMenu(b, items(), "Masks", { keepOpen: true, refresh: items });
        break;
      }
      case "pathmenu": {
        // The tools that make, change or take apart paths and vector shapes, in one menu that stays open; only the ones that apply to the pick are listed
        const items = (): MenuItem[] => {
          const row = (id: string, label: string, hint: string, icon: string, run: () => void): MenuItem => ({ id, label, hint, icon, run });
          const free = editor.builder === null; // (while the Shape builder is on, Done and Cancel are on the bar)
          return [
            ...(actions.canSimplify() ? [row("simplify", "Simplify", "Fewer nodes, the same shape", ICONS.chartSpline, () => actions.simplify())] : []),
            ...(actions.canStrokeToPath() ? [row("strokepath", "Pen stroke to path", "Turn the pen stroke into an editable path", ICONS.pencilRuler, () => actions.strokeToPath())] : []),
            ...(actions.canOutlineStroke() ? [
              row("outlinestroke", "Outline stroke", "Make the line a shape of its own", ICONS.stamp, () => actions.outlineStroke()),
              row("taper", "Taper", "Thin at both ends; stays editable (again: take it away)", ICONS.feather, () => actions.setWidthProfile("taper")),
            ] : []),
            ...(actions.canMakeNetwork() ? [row("makenet", "Vector network", "Join the picked paths where they meet and fill the regions they enclose", ICONS.network, () => actions.makeNetwork())] : []),
            ...(actions.canReleaseNetwork() ? [row("releasenet", "Release the network", "Its edges are an ordinary path again", ICONS.unplug, () => actions.releaseNetwork())] : []),
            ...(actions.canDivide() && free ? [
              row("divide", "Divide", "Cut the picked shapes into the regions they overlap in", ICONS.slice, () => actions.divide()),
              row("shapebuilder", "Shape builder", "Drag across regions to merge them, Alt-drag to delete them", ICONS.puzzle, () => { closeMoreMenu(); actions.shapeBuilder(); }),
            ] : []),
            ...(actions.canOutline() ? [row("outline", "Text to path", "Convert the text to a path (Ctrl+E)", ICONS.replace, () => actions.outline())] : []),
            ...(actions.canSetOnPath() ? [row("onpath", "Text along a path", "Set the text along the picked path (pick the text and the path)", ICONS.route, () => actions.setOnPath())] : []),
            ...(actions.canTakeOffPath() ? [row("offpath", "Text off its path", "The text is set straight again", ICONS.routeOff, () => actions.takeOffPath())] : []),
          ];
        };
        openMoreMenu(b, items(), "Path tools", { keepOpen: true, refresh: items });
        break;
      }
      case "builderdone": actions.finishBuilder(true); break;
      case "buildercancel": actions.finishBuilder(false); break;
      case "tag": actions.tag(); break;
      case "library": actions.showInLibrary(); break;
      case "download": actions.downloadFile(); break;
      case "open": actions.openFile(); break;
      case "puton": actions.putOnSheet(); break;
      case "unsheet": actions.releaseSheet(); break;
      case "fitsheet": actions.fitSheet(); break;
      case "attach": actions.attach(); break;
      case "detach": actions.detach(); break;
      case "copymd": actions.copyMarkdown(); break;
      case "vectorise": actions.vectorise(); break;
      case "copyadj": actions.copyAdjust(); break;
      case "pasteadj": actions.pasteAdjust(); break;
      case "copypng": actions.copyRendered(); break;
      case "bake": actions.bake(); break;
      case "exportsvg": actions.exportSvg(); break;
      case "exportpic": actions.exportPicture(); break;
      case "unrotate": actions.resetRotation(); break;
      case "unstretch": actions.resetProportions(); break;
      case "duplicate": actions.duplicate(); break;
      case "group": actions.group(); break;
      case "ungroup": actions.ungroup(); break;
      case "front": actions.arrange("front"); break;
      case "back": actions.arrange("back"); break;
      case "lock": actions.setFlag("locked"); break;
      case "hide": actions.setFlag("hidden"); break;
      case "delete": actions.deleteSelection(); break;
    }
  });
  // The bar must not start a drag or a selection change on the canvas below it.
  bar.addEventListener("pointerdown", (e) => e.stopPropagation());

  const update = (): void => {
    const show = !hidden() && editor.selection.size > 0 && (editor.tool === "select" || editor.tool === "node" || editor.tool === "lasso") && editor.preview.kind === "none";
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
    q("pathmenu").hidden = !(actions.canSimplify() || actions.canStrokeToPath() || actions.canOutlineStroke() || actions.canMakeNetwork() || actions.canReleaseNetwork() || (actions.canDivide() && editor.builder === null) || actions.canOutline() || actions.canSetOnPath() || actions.canTakeOffPath());
    for (const k of ["builderdone", "buildercancel"]) q(k).hidden = editor.builder === null;
    q("maskmenu").hidden = !(actions.canMakeMask() || actions.canReleaseMask());

    const reset = actions.resettable();
    q("library").hidden = !actions.hasLibraryItems();
    const file = actions.fileSelection();
    q("download").hidden = !actions.canDownload();
    q("open").hidden = !file?.open;
    q("unsheet").hidden = !actions.canReleaseSheet();
    q("puton").hidden = false;
    q("fitsheet").hidden = !actions.canFitSheet();
    q("attach").hidden = false;
    q("attach").setAttribute("aria-pressed", String(editor.attachMode));
    q("detach").hidden = !actions.canDetach();
    q("copymd").hidden = !sel.some((o) => o!.kind === "text");
    q("vectorise").hidden = !actions.svgPicture();
    const pic = actions.pictureTools();
    q("copyadj").hidden = !pic;
    q("pasteadj").hidden = !pic;
    q("pasteadj").disabled = !pic?.canPaste;
    q("copypng").hidden = !pic?.still;
    q("bake").hidden = !pic?.still;
    q("exportsvg").hidden = !actions.canExportSvg();
    q("exportpic").hidden = !actions.canExport();
    q("unrotate").hidden = !reset.turned;
    q("unstretch").hidden = !reset.stretched;
    // the chips: only with two or more kinds picked; a kind no longer picked goes back to All
    const kinds = [...new Set(sel.map((o) => kindOf(o!.kind)))].sort((a, b) => Object.keys(KIND_LABEL).indexOf(a) - Object.keys(KIND_LABEL).indexOf(b));
    if (kinds.length < 2 || !kinds.includes(kindFilter)) kindFilter = "all";
    const chipsKey = kinds.length < 2 ? "" : `${kinds.join(",")}|${kindFilter}`;
    if (chipsKey !== chipsFor) {
      chipsFor = chipsKey;
      kindsBar.innerHTML = chipsKey ? ["all", ...kinds].map((k) => `<button type="button" class="ctx-gap" data-kindsel="${k}" aria-pressed="${k === kindFilter}" aria-label="Show the tools for ${k === "all" ? "everything picked" : KIND_LABEL[k]!.toLowerCase()}" title="Tools for ${k === "all" ? "everything picked" : KIND_LABEL[k]!.toLowerCase()}">${k === "all" ? "All" : KIND_LABEL[k]}</button>`).join("") : "";
    }
    kindsBar.hidden = !chipsKey;
    for (const el of bar.querySelectorAll<HTMLElement>("[data-for]")) el.toggleAttribute("data-off", kindFilter !== "all" && !el.dataset["for"]!.split(",").includes(kindFilter));
    bar.hidden = false;
    syncGroups(bar, (g) => !g.hasAttribute("data-kinds-bar") || !g.hidden);
    bar.toggleAttribute("data-scroll", bar.scrollWidth > bar.clientWidth + 1);
  };
  editor.subscribe(update);
  return { update };
}
