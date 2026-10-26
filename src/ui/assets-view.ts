import { beginProgress } from "../app/progress";
import { fileByFolders, filesOfPicker } from "../app/directory";
import { readMetadata } from "../assets/metadata";
import type { MetaRow } from "../assets/metadata";
import type { Session, AssetPlace } from "../app/session";
import { plural } from "../doc/plural";
import { openBatchRename } from "./batch-rename";
import { tagFormatNote, tagIsOrUnder } from "../doc/tags";
import { mountSuggest } from "./search-suggest";
import { storeFrame } from "../app/frames";
import { chipOf, describeFile, extOf, isCard } from "../assets/file-kind";
import { FILE_CARD_NOTE } from "../assets/card";
import { downloadOriginal, fileActionsOf, openOriginalInTab } from "./file-actions";
import { LIBRARY_ROWS, searchHelpButton, wireSearchHelp } from "./search-help";
import { ASSETS_RECENT, rememberSearch } from "../search/history";
import { paintRecent, wireRecent } from "./search-recent";
import { evalQuery, parseQuery, type Query } from "../search/query";
import { parseFilter, type Filter } from "../assets/filters";
import { LOOK_SIZE, lookOf, similarGroups, type Look } from "../assets/look";
import type { AssetLibrary } from "../assets/asset-library";
import { duplicateNotice } from "../assets/asset-library";
import type { AssetFolder, CatalogListing } from "../assets/asset-catalog";
import { folderPath, folderSubtree, meta } from "../assets/asset-catalog";
import { THUMB_PX, makeThumb } from "../assets/thumb";
import { newObjectId } from "../doc/model";
import { ICONS } from "./icons";
import { clearRect, MENU_GAP, openMoreMenu } from "./more-menu";
import type { MenuItem } from "./more-menu";
import { bindContextMenu, grouped as groupedMenu } from "./context-menu";
import { cleanFileName, splitName } from "../doc/rename-rules";
import { esc, fmtBytes } from "./format";
import { confirmDialog } from "./confirm";
import { runExport, runExportFiles } from "./archive-ui";
import { hasAlpha } from "./alpha";
import { VIEW_GROUNDS, type ViewGround } from "../storage/workspace-repo";
import type { Engine } from "./media-player";
import { avEngine, gifEngine } from "./media-player";
import { mountPlayerControls } from "./player-controls";
import type { ImageObject } from "../doc/model";
import { chooseDialog, promptDialog } from "./confirm";
import type { SettingsStore } from "../settings/settings";

/**
 * Assets view: the full-window library of the workspace's shared originals
 * (ADR 0007). It reads the one authoritative catalog. Nothing here copies
 * bytes: placing an asset creates a new canvas instance that references the
 * same original.
 *
 * Shows each asset's identity, usage (instances and canvases), storage size
 * and whether its original is stored; lists every canvas where it is used
 * with a Show action that opens that canvas, selects the instances and frames
 * them; places new instances; and deletes unused assets from the library.
 * Originals referenced by instances whose bytes are gone are listed as
 * missing, with how to restore them.
 *
 * Organization (ADR 0011): a sidebar scopes the grid to all assets,
 * favourites, unfiled assets, a folder (with its subfolders) or a tag. The
 * inspector edits an asset's favourite flag, tags and folders; an asset can
 * be in any number of folders without being copied.
 */
export interface AssetsView {
  show(): void;
  hide(): void;
  /** Put the cursor in the library's search box (closing the viewer if it is open). */
  focusSearch(): void;
  /** Show these originals: leave the viewer, clear the search and filters, pick them and scroll to the first (ADR 0077). */
  reveal(hashes: readonly string[]): Promise<void>;
  /** Import files into the library only (no placement). */
  importFiles(files: File[]): Promise<void>;
}

/** The columns of the list layout: each can be shown or hidden and moved (Name always shows). */
/** How wide the library panel (left) and the details panel (right) can be made on a wide screen, in pixels. */
/** The most names "View in the library" puts in the search; a longer selection is picked in the whole list instead. */
const REVEAL_NAMES_MAX = 20;
const SIDE_W = { min: 180, max: 420, def: 232 };
const INSP_W = { min: 260, max: 560, def: 308 };

const COLUMNS = [
  { id: "name", label: "Name", min: 140, grow: 2 },
  { id: "pixels", label: "Pixels", min: 100, grow: 0 },
  { id: "type", label: "Type", min: 70, grow: 0 },
  { id: "size", label: "Size", min: 80, grow: 0 },
  { id: "used", label: "Used", min: 120, grow: 1.2 },
  { id: "tags", label: "Tags", min: 100, grow: 1 },
  { id: "added", label: "Added", min: 110, grow: 0 },
  { id: "folder", label: "Folder", min: 110, grow: 1 },
  { id: "favourite", label: "Favourite", min: 80, grow: 0 },
  { id: "width", label: "Width", min: 76, grow: 0 },
  { id: "height", label: "Height", min: 76, grow: 0 },
  { id: "canvases", label: "Canvases", min: 90, grow: 0 },
] as const;
type ColumnId = (typeof COLUMNS)[number]["id"];
const DEFAULT_COLUMN_ORDER: readonly ColumnId[] = COLUMNS.map((c) => c.id);
const DEFAULT_HIDDEN: readonly ColumnId[] = ["added", "folder", "favourite", "width", "height", "canvases"];
/** A column's track in the list's grid: a fixed width, or a share of the room left over (never narrower than its minimum). */
const trackOf = (c: (typeof COLUMNS)[number]): string => (c.grow ? `minmax(${c.min}px, ${c.grow}fr)` : `${c.min}px`);


type UsageFilter = "all" | "used" | "unused";
type SortKey = "newest" | "name" | "size" | "uses" | "pixels" | "type" | "tags" | "folder" | "favourite" | "width" | "height" | "canvases";
/** The order a column header sorts by (a click), and whether that order is high to low or A to Z, newest first and so on when not reversed. */
const SORT_OF: Record<ColumnId, { key: SortKey; desc: boolean }> = {
  name: { key: "name", desc: false },
  pixels: { key: "pixels", desc: true },
  type: { key: "type", desc: false },
  size: { key: "size", desc: true },
  used: { key: "uses", desc: true },
  tags: { key: "tags", desc: false },
  added: { key: "newest", desc: true },
  folder: { key: "folder", desc: false },
  favourite: { key: "favourite", desc: true },
  width: { key: "width", desc: true },
  height: { key: "height", desc: true },
  canvases: { key: "canvases", desc: true },
};


/** Fields that take typed text: shortcuts keep out of them (a checkbox or a slider is not one). */
const TYPING = 'input:not([type="checkbox"]):not([type="range"]), textarea, select';

