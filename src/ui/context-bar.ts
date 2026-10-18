import type { EditorState } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import type { LayoutCommand } from "../app/actions";
import type { AlignKey, SortKey } from "../doc/arrange";
import { ICONS } from "./icons";
import { GAP_LABEL, GAP_ORDER } from "../doc/arrange";
import type { GapKey } from "../doc/arrange";
import { LAYOUT_MENU } from "./toolbar";
import { syncGroups } from "./bar";
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
      btn("exportsvg", ICONS.fileCode, "Save the shapes as an SVG file"),
      btn("copymd", ICONS.clipboardCopy, "Copy Markdown of the selected text")) +
    group("Reset", btn("unrotate", ICONS.rotateCcw, "Reset rotation"), btn("unstretch", ICONS.ratio, "Reset proportions (the picture's own shape)")) +
    group("Path", btn("simplify", ICONS.chartSpline, "Simplify the path: fewer nodes, the same shape"), btn("strokepath", ICONS.pencilRuler, "Turn the pen stroke into an editable path")) +
    group("Text", btn("outline", ICONS.replace, "Convert text to path (Ctrl+E)"), btn("onpath", ICONS.route, "Set the text along the picked path (pick the text and the path)"), btn("offpath", ICONS.routeOff, "Take the text off its path: it is set straight again")) +
    group("Shapes",
      ...OPS.map((o) => btn("op", o.icon, o.aria, `data-op="${o.op}"`)),
      btn("addgroup", ICONS.squarePlus, "Add the shapes to the boolean group: they become shapes of it, with its operation"),
      btn("takeout", ICONS.squareOut, "Take the shapes out of the boolean group: they stay where they are"),
      btn("flatten", ICONS.merge, "Flatten the boolean group into one path (Ctrl+E)"),
      btn("release", ICONS.releaseBoolean, "Release the shapes: take the boolean group apart, the shapes stay as they are")) +
    group("Sheet and attach",
      btn("puton", ICONS.sheetSelection, "Put the picked objects on a sheet (Ctrl+Alt+G)"),
      btn("unsheet", ICONS.releaseSheet, "Release the sheet: keep what is on it, take the sheet away"),
      btn("fitsheet", ICONS.shrink, "Fit the sheet to what is on it"),
      btn("attach", ICONS.link, "Attach the picked objects to another object: they follow the object you click next when it moves", 'aria-pressed="false"'),
      btn("detach", ICONS.unlink, "Detach the picked objects: they stop following another object")) +
    group("Align", layoutButtons("Align"), layoutButtons("Distribute")) +
    group("Grid", layoutButtons("Arrange"), ...GAP_ORDER.map((g) => `<button type="button" class="ctx-gap" data-ctx="gap" data-gap="${g}" aria-pressed="false" aria-label="Space between items: ${GAP_LABEL[g].toLowerCase()}" title="Space between the items of a grid: ${GAP_LABEL[g].toLowerCase()}">${GAP_SHORT[g]}</button>`)) +
    group("Order", btn("front", ICONS.bringToFront, "Bring to front"), btn("back", ICONS.sendToBack, "Send to back")) +
    group("Selection", btn("lock", ICONS.lockKeyhole, "Lock selection"), btn("hide", ICONS.eyeOff, "Hide selection"), btn("delete", ICONS.trash, "Delete selection"));
  host.appendChild(bar);
  const q = (act: string, extra = ""): HTMLButtonElement => bar.querySelector<HTMLButtonElement>(`[data-ctx="${act}"]${extra}`)!;
  const each = (act: string, f: (b: HTMLButtonElement) => void): void => bar.querySelectorAll<HTMLButtonElement>(`[data-ctx="${act}"]`).forEach(f);

  bar.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ctx]");
    if (!b || (b as HTMLButtonElement).disabled) return;
    switch (b.dataset["ctx"]) {
      case "layout": {
        const [kind, arg] = b.dataset["layout"]!.split(":") as [string, string];
        actions.layout(kind === "grid" ? { grid: arg as SortKey } : kind === "align" ? { align: arg as AlignKey } : { distribute: arg as "x" | "y" });
        break;
      }
      case "gap": actions.setGap(b.dataset["gap"] as GapKey); update(); break;
      case "op": actions.combine(b.dataset["op"] as BoolOp); break;
      case "addgroup": actions.addToGroup(); break;
      case "takeout": actions.takeOutOfGroup(); break;
      case "release": actions.releaseBoolean(); break;
      case "flatten": actions.flattenBoolean(); break;
      case "outline": actions.outline(); break;
      case "onpath": actions.setOnPath(); break;
      case "offpath": actions.takeOffPath(); break;
      case "simplify": actions.simplify(); break;
      case "strokepath": actions.strokeToPath(); break;
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
    const lined = many || (sel.length === 1 && (sel[0]!.groups?.length ?? 0) > 0); // (one shape inside a group is lined up with the group)
    each("layout", (b) => {
      const kind = b.dataset["layout"]!.split(":")[0];
      b.hidden = kind === "grid" ? !many : kind === "distribute" ? sel.length < 3 : !lined;
    });
    each("gap", (b) => {
      b.hidden = !many;
      b.setAttribute("aria-pressed", String(b.dataset["gap"] === actions.gap()));
    });
    const cur = actions.booleanState();
    const join = actions.groupJoin();
    each("op", (b) => {
      b.hidden = !actions.canCombine() && cur === null;
      b.setAttribute("aria-pressed", String(cur === b.dataset["op"]));
    });
    q("addgroup").hidden = join !== "add";
    q("takeout").hidden = join !== "out";
    q("flatten").hidden = cur === null;
    q("release").hidden = cur === null;
    q("outline").hidden = !actions.canOutline();
    q("onpath").hidden = !actions.canSetOnPath();
    q("offpath").hidden = !actions.canTakeOffPath();
    q("simplify").hidden = !actions.canSimplify();
    q("strokepath").hidden = !actions.canStrokeToPath();
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
    q("unrotate").hidden = !reset.turned;
    q("unstretch").hidden = !reset.stretched;
    bar.hidden = false;
    syncGroups(bar);
    bar.toggleAttribute("data-scroll", bar.scrollWidth > bar.clientWidth + 1);
  };
  editor.subscribe(update);
  return { update };
}
