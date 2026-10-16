import type { Session, AssetPlace } from "../app/session";
import { storeFrame } from "../app/frames";
import { chipOf, describeFile, isCard } from "../assets/file-kind";
import { FILE_CARD_H, FILE_CARD_W, makeFileCard } from "../assets/card";
import { downloadOriginal, fileActionsOf, openOriginalInTab } from "./file-actions";
import { searchHelpButton, wireSearchHelp } from "./search-help";
import { ASSETS_RECENT, rememberSearch } from "../search/history";
import { paintRecent, wireRecent } from "./search-recent";
import { evalQuery, parseQuery, type Query } from "../search/query";
import type { AssetLibrary } from "../assets/asset-library";
import { duplicateNotice } from "../assets/asset-library";
import type { AssetFolder, CatalogListing } from "../assets/asset-catalog";
import { folderPath, folderSubtree, meta } from "../assets/asset-catalog";
import { THUMB_PX, makeThumb } from "../assets/thumb";
import { newObjectId } from "../doc/model";
import { ICONS } from "./icons";
import { esc, fmtBytes } from "./format";
import { confirmDialog } from "./confirm";
import { runExport, runExportFiles } from "./archive-ui";
import { hasAlpha } from "./alpha";
import type { Engine } from "./media-player";
import { avEngine, gifEngine } from "./media-player";
import { mountPlayerControls } from "./player-controls";
import type { ImageObject } from "../doc/model";
import { chooseDialog } from "./confirm";
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
const COLUMNS = [
  { id: "name", label: "Name", min: 140, grow: 2 },
  { id: "pixels", label: "Pixels", min: 100, grow: 0 },
  { id: "kind", label: "Type and size", min: 120, grow: 0 },
  { id: "used", label: "Used", min: 120, grow: 1.2 },
  { id: "tags", label: "Tags", min: 100, grow: 1 },
  { id: "added", label: "Added", min: 110, grow: 0 },
  { id: "type", label: "Type", min: 70, grow: 0 },
  { id: "size", label: "Size", min: 80, grow: 0 },
  { id: "folder", label: "Folder", min: 110, grow: 1 },
  { id: "favourite", label: "Favourite", min: 80, grow: 0 },
] as const;
type ColumnId = (typeof COLUMNS)[number]["id"];
const DEFAULT_COLUMN_ORDER: readonly ColumnId[] = COLUMNS.map((c) => c.id);
const DEFAULT_HIDDEN: readonly ColumnId[] = ["added", "type", "size", "folder", "favourite"];
/** A column's track in the list's grid: a fixed width, or a share of the room left over (never narrower than its minimum). */
const trackOf = (c: (typeof COLUMNS)[number]): string => (c.grow ? `minmax(${c.min}px, ${c.grow}fr)` : `${c.min}px`);


type UsageFilter = "all" | "used" | "unused";
type SortKey = "newest" | "name" | "size" | "uses";


/** Fields that take typed text: shortcuts keep out of them (a checkbox or a slider is not one). */
const TYPING = 'input:not([type="checkbox"]):not([type="range"]), textarea, select';