export function mountAssetsView(root: HTMLElement, session: Session, assets: AssetLibrary, showCanvas: () => void, notices: { subscribe(fn: (text: string) => void): void }, settings: SettingsStore): AssetsView {
  root.innerHTML = `
    <div class="assets-bar" role="toolbar" aria-label="Library">
      <div class="assets-searchbox">
              <input type="search" class="assets-search" data-testid="assets-search" placeholder="Search" title="Search by name, type or tag; #tag is a tag, .png a file type; width>1000, ratio:16x9, orientation:portrait, colour:red filter by what the picture is" aria-label="Search the library">
        <button type="button" class="cs-clear" aria-label="Clear the search" title="Clear the search" hidden>${ICONS.x}</button>
        ${searchHelpButton()}
        <div class="assets-search-pop" data-testid="assets-search-pop">
          <div class="cs-modes" role="tablist" aria-label="Search by">
            <button type="button" role="tab" data-m="all">All</button>
            <button type="button" role="tab" data-m="name"><kbd>/</kbd>Name</button>
            <button type="button" role="tab" data-m="tag"><kbd>#</kbd>Tag</button>
          </div>
          <div class="search-suggest" data-testid="search-suggest" hidden></div>
          <div class="cs-recent" data-testid="search-recent" hidden></div>
        </div>
      </div>
      <span class="assets-count" data-testid="assets-count"></span>
      <span class="assets-sep" role="separator"></span>
      <select data-testid="assets-usage" aria-label="Show">
        <option value="all">All items</option><option value="used">In use</option><option value="unused">Unused</option>
      </select>
      <select data-testid="assets-sort" aria-label="Sort by">
        <option value="newest">Newest first</option><option value="name">Name A–Z</option><option value="size">Largest first</option><option value="uses">Most used</option>
        <option value="pixels">Most pixels</option><option value="type">Type A–Z</option><option value="tags">Tags A–Z</option><option value="folder">Folder A–Z</option><option value="favourite">Favourites first</option><option value="width">Widest first</option><option value="height">Tallest first</option><option value="canvases">On most canvases</option>
      </select>
      <button type="button" class="assets-btn is-icon" data-action="sort-dir" data-testid="assets-sort-dir" aria-pressed="false">${ICONS.arrowUpDown}</button>
      <span class="assets-sep" role="separator"></span>
      <div class="assets-layout" role="group" aria-label="Layout">
        <button type="button" class="assets-btn is-icon" data-layout="grid" aria-pressed="true" aria-label="Thumbnails" title="Thumbnails">${ICONS.layoutGrid}</button>
        <button type="button" class="assets-btn is-icon" data-layout="list" aria-pressed="false" aria-label="List" title="List">${ICONS.layoutList}</button>
      </div>
      <button type="button" class="assets-btn is-icon" data-action="columns" data-testid="assets-columns" aria-haspopup="dialog" aria-expanded="false" aria-label="List columns" title="Choose and arrange the columns of the list">${ICONS.columns3}</button>
      <label class="assets-size" title="Thumbnail size">${ICONS.moveDiagonal}<input type="range" min="96" max="240" step="24" value="144" aria-label="Thumbnail size"></label>
      <span class="assets-sep" role="separator"></span>
      <span class="split assets-import"><button type="button" class="assets-btn" data-action="import" data-testid="assets-import">${ICONS.arrowDownToLine}<span>Import</span></button><button type="button" class="assets-btn is-icon" data-action="import-menu" data-testid="assets-import-menu" aria-haspopup="menu" aria-label="Files or a folder" title="Bring in files, or a folder">${ICONS.chevronDown}</button></span>
      <span class="assets-sep" role="separator"></span>
      <button type="button" class="assets-btn is-icon" data-action="slideshow" data-testid="assets-slideshow" aria-label="Slideshow" title="Play the library, or the items you picked, as a slideshow">${ICONS.play}</button>
      <span class="assets-sep" role="separator"></span>
      <button type="button" class="assets-btn is-icon" data-action="details" aria-pressed="true" aria-label="Details panel" title="Show or hide the details (I)">${ICONS.panelRight}</button>
      <input type="file" multiple hidden data-testid="assets-import-input">
      <input type="file" multiple hidden webkitdirectory data-testid="assets-import-folder-input">
    </div>
    <div class="assets-columns" role="dialog" aria-label="List columns" data-testid="columns-panel" hidden></div>
    <p class="assets-status" role="status" data-testid="assets-status"></p>
    <div class="assets-body">
      <nav class="assets-side" data-testid="assets-side" aria-label="Library"></nav>
      <div class="col-grip" data-grip="side" data-testid="side-grip" role="separator" aria-orientation="vertical" aria-label="Resize the library panel" title="Drag to resize the library panel (double-click to reset)" tabindex="0"></div>
      <div class="assets-main">
        <div class="assets-scroll"><div class="assets-list-head"><span></span>${COLUMNS.map((c) => `<span data-col="${c.id}" draggable="true" role="columnheader" aria-sort="none" title="Click to sort by ${c.label.toLowerCase()}; drag to move this column">${c.label}<i class="col-sort" aria-hidden="true"></i></span>`).join("")}</div><div class="assets-grid" role="list" data-testid="assets-grid"></div></div>
        <div class="viewer" data-testid="slide-view" role="region" aria-label="Viewer" tabindex="-1" hidden>
          <button type="button" class="vbtn viewer-back" data-act="close" aria-label="Back to the library" title="Back to the library (Esc)">${ICONS.arrowLeft}</button>
          <button type="button" class="vbtn viewer-hide" data-act="bar" aria-label="Hide the controls" title="Hide the controls (F)">${ICONS.chevronsDown}</button>
          <button type="button" class="vbtn viewer-details" data-act="details" aria-pressed="true" aria-label="Details panel" title="Show or hide the details (I)">${ICONS.panelRight}</button>
          <div class="viewer-stage"><button type="button" class="vbtn viewer-ground" data-act="ground" aria-label="Background of see-through pictures" title="Background of see-through pictures">${ICONS.sunMoon}</button><span class="viewer-progress" hidden></span><div class="viewer-edge is-prev" data-edge="prev" aria-hidden="true"></div><div class="viewer-edge is-next" data-edge="next" aria-hidden="true"></div>
            <figure><div class="viewer-checker" hidden><i></i></div><canvas class="viewer-vec" hidden></canvas><img alt="" draggable="false"><video hidden></video><canvas class="viewer-gif" hidden></canvas><figcaption></figcaption></figure></div>
          <div class="viewer-bar" role="toolbar" aria-label="Viewer controls">
            <div class="viewer-nav">
              <button type="button" class="vbtn" data-act="prev" aria-label="Previous" title="Previous (Left arrow)">${ICONS.chevronLeft}</button>
              <button type="button" class="vbtn" data-act="play" aria-pressed="false" aria-label="Start the slideshow" title="Start the slideshow (Space)">${ICONS.presentation}</button>
              <button type="button" class="vbtn" data-act="next" aria-label="Next" title="Next (Right arrow)">${ICONS.chevronRight}</button>
              <span class="viewer-pos"></span>
            </div>
            <div class="viewer-film" role="listbox" aria-label="Library, in this order"></div>
            <div class="viewer-tools">
            <div class="viewer-zoom" role="group" aria-label="Zoom">
              <button type="button" data-zoom="out" aria-label="Zoom out" title="Zoom out (-)">${ICONS.minus}</button>
              <button type="button" data-zoom="reset" class="viewer-zoom-pct" aria-label="Zoom level" title="Fit the picture, or show it at 100% (double-click the picture too)">Fit</button>
              <button type="button" data-zoom="in" aria-label="Zoom in" title="Zoom in (+)">${ICONS.plus}</button>
            </div>
              <button type="button" class="vbtn" data-act="fullscreen" aria-label="Full screen" title="Full screen">${ICONS.maximize}</button>
              <span class="viewer-quick"><button type="button" class="vbtn" data-act="favorite" aria-pressed="false" aria-label="Favourite" title="Favourite">${ICONS.star}</button>
              <button type="button" class="vbtn is-primary" data-act="place" title="Place on the open canvas">${ICONS.mapPin}<span>Place</span></button></span>
            </div>
          </div>
          <div class="viewer-handle" hidden>
            <button type="button" class="vbtn" data-act="play" aria-label="Pause the slideshow" title="Pause the slideshow (Space)">${ICONS.pause}</button>
            <button type="button" class="vbtn" data-act="bar" aria-label="Show the controls" title="Show the controls (F)">${ICONS.chevronsUp}</button>
          </div>
        </div>
      </div>
      <div class="col-grip" data-grip="insp" data-testid="insp-grip" role="separator" aria-orientation="vertical" aria-label="Resize the details panel" title="Drag to resize the details panel (double-click to reset)" tabindex="0"></div>
      <div class="sheet-grip" data-testid="sheet-grip" role="separator" aria-orientation="horizontal" aria-label="Resize the details panel" title="Drag to resize the details (double-click to reset)" tabindex="0"><span></span></div>
      <aside class="asset-inspector" data-testid="asset-inspector" aria-label="Details" hidden></aside>
    </div>
    <div class="place-menu" role="menu" aria-label="Place on" data-testid="place-menu" hidden></div>`;
  const body = root.querySelector<HTMLElement>(".assets-body")!;
  const viewer = root.querySelector<HTMLElement>(".viewer")!;
  const film = root.querySelector<HTMLElement>(".viewer-film")!;
  const grid = root.querySelector<HTMLElement>(".assets-grid")!;
  const inspector = root.querySelector<HTMLElement>(".asset-inspector")!;
  // The Details fold stays open (or closed) as you left it when you go to another item; only you close it.
  let detailsOpen = false;
  inspector.addEventListener("toggle", (e) => {
    const d = e.target as HTMLElement;
    if (d.matches?.("details[data-metadata]")) detailsOpen = (d as HTMLDetailsElement).open;
  }, true);
  const status = root.querySelector<HTMLElement>(".assets-status")!;
  const count = root.querySelector<HTMLElement>(".assets-count")!;
  const search = root.querySelector<HTMLInputElement>(".assets-search")!;
  wireSearchHelp(root.querySelector<HTMLElement>(".search-help-btn")!, search, "Type the operators in capitals.", LIBRARY_ROWS);
  const usageSel = root.querySelector<HTMLSelectElement>('[data-testid="assets-usage"]')!;
  const sortSel = root.querySelector<HTMLSelectElement>('[data-testid="assets-sort"]')!;
  const sortDirBtn = root.querySelector<HTMLButtonElement>('[data-testid="assets-sort-dir"]')!;
  /** Sort order reversed from its usual one (newest, A to Z, largest and most used first). */
  let reversed = false;
  const SORT_LABEL: Record<SortKey, [usual: string, reversed: string]> = {
    newest: ["Newest first", "Oldest first"],
    name: ["Name A–Z", "Name Z–A"],
    size: ["Largest first", "Smallest first"],
    uses: ["Most used", "Least used"],
    pixels: ["Most pixels", "Fewest pixels"],
    type: ["Type A–Z", "Type Z–A"],
    tags: ["Tags A–Z", "Tags Z–A"],
    folder: ["Folder A–Z", "Folder Z–A"],
    favourite: ["Favourites first", "Favourites last"],
    width: ["Widest first", "Narrowest first"],
    height: ["Tallest first", "Shortest first"],
    canvases: ["On most canvases", "On fewest canvases"],
  };
  /** The order named in words, on the choice and on the button, so the direction is never a guess. */
  const showSort = (): void => {
    for (const o of sortSel.options) o.textContent = SORT_LABEL[o.value as SortKey][reversed ? 1 : 0];
    const now = SORT_LABEL[sortSel.value as SortKey][reversed ? 1 : 0];
    const other = SORT_LABEL[sortSel.value as SortKey][reversed ? 0 : 1];
    sortDirBtn.setAttribute("aria-pressed", String(reversed));
    sortDirBtn.setAttribute("aria-label", `Sorted: ${now}. Reverse the order`);
    sortDirBtn.title = `Sorted: ${now}. Click for ${other}.`;
    // The list's headers show the sorted column and its direction, like a table's.
    for (const h of root.querySelectorAll<HTMLElement>(".assets-list-head [data-col]")) {
      const o = SORT_OF[h.dataset["col"] as ColumnId];
      const on = o.key === sortSel.value;
      const down = o.desc !== reversed;
      h.setAttribute("aria-sort", on ? (down ? "descending" : "ascending") : "none");
      h.classList.toggle("is-sorted", on);
      h.querySelector<HTMLElement>(".col-sort")!.textContent = on ? (down ? "↓" : "↑") : "";
    }
  };
  showSort();
  const sizeInput = root.querySelector<HTMLInputElement>(".assets-size input")!;
  const fileInput = root.querySelector<HTMLInputElement>('[data-testid="assets-import-input"]')!;
  const importBtn = root.querySelector<HTMLButtonElement>('[data-action="import"]')!;
  const side = root.querySelector<HTMLElement>(".assets-side")!;

  // What the user chose to hide (the details panel, the viewer's controls) is remembered on this device.
  const UI_KEY = "canvast.assets.ui";
  const ui: { details: boolean; bar: boolean; layout: "grid" | "list"; order: ColumnId[]; hidden: ColumnId[]; closed: string[]; sheetH: number | null; sideW: number | null; inspW: number | null } = { details: true, bar: true, layout: "grid", order: [...DEFAULT_COLUMN_ORDER], hidden: [...DEFAULT_HIDDEN], closed: [], sheetH: null, sideW: null, inspW: null };
  try {
    const saved = JSON.parse(localStorage.getItem(UI_KEY) ?? "{}") as Partial<typeof ui>;
    if (typeof saved.details === "boolean") ui.details = saved.details;
    if (typeof saved.bar === "boolean") ui.bar = saved.bar;
    if (saved.layout === "grid" || saved.layout === "list") ui.layout = saved.layout;
    // The combined "Type and size" column became two (Type, Size): where it was, they are, shown if it was shown.
    const hadKind = Array.isArray(saved.order) && (saved.order as string[]).includes("kind");
    if (hadKind) {
      (saved as { order: string[] }).order = (saved.order as string[]).flatMap((c) => (c === "kind" ? ["type", "size"] : [c]));
      if (Array.isArray(saved.hidden)) {
        const kindHidden = (saved.hidden as string[]).includes("kind");
        (saved as { hidden: string[] }).hidden = (saved.hidden as string[]).filter((c) => c !== "kind" && c !== "type" && c !== "size").concat(kindHidden ? ["type", "size"] : []);
      }
    }
    const known = new Set<string>(DEFAULT_COLUMN_ORDER);
    if (Array.isArray(saved.order)) {
      const order = saved.order.filter((c, i, a) => known.has(c) && a.indexOf(c) === i);
      ui.order = [...order, ...DEFAULT_COLUMN_ORDER.filter((c) => !order.includes(c))];
    }
    if (typeof saved.sideW === "number" && saved.sideW >= SIDE_W.min && saved.sideW <= SIDE_W.max) ui.sideW = saved.sideW;
    if (typeof saved.inspW === "number" && saved.inspW >= INSP_W.min && saved.inspW <= INSP_W.max) ui.inspW = saved.inspW;
    if (typeof saved.sheetH === "number" && saved.sheetH >= 120 && saved.sheetH <= 2000) ui.sheetH = saved.sheetH;
    if (Array.isArray(saved.closed)) ui.closed = saved.closed.filter((c) => typeof c === "string").slice(0, 8);
    if (Array.isArray(saved.hidden)) {
      ui.hidden = saved.hidden.filter((c) => known.has(c) && c !== "name");
      // Columns added after these choices were saved start hidden.
      const had = new Set(Array.isArray(saved.order) ? saved.order : DEFAULT_COLUMN_ORDER);
      for (const c of DEFAULT_HIDDEN) if (!had.has(c) && !ui.hidden.includes(c)) ui.hidden.push(c);
    }
  } catch {
    // unreadable: shown
  }
  const saveUi = (): void => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify(ui));
    } catch {
      // blocked: kept for this session
    }
  };
  /** With the viewer open the page is only the picture and its own bar: the view tabs, the workspace menu and the Settings button are away (styles.css). */
  const syncViewing = (): void => {
    document.body.toggleAttribute("data-viewing", visible && !viewer.hidden);
  };
  const applyUi = (): void => {
    body.classList.toggle("no-details", !ui.details);
    viewer.classList.toggle("no-bar", !ui.bar);
    root.classList.toggle("no-controls", !ui.bar);
    syncViewing();
    body.classList.toggle("is-list", ui.layout === "list");
    root.classList.toggle("is-list", ui.layout === "list");
    for (const b of root.querySelectorAll<HTMLElement>("[data-layout]")) b.setAttribute("aria-pressed", String(b.dataset["layout"] === ui.layout));
    // The list's columns: their order (CSS `order`), which are shown, and the grid they sit on.
    const shown = ui.order.filter((c) => !ui.hidden.includes(c));
    ui.order.forEach((c, i) => body.style.setProperty(`--o-${c}`, String(i + 1)));
    for (const c of DEFAULT_COLUMN_ORDER) body.classList.toggle(`hide-${c}`, ui.hidden.includes(c));
    body.style.setProperty("--cols", ["56px", ...shown.map((c) => trackOf(COLUMNS.find((x) => x.id === c)!))].join(" "));
    // The list never squeezes a column below its minimum: when the window is narrower it scrolls sideways instead.
    body.style.setProperty("--list-min", `${56 + shown.reduce((n, c) => n + COLUMNS.find((x) => x.id === c)!.min, 0) + 12 * shown.length + 48}px`);
    if (ui.sheetH) body.style.setProperty("--sheet-h", `${ui.sheetH}px`);
    else body.style.removeProperty("--sheet-h");
    for (const [cls, prop, w] of [["has-side-w", "--side-w", ui.sideW], ["has-insp-w", "--insp-w", ui.inspW]] as const) {
      body.classList.toggle(cls, w !== null);
      if (w !== null) body.style.setProperty(prop, `${w}px`);
      else body.style.removeProperty(prop);
    }
    viewer.querySelector<HTMLElement>(".viewer-handle")!.hidden = ui.bar;
    for (const b of root.querySelectorAll<HTMLElement>('[data-act="details"], [data-action="details"]')) b.setAttribute("aria-pressed", String(ui.details));
  };
  let visible = false;
  applyUi();
  let listing: CatalogListing | null = null;
  /** The asset the details describe (the last one picked), and every asset picked: a click picks one, Ctrl or Cmd adds or removes, Shift takes a range, a checkbox adds or removes. */
  let selected: string | null = null;
  const picked = new Set<string>();
  let anchor: string | null = null;
  /** Picking several: once a checkbox, Ctrl, Shift or Ctrl+A started it, a tap adds or removes (a plain mouse click picks one alone). */
  let selecting = false;
  let places: AssetPlace[] = [];
  let generation = 0;
  /** Sidebar scope: "all", "favorites", "unfiled", "folder:<id>" or "tag:<lowercased tag>". */
  let scope = "all";
  /** Inline name input in the sidebar: a new folder (under `parent`) or a rename. */
  /** In-canvas tags across the workspace (ADR 0062), and those carried by instances of the open asset. */
  let canvasTags = new Map<string, { label: string; objects: number; canvases: Set<string>; assets: Set<string> }>();
  let assetCanvasTags: Array<{ tag: string; canvases: string[] }> = [];
  /** The row whose "more" menu is open in the sidebar. */
  let sideMenu: { kind: "folder" | "tag" | "ctag" | "style"; id: string } | null = null;
  /** On a narrow screen the sidebar is a strip that opens on demand. */
  const narrow = window.matchMedia("(max-width: 900px)");
  let sideOpen = !narrow.matches;
  let naming: { kind: "new"; parent: string | null } | { kind: "rename-tag"; key: string; label: string } | { kind: "rename-ctag"; key: string; label: string } | { kind: "rename"; id: string } | null = null;
  const thumbs = new Map<string, Promise<string>>();
  const thumbUrls = new Map<string, string>(); // the ones already loaded: a redrawn grid shows them at once instead of blank cards
  /** A file the browser cannot show gets no picture at all (ADR 0089): a fixed tile with the file icon, the extension and one general message. */
  const fileTile = (e: { name: string; type: string }, note = true): string =>
    `<span class="file-tile" aria-hidden="true">${ICONS.fileIcon}<span class="file-tile-ext">${esc(chipOf(e.name, e.type))}</span>${note ? `<span class="file-tile-note">${FILE_CARD_NOTE}</span>` : ""}</span>`;

  // ---- thumbnails: generated lazily from the stored original, kept in memory only
  const thumbFor = (hash: string): Promise<string> => {
    let p = thumbs.get(hash);
    if (!p) {
      p = (async () => {
        // A thumbnail stored earlier: the original is not read at all (and a lost original keeps its face).
        const stored = await session.catalog?.thumb(hash).catch(() => undefined);
        if (stored) return URL.createObjectURL(stored.blob);
        const rec = await assets.record(hash);
        if (!rec) throw new Error("missing");
        const made = await makeThumb(rec);
        if (made) {
          void session.catalog?.putThumb(made).catch(() => undefined);
          return URL.createObjectURL(made.blob);
        }
        return URL.createObjectURL(rec.blob);
      })();
      thumbs.set(hash, p);
    }
    return p;
  };
  // ---- what pictures look like (ADR 0114): read from the thumbnails, a few at a time, kept in memory
  const looks = new Map<string, Look | null>();
  const looking = new Set<string>();
  let lookTimer = 0;
  const ensureLooks = (hashes: readonly string[]): void => {
    const todo = hashes.filter((h) => !looks.has(h) && !looking.has(h));
    for (const h of todo) looking.add(h);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < todo.length) {
        const hash = todo[next++]!;
        try {
          const img = new Image();
          img.src = await thumbFor(hash);
          await img.decode();
          const c = document.createElement("canvas");
          c.width = c.height = LOOK_SIZE;
          const g = c.getContext("2d", { willReadFrequently: true })!;
          g.drawImage(img, 0, 0, LOOK_SIZE, LOOK_SIZE);
          looks.set(hash, lookOf(g.getImageData(0, 0, LOOK_SIZE, LOOK_SIZE).data));
        } catch {
          looks.set(hash, null); // a file with no picture (a card, a missing original)
        }
        looking.delete(hash);
        if (!lookTimer) lookTimer = window.setTimeout(() => ((lookTimer = 0), render()), 150);
      }
    };
    for (let i = 0; i < Math.min(3, todo.length); i++) void worker();
  };
  const filterCache = new Map<string, Filter | null>();
  const filterOf = (w: string): Filter | null => {
    if (!filterCache.has(w)) filterCache.set(w, parseFilter(w));
    return filterCache.get(w)!;
  };
  let wantsLooks = false;
  /** The groups of look-alikes among the pictures read so far. */
  const similar = (): string[][] => similarGroups([...looks].flatMap(([id, l]) => (l ? [{ id, dhash: l.dhash }] : [])));
  const loadThumb = (img: HTMLImageElement): void => {
    const hash = img.dataset["hash"]!;
    thumbFor(hash).then(
      (url) => {
        thumbUrls.set(hash, url);
        img.src = url;
      },
      () => img.classList.add("is-broken"),
    );
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      loadThumb(e.target as HTMLImageElement);
    }
  });
  const dropStaleThumbs = (): void => {
    const live = new Set(listing?.entries.map((e) => e.hash));
    for (const [hash, p] of thumbs) {
      if (live.has(hash)) continue;
      thumbs.delete(hash);
      thumbUrls.delete(hash);
      void p.then((url) => URL.revokeObjectURL(url), () => undefined);
    }
  };

  // ---- viewer: the original in the library's own window, with the details beside it and the controls below (both can be hidden)
  const slideImg = viewer.querySelector<HTMLImageElement>("img")!;
  const slideMedia = viewer.querySelector<HTMLVideoElement>("video")!;
  const slideCaption = viewer.querySelector<HTMLElement>("figcaption")!;
  const slideTile = document.createElement("div");
  slideTile.className = "viewer-tile";
  slideTile.hidden = true;
  slideImg.after(slideTile);
  const pos = viewer.querySelector<HTMLElement>(".viewer-pos")!;
  let slideHash: string | null = null;
  /** The assets the viewer steps through: the whole library list, or only what was picked when the slideshow started from a selection. */
  let slideSet: Set<string> | null = null;
  let slideToken = 0;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let showing = false;
  let slideUrl: string | null = null;
  const freeSlideUrl = (): void => {
    if (slideUrl) URL.revokeObjectURL(slideUrl);
    slideUrl = null;
  };
  const ioFilm = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        ioFilm.unobserve(e.target);
        loadThumb(e.target as HTMLImageElement);
      }
    },
    { root: film, rootMargin: "0px 400px" },
  );
  /** The filmstrip: every asset of the current list, in order, the open one marked. */
  const viewList = (): CatalogListing["entries"] => (slideSet ? filtered().filter((e) => slideSet!.has(e.hash)) : filtered());
  const renderFilm = (): void => {
    const list = viewList();
    film.innerHTML = list
      .map(
        (e) =>
          `<button type="button" class="film-item${e.hash === slideHash ? " is-current" : ""}" role="option" aria-selected="${e.hash === slideHash}" data-hash="${e.hash}" aria-label="${esc(e.name || "Untitled")}" title="${esc(e.name || "Untitled")}">${isCard(e) ? fileTile(e, false) : `<img alt="" draggable="false" data-hash="${e.hash}">`}</button>`,
      )
      .join("");
    for (const img of film.querySelectorAll<HTMLImageElement>("img[data-hash]")) ioFilm.observe(img);
    const i = list.findIndex((e) => e.hash === slideHash);
    pos.textContent = i >= 0 ? `${i + 1} of ${list.length}` : "";
  };
  const markFilm = (): void => {
    for (const b of film.querySelectorAll<HTMLElement>(".film-item")) {
      const on = b.dataset["hash"] === slideHash;
      b.classList.toggle("is-current", on);
      b.setAttribute("aria-selected", String(on));
      if (on) b.scrollIntoView({ block: "nearest", inline: "center" });
    }
    const list = viewList();
    const i = list.findIndex((e) => e.hash === slideHash);
    pos.textContent = i >= 0 ? `${i + 1} of ${list.length}` : "";
  };
  // ---- zoom: the wheel (or a pinch) zooms at the pointer, a drag pans, a double-click toggles Fit and 100%, + - 0 1 work from the keyboard
  const stage = viewer.querySelector<HTMLElement>(".viewer-stage")!;
  // Video, audio and GIF play with the same engines and control bar as the on-canvas player (ADR 0064).
  const slideGif = viewer.querySelector<HTMLCanvasElement>(".viewer-gif")!;
  const slideVec = viewer.querySelector<HTMLCanvasElement>(".viewer-vec")!;
  // The controls lie over the bottom of the stage: the button that hides them floats just above them, wherever their height goes (a phone has two rows).
  const controlsBar = viewer.querySelector<HTMLElement>(".viewer-bar")!;
  new ResizeObserver(() => controlsBar.offsetHeight && viewer.style.setProperty("--viewer-bar-h", `${controlsBar.offsetHeight}px`)).observe(controlsBar); // (not while it is hidden: the strip keeps its size)
  /** The open picture is an SVG: it is drawn again at every zoom, on `slideVec`, so it is crisp at any size (the img only gives its size). */
  let vector = false;
  const avEng = avEngine(slideMedia);
  const gifEng = gifEngine(slideGif);
  const controls = mountPlayerControls(stage, settings, {
    extract: () => void extractFrame(),
  });
  let eng: Engine | null = null;
  const unloadMedia = (): void => {
    eng?.pause();
    avEng.unload();
    gifEng.unload();
    eng = null;
    controls.hide();
    clearTimeout(peekTimer);
    viewer.classList.remove("show-player");
    slideMedia.hidden = true;
    slideGif.hidden = true;
  };
  /**
   * Extract frame to the open canvas: the picture on screen now becomes a new PNG original in the library and is placed on the open
   * canvas at once (the viewer stays as it is). The picture may not be presented yet (a seek just landed): a few tries.
   */
  const extractFrame = async (): Promise<void> => {
    const engine = eng;
    const at = slideHash;
    if (!engine || !at || session.editor.blockEdit()) return;
    let png: Blob | null = null;
    for (let i = 0; i < 4 && !png; i++) {
      png = await engine.frame().catch(() => null);
      if (!png) await new Promise((r) => setTimeout(r, 250));
    }
    if (!png || eng !== engine) return;
    const src = listing?.entries.find((x) => x.hash === at);
    // The name, format, folder and tags come from Settings > Media and playback (ADR 0081).
    const record = await storeFrame(assets, session, settings, { png, label: engine.label(), sourceName: src?.name ?? "frame", sourceHash: at });
    if (!settings.get("frame.place")) {
      session.editor.message = `Frame “${record.name}” added to the library.`;
      session.editor.changed();
      return void (await refresh());
    }
    const id = await session.placeAsset(record.hash);
    const here = session.tree?.boards.flatMap((b) => b.canvases.map((c) => ({ b: b.board.name, c })))?.find((x) => x.c.id === session.current?.canvasId);
    session.editor.message = id ? `Frame placed on ${here ? `${here.b} › ${here.c.name}` : "the open canvas"} and added to the library.` : "The frame was added to the library; it could not be placed.";
    session.editor.changed();
  };
  // With the viewer's controls hidden the player is hidden too; a click inside the viewer brings back the player only (not the controls),
  // and it goes again after a few quiet seconds.
  let peekTimer = 0;
  const peek = (): void => {
    viewer.classList.add("show-player");
    clearTimeout(peekTimer);
    peekTimer = window.setTimeout(() => viewer.classList.remove("show-player"), 4000);
  };
  let downAt: { x: number; y: number } | null = null;
  stage.addEventListener("pointerdown", (e) => void (downAt = { x: e.clientX, y: e.clientY }), true);
  stage.addEventListener("click", (e) => {
    const moved = downAt ? Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) : 0;
    if (moved > 5 || !eng || !viewer.classList.contains("no-bar")) return;
    if ((e.target as HTMLElement).closest("button, .viewer-zoom, .media-bar, .viewer-edge")) return;
    peek();
  });
  controls.el.addEventListener("pointerdown", () => viewer.classList.contains("show-player") && peek(), true);
  controls.el.addEventListener("input", () => viewer.classList.contains("show-player") && peek());
  /** What a loaded file needs of the object the canvas player takes: where to start, and whether to loop. */
  const playOf = (repeat: boolean): ImageObject => ({ media: { t: 0, repeat } }) as unknown as ImageObject;
  const zoomPct = viewer.querySelector<HTMLElement>(".viewer-zoom-pct")!;
  const zoom = { s: 1, x: 0, y: 0 };
  const checker = viewer.querySelector<HTMLElement>(".viewer-checker")!;
  /** The open picture has see-through pixels. */
  let slideAlpha = false;
  slideImg.addEventListener("load", () => {
    slideAlpha = hasAlpha(slideImg);
    viewer.classList.toggle("has-alpha", slideAlpha);
    paintZoom();
  });
  const shownMedia = (): HTMLElement | null => (!slideGif.hidden && slideGif.width ? slideGif : !slideMedia.hidden && slideMedia.videoWidth ? slideMedia : !slideImg.hidden ? slideImg : null);
  /** The picture's own size and how big "fit" draws it (CSS px). */
  const sizes = (): { nw: number; nh: number; fw: number } | null => {
    const el = shownMedia();
    if (!el) return null;
    const nw = el instanceof HTMLVideoElement ? el.videoWidth : el instanceof HTMLCanvasElement ? el.width : (el as HTMLImageElement).naturalWidth;
    const nh = el instanceof HTMLVideoElement ? el.videoHeight : el instanceof HTMLCanvasElement ? el.height : (el as HTMLImageElement).naturalHeight;
    if (!nw || !nh) return null;
    const box = el.getBoundingClientRect();
    const boxW = el.offsetWidth || box.width / zoom.s;
    const boxH = el.offsetHeight || box.height / zoom.s;
    return { nw, nh, fw: Math.min(boxW, (boxH * nw) / nh) };
  };
  /** A see-through picture lies on a chequered ground that fills the stage and stays where it is (it does not zoom or move with the picture); an SVG is also drawn here, again at every zoom, so it is crisp. */
  const GROUND_NAME: Record<ViewGround, string> = { checker: "chequered", gray: "neutral grey", black: "black", white: "white" };
  /** The button that cycles the ground under see-through pictures says which one it is now and which comes next. */
  const labelGround = (): void => {
    const now = session.viewGround;
    const next = VIEW_GROUNDS[(VIEW_GROUNDS.indexOf(now) + 1) % VIEW_GROUNDS.length]!;
    const b = viewer.querySelector<HTMLElement>(".viewer-ground")!;
    b.title = `Background of see-through pictures: ${GROUND_NAME[now]} (click for ${GROUND_NAME[next]})`;
    b.setAttribute("aria-label", `Background of see-through pictures: ${GROUND_NAME[now]}. Next: ${GROUND_NAME[next]}`);
    b.dataset["ground"] = now;
  };
  const paintVector = (): void => {
    labelGround();
    const ground = !vector && !slideImg.hidden && slideAlpha && slideGif.hidden && slideMedia.hidden; // (a see-through picture: only the chequered ground)
    slideVec.hidden = !(vector || ground);
    if (!vector && !ground) return;
    const sr = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const [w, h] = [Math.max(1, Math.round(sr.width * dpr)), Math.max(1, Math.round(sr.height * dpr))];
    if (slideVec.width !== w || slideVec.height !== h) {
      slideVec.width = w;
      slideVec.height = h;
    }
    const g = slideVec.getContext("2d")!;
    g.clearRect(0, 0, w, h);
    const z = sizes();
    if (!z || !slideImg.complete) return;
    const base = slideImg.getBoundingClientRect(); // (a raster picture is scaled by a transform: its box already holds the zoom and the pan)
    const dw = z.fw * zoom.s;
    const dh = ((z.fw * z.nh) / z.nw) * zoom.s;
    const x = base.left + base.width / 2 - sr.left + (vector ? zoom.x : 0) - dw / 2;
    const y = base.top + base.height / 2 - sr.top + (vector ? zoom.y : 0) - dh / 2;
    const cs = getComputedStyle(viewer);
    const cell = Math.max(2, Math.round(16 * dpr));
    const tile = document.createElement("canvas");
    tile.width = tile.height = cell * 2;
    const t = tile.getContext("2d")!;
    t.fillStyle = cs.getPropertyValue("--check-b").trim() || "#2a2a2a";
    t.fillRect(0, 0, cell * 2, cell * 2);
    t.fillStyle = cs.getPropertyValue("--check-a").trim() || "#3a3a3a";
    t.fillRect(cell, 0, cell, cell);
    t.fillRect(0, cell, cell, cell);
    const tone = session.viewGround;
    g.fillStyle = tone === "gray" ? "#808080" : tone === "black" ? "#000000" : tone === "white" ? "#ffffff" : (g.createPattern(tile, "repeat") ?? "transparent"); // (the whole stage, anchored to it: the picture slides over a ground that stays put)
    g.fillRect(0, 0, w, h);
    if (vector) g.drawImage(slideImg, x * dpr, y * dpr, dw * dpr, dh * dpr);
  };
  window.addEventListener("resize", paintVector);
  // The stage changes size when the controls are hidden or shown (and with the window): the picture is fitted and drawn again for its new size, so an SVG is never a stale bitmap stretched to fit.
  new ResizeObserver(() => paintZoom()).observe(stage);
  const paintZoom = (): void => {
    const el = shownMedia();
    const z = sizes();
    const vec = vector && el === slideImg;
    for (const m of [slideImg, slideMedia, slideGif]) m.style.transform = m === el && !vec && (zoom.s !== 1 || zoom.x || zoom.y) ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})` : "";
    // A picture with see-through pixels sits on a chequered ground exactly the size of the picture, zoomed with it.
    checker.hidden = true; // (the chequered ground is drawn on the canvas under the picture, where it stays put)
    if (!checker.hidden && z) {
      const tile = checker.firstElementChild as HTMLElement;
      tile.style.width = `${z.fw}px`;
      tile.style.height = `${(z.fw * z.nh) / z.nw}px`;
      checker.style.transform = slideImg.style.transform;
    }
    zoomPct.textContent = z ? (zoom.s === 1 ? "Fit" : `${Math.round(((zoom.s * z.fw) / z.nw) * 100)}%`) : "Fit";
    viewer.classList.toggle("is-zoomed", zoom.s !== 1);
    paintVector();
  };
  const resetZoom = (): void => {
    zoom.s = 1;
    zoom.x = zoom.y = 0;
    paintZoom();
  };
  /** Keep part of the picture on the stage whatever the zoom. */
  const clampPan = (): void => {
    const z = sizes();
    if (!z) return;
    const sr = stage.getBoundingClientRect();
    const w = z.fw * zoom.s;
    const h = ((z.fw * z.nh) / z.nw) * zoom.s;
    const mx = Math.max(0, (w + sr.width) / 2 - 48);
    const my = Math.max(0, (h + sr.height) / 2 - 48);
    zoom.x = Math.max(-mx, Math.min(mx, zoom.x));
    zoom.y = Math.max(-my, Math.min(my, zoom.y));
  };
  /** Set the zoom, keeping the point (px, py) of the page where it is on the screen. */
  const zoomAt = (next: number, px: number, py: number): void => {
    const z = sizes();
    if (!z) return;
    const lo = Math.min(1, z.nw / z.fw);
    const hi = Math.max(8 * (z.nw / z.fw), 4);
    next = Math.max(lo, Math.min(hi, next));
    const sr = stage.getBoundingClientRect();
    const cx = px - (sr.left + sr.width / 2);
    const cy = py - (sr.top + sr.height / 2);
    const k = next / zoom.s;
    zoom.x = cx - (cx - zoom.x) * k;
    zoom.y = cy - (cy - zoom.y) * k;
    zoom.s = Math.abs(next - 1) < 0.02 ? 1 : next;
    if (zoom.s === 1) zoom.x = zoom.y = 0;
    clampPan();
    paintZoom();
  };
  const centre = (): [number, number] => {
    const r = stage.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  /** Fit, or the picture at its own size (100%) around a point. */
  const toggleActual = (px?: number, py?: number): void => {
    const z = sizes();
    if (!z) return;
    const [cx, cy] = px === undefined || py === undefined ? centre() : [px, py];
    if (zoom.s === 1) zoomAt(z.nw / z.fw, cx, cy);
    else resetZoom();
  };
  stage.addEventListener(
    "wheel",
    (e) => {
      if (!shownMedia()) return;
      e.preventDefault();
      zoomAt(zoom.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX, e.clientY);
    },
    { passive: false },
  );
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  stage.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button, .viewer-zoom, .media-bar")) return; // (the video itself pans and zooms like a picture: it has no controls of its own)
    if (!shownMedia()) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.setPointerCapture(e.pointerId);
    if (zoom.s !== 1) viewer.classList.add("is-grabbing");
    pinch = pointers.size === 2 ? Math.hypot(...[...pointers.values()].reduce((a, p, i) => (i ? [p.x - a[0]!, p.y - a[1]!] : [p.x, p.y]), [0, 0] as number[]) as [number, number]) : 0;
  });
  stage.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) zoomAt(zoom.s * (d / pinch), (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = d;
    } else if (zoom.s !== 1) {
      zoom.x += e.clientX - prev.x;
      zoom.y += e.clientY - prev.y;
      clampPan();
      paintZoom();
    }
  });
  const endPointer = (e: PointerEvent): void => {
    viewer.classList.remove("is-grabbing");
    pointers.delete(e.pointerId);
    pinch = 0;
  };
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);
  stage.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest("button, .viewer-zoom")) return;
    toggleActual(e.clientX, e.clientY);
  });
  viewer.querySelector<HTMLElement>(".viewer-zoom")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-zoom]");
    if (!b) return;
    const [cx, cy] = centre();
    if (b.dataset["zoom"] === "in") zoomAt(zoom.s * 1.25, cx, cy);
    else if (b.dataset["zoom"] === "out") zoomAt(zoom.s / 1.25, cx, cy);
    else toggleActual();
  });
  for (const m of [slideImg, slideMedia]) {
    m.addEventListener("load", paintZoom);
    m.addEventListener("loadedmetadata", paintZoom);
  }

  const showSlide = async (hash: string): Promise<void> => {
    const e = listing?.entries.find((x) => x.hash === hash);
    if (!e) return;
    const token = ++slideToken;
    const opening = viewer.hidden;
    resetZoom();
    slideHash = hash;
    body.classList.add("is-viewing");
    root.classList.add("is-viewing");
    viewer.hidden = false;
    syncViewing();
    viewer.focus();
    // The details beside the viewer describe the open asset (a picked set stays picked while a slideshow plays through it).
    selected = hash;
    if (!slideSet) {
      picked.clear();
      picked.add(hash);
    } else picked.add(hash);
    anchor = hash;
    const found = await session.assetPlaces(hash);
    // The library and the details follow the selection even if the viewer has been closed or moved on while the places were read.
    if (selected === hash) places = found;
    markPicked();
    renderInspector();
    if (token !== slideToken) return;
    const fav = viewer.querySelector<HTMLElement>('[data-act="favorite"]')!;
    fav.setAttribute("aria-pressed", String(meta(e).favorite));
    viewer.querySelector<HTMLButtonElement>('[data-act="place"]')!.disabled = !e.present || session.readOnly;
    if (opening) renderFilm();
    else markFilm();
    const label = `${e.name || "Untitled"}, ${e.pixelW} × ${e.pixelH} px, ${fmtBytes(e.size)}`;
    slideCaption.textContent = label;
    slideCaption.classList.remove("is-note"); // the file name is in the details; the caption shows only a note
    slideImg.className = Math.max(e.pixelW, e.pixelH) < THUMB_PX ? "is-pixelated" : "";
    // A small original is not stretched across the page into a blur: it is shown up to three times its own size, centred.
    slideImg.style.maxWidth = `${e.pixelW * 3}px`;
    slideImg.style.maxHeight = `${e.pixelH * 3}px`;
    freeSlideUrl();
    unloadMedia();
    vector = false;
    slideVec.hidden = true;
    slideImg.classList.remove("is-vector");
    slideImg.hidden = false;
    slideTile.hidden = true;
    slideAlpha = false;
    checker.hidden = true;
    const rec = e.present ? await assets.record(hash).catch(() => undefined) : undefined;
    if (token !== slideToken) return;
    if (rec?.type === "image/svg+xml") {
      // A vector picture is the picture itself, drawn at the size it is shown: not capped at a few times its small natural size, and never pixelated.
      slideImg.className = "";
      slideImg.style.maxWidth = "";
      slideImg.style.maxHeight = "";
      vector = true;
      slideVec.hidden = false;
      slideImg.classList.add("is-vector");
    }
    const thumbnail = async (): Promise<void> => {
      vector = false;
      slideVec.hidden = true;
      slideImg.classList.remove("is-vector");
      slideCaption.textContent = `${label}. The original is missing or damaged; showing its thumbnail.`;
      slideCaption.classList.add("is-note");
      slideImg.src = await thumbFor(hash).catch(() => "");
    };
    if (!rec) return void (await thumbnail());
    if (isCard(rec)) {
      // Not something the browser can show: its card, large, and what it is (ADR 0078).
      const d = describeFile(rec.name, rec.type);
      slideImg.hidden = true;
      slideTile.innerHTML = fileTile(rec);
      slideTile.hidden = false;
      slideCaption.textContent = `${label}. No preview for this kind of file: ${d.todo}`;
      slideCaption.classList.add("is-note");
      armShow();
      return;
    }
    slideUrl = URL.createObjectURL(rec.blob);
    if (/^(video|audio)\//.test(rec.type)) {
      // A video or audio original plays here, with the same player as on the canvas (an audio file shows the picture of its waveform above it).
      const isVideo = rec.type.startsWith("video/");
      slideImg.hidden = isVideo;
      if (!slideImg.hidden) slideImg.src = await thumbFor(hash).catch(() => "");
      avEng.visual = isVideo;
      avEng.onEnded = () => {
        controls.refresh();
        if (showing) stepSlide(1);
      };
      slideMedia.hidden = false;
      try {
        await avEng.load(playOf(false), rec.blob, rec.duration ?? 0);
      } catch {
        if (token !== slideToken) return;
        unloadMedia();
        slideImg.hidden = false;
        void thumbnail();
        return;
      }
      if (token !== slideToken) return;
      eng = avEng;
      controls.show(avEng, isVideo ? "video" : "audio", false);
      // In a slideshow a video or audio file plays and the show moves on when it ends.
      if (showing) avEng.play();
      armShow();
      return;
    }
    if (rec.type === "image/gif" && (rec.frames ?? 0) > 1) {
      // An animated GIF plays frame by frame, with the same controls (it loops until the slideshow moves on).
      slideImg.hidden = true;
      slideGif.hidden = false;
      try {
        await gifEng.load(playOf(true), rec.blob, 0);
      } catch {
        if (token !== slideToken) return;
        unloadMedia();
        slideImg.hidden = false;
        slideImg.src = slideUrl;
        armShow();
        return;
      }
      if (token !== slideToken) return;
      eng = gifEng;
      controls.show(gifEng, "gif", true);
      gifEng.play();
      paintZoom();
      armShow();
      return;
    }
    slideImg.onerror = () => void thumbnail();
    slideImg.src = slideUrl;
    armShow();
  };
  // With the controls hidden, the back arrow and the details toggle at the top show again while the pointer is near the top edge.
  viewer.addEventListener("pointermove", (e) => {
    if (!viewer.classList.contains("no-bar")) return;
    const r = viewer.getBoundingClientRect();
    viewer.classList.toggle("is-near-top", e.clientY - r.top < 90);
    viewer.classList.toggle("is-near-bottom", r.bottom - e.clientY < 90);
  });
  viewer.addEventListener("pointerleave", () => viewer.classList.remove("is-near-top", "is-near-bottom"));
  const closeSlide = (): void => {
    const was = slideHash;
    stopShow();
    slideSet = null;
    slideToken++;
    slideHash = null;
    viewer.hidden = true;
    body.classList.remove("is-viewing");
    root.classList.remove("is-viewing");
    syncViewing();
    slideImg.onerror = null;
    slideImg.removeAttribute("src");
    unloadMedia();
    freeSlideUrl();
    film.innerHTML = "";
    // Back in the library the card of the asset that was open is in view.
    if (was) grid.querySelector<HTMLElement>(`.asset-card[data-hash="${was}"]`)?.scrollIntoView({ block: "nearest" });
  };
  // The invisible edges of the viewer: a click on the left or right side goes to the previous or next asset (the width is a setting).
  const applyEdge = (): void => void viewer.style.setProperty("--edge-w", String(settings.get("assets.edgeWidth")));
  applyEdge();
  for (const edge of viewer.querySelectorAll<HTMLElement>(".viewer-edge")) {
    edge.addEventListener("click", (e) => {
      e.stopPropagation();
      stepSlide(edge.dataset["edge"] === "prev" ? -1 : 1);
    });
    for (const type of ["pointerdown", "dblclick"]) edge.addEventListener(type, (e) => e.stopPropagation());
  }
  const stepSlide = (d: number): void => {
    const list = viewList().map((x) => x.hash);
    const i = list.indexOf(slideHash ?? "");
    if (i >= 0 && list.length > 1) void showSlide(list[(i + d + list.length) % list.length]!);
  };
  // ---- slideshow: moves to the next asset after the chosen time (a video or audio file plays to its end first) and wraps round
  const progress = viewer.querySelector<HTMLElement>(".viewer-progress")!;
  const playBtn = viewer.querySelector<HTMLElement>('[data-act="play"]')!;
  const clearShowTimer = (): void => {
    if (showTimer) clearTimeout(showTimer);
    showTimer = null;
    progress.hidden = true;
  };
  /** Arm the timer for the asset now open (not for a playing video: its end moves the show on). */
  const armShow = (): void => {
    clearShowTimer();
    if (!showing || viewer.hidden) return;
    if (!slideMedia.hidden) return; // a video or audio file: `ended` steps
    const ms = settings.get("assets.slideSeconds") * 1000;
    progress.style.setProperty("--ms", `${ms}ms`);
    progress.hidden = false;
    progress.classList.remove("is-running");
    void progress.offsetWidth; // restart the bar
    progress.classList.add("is-running");
    showTimer = setTimeout(() => stepSlide(1), ms);
  };
  const setShowing = (on: boolean): void => {
    showing = on;
    viewer.classList.toggle("is-showing", on);
    playBtn.setAttribute("aria-pressed", String(on));
    playBtn.setAttribute("aria-label", on ? "Pause the slideshow" : "Start the slideshow");
    playBtn.title = on ? "Pause the slideshow (Space)" : "Start the slideshow (Space)";
    playBtn.innerHTML = on ? ICONS.pause : ICONS.presentation;
    if (on) {
      if (eng === avEng) avEng.play();
      armShow();
    } else clearShowTimer();
  };
  const stopShow = (): void => setShowing(false);
  // The time per slide is a setting (Settings > Media and playback); a change applies to the slide on screen.
  settings.subscribe((key) => {
    if (key === "assets.edgeWidth") applyEdge();
    if (key === "assets.slideSeconds") armShow();
  });
  /** Open the viewer on one asset and start the slideshow; `only` limits it to a picked set. */
  const startShow = (hash: string, only?: Set<string>): void => {
    slideSet = only && only.size > 1 ? new Set(only) : null;
    void showSlide(hash).then(() => setShowing(true));
  };
  /** The details panel was opened by a plain click on a card (so a double-click can undo it); only on a narrow window, where it is a sheet. */
  let autoShown = false;
  const toggleDetails = (): void => {
    autoShown = false;
    ui.details = !ui.details;
    saveUi();
    applyUi();
    if (!viewer.hidden) viewer.focus();
  };
  const toggleBar = (): void => {
    ui.bar = !ui.bar;
    saveUi();
    applyUi();
    // The button that was pressed may have just been hidden: keep the keyboard in the viewer.
    if (!viewer.hidden) viewer.focus();
  };
  viewer.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const film1 = t.closest<HTMLElement>(".film-item");
    if (film1) return void showSlide(film1.dataset["hash"]!);
    const act = t.closest<HTMLElement>("[data-act]")?.dataset["act"];
    if (act === "prev") stepSlide(-1);
    else if (act === "next") stepSlide(1);
    else if (act === "close") closeSlide();
    else if (act === "ground") {
      const now = session.viewGround;
      void session.setViewGround(VIEW_GROUNDS[(VIEW_GROUNDS.indexOf(now) + 1) % VIEW_GROUNDS.length]!);
      paintVector();
    }
    else if (act === "play") setShowing(!showing);
    else if (act === "fullscreen") void (document.fullscreenElement ? document.exitFullscreen() : viewer.requestFullscreen()).catch(() => undefined);
    else if (act === "details") toggleDetails();
    else if (act === "bar") toggleBar();
    else if (act === "favorite" || act === "place") inspector.querySelector<HTMLButtonElement>(`[data-action="${act}"]`)?.click();
  });
  viewer.addEventListener("keydown", (e) => {
    const typing = (e.target as HTMLElement).closest(TYPING);
    if (e.key === "Escape") {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      else closeSlide();
    } else if (typing) return;
    else if (e.key === "ArrowLeft") stepSlide(-1);
    else if (e.key === "ArrowRight") stepSlide(1);
    else if (e.key === " " && !(e.target as HTMLElement).closest("button, video")) setShowing(!showing);
    else if (e.key === "i" || e.key === "I") toggleDetails();
    else if (e.key === "f" || e.key === "F") toggleBar();
    else if (e.key === "+" || e.key === "=") zoomAt(zoom.s * 1.25, ...centre());
    else if (e.key === "-" || e.key === "_") zoomAt(zoom.s / 1.25, ...centre());
    else if (e.key === "0") resetZoom();
    else if (e.key === "1") toggleActual();
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  // ---- data
  const refresh = async (): Promise<void> => {
    if (!visible) return;
    const gen = ++generation;
    if (!session.catalog) {
      grid.innerHTML = `<p class="assets-empty">Storage is unavailable, so there is no library in this tab.</p>`;
      return;
    }
    await session.persistence.flush(); // usage reflects every edit made so far
    const l = await session.catalog.list();
    if (gen !== generation) return;
    listing = l;
    dropStaleThumbs();
    if (scope.startsWith("folder:") && !l.folders.some((f) => `folder:${f.id}` === scope)) scope = "all";
    const known = new Set([...l.entries.map((e) => e.hash), ...l.missing.map((m) => m.hash)]);
    for (const h of [...picked]) if (!known.has(h)) picked.delete(h);
    if (selected && !known.has(selected)) selected = [...picked].pop() ?? null;
    places = selected && picked.size === 1 ? await session.assetPlaces(selected) : [];
    canvasTags = await session.canvasTagIndex().catch(() => canvasTags);
    assetCanvasTags = selected && picked.size <= 1 ? await session.canvasTagsOfAsset(selected).catch(() => []) : [];
    if (gen !== generation) return;
    if (scope.startsWith("ctag:") && !canvasTags.has(scope.slice(5))) scope = "all";
    render();
  };

  const usesText = (instances: number, canvases: number): string =>
    instances === 0 ? "Unused" : `Used ${instances} time${instances === 1 ? "" : "s"} on ${canvases} canvas${canvases === 1 ? "" : "es"}`;

  type Way = "all" | "name" | "tag";
  let way: Way = "all";
  const searchWords = (q: string): Query | null => parseQuery(q).query;
  /**
   * The search (ADR 0069, 0071): a word matches the name, type, start of the hash or a tag (All), only the name (Name) or only the tags (Tag);
   * `#tag` is an exact tag and `.png` an exact file type, in every way. AND, OR, XOR, NOT and brackets combine words. Then the usage filter.
   */
  const matchesQuery = (e: CatalogListing["entries"][number], query: Query | null, usage: UsageFilter, how: Way = way): boolean => {
    const tags = meta(e).tags.map((t) => t.toLowerCase());
    const name = e.name.toLowerCase();
    const words_ok = evalQuery(query, ({ text: w }) => {
      if (w.startsWith("#")) return tags.some((t) => tagIsOrUnder(t, w.slice(1))); // a tag and the tags nested under it
      // `.png` is the file type: a word that starts with a dot matches files with that extension (a lone dot: files that have one).
      if (w.startsWith(".")) return w.length > 1 ? chipOf(e.name, e.type).toLowerCase() === w.slice(1) : extOf(e.name) !== "";
      const f = filterOf(w);
      if (f) {
        const verdict = f.test(e, looks.get(e.hash));
        if (verdict === "unknown") {
          if (f.needsLook) wantsLooks = true;
          return false;
        }
        return verdict;
      }
      const inTags = tags.some((t) => t.includes(w));
      if (how === "tag") return inTags;
      if (how === "name") return name.includes(w);
      return name.includes(w) || e.type.toLowerCase().includes(w) || e.hash.startsWith(w) || inTags;
    });
    return words_ok && (usage === "all" || (usage === "used" ? e.instances > 0 : e.instances === 0));
  };
  const filtered = (): CatalogListing["entries"] => {
    if (!listing) return [];
    // shortcut: a linear filter over the in-memory listing; add a tag/name index if libraries reach tens of thousands.
    const words = searchWords(search.value);
    wantsLooks = scope === "similar";
    const usage = usageSel.value as UsageFilter;
    const group = new Map<string, number>();
    if (scope === "similar") similar().forEach((g, i) => g.forEach((h) => group.set(h, i)));
    const inFolders = scope.startsWith("folder:") ? folderSubtree(listing.folders, scope.slice(7)) : null;
    const inScope = (e: CatalogListing["entries"][number]): boolean => {
      const m = meta(e);
      if (scope === "similar") return group.has(e.hash);
      if (scope === "favorites") return m.favorite;
      if (scope === "unfiled") return m.folderIds.length === 0;
      if (inFolders) return m.folderIds.some((id) => inFolders.has(id));
      if (scope.startsWith("ext:")) return chipOf(e.name, e.type).toLowerCase() === scope.slice(4);
      if (scope.startsWith("tag:")) return m.tags.some((t) => tagIsOrUnder(t, scope.slice(4)));
      if (scope.startsWith("ctag:")) return canvasTags.get(scope.slice(5))?.assets.has(e.hash) ?? false;
      return true;
    };
    const rows = listing.entries.filter((e) => inScope(e) && matchesQuery(e, words, usage));
    if (wantsLooks) ensureLooks(listing.entries.filter((e) => !isCard(e)).map((e) => e.hash));
    // Look-alikes are listed together, the biggest group first, whatever the sort (the point is to see them side by side).
    if (scope === "similar") return rows.sort((a, b) => group.get(a.hash)! - group.get(b.hash)! || a.name.localeCompare(b.name));
    const key = sortSel.value as SortKey;
    const folderOf = (e: (typeof rows)[number]): string => (meta(e).folderIds[0] ? folderPath(listing!.folders, meta(e).folderIds[0]!).join(" › ") : "");
    const cmp: Record<SortKey, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = {
      newest: (a, b) => b.importedAt - a.importedAt,
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => b.size - a.size,
      uses: (a, b) => b.instances - a.instances,
      pixels: (a, b) => b.pixelW * b.pixelH - a.pixelW * a.pixelH,
      type: (a, b) => chipOf(a.name, a.type).localeCompare(chipOf(b.name, b.type)),
      tags: (a, b) => meta(a).tags.join(" ").localeCompare(meta(b).tags.join(" ")) || a.name.localeCompare(b.name),
      folder: (a, b) => folderOf(a).localeCompare(folderOf(b)) || a.name.localeCompare(b.name),
      favourite: (a, b) => Number(meta(b).favorite) - Number(meta(a).favorite),
      width: (a, b) => b.pixelW - a.pixelW,
      height: (a, b) => b.pixelH - a.pixelH,
      canvases: (a, b) => b.canvases - a.canvases,
    };
    const flip = reversed ? -1 : 1;
    return rows.sort((a, b) => flip * cmp[key](a, b) || (a.hash < b.hash ? -1 : 1));
  };

  // ---- rendering
  let lastGridHtml = "";
  const render = (): void => {
    root.querySelector<HTMLElement>(".assets-searchbox .cs-clear")!.hidden = !search.value;
    if (!listing) return;
    const rows = filtered();
    const usageAll = usageSel.value === "all" && !search.value.trim() && scope === "all";
    count.textContent = `${rows.length === listing.entries.length ? "" : `${rows.length} of `}${listing.entries.length} item${listing.entries.length === 1 ? "" : "s"}`;
    const check = (hash: string, name: string): string => `<input type="checkbox" class="asset-check" data-hash="${hash}" aria-label="Select ${esc(name)}">`;
    const cards = rows.map((e) => {
      const small = Math.max(e.pixelW, e.pixelH) < THUMB_PX ? " is-pixelated" : "";
      const ar = Math.max(0.4, Math.min(3, e.pixelW / Math.max(1, e.pixelH)));
      const name = e.name || "Untitled";
      return `<div class="asset-cell" role="listitem" style="--ar:${ar.toFixed(3)}">
        <button type="button" class="asset-card${e.present ? "" : " is-missing"}" data-testid="asset-card" data-hash="${e.hash}" draggable="${session.readOnly ? "false" : "true"}"
          aria-pressed="false" aria-label="${esc(name)}, ${e.pixelW} × ${e.pixelH} px" title="${esc(name)}">
        <span class="asset-thumb">${isCard(e) ? fileTile(e) : `<img alt="" draggable="false" class="${small.trim()}" data-hash="${e.hash}"${thumbUrls.has(e.hash) ? ` src="${thumbUrls.get(e.hash)}"` : ""}><span class="ext-chip">${esc(chipOf(e.name, e.type))}</span>`}</span>
        ${e.present ? "" : `<span class="asset-missing-label">Original missing</span>`}
        <span class="asset-info">
          <span class="asset-name">${esc(name)}</span>
          <span class="asset-meta">${e.pixelW} × ${e.pixelH} px</span>
          <span class="asset-type">${esc(chipOf(e.name, e.type))}</span>
          <span class="asset-size">${fmtBytes(e.size)}</span>
          <span class="asset-folder">${esc(meta(e).folderIds[0] ? folderPath(listing!.folders, meta(e).folderIds[0]!).join(" › ") : "")}</span>
          <span class="asset-fav">${meta(e).favorite ? "★ Favourite" : ""}</span>
          <span class="asset-width">${e.pixelW} px</span>
          <span class="asset-height">${e.pixelH} px</span>
          <span class="asset-canvases">${e.canvases}</span>
          <span class="asset-added">${new Date(e.importedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>
          <span class="asset-uses" data-testid="asset-uses">${usesText(e.instances, e.canvases)}</span>
          ${meta(e).tags.length ? `<span class="asset-tags" data-testid="asset-card-tags">${meta(e).tags.map((t) => `<span class="tag-pill">#${esc(t)}</span>`).join(" ")}</span>` : `<span class="asset-tags"></span>`}
        </span>
      </button>
      ${check(e.hash, name)}
      </div>`;
    });
    const missing = usageAll
      ? listing.missing.map(
          (m) => `<div class="asset-cell" role="listitem" style="--ar:1.4">
            <button type="button" class="asset-card is-missing" data-testid="asset-missing" data-hash="${m.hash}" aria-pressed="false" aria-label="Missing original">
              <span class="asset-thumb"></span>
              <span class="asset-missing-label">Original missing</span>
              <span class="asset-info">
                <span class="asset-name">Missing original</span>
                <span class="asset-meta">${m.hash.slice(0, 12)}…</span>
                <span class="asset-added"></span>
                <span class="asset-uses" data-testid="asset-uses">${usesText(m.instances, m.canvases)}</span>
                <span class="asset-tags"></span>
              </span>
            </button>
            ${check(m.hash, "missing original")}
          </div>`,
        )
      : [];
    const html = cards.length + missing.length
      ? cards.join("") + missing.join("")
      : listing.entries.length
        ? `<p class="assets-empty">Nothing in the library matches.</p>`
        : `<p class="assets-empty">The library is empty. Import files here (any type), or drop them on a canvas.</p>`;
    grid.style.setProperty("--thumb", `${sizeInput.value}px`);
    // The cards are only drawn again when something about them changed: picking, opening and typing leave them (and the pictures) alone.
    if (html !== lastGridHtml) {
      const ae = document.activeElement as HTMLElement | null;
      const focused = ae && grid.contains(ae) ? { hash: ae.dataset["hash"], box: ae.classList.contains("asset-check") } : null;
      grid.innerHTML = html;
      lastGridHtml = html;
      if (focused?.hash) grid.querySelector<HTMLElement>(`${focused.box ? ".asset-check" : ".asset-card"}[data-hash="${focused.hash}"]`)?.focus({ preventScroll: true });
      for (const img of grid.querySelectorAll<HTMLImageElement>("img[data-hash]:not([src])")) io.observe(img);
    }
    markPicked();
    renderSide();
    renderInspector();
    if (slideHash && !viewer.hidden) {
      if (listing.entries.some((x) => x.hash === slideHash)) renderFilm();
      else closeSlide(); // the open asset was deleted
    }
    importBtn.disabled = session.readOnly;
  };

  const renderSide = (): void => {
    if (!listing) return;
    const entries = listing.entries;
    const tagCounts = new Map<string, { label: string; n: number }>();
    for (const e of entries) for (const t of meta(e).tags) {
      const k = t.toLowerCase();
      const c = tagCounts.get(k);
      if (c) c.n++;
      else tagCounts.set(k, { label: t, n: 1 });
    }
    // The file types in the workspace: one chip per extension, with how many files have it.
    const typeCounts = new Map<string, number>();
    for (const e of entries) {
      const k = chipOf(e.name, e.type).toLowerCase();
      typeCounts.set(k, (typeCounts.get(k) ?? 0) + 1);
    }
    const ro = session.readOnly;
    const kindWord = { folder: "folder", tag: "tag", ctag: "canvas tag", style: "style" } as const;
    /** A row's "more" button and, when open, its labelled menu (Rename, Delete and so on): one button instead of a row of them. */
    const more = (kind: "folder" | "tag" | "ctag" | "style", id: string, name: string, items: Array<{ attr: string; label: string; icon: string; aria: string; danger?: boolean }>): string => {
      if (ro) return "";
      const open = sideMenu?.kind === kind && sideMenu.id === id;
      return `<button type="button" class="side-more" data-side-more data-kind="${kind}" data-id="${esc(id)}" aria-haspopup="menu" aria-expanded="${open}" aria-label="More actions for ${kindWord[kind]} ${esc(name)}" title="More">${ICONS.ellipsis}</button>${
        open
          ? `<div class="side-menu" role="menu" aria-label="Actions for ${kindWord[kind]} ${esc(name)}">${items
              .map((i) => `<button type="button" role="menuitem" class="${i.danger ? "is-danger" : ""}" ${i.attr} data-id="${esc(id)}" data-key="${esc(id)}" aria-label="${esc(i.aria)}">${i.icon}<span>${i.label}</span></button>`)
              .join("")}</div>`
          : ""
      }`;
    };
    const item = (key: string, label: string, n: number, opts: { depth?: number; icon?: string; extra?: string; cls?: string } = {}): string =>
      `<li class="side-row ${opts.cls ?? ""}" style="--depth:${opts.depth ?? 0}"><button type="button" class="side-item${scope === key ? " is-active" : ""}" data-scope="${esc(key)}" aria-current="${scope === key}" title="${label.replace(/<[^>]*>/g, "")}">
        ${opts.icon ?? ""}<span class="side-label">${label}</span><span class="side-n">${n}</span></button>${opts.extra ?? ""}</li>`;
    const nameInput = (value: string, label: string): string =>
      `<li class="side-row"><input class="side-name" data-testid="folder-name-input" value="${esc(value)}" aria-label="${label}" maxlength="120"></li>`;
    const subtreeCount = (id: string): number => {
      const ids = folderSubtree(listing!.folders, id);
      return entries.filter((e) => meta(e).folderIds.some((x) => ids.has(x))).length;
    };
    const tree = (parent: string | null, depth: number): string =>
      listing!.folders
        .filter((f) => f.parentId === parent)
        .map((f) =>
          naming?.kind === "rename" && naming.id === f.id
            ? nameInput(f.name, `New name for folder ${f.name}`)
            : item(`folder:${f.id}`, esc(f.name), subtreeCount(f.id), {
                depth,
                icon: ICONS.folder,
                extra: more("folder", f.id, f.name, [
                  { attr: 'data-folder-action="new"', label: "New subfolder", icon: ICONS.folderPlus, aria: `New folder inside ${f.name}` },
                  { attr: 'data-folder-action="rename"', label: "Rename", icon: ICONS.textCursorInput, aria: `Rename folder ${f.name}` },
                  { attr: 'data-folder-action="delete"', label: "Delete", icon: ICONS.trash2, aria: `Delete folder ${f.name}`, danger: true },
                ]),
              }) +
              (naming?.kind === "new" && naming.parent === f.id ? nameInput("", `Name of the new folder inside ${f.name}`) : "") +
              tree(f.id, depth + 1),
        )
        .join("");
    /** A section with a header that folds it away (remembered on this device) and an optional add button. */
    const section = (id: string, title: string, add: string, body: string): string => {
      const closed = ui.closed.includes(id);
      return `<section class="side-sec${closed ? " is-closed" : ""}" data-sec="${id}">
        <div class="side-head"><button type="button" class="side-sec-toggle" data-sec-toggle="${id}" aria-expanded="${!closed}" aria-label="${title}">${closed ? ICONS.chevronRight : ICONS.chevronDown}<h2>${title}</h2></button>${add}</div>
        ${closed ? "" : body}</section>`;
    };
    const addBtn = (attr: string, label: string, extra = ""): string => (ro ? "" : `<button type="button" class="side-add" ${attr} aria-label="${label}" title="${label}"${extra}>${ICONS.folderPlus}</button>`);
    const scopeName = ((): string => {
      if (scope === "all") return "All items";
      if (scope === "favorites") return "Favourites";
      if (scope === "unfiled") return "Unfiled";
      if (scope === "similar") return "Similar images";
      if (scope.startsWith("folder:")) return listing!.folders.find((f) => `folder:${f.id}` === scope)?.name ?? "Folder";
      if (scope.startsWith("ext:")) return `File type .${scope.slice(4).toUpperCase()}`;
      if (scope.startsWith("tag:")) return `#${tagCounts.get(scope.slice(4))?.label ?? scope.slice(4)}`;
      if (scope.startsWith("ctag:")) return `Canvas tag #${canvasTags.get(scope.slice(5))?.label ?? scope.slice(5)}`;
      return "Library";
    })();
    side.dataset["open"] = String(sideOpen);
    side.innerHTML = `
      <button type="button" class="side-collapse" data-side-toggle aria-expanded="${sideOpen}">${ICONS.panelLeft}<span class="side-label">Library: ${esc(scopeName)}</span>${sideOpen ? ICONS.chevronUp : ICONS.chevronDown}</button>
      <div class="side-body">
        <ul class="side-list side-views">
          ${item("all", "All items", entries.length, { icon: ICONS.images })}
          ${item("favorites", "Favourites", entries.filter((e) => meta(e).favorite).length, { icon: ICONS.star })}
          ${item("unfiled", "Unfiled", entries.filter((e) => meta(e).folderIds.length === 0).length, { icon: ICONS.folderX })}
          ${item("similar", "Similar images", similar().reduce((n, g) => n + g.length, 0), { icon: ICONS.copyCheck })}
        </ul>
        ${section(
          "folders",
          "Folders",
          addBtn('data-folder-action="new" data-id="" data-testid="folder-new"', "New folder"),
          `<ul class="side-list" data-testid="folder-tree">
            ${naming?.kind === "new" && naming.parent === null ? nameInput("", "Name of the new folder") : ""}
            ${tree(null, 0) || (naming ? "" : `<li class="side-empty">No folders yet.</li>`)}
          </ul>`,
        )}
        ${section(
          "types",
          "File types",
          "",
          `<ul class="tag-cloud type-cloud" data-testid="type-list">
            ${
              [...typeCounts]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([k, n]) => item(`ext:${k}`, `.${esc(k.toUpperCase())}`, n, { cls: "is-tag is-type" }).replace("<button ", `<button title="Files ending in .${esc(k)}. Search .${esc(k)} to find them" `))
                .join("") || `<li class="side-empty">No files yet.</li>`
            }
          </ul>`,
        )}
        ${section(
          "tags",
          "Tags",
          "",
          `<ul class="tag-cloud" data-testid="tag-list">
            ${
              [...tagCounts]
                .sort((a, b) => a[1].label.localeCompare(b[1].label))
                .map(([k, c]) =>
                  naming?.kind === "rename-tag" && naming.key === k
                    ? nameInput(c.label, `New name for tag ${c.label}`)
                    : item(`tag:${k}`, `#${esc(c.label)}`, c.n, {
                        cls: "is-tag",
                        extra: more("tag", k, c.label, [
                          { attr: 'data-tag-action="rename"', label: "Rename", icon: ICONS.textCursorInput, aria: `Rename tag ${c.label}` },
                          { attr: 'data-tag-action="delete"', label: "Delete", icon: ICONS.trash2, aria: `Delete tag ${c.label}`, danger: true },
                        ]),
                      }),
                )
                .join("") || `<li class="side-empty">No tags yet. Add them in the details.</li>`
            }
          </ul>`,
        )}
        ${section(
          "ctags",
          "Canvas tags",
          "",
          `<ul class="tag-cloud" data-testid="canvas-tag-list">
            ${
              [...canvasTags]
                .sort((a, b) => a[1].label.localeCompare(b[1].label))
                .map(([k, c]) =>
                  naming?.kind === "rename-ctag" && naming.key === k
                    ? nameInput(c.label, `New name for canvas tag ${c.label}`)
                    : item(`ctag:${k}`, `#${esc(c.label)}`, c.assets.size, {
                        cls: "is-tag is-canvas-tag",
                        extra: more("ctag", k, c.label, [
                          { attr: 'data-ctag-action="rename"', label: "Rename", icon: ICONS.textCursorInput, aria: `Rename canvas tag ${c.label}` },
                          { attr: 'data-ctag-action="delete"', label: "Delete", icon: ICONS.trash2, aria: `Delete canvas tag ${c.label}`, danger: true },
                        ]),
                      }).replace("<button ", `<button title="On ${plural(c.objects, "item")}. Canvases: ${esc([...c.canvases].slice(0, 6).map(crumbOf).join("; "))}${c.canvases.size > 6 ? ` and ${c.canvases.size - 6} more` : ""}. ${c.assets.size} from the library" `),
                )
                .join("") || `<li class="side-empty">No tags on canvases yet. Tag items on a canvas (Layers panel).</li>`
            }
          </ul>`,
        )}
      </div>`;
    // The menu floats over the page (the sidebar scrolls and would clip it), kept inside the window.
    const pop = side.querySelector<HTMLElement>(".side-menu");
    const anchor = side.querySelector<HTMLElement>('[data-side-more][aria-expanded="true"]');
    if (pop && anchor) {
      const r = anchor.getBoundingClientRect();
      const w = pop.offsetWidth;
      pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
      pop.style.top = `${Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + MENU_GAP)}px`;
    }
    const input = side.querySelector<HTMLInputElement>(".side-name");
    if (input) {
      input.focus();
      input.select();
    }
  };

  /** The details of several picked assets: what can be done to all of them at once. */
  const renderBulk = (): void => {
    const hashes = [...picked];
    const ents = hashes.map((h) => listing!.entries.find((x) => x.hash === h)).filter((x): x is CatalogListing["entries"][number] => !!x);
    const n = hashes.length;
    const allFav = ents.length > 0 && ents.every((e) => meta(e).favorite);
    const unused = ents.filter((e) => e.instances === 0).length;
    const placeable = ents.filter((e) => e.present).length;
    const dis = session.readOnly ? " disabled" : "";
    const bytes = ents.reduce((t, e) => t + e.size, 0);
    inspector.dataset["hash"] = "";
    inspector.innerHTML = `
      <div class="asset-insp-head">
        <h2>${n} selected</h2>${(() => {
          // picked items a search or filter now hides still count (and what is done here is done to them): say so, and offer to drop them
          const shown = new Set(filtered().map((x) => x.hash));
          const hidden = hashes.filter((h) => !shown.has(h)).length;
          return hidden ? `<button type="button" class="assets-btn" data-action="drop-hidden" data-testid="bulk-hidden" title="${hidden} of the picked items are not shown by the search or filter, and what is done here is done to them too. Keep only the ${n - hidden} shown.">${hidden} not shown · keep the shown</button>` : "";
        })()}
        <button type="button" class="assets-btn is-icon" data-action="clear" aria-label="Clear the selection" title="Clear the selection (Esc)">${ICONS.x}</button>
      </div>
      <div class="asset-quick">
        <button type="button" class="assets-btn is-icon" data-action="favorite-all" data-testid="bulk-favorite" aria-pressed="${allFav}" aria-label="${allFav ? "Remove all from favourites" : "Add all to favourites"}" title="${allFav ? "Remove all from favourites" : "Add all to favourites"}"${dis}>${ICONS.star}</button>
        <span class="split"><button type="button" class="assets-btn is-primary" data-action="place-all" data-testid="bulk-place"${placeable ? "" : " disabled"}${dis} title="Place them on the open canvas, in a grid">${ICONS.mapPin}<span>Place ${placeable} on canvas</span></button><button type="button" class="assets-btn is-primary is-icon" data-action="place-all-menu" data-testid="bulk-place-menu"${placeable ? "" : " disabled"}${dis} aria-haspopup="menu" aria-label="Place them on another canvas or a new one" title="Place them on another canvas or a new one">${ICONS.chevronDown}</button></span>
      </div>
      <div class="asset-facts"><span>${fmtBytes(bytes)} in all</span><span>${unused} of ${n} not used on any canvas</span></div>
      ${tagsAndFolderHtml(ents, true)}
      <div class="asset-actions">
        <button type="button" class="assets-btn" data-action="rename-all" data-testid="bulk-rename" title="Rename them together: enumerate, replace text, add text, change the extension (F2)"${dis}>${ICONS.textCursorInput}<span>Rename ${n}…</span></button>
        <button type="button" class="assets-btn" data-action="slideshow-all" data-testid="bulk-slideshow">${ICONS.presentation}<span>Slideshow of these</span></button>
        <button type="button" class="assets-btn" data-action="export-files-all" data-testid="bulk-export-files"${placeable ? "" : " disabled"}>${ICONS.fileArchive}<span>Export ${plural(placeable, "file")} as ZIP</span></button>
        <button type="button" class="assets-btn" data-action="export-all" data-testid="bulk-export"${placeable ? "" : " disabled"}>${ICONS.fileOutput}<span>Export ${placeable} as archive</span></button>
        <button type="button" class="assets-btn is-danger" data-action="delete-all" data-testid="bulk-delete"${unused ? "" : " disabled"}${dis}>${ICONS.trash2}<span>Delete ${unused} unused</span></button>
        ${unused < n ? `<p class="asset-note">${n - unused} in use ${n - unused === 1 ? "is" : "are"} kept: remove their instances from the canvases first, or delete them everywhere.</p>
          <button type="button" class="assets-btn is-danger" data-action="delete-everywhere" data-testid="bulk-delete-everywhere"${dis}>${ICONS.trash2}<span>Delete ${n} everywhere…</span></button>` : ""}
      </div>`;
  };

  const renderInspector = (): void => {
    if (picked.size > 1) {
      inspector.hidden = false;
      renderBulk();
      return;
    }
    const e = listing?.entries.find((x) => x.hash === selected);
    const m = listing?.missing.find((x) => x.hash === selected);
    if (!e && !m) {
      // the panel keeps its place with nothing picked (so the grid does not change width when a pick ends)
      inspector.hidden = narrow.matches;
      inspector.dataset["hash"] = "";
      inspector.innerHTML = `<p class="asset-note asset-insp-empty" data-testid="inspector-empty">Pick an item to see its details. Several picked: their tags and folder together.</p>`;
      return;
    }
    inspector.hidden = false;
    // Keep a half-typed tag (and its focus) when the inspector re-renders for the same asset.
    const typing = inspector.dataset["hash"] === selected ? inspector.querySelector<HTMLInputElement>(".tag-input") : null;
    const draft = typing?.value ?? "";
    const hadFocus = !!typing && document.activeElement === typing;
    inspector.dataset["hash"] = selected!;
    const instances = e?.instances ?? m!.instances;
    const where = session.current && session.tree ? crumbOf(session.current.canvasId) : "the open canvas";
    const placeRows = places
      .map(
        (p) => `<li><span class="asset-place-name">${esc(p.boardName)} › ${esc(p.canvasName)} <span class="asset-place-n">${p.ids.length}</span></span>
          <button type="button" class="assets-btn" data-action="show" data-canvas="${p.canvasId}" data-testid="asset-show"
            aria-label="Show ${plural(p.ids.length, "instance")} on ${esc(p.boardName)} › ${esc(p.canvasName)}">${ICONS.locate}<span>Show</span></button></li>`,
      )
      .join("");
    const ro = session.readOnly ? " disabled title=\"Read-only: another tab is editing\"" : "";
    const fav = e ? meta(e).favorite : false;
    inspector.innerHTML = `
      <div class="asset-insp-head">
        <h2 title="${esc(e ? e.name || "Untitled" : "Missing original")}">${esc(e ? e.name || "Untitled" : "Missing original")}</h2>
      </div>
      ${e ? `<button type="button" class="asset-preview" data-action="slide" data-testid="asset-preview" aria-label="Open slide view" title="Open in the viewer (double-click a card, or Enter)">${isCard(e) ? fileTile(e) : `<img alt="Preview of ${esc(e.name)}" draggable="false" data-hash="${e.hash}" class="${Math.max(e.pixelW, e.pixelH) < THUMB_PX ? "is-pixelated" : ""}">`}</button>` : ""}
      ${
        e
          ? `<div class="asset-quick">
               <button type="button" class="assets-btn is-icon" data-action="favorite" data-testid="asset-favorite" aria-pressed="${fav}" aria-label="${fav ? "Remove from favourites" : "Add to favourites"}" title="${fav ? "Remove from favourites" : "Add to favourites"}"${session.readOnly ? " disabled" : ""}>${ICONS.star}</button>
               ${e.present ? `<span class="split"><button type="button" class="assets-btn is-primary" data-action="place" data-testid="asset-place"${ro} title="Place on ${esc(where)}">${ICONS.mapPin}<span>Place on canvas</span></button><button type="button" class="assets-btn is-primary is-icon" data-action="place-menu" data-testid="asset-place-menu"${ro} aria-haspopup="menu" aria-label="Place on another canvas or a new one" title="Place on another canvas or a new one">${ICONS.chevronDown}</button></span>` : ""}
             </div>`
          : ""
      }
      <div class="asset-facts">
        ${e ? `<span class="ext-chip">${esc(chipOf(e.name, e.type))}</span>${!isCard(e) ? `<span>${e.pixelW} × ${e.pixelH} px</span>` : ""}<span>${fmtBytes(e.size)}</span>` : ""}
        <span data-testid="asset-usage">${usesText(instances, e?.canvases ?? m!.canvases)}</span>
      </div>
      ${e && isCard(e) ? (() => { const d = describeFile(e.name, e.type); return `<section class="asset-sec asset-file" data-testid="asset-file-info"><h3>No preview for this file</h3><p class="asset-note">${esc(d.category)} (${esc(d.chip)}). It is kept exactly as it is and shown as a card. ${esc(d.todo)}</p></section>`; })() : ""}
      ${e && !e.present ? `<p class="asset-warn">The original file is missing from storage. Import the same file again to restore it everywhere.</p>` : ""}
      ${m ? `<p class="asset-warn" data-testid="asset-missing-help">Instances use an original that is not stored. Import the same file again to restore all ${instances} of them.</p>` : ""}
      ${e ? organizeHtml(e) : ""}
      ${places.length ? `<section class="asset-sec"><h3>Where it is used</h3><ul class="asset-places" data-testid="asset-places">${placeRows}</ul></section>` : ""}
      <div class="asset-actions">
        ${e ? `<button type="button" class="assets-btn" data-action="rename" data-testid="asset-rename" title="Rename it, or change its extension (F2)"${ro}>${ICONS.textCursorInput}<span>Rename</span></button>` : ""}
        ${e?.present ? `<button type="button" class="assets-btn" data-action="download" data-testid="asset-download" title="Save a copy of the original file">${ICONS.download}<span>Download</span></button>` : ""}
        ${e?.present && fileActionsOf(e.name, e.type).canOpen ? `<button type="button" class="assets-btn" data-action="open-tab" data-testid="asset-open-tab" title="Show it in a new browser tab">${ICONS.externalLink}<span>Open in tab</span></button>` : ""}
        ${e?.present ? `<button type="button" class="assets-btn" data-action="export" data-testid="asset-export">${ICONS.fileOutput}<span>Export</span></button>` : ""}
        ${e ? `<button type="button" class="assets-btn is-danger" data-action="delete" data-testid="asset-delete"${instances > 0 ? " disabled" : ro}>${ICONS.trash2}<span>Delete from library</span></button>
               ${instances > 0 ? `<p class="asset-note" data-testid="asset-delete-note">In use, so it cannot be deleted on its own. Remove its ${plural(instances, "instance")} from ${instances === 1 ? "its canvas" : "their canvases"} first, or delete it everywhere.</p>
               <button type="button" class="assets-btn is-danger" data-action="delete-everywhere" data-testid="asset-delete-everywhere"${ro}>${ICONS.trash2}<span>Delete everywhere…</span></button>` : ""}` : ""}
      </div>
      <details class="asset-more" data-testid="asset-metadata" data-metadata${detailsOpen ? " open" : ""}><summary>Details</summary>
        <div data-metadata-body></div>
        <dl>
          ${e ? `<dt>Imported</dt><dd>${new Date(e.importedAt).toLocaleDateString()}</dd>` : ""}
          <dt>Hash</dt><dd class="asset-hash" title="${selected}">${selected!.slice(0, 12)}…</dd>
        </dl>
      </details>`;
    if (e?.present && !isCard(e)) void fillMetadata(e.hash, e.type);
    const prev = inspector.querySelector<HTMLImageElement>(".asset-preview img");
    if (prev) loadThumb(prev);
    const tagInput = inspector.querySelector<HTMLInputElement>(".tag-input");
    if (tagInput && draft) tagInput.value = draft;
    if (tagInput && hadFocus) tagInput.focus();
    // The viewer's favourite button follows the stored state.
    if (e && slideHash === e.hash) viewer.querySelector<HTMLElement>('[data-act="favorite"]')!.setAttribute("aria-pressed", String(fav));
  };

  /** What the file says about itself, put in the details panel when it has read it (ADR 0138). */
  const fillMetadata = async (hash: string, type: string): Promise<void> => {
    const rec = await assets.record(hash).catch(() => undefined);
    if (!rec) return;
    const video = /^(video|audio)\//.test(type);
    if (video && rec.blob.size > 100 * 2 ** 20) return;
    const bytes = new Uint8Array(await (video ? rec.blob : rec.blob.slice(0, 2 * 2 ** 20)).arrayBuffer());
    const { rows } = await readMetadata(bytes, type);
    const box = inspector.querySelector<HTMLElement>("[data-metadata]");
    if (!box || inspector.dataset["hash"] !== hash || !rows.length) return;
    const groups = new Map<string, MetaRow[]>();
    for (const r of rows) (groups.get(r.group) ?? groups.set(r.group, []).get(r.group)!).push(r);
    box.querySelector("[data-metadata-body]")!.innerHTML = [...groups].map(([g, rs]) => `<h4>${esc(g)}</h4><dl>${rs.map((r) => `<dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd>`).join("")}</dl>`).join("");
  };

  /**
   * The tags and the folder of one asset or of several picked ones, the same for both: each tag on any of them, with (for several) how
   * many have it, × to take it off all of them and + to put it on the rest; a field that suggests the library's tags; each folder with how
   * many are in it (a mixed pick has none ticked) and New folder…, which makes one and moves them into it.
   */
  const tagsAndFolderHtml = (ents: ReadonlyArray<CatalogListing["entries"][number]>, bulk: boolean): string => {
    const n = ents.length;
    const dis = session.readOnly ? " disabled" : "";
    const on = new Map<string, { label: string; k: number }>();
    for (const e of ents) for (const t of meta(e).tags) {
      const c = on.get(t.toLowerCase());
      if (c) c.k++;
      else on.set(t.toLowerCase(), { label: t, k: 1 });
    }
    const chips = [...on.values()].sort((a, b) => b.k - a.k || a.label.localeCompare(b.label)).map(({ label: t, k }) => {
      const some = bulk && k < n;
      return `<span class="tag-chip${some ? " is-partial" : ""}">#${esc(t)}${
        some ? `<span class="tag-count" title="On ${k} of ${n}">${k}/${n}</span><button type="button" data-action="tag-all" data-tag="${esc(t)}" aria-label="Add tag ${esc(t)} to all ${n}" title="Add to all ${n}"${dis}>+</button>` : ""
      }<button type="button" data-action="untag" data-tag="${esc(t)}" aria-label="Remove tag ${esc(t)}${bulk ? ` from all ${n}` : ""}" title="Remove${bulk ? ` from all ${n}` : ""}"${dis}>×</button></span>`;
    });
    const known = [...new Set(listing!.entries.flatMap((e) => meta(e).tags))].filter((t) => !on.has(t.toLowerCase())).sort((a, b) => a.localeCompare(b));
    const folders = listing!.folders;
    const sorted = [...folders].sort((a, b) => folderPath(folders, a.id).join("/").localeCompare(folderPath(folders, b.id).join("/")));
    const radio = (id: string, label: string, k: number): string =>
      `<li><label><input type="radio" name="${bulk ? "bulk-folder" : "asset-folder"}" ${bulk ? "data-bulk-folder" : "data-folder"}="${id}"${k === n ? " checked" : ""}${dis}>${label}${bulk && k > 0 && k < n ? `<span class="folder-count">${k} of ${n}</span>` : ""}</label></li>`;
    return `
      <section class="asset-sec">
        <h3>${bulk ? "Tags of these" : "Tags"}</h3>
        <div class="tag-chips" data-testid="${bulk ? "bulk-tags" : "asset-tags"}">
          ${chips.join("")}
          <input class="tag-input${bulk ? " bulk-tag-input" : ""}" data-testid="${bulk ? "bulk-tag-input" : "asset-tag-input"}" list="tag-suggest" placeholder="${bulk ? `Add a tag to all ${n}` : "Add a tag"}" aria-label="${bulk ? "Add a tag to all selected" : "Add a tag"}" title="Type a tag (or several, with commas) and press Enter" maxlength="64"${dis}>
          <datalist id="tag-suggest">${known.map((t) => `<option value="${esc(t)}"></option>`).join("")}</datalist>
        </div>
        <h3 class="asset-sub">${bulk ? "Folder of these" : "Folder"}</h3>
        ${sorted.length ? `<ul class="asset-folders" data-testid="${bulk ? "bulk-folders" : "asset-folders"}">${[radio("", "No folder", ents.filter((e) => meta(e).folderIds.length === 0).length), ...sorted.map((f: AssetFolder) => radio(f.id, esc(folderPath(folders, f.id).join(" › ")), ents.filter((e) => meta(e).folderIds[0] === f.id).length))].join("")}</ul>` : ""}
        <button type="button" class="assets-btn" data-action="new-folder-into" data-testid="${bulk ? "bulk-new-folder" : "asset-new-folder"}"${dis}>${ICONS.folderPlus}<span>New folder${bulk ? ` for these ${n}` : ""}…</span></button>
      </section>`;
  };

  /** Tags and folders of an entry (inspector). */
  const organizeHtml = (e: CatalogListing["entries"][number]): string => {
    const m = meta(e);
    const dis = session.readOnly ? " disabled" : "";
    return `
      ${tagsAndFolderHtml([e], false)}
      ${(() => {
        // Tags put on this picture's instances on canvases (in-canvas tags) that the asset itself does not have yet.
        const extra = assetCanvasTags.filter((t) => !m.tags.some((x) => x.toLowerCase() === t.tag.toLowerCase()));
        return extra.length
          ? `<section class="asset-sec"><h3>Tags used on canvases</h3>
              <p class="asset-note">Added to this picture on a canvas, not in the library. Each says which canvas it is on; choose one to add it to the library tags.</p>
              <ul class="asset-ctags" data-testid="asset-canvas-tags">${extra.map((t) => `<li><button type="button" class="tag-chip is-suggest" data-action="adopt-tag" data-tag="${esc(t.tag)}" aria-label="Add the tag ${esc(t.tag)} to this asset"${dis}>+ #${esc(t.tag)}</button><span class="tag-where" title="${esc(t.canvases.map(crumbOf).join("; "))}">on ${esc(t.canvases.slice(0, 2).map(crumbOf).join(", "))}${t.canvases.length > 2 ? ` and ${t.canvases.length - 2} more` : ""}</span></li>`).join("")}</ul>
            </section>`
          : "";
      })()}`;
  };

  const crumbOf = (canvasId: string): string => {
    for (const b of session.tree?.boards ?? []) {
      const c = b.canvases.find((x) => x.id === canvasId);
      if (c) return `${b.board.name} › ${c.name}`;
    }
    return "the open canvas";
  };

  /** Show which cards are picked without redrawing the library. */
  const markPicked = (): void => {
    for (const c of grid.querySelectorAll<HTMLElement>(".asset-card")) c.setAttribute("aria-pressed", String(picked.has(c.dataset["hash"]!)));
    for (const c of grid.querySelectorAll<HTMLInputElement>(".asset-check")) c.checked = picked.has(c.dataset["hash"]!);
    // Every card shows its checkbox only once several are being picked; one plain click just opens that item's details.
    grid.classList.toggle("has-picks", picked.size > 1 || (selecting && picked.size > 0));
  };
  /** Pick: one (a plain click), add or remove one (Ctrl, Cmd or the checkbox), or a range from the last pick (Shift). */
  const select = async (hash: string | null, how: "one" | "toggle" | "range" | "add-range" = "one"): Promise<void> => {
    // Picking never opens the details panel on a wide window (that would narrow the grid and move the picture away from under the pointer):
    // the panel is opened and closed with its button or I, and once open it shows what is picked. On a narrow one it is a sheet below.
    if (hash !== null && !ui.details && viewer.hidden && narrow.matches) {
      ui.details = true;
      autoShown = true;
      saveUi();
      applyUi();
    }
    if (hash === null) {
      picked.clear();
      selected = null;
      anchor = null;
    } else if (how === "toggle") {
      if (picked.has(hash)) {
        picked.delete(hash);
        selected = [...picked].pop() ?? null;
      } else {
        picked.add(hash);
        selected = hash;
      }
      anchor = hash;
    } else if (how === "range" || how === "add-range") {
      const order = [...filtered().map((e) => e.hash), ...(listing?.missing.map((m) => m.hash) ?? [])];
      const a = order.indexOf(anchor ?? selected ?? hash);
      const b = order.indexOf(hash);
      if (how === "range") picked.clear();
      for (const h of order.slice(Math.min(a < 0 ? b : a, b), Math.max(a < 0 ? b : a, b) + 1)) picked.add(h);
      selected = hash;
    } else {
      picked.clear();
      picked.add(hash);
      selected = hash;
      anchor = hash;
    }
    selecting = picked.size > 0 && (how !== "one" || selecting);
    if (how === "one" && picked.size <= 1) selecting = false;
    places = selected && picked.size === 1 ? await session.assetPlaces(selected) : [];
    assetCanvasTags = selected && picked.size === 1 ? await session.canvasTagsOfAsset(selected).catch(() => []) : [];
    markPicked();
    renderInspector();
  };
  const selectAll = (): void => {
    for (const e of filtered()) picked.add(e.hash);
    selected = filtered()[filtered().length - 1]?.hash ?? selected;
    selecting = true;
    places = [];
    assetCanvasTags = [];
    markPicked();
    renderInspector();
  };

  // ---- events
  grid.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    // The checkbox adds or removes one asset: the way to pick several without a keyboard.
    const box = t.closest<HTMLInputElement>(".asset-check");
    if (box) return void select(box.dataset["hash"]!, "toggle");
    const card = t.closest<HTMLElement>(".asset-card");
    if (!card) return;
    const hash = card.dataset["hash"]!;
    if (e.shiftKey) void select(hash, e.ctrlKey || e.metaKey ? "add-range" : "range");
    // (picking several: a tap adds or removes, as on a phone; a plain click with a mouse picks that one alone, Ctrl or the checkbox add or remove)
    else if (e.ctrlKey || e.metaKey || (selecting && (e as PointerEvent).pointerType === "touch")) void select(hash, "toggle");
    else {
      // A click picks it and shows its details; the viewer opens from a double-click or from the picture in the details.
      if (ui.details && e.detail <= 1) autoShown = false;
      void select(hash);
    }
  });
  const openFromCard = (card: HTMLElement): void => {
    // The first click of this double-click showed the hidden details; opening the viewer puts them back as they were.
    if (autoShown) {
      autoShown = false;
      ui.details = false;
      saveUi();
      applyUi();
    }
    // Any file: a missing original shows its thumbnail, a kind without a preview a plain file picture.
    slideSet = null;
    void showSlide(card.dataset["hash"]!);
  };
  grid.addEventListener("dblclick", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".asset-card");
    if (!card || e.shiftKey || e.ctrlKey || e.metaKey) return;
    openFromCard(card);
  });
  // A phone sends no double-click for a double tap (and the first tap moves the page under the finger, with the details sheet): two taps on one card in a short time open the viewer.
  let lastTap: { hash: string; at: number } | null = null;
  grid.addEventListener("pointerup", (e) => {
    if (e.pointerType !== "touch") return;
    const card = (e.target as HTMLElement).closest<HTMLElement>(".asset-card");
    if (!card || (e.target as HTMLElement).closest(".asset-check")) return;
    const hash = card.dataset["hash"]!;
    if (lastTap && lastTap.hash === hash && e.timeStamp - lastTap.at < 450) {
      lastTap = null;
      openFromCard(card);
    } else lastTap = { hash, at: e.timeStamp };
  });
  /** Move the keyboard (and the pick) through the cards: left and right, up and down (rows in the list), Home and End. */
  /** Where the arrow keys last went: the pick itself lands a moment later, and a quick second key must start from here. */
  let cursor: string | null = null;
  const moveBy = (e: KeyboardEvent): boolean => {
    const cells = [...grid.querySelectorAll<HTMLElement>(".asset-cell")];
    if (!cells.length) return false;
    const active = document.activeElement as HTMLElement | null;
    const focusedCell = active && grid.contains(active) ? active.closest<HTMLElement>(".asset-cell") : null;
    const selectedCell = selected ? (grid.querySelector<HTMLElement>(`.asset-card[data-hash="${selected}"]`)?.closest<HTMLElement>(".asset-cell") ?? null) : null;
    const cursorCell = cursor ? (grid.querySelector<HTMLElement>(`.asset-card[data-hash="${cursor}"]`)?.closest<HTMLElement>(".asset-cell") ?? null) : null;
    const cur = focusedCell ?? cursorCell ?? selectedCell;
    const list = ui.layout === "list";
    let next: HTMLElement | undefined;
    if (!cur) next = e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "End" ? cells[cells.length - 1] : cells[0];
    else {
      const i = cells.indexOf(cur);
      if (e.key === "Home") next = cells[0];
      else if (e.key === "End") next = cells[cells.length - 1];
      else if (e.key === "ArrowLeft" || (list && e.key === "ArrowUp")) next = cells[Math.max(0, i - 1)];
      else if (e.key === "ArrowRight" || (list && e.key === "ArrowDown")) next = cells[Math.min(cells.length - 1, i + 1)];
      else {
        // Up and down in a justified gallery: the nearest card in the row above or below, by horizontal position.
        const r = cur.getBoundingClientRect();
        const cx = (r.left + r.right) / 2;
        const down = e.key === "ArrowDown";
        let best: { cell: HTMLElement; dy: number; dx: number } | null = null;
        for (const c of cells) {
          const b = c.getBoundingClientRect();
          const dy = down ? b.top - r.bottom + 1 : r.top - b.bottom + 1;
          if (dy < 0) continue;
          const dx = Math.abs((b.left + b.right) / 2 - cx);
          if (!best || dy < best.dy - 4 || (Math.abs(dy - best.dy) <= 4 && dx < best.dx)) best = { cell: c, dy, dx };
        }
        next = best?.cell ?? cur;
      }
    }
    if (!next) return false;
    const card = next.querySelector<HTMLElement>(".asset-card")!;
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: "nearest" });
    const hash = card.dataset["hash"]!;
    cursor = hash;
    if (e.shiftKey) void select(hash, "range");
    else if (!e.ctrlKey && !e.metaKey && !selecting) void select(hash);
    return true;
  };

  inspector.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b || b.disabled || !selected) return;
    const hash = selected;
    const group = [...picked];
    const action = b.dataset["action"];
    /** What the panel is about: every picked asset, or the one shown. */
    const pickedGroup = (): string[] => (picked.size > 1 ? group : [hash]);
    switch (action) {
      case "clear":
        void select(null);
        break;
      case "place-all-menu":
        openPlaceMenu(b, group.filter((h) => listing?.entries.some((x) => x.hash === h && x.present)));
        break;
      case "place-all": {
        const ok = group.filter((h) => listing?.entries.some((x) => x.hash === h && x.present));
        void askPlaceTags(ok).then((withTags) => {
          if (withTags === null) return;
          showCanvas();
          void session.placeAssets(ok, withTags);
        });
        break;
      }
      case "favorite-all": {
        const on = b.getAttribute("aria-pressed") !== "true";
        void session.organize((c) => c.updateMetaEach(group.map((hash) => ({ hash, change: { favorite: on } }))), on ? "Favourites" : "Not favourites");
        break;
      }
      case "export-files-all":
        void runExportFiles(session, { kind: "assets", hashes: group.filter((h) => listing?.entries.some((x) => x.hash === h && x.present)) });
        break;
      case "export-all":
        void runExport(session, { kind: "assets", hashes: group.filter((h) => listing?.entries.some((x) => x.hash === h && x.present)) });
        break;
      case "slideshow-all": {
        const order = filtered().filter((e) => picked.has(e.hash));
        if (order[0]) startShow(order[0].hash, new Set(order.map((e) => e.hash)));
        break;
      }
      case "delete-all": {
        const gone = group.filter((h) => listing?.entries.some((x) => x.hash === h && x.instances === 0));
        void confirmDialog({
          title: `Delete ${gone.length} item${gone.length === 1 ? "" : "s"} from the library?`,
          lines: ["Their originals are erased from this browser's storage once nothing can use them any more. Items in use are kept."],
          confirmLabel: `Delete ${gone.length}`,
        }).then(async (ok) => {
          if (ok) await session.deleteAssets(gone);
          await refresh();
          search.focus();
        });
        break;
      }
      case "slide":
        void showSlide(hash);
        break;
      case "show": {
        const p = places.find((x) => x.canvasId === b.dataset["canvas"]);
        if (p) {
          showCanvas();
          void session.reveal(p.canvasId, p.ids);
        }
        break;
      }
      case "place":
        void askPlaceTags([hash]).then((withTags) => {
          if (withTags === null) return;
          showCanvas();
          void session.placeAsset(hash, withTags);
        });
        break;
      case "place-menu":
        openPlaceMenu(b, [hash]);
        break;
      case "favorite": {
        // The button shows the stored state it would change; set the opposite explicitly.
        const on = b.getAttribute("aria-pressed") !== "true";
        void session.organize((c) => c.updateMeta(hash, { favorite: on }));
        break;
      }
      case "adopt-tag": {
        const tag = b.dataset["tag"]!;
        void session.organize((c) => c.updateMeta(hash, { addTags: [tag] }));
        break;
      }
      case "untag":
      case "tag-all": {
        // one asset, or every picked one (the panel is about all of them), in one write
        const tag = b.dataset["tag"]!;
        const change = action === "untag" ? { removeTags: [tag] } : { addTags: [tag] };
        void session.organize((c) => c.updateMetaEach(pickedGroup().map((h) => ({ hash: h, change }))), `${action === "untag" ? "Removed" : "Added"} #${tag}`);
        break;
      }
      case "drop-hidden": {
        const shown = new Set(filtered().map((x) => x.hash));
        for (const h of [...picked]) if (!shown.has(h)) picked.delete(h);
        if (selected && !picked.has(selected)) selected = [...picked].pop() ?? null;
        markPicked();
        renderInspector();
        break;
      }
      case "new-folder-into": {
        const group = pickedGroup();
        void promptDialog({ title: group.length > 1 ? `New folder for ${group.length} items` : "New folder", lines: ["They are moved into it."], value: "", confirmLabel: "Make and move" }).then((name) => {
          if (!name?.trim()) return;
          const id = newObjectId();
          void session.organize(async (c) => {
            await c.createFolder(name.trim(), null, id);
            await c.updateMetaEach(group.map((h) => ({ hash: h, change: { addFolders: [id] } })));
          });
        });
        break;
      }
      case "download":
        void downloadOriginal(assets, hash);
        break;
      case "rename":
        void renameAssetsDialog([hash]);
        break;
      case "rename-all":
        void renameAssetsDialog(filtered().filter((x) => picked.has(x.hash)).map((x) => x.hash));
        break;
      case "open-tab":
        void openOriginalInTab(assets, hash);
        break;
      case "export":
        void runExport(session, { kind: "assets", hashes: [hash] });
        break;
      case "delete-everywhere": {
        // in use: their instances go too, everywhere, after a confirmation that says what and where
        const hashes = pickedGroup();
        const ents = hashes.map((h) => listing?.entries.find((x) => x.hash === h)).filter((x): x is CatalogListing["entries"][number] => !!x);
        const uses = ents.reduce((t, x) => t + x.instances, 0);
        const canvases = new Set(hashes.length === 1 ? places.map((pl) => pl.canvasId) : []).size || ents.reduce((t, x) => Math.max(t, x.canvases), 0);
        const where = hashes.length === 1 && places.length ? places.map((pl) => `${pl.boardName} › ${pl.canvasName}`).join(", ") : null;
        const name = hashes.length === 1 ? `“${ents[0]?.name || "Untitled"}”` : `${hashes.length} items`;
        void confirmDialog({
          title: `Delete ${name} everywhere?`,
          lines: [
            `${hashes.length === 1 ? "It is" : "They are"} used ${plural(uses, "time")}${where ? ` on ${where}` : canvases ? ` on ${plural(canvases, "canvas", "canvases")} or more` : ""}. Those instances are removed too; a text that uses one as its font keeps its words in the default font.`,
            "On the open canvas Undo brings them back; on the other canvases they cannot be brought back. The originals are erased from this browser's storage once nothing can use them any more.",
          ],
          confirmLabel: "Delete everywhere",
        }).then(async (ok) => {
          if (ok) await session.deleteAssetsEverywhere(hashes);
          await refresh();
          search.focus();
        });
        break;
      }
      case "delete": {
        const e = listing?.entries.find((x) => x.hash === hash);
        void confirmDialog({
          title: `Delete “${e?.name || "Untitled"}” from the library?`,
          lines: [`Its original (${fmtBytes(e?.size ?? 0)}) is erased from this browser's storage once nothing can use it any more.`],
          confirmLabel: "Delete item",
        }).then(async (ok) => {
          if (ok) await session.deleteAsset(hash);
          await refresh();
          search.focus();
        });
        break;
      }
    }
  });
  /** Counts presses and clicks anywhere: a field that would take the focus back after a write first checks that none came in between. */
  let inputs = 0;
  for (const type of ["pointerdown", "keydown"] as const) window.addEventListener(type, () => void inputs++, { capture: true });
  inspector.addEventListener("keydown", (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains("tag-input") || e.key !== "Enter" || !selected) return;
    e.preventDefault();
    const add = input.value.split(",");
    input.value = ""; // consumed; the re-render must not restore it
    if (!add.join("").trim()) return;
    const note = tagFormatNote(add);
    if (note) {
      session.editor.message = note;
      session.editor.changed();
    }
    const seq = ++inputs;
    // One asset, or every picked one.
    const group = input.classList.contains("bulk-tag-input") ? [...picked] : [selected];
    void session
      .organize((c) => c.updateMetaEach(group.map((hash) => ({ hash, change: { addTags: add } }))), `Added ${add.map((t) => `#${t.trim()}`).join(", ")}`)
      .then(() => {
        // back to the field for the next tag, unless something else was clicked or pressed meanwhile (the focus is not taken from it)
        if (inputs === seq) inspector.querySelector<HTMLInputElement>(".tag-input")?.focus();
      });
  });
  inspector.addEventListener("change", (e) => {
    const box = e.target as HTMLInputElement;
    const bulk = box.dataset["bulkFolder"];
    const into = (id: string) => (id ? { addFolders: [id] } : { clearFolder: true });
    if (bulk !== undefined) {
      const group = [...picked];
      void session.organize((c) => c.updateMetaEach(group.map((hash) => ({ hash, change: into(bulk) }))), "Moved to a folder");
      return;
    }
    const id = box.dataset["folder"];
    if (id === undefined || !selected) return;
    const hash = selected;
    void session.organize((c) => c.updateMeta(hash, into(id)), "Moved to a folder");
  });

  // A thumbnail with see-through pixels gets a chequered ground (cards, filmstrip and the details picture) so it reads as transparent.
  const alphaOf = new Map<string, boolean>();
  root.addEventListener(
    "load",
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || img === slideImg) return;
      const host = img.closest<HTMLElement>(".asset-card, .film-item, .asset-preview");
      if (!host) return;
      const key = img.dataset["hash"] ?? img.src;
      let a = alphaOf.get(key);
      if (a === undefined) {
        a = hasAlpha(img);
        if (alphaOf.size > 4000) alphaOf.clear();
        alphaOf.set(key, a);
      }
      host.classList.toggle("has-alpha", a);
    },
    true,
  );

  /**
   * Before placing pictures that have library tags: ask whether the placed items should carry those tags as in-canvas tags
   * (ADR 0062). Returns true (with tags), false (without), or null when cancelled; false at once when none has tags.
   */
  const askPlaceTags = async (hashes: readonly string[]): Promise<boolean | null> => {
    const tagged = hashes.map((h) => listing?.entries.find((x) => x.hash === h)).filter((e): e is CatalogListing["entries"][number] => !!e && meta(e).tags.length > 0);
    if (!tagged.length) return false;
    const names = [...new Set(tagged.flatMap((e) => meta(e).tags))].slice(0, 6).map((t) => `#${t}`).join(" ");
    const answer = await chooseDialog({
      title: "Put their tags on the canvas too?",
      lines: [`${tagged.length === 1 ? "This picture has" : `${tagged.length} of these pictures have`} library tags (${names}). In-canvas tags label the placed items on the canvas and are separate from the library's tags.`],
      choices: [
        { value: "with", label: "Place with their tags", help: "Each placed item gets its picture's tags as in-canvas tags." },
        { value: "without", label: "Place without tags", help: "The items are placed untagged." },
      ],
      confirmLabel: "Place",
    });
    return answer === null ? null : answer === "with";
  };

  // ---- the details panel's height on small screens: drag the grip (or use the arrow keys); double-click goes back to the default
  const grip = root.querySelector<HTMLElement>(".sheet-grip")!;
  const sheetRange = (): { min: number; max: number } => ({ min: 120, max: Math.round(window.innerHeight * 0.88) });
  const setSheet = (h: number | null, save: boolean): void => {
    const { min, max } = sheetRange();
    ui.sheetH = h === null ? null : Math.max(min, Math.min(max, Math.round(h)));
    if (ui.sheetH) body.style.setProperty("--sheet-h", `${ui.sheetH}px`);
    else body.style.removeProperty("--sheet-h");
    grip.setAttribute("aria-valuenow", String(ui.sheetH ?? inspector.offsetHeight));
    if (save) saveUi();
  };
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = inspector.offsetHeight;
    grip.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent): void => setSheet(startH + (startY - ev.clientY), false);
    const up = (): void => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      saveUi();
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  });
  grip.addEventListener("dblclick", () => setSheet(null, true));
  // On a phone the sheet sits on the bottom edge and the grip on its top: keep the grip where the sheet really is, whatever its content.
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => body.style.setProperty("--sheet-now", `${inspector.offsetHeight}px`)).observe(inspector);
  grip.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    setSheet(inspector.offsetHeight + (e.key === "ArrowUp" ? 48 : -48), true);
    e.preventDefault();
    e.stopPropagation();
  });

  // ---- the library and details panels' widths on a wide screen: drag the edge (or use the arrow keys); double-click goes back to the default
  for (const g of root.querySelectorAll<HTMLElement>(".col-grip")) {
    const isSide = g.dataset["grip"] === "side";
    const range = isSide ? SIDE_W : INSP_W;
    const panel = isSide ? side : inspector;
    const set = (w: number | null, save: boolean): void => {
      const v = w === null ? null : Math.max(range.min, Math.min(range.max, Math.round(w)));
      if (isSide) ui.sideW = v;
      else ui.inspW = v;
      applyUi();
      g.setAttribute("aria-valuenow", String(v ?? panel.offsetWidth));
      if (save) saveUi();
    };
    g.setAttribute("aria-valuemin", String(range.min));
    g.setAttribute("aria-valuemax", String(range.max));
    g.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = panel.offsetWidth;
      g.setPointerCapture(e.pointerId);
      g.classList.add("is-dragging");
      const move = (ev: PointerEvent): void => set(startW + (isSide ? ev.clientX - startX : startX - ev.clientX), false);
      const up = (): void => {
        g.classList.remove("is-dragging");
        g.removeEventListener("pointermove", move);
        g.removeEventListener("pointerup", up);
        g.removeEventListener("pointercancel", up);
        saveUi();
      };
      g.addEventListener("pointermove", move);
      g.addEventListener("pointerup", up);
      g.addEventListener("pointercancel", up);
    });
    g.addEventListener("dblclick", () => set(null, true));
    g.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      set(panel.offsetWidth + (e.key === "ArrowRight" ? 1 : -1) * (isSide ? 1 : -1) * 16, true);
      e.preventDefault();
      e.stopPropagation();
    });
  }

  // ---- "Place on…": an existing canvas, a new canvas in a board, or a new board
  const placeMenu = root.querySelector<HTMLElement>(".place-menu")!;
  let placing: string[] = [];
  const closePlaceMenu = (): void => {
    placeMenu.hidden = true;
    placing = [];
  };
  const openPlaceMenu = (anchor: HTMLElement, hashes: string[]): void => {
    const tree = session.tree;
    if (!tree || !hashes.length) return;
    placing = hashes;
    const cur = session.current;
    const n = hashes.length;
    placeMenu.innerHTML =
      `<p class="pm-title">Place ${n === 1 ? "it" : `these ${n}`} on</p>` +
      tree.boards
        .map(
          ({ board, canvases }) => `<section class="pm-board" aria-label="Board ${esc(board.name)}">
            <h3>${ICONS.squareStack}<span>${esc(board.name)}</span></h3>
            ${canvases
              .map((c) => `<button type="button" role="menuitem" data-pm="canvas" data-id="${c.id}"><span class="pm-mark">${cur?.canvasId === c.id ? ICONS.check : ""}</span><span class="pm-name">${esc(c.name)}</span><small>${cur?.canvasId === c.id ? "active" : c.objectCount ? plural(c.objectCount, "object") : "empty"}</small></button>`)
              .join("")}
            <button type="button" role="menuitem" class="pm-new" data-pm="new-canvas" data-id="${board.id}">${ICONS.plus}<span>New canvas in ${esc(board.name)}</span></button>
          </section>`,
        )
        .join("") +
      `<button type="button" role="menuitem" class="pm-new pm-new-board" data-pm="new-board">${ICONS.plus}<span>New board with a canvas</span></button>`;
    placeMenu.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = placeMenu.offsetWidth;
    const h = placeMenu.offsetHeight;
    placeMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
    placeMenu.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, r.bottom + MENU_GAP))}px`;
    placeMenu.querySelector<HTMLElement>("button")?.focus();
  };
  placeMenu.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pm]");
    if (!b) return;
    const hashes = placing;
    closePlaceMenu();
    const kind = b.dataset["pm"];
    const target = kind === "canvas" ? { canvasId: b.dataset["id"]! } : kind === "new-canvas" ? { newCanvasIn: b.dataset["id"]! } : ({ newBoard: true } as const);
    void askPlaceTags(hashes).then((withTags) => {
      if (withTags === null) return;
      showCanvas();
      void session.placeAssetsOn(hashes, target, withTags);
    });
  });
  document.addEventListener("pointerdown", (e) => {
    if (!placeMenu.hidden && !(e.target as HTMLElement).closest?.(".place-menu, [data-action$='-menu']")) closePlaceMenu();
  });
  placeMenu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closePlaceMenu();
      e.stopPropagation();
    }
  });

  // ---- sidebar: scope, folders
  // ---- dragging items onto the sidebar: a folder moves them into it, Unfiled out of theirs, a tag adds it, Favourites marks them
  const DRAG_TYPE = "application/x-canvast-assets";
  grid.addEventListener("dragstart", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".asset-card");
    if (!card || !e.dataTransfer) return;
    const hash = card.dataset["hash"]!;
    const hashes = picked.has(hash) ? [...picked] : [hash]; // (a picked one carries the whole pick)
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(hashes));
    e.dataTransfer.setData("text/plain", hashes.length > 1 ? `${hashes.length} items` : (listing?.entries.find((x) => x.hash === hash)?.name ?? ""));
    e.dataTransfer.effectAllowed = "copyMove";
  });
  const dropTarget = (e: DragEvent): HTMLElement | null => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-scope]");
    const k = t?.dataset["scope"] ?? "";
    return t && e.dataTransfer?.types.includes(DRAG_TYPE) && !session.readOnly && (k.startsWith("folder:") || k.startsWith("tag:") || k === "unfiled" || k === "favorites") ? t : null;
  };
  let over: HTMLElement | null = null;
  const lightDrop = (t: HTMLElement | null): void => {
    if (over === t) return;
    over?.classList.remove("is-drop-target");
    over = t;
    over?.classList.add("is-drop-target");
  };
  side.addEventListener("dragover", (e) => {
    const t = dropTarget(e);
    lightDrop(t);
    if (!t) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = t.dataset["scope"]!.startsWith("folder:") || t.dataset["scope"] === "unfiled" ? "move" : "copy";
  });
  side.addEventListener("dragleave", (e) => {
    if (!side.contains(e.relatedTarget as Node | null)) lightDrop(null);
  });
  side.addEventListener("drop", (e) => {
    const t = dropTarget(e);
    lightDrop(null);
    if (!t) return;
    e.preventDefault();
    const hashes = (JSON.parse(e.dataTransfer!.getData(DRAG_TYPE) || "[]") as string[]).filter((h) => listing?.entries.some((x) => x.hash === h));
    if (!hashes.length) return;
    const k = t.dataset["scope"]!;
    const label = t.querySelector(".side-label")?.textContent?.replace(/^#/, "") ?? "";
    const change = k.startsWith("folder:") ? { addFolders: [k.slice(7)] } : k === "unfiled" ? { clearFolder: true } : k === "favorites" ? { favorite: true } : { addTags: [label] };
    const what = k.startsWith("folder:") ? `Moved to ${label}` : k === "unfiled" ? "Taken out of their folders" : k === "favorites" ? "Added to the favourites" : `Tagged #${label}`;
    void session.organize((c) => c.updateMetaEach(hashes.map((hash) => ({ hash, change }))), `${what}: ${plural(hashes.length, "item")}`).then((ok) => {
      if (!ok) return;
      session.editor.message = `${what}: ${plural(hashes.length, "item")}.`;
      session.editor.changed();
    });
  });

  side.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.hasAttribute("data-side-toggle")) {
      sideOpen = !sideOpen;
      renderSide();
      return;
    }
    if (b.dataset["secToggle"]) {
      const id = b.dataset["secToggle"];
      ui.closed = ui.closed.includes(id) ? ui.closed.filter((x) => x !== id) : [...ui.closed, id];
      saveUi();
      renderSide();
      return;
    }
    if (b.hasAttribute("data-side-more")) {
      const kind = b.dataset["kind"] as "folder" | "tag" | "ctag" | "style";
      const id = b.dataset["id"]!;
      sideMenu = sideMenu?.kind === kind && sideMenu.id === id ? null : { kind, id };
      renderSide();
      side.querySelector<HTMLElement>(sideMenu ? ".side-menu button" : `[data-side-more][data-id="${CSS.escape(id)}"]`)?.focus();
      return;
    }
    if (b.getAttribute("role") === "menuitem") {
      sideMenu = null; // an action was chosen: the menu closes
      renderSide();
    }
    if (b.dataset["tagAction"]) {
      const key = b.dataset["key"]!;
      const label = [...side.querySelectorAll<HTMLElement>(`[data-scope="tag:${CSS.escape(key)}"] .side-label`)][0]?.textContent?.replace(/^#/, "") ?? key;
      if (b.dataset["tagAction"] === "rename") {
        naming = { kind: "rename-tag", key, label };
        renderSide();
      } else {
        void confirmDialog({
          title: `Delete the tag “${label}”?`,
          lines: ["It is taken off every item that has it. The items stay in the library."],
          confirmLabel: "Delete tag",
        }).then(async (ok) => {
          if (ok && (await session.organize((c) => c.deleteTag(label))) && scope === `tag:${key}`) scope = "all";
        });
      }
      return;
    }
    if (b.dataset["ctagAction"]) {
      const key = b.dataset["key"]!;
      const label = canvasTags.get(key)?.label ?? key;
      if (b.dataset["ctagAction"] === "rename") {
        naming = { kind: "rename-ctag", key, label };
        renderSide();
      } else {
        const c = canvasTags.get(key);
        void confirmDialog({
          title: `Delete the canvas tag “${label}”?`,
          lines: [`It is taken off ${plural(c?.objects ?? 0, "item")} on ${plural(c?.canvases.size ?? 0, "canvas", "canvases")}. The items stay. On the open canvas Undo brings it back; on the others it cannot be undone.`],
          confirmLabel: "Delete tag",
        }).then(async (ok) => {
          if (ok) await session.changeCanvasTag(label, null);
        });
      }
      return;
    }
    if (b.dataset["scope"]) {
      // Choosing the one already chosen lets go of it (back to all assets).
      const next = b.dataset["scope"];
      if (next === scope && next !== "all") {
        scope = "all";
        sideMenu = null;
        render();
        return;
      }
      scope = next;
      if (narrow.matches) sideOpen = false; // a choice on a small screen folds the list away
      sideMenu = null;
      render();
      return;
    }
    const id = b.dataset["id"] ?? "";
    const f = listing?.folders.find((x) => x.id === id);
    switch (b.dataset["folderAction"]) {
      case "new":
        naming = { kind: "new", parent: id || null };
        renderSide();
        break;
      case "rename":
        naming = { kind: "rename", id };
        renderSide();
        break;
      case "delete":
        if (!f) break;
        void confirmDialog({
          title: `Delete folder “${f.name}”?`,
          lines: ["Its subfolders are deleted too. The items in them stay in the library; they are only taken out of these folders."],
          confirmLabel: "Delete folder",
        }).then(async (ok) => {
          if (ok && (await session.organize((c) => c.deleteFolder(id))) && scope === `folder:${id}`) scope = "all";
        });
        break;
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (sideMenu && !(e.target as HTMLElement).closest?.(".side-menu, .side-more")) {
      // Only the menu goes: re-drawing the list now would replace the very button being pressed and lose its click.
      sideMenu = null;
      side.querySelector(".side-menu")?.remove();
      side.querySelector('[data-side-more][aria-expanded="true"]')?.setAttribute("aria-expanded", "false");
    }
  });
  narrow.addEventListener("change", () => {
    sideOpen = !narrow.matches;
    renderSide();
  });
  side.addEventListener("keydown", (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains("side-name") || !naming) return;
    if (e.key === "Escape") {
      naming = null;
      renderSide();
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const n = naming;
      const name = input.value;
      naming = null;
      if (n.kind === "rename-tag") {
        const was = n.label;
        void session.organize((c) => c.renameTag(was, name)).then((ok) => {
          if (ok && scope === `tag:${n.key}`) scope = `tag:${name.replace(/\s+/g, " ").trim().replace(/^#+/, "").toLowerCase()}`;
          renderSide();
        });
      } else if (n.kind === "rename-ctag") {
        const was = n.label;
        void session.changeCanvasTag(was, name).then((changed) => {
          if (changed && scope === `ctag:${n.key}`) scope = `ctag:${name.replace(/\s+/g, " ").trim().replace(/^#+/, "").toLowerCase()}`;
          renderSide();
        });
      } else if (n.kind === "new") {
        const id = newObjectId();
        void session.organize((c) => c.createFolder(name, n.parent, id)).then((ok) => {
          if (!ok) renderSide();
        });
      } else void session.organize((c) => c.renameFolder(n.id, name)).then(() => renderSide());
    }
  });

  /** Rename one or many assets with the shared rename dialog (ADR 0085); names keep the order given. */
  const renameAssetsDialog = async (hashes: readonly string[]): Promise<void> => {
    if (session.readOnly) return;
    const items = hashes.flatMap((h) => {
      const en = listing?.entries.find((x) => x.hash === h);
      return en ? [{ id: h, name: en.name }] : [];
    });
    if (!items.length) return;
    const result = await openBatchRename(items, { noun: items.length === 1 ? "item" : "items" });
    if (!result) return;
    const n = await session.renameAssets(result.map((r) => ({ hash: r.id, name: r.name })));
    if (n) {
      session.editor.message = n === 1 ? `Renamed to “${result[0]!.name}”.` : `Renamed ${n} items.`;
      session.editor.changed();
    }
    await refresh();
    // Keep the keyboard where it was: on the first renamed card (F2 works again).
    grid.querySelector<HTMLElement>(`.asset-card[data-hash="${CSS.escape(items[0]!.id)}"]`)?.focus({ preventScroll: true });
  };
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sideMenu) {
      const was = sideMenu;
      sideMenu = null;
      renderSide();
      side.querySelector<HTMLElement>(`[data-side-more][data-id="${CSS.escape(was.id)}"]`)?.focus();
      e.stopPropagation();
    } else if (e.key === "Escape" && (selected || picked.size)) {
      void select(null);
      e.stopPropagation();
    } else if (e.key === "F2" && !(e.target as HTMLElement).closest(TYPING) && (picked.size || selected)) {
      void renameAssetsDialog(picked.size ? filtered().filter((x) => picked.has(x.hash)).map((x) => x.hash) : [selected!]);
      e.preventDefault();
    } else if ((e.key === "i" || e.key === "I") && !(e.target as HTMLElement).closest(TYPING) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      toggleDetails();
      e.preventDefault();
    }
  });
  root.querySelector<HTMLElement>('.assets-bar [data-action="details"]')!.addEventListener("click", () => toggleDetails());
  // Keys that work anywhere in the library while it is open, whatever has the focus (a click can leave it on the page, not in the library):
  // Esc clears the selection, Ctrl+A picks everything shown, the arrow keys, Home and End move through the items in either layout.
  window.addEventListener("keydown", (e) => {
    if (!visible || !viewer.hidden) return;
    const target = e.target as HTMLElement | null;
    if (document.querySelector("dialog[open]")) return;
    // From the search box, Down steps into the items (the box keeps its other keys).
    if (target?.closest?.('[data-testid="assets-search"]') && e.key === "ArrowDown" && !e.altKey) {
      (target as HTMLElement).blur();
      if (moveBy(e)) e.preventDefault();
      return;
    }
    if (target?.closest?.("dialog, " + TYPING)) return;
    if (e.altKey) return;
    if (e.key === "Escape") {
      if (sideMenu) {
        sideMenu = null;
        renderSide();
        return;
      }
      if (!colPop.hidden) return void closeColumns();
      cursor = null;
      if (!(selected || picked.size)) return;
      void select(null);
      selecting = false;
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      selectAll();
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y")) {
      // the library's own undo: tags, favourites, folders and names (Ctrl+Shift+Z or Ctrl+Y: redo)
      e.preventDefault();
      const redo = e.key === "y" || e.key === "Y" || e.shiftKey;
      void session.undoLibrary(redo).then((label) => {
        session.editor.message = label ? `${redo ? "Redone" : "Undone"}: ${label}.` : `Nothing to ${redo ? "redo" : "undo"} in the library.`;
        session.editor.changed();
      });
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
      if (target?.closest?.("select, .assets-bar, .assets-side")) return; // arrows belong to a menu, the bar and the sidebar
      if (moveBy(e)) e.preventDefault();
    }
  });
  // ---- the context menu (right click, menu key, long touch): on an item the actions of the details panel, on empty ground the library's own.
  // The item rows are read from the panel's buttons (their words, icon and state) and press them, so the menu and the panel can never disagree.
  const PANEL_GROUPS: ReadonlyArray<ReadonlyArray<readonly [string, string?]>> = [
    [["slide", "Open in the viewer"], ["place"], ["place-all"], ["slideshow-all"], ["favorite"], ["favorite-all"]],
    [["rename", "Rename…"], ["rename-all"], ["download", "Download original"], ["open-tab"], ["export", "Export as archive"], ["export-all"], ["export-files-all"]],
    [["delete"], ["delete-all"], ["delete-everywhere"]],
  ];
  const panelGroups = (): MenuItem[][] =>
    PANEL_GROUPS.map((g) =>
      g.flatMap(([action, label]): MenuItem[] => {
        const b = inspector.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
        if (!b || b.hidden) return [];
        const text = label ?? (b.getAttribute("aria-label") || b.textContent?.trim() || action);
        const icon = b.querySelector("svg")?.outerHTML;
        return [{ id: action, label: text, ...(icon ? { icon } : {}), danger: b.classList.contains("is-danger"), disabled: b.disabled, run: () => b.click() }];
      }),
    );
  // Copy and paste with the system clipboard. Copy puts the picture (as PNG, the one picture type every program takes) alone, because a program that is offered a
  // picture and text takes the text; Copy file name puts the name as text. An item that is not a picture goes as its name. Paste brings in a picture from the
  // clipboard, named by the text beside it when that is a file name, else "image".
  const MIME_EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg", "image/bmp": ".bmp", "image/avif": ".avif" };
  const asPng = async (blob: Blob): Promise<Blob> => {
    if (blob.type === "image/png") return blob;
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || 1;
      c.height = img.naturalHeight || 1;
      c.getContext("2d")!.drawImage(img, 0, 0);
      return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("no picture"))), "image/png"));
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  /** Copy the first picture as a PNG (what a paste into a program that takes pictures wants; a name beside it would be taken instead by many of them), or the names as text; what is not a picture goes as its name. */
  const copyItems = async (hashes: readonly string[], what: "picture" | "name" = "picture"): Promise<void> => {
    const ents = hashes.flatMap((h) => listing?.entries.filter((x) => x.hash === h && x.present) ?? []);
    if (!ents.length) return;
    const say = (m: string): void => { session.editor.message = m; session.editor.changed(); };
    try {
      const first = what === "picture" ? ents.find((e) => e.type.startsWith("image/")) : undefined;
      const rec = first ? await assets.record(first.hash) : undefined;
      const png = rec ? await asPng(rec.blob) : null;
      if (first && png) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
        say(`Copied “${first.name || "image"}”.`);
      } else {
        await navigator.clipboard.writeText(ents.map((e) => e.name || "image").join("\n"));
        say(ents.length === 1 ? `Copied the name “${ents[0]!.name || "image"}”.` : `Copied ${ents.length} names.`);
      }
    } catch {
      say("Could not copy to the clipboard.");
    }
  };
  const pasteFromClipboard = async (): Promise<void> => {
    const say = (m: string): void => { session.editor.message = m; session.editor.changed(); };
    try {
      const files: File[] = [];
      for (const it of await navigator.clipboard.read()) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const text = it.types.includes("text/plain") ? (await (await it.getType("text/plain")).text()).split(/\r?\n/)[0]!.trim() : "";
        const named = text.length > 0 && text.length <= 120 ? cleanFileName(text) : "";
        const name = named ? (splitName(named).ext ? named : named + (MIME_EXT[type] ?? "")) : `image${MIME_EXT[type] ?? ""}`;
        files.push(new File([await it.getType(type)], name, { type }));
      }
      if (!files.length) return say("No picture on the clipboard.");
      await view.importFiles(files);
    } catch {
      say("The browser did not let canvast read the clipboard: press Ctrl+V to paste.");
    }
  };
  document.addEventListener("copy", (e) => {
    if (!visible || viewer.hidden !== true || !(picked.size || selected) || (e.target as HTMLElement | null)?.closest?.(TYPING)) return;
    e.preventDefault();
    void copyItems(picked.size ? filtered().filter((x) => picked.has(x.hash)).map((x) => x.hash) : [selected!]);
  });
  const clipboardGroup = (hashes: readonly string[]): MenuItem[] => [
    ...(hashes.length
      ? [
          { id: "copy", label: "Copy", icon: ICONS.clipboardCopy, run: () => void copyItems(hashes) },
          { id: "copy-name", label: hashes.length > 1 ? "Copy names" : "Copy file name", icon: ICONS.fileText, run: () => void copyItems(hashes, "name") },
        ]
      : []),
    { id: "paste", label: "Paste", icon: ICONS.paste, run: () => void pasteFromClipboard() },
  ];
  const emptyItems = (): MenuItem[] => {
    const press = (sel: string) => (): void => root.querySelector<HTMLElement>(sel)?.click();
    return groupedMenu([
      [{ id: "select-all", label: "Select everything", icon: ICONS.selectAll, run: selectAll }, ...clipboardGroup([])],
      [
        { id: "import-files", label: "Import files", icon: ICONS.arrowDownToLine, run: press('[data-action="import"]') },
        { id: "import-folder", label: "Import a folder", icon: ICONS.arrowDownToLine, run: () => root.querySelector<HTMLInputElement>('[data-testid="assets-import-folder-input"]')?.click() },
        { id: "new-folder", label: "New folder", icon: ICONS.folderPlus, run: press('[data-folder-action="new"][data-id=""]') },
      ],
      [
        { id: "slideshow", label: "Slideshow", icon: ICONS.play, run: press('[data-action="slideshow"]') },
        { id: "details", label: "Details panel", icon: ICONS.panelRight, run: toggleDetails },
      ],
    ]);
  };
  bindContextMenu(root.querySelector<HTMLElement>(".assets-scroll")!, {
    label: "Library actions",
    active: () => visible && viewer.hidden === true,
    build: async ({ target }) => {
      const card = target.closest<HTMLElement>(".asset-card");
      if (!card) return emptyItems();
      const hash = card.dataset["hash"];
      if (hash && !picked.has(hash)) await select(hash); // (a card outside the pick is picked alone; one inside it keeps the whole pick)
      const g = panelGroups();
      return groupedMenu([g[0]!, clipboardGroup(picked.size ? [...picked] : hash ? [hash] : []), g[1]!, g[2]!]);
    },
  });
  // ---- the list's columns: drag a header onto another to move it
  const listHead = root.querySelector<HTMLElement>(".assets-list-head")!;
  let dragCol: ColumnId | null = null;
  // A click on a header sorts by it; another click reverses it, as in a table.
  listHead.addEventListener("click", (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>("[data-col]");
    if (!h) return;
    const key = SORT_OF[h.dataset["col"] as ColumnId].key;
    if (sortSel.value === key) reversed = !reversed;
    else {
      sortSel.value = key;
      reversed = false;
    }
    showSort();
    render();
  });
  listHead.addEventListener("dragstart", (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>("[data-col]");
    if (!h) return;
    dragCol = h.dataset["col"] as ColumnId;
    h.classList.add("is-dragging");
    e.dataTransfer?.setData("text/plain", dragCol);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  });
  listHead.addEventListener("dragover", (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>("[data-col]");
    if (!dragCol || !h || h.dataset["col"] === dragCol) return;
    e.preventDefault();
    for (const x of listHead.querySelectorAll(".is-drop")) x.classList.remove("is-drop");
    h.classList.add("is-drop");
  });
  listHead.addEventListener("dragend", () => {
    dragCol = null;
    for (const x of listHead.querySelectorAll(".is-drop, .is-dragging")) x.classList.remove("is-drop", "is-dragging");
  });
  listHead.addEventListener("drop", (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>("[data-col]");
    const from = dragCol;
    dragCol = null;
    for (const x of listHead.querySelectorAll(".is-drop, .is-dragging")) x.classList.remove("is-drop", "is-dragging");
    if (!h || !from || h.dataset["col"] === from) return;
    e.preventDefault();
    const to = h.dataset["col"] as ColumnId;
    const order = ui.order.filter((c) => c !== from);
    order.splice(order.indexOf(to) + (ui.order.indexOf(from) < ui.order.indexOf(to) ? 1 : 0), 0, from); // lands where the target was
    ui.order = order;
    saveUi();
    applyUi();
    if (!colPop.hidden) renderColumns();
  });

  // ---- the list's columns: which are shown and in what order (remembered on this device)
  const colPop = root.querySelector<HTMLElement>(".assets-columns")!;
  const colBtn = root.querySelector<HTMLButtonElement>('[data-action="columns"]')!;
  const renderColumns = (): void => {
    const last = ui.order.length - 1;
    colPop.innerHTML = `<h2>List columns</h2><p>Choose what each row shows and use the arrows to move a column. Name always shows.</p>
      <ul>${ui.order
        .map((id, i) => {
          const c = COLUMNS.find((x) => x.id === id)!;
          return `<li><label><input type="checkbox" data-col-show="${id}"${ui.hidden.includes(id) ? "" : " checked"}${id === "name" ? " disabled" : ""}><span>${c.label}</span></label>
            <span class="cols-move"><button type="button" data-col-move="up" data-col="${id}" aria-label="Move ${c.label} earlier"${i === 0 ? " disabled" : ""}>${ICONS.chevronUp}</button><button type="button" data-col-move="down" data-col="${id}" aria-label="Move ${c.label} later"${i === last ? " disabled" : ""}>${ICONS.chevronDown}</button></span></li>`;
        })
        .join("")}</ul>
      <button type="button" class="assets-btn" data-col-reset>Reset the columns</button>`;
  };
  const closeColumns = (): void => {
    colPop.hidden = true;
    colBtn.setAttribute("aria-expanded", "false");
  };
  const openColumns = (): void => {
    renderColumns();
    const r = colBtn.getBoundingClientRect();
    colPop.style.top = `${Math.round(clearRect(colBtn).bottom + MENU_GAP)}px`;
    colPop.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
    colPop.hidden = false;
    colBtn.setAttribute("aria-expanded", "true");
    colPop.querySelector<HTMLElement>("input:not(:disabled), button")?.focus();
  };
  colBtn.addEventListener("click", () => (colPop.hidden ? openColumns() : closeColumns()));
  colPop.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.hasAttribute("data-col-reset")) {
      ui.order = [...DEFAULT_COLUMN_ORDER];
      ui.hidden = [...DEFAULT_HIDDEN];
    } else if (b.dataset["colMove"]) {
      const id = b.dataset["col"] as ColumnId;
      const i = ui.order.indexOf(id);
      const j = b.dataset["colMove"] === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= ui.order.length) return;
      [ui.order[i], ui.order[j]] = [ui.order[j]!, ui.order[i]!];
    } else return;
    saveUi();
    applyUi();
    renderColumns();
    colPop.querySelector<HTMLElement>(`[data-col="${b.dataset["col"]}"][data-col-move="${b.dataset["colMove"]}"]:not(:disabled)`)?.focus();
  });
  colPop.addEventListener("change", (e) => {
    const box = e.target as HTMLInputElement;
    const id = box.dataset["colShow"] as ColumnId | undefined;
    if (!id || id === "name") return;
    ui.hidden = box.checked ? ui.hidden.filter((c) => c !== id) : [...ui.hidden, id];
    saveUi();
    applyUi();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!colPop.hidden && !colPop.contains(e.target as Node) && !colBtn.contains(e.target as Node)) closeColumns();
  });
  colPop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeColumns();
      colBtn.focus();
      e.stopPropagation();
    }
  });
  for (const b of root.querySelectorAll<HTMLElement>(".assets-layout [data-layout]")) {
    b.addEventListener("click", () => {
      ui.layout = b.dataset["layout"] === "list" ? "list" : "grid";
      saveUi();
      applyUi();
      closeColumns();
    });
  }
  // Slideshow from the library: the picked assets if several are picked, else everything shown, from the selected one (or the first).
  root.querySelector<HTMLElement>('.assets-bar [data-action="slideshow"]')!.addEventListener("click", () => {
    const list = filtered();
    if (!list.length) return;
    const group = picked.size > 1 ? list.filter((e) => picked.has(e.hash)) : list;
    const first = group.find((e) => e.hash === selected) ?? group[0]!;
    startShow(first.hash, picked.size > 1 ? new Set(group.map((e) => e.hash)) : undefined);
  });
  sortSel.addEventListener("change", () => {
    reversed = false; // a new order starts from its usual direction
    showSort();
    render();
  });
  sortDirBtn.addEventListener("click", () => {
    reversed = !reversed;
    showSort();
    render();
  });
  // The search box, the same as the canvas search (ADR 0071): ways (All, Name, Tag), a clear button, recent searches that found something.
  const pop = root.querySelector<HTMLElement>(".assets-search-pop")!;
  const clearBtn = root.querySelector<HTMLButtonElement>(".assets-searchbox .cs-clear")!;
  const recentBox = pop.querySelector<HTMLElement>(".cs-recent")!;
  const PLACE: Record<Way, string> = { all: "Search", name: "Name", tag: "Tag" };
  const setWay = (w: Way): void => {
    way = w;
    search.placeholder = PLACE[w];
    for (const t of pop.querySelectorAll<HTMLElement>("[data-m]")) t.setAttribute("aria-selected", String(t.dataset["m"] === w));
  };
  const paintSearchUi = (): void => {
    clearBtn.hidden = !search.value;
    paintRecent(recentBox, ASSETS_RECENT, !search.value.trim());
  };
  /** A search that found something and was used (Enter, or a card chosen) goes to the recent list. */
  const rememberNow = (): void => {
    if (search.value.trim() && filtered().length) rememberSearch(ASSETS_RECENT, search.value, way);
  };
  const searchChanged = (): void => {
    paintSearchUi();
    render();
  };
  setWay("all");
  mountSuggest(pop.querySelector<HTMLElement>(".search-suggest")!, search, () => {
    const tags = new Map<string, { label: string; n: number }>();
    const types = new Map<string, number>();
    for (const e of listing?.entries ?? []) {
      for (const t of meta(e).tags) {
        const c = tags.get(t.toLowerCase());
        if (c) c.n++;
        else tags.set(t.toLowerCase(), { label: t, n: 1 });
      }
      const k = chipOf(e.name, e.type).toLowerCase();
      types.set(k, (types.get(k) ?? 0) + 1);
    }
    return { tags: [...tags.values()], types: [...types].map(([ext, n]) => ({ ext, n })) };
  });
  search.addEventListener("input", () => {
    // A first "/" chooses Name and is not part of the search; a "#" stays (it is a search word).
    if (search.value[0] === "/") {
      setWay("name");
      search.value = search.value.slice(1);
    }
    paintSearchUi();
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") rememberNow();
    else if (e.key === "Backspace" && !search.value && way !== "all") {
      setWay("all"); // nothing left to delete: back to searching everything
      searchChanged();
    }
  });
  pop.querySelector(".cs-modes")!.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-m]");
    if (!t) return;
    setWay(t.dataset["m"] as Way);
    searchChanged();
    search.focus();
  });
  clearBtn.addEventListener("click", () => {
    search.value = "";
    searchChanged();
    search.focus();
  });
  search.addEventListener("focus", paintSearchUi);
  wireRecent(
    recentBox,
    ASSETS_RECENT,
    (r) => {
      setWay(r.m === "name" || r.m === "tag" ? r.m : "all");
      search.value = r.q;
      searchChanged();
      search.focus();
    },
    () => {
      paintSearchUi();
      search.focus();
    },
  );
  grid.addEventListener("click", rememberNow);
  for (const el of [search, usageSel, sortSel]) {
    el.addEventListener("input", () => {
      render();
    });
  }
  sizeInput.addEventListener("input", () => grid.style.setProperty("--thumb", `${sizeInput.value}px`));
  // The picture you are looking at stays where it is on the screen when the grid is laid out again (the details panel opened or closed, the
  // window or the thumbnails resized, items added above): the picked one if it is in view, else the one a third of the way down.
  const scroller = root.querySelector<HTMLElement>(".assets-scroll")!;
  let keepAt: { hash: string; top: number } | null = null;
  const anchorCard = (): HTMLElement | null => {
    const r = scroller.getBoundingClientRect();
    const pickedCard = selected ? grid.querySelector<HTMLElement>(`.asset-card[data-hash="${CSS.escape(selected)}"]`) : null;
    const pr = pickedCard?.getBoundingClientRect();
    if (pickedCard && pr && pr.bottom > r.top && pr.top < r.bottom) return pickedCard;
    return (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 3) as HTMLElement | null)?.closest<HTMLElement>(".asset-card") ?? null;
  };
  const remember = (): void => {
    const c = anchorCard();
    keepAt = c ? { hash: c.dataset["hash"]!, top: c.getBoundingClientRect().top - scroller.getBoundingClientRect().top } : null;
  };
  scroller.addEventListener("scroll", remember, { passive: true });
  grid.addEventListener("click", () => requestAnimationFrame(remember));
  if (typeof ResizeObserver !== "undefined") {
    const keep = new ResizeObserver(() => {
      if (!keepAt || !visible) return;
      const c = grid.querySelector<HTMLElement>(`.asset-card[data-hash="${CSS.escape(keepAt.hash)}"]`);
      if (!c) return;
      const moved = c.getBoundingClientRect().top - scroller.getBoundingClientRect().top - keepAt.top;
      if (Math.abs(moved) >= 1) scroller.scrollTop += moved;
    });
    keep.observe(grid);
    keep.observe(scroller);
  }
  importBtn.addEventListener("click", () => fileInput.click());
  const folderInput = root.querySelector<HTMLInputElement>('[data-testid="assets-import-folder-input"]')!;
  const importMenu = root.querySelector<HTMLElement>('[data-action="import-menu"]')!;
  importMenu.addEventListener("click", () =>
    openMoreMenu(importMenu, [
      { label: "Import files", icon: ICONS.arrowDownToLine, hint: "Pictures, video, audio and other files", run: () => fileInput.click() },
      { label: "A folder", icon: ICONS.folderInput, hint: "Every file in it, put in library folders of the same names", run: () => folderInput.click() },
    ], "Import"),
  );
  folderInput.addEventListener("change", () => {
    const files = filesOfPicker(folderInput.files);
    folderInput.value = "";
    void view.importFiles(files).then(() => fileByFolders(session, files));
  });
  fileInput.addEventListener("change", () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = "";
    void view.importFiles(files);
  });

  // Notices are shown by the notice stack over every view; the view keeps the last one as text for screen readers and tests.
  notices.subscribe((text) => {
    if (visible) status.textContent = text;
  });
  // A burst of changes (an import filing hundreds of files) reads and draws the library once more after the read in flight, not once per change.
  let refreshing = false;
  let refreshAgain = false;
  const refreshSoon = (): void => {
    if (refreshing) return void (refreshAgain = true);
    refreshing = true;
    void refresh().finally(() => {
      refreshing = false;
      if (refreshAgain) {
        refreshAgain = false;
        refreshSoon();
      }
    });
  };
  session.subscribeAssets(refreshSoon);
  session.subscribe(refreshSoon); // tree renamed, role changed

  const view: AssetsView = {
    show() {
      visible = true;
      root.hidden = false;
      status.textContent = "";
      syncViewing();
      void refresh();
      // The search box takes the focus only on Ctrl+Shift+F (focusSearch); opening the library leaves the focus where it is.
      if (!viewer.hidden) viewer.focus();
    },
    async reveal(hashes) {
      if (!viewer.hidden) closeSlide();
      // Show everything, so the originals are in the list whatever was searched or filtered before.
      search.value = "";
      usageSel.value = "all";
      setWay("all");
      scope = "all";
      paintSearchUi();
      await refresh();
      const known = new Set(listing?.entries.map((e) => e.hash));
      const have = hashes.filter((h) => known.has(h));
      picked.clear();
      for (const h of have) picked.add(h);
      selected = have[have.length - 1] ?? null;
      anchor = selected;
      places = selected && picked.size === 1 ? await session.assetPlaces(selected) : [];
      // The names go into the search (by name), so the rest of the library is filtered out and these are what is listed; with a very long
      // selection the search would be unreadable, so then the whole library stays listed with these picked.
      const names = [...new Set((listing?.entries ?? []).filter((e) => picked.has(e.hash)).map((e) => e.name.replace(/"/g, "").trim()).filter(Boolean))];
      if (names.length > 0 && names.length <= REVEAL_NAMES_MAX) {
        search.value = names.map((n) => `"${n}"`).join(" OR ");
        setWay("name");
        paintSearchUi();
      }
      render();
      markPicked();
      renderInspector();
      if (have[0]) grid.querySelector<HTMLElement>(`[data-hash="${CSS.escape(have[0])}"]`)?.scrollIntoView({ block: "center" });
      if (have.length < hashes.length) status.textContent = `${hashes.length - have.length} of the selected items are not in the library any more.`;
    },
    focusSearch() {
      if (!viewer.hidden) closeSlide();
      search.focus();
      search.select();
    },
    hide() {
      visible = false;
      // The viewer stays as it is for when the library is opened again (after placing an asset, say); only sound and the show stop.
      eng?.pause();
      stopShow();
      root.hidden = true;
      syncViewing();
    },
    async importFiles(files) {
      if (session.editor.blockEdit()) return;
      let n = 0;
      const seen: Array<{ name: string; duplicate: "present" | "restored" }> = [];
      let done = 0;
      const progress = beginProgress(session.editor, "import", files.length > 1 ? "Importing files" : "Importing");
      for (const f of files) {
        progress.update(files.length > 1 ? done / files.length : null, files.length > 1 ? `${done + 1} of ${files.length}, ${f.name || "file"}` : f.name || "file");
        done++;
        try {
          const { record, duplicate } = await assets.importFileDetailed(f, false); // nothing is placed, so a big batch keeps no decoded pictures
          if (duplicate) seen.push({ name: record.name || f.name, duplicate });
          n++;
        } catch (e) {
          session.editor.message = `Could not import ${f.name || "file"}: ${(e as Error).message}`;
          session.editor.changed();
        }
      }
      progress.done();
      if (n) {
        const notice = duplicateNotice(seen, n);
        session.editor.message = !notice ? `Imported ${plural(n, "file")} into the library.` : seen.length === n ? notice : `${plural(n - seen.length, "new file")} imported. ${notice}`;
        session.editor.changed();
      }
      await refresh();
    },
  };
  return view;
}
