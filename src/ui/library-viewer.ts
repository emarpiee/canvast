import { FileHistory, wireNav } from "./file-history";
import { nextNoteZoom } from "./file-views";
import { groundFill } from "../assets/card";
import { desktopBridge } from "../storage/desktop-bridge";
import type { LinkCards, LinkRow } from "../app/session";
import type { Session, AssetPlace } from "../app/session";
import { rowOf } from "./library-layout";
import { keepFrame } from "../app/frames";
import { artFullPicture, isArtFile } from "../assets/art-preview";
import { externalFolder } from "../storage/external-folder";
import { AUTO_COPY_NOTE, describeFile, hasThumb, isAutoCopy, isCard, isFontFile } from "../assets/file-kind";
import { FONT_SAMPLES, fontSampleHtml, showFont } from "./font-specimen";
import { moved, type SavedLook } from "../search/saved";
import type { AssetLibrary } from "../assets/asset-library";
import type { CatalogListing } from "../assets/asset-catalog";
import { meta } from "../assets/asset-catalog";
import { THUMB_PX } from "../assets/thumb";
import type { AssetRecord } from "../assets/asset-library";
import { ICONS } from "./icons";
import { clearRect } from "./more-menu";
import { commands } from "../commands/registry";
import type { ChooserView } from "./tree-chooser";
import { capList, showMoreButton } from "./show-more";
import { esc, fmtBytes } from "./format";
import { viewKindOf } from "./file-views";
import { placeCardViews, placeLinesBeside } from "../app/actions";
import type { CardLook, FileViewKind, OpenView, ViewDeps, ViewPlace } from "./file-views";
import { noteKindOf } from "../notes/note-file";
import { hasAlpha } from "./alpha";
import { VIEW_GROUNDS, type ViewGround } from "../storage/workspace-repo";
import type { Engine } from "./media-player";
import { avEngine, gifEngine } from "./media-player";
import { mountPlayerControls } from "./player-controls";
import type { ImageObject } from "../doc/model";
import type { SettingsStore } from "../settings/settings";
import { DETAIL_LINKS_SHOWN, SIDE_SORTS, syncChildren, TYPING } from "./assets-view";
import type { AssetsView, ColumnId, SideSort } from "./assets-view";
import { classWhen } from "./class-when";

const FILM_OVERSCAN = 12;

const LINKS_RETRY_MS = 800;



/** Fields that take typed text: shortcuts keep out of them (a checkbox or a slider is not one). */
const ZOOM_STEP = 1.25;

/**
 * The Library's viewer (moved out of assets-view.ts, B34): an item large in the Library's own window, its details beside it and its
 * controls below; a note opens in the notes editor in its place; zoom, the filmstrip and the slideshow. It reads what it needs of the
 * Library through `ctx` (its getters read the Library's own variables, its setters write them) and gives the Library what it returns.
 */
export interface ViewerCtx {
  /** Its back and forward history's place ("viewer"); none for a Pins window's viewer. */
  readonly navPlace?: string | undefined;
  /** The name of the folder an item is filed in (none: not filed), for the viewer's header. */
  readonly folderNameOf?: (hash: string) => string | null;
  anchor: string | null;
  readonly applyUi: () => void;
  readonly assets: AssetLibrary;
  readonly body: HTMLElement;
  readonly ensure: (hashes: readonly string[]) => Promise<void>;
  readonly entryOf: (hash: string) => CatalogListing["entries"][number] | undefined;
  readonly fileTile: (e: { name: string; type: string; }, note?: boolean) => string;
  readonly film: HTMLElement;
  filmOf: string[] | null;
  readonly filtered: () => string[];
  readonly hiddenMode: boolean;
  readonly inspector: HTMLElement;
  readonly loadThumb: (img: HTMLImageElement) => void;
  readonly markPicked: () => void;
  readonly mine: () => boolean;
  readonly openLists: Set<string>;
  readonly picked: Set<string>;
  places: AssetPlace[];
  readonly refresh: (metaOnly?: boolean) => Promise<void>;
  readonly renderInspector: () => void;
  readonly revealHash: (hash: string, block: "nearest" | "center") => HTMLElement | null;
  readonly root: HTMLElement;
  readonly saveUi: () => void;
  selected: string | null;
  readonly session: Session;
  readonly settings: SettingsStore;
  readonly showCanvas: () => void;
  readonly syncViewing: () => void;
  readonly thumbFor: (hash: string, wanted?: () => boolean, urgent?: boolean) => Promise<string>;
  readonly ui: { details: boolean; bar: boolean; layout: "grid" | "list"; order: ColumnId[]; hidden: ColumnId[]; closed: string[]; folded: string[]; opened: string[]; chooser: ChooserView; tagsInline: boolean; sideSort: Record<keyof typeof SIDE_SORTS, SideSort>; pinned: string[]; expanded: string[]; sections: string[]; detailSections: string[]; views: Record<string, SavedLook>; filters: { usage: string; sort: string; reversed: boolean; scope: string; }; colW: Partial<Record<ColumnId, number>>; thumb: number | null; listThumb: number; fontSample: number; fontTry: string; sheetH: number | null; sideW: number | null; inspW: number | null; };
  readonly view: AssetsView;
  readonly viewer: HTMLElement;
  readonly visible: boolean;
  readonly want: (hashes: Iterable<string>) => void;
}