export function mountAssetsView(root: HTMLElement, session: Session, assets: AssetLibrary, showCanvas: () => void, notices: { subscribe(fn: (text: string) => void): void }, settings: SettingsStore): AssetsView {
  root.innerHTML = `
    <div class="assets-bar" role="toolbar" aria-label="Asset library">
      <div class="assets-searchbox">
              <input type="search" class="assets-search" data-testid="assets-search" placeholder="Search name, type or tag" title="Search by name, type or tag; #tag matches a tag exactly" aria-label="Search assets">
        <button type="button" class="cs-clear" aria-label="Clear the search" title="Clear the search" hidden>${ICONS.x}</button>
        ${searchHelpButton()}
        <div class="assets-search-pop" data-testid="assets-search-pop">
          <div class="cs-modes" role="tablist" aria-label="Search by">
            <button type="button" role="tab" data-m="all">All</button>
            <button type="button" role="tab" data-m="name"><kbd>/</kbd>Name</button>
            <button type="button" role="tab" data-m="tag"><kbd>#</kbd>Tag</button>
          </div>
          <div class="cs-recent" data-testid="search-recent" hidden></div>
        </div>
      </div>
      <span class="assets-count" data-testid="assets-count"></span>
      <select data-testid="assets-usage" aria-label="Show">
        <option value="all">All assets</option><option value="used">In use</option><option value="unused">Unused</option>
      </select>
      <select data-testid="assets-sort" aria-label="Sort by">
        <option value="newest">Newest first</option><option value="name">Name A–Z</option><option value="size">Largest first</option><option value="uses">Most used</option>
      </select>
      <button type="button" class="assets-btn is-icon" data-action="sort-dir" data-testid="assets-sort-dir" aria-pressed="false">${ICONS.arrowUpDown}</button>
      <button type="button" class="assets-btn is-icon" data-action="columns" data-testid="assets-columns" aria-haspopup="dialog" aria-expanded="false" aria-label="List columns" title="Choose and arrange the columns of the list">${ICONS.columns3}</button>
      <div class="assets-layout" role="group" aria-label="Layout">
        <button type="button" class="assets-btn is-icon" data-layout="grid" aria-pressed="true" aria-label="Thumbnails" title="Thumbnails">${ICONS.layoutGrid}</button>
        <button type="button" class="assets-btn is-icon" data-layout="list" aria-pressed="false" aria-label="List" title="List">${ICONS.layoutList}</button>
      </div>
      <label class="assets-size" title="Thumbnail size">${ICONS.moveDiagonal}<input type="range" min="96" max="240" step="24" value="144" aria-label="Thumbnail size"></label>
      <button type="button" class="assets-btn" data-action="import" data-testid="assets-import">${ICONS.fileInput}<span>Import</span></button>
      <button type="button" class="assets-btn is-icon" data-action="slideshow" data-testid="assets-slideshow" aria-label="Slideshow" title="Play the library, or the assets you picked, as a slideshow">${ICONS.play}</button>
      <button type="button" class="assets-btn is-icon" data-action="details" aria-pressed="true" aria-label="Details panel" title="Show or hide the details (I)">${ICONS.panelRight}</button>
      <input type="file" multiple hidden data-testid="assets-import-input">
    </div>
    <div class="assets-columns" role="dialog" aria-label="List columns" data-testid="columns-panel" hidden></div>
    <p class="assets-status" role="status" data-testid="assets-status"></p>
    <div class="assets-body">
      <nav class="assets-side" data-testid="assets-side" aria-label="Library"></nav>
      <div class="assets-main">
        <div class="assets-scroll"><div class="assets-list-head"><span></span>${COLUMNS.map((c) => `<span data-col="${c.id}" draggable="true" title="Drag to move this column">${c.label}</span>`).join("")}</div><div class="assets-grid" role="list" data-testid="assets-grid"></div></div>
        <div class="viewer" data-testid="slide-view" role="region" aria-label="Viewer" tabindex="-1" hidden>
          <div class="viewer-stage"><span class="viewer-progress" hidden></span><div class="viewer-edge is-prev" data-edge="prev" aria-hidden="true"></div><div class="viewer-edge is-next" data-edge="next" aria-hidden="true"></div>
            <figure><div class="viewer-checker" hidden><i></i></div><img alt="" draggable="false"><video hidden></video><canvas class="viewer-gif" hidden></canvas><figcaption></figcaption></figure></div>
          <div class="viewer-bar" role="toolbar" aria-label="Viewer controls">
            <div class="viewer-nav">
              <button type="button" class="vbtn" data-act="prev" aria-label="Previous" title="Previous (Left arrow)">${ICONS.chevronLeft}</button>
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
              <button type="button" class="vbtn" data-act="play" aria-pressed="false" aria-label="Start the slideshow" title="Start the slideshow (Space)">${ICONS.presentation}<span>Slideshow</span></button>
              <button type="button" class="vbtn" data-act="fullscreen" aria-label="Full screen" title="Full screen">${ICONS.maximize}</button>
              <span class="viewer-quick"><button type="button" class="vbtn" data-act="favorite" aria-pressed="false" aria-label="Favourite" title="Favourite">${ICONS.star}</button>
              <button type="button" class="vbtn is-primary" data-act="place" title="Place on the open canvas">${ICONS.mapPin}<span>Place</span></button></span>
              <button type="button" class="vbtn" data-act="details" aria-pressed="true" aria-label="Details panel" title="Show or hide the details (I)">${ICONS.panelRight}</button>
              <button type="button" class="vbtn" data-act="bar" aria-label="Hide the controls" title="Hide the controls (F)">${ICONS.panelBottomClose}</button>
              <button type="button" class="vbtn" data-act="close" aria-label="Close slide view" title="Back to the library (Esc)">${ICONS.x}</button>
            </div>
          </div>
          <div class="viewer-handle" hidden>
            <button type="button" class="vbtn" data-act="play" aria-label="Pause the slideshow" title="Pause the slideshow (Space)">${ICONS.pause}</button>
            <button type="button" class="vbtn" data-act="bar" aria-label="Show the controls" title="Show the controls (F)">${ICONS.panelBottomOpen}</button>
          </div>
        </div>
      </div>
      <div class="sheet-grip" data-testid="sheet-grip" role="separator" aria-orientation="horizontal" aria-label="Resize the details panel" title="Drag to resize the details (double-click to reset)" tabindex="0"><span></span></div>
      <aside class="asset-inspector" data-testid="asset-inspector" aria-label="Asset details" hidden></aside>
    </div>
    <div class="place-menu" role="menu" aria-label="Place on" data-testid="place-menu" hidden></div>`;
  const body = root.querySelector<HTMLElement>(".assets-body")!;
  const viewer = root.querySelector<HTMLElement>(".viewer")!;
  const film = root.querySelector<HTMLElement>(".viewer-film")!;
  const grid = root.querySelector<HTMLElement>(".assets-grid")!;
  const inspector = root.querySelector<HTMLElement>(".asset-inspector")!;
  const status = root.querySelector<HTMLElement>(".assets-status")!;
  const count = root.querySelector<HTMLElement>(".assets-count")!;
  const search = root.querySelector<HTMLInputElement>(".assets-search")!;
  wireSearchHelp(root.querySelector<HTMLElement>(".search-help-btn")!, search);
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
  };
  /** The order named in words, on the choice and on the button, so the direction is never a guess. */
  const showSort = (): void => {
    for (const o of sortSel.options) o.textContent = SORT_LABEL[o.value as SortKey][reversed ? 1 : 0];
    const now = SORT_LABEL[sortSel.value as SortKey][reversed ? 1 : 0];
    const other = SORT_LABEL[sortSel.value as SortKey][reversed ? 0 : 1];
    sortDirBtn.setAttribute("aria-pressed", String(reversed));
    sortDirBtn.setAttribute("aria-label", `Sorted: ${now}. Reverse the order`);
    sortDirBtn.title = `Sorted: ${now}. Click for ${other}.`;
  };
  showSort();
  const sizeInput = root.querySelector<HTMLInputElement>(".assets-size input")!;
  const fileInput = root.querySelector<HTMLInputElement>('[data-testid="assets-import-input"]')!;
  const importBtn = root.querySelector<HTMLButtonElement>('[data-action="import"]')!;
  const side = root.querySelector<HTMLElement>(".assets-side")!;

  // What the user chose to hide (the details panel, the viewer's controls) is remembered on this device.
  const UI_KEY = "canvast.assets.ui";
  const ui: { details: boolean; bar: boolean; layout: "grid" | "list"; order: ColumnId[]; hidden: ColumnId[]; closed: string[]; sheetH: number | null } = { details: true, bar: true, layout: "grid", order: [...DEFAULT_COLUMN_ORDER], hidden: [...DEFAULT_HIDDEN], closed: [], sheetH: null };
  try {
    const saved = JSON.parse(localStorage.getItem(UI_KEY) ?? "{}") as Partial<typeof ui>;
    if (typeof saved.details === "boolean") ui.details = saved.details;
    if (typeof saved.bar === "boolean") ui.bar = saved.bar;
    if (saved.layout === "grid" || saved.layout === "list") ui.layout = saved.layout;
    const known = new Set<string>(DEFAULT_COLUMN_ORDER);
    if (Array.isArray(saved.order)) {
      const order = saved.order.filter((c, i, a) => known.has(c) && a.indexOf(c) === i);
      ui.order = [...order, ...DEFAULT_COLUMN_ORDER.filter((c) => !order.includes(c))];
    }
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
  /** With the viewer open and its controls hidden the page is only the picture: the view tabs at the top fade away too (they come back near the top edge). */
  const syncImmersive = (): void => {
    document.body.toggleAttribute("data-immersive", visible && !viewer.hidden && !ui.bar);
  };
  const applyUi = (): void => {
    body.classList.toggle("no-details", !ui.details);
    viewer.classList.toggle("no-bar", !ui.bar);
    root.classList.toggle("no-controls", !ui.bar);
    syncImmersive();
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
  /** Picking several: once a checkbox, Ctrl or Shift started it, a plain click adds or removes; until then a click opens the viewer. */
  let selecting = false;
  let places: AssetPlace[] = [];
  let generation = 0;
  /** Sidebar scope: "all", "favorites", "unfiled", "folder:<id>" or "tag:<lowercased tag>". */
  let scope = "all";
  /** Inline name input in the sidebar: a new folder (under `parent`) or a rename. */
  /** In-canvas tags across the workspace (ADR 0062), and those carried by instances of the open asset. */
  let canvasTags = new Map<string, { label: string; objects: number; canvases: Set<string>; assets: Set<string> }>();
  let assetCanvasTags: string[] = [];
  /** The row whose "more" menu is open in the sidebar. */
  let sideMenu: { kind: "folder" | "smart" | "tag" | "ctag"; id: string } | null = null;
  /** On a narrow screen the sidebar is a strip that opens on demand. */
  const narrow = window.matchMedia("(max-width: 900px)");
  let sideOpen = !narrow.matches;
  let naming: { kind: "new"; parent: string | null } | { kind: "rename-tag"; key: string; label: string } | { kind: "rename-ctag"; key: string; label: string } | { kind: "rename"; id: string } | { kind: "new-smart" } | { kind: "rename-smart"; id: string } | null = null;
  const thumbs = new Map<string, Promise<string>>();

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
  const loadThumb = (img: HTMLImageElement): void => {
    const hash = img.dataset["hash"]!;
    thumbFor(hash).then(
      (url) => {
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
      void p.then((url) => URL.revokeObjectURL(url), () => undefined);
    }
  };

  // ---- viewer: the original in the library's own window, with the details beside it and the controls below (both can be hidden)
  const slideImg = viewer.querySelector<HTMLImageElement>("img")!;
  const slideMedia = viewer.querySelector<HTMLVideoElement>("video")!;
  const slideCaption = viewer.querySelector<HTMLElement>("figcaption")!;
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
          `<button type="button" class="film-item${e.hash === slideHash ? " is-current" : ""}" role="option" aria-selected="${e.hash === slideHash}" data-hash="${e.hash}" aria-label="${esc(e.name || "Untitled")}" title="${esc(e.name || "Untitled")}"><img alt="" draggable="false" data-hash="${e.hash}"></button>`,
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
  const paintZoom = (): void => {
    const el = shownMedia();
    const z = sizes();
    for (const m of [slideImg, slideMedia, slideGif]) m.style.transform = m === el && (zoom.s !== 1 || zoom.x || zoom.y) ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})` : "";
    // A picture with see-through pixels sits on a chequered ground exactly the size of the picture, zoomed with it.
    checker.hidden = !(el === slideImg && slideAlpha && z);
    if (!checker.hidden && z) {
      const tile = checker.firstElementChild as HTMLElement;
      tile.style.width = `${z.fw}px`;
      tile.style.height = `${(z.fw * z.nh) / z.nw}px`;
      checker.style.transform = slideImg.style.transform;
    }
    zoomPct.textContent = z ? (zoom.s === 1 ? "Fit" : `${Math.round(((zoom.s * z.fw) / z.nw) * 100)}%`) : "Fit";
    viewer.classList.toggle("is-zoomed", zoom.s !== 1);
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
    syncImmersive();
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
    slideImg.hidden = false;
    slideAlpha = false;
    checker.hidden = true;
    const rec = e.present ? await assets.record(hash).catch(() => undefined) : undefined;
    if (token !== slideToken) return;
    const thumbnail = async (): Promise<void> => {
      slideCaption.textContent = `${label}. The original is missing or damaged; showing its thumbnail.`;
      slideCaption.classList.add("is-note");
      slideImg.src = await thumbFor(hash).catch(() => "");
    };
    if (!rec) return void (await thumbnail());
    if (isCard(rec)) {
      // Not something the browser can show: its card, large, and what it is (ADR 0078).
      const d = describeFile(rec.name, rec.type);
      const bmp = await makeFileCard(rec.name, d.chip, d.category, rec.size, 2);
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d")!.drawImage(bmp, 0, 0);
      bmp.close();
      const png = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      if (token !== slideToken) return;
      slideUrl = png ? URL.createObjectURL(png) : null;
      slideImg.className = "is-file";
      slideImg.removeAttribute("style");
      slideImg.src = slideUrl ?? "";
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
  const closeSlide = (): void => {
    const was = slideHash;
    stopShow();
    slideSet = null;
    slideToken++;
    slideHash = null;
    viewer.hidden = true;
    body.classList.remove("is-viewing");
    root.classList.remove("is-viewing");
    syncImmersive();
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
    playBtn.innerHTML = `${on ? ICONS.pause : ICONS.presentation}<span>${on ? "Pause" : "Slideshow"}</span>`;
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
  /** The details panel was opened by a plain click on a card (so a double-click can undo it). */
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
      grid.innerHTML = `<p class="assets-empty">Storage is unavailable, so there is no asset library in this tab.</p>`;
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
   * `#tag` is an exact tag in every way. AND, OR, XOR, NOT and brackets combine words. Then the usage filter: what a smart folder saves.
   */
  const matchesQuery = (e: CatalogListing["entries"][number], query: Query | null, usage: UsageFilter, how: Way = way): boolean => {
    const tags = meta(e).tags.map((t) => t.toLowerCase());
    const name = e.name.toLowerCase();
    const words_ok = evalQuery(query, ({ text: w }) => {
      if (w.startsWith("#")) return tags.includes(w.slice(1));
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
    const usage = usageSel.value as UsageFilter;
    const inFolders = scope.startsWith("folder:") ? folderSubtree(listing.folders, scope.slice(7)) : null;
    const inScope = (e: CatalogListing["entries"][number]): boolean => {
      const m = meta(e);
      if (scope === "favorites") return m.favorite;
      if (scope === "unfiled") return m.folderIds.length === 0;
      if (inFolders) return m.folderIds.some((id) => inFolders.has(id));
      if (scope.startsWith("tag:")) return m.tags.some((t) => t.toLowerCase() === scope.slice(4));
      if (scope.startsWith("ctag:")) return canvasTags.get(scope.slice(5))?.assets.has(e.hash) ?? false;
      return true;
    };
    const rows = listing.entries.filter((e) => inScope(e) && matchesQuery(e, words, usage));
    const key = sortSel.value as SortKey;
    const cmp: Record<SortKey, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = {
      newest: (a, b) => b.importedAt - a.importedAt,
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => b.size - a.size,
      uses: (a, b) => b.instances - a.instances,
    };
    const flip = reversed ? -1 : 1;
    return rows.sort((a, b) => flip * cmp[key](a, b) || (a.hash < b.hash ? -1 : 1));
  };

  // ---- rendering
  let lastGridHtml = "";
  const render = (): void => {
    root.querySelector<HTMLElement>(".assets-searchbox .cs-clear")!.hidden = !search.value; // set by a smart folder too
    if (!listing) return;
    const rows = filtered();
    const usageAll = usageSel.value === "all" && !search.value.trim() && scope === "all";
    count.textContent = `${rows.length === listing.entries.length ? "" : `${rows.length} of `}${listing.entries.length} asset${listing.entries.length === 1 ? "" : "s"}`;
    const check = (hash: string, name: string): string => `<input type="checkbox" class="asset-check" data-hash="${hash}" aria-label="Select ${esc(name)}">`;
    const cards = rows.map((e) => {
      const small = Math.max(e.pixelW, e.pixelH) < THUMB_PX ? " is-pixelated" : "";
      const ar = Math.max(0.4, Math.min(3, e.pixelW / Math.max(1, e.pixelH)));
      const name = e.name || "Untitled";
      return `<div class="asset-cell" role="listitem" style="--ar:${ar.toFixed(3)}">
        <button type="button" class="asset-card${e.present ? "" : " is-missing"}" data-testid="asset-card" data-hash="${e.hash}"
          aria-pressed="false" aria-label="${esc(name)}, ${e.pixelW} × ${e.pixelH} px" title="${esc(name)}">
        <span class="asset-thumb"><img alt="" draggable="false" class="${small.trim()}" data-hash="${e.hash}">${!isCard(e) ? `<span class="ext-chip">${esc(chipOf(e.name, e.type))}</span>` : ""}</span>
        ${e.present ? "" : `<span class="asset-missing-label">Original missing</span>`}
        <span class="asset-info">
          <span class="asset-name">${esc(name)}</span>
          <span class="asset-meta">${e.pixelW} × ${e.pixelH} px</span>
          <span class="asset-kind">${esc(chipOf(e.name, e.type))}, ${fmtBytes(e.size)}</span>
          <span class="asset-type">${esc(chipOf(e.name, e.type))}</span>
          <span class="asset-size">${fmtBytes(e.size)}</span>
          <span class="asset-folder">${esc(meta(e).folderIds[0] ? folderPath(listing!.folders, meta(e).folderIds[0]!).join(" › ") : "")}</span>
          <span class="asset-fav">${meta(e).favorite ? "★ Favourite" : ""}</span>
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
                <span class="asset-kind"></span>
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
        ? `<p class="assets-empty">No assets match.</p>`
        : `<p class="assets-empty">No assets yet. Import files here (any type), or drop them on a canvas.</p>`;
    grid.style.setProperty("--thumb", `${sizeInput.value}px`);
    // The cards are only drawn again when something about them changed: picking, opening and typing leave them (and the pictures) alone.
    if (html !== lastGridHtml) {
      const ae = document.activeElement as HTMLElement | null;
      const focused = ae && grid.contains(ae) ? { hash: ae.dataset["hash"], box: ae.classList.contains("asset-check") } : null;
      grid.innerHTML = html;
      lastGridHtml = html;
      if (focused?.hash) grid.querySelector<HTMLElement>(`${focused.box ? ".asset-check" : ".asset-card"}[data-hash="${focused.hash}"]`)?.focus({ preventScroll: true });
      for (const img of grid.querySelectorAll<HTMLImageElement>("img[data-hash]")) io.observe(img);
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
    const ro = session.readOnly;
    const kindWord = { folder: "folder", smart: "smart folder", tag: "tag", ctag: "canvas tag" } as const;
    /** A row's "more" button and, when open, its labelled menu (Rename, Delete and so on): one button instead of a row of them. */
    const more = (kind: "folder" | "smart" | "tag" | "ctag", id: string, name: string, items: Array<{ attr: string; label: string; icon: string; aria: string; danger?: boolean }>): string => {
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
      `<li class="side-row ${opts.cls ?? ""}" style="--depth:${opts.depth ?? 0}"><button type="button" class="side-item${scope === key ? " is-active" : ""}" data-scope="${esc(key)}" aria-current="${scope === key}">
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
    const addBtn = (attr: string, label: string, extra = ""): string => (ro ? "" : `<button type="button" class="side-add" ${attr} aria-label="${label}" title="${label}"${extra}>${/smart/i.test(label) ? ICONS.listFilterPlus : ICONS.folderPlus}</button>`);
    const smartReady = !!(search.value.trim() || usageSel.value !== "all");
    const scopeName = ((): string => {
      if (scope === "all") return "All assets";
      if (scope === "favorites") return "Favourites";
      if (scope === "unfiled") return "Unfiled";
      if (scope.startsWith("folder:")) return listing!.folders.find((f) => `folder:${f.id}` === scope)?.name ?? "Folder";
      if (scope.startsWith("smart:")) return listing!.smart.find((x) => `smart:${x.id}` === scope)?.name ?? "Smart folder";
      if (scope.startsWith("tag:")) return `#${tagCounts.get(scope.slice(4))?.label ?? scope.slice(4)}`;
      if (scope.startsWith("ctag:")) return `Canvas tag #${canvasTags.get(scope.slice(5))?.label ?? scope.slice(5)}`;
      return "Library";
    })();
    side.dataset["open"] = String(sideOpen);
    side.innerHTML = `
      <button type="button" class="side-collapse" data-side-toggle aria-expanded="${sideOpen}">${ICONS.panelLeft}<span class="side-label">Library: ${esc(scopeName)}</span>${sideOpen ? ICONS.chevronUp : ICONS.chevronDown}</button>
      <div class="side-body">
        <ul class="side-list side-views">
          ${item("all", "All assets", entries.length, { icon: ICONS.images })}
          ${item("favorites", "Favourites", entries.filter((e) => meta(e).favorite).length, { icon: ICONS.star })}
          ${item("unfiled", "Unfiled", entries.filter((e) => meta(e).folderIds.length === 0).length, { icon: ICONS.folderX })}
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
          "smart",
          "Smart folders",
          addBtn('data-smart-action="new" data-testid="smart-new"', "Save the current search as a smart folder", smartReady ? "" : " disabled"),
          `<ul class="side-list" data-testid="smart-list">
            ${naming?.kind === "new-smart" ? nameInput("", "Name of the new smart folder") : ""}
            ${listing.smart
              .map((sf) =>
                naming?.kind === "rename-smart" && naming.id === sf.id
                  ? nameInput(sf.name, `New name for smart folder ${sf.name}`)
                  : item(`smart:${sf.id}`, esc(sf.name), entries.filter((e) => matchesQuery(e, searchWords(sf.search), sf.usage, sf.way ?? "all")).length, {
                      icon: ICONS.sparkles,
                      extra: more("smart", sf.id, sf.name, [
                        { attr: 'data-smart-action="rename"', label: "Rename", icon: ICONS.textCursorInput, aria: `Rename smart folder ${sf.name}` },
                        { attr: 'data-smart-action="delete"', label: "Delete", icon: ICONS.trash2, aria: `Delete smart folder ${sf.name}`, danger: true },
                      ]),
                    }),
              )
              .join("") || (naming ? "" : `<li class="side-empty">Search for something, then press + to keep it here.</li>`)}
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
                      }).replace("<button ", `<button title="On ${c.objects} item(s) across ${c.canvases.size} canvas(es); ${c.assets.size} from the library" `),
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
      pop.style.top = `${Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 2)}px`;
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
    const folders = listing!.folders;
    const sorted = [...folders].sort((a, b) => folderPath(folders, a.id).join("/").localeCompare(folderPath(folders, b.id).join("/")));
    const bytes = ents.reduce((t, e) => t + e.size, 0);
    inspector.dataset["hash"] = "";
    inspector.innerHTML = `
      <div class="asset-insp-head">
        <h2>${n} selected</h2>
        <button type="button" class="assets-btn is-icon" data-action="clear" aria-label="Clear the selection" title="Clear the selection (Esc)">${ICONS.x}</button>
      </div>
      <div class="asset-quick">
        <button type="button" class="assets-btn is-icon" data-action="favorite-all" data-testid="bulk-favorite" aria-pressed="${allFav}" aria-label="${allFav ? "Remove all from favourites" : "Add all to favourites"}" title="${allFav ? "Remove all from favourites" : "Add all to favourites"}"${dis}>${ICONS.star}</button>
        <span class="split"><button type="button" class="assets-btn is-primary" data-action="place-all" data-testid="bulk-place"${placeable ? "" : " disabled"}${dis} title="Place them on the open canvas, in a grid">${ICONS.mapPin}<span>Place ${placeable} on canvas</span></button><button type="button" class="assets-btn is-primary is-icon" data-action="place-all-menu" data-testid="bulk-place-menu"${placeable ? "" : " disabled"}${dis} aria-haspopup="menu" aria-label="Place them on another canvas or a new one" title="Place them on another canvas or a new one">${ICONS.chevronDown}</button></span>
      </div>
      <div class="asset-facts"><span>${fmtBytes(bytes)} in all</span><span>${unused} of ${n} not used on any canvas</span></div>
      <section class="asset-sec">
        <h3>Add a tag to all</h3>
        <div class="tag-chips"><input class="tag-input bulk-tag-input" data-testid="bulk-tag-input" placeholder="Add a tag" aria-label="Add a tag to all selected" title="Type a tag and press Enter" maxlength="64"${dis}></div>
      </section>
      <section class="asset-sec">
        <h3>Move all to a folder</h3>
        ${
          sorted.length
            ? `<ul class="asset-folders" data-testid="bulk-folders">${[`<li><label><input type="radio" name="bulk-folder" data-bulk-folder=""${ents.every((e) => meta(e).folderIds.length === 0) ? " checked" : ""}${dis}>No folder</label></li>`, ...sorted.map((f: AssetFolder) => `<li><label><input type="radio" name="bulk-folder" data-bulk-folder="${f.id}"${ents.every((e) => meta(e).folderIds[0] === f.id) ? " checked" : ""}${dis}>${esc(folderPath(folders, f.id).join(" › "))}</label></li>`)].join("")}</ul>`
            : `<p class="asset-note">No folders yet. Make one with “+ Folder” in the sidebar.</p>`
        }
      </section>
      <div class="asset-actions">
        <button type="button" class="assets-btn" data-action="slideshow-all" data-testid="bulk-slideshow">${ICONS.presentation}<span>Slideshow of these</span></button>
        <button type="button" class="assets-btn" data-action="export-files-all" data-testid="bulk-export-files"${placeable ? "" : " disabled"}>${ICONS.fileArchive}<span>Export ${placeable} files as ZIP</span></button>
        <button type="button" class="assets-btn" data-action="export-all" data-testid="bulk-export"${placeable ? "" : " disabled"}>${ICONS.fileOutput}<span>Export ${placeable} as archive</span></button>
        <button type="button" class="assets-btn is-danger" data-action="delete-all" data-testid="bulk-delete"${unused ? "" : " disabled"}${dis}>${ICONS.trash2}<span>Delete ${unused} unused</span></button>
        ${unused < n ? `<p class="asset-note">${n - unused} in use ${n - unused === 1 ? "is" : "are"} kept: remove their instances from the canvases first.</p>` : ""}
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
      inspector.hidden = true;
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
            aria-label="Show ${p.ids.length} instance(s) on ${esc(p.boardName)} › ${esc(p.canvasName)}">${ICONS.locate}<span>Show</span></button></li>`,
      )
      .join("");
    const ro = session.readOnly ? " disabled title=\"Read-only: another tab is editing\"" : "";
    const fav = e ? meta(e).favorite : false;
    inspector.innerHTML = `
      <div class="asset-insp-head">
        <h2 title="${esc(e ? e.name || "Untitled" : "Missing original")}">${esc(e ? e.name || "Untitled" : "Missing original")}</h2>
        <button type="button" class="assets-btn is-icon" data-action="close" aria-label="Close details" title="Close the details">${ICONS.x}</button>
      </div>
      ${e ? `<button type="button" class="asset-preview" data-action="slide" data-testid="asset-preview" aria-label="Open slide view" title="Open in the viewer (double-click a card, or Enter)"><img alt="Preview of ${esc(e.name)}" draggable="false" data-hash="${e.hash}" class="${Math.max(e.pixelW, e.pixelH) < THUMB_PX ? "is-pixelated" : ""}"></button>` : ""}
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
      <details class="asset-more"><summary>Technical details</summary>
        <dl>
          ${e ? `<dt>Type</dt><dd>${esc(e.type)}</dd><dt>Stored size</dt><dd>${fmtBytes(e.size)} (one copy)</dd><dt>Imported</dt><dd>${new Date(e.importedAt).toLocaleString()}</dd>` : ""}
          <dt>Content hash</dt><dd class="asset-hash" title="${selected}">${selected!.slice(0, 16)}…</dd>
        </dl>
      </details>
      <div class="asset-actions">
        ${e?.present ? `<button type="button" class="assets-btn" data-action="download" data-testid="asset-download" title="Save a copy of the original file">${ICONS.download}<span>Download original</span></button>` : ""}
        ${e?.present && fileActionsOf(e.name, e.type).canOpen ? `<button type="button" class="assets-btn" data-action="open-tab" data-testid="asset-open-tab" title="Show it in a new browser tab">${ICONS.externalLink}<span>Open in a new tab</span></button>` : ""}
        ${e?.present ? `<button type="button" class="assets-btn" data-action="export" data-testid="asset-export">${ICONS.fileOutput}<span>Export as archive</span></button>` : ""}
        ${e ? `<button type="button" class="assets-btn is-danger" data-action="delete" data-testid="asset-delete"${instances > 0 ? " disabled" : ro}>${ICONS.trash2}<span>Delete from library</span></button>
               ${instances > 0 ? `<p class="asset-note" data-testid="asset-delete-note">In use, so it cannot be deleted. Remove its ${instances} instance(s) from their canvases first.</p>` : ""}` : ""}
      </div>`;
    const prev = inspector.querySelector<HTMLImageElement>(".asset-preview img");
    if (prev) loadThumb(prev);
    const tagInput = inspector.querySelector<HTMLInputElement>(".tag-input");
    if (tagInput && draft) tagInput.value = draft;
    if (tagInput && hadFocus) tagInput.focus();
    // The viewer's favourite button follows the stored state.
    if (e && slideHash === e.hash) viewer.querySelector<HTMLElement>('[data-act="favorite"]')!.setAttribute("aria-pressed", String(fav));
  };

  /** Tags and folders of an entry (inspector). */
  const organizeHtml = (e: CatalogListing["entries"][number]): string => {
    const m = meta(e);
    const dis = session.readOnly ? " disabled" : "";
    const folders = listing!.folders;
    const sorted = [...folders].sort((a, b) => folderPath(folders, a.id).join("/").localeCompare(folderPath(folders, b.id).join("/")));
    return `
      <section class="asset-sec">
        <h3>Tags</h3>
        <div class="tag-chips" data-testid="asset-tags">
          ${m.tags.map((t) => `<span class="tag-chip">#${esc(t)}<button type="button" data-action="untag" data-tag="${esc(t)}" aria-label="Remove tag ${esc(t)}"${dis}>×</button></span>`).join("")}
          <input class="tag-input" data-testid="asset-tag-input" placeholder="Add a tag" aria-label="Add a tag" title="Type a tag and press Enter" maxlength="64"${dis}>
        </div>
      </section>
      ${(() => {
        // Tags put on this picture's instances on canvases (in-canvas tags) that the asset itself does not have yet.
        const extra = assetCanvasTags.filter((t) => !m.tags.some((x) => x.toLowerCase() === t.toLowerCase()));
        return extra.length
          ? `<section class="asset-sec"><h3>Tags used on canvases</h3>
              <p class="asset-note">Added to this picture on a canvas, not in the library. Choose one to add it to the library tags.</p>
              <div class="tag-chips" data-testid="asset-canvas-tags">${extra.map((t) => `<button type="button" class="tag-chip is-suggest" data-action="adopt-tag" data-tag="${esc(t)}" aria-label="Add the tag ${esc(t)} to this asset"${dis}>+ #${esc(t)}</button>`).join("")}</div>
            </section>`
          : "";
      })()}
      <section class="asset-sec">
        <h3>Folder</h3>
        ${
          sorted.length
            ? `<ul class="asset-folders" data-testid="asset-folders">${[`<li><label><input type="radio" name="asset-folder" data-folder=""${m.folderIds.length === 0 ? " checked" : ""}${dis}>No folder</label></li>`, ...sorted.map((f: AssetFolder) => `<li><label><input type="radio" name="asset-folder" data-folder="${f.id}"${m.folderIds[0] === f.id ? " checked" : ""}${dis}>${esc(folderPath(folders, f.id).join(" › "))}</label></li>`)].join("")}</ul>`
            : `<p class="asset-note">No folders yet. Make one with “+ Folder” in the sidebar.</p>`
        }
      </section>`;
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
    // Picking anything always shows its properties, whatever the panel button was last set to (the button is for looking at nothing).
    if (hash !== null && !ui.details && viewer.hidden) {
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
    else if (e.ctrlKey || e.metaKey || selecting) void select(hash, "toggle");
    else {
      // A click picks it and shows its details; the viewer opens from a double-click or from the picture in the details.
      if (ui.details && e.detail <= 1) autoShown = false;
      void select(hash);
    }
  });
  grid.addEventListener("dblclick", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".asset-card");
    if (!card || e.shiftKey || e.ctrlKey || e.metaKey) return;
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
    switch (b.dataset["action"]) {
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
        void session.organize(async (c) => {
          for (const h of group) await c.updateMeta(h, { favorite: on });
        });
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
          title: `Delete ${gone.length} asset${gone.length === 1 ? "" : "s"} from the library?`,
          lines: ["Their originals are erased from this browser's storage once nothing can use them any more. Assets in use are kept."],
          confirmLabel: `Delete ${gone.length}`,
        }).then(async (ok) => {
          if (ok) await session.deleteAssets(gone);
          await refresh();
          search.focus();
        });
        break;
      }
      case "close":
        if (!viewer.hidden) toggleDetails();
        else void select(null);
        break;
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
      case "untag": {
        const tag = b.dataset["tag"]!;
        void session.organize((c) => c.updateMeta(hash, { removeTags: [tag] }));
        break;
      }
      case "download":
        void downloadOriginal(assets, hash);
        break;
      case "open-tab":
        void openOriginalInTab(assets, hash);
        break;
      case "export":
        void runExport(session, { kind: "assets", hashes: [hash] });
        break;
      case "delete": {
        const e = listing?.entries.find((x) => x.hash === hash);
        void confirmDialog({
          title: `Delete “${e?.name || "Untitled"}” from the library?`,
          lines: [`Its original (${fmtBytes(e?.size ?? 0)}) is erased from this browser's storage once nothing can use it any more.`],
          confirmLabel: "Delete asset",
        }).then(async (ok) => {
          if (ok) await session.deleteAsset(hash);
          await refresh();
          search.focus();
        });
        break;
      }
    }
  });
  inspector.addEventListener("keydown", (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains("tag-input") || e.key !== "Enter" || !selected) return;
    e.preventDefault();
    const add = input.value.split(",");
    input.value = ""; // consumed; the re-render must not restore it
    if (!add.join("").trim()) return;
    // One asset, or every picked one.
    const group = input.classList.contains("bulk-tag-input") ? [...picked] : [selected];
    void session
      .organize(async (c) => {
        for (const h of group) await c.updateMeta(h, { addTags: add });
      })
      .then(() => inspector.querySelector<HTMLInputElement>(".tag-input")?.focus());
  });
  inspector.addEventListener("change", (e) => {
    const box = e.target as HTMLInputElement;
    const bulk = box.dataset["bulkFolder"];
    const put = (c: { updateMeta: (h: string, ch: { addFolders?: string[]; clearFolder?: boolean }) => Promise<unknown> }, h: string, id: string): Promise<unknown> =>
      c.updateMeta(h, id ? { addFolders: [id] } : { clearFolder: true });
    if (bulk !== undefined) {
      const group = [...picked];
      void session.organize(async (c) => {
        for (const h of group) await put(c, h, bulk);
      });
      return;
    }
    const id = box.dataset["folder"];
    if (id === undefined || !selected) return;
    const hash = selected;
    void session.organize((c) => put(c, hash, id));
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
              .map((c) => `<button type="button" role="menuitem" data-pm="canvas" data-id="${c.id}"><span class="pm-mark">${cur?.canvasId === c.id ? ICONS.check : ""}</span><span class="pm-name">${esc(c.name)}</span><small>${cur?.canvasId === c.id ? "open now" : c.objectCount ? `${c.objectCount} objects` : "empty"}</small></button>`)
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
    placeMenu.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, r.bottom + 4))}px`;
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
      const kind = b.dataset["kind"] as "folder" | "smart" | "tag" | "ctag";
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
          lines: ["It is taken off every asset that has it. The assets stay in the library."],
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
          lines: [`It is taken off ${c?.objects ?? 0} item(s) on ${c?.canvases.size ?? 0} canvas(es). The items stay. On the open canvas Undo brings it back; on the others it cannot be undone.`],
          confirmLabel: "Delete tag",
        }).then(async (ok) => {
          if (ok) await session.changeCanvasTag(label, null);
        });
      }
      return;
    }
    if (b.dataset["scope"]) {
      // Choosing the one already chosen lets go of it (back to all assets); a smart folder takes its search with it.
      const next = b.dataset["scope"];
      if (next === scope && next !== "all") {
        if (next.startsWith("smart:")) {
          search.value = "";
          usageSel.value = "all";
        }
        scope = "all";
        sideMenu = null;
        render();
        return;
      }
      scope = next;
      if (narrow.matches) sideOpen = false; // a choice on a small screen folds the list away
      sideMenu = null;
      const sf = scope.startsWith("smart:") ? listing?.smart.find((x) => `smart:${x.id}` === scope) : undefined;
      if (sf) {
        setWay(sf.way ?? "all");
        search.value = sf.search;
        usageSel.value = sf.usage;
      }
      render();
      return;
    }
    const id = b.dataset["id"] ?? "";
    switch (b.dataset["smartAction"]) {
      case "new":
        naming = { kind: "new-smart" };
        renderSide();
        return;
      case "rename":
        naming = { kind: "rename-smart", id };
        renderSide();
        return;
      case "delete":
        void session.organize((c) => c.deleteSmart(id)).then(() => {
          if (scope === `smart:${id}`) scope = "all";
        });
        return;
    }
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
          lines: ["Its subfolders are deleted too. The assets in them stay in the library; they are only taken out of these folders."],
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
      } else if (n.kind === "new-smart") {
        const id = newObjectId();
        const q = search.value;
        const u = usageSel.value as UsageFilter;
        const w = way === "all" ? undefined : way;
        void session.organize((c) => c.saveSmart(id, name, q, u, w)).then((ok) => {
          if (ok) scope = `smart:${id}`;
          else renderSide();
        });
      } else if (n.kind === "rename-smart") void session.organize((c) => c.renameSmart(n.id, name)).then(() => renderSide());
      else if (n.kind === "new") {
        const id = newObjectId();
        void session.organize((c) => c.createFolder(name, n.parent, id)).then((ok) => {
          if (!ok) renderSide();
        });
      } else void session.organize((c) => c.renameFolder(n.id, name)).then(() => renderSide());
    }
  });

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
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
      if (target?.closest?.("select, .assets-bar, .assets-side")) return; // arrows belong to a menu, the bar and the sidebar
      if (moveBy(e)) e.preventDefault();
    }
  });
  // ---- the list's columns: drag a header onto another to move it
  const listHead = root.querySelector<HTMLElement>(".assets-list-head")!;
  let dragCol: ColumnId | null = null;
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
    colPop.style.top = `${Math.round(r.bottom + 6)}px`;
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
  const PLACE: Record<Way, string> = { all: "Search name, type or tag", name: "Search by name", tag: "Search by tag" };
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
    if (scope.startsWith("smart:")) scope = "all"; // the query is no longer the saved one
    paintSearchUi();
    render();
  };
  setWay("all");
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
      if (el !== sortSel && scope.startsWith("smart:")) scope = "all"; // the query is no longer the saved one
      render();
    });
  }
  sizeInput.addEventListener("input", () => grid.style.setProperty("--thumb", `${sizeInput.value}px`));
  importBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = "";
    void view.importFiles(files);
  });

  // Notices are shown by the notice stack over every view; the view keeps the last one as text for screen readers and tests.
  notices.subscribe((text) => {
    if (visible) status.textContent = text;
  });
  session.subscribeAssets(() => void refresh());
  session.subscribe(() => void refresh()); // tree renamed, role changed

  const view: AssetsView = {
    show() {
      visible = true;
      root.hidden = false;
      status.textContent = "";
      syncImmersive();
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
      syncImmersive();
    },
    async importFiles(files) {
      if (session.editor.blockEdit()) return;
      let n = 0;
      const seen: Array<{ name: string; duplicate: "present" | "restored" }> = [];
      let done = 0;
      for (const f of files) {
        done++;
        session.editor.message = files.length > 1 ? `Importing ${done} of ${files.length}…` : `Importing ${f.name || "file"}…`;
        session.editor.changed();
        try {
          const { record, duplicate } = await assets.importFileDetailed(f);
          if (duplicate) seen.push({ name: record.name || f.name, duplicate });
          n++;
        } catch (e) {
          session.editor.message = `Could not import ${f.name || "file"}: ${(e as Error).message}`;
          session.editor.changed();
        }
      }
      session.editor.progressDone.add("import");
      session.editor.changed();
      if (n) {
        const notice = duplicateNotice(seen, n);
        session.editor.message = !notice ? `Imported ${n} file(s) into the library.` : seen.length === n ? notice : `${n - seen.length} new file(s) imported. ${notice}`;
        session.editor.changed();
      }
      await refresh();
    },
  };
  return view;
}