export function mountLibraryViewer(ctx: ViewerCtx) {
  // ---- viewer: the original in the library's own window, with the details beside it and the controls below (both can be hidden)
  const slideImg = ctx.viewer.querySelector<HTMLImageElement>("img")!;
  const slideMedia = ctx.viewer.querySelector<HTMLVideoElement>("video")!;
  const slideCaption = ctx.viewer.querySelector<HTMLElement>("figcaption")!;
  classWhen(ctx.viewer, "has-note-caption", () => slideCaption.classList.contains("is-note"), [slideCaption], ["class"]); // (room under it for the words)
  const slideTile = document.createElement("div");
  slideTile.className = "viewer-tile";
  slideTile.hidden = true;
  slideImg.after(slideTile);
  // ---- notes: a markdown or plain text note opens in the notes editor in place of a picture (note-session.ts: the same as
  // the canvas's note panel; the library gives it its own import, its viewer and its selection)
  const noteBox = document.createElement("div");
  noteBox.className = "viewer-note";
  noteBox.dataset["testid"] = "note-editor";
  noteBox.hidden = true;
  ctx.viewer.querySelector(".viewer-stage")!.append(noteBox);
  let note: OpenView | null = null;
  /** What the open view shows of an item, as a card: what Place puts on a canvas (the page or view in sight, not the first). */
  const cardInView = (hash: string): CardLook | undefined => (note?.hash === hash ? note.card?.() : undefined);
  const noteDeps: ViewDeps = { session: ctx.session, assets: ctx.assets, settings: ctx.settings };
  const notePlace: ViewPlace = {
    importFiles: (files) => ctx.view.importFiles(files),
    show: (hash) => showSlide(hash),
    showCanvas: ctx.showCanvas,
    moved: (from, to) => {
      if (slideHash === from) slideHash = to;
      if (ctx.selected === from) ctx.selected = ctx.anchor = to;
      if (ctx.picked.delete(from)) ctx.picked.add(to);
    },
    refresh: () => ctx.refresh(),
    hidden: () => ctx.hiddenMode,
    placeLines: (svg, size) => {
      const hash = note?.hash;
      if (!hash) return;
      void leaveNote().then(async (ok) => {
        if (!ok) return;
        const id = await ctx.session.placeAsset(hash);
        const o = id ? ctx.session.doc.get(id) : undefined;
        if (o?.kind !== "image") return;
        closeSlide();
        ctx.showCanvas();
        placeLinesBeside(ctx.session.doc, ctx.session.editor, ctx.session.view, o, svg, size);
      });
    },
    // (from the library, a first card is placed for them to stand beside)
    placeViews: (items) => {
      const hash = note?.hash;
      if (!hash) return;
      void leaveNote().then(async (ok) => {
        if (!ok) return;
        const id = await ctx.session.placeAsset(hash);
        const o = id ? ctx.session.doc.get(id) : undefined;
        if (o?.kind !== "image") return;
        closeSlide();
        ctx.showCanvas();
        ctx.session.editor.select(placeCardViews(ctx.session.doc, o, items).map((c) => c.id));
        ctx.session.editor.changed();
      });
    },
  };
  /** The link cards of the item described: what links to it (Linked from) and, for a note, what it links to (Links). Each row opens in the viewer. */
  let lastLinks: { hash: string; hiddenMode: boolean; cards: LinkCards } | null = null;
  const paintLinks = (hash: string, cards: LinkCards): void => {
    const name = ctx.entryOf(hash)?.name ?? "";
    const kind = noteKindOf(name);
    const isNote = kind === "md";
    const rowOf = (r: LinkRow): string => `<li><button type="button" class="asset-link-row assets-link" data-action="open-linked" data-hash="${r.hash}" title="Open “${esc(r.name)}”">${ICONS.fileIcon}<span class="asset-place-name">${esc(r.name)}${r.folder ? `<small class="asset-link-folder">${esc(r.folder)}</small>` : ""}</span></button></li>`;
    const fill = (testid: string, shown: boolean, count: number, list: string, rows: string[], empty: string): void => {
      const sec = ctx.inspector.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
      if (!sec) return;
      sec.hidden = !shown;
      sec.querySelector<HTMLElement>("[data-count]")!.textContent = String(count);
      const cap = capList(rows, DETAIL_LINKS_SHOWN, ctx.openLists.has(list));
      sec.querySelector("ul")!.innerHTML = cap.shown.join("");
      sec.querySelector(".show-more")?.remove();
      sec.querySelector(".asset-note")?.remove();
      if (!rows.length) sec.insertAdjacentHTML("beforeend", `<p class="asset-note">${empty}</p>`);
      if (cap.long) sec.insertAdjacentHTML("beforeend", showMoreButton({ open: ctx.openLists.has(list), hidden: cap.hidden, attrs: `data-action="show-more" data-list="${list}" data-testid="${testid}-more"` }));
    };
    fill("asset-backlinks", isNote || cards.from.length > 0, cards.from.length, "links", cards.from.map(rowOf), "No notes link here.");
    const lost = cards.missing.map((m) => `<li class="asset-link-missing" title="Nothing in the library has this name">${ICONS.fileIcon}<span class="asset-place-name">${esc(m)}</span></li>`);
    fill("asset-outlinks", isNote, cards.to.length + cards.missing.length, "out", [...cards.to.map(rowOf), ...lost], "This note links to nothing.");
  };
  /** A note's footnotes in its details (an outline of them, as notes apps keep one): each row goes to its words in the note. */
  const fillFootnotes = async (hash: string): Promise<void> => {
    const sec = ctx.inspector.querySelector<HTMLElement>('[data-testid="asset-footnotes"]');
    if (!sec) return;
    if (noteKindOf(ctx.entryOf(hash)?.name ?? "") !== "md") return void (sec.hidden = true);
    const words = await ctx.assets.record(hash).then((r) => r?.blob.text(), () => undefined);
    if (words === undefined || ctx.inspector.dataset["hash"] !== hash) return;
    const defs = [...words.matchAll(/^\[\^([^\]\s]+)\]:[ \t]?(.*)$/gm)];
    sec.hidden = !defs.length;
    sec.querySelector<HTMLElement>("[data-count]")!.textContent = String(defs.length);
    sec.querySelector("ul")!.innerHTML = defs.map((m) => `<li><button type="button" class="asset-link-row assets-link" data-action="go-footnote" data-fn="${esc(m[1]!)}" title="Go to footnote ${esc(m[1]!)}"><span class="asset-place-total">${esc(m[1]!)}</span><span class="asset-place-name">${esc(m[2]!.slice(0, 120))}</span></button></li>`).join("");
  };
  // (the details draw many times over one change: one lookup at a time, and one more after it for what came meanwhile)
  let linksBusy = false;
  let linksNext: string | null = null;
  const fillLinks = async (hash: string, again = false): Promise<void> => {
    void fillFootnotes(hash);
    if (lastLinks?.hash === hash && lastLinks.hiddenMode === ctx.hiddenMode && ctx.inspector.dataset["hash"] === hash) paintLinks(hash, lastLinks.cards); // (at once, so a card does not go and come back)
    if (linksBusy) return void (linksNext = hash);
    linksBusy = true;
    const cards = await ctx.session.linkCards(hash, ctx.hiddenMode).catch(() => null);
    linksBusy = false;
    if (linksNext !== null) {
      const next = linksNext;
      linksNext = null;
      void fillLinks(next);
    }
    if (ctx.inspector.dataset["hash"] !== hash) return; // (the details moved on: they have their own)
    if (!cards) {
      if (!again) window.setTimeout(() => void fillLinks(hash, true), LINKS_RETRY_MS); // (the storage busy, right after a save)
      return;
    }
    lastLinks = { hash, hiddenMode: ctx.hiddenMode, cards };
    paintLinks(hash, cards);
  };
  let noteZoom = 1; // (for this session, from note to note)
  const openView = async (kind: FileViewKind, hash: string, name: string, blob: Blob, token: number): Promise<void> => {
    if (token !== slideToken) return;
    slideImg.hidden = true;
    ctx.viewer.classList.add("is-note");
    const box = document.createElement("div");
    noteBox.replaceChildren(box);
    noteBox.hidden = false;
    slideCaption.textContent = "";
    noteBox.toggleAttribute("data-testid", kind.id === "note");
    if (kind.id === "note") noteBox.dataset["testid"] = "note-editor";
    let opened: OpenView;
    try {
      opened = await kind.open(box, { hash, name, blob }, noteDeps, notePlace);
    } catch (e) {
      if (token !== slideToken) return; // (the viewer moved on meanwhile: the next item has the stage, and took the panel down)
      noteBox.hidden = true;
      ctx.viewer.classList.remove("is-note");
      slideImg.hidden = false;
      slideCaption.textContent = `${name}. This ${kind.noun} could not be opened: ${(e as Error).message}.`;
      // (its file's card, and why it is not more)
      slideImg.hidden = true;
      slideTile.innerHTML = ctx.fileTile({ name, type: blob.type });
      slideTile.hidden = false;
      slideCaption.classList.add("is-note");
      return;
    }
    // (opened after the viewer moved on: closed, and its panel left down, as the next item's start took it down)
    if (token !== slideToken) return opened.close(false);
    note = opened;
    paintNoteZoom();
    // (the details were drawn before the view was open: drawn again, with its Bookmark button, which needs the view's place)
    if (kind.marks) ctx.renderInspector();
  };
  /** Before the note is left (another item, Back, Esc): its changes are saved or let go, or it stays open. Whether to go on. */
  const leaveNote = (): Promise<boolean> => (note ? note.leave() : Promise.resolve(true));
  /**
   * Close the note or file view (changes still unsaved are saved without losing anything, see OpenNote.close), and take its panel down
   * always: also one still opening when the viewer moved on, which is not the note yet and would cover every later item.
   */
  const unloadNote = (): void => {
    const n = note;
    note = null;
    ctx.viewer.classList.remove("is-note");
    noteBox.hidden = true;
    paintZoom();
    n?.close(!!ctx.entryOf(n.hash));
    noteBox.replaceChildren();
  };
  const pos = ctx.viewer.querySelector<HTMLElement>(".viewer-pos")!;
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
  /** The assets the viewer steps through, in order, with where each one is (worked out once per list, not on every step). */
  let viewMemo: { rows: string[]; set: Set<string> | null; list: string[]; at: Map<string, number> } | null = null;
  const viewList = (): { list: string[]; at: Map<string, number> } => {
    const rows = ctx.filtered();
    if (viewMemo?.rows !== rows || viewMemo.set !== slideSet) {
      const list = slideSet ? rows.filter((h) => slideSet!.has(h)) : rows;
      viewMemo = { rows, set: slideSet, list, at: new Map(list.map((h, i) => [h, i])) };
    }
    return viewMemo;
  };
  // The filmstrip: the whole list scrolls, but only the items near the view are in the page; two spacers stand for the rest.
  const filmBefore = document.createElement("span");
  const filmWin = document.createElement("span");
  const filmAfter = document.createElement("span");
  filmBefore.className = filmAfter.className = "film-spacer";
  filmWin.className = "film-win";
  const filmMounted = new Map<string, HTMLElement>();
  let filmRange: [number, number] = [0, 0];
  let filmPitch = 0;
  let filmItemW = 0;
  const filmItem = (hash: string): HTMLElement => {
    const e = ctx.entryOf(hash);
    const t = document.createElement("template");
    if (!e) {
      ctx.want([hash]); // (drawn again once its details are here)
      t.innerHTML = `<button type="button" class="film-item thumb-slot" role="option" data-hash="${hash}" aria-label="Loading"></button>`;
      return t.content.firstElementChild as HTMLElement;
    }
    t.innerHTML = `<button type="button" class="film-item thumb-slot" role="option" data-hash="${e.hash}" aria-label="${esc(e.name || "Untitled")}" title="${esc(e.name || "Untitled")}">${!hasThumb(e) && !meta(e).thumb ? ctx.fileTile(e, false) : `<img alt="" draggable="false" data-hash="${e.hash}"${isFontFile(e) ? ' class="is-font-thumb"' : ""}>`}</button>`;
    const b = t.content.firstElementChild as HTMLElement;
    const img = b.querySelector<HTMLImageElement>("img");
    if (img) ctx.loadThumb(img);
    return b;
  };
  /** Greyscale in the viewer: a look at the picture only, gone with the next item or on closing. */
  const setGrey = (on: boolean): void => {
    ctx.viewer.classList.toggle("is-grey", on);
    ctx.viewer.querySelector<HTMLElement>(".viewer-grey")!.setAttribute("aria-pressed", String(on));
  };
  const windowFilm = (force = false): void => {
    if (!ctx.film.clientWidth) return; // (with the controls hidden it has no width: drawn when they come back)
    const { list } = viewList();
    if (!list.length) {
      filmWin.replaceChildren();
      filmMounted.clear();
      filmBefore.hidden = filmAfter.hidden = true;
      return;
    }
    if (!filmPitch) {
      const probe = filmItem(list[0]!);
      filmWin.append(probe);
      filmItemW = probe.getBoundingClientRect().width;
      probe.remove();
      filmPitch = filmItemW + (parseFloat(getComputedStyle(ctx.film).columnGap) || 0);
    }
    const n = list.length;
    const pad = parseFloat(getComputedStyle(ctx.film).paddingLeft) || 0;
    const first = filmPitch > 0 ? Math.max(0, Math.floor((ctx.film.scrollLeft - pad) / filmPitch) - FILM_OVERSCAN) : 0;
    const end = filmPitch > 0 ? Math.min(n, first + Math.ceil(ctx.film.clientWidth / filmPitch) + 2 * FILM_OVERSCAN) : n;
    if (!force && first === filmRange[0] && end === filmRange[1]) return;
    filmRange = [first, end];
    const space = (el: HTMLElement, k: number): void => {
      el.hidden = k === 0;
      el.style.width = `${k * filmPitch - (filmPitch - filmItemW)}px`;
    };
    space(filmBefore, first);
    space(filmAfter, n - end);
    const keep = new Map<string, HTMLElement>();
    const els: HTMLElement[] = [];
    for (let i = first; i < end; i++) {
      const h = list[i]!;
      const old = filmMounted.get(h);
      const el = old && (old.getAttribute("aria-label") !== "Loading" || !ctx.entryOf(h)) ? old : filmItem(h);
      keep.set(h, el);
      els.push(el);
    }
    syncChildren(filmWin, els);
    filmMounted.clear();
    for (const [h, el] of keep) filmMounted.set(h, el);
    markFilmItems();
  };
  const markFilmItems = (): void => {
    for (const [h, b] of filmMounted) {
      const on = h === slideHash;
      b.classList.toggle("is-current", on);
      b.setAttribute("aria-selected", String(on));
    }
  };
  let filmFrame = 0;
  ctx.film.addEventListener("scroll", () => (filmFrame ||= requestAnimationFrame(() => ((filmFrame = 0), windowFilm()))), { passive: true });
  /** Put the open asset in the middle of the filmstrip. */
  const centreFilm = (): void => {
    const { list, at } = viewList();
    const i = at.get(slideHash ?? "") ?? -1;
    pos.textContent = i >= 0 ? `${i + 1} of ${list.length}` : "";
    windowFilm(); // (first the strip takes its whole length: scrolled before that, a strip drawn again stopped near its start)
    if (i >= 0 && filmPitch > 0) ctx.film.scrollLeft = (parseFloat(getComputedStyle(ctx.film).paddingLeft) || 0) + i * filmPitch - (ctx.film.clientWidth - filmItemW) / 2;
    windowFilm(true);
  };
  const renderFilm = (): void => {
    if (!ctx.film.contains(filmWin)) ctx.film.replaceChildren(filmBefore, filmWin, filmAfter);
    // Items made for an older list may show other names or pictures: start again.
    filmWin.replaceChildren();
    filmMounted.clear();
    filmPitch = 0;
    ctx.filmOf = viewList().list;
    centreFilm();
  };
  const markFilm = (): void => centreFilm();
  // ---- zoom: the wheel (or a pinch) zooms at the pointer, a drag pans, a double-click toggles Fit and 100%, + - 0 1 work from the keyboard
  const stage = ctx.viewer.querySelector<HTMLElement>(".viewer-stage")!;
  // Video, audio and GIF play with the same engines and control bar as the on-canvas player (ADR 0064).
  const slideGif = ctx.viewer.querySelector<HTMLCanvasElement>(".viewer-gif")!;
  const slideVec = ctx.viewer.querySelector<HTMLCanvasElement>(".viewer-vec")!;
  // The controls lie over the bottom of the stage: the button that hides them floats just above them, wherever their height goes (a phone has two rows).
  const controlsBar = ctx.viewer.querySelector<HTMLElement>(".viewer-bar")!;
  new ResizeObserver(() => controlsBar.offsetHeight && ctx.viewer.style.setProperty("--viewer-bar-h", `${controlsBar.offsetHeight}px`)).observe(controlsBar); // (not while it is hidden: the strip keeps its size)
  /** The open picture is an SVG: it is drawn again at every zoom, on `slideVec`, so it is crisp at any size (the img only gives its size). */
  let vector = false;
  const avEng = avEngine(slideMedia);
  const gifEng = gifEngine(slideGif);
  const controls = mountPlayerControls(stage, ctx.settings, {
    extract: () => void extractFrame(),
  });
  let eng: Engine | null = null;
  const unloadMedia = (): void => {
    eng?.pause();
    avEng.unload();
    gifEng.unload();
    eng = null;
    controls.hide();
    clearTimeout(idleTimer);
    ctx.viewer.classList.remove("is-idle");
    slideMedia.hidden = true;
    slideGif.hidden = true;
  };
  /**
   * Extract frame: the picture on screen now becomes a new PNG file in the library, and is placed on the open canvas too only when
   * Settings > Saving to the library says so (off by default: the library does not change a canvas by itself). The picture may not be presented yet (a seek just landed): a few tries.
   */
  const extractFrame = async (): Promise<void> => {
    const engine = eng;
    const at = slideHash;
    if (!engine || !at || ctx.session.editor.blockEdit()) return;
    let png: Blob | null = null;
    for (let i = 0; i < 4 && !png; i++) {
      png = await engine.frame().catch(() => null);
      if (!png) await new Promise((r) => setTimeout(r, 250));
    }
    if (!png || eng !== engine) return;
    const src = ctx.entryOf(at);
    // The name, format, folder and tags come from Settings > Saving to the library (ADR 0081).
    await keepFrame(ctx.assets, ctx.session, ctx.settings, { png, label: engine.label(), sourceName: src?.name ?? "frame", sourceHash: at }, "Frame");
    await ctx.refresh();
  };
  // The player floats over the picture: while the pointer rests it fades away after Settings > Library (Hide the player),
  // playing or paused, also with the pointer resting on it; only a move of the mouse, a click or a touch brings it back. Keys (step,
  // play and pause, seek) leave it as it is.
  let idleTimer = 0;
  const wake = (): void => {
    ctx.viewer.classList.remove("is-idle");
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => eng && ctx.viewer.classList.add("is-idle"), ctx.settings.get("assets.playerHideSeconds") * 1000);
  };
  for (const type of ["pointermove", "pointerdown"]) ctx.viewer.addEventListener(type, wake, true);
  /** What a loaded file needs of the object the canvas player takes: where to start, and whether to loop. */
  const playOf = (repeat: boolean): ImageObject => ({ media: { t: 0, repeat } }) as unknown as ImageObject;
  const zoomPct = ctx.viewer.querySelector<HTMLElement>(".viewer-zoom-pct")!;
  const zoom = { s: 1, x: 0, y: 0 };
  const checker = ctx.viewer.querySelector<HTMLElement>(".viewer-checker")!;
  /** The open picture has see-through pixels. */
  let slideAlpha = false;
  slideImg.addEventListener("load", () => {
    slideAlpha = hasAlpha(slideImg);
    ctx.viewer.classList.toggle("has-alpha", slideAlpha);
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
  const GROUND_NAME: Record<ViewGround, string> = { checker: "chequered", gray: "neutral grey", black: "black", white: "white", auto: "the theme's colour" };
  /** The button that cycles the ground under see-through pictures says which one it is now and which comes next. */
  const labelGround = (): void => {
    const now = ctx.session.viewGround;
    const next = VIEW_GROUNDS[(VIEW_GROUNDS.indexOf(now) + 1) % VIEW_GROUNDS.length]!;
    const b = ctx.viewer.querySelector<HTMLElement>(".viewer-ground")!;
    b.title = `Background of see-through pictures: ${GROUND_NAME[now]} (click for ${GROUND_NAME[next]})`;
    b.setAttribute("aria-label", `Background of see-through pictures: ${GROUND_NAME[now]}. Next: ${GROUND_NAME[next]}`);
    b.dataset["ground"] = now;
    ctx.root.dataset["ground"] = now; // (a font's samples in the viewer and the details lie on it too)
  };
  /** The button that goes through a font's sample sentences says which comes next. */
  const labelSample = (): void => {
    const next = FONT_SAMPLES[(ctx.ui.fontSample + 1) % FONT_SAMPLES.length]!;
    const b = ctx.viewer.querySelector<HTMLElement>(".viewer-sample")!;
    b.title = `Sample text (click for “${next}”)`;
    b.setAttribute("aria-label", `Sample text. Next: ${next}`);
  };
  const paintVector = (): void => {
    labelGround();
    const font = ctx.viewer.classList.contains("is-font");
    const ground = font || (!vector && !slideImg.hidden && slideAlpha && slideGif.hidden && slideMedia.hidden); // (a see-through picture or a font: only the chequered ground)
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
    if (!font && (!z || !slideImg.complete)) return;
    const base = slideImg.getBoundingClientRect(); // (a raster picture is scaled by a transform: its box already holds the zoom and the pan)
    const dw = z ? z.fw * zoom.s : 0;
    const dh = z ? ((z.fw * z.nh) / z.nw) * zoom.s : 0;
    const x = base.left + base.width / 2 - sr.left + (vector ? zoom.x : 0) - dw / 2;
    const y = base.top + base.height / 2 - sr.top + (vector ? zoom.y : 0) - dh / 2;
    g.fillStyle = groundFill(g, ctx.session.viewGround, Math.max(2, Math.round(16 * dpr)));
    g.fillRect(0, 0, w, h);
    if (vector) g.drawImage(slideImg, x * dpr, y * dpr, dw * dpr, dh * dpr);
  };
  window.addEventListener("resize", paintVector);
  // The stage changes size when the controls are hidden or shown (and with the window): the picture is fitted and drawn again for its new size, so an SVG is never a stale bitmap stretched to fit.
  new ResizeObserver(() => paintZoom()).observe(stage);
  const paintZoom = (): void => {
    if (note) return note.zoom ? undefined : paintNoteZoom();
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
    ctx.viewer.classList.toggle("is-zoomed", zoom.s !== 1);
    paintVector();
  };
  /** The zoom control and its keys are one, for a picture and for a note: a note's text is drawn bigger, its pictures keep their size and its file does not change. */
  const paintNoteZoom = (): void => {
    noteBox.style.setProperty("--note-zoom", String(noteZoom));
    zoomPct.textContent = `${Math.round(noteZoom * 100)}%`;
  };
  const zoomStep = (dir: 1 | -1 | 0): void => {
    if (note?.zoom) note.zoom(dir);
    else if (note) {
      noteZoom = nextNoteZoom(noteZoom, dir);
      paintNoteZoom();
    } else if (dir === 0) resetZoom();
    else zoomAt(zoom.s * ZOOM_STEP ** dir, ...centre());
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
      if (note && e.ctrlKey) { // (a note's wheel scrolls its words)
        e.preventDefault();
        zoomStep(e.deltaY < 0 ? 1 : -1);
        return;
      }
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
    if (zoom.s !== 1) ctx.viewer.classList.add("is-grabbing");
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
    ctx.viewer.classList.remove("is-grabbing");
    pointers.delete(e.pointerId);
    pinch = 0;
  };
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);
  // view-state: (the viewer's zoom)
  stage.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest("button, .viewer-zoom")) return;
    toggleActual(e.clientX, e.clientY);
  });
  // view-state: (the viewer's zoom)
  ctx.viewer.querySelector<HTMLElement>(".viewer-zoom")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-zoom]");
    if (!b) return;
    if (b.dataset["zoom"] === "in") zoomStep(1);
    else if (b.dataset["zoom"] === "out") zoomStep(-1);
    else if (note) zoomStep(0);
    else toggleActual();
  });
  for (const m of [slideImg, slideMedia]) {
    m.addEventListener("load", paintZoom);
    m.addEventListener("loadedmetadata", paintZoom);
  }

  /**
   * An item saved again (by PhotoCraft or another program) is a new item: the viewer on it stays, on the new version. The library may list
   * it before it says which item it replaces, so a viewer just closed for the old one opens again on the new.
   */
  const versionOf = new Map<string, string>();
  let goneAt: { hash: string; at: number } | null = null;
  ctx.session.onVersion((from, to) => {
    if (!ctx.root.isConnected) return;
    versionOf.set(from, to);
    if (slideHash === from && !ctx.viewer.hidden) void showSlide(to);
    else if (goneAt?.hash === from && performance.now() - goneAt.at < 5000 && ctx.viewer.hidden) void showSlide(to);
    goneAt = null;
  });
  /** Back and forward through the items shown here (file-history.ts): every item shown is a step, by a link, the strip or the arrows. */
  const history = ctx.navPlace ? new FileHistory(ctx.navPlace, { show: async (h) => (await showSlide(h), slideHash === h && !ctx.viewer.hidden), root: () => ctx.viewer }) : null;
  if (history) (history.listen(ctx.viewer), wireNav(ctx.viewer, history));
  const showSlide = async (hash: string): Promise<void> => {
    if (!ctx.entryOf(hash)) await ctx.ensure([hash]).catch(() => undefined); // (a long library: what a link points at need not be on a page read yet)
    if (!ctx.entryOf(hash)) {
      // (a note just saved as a new version is not listed yet, and shows by itself when it is: only what is really gone is said)
      if (!(await ctx.session.catalog?.entry(hash).catch(() => undefined))) {
        ctx.session.editor.message = "That item is no longer in the library.";
        ctx.session.editor.changed();
      }
      return;
    }
    const e = ctx.entryOf(hash)!;
    if (!(await leaveNote())) return;
    const token = ++slideToken;
    const opening = ctx.viewer.hidden;
    if (hash !== slideHash) setGrey(false);
    resetZoom();
    slideHash = hash;
    history?.visit(hash);
    // (its place and name in the header: the folder it is filed in, then its name)
    const crumb = ctx.viewer.querySelector<HTMLElement>(".viewer-crumb");
    if (crumb) {
      const folder = ctx.folderNameOf?.(hash);
      crumb.textContent = folder ? `${folder} / ${e.name}` : e.name;
      crumb.title = crumb.textContent;
    }
    ctx.body.classList.add("is-viewing");
    ctx.root.classList.add("is-viewing");
    ctx.viewer.hidden = false;
    ctx.syncViewing();
    ctx.viewer.focus();
    // The details beside the viewer describe the open asset (a picked set stays picked while a slideshow plays through it).
    ctx.selected = hash;
    if (!slideSet) {
      ctx.picked.clear();
      ctx.picked.add(hash);
    } else ctx.picked.add(hash);
    ctx.anchor = hash;
    const found = await ctx.session.assetPlaces(hash);
    // The library and the details follow the selection even if the viewer has been closed or moved on while the places were read.
    if (ctx.selected === hash) ctx.places = found;
    ctx.markPicked();
    ctx.renderInspector();
    if (token !== slideToken) return;
    const fav = ctx.viewer.querySelector<HTMLElement>('[data-act="favorite"]')!;
    fav.setAttribute("aria-pressed", String(meta(e).favorite));
    ctx.viewer.querySelector<HTMLButtonElement>('[data-act="place"]')!.disabled = !e.present || ctx.session.readOnly;
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
    unloadNote();
    vector = false;
    slideVec.hidden = true;
    slideImg.classList.remove("is-vector");
    slideImg.hidden = false;
    slideTile.hidden = true;
    slideAlpha = false;
    ctx.viewer.classList.remove("is-font", "has-alpha");
    checker.hidden = true;
    // A video or a sound plays from its address where there is one (a file of the workspace folder, read a part at a time as it plays):
    // the whole file is not read into the page first, which took a long film most of a minute.
    const stream = e.present && /^(video|audio)\//.test(e.type) ? ((await ctx.session.storage?.originals.mediaUrl(hash).catch(() => null)) ?? null) : null;
    const rec = e.present ? (stream ? ({ hash, name: e.name, type: e.type, size: e.size, blob: new Blob([]) } as AssetRecord) : await ctx.assets.record(hash).catch(() => undefined)) : undefined;
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
    const thumbnail = async (why = "The file is missing or damaged"): Promise<void> => {
      vector = false;
      slideVec.hidden = true;
      slideImg.classList.remove("is-vector");
      slideCaption.textContent = `${label}. ${why}; showing its thumbnail.`;
      slideCaption.classList.add("is-note");
      slideImg.src = await ctx.thumbFor(hash).catch(() => "");
    };
    if (!rec) return void (await thumbnail());
    const kind = await viewKindOf({ hash, name: rec.name, blob: rec.blob });
    if (kind) return void (await openView(kind, hash, rec.name, rec.blob, token));
    // How the stage shows a file that opens in no view of its own, the first that claims it. (A kind that opens in a view of its own is a row of ui/file-views.ts.)
    let art: Blob | null = null;
    const stageKinds: ReadonlyArray<{ claims(): boolean | Promise<boolean>; show(): Promise<void> }> = [
      { claims: () => isFontFile(rec), show: async () => {
        // A font: its sample, in its own letters, at several sizes.
        slideImg.hidden = true;
        slideTile.innerHTML = fontSampleHtml(rec.name, true, FONT_SAMPLES[ctx.ui.fontSample], ctx.ui.fontTry);
        slideTile.hidden = false;
        slideAlpha = true; // (its letters lie on the same ground as a see-through picture)
        ctx.viewer.classList.add("is-font", "has-alpha");
        labelSample();
        paintVector();
        slideCaption.textContent = `${e.name || "Untitled"}, ${fmtBytes(e.size)}`;
        void showFont(slideTile.querySelector<HTMLElement>(".font-sample")!, hash, async () => rec.blob);
        armShow();
        return;
      } },
      { claims: () => isCard(rec) && !!meta(e).thumb, show: async () => {
        // Not something the browser can show, with a custom thumbnail: that picture, and what it is.
        slideTile.hidden = true;
        slideImg.hidden = false;
        slideImg.src = await ctx.thumbFor(hash).catch(() => "");
        slideCaption.textContent = `${label}. No preview for this kind of file: this is its custom thumbnail.`; // (for a screen reader: on screen nothing takes room from the picture)
        armShow();
        return;
      } },
      { claims: async () => !!(art = isCard(rec) && isArtFile(rec.name) ? await artFullPicture(await externalFolder.fileOf(rec), rec.name).catch(() => null) : null), show: async () => {
        // An art file: the picture it keeps, and what it is. Its layers stay its program's; the size in its record is its card's, so neither limits nor names the picture.
        slideTile.hidden = true;
        slideImg.hidden = false;
        slideImg.style.maxWidth = "";
        slideImg.style.maxHeight = "";
        slideImg.className = "";
        slideUrl = URL.createObjectURL(art!);
        slideImg.src = slideUrl;
        slideCaption.textContent = `${e.name || "Untitled"}, ${fmtBytes(e.size)}. ${isAutoCopy(e.name) ? `${AUTO_COPY_NOTE} ` : ""}A preview: the picture the file keeps, as it was last saved.`; // (for a screen reader: on screen nothing takes room from the picture)
        armShow();
        return;
      } },
      { claims: () => isCard(rec), show: async () => {
        // Not something the browser can show: its card, large, and what it is (ADR 0078).
        const d = describeFile(rec.name, rec.type);
        slideImg.hidden = true;
        slideTile.innerHTML = ctx.fileTile(rec);
        slideTile.hidden = false;
        slideCaption.textContent = `${label}. No preview for this kind of file: ${d.todo}`;
        slideCaption.classList.add("is-note");
        armShow();
        return;
      } },
      { claims: () => /^(video|audio)\//.test(rec.type), show: async () => {
        // A video or audio original plays here, with the same player as on the canvas (an audio file shows the picture of its waveform above it).
        const isVideo = rec.type.startsWith("video/");
        slideImg.hidden = isVideo;
        if (!slideImg.hidden) slideImg.src = await ctx.thumbFor(hash).catch(() => "");
        avEng.visual = isVideo;
        avEng.onEnded = () => {
          controls.refresh();
          if (showing) stepSlide(1);
        };
        slideMedia.hidden = false;
        try {
          await avEng.load(playOf(false), stream ?? rec.blob, rec.duration ?? 0);
        } catch {
          if (token !== slideToken) return;
          unloadMedia();
          slideImg.hidden = false;
          // (the file is there, read whole: its format is one this app cannot play, as HEVC (H.265) video in most builds)
          void thumbnail(`This ${isVideo ? "video" : "sound"}'s format cannot be played in this app (HEVC / H.265 video, for one). ${desktopBridge() ? "Open in default app (in its details) plays it in your system's app" : "Download it to play it in another app"}`);
          return;
        }
        if (token !== slideToken) return;
        eng = avEng;
        controls.show(avEng, isVideo ? "video" : "audio", false);
        // In a slideshow a video or audio file plays and the show moves on when it ends.
        if (showing) avEng.play();
        armShow();
        return;
      } },
      { claims: () => rec.type === "image/gif" && (rec.frames === undefined || rec.frames > 1), show: async () => {
        const url = (slideUrl = URL.createObjectURL(rec.blob));
        // An animated GIF plays frame by frame, with the same controls (it loops until the slideshow moves on). One whose frames were
        // never counted (imported before they were, or taken from the workspace folder) is read here, and shown still if it has one.
        slideImg.hidden = true;
        slideGif.hidden = false;
        try {
          await gifEng.load(playOf(true), rec.blob, 0);
        } catch {
          if (token !== slideToken) return;
          unloadMedia();
          slideImg.hidden = false;
          slideImg.src = url;
          armShow();
          return;
        }
        if (token !== slideToken) return;
        if (gifEng.len() < 1) {
          unloadMedia();
          slideImg.hidden = false;
          slideImg.src = url;
          armShow();
          return;
        }
        eng = gifEng;
        controls.show(gifEng, "gif", true);
        gifEng.play();
        paintZoom();
        armShow();
        return;
      } },
      { claims: () => true, show: async () => {
        slideImg.onerror = () => void thumbnail();
        slideImg.src = URL.createObjectURL(rec.blob);
        slideUrl = slideImg.src;
        armShow();
      } },
    ];
    for (const k of stageKinds) {
      const mine = await k.claims();
      if (token !== slideToken) return;
      if (mine) return void (await k.show());
    }
  };
  // With the controls hidden, the back arrow and the details toggle at the top show again while the pointer is near the top edge.
  ctx.viewer.addEventListener("pointermove", (e) => {
    if (!ctx.viewer.classList.contains("no-bar")) return;
    const r = ctx.viewer.getBoundingClientRect();
    ctx.viewer.classList.toggle("is-near-top", e.clientY - r.top < 90);
    ctx.viewer.classList.toggle("is-near-bottom", r.bottom - e.clientY < 90);
  });
  ctx.viewer.addEventListener("pointerleave", () => ctx.viewer.classList.remove("is-near-top", "is-near-bottom"));
  const closeSlide = (): void => {
    history?.reset(); // (the viewer closed: its back and forward history ends with it)
    setGrey(false);
    const was = slideHash;
    stopShow();
    slideSet = null;
    slideToken++;
    slideHash = null;
    ctx.viewer.hidden = true;
    ctx.body.classList.remove("is-viewing");
    ctx.root.classList.remove("is-viewing");
    ctx.syncViewing();
    slideImg.onerror = null;
    slideImg.removeAttribute("src");
    unloadMedia();
    unloadNote();
    freeSlideUrl();
    filmWin.replaceChildren();
    filmMounted.clear();
    // Back in the library the card of the asset that was open is in view.
    if (was) ctx.revealHash(was, "nearest");
  };
  // The invisible edges of the viewer: a click on the left or right side goes to the previous or next asset (the width is a setting).
  const applyEdge = (): void => void ctx.viewer.style.setProperty("--edge-w", String(ctx.settings.get("assets.edgeWidth")));
  applyEdge();
  for (const edge of ctx.viewer.querySelectorAll<HTMLElement>(".viewer-edge")) {
    // view-state: (the viewer's previous and next)
    edge.addEventListener("click", (e) => {
      e.stopPropagation();
      stepSlide(edge.dataset["edge"] === "prev" ? -1 : 1);
    });
    for (const type of ["pointerdown", "dblclick"]) edge.addEventListener(type, (e) => e.stopPropagation());
  }
  const stepSlide = (d: number): void => {
    const { list, at } = viewList();
    const i = at.get(slideHash ?? "") ?? -1;
    if (i >= 0 && list.length > 1) void showSlide(list[(i + d + list.length) % list.length]!);
  };
  // ---- slideshow: moves to the next asset after the chosen time (a video or audio file plays to its end first) and wraps round
  const progress = ctx.viewer.querySelector<HTMLElement>(".viewer-progress")!;
  const playBtn = ctx.viewer.querySelector<HTMLElement>('[data-act="play"]')!;
  const clearShowTimer = (): void => {
    if (showTimer) clearTimeout(showTimer);
    showTimer = null;
    progress.hidden = true;
  };
  /** Arm the timer for the asset now open (not for a playing video: its end moves the show on). */
  const armShow = (): void => {
    clearShowTimer();
    if (!showing || ctx.viewer.hidden) return;
    if (!slideMedia.hidden) return; // a video or audio file: `ended` steps
    const ms = ctx.settings.get("assets.slideSeconds") * 1000;
    progress.style.setProperty("--ms", `${ms}ms`);
    progress.hidden = false;
    progress.classList.remove("is-running");
    void progress.offsetWidth; // restart the bar
    progress.classList.add("is-running");
    showTimer = setTimeout(() => stepSlide(1), ms);
  };
  const setShowing = (on: boolean): void => {
    showing = on;
    ctx.viewer.classList.toggle("is-showing", on);
    playBtn.setAttribute("aria-pressed", String(on));
    playBtn.setAttribute("aria-label", on ? "Pause the slideshow" : "Start the slideshow");
    playBtn.title = on ? "Pause the slideshow" : "Start the slideshow"; // (no key of its own: Space is the player's)
    playBtn.innerHTML = on ? ICONS.pause : ICONS.presentation;
    if (on) {
      if (eng === avEng) avEng.play();
      armShow();
    } else clearShowTimer();
  };
  const stopShow = (): void => setShowing(false);
  // The time per slide is a setting (Settings > Library); a change applies to the slide on screen.
  ctx.settings.subscribe((key) => {
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
    ctx.ui.details = !ctx.ui.details;
    ctx.saveUi();
    ctx.applyUi();
    if (!ctx.viewer.hidden) ctx.viewer.focus();
  };
  const toggleBar = (): void => {
    ctx.ui.bar = !ctx.ui.bar;
    ctx.saveUi();
    ctx.applyUi();
    if (ctx.ui.bar && !ctx.viewer.hidden) renderFilm(); // (items passed while it was hidden: it is drawn at the one open now)
    // The button that was pressed may have just been hidden: keep the keyboard in the viewer.
    if (!ctx.viewer.hidden) ctx.viewer.focus();
  };
  // commands: (the viewer's own controls show; Favourite and Place press the details' buttons, which run their commands)
  ctx.viewer.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const film1 = t.closest<HTMLElement>(".film-item");
    if (film1) return void showSlide(film1.dataset["hash"]!);
    const act = t.closest<HTMLElement>("[data-act]")?.dataset["act"];
    if (act === "prev") stepSlide(-1);
    else if (act === "next") stepSlide(1);
    else if (act === "close") void leaveNote().then((ok) => ok && closeSlide());
    else if (act === "grey") setGrey(!ctx.viewer.classList.contains("is-grey"));
    else if (act === "sample") {
      ctx.ui.fontSample = (ctx.ui.fontSample + 1) % FONT_SAMPLES.length;
      ctx.saveUi();
      labelSample();
      for (const line of ctx.root.querySelectorAll(".font-sample-line")) line.textContent = FONT_SAMPLES[ctx.ui.fontSample]!;
      ctx.session.fontSample = FONT_SAMPLES[ctx.ui.fontSample]!;
      ctx.session.onFontLook?.();
    }
    else if (act === "ground") {
      const now = ctx.session.viewGround;
      void ctx.session.setViewGround(VIEW_GROUNDS[(VIEW_GROUNDS.indexOf(now) + 1) % VIEW_GROUNDS.length]!);
      ctx.session.onFontLook?.();
      paintVector();
    }
    else if (act === "play") setShowing(!showing);
    else if (act === "fullscreen") void (document.fullscreenElement ? document.exitFullscreen() : ctx.viewer.requestFullscreen()).catch(() => undefined);
    else if (act === "details") toggleDetails();
    else if (act === "bar") toggleBar();
    else if (act === "favorite" || act === "place") ctx.inspector.querySelector<HTMLButtonElement>(`[data-action="${act}"]`)?.click();
  });
  const viewerKey = (e: KeyboardEvent): void => {
    // (an Escape something in the file already used is never the viewer's: a table cell's editor that let go of the table is gone from the
    // page by the time the key gets here, so where it came from can no longer be told)
    if (e.key === "Escape" && e.defaultPrevented) return;
    const typing = (e.target as HTMLElement).closest(TYPING);
    // (Alt with an arrow is back and forward, file-history.ts: never a step to the next item)
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
    if (note?.key?.(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (note?.ownsKeys && (e.target as HTMLElement).closest(".viewer-note")) {
      // (a note's keys are the editor's: Back closes it. + and - are words there, so with Ctrl.)
      const dir = !(e.ctrlKey || e.metaKey) || e.altKey ? null : e.key === "+" || e.key === "=" ? 1 : e.key === "-" || e.key === "_" ? -1 : e.key === "0" ? 0 : null;
      if (dir !== null) {
        zoomStep(dir);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Escape the file did not use itself (its list, its find bar, a popover closed first) closes the viewer, from its words too, as it
      // does for a picture: the selection stays, so its details stay.
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
      } else if (typing || (e.target as HTMLElement).isContentEditable || (e.target as HTMLElement).closest('[contenteditable="true"]') || !/^(ArrowLeft|ArrowRight|i|I|f|F)$/.test(e.key) || e.ctrlKey || e.metaKey || e.altKey) return; // (Alt with an arrow: back and forward, file-history.ts)
      // (with the cursor out of the words, as on a button of its toolbar, the viewer's own keys are still the viewer's)
    }
    if (e.key === "Escape") {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      else void leaveNote().then((ok) => ok && closeSlide());
    } else if (typing) return;
    else if (e.key === "ArrowLeft") stepSlide(-1);
    else if (e.key === "ArrowRight") stepSlide(1);
    else if (e.key === "i" || e.key === "I") toggleDetails();
    else if (e.key === "f" || e.key === "F") toggleBar();
    else if (e.key === "+" || e.key === "=") zoomStep(1);
    else if (e.key === "-" || e.key === "_") zoomStep(-1);
    else if (e.key === "0") zoomStep(0);
    else if (e.key === "1") note ? zoomStep(0) : toggleActual();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  ctx.viewer.addEventListener("keydown", viewerKey);
  // (with the focus on nothing, a press having left the words, a key reaches no element of the viewer)
  document.addEventListener("keydown", (e) => {
    if (e.target === document.body && ctx.visible && ctx.mine() && !ctx.viewer.hidden && !document.querySelector("dialog[open]")) viewerKey(e);
  });

  return {
    get autoShown() { return autoShown; }, set autoShown(v: boolean) { autoShown = v; },
    cardInView,
    closeSlide,
    get eng() { return eng; },
    fillLinks,
    filmMounted,
    get goneAt() { return goneAt; }, set goneAt(v: { hash: string; at: number; } | null) { goneAt = v; },
    labelGround,
    get note() { return note; },
    renderFilm,
    showSlide,
    get slideHash() { return slideHash; },
    slideImg,
    get slideSet() { return slideSet; }, set slideSet(v: Set<string> | null) { slideSet = v; },
    startShow,
    stopShow,
    toggleDetails,
    versionOf,
    viewList,
    windowFilm,
  };
}
