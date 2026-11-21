import type { AssetLibrary } from "../assets/asset-library";
import type { AssetFolder, CatalogEntry } from "../assets/asset-catalog";
import type { Session } from "../app/session";
import type { SettingsStore } from "../settings/settings";
import { commands, pressCommand } from "../commands/registry";
import type { Command, OptionSpec } from "../commands/types";
import { folderPath } from "../assets/asset-catalog";
import { newObjectId } from "../doc/model";
import { plural } from "../doc/plural";
import { confirmDialog, listDialog, promptDialog } from "./confirm";
import { plainRowHtml } from "./settings-view";
import { esc } from "./format";
import { ICONS } from "./icons";
import { commandRows, openMoreMenu } from "./more-menu";
import type { MenuItem } from "./more-menu";
import { panelHtml } from "./panel";
import { openTreeChooser } from "./tree-chooser";
import type { ChoiceNode, ChooserView } from "./tree-chooser";
import { showMoreButton } from "./show-more";
import { artTile, makeThumb } from "../assets/thumb";
import { isArtFile } from "../assets/art-preview";
import { mountSettings } from "./setting-rows";
import { R } from "../gen/kit";

/**
 * Reference windows (ADR 0207): small windows that float over every view (the canvas, the Library, PhotoCraft, Settings), above the bars and
 * panels and under menus and dialogs, to keep references in sight while working. One shows a **gallery** (the pictures of a library folder,
 * or all of them), the other a **moodboard**: a simple surface, panned and zoomed as the canvas is but not endless, where pictures dragged
 * from the Library, the canvas or another app are laid out ("board" is the workspace's own level, so the word on screen is "moodboard"; the
 * code keeps "board"). Moodboards are saved with the workspace (Settings `reference.boards`); the windows open
 * on a device are opened again (`reference.windows`). A window only shows: it changes no picture. Hidden items show only while the hidden
 * items do, as on a canvas (a padlock in their place otherwise). Keys, pastes and the wheel inside a window are the window's: they never
 * reach the canvas or the Library behind it.
 */

export type RefSource = string; // "all" | "folder:<id>" | "board:<id>"
/** A picture on a moodboard: its library file, place and width, and how it is shown (flipped, turned a quarter at a time, grey, see-through): the file is never changed. */
interface Item { h: string; x: number; y: number; w: number; fx?: true; fy?: true; r?: number; grey?: true; o?: number }
type Sort = "new" | "old" | "az" | "za";
/** A window's own choices, kept with where it is. */
interface Prefs { folded?: boolean; opacity?: number; through?: boolean; sort?: Sort; size?: "s" | "m" | "l"; /** The Opacity strip under the title shown. */ look?: boolean }
interface Board { id: string; name: string; items: Item[]; view?: { x: number; y: number; k: number } }

export interface ReferenceDeps {
  session: Session;
  assets: AssetLibrary;
  settings: SettingsStore;
  /** Whether the hidden items show now (hidden mode, the hidden items open). */
  hidden(): boolean;
  /** Files into the library (pasted or dropped from another app): their hashes. */
  importFiles(files: File[]): Promise<string[]>;
  /** The pictures selected on the canvas, then those copied there last: their library files. */
  canvasPictures(): string[];
  say(text: string): void;
  /** Library files placed on the open canvas, at a point of the screen (else its middle): how many. */
  place(hashes: readonly string[], at?: { x: number; y: number }): Promise<number>;
  /** The desktop app: a page floated over every app, in a window of its own kept on top (absent: not in this build). */
  float?(title: string, html: string): Promise<void>;
}

const LIBRARY_DRAG = "application/x-canvast-assets";
const MAX_ITEMS = 1000;
const MIN_W = 220, MIN_H = 160;
/** A gallery shows this many pictures, then a Show more button for the next as many (a folder of thousands would build them all at once). */
const PAGE = 200;
/** Past this many pixels on screen a picture is shown from its file, below from its thumbnail. */
const FULL_PX = 600;

export function mountReferenceWindows(deps: ReferenceDeps): { open(source?: RefSource): void; refresh(): void } {
  const { settings, session } = deps;
  const read = <T>(key: "reference.boards" | "reference.windows"): T[] => {
    try {
      return JSON.parse(settings.get(key)) as T[];
    } catch {
      return [];
    }
  };
  const boards = (): Board[] => read<Board>("reference.boards");
  const boardById = (id: string): Board | undefined => boards().find((b) => b.id === id);
  /** A board's change (one undo step of the board's own history, kept on this device over a reload), then each window showing it follows. */
  const HISTORY_KEY = "canvast.reference.history";
  const history = new Map<string, { back: Item[][]; ahead: Item[][] }>((() => {
    try {
      return Object.entries(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "{}") as Record<string, { back: Item[][]; ahead: Item[][] }>);
    } catch {
      return [];
    }
  })());
  const keepHistory = (): void => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(Object.fromEntries([...history].map(([k, h]) => [k, { back: h.back.slice(-30), ahead: h.ahead.slice(-30) }]))));
    } catch {
      /* (no storage: the history lasts as long as the page) */
    }
  };
  /** The last change and when: the same change again soon after (a slider dragged) is the same undo step. */
  let lastStep = { key: "", at: 0 };
  const updateBoard = (id: string, f: (b: Board) => Board, step = true, merge = ""): void => {
    const all = boards();
    const was = all.find((b) => b.id === id);
    if (!was) return;
    const now = f(was);
    const same = !!merge && lastStep.key === `${id}|${merge}` && performance.now() - lastStep.at < 800;
    lastStep = { key: merge ? `${id}|${merge}` : "", at: performance.now() };
    if (step && !same && JSON.stringify(now.items) !== JSON.stringify(was.items)) {
      const h = history.get(id) ?? { back: [], ahead: [] };
      h.back.push(was.items);
      if (h.back.length > 100) h.back.shift();
      h.ahead = [];
      history.set(id, h);
    }
    settings.set("reference.boards", JSON.stringify(all.map((b) => (b.id === id ? now : b))));
    if (step) keepHistory();
    manageList?.refresh();
    for (const w of wins.values()) if (w.source === `board:${id}`) w.sync();
  };

  // ---- pictures: a thumbnail at first, the file itself when shown large; one address per file, for every window
  const urls = new Map<string, { thumb?: Promise<string | null>; full?: Promise<string | null> }>();
  const urlOf = (hash: string, full: boolean): Promise<string | null> => {
    const at = urls.get(hash) ?? {};
    urls.set(hash, at);
    const key = full ? "full" : "thumb";
    at[key] ??= (async () => {
      if (full) {
        const blob = (await deps.assets.record(hash).catch(() => undefined))?.blob;
        return blob ? URL.createObjectURL(blob) : urlOf(hash, false);
      }
      // the picture the Library shows for it, in its order: a custom thumbnail, the thumbnail stored, one made now as the Library makes it (and
      // kept for it), an art file's own picture, else the file itself
      const custom = (await listing())?.byHash.get(hash)?.thumb;
      if (custom) {
        const target = (await listing())?.byHash.get(custom);
        const b = (target && (deps.hidden() || !target.hidden) ? (await session.catalog?.thumb(custom).catch(() => undefined))?.blob : undefined) ?? (await session.storage?.customThumbs?.get(custom).catch(() => null)) ?? undefined;
        if (b) return URL.createObjectURL(b);
      }
      const kept = (await session.catalog?.thumb(hash).catch(() => undefined))?.blob;
      if (kept) return URL.createObjectURL(kept);
      const rec = await deps.assets.record(hash).catch(() => undefined);
      if (!rec) return null;
      const made = await makeThumb(rec).catch(() => null);
      if (made && !made.notKept && !session.readOnly) void session.catalog?.putThumb(made).catch(() => undefined);
      const tile = made ? null : isArtFile(rec.name) ? await artTile(rec).catch(() => null) : null;
      return URL.createObjectURL(made?.blob ?? tile ?? rec.blob);
    })();
    // (nothing found now is looked for again next time: the Library may make it meanwhile)
    void at[key]!.then((u) => void (u === null && delete at[key]));
    return at[key]!;
  };
  // The library as the windows read it: once, then again only when it changed (`refresh`), not at every redraw
  let listed: Promise<{ entries: CatalogEntry[]; folders: AssetFolder[]; byHash: Map<string, CatalogEntry> } | null> | null = null;
  const listing = () =>
    (listed ??= (async () => {
      const l = await session.catalog?.list().catch(() => null);
      return l ? { entries: l.entries, folders: l.folders, byHash: new Map(l.entries.map((e) => [e.hash, e])) } : null;
    })());
  const isPicture = (e: CatalogEntry | undefined): boolean => !!e && e.type.startsWith("image/") && e.state === "active";
  const shows = (e: CatalogEntry | undefined): boolean => !!e && (deps.hidden() || !e.hidden);

  const wins = new Map<string, Win>();
  const ratio = new Map<string, number>(); // (each picture's height over width, once its thumbnail is read: every window's)
  let keepTimer = 0;
  /** Where the windows are, kept for the next start: once they rest, not at every step of a move or a resize. */
  const keepNow = (): void => {
    clearTimeout(keepTimer);
    settings.set("reference.windows", JSON.stringify([...wins.values()].map((w) => ({ source: w.source, x: w.el.offsetLeft, y: w.el.offsetTop, w: w.el.offsetWidth, h: w.prefs.folded ? w.unfoldedH : w.el.offsetHeight, ...w.prefs }))));
  };
  const keepWindows = (): void => {
    clearTimeout(keepTimer);
    keepTimer = window.setTimeout(keepNow, 500);
  };
  // (what a window shows is kept at once; where it is once it rests, and in any case before the page goes)
  window.addEventListener("pagehide", keepNow);

  interface Win { id: string; source: RefSource; el: HTMLElement; prefs: Prefs; unfoldedH: number; render(): Promise<void>; sync(): void; close(): void; applyPrefs(): void; slideshow(): void }

  /** The pictures copied in a reference window last (Ctrl+C there), to paste on another board. */
  let copied: string[] = [];

  const open = (source: RefSource = "all", at?: { x: number; y: number; w: number; h: number } & Prefs): Win => {
    const id = newObjectId();
    const el = document.createElement("aside");
    el.className = "layers-panel ref-window";
    el.dataset["testid"] = "reference-window";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Reference window");
    el.tabIndex = -1;
    // (the shared parts of a panel: the header's buttons, the chooser of the Styles panel and its search field)
    el.innerHTML = panelHtml({
      title: "Reference",
      count: 0,
      tools: `<button type="button" class="layer-btn" data-ref-more aria-haspopup="menu" aria-label="More" title="More: moodboards, the gallery's order, the window (fold, see-through, float)">${ICONS.ellipsis}</button>`,
      sub: `<div class="styles-kinds"><button type="button" class="pick-current" data-ref-source aria-haspopup="menu" aria-expanded="false" aria-label="What it shows" title="What it shows: a gallery of the library, or a moodboard"></button></div><div class="layers-filter" data-ref-filter-row><input type="search" data-ref-filter placeholder="Search pictures" aria-label="Search the pictures by name" autocomplete="off"></div><div class="ref-look" data-ref-look hidden></div>`,
      body: `<div class="ref-body" data-ref-body></div>`,
    });
    const n = wins.size;
    const box = at ?? { x: Math.max(8, window.innerWidth - 380 - 24 * n), y: 72 + 24 * n, w: 360, h: 300 };
    Object.assign(el.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${Math.max(MIN_W, box.w)}px`, height: `${Math.max(MIN_H, box.h)}px` });
    document.body.append(el);
    const body = el.querySelector<HTMLElement>("[data-ref-body]")!;
    // The Opacity strip: the shared rows of settings (a slider and its number; a double-click puts it back): the window's, and the pictures picked on a moodboard
    const lookHost = el.querySelector<HTMLElement>("[data-ref-look]")!;
    const pickedNow = (): { b: Board; sel: number[] } | null => {
      const b = win.source.startsWith("board:") ? boardById(win.source.slice(6)) : undefined;
      const sel = b ? [...picked].filter((j) => b.items[j]).sort((x, y) => x - y) : [];
      return b && sel.length ? { b, sel } : null;
    };
    const look = mountSettings(lookHost, {
      sections: () => [{ title: "Opacity", items: [R("window", "Window opacity", 20, 100, 100), ...(pickedNow() ? [R("pictures", "Pictures' opacity", 10, 100, 100)] : [])] }],
      get: (k) => {
        if (k === "window") return Math.round((win.prefs.opacity ?? 1) * 100);
        const at = pickedNow();
        return at ? Math.round((at.b.items[at.sel[0]!]!.o ?? 1) * 100) : 100;
      },
      set: (k, v) => {
        if (k === "window") return void pressCommand("reference.window", { window: id, opacity: Number(v) / 100 });
        const at = pickedNow();
        if (at) void pressCommand("reference.look", { board: at.b.id, indices: at.sel, patch: { opacity: Number(v) / 100 } });
      },
      reset: (keys) => {
        for (const k of keys) {
          if (k.k === "window") void pressCommand("reference.window", { window: id, opacity: 1 });
          const at = pickedNow();
          if (k.k === "pictures" && at) void pressCommand("reference.look", { board: at.b.id, indices: at.sel, patch: { opacity: 1 } });
        }
      },
      idPrefix: `ref-${id}-`,
      noHeads: true, // (the strip is opened from "Opacity…": its rows say whose)
    });
    const pickBtn = el.querySelector<HTMLButtonElement>("[data-ref-source]")!;
    const win: Win = {
      id, source, el, unfoldedH: Math.max(MIN_H, box.h),
      prefs: { ...(at?.folded ? { folded: true } : {}), ...(at?.opacity ? { opacity: at.opacity } : {}), ...(at?.through ? { through: true } : {}), ...(at?.sort ? { sort: at.sort } : {}), ...(at?.size ? { size: at.size } : {}), ...(at?.look ? { look: true } : {}) },
      render: async () => undefined, sync: () => undefined, close: () => undefined, applyPrefs: () => undefined, slideshow: () => undefined,
    };
    // Folded to its title, see-through, letting clicks through to what is under it (its title still takes them)
    win.applyPrefs = (): void => {
      const p = win.prefs;
      if (p.folded && !el.classList.contains("is-folded")) win.unfoldedH = el.offsetHeight;
      el.classList.toggle("is-folded", !!p.folded);
      el.style.height = p.folded ? "" : `${Math.max(MIN_H, win.unfoldedH)}px`;
      el.style.opacity = String(p.opacity ?? 1);
      el.classList.toggle("is-through", !!p.through);
      lookHost.hidden = !p.look;
      if (p.look) look.sync();
    };
    const choosing = false; // (what it shows is chosen in the shared menu, not inside the window)

    // moved by its header, kept inside the window of the app
    const head = el.querySelector<HTMLElement>(".panel-head")!;
    head.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button, select, input") || e.button !== 0) return;
      const sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop;
      head.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent): void => {
        el.style.left = `${Math.min(window.innerWidth - 60, Math.max(-el.offsetWidth + 60, m.clientX - sx))}px`;
        el.style.top = `${Math.min(window.innerHeight - 40, Math.max(0, m.clientY - sy))}px`;
      };
      const up = (): void => {
        head.removeEventListener("pointermove", move);
        keepWindows();
      };
      head.addEventListener("pointermove", move);
      head.addEventListener("pointerup", up, { once: true });
      head.addEventListener("pointercancel", up, { once: true });
    });
    // Alt and the wheel over the title: the window's opacity, a step at a time
    head.addEventListener("wheel", (e) => {
      if (!e.altKey) return;
      e.preventDefault();
      const now = win.prefs.opacity ?? 1;
      void pressCommand("reference.window", { window: id, opacity: Math.round(Math.min(1, Math.max(0.2, now - Math.sign(e.deltaY) * 0.05)) * 100) / 100 });
    }, { passive: false });
    // a double-click on the title folds the window to it, or opens it again
    head.addEventListener("dblclick", (e) => {
      if (!(e.target as HTMLElement).closest("button")) void pressCommand("reference.window", { window: id, fold: !win.prefs.folded });
    });
    new ResizeObserver(() => {
      if (!win.prefs.folded) win.unfoldedH = el.offsetHeight;
      keepWindows();
    }).observe(el);
    // view-state: (closes this window; its board is kept)
    el.querySelector("[data-close]")!.addEventListener("click", () => win.close());
    win.close = (): void => {
      el.remove();
      wins.delete(id);
      keepNow();
    };
    // What it shows: the shared menu, as the Styles panel's kinds (moodboards first, each with its own ⋯; then the gallery: all pictures and each folder)
    pickBtn.addEventListener("click", async () => {
      const l = await listing();
      // (a library may hold thousands of folders: the menu lists the last few shown, and Choose a folder… finds any, by its name, in the shared tree)
      const known = new Map((l?.folders ?? []).filter((f) => deps.hidden() || !f.hidden).map((f) => [f.id, f]));
      const folders = recentFolders.filter((fid) => known.has(fid)).map((fid) => ({ f: known.get(fid)!, path: folderPath(l!.folders, fid) }));
      const row = (value: string, label: string, icon: string, hint: string, sep = false) => ({ label, icon, hint, command: "reference.show", checked: value === win.source, sep, run: () => void pressCommand("reference.show", { window: id, source: value }) });
      openMoreMenu(pickBtn, [
        ...boards().map((b, i) => ({ ...row(`board:${b.id}`, b.name, ICONS.referenceWindow, `Moodboard · ${plural(b.items.length, "picture")}`, i === 0), more: boardRows(b.id, win) })),
        { label: "New moodboard…", icon: ICONS.plus, hint: "An empty one in this window", command: "reference.newBoard", run: () => void newBoard(win) },
        { label: "Manage moodboards…", icon: ICONS.settings, hint: "Rename, copy, open or delete them", command: "reference.manage", run: () => void pressCommand("reference.manage", { window: id }) },
        row("all", "All pictures", ICONS.images, "Gallery of the library", true),
        ...folders.map((x) => row(`folder:${x.f.id}`, x.path.join(" › "), ICONS.folder, "A folder shown lately")),
        { label: "Choose a folder…", icon: ICONS.folderTree, hint: "Find any folder by its name", command: "reference.show", run: () => void chooseFolder(win) },
      ], "What it shows");
    });
    // More: what can be done to this moodboard, how the gallery is ordered and sized, and the window itself
    el.querySelector<HTMLElement>("[data-ref-more]")!.addEventListener("click", (e) => {
      const b = win.source.startsWith("board:") ? win.source.slice(6) : null;
      const go = (command: string, o: Record<string, unknown>, label: string, icon: string, hint: string, extra: Partial<MenuItem> = {}): MenuItem => ({ label, icon, hint, command, run: () => void pressCommand(command, o), ...extra });
      const p = win.prefs;
      const anchor = e.currentTarget as HTMLElement;
      // a choice among several: one row naming the one chosen; a click opens the others (a short menu, not every choice of every kind)
      const choice = <V extends string | number>(label: string, icon: string, hint: string, opts: ReadonlyArray<readonly [V, string]>, now: V, set: (v: V) => Record<string, unknown>): MenuItem => ({
        label: `${label}: ${opts.find(([v]) => v === now)?.[1] ?? ""}`, icon, hint, command: "reference.window",
        // (after the menu it is on has closed: opened again on the same button at once, the shared menu would close)
        run: () => void setTimeout(() => openMoreMenu(anchor, opts.map(([v, name]) => go("reference.window", { window: id, ...set(v) }, name, icon, hint, { checked: v === now })), label), 0),
      });
      const SORTS = [["new", "Newest first"], ["old", "Oldest first"], ["az", "By name, A to Z"], ["za", "By name, Z to A"]] as const;
      const SIZES = [["s", "Small"], ["m", "Medium"], ["l", "Large"]] as const;
      openMoreMenu(anchor, [
        // (what it shows is the list under the title: named here too, so a moodboard is found from either)
        { label: "Show a moodboard or folder…", icon: ICONS.referenceWindow, hint: "The list under the title", command: "reference.show", run: () => pickBtn.click() },
        ...(b ? boardRows(b, win) : [{ label: "New moodboard…", icon: ICONS.plus, hint: "An empty one in this window", command: "reference.newBoard", run: () => void newBoard(win) }]),
        ...(b ? [] : [
          { ...choice("Order", ICONS.calendarDays, "The gallery's order", SORTS, p.sort ?? "new", (v) => ({ sort: v })), sep: true },
          choice("Pictures", ICONS.layoutGrid, "The gallery's picture size", SIZES, p.size ?? "m", (v) => ({ size: v })),
          go("reference.slideshow", { window: id }, "Slideshow", ICONS.presentation, "One after another, every 4 seconds"),
        ]),
        go("reference.window", { window: id, fold: !p.folded }, "Fold to its title", ICONS.foldWindow, "A double-click on the title too", { checked: !!p.folded, sep: true }),
        go("reference.window", { window: id, look: !p.look }, `Opacity… (${Math.round((p.opacity ?? 1) * 100)}%)`, ICONS.windowOpacity, "A slider under the title; Alt+wheel too", { checked: !!p.look }),
        go("reference.window", { window: id, through: !p.through }, "Let clicks through", ICONS.clickThrough, "To what is under it; its title stays", { checked: !!p.through }),
        ...(deps.float ? [go("reference.float", { window: id }, "Float over other apps", ICONS.floatOnTop, "A window above every app, view only")] : []),
      ], "More");
    });
    // The window takes the focus when pressed, so its keys are its own (not the canvas's behind it)
    el.addEventListener("pointerdown", (e) => {
      if (!(e.target as HTMLElement).closest("input, button, select, [tabindex]:not(.ref-window)")) el.focus({ preventScroll: true });
    }, true);

    // the gallery's search: its pictures by name
    let filter = "";
    const filterEl = el.querySelector<HTMLInputElement>("[data-ref-filter]")!;
    // view-state: (the gallery narrowed to the pictures whose names hold the words)
    filterEl.addEventListener("input", () => {
      filter = filterEl.value;
      pages = 1;
      one = null;
      void win.render();
    });

    // ---- a gallery: the pictures of a folder (and the folders in it), or all; one large with the arrows
    let one: number | null = null;
    let shown: CatalogEntry[] = [];
    let pages = 1;
    const gallery = async (): Promise<void> => {
      const l = await listing();
      if (!l) return void (body.innerHTML = `<p class="adj-note">No library is open.</p>`);
      const fid = win.source.startsWith("folder:") ? win.source.slice(7) : null;
      const under = new Set(fid ? [fid] : []);
      for (let grew = !!fid; grew; ) {
        grew = false;
        for (const f of l.folders) if (f.parentId !== null && under.has(f.parentId) && !under.has(f.id)) under.add(f.id), (grew = true);
      }
      const q = filter.trim().toLowerCase();
      const order = win.prefs.sort ?? "new";
      shown = l.entries.filter((e) => isPicture(e) && shows(e) && (!fid || e.folderIds?.some((f) => under.has(f))) && (!q || e.name.toLowerCase().includes(q))).sort((a, b) => (order === "new" ? b.importedAt - a.importedAt : order === "old" ? a.importedAt - b.importedAt : order === "az" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)));
      const count = el.querySelector(".layers-count");
      if (count) count.textContent = String(shown.length);
      el.toggleAttribute("data-one", one !== null && !!shown[one]);
      if (one !== null && shown[one]) {
        const e = shown[one]!;
        // the picture fitted in the view (never a scrollbar, never a window that grows), zoomed and panned in it; its bar always at the bottom
        zoom = { k: 1, x: 0, y: 0 };
        body.innerHTML = `<div class="ref-one"><div class="ref-one-view" data-ref-view><img data-ref-big alt="${esc(e.name)}" draggable="false"></div><div class="ref-one-bar"><button type="button" class="layer-btn" data-ref-back aria-label="Back to the gallery" title="Back to the gallery (Esc)">${ICONS.layoutGrid}</button><span class="ref-one-name" draggable="true" data-ref-drag title="${esc(e.name)}: drag it onto the canvas or a moodboard">${esc(e.name)}</span><button type="button" class="layer-btn" data-ref-play aria-label="${slides ? "Stop the slideshow" : "Slideshow"}" title="${slides ? "Stop the slideshow" : "Slideshow: one after another, every 4 seconds"}">${slides ? ICONS.pause : ICONS.presentation}</button><button type="button" class="layer-btn" data-ref-prev aria-label="Previous picture" title="Previous picture (←)">${ICONS.chevronLeft}</button><button type="button" class="layer-btn" data-ref-next aria-label="Next picture" title="Next picture (→)">${ICONS.chevronRight}</button></div></div>`;
        void urlOf(e.hash, true).then((u) => { const img = body.querySelector<HTMLImageElement>("[data-ref-big]"); if (img && u) img.src = u; });
        return;
      }
      one = null;
      stopSlides();
      const upto = Math.min(shown.length, pages * PAGE);
      body.innerHTML = shown.length
        ? `<div class="ref-grid" data-size="${win.prefs.size ?? "m"}">${shown.slice(0, upto).map((e, i) => `<button type="button" class="ref-thumb" data-ref-i="${i}" draggable="true" title="${esc(e.name)}" aria-label="${esc(e.name)}"><img alt="" draggable="false" loading="lazy" decoding="async"></button>`).join("")}</div>${upto < shown.length ? showMoreButton({ attrs: "data-ref-page", hidden: shown.length - upto, label: `Show ${Math.min(PAGE, shown.length - upto)} more` }) : ""}`
        : `<p class="styles-hint">${ICONS.images}<span>${q ? "No picture has that name here." : `No pictures here${deps.hidden() ? "" : " (hidden ones show in hidden mode)"}.`}</span></p>`;
      const io = new IntersectionObserver((seen) => {
        for (const s of seen) {
          if (!s.isIntersecting) continue;
          io.unobserve(s.target);
          const e = shown[Number((s.target as HTMLElement).dataset["refI"])];
          if (!e) continue;
          // (a file no browser draws, with no thumbnail: its name, not an empty square)
          const none = (): void => void (s.target.innerHTML = `<span class="ref-gone">${ICONS.image}<span>${esc(e.name)}</span></span>`);
          void urlOf(e.hash, false).then((u) => {
            const img = s.target.querySelector("img");
            if (!img) return;
            if (!u) return none();
            img.onerror = none;
            img.src = u;
          });
        }
      }, { root: body.closest(".panel-body"), rootMargin: "200px" });
      for (const t of body.querySelectorAll(".ref-thumb")) io.observe(t);
    };
    // ---- the picture shown large: zoomed with the wheel at the pointer, panned with a drag, fitted again with a double-click
    let zoom = { k: 1, x: 0, y: 0 };
    const placeZoom = (): void => {
      const img = body.querySelector<HTMLElement>("[data-ref-big]");
      if (img) img.style.transform = zoom.k === 1 && !zoom.x && !zoom.y ? "" : `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.k})`;
    };
    body.addEventListener("wheel", (e) => {
      const v = (e.target as HTMLElement).closest<HTMLElement>("[data-ref-view]");
      if (!v) return;
      e.preventDefault();
      const r = v.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const k = Math.min(16, Math.max(1, zoom.k * Math.exp(-e.deltaY * 0.0025)));
      zoom = k === 1 ? { k: 1, x: 0, y: 0 } : { k, x: px - ((px - zoom.x) * k) / zoom.k, y: py - ((py - zoom.y) * k) / zoom.k };
      placeZoom();
    }, { passive: false });
    body.addEventListener("pointerdown", (e) => {
      const v = (e.target as HTMLElement).closest<HTMLElement>("[data-ref-view]");
      if (!v || e.button !== 0 || zoom.k === 1) return;
      e.preventDefault();
      const sx = e.clientX - zoom.x, sy = e.clientY - zoom.y;
      v.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent): void => void ((zoom = { ...zoom, x: m.clientX - sx, y: m.clientY - sy }), placeZoom());
      v.addEventListener("pointermove", move);
      v.addEventListener("pointerup", () => v.removeEventListener("pointermove", move), { once: true });
    });
    // ---- a slideshow: the next picture every 4 seconds, until it is stopped (its button, Escape, or the gallery again)
    let slides = 0;
    const stopSlides = (): void => void (slides && (clearInterval(slides), (slides = 0)));
    win.slideshow = (): void => {
      if (slides) return void (stopSlides(), win.render());
      if (!shown.length) return;
      one ??= 0;
      slides = window.setInterval(() => {
        if (one === null || !shown.length) return stopSlides();
        one = (one + 1) % shown.length;
        void win.render();
      }, 4000);
      void win.render();
    };
    // view-state: (one picture large, the next or the one before, back to the gallery, the next pictures, fitted again)
    body.addEventListener("dblclick", (e) => {
      if (!(e.target as HTMLElement).closest("[data-ref-view]")) return;
      zoom = { k: 1, x: 0, y: 0 };
      placeZoom();
    });
    body.addEventListener("click", (e) => {
      if (win.source.startsWith("board:") || choosing) return;
      const t = e.target as HTMLElement;
      const th = t.closest<HTMLElement>(".ref-thumb");
      if (t.closest("[data-ref-play]")) return void pressCommand("reference.slideshow", { window: id });
      if (th) one = Number(th.dataset["refI"]);
      else if (t.closest("[data-ref-back]")) (one = null), stopSlides();
      else if (t.closest("[data-ref-prev]") && one !== null) one = (one - 1 + shown.length) % shown.length;
      else if (t.closest("[data-ref-next]") && one !== null) one = (one + 1) % shown.length;
      else if (t.closest("[data-ref-page]")) pages++;
      else return;
      void win.render();
    });
    // a picture of the gallery (or the one shown large, by its name) dragged onto a moodboard or the canvas: what a Library card carries
    body.addEventListener("dragstart", (e) => {
      const th = (e.target as HTMLElement).closest<HTMLElement>(".ref-thumb");
      const entry = th ? shown[Number(th.dataset["refI"])] : (e.target as HTMLElement).closest("[data-ref-drag]") && one !== null ? shown[one] : undefined;
      if (!entry || !e.dataTransfer) return;
      e.dataTransfer.setData(LIBRARY_DRAG, JSON.stringify([entry.hash]));
      e.dataTransfer.setData("text/plain", entry.name);
      e.dataTransfer.effectAllowed = "copy";
    });

    // ---- a board: its pictures where they were put, panned and zoomed as the canvas is
    let view = { x: 0, y: 0, k: 1 };
    const picked = new Set<number>();
    let stage: HTMLElement | null = null;
    let area: HTMLElement | null = null;
    let frame = 0;
    /** The view moved: drawn at the next frame (one change of transform however many wheel steps came). */
    const placeStage = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (stage) stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
        if (stage) upgrade();
      });
    };
    const boardOf = (): Board | undefined => (win.source.startsWith("board:") ? boardById(win.source.slice(6)) : undefined);
    /** Each picture shown large enough gets its file instead of its thumbnail. */
    const upgrade = (): void => {
      for (const node of stage?.querySelectorAll<HTMLElement>("[data-ref-item]") ?? []) {
        const img = node.querySelector("img");
        if (!img || img.dataset["full"] || node.offsetWidth * view.k < FULL_PX) continue;
        img.dataset["full"] = "1";
        void urlOf(node.dataset["h"]!, true).then((u) => void (u && (img.src = u)));
      }
    };
    const itemNode = (it: Item, i: number, e: CatalogEntry | undefined): HTMLElement => {
      const node = document.createElement("div");
      node.className = "ref-item";
      node.dataset["refItem"] = String(i);
      node.dataset["h"] = it.h;
      const hiddenNow = !!e?.hidden && !deps.hidden();
      node.innerHTML = (!e ? `<span class="ref-gone">${ICONS.fileMissing}<span>Missing</span></span>` : hiddenNow ? `<span class="ref-gone">${ICONS.lockKeyhole}<span>Hidden</span></span>` : `<img alt="${esc(e.name)}" draggable="false" decoding="async">`) + (["nw", "ne", "se", "sw"] as const).map((c) => `<span class="ref-grip" data-ref-grip="${c}" aria-hidden="true"></span>`).join("");
      const img = node.querySelector("img");
      if (img)
        void urlOf(it.h, false).then((u) => {
          if (!u) return;
          img.onload = () => {
            if (img.dataset["full"]) return;
            const r = img.naturalHeight / Math.max(1, img.naturalWidth);
            ratio.set(it.h, r);
            node.style.height = `${node.offsetWidth * r}px`;
          };
          img.src = u;
        });
      return node;
    };
    /** The board's pictures as they are now: the nodes kept, moved and resized in place; only new ones made, gone ones taken away. */
    const syncItems = async (b: Board): Promise<void> => {
      if (!stage) return;
      const l = await listing();
      const nodes = [...stage.querySelectorAll<HTMLElement>("[data-ref-item]")];
      b.items.forEach((it, i) => {
        let node = nodes[i];
        if (!node || node.dataset["h"] !== it.h) {
          const made = itemNode(it, i, l?.byHash.get(it.h));
          if (node) node.replaceWith(made);
          else stage!.append(made);
          node = made;
        }
        node.dataset["refItem"] = String(i);
        node.style.left = `${it.x}px`;
        node.style.top = `${it.y}px`;
        node.style.width = `${it.w}px`;
        node.style.height = `${it.w * (ratio.get(it.h) ?? 0.75)}px`;
        // how it is shown: turned, flipped, grey, see-through (the file is never changed)
        node.style.transform = it.r ? `rotate(${it.r}deg)` : "";
        node.style.opacity = it.o !== undefined && it.o < 1 ? String(Math.max(0.1, it.o)) : "";
        const img = node.querySelector<HTMLElement>("img");
        if (img) {
          img.style.transform = it.fx || it.fy ? `scale(${it.fx ? -1 : 1}, ${it.fy ? -1 : 1})` : "";
          img.style.filter = it.grey ? "grayscale(1)" : "";
        }
        node.classList.toggle("is-picked", picked.has(i));
      });
      for (const extra of nodes.slice(b.items.length)) extra.remove();
      area?.querySelector(".ref-empty")?.toggleAttribute("hidden", b.items.length > 0);
      upgrade();
      if (win.prefs.look) look.sync(); // (the pictures picked now: their slider, or none)
    };
    win.sync = (): void => {
      const b = boardOf();
      if (b && stage) void syncItems(b);
      else void win.render();
    };
    const board = async (): Promise<void> => {
      const b = boardOf();
      if (!b) return void ((win.source = "all"), win.render());
      view = b.view ?? { x: 0, y: 0, k: 1 };
      body.innerHTML = `<div class="ref-board" tabindex="0" data-ref-board aria-label="Board ${esc(b.name)}: drop pictures here; drag a picture to move it, drag the empty board to select, the middle button or Space to pan, the wheel zooms"><div class="ref-stage" data-ref-stage></div><p class="adj-note ref-empty"${b.items.length ? " hidden" : ""}>Drop pictures here from the Library, the canvas or another app, or paste them (Ctrl+V).</p><div class="ref-marquee" data-ref-marquee hidden></div></div>`;
      area = body.querySelector("[data-ref-board]");
      stage = body.querySelector("[data-ref-stage]");
      if (stage) stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
      await syncItems(b);
    };
    const saveView = (() => {
      let t = 0;
      return (): void => {
        clearTimeout(t);
        const b = boardOf();
        if (b) t = window.setTimeout(() => updateBoard(b.id, (x) => ({ ...x, view }), false), 600);
      };
    })();
    /** The board's own units at a point of the screen. */
    const onBoard = (cx: number, cy: number): { x: number; y: number } => {
      const r = area!.getBoundingClientRect();
      return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
    };
    const boundsOf = (items: readonly Item[]) => ({ minX: Math.min(...items.map((i) => i.x)), maxX: Math.max(...items.map((i) => i.x + i.w)), minY: Math.min(...items.map((i) => i.y)), maxY: Math.max(...items.map((i) => i.y + i.w * (ratio.get(i.h) ?? 0.75))) });
    /** Not endless: the view keeps some of the pictures in sight. */
    const clampView = (): void => {
      const b = boardOf();
      if (!b || !area || !b.items.length) return;
      const { minX, maxX, minY, maxY } = boundsOf(b.items);
      const w = area.clientWidth, h = area.clientHeight;
      view.x = Math.min(w - 40 - minX * view.k, Math.max(40 - maxX * view.k, view.x));
      view.y = Math.min(h - 40 - minY * view.k, Math.max(40 - maxY * view.k, view.y));
    };
    /** The selection F fitted last (a second F fits every picture). */
    let fitted = "";
    /** The nearest picture in a direction (w a s d) from the selected one, or from the middle of the view: selected, and centred when out of sight. */
    const step = (b: Board, key: string, sel: readonly number[]): void => {
      if (!area) return;
      const mid = (it: Item) => ({ x: it.x + it.w / 2, y: it.y + (it.w * (ratio.get(it.h) ?? 0.75)) / 2 });
      const from = sel.length ? mid(b.items[sel[0]!]!) : { x: (area.clientWidth / 2 - view.x) / view.k, y: (area.clientHeight / 2 - view.y) / view.k };
      const [ax, ay] = key === "a" ? [-1, 0] : key === "d" ? [1, 0] : key === "w" ? [0, -1] : [0, 1];
      let best = -1, bestScore = Infinity;
      b.items.forEach((it, j) => {
        if (sel.length && j === sel[0]) return;
        const m = mid(it), dx = m.x - from.x, dy = m.y - from.y, along = dx * ax + dy * ay;
        if (sel.length && along <= 0) return; // (only what lies that way; with nothing selected, the nearest of all)
        const score = Math.hypot(dx, dy) + Math.abs(dx * ay - dy * ax); // (straight ahead before off to the side)
        if (score < bestScore) (bestScore = score), (best = j);
      });
      if (best < 0) return;
      picked.clear();
      picked.add(best);
      fitted = "";
      void syncItems(b);
      const m = mid(b.items[best]!), sx = m.x * view.k + view.x, sy = m.y * view.k + view.y;
      if (sx < 0 || sy < 0 || sx > area.clientWidth || sy > area.clientHeight) {
        view = { ...view, x: area.clientWidth / 2 - m.x * view.k, y: area.clientHeight / 2 - m.y * view.k };
        clampView();
        placeStage();
        saveView();
      }
    };
    const zoomAt = (cx: number, cy: number, factor: number): void => {
      if (!area) return;
      const p = onBoard(cx, cy), r = area.getBoundingClientRect();
      const k = Math.min(8, Math.max(0.05, view.k * factor));
      view = { k, x: cx - r.left - p.x * k, y: cy - r.top - p.y * k };
      clampView();
      placeStage();
      saveView();
    };
    // the wheel, as on the canvas: it zooms (Ctrl: a touchpad's pinch, slower), Shift pans
    body.addEventListener("wheel", (e) => {
      if (!boardOf() || choosing) return;
      e.preventDefault();
      const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? area?.clientHeight ?? 400 : 1;
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (e.shiftKey && !e.ctrlKey) {
        view = { ...view, x: view.x - (dx || dy), y: view.y - (dx ? dy : 0) };
        clampView();
        placeStage();
        return saveView();
      }
      zoomAt(e.clientX, e.clientY, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0025)));
    }, { passive: false });
    let space = false;
    body.addEventListener("pointerdown", (e) => {
      const b = boardOf();
      if (!b || !area || choosing || (e.button !== 0 && e.button !== 1)) return;
      const t = e.target as HTMLElement;
      const node = t.closest<HTMLElement>("[data-ref-item]");
      const i = node ? Number(node.dataset["refItem"]) : null;
      const grip = t.closest<HTMLElement>("[data-ref-grip]")?.dataset["refGrip"] ?? null;
      const pan = e.button === 1 || space;
      area.focus({ preventScroll: true });
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, v0 = { ...view };
      // a click picks (Shift or Ctrl adds or takes away), a picture already picked keeps the others for the drag
      if (!pan && i !== null && !picked.has(i)) {
        if (!(e.shiftKey || e.ctrlKey || e.metaKey)) picked.clear();
        picked.add(i);
      } else if (!pan && i !== null && (e.shiftKey || e.ctrlKey || e.metaKey)) picked.delete(i);
      // (a corner's grip resizes the picture it is on, the opposite corner staying where it is; a drag moves every picture picked)
      const moving = !pan && i !== null ? (grip ? [i] : [...picked]).map((j) => ({ j, it: { ...b.items[j]! }, node: stage!.querySelector<HTMLElement>(`[data-ref-item="${j}"]`) })) : [];
      for (const n2 of stage!.querySelectorAll<HTMLElement>("[data-ref-item]")) n2.classList.toggle("is-picked", picked.has(Number(n2.dataset["refItem"])));
      const marquee = body.querySelector<HTMLElement>("[data-ref-marquee]")!;
      const start = onBoard(sx, sy);
      body.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent): void => {
        const dx = m.clientX - sx, dy = m.clientY - sy;
        if (pan) {
          view = { ...v0, x: v0.x + dx, y: v0.y + dy };
          clampView();
          return placeStage();
        }
        if (moving.length) {
          for (const { it, node: nd } of moving) {
            if (!nd) continue;
            if (grip) {
              const r = resized(it, grip, dx);
              Object.assign(nd.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.w * (ratio.get(it.h) ?? 0.75)}px` });
            } else {
              nd.style.left = `${it.x + dx / view.k}px`;
              nd.style.top = `${it.y + dy / view.k}px`;
            }
          }
          return;
        }
        // a box over the empty board picks what it touches
        const r = area!.getBoundingClientRect();
        Object.assign(marquee.style, { left: `${Math.min(sx, m.clientX) - r.left}px`, top: `${Math.min(sy, m.clientY) - r.top}px`, width: `${Math.abs(dx)}px`, height: `${Math.abs(dy)}px` });
        marquee.hidden = false;
      };
      const up = (u: PointerEvent): void => {
        body.removeEventListener("pointermove", move);
        marquee.hidden = true;
        if (win.prefs.look) look.sync(); // (a picture picked or let go: the pictures' slider follows)
        const dx = u.clientX - sx, dy = u.clientY - sy, far = Math.hypot(dx, dy) > 2;
        if (pan) return saveView();
        // let go outside the window, over the canvas: the pictures are placed there, and stay on the moodboard
        const wr = el.getBoundingClientRect();
        const out = u.clientX < wr.left || u.clientX > wr.right || u.clientY < wr.top || u.clientY > wr.bottom;
        if (moving.length && far && out && !grip) {
          void syncItems(b);
          if (document.elementFromPoint(u.clientX, u.clientY)?.closest("#canvas")) void deps.place(moving.map(({ it }) => it.h), { x: u.clientX, y: u.clientY });
          return;
        }
        if (moving.length && far) {
          const moves = moving.map(({ j, it }) => (grip ? { i: j, ...resized(it, grip, dx) } : { i: j, x: it.x + dx / view.k, y: it.y + dy / view.k }));
          return void pressCommand("reference.place", { board: b.id, moves });
        }
        if (i === null) {
          if (!(u.shiftKey || u.ctrlKey || u.metaKey)) picked.clear();
          if (far) {
            const end = onBoard(u.clientX, u.clientY);
            const [x0, x1, y0, y1] = [Math.min(start.x, end.x), Math.max(start.x, end.x), Math.min(start.y, end.y), Math.max(start.y, end.y)];
            b.items.forEach((it, j) => {
              const h = it.w * (ratio.get(it.h) ?? 0.75);
              if (it.x < x1 && it.x + it.w > x0 && it.y < y1 && it.y + h > y0) picked.add(j);
            });
          }
          void syncItems(b);
        }
      };
      body.addEventListener("pointermove", move);
      body.addEventListener("pointerup", up, { once: true });
      body.addEventListener("pointercancel", up, { once: true });
    });
    /** A picture resized by a corner's grip dragged `dx` px across: its new place and width, the opposite corner kept. */
    const resized = (it: Item, corner: string, dx: number): { x: number; y: number; w: number } => {
      const left = corner === "nw" || corner === "sw", top = corner === "nw" || corner === "ne";
      const w = Math.max(16, it.w + (left ? -dx : dx) / view.k), r = ratio.get(it.h) ?? 0.75;
      return { w, x: left ? it.x + it.w - w : it.x, y: top ? it.y + (it.w - w) * r : it.y };
    };
    body.addEventListener("dblclick", (e) => {
      if (boardOf() && !(e.target as HTMLElement).closest("[data-ref-item]")) void pressCommand("reference.fit", { window: id, board: boardOf()!.id });
    });
    // A right-click: what can be done to the pictures picked (the one under the pointer joins them), or to the whole moodboard
    body.addEventListener("contextmenu", (e) => {
      const t = e.target as HTMLElement, b = boardOf();
      const th = t.closest<HTMLElement>(".ref-thumb");
      if (!b) {
        const entry = th ? shown[Number(th.dataset["refI"])] : t.closest("[data-ref-view]") && one !== null ? shown[one] : undefined;
        if (!entry) return;
        e.preventDefault();
        return openMoreMenu(th ?? t, [{ label: "Place on the canvas", icon: ICONS.mapPin, hint: "In the middle of the view", command: "reference.toCanvas", run: () => void pressCommand("reference.toCanvas", { ids: [entry.hash] }) }], "Picture");
      }
      e.preventDefault();
      const node = t.closest<HTMLElement>("[data-ref-item]");
      if (node && !picked.has(Number(node.dataset["refItem"]))) (picked.clear(), picked.add(Number(node.dataset["refItem"])), void syncItems(b));
      const sel = [...picked].sort((a, c) => a - c), items = sel.map((j) => b.items[j]!);
      const go = (command: string, o: Record<string, unknown>, label: string, icon: string, hint: string, extra: Partial<MenuItem> = {}): MenuItem => ({ label, icon, hint, command, run: () => void pressCommand(command, { board: b.id, ...o }), ...extra });
      const look = (patch: Record<string, unknown>, label: string, icon: string, hint: string, extra: Partial<MenuItem> = {}): MenuItem => go("reference.look", { indices: sel, patch }, label, icon, hint, extra);
      openMoreMenu(node ?? t, sel.length
        ? [
            // (the pictures only: this command is not the moodboard's, it takes no "board")
            { label: "Place on the canvas", icon: ICONS.mapPin, hint: "In the middle of the view", command: "reference.toCanvas", run: () => void pressCommand("reference.toCanvas", { ids: items.map((x) => x.h) }) },
            look({ flip: "x" }, "Flip horizontally", ICONS.flipHorizontal, "Mirrored left to right (Shift+H)", { sep: true }),
            look({ flip: "y" }, "Flip vertically", ICONS.flipVertical, "Mirrored top to bottom (Shift+V)"),
            look({ turn: 90 }, "Turn a quarter", ICONS.turnQuarter, "Clockwise, 90°"),
            look({ grey: !items.every((x) => x.grey) }, "Greyscale", ICONS.greyscale, "To study its values", { checked: items.every((x) => x.grey) }),
            { label: "Opacity…", icon: ICONS.windowOpacity, hint: "A slider under the title", command: "reference.window", sep: true, run: () => void pressCommand("reference.window", { window: id, look: true }) },
            go("reference.order", { indices: sel, to: "front" }, "Bring to front", ICONS.bringToFront, "Over the others", { sep: true }),
            go("reference.order", { indices: sel, to: "back" }, "Send to back", ICONS.sendToBack, "Under the others"),
            go("reference.arrange", { indices: sel }, "Arrange in a grid", ICONS.arrangeMenu, "These pictures in rows, tidy"),
            go("reference.remove", { indices: sel }, "Take off the moodboard", ICONS.trash, "It stays in the library", { danger: true, sep: true }),
          ]
        : boardRows(b.id, win), sel.length ? "Pictures" : "Moodboard");
    });
    body.addEventListener("auxclick", (e) => e.button === 1 && e.preventDefault()); // (a middle click pans: it pastes nothing on Linux)

    // ---- keys: the canvas's, on the board (and the arrows, Escape on a picture shown large)
    el.addEventListener("keydown", (e) => {
      const typing = (e.target as HTMLElement).closest("input, textarea");
      if (typing) return void e.stopPropagation();
      if (e.key === " ") {
        space = true;
        area?.classList.add("is-panning");
        e.preventDefault();
      }
      if (one !== null && !win.source.startsWith("board:")) {
        const k1 = e.ctrlKey || e.metaKey || e.altKey ? "" : e.key.toLowerCase();
        if (e.key === "Escape") (one = null), stopSlides();
        else if (e.key === "ArrowLeft" || e.key === "ArrowRight" || k1 === "a" || k1 === "d") one = (one + (e.key === "ArrowLeft" || k1 === "a" ? -1 : 1) + shown.length) % shown.length;
        else if (k1 === "f" || k1 === "0") {
          // (fitted again, as a double-click does)
          zoom = { k: 1, x: 0, y: 0 };
          placeZoom();
          e.preventDefault();
          return void e.stopPropagation();
        }
        else return void e.stopPropagation();
        e.preventDefault();
        e.stopPropagation();
        return void win.render();
      }
      const b = boardOf();
      if (!b) return void e.stopPropagation();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const sel = [...picked].sort((a, c) => a - c);
      const rect = area?.getBoundingClientRect();
      const mid = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 };
      let done = true;
      if (mod && key === "z") void pressCommand(e.shiftKey ? "reference.redo" : "reference.undo", { board: b.id });
      else if (mod && key === "y") void pressCommand("reference.redo", { board: b.id });
      else if (mod && key === "a") (sel.length = 0), b.items.forEach((_, j) => picked.add(j)), void syncItems(b);
      else if (mod && key === "d" && sel.length) void pressCommand("reference.add", { board: b.id, ids: sel.map((j) => b.items[j]!.h), x: b.items[sel[0]!]!.x + 24, y: b.items[sel[0]!]!.y + 24 });
      else if ((e.key === "Delete" || e.key === "Backspace") && sel.length) (picked.clear(), void pressCommand("reference.remove", { board: b.id, indices: sel }));
      else if (e.key === "Escape") picked.clear(), void syncItems(b);
      else if (!mod && e.shiftKey && (key === "h" || key === "v") && sel.length) void pressCommand("reference.look", { board: b.id, indices: sel, patch: { flip: key === "h" ? "x" : "y" } });
      else if (!mod && (e.key === "+" || e.key === "=")) zoomAt(mid.x, mid.y, e.shiftKey ? 2 : 1.25);
      else if (!mod && (e.key === "-" || e.key === "_")) zoomAt(mid.x, mid.y, e.shiftKey ? 0.5 : 0.8);
      else if (!mod && (e.key === "0" || e.key === "Home")) void pressCommand("reference.fit", { window: id, board: b.id });
      // F, as on the canvas: the selected pictures in view; again (or none selected): every picture
      else if (!mod && !e.shiftKey && key === "f") {
        const which = sel.join(",");
        const all = !sel.length || fitted === which;
        fitted = all ? "" : which;
        void pressCommand("reference.fit", all ? { window: id, board: b.id } : { window: id, board: b.id, indices: sel });
      }
      // W A S D, as on the canvas: the next picture that way selected, and brought into view
      else if (!mod && !e.shiftKey && "wasd".includes(key) && key.length === 1 && b.items.length) step(b, key, sel);
      else if (!mod && e.key.startsWith("Arrow")) {
        const d = e.shiftKey ? 40 : 4, [ax, ay] = e.key === "ArrowLeft" ? [-1, 0] : e.key === "ArrowRight" ? [1, 0] : e.key === "ArrowUp" ? [0, -1] : [0, 1];
        if (sel.length) void pressCommand("reference.place", { board: b.id, moves: sel.map((j) => ({ i: j, x: b.items[j]!.x + (ax * d) / view.k, y: b.items[j]!.y + (ay * d) / view.k })) });
        else (view = { ...view, x: view.x - ax * d * 10, y: view.y - ay * d * 10 }), clampView(), placeStage(), saveView();
      } else done = e.key === " ";
      if (done) e.preventDefault();
      e.stopPropagation(); // (nothing typed in a reference window reaches the canvas or the Library behind it)
    });
    el.addEventListener("keyup", (e) => {
      if (e.key === " ") space = false, area?.classList.remove("is-panning");
      e.stopPropagation();
    });

    // ---- pictures in: dropped (from the Library, a gallery, another app), or pasted
    body.addEventListener("dragover", (e) => {
      if (!boardOf() || !e.dataTransfer) return;
      if ([...e.dataTransfer.types].some((t) => t === LIBRARY_DRAG || t === "Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    });
    body.addEventListener("drop", (e) => {
      const b = boardOf();
      if (!b || !e.dataTransfer) return;
      e.preventDefault();
      e.stopPropagation();
      const at = onBoard(e.clientX, e.clientY);
      const lib = e.dataTransfer.getData(LIBRARY_DRAG);
      if (lib) return void addTo(b.id, (JSON.parse(lib) as string[]).filter((h) => typeof h === "string"), at);
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
      if (files.length) void deps.importFiles(files).then((hs) => addTo(b.id, hs, at));
    });
    // pictures dragged off the canvas (main.ts: the canvas's move let go over this board)
    body.addEventListener("ref-drop", (e) => {
      const b = boardOf(), d = (e as CustomEvent<{ hashes: string[]; x: number; y: number }>).detail;
      if (b && d) addTo(b.id, d.hashes, onBoard(d.x, d.y));
    });
    el.addEventListener("paste", (e) => {
      e.stopPropagation(); // (never also pasted on the canvas or into the Library behind)
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      e.preventDefault();
      const b = boardOf();
      if (!b) return deps.say("Choose a board in the window to paste pictures on it.");
      const r = area!.getBoundingClientRect();
      const at = onBoard(r.left + r.width / 2, r.top + r.height / 2);
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) return void deps.importFiles(files).then((hs) => addTo(b.id, hs, at));
      const from = copied.length ? copied : deps.canvasPictures();
      if (from.length) addTo(b.id, from, at);
      else deps.say("Nothing to paste: copy pictures on the canvas, in a reference window or in another app first.");
    });
    // Ctrl+C on a board's pictures or the picture shown large: for another board, and the first as a PNG for the canvas or another app (not a hidden one)
    const copy = (e: ClipboardEvent, cut: boolean): void => {
      e.stopPropagation();
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      const b = boardOf();
      const hashes = b ? [...picked].sort((a, c) => a - c).map((j) => b.items[j]?.h).filter((h): h is string => !!h) : one !== null && shown[one] ? [shown[one]!.hash] : [];
      if (!hashes.length) return;
      e.preventDefault();
      copied = hashes;
      if (cut && b) {
        void pressCommand("reference.remove", { board: b.id, indices: [...picked] });
        picked.clear();
      }
      void (async () => {
        const entry = (await listing())?.byHash.get(hashes[0]!);
        if (entry?.hidden) return deps.say("Copied for the boards; a hidden picture is not copied out of the app.");
        const rec = await deps.assets.record(hashes[0]!).catch(() => undefined);
        if (!rec) return;
        try {
          const png = rec.blob.type === "image/png" ? rec.blob : await toPng(rec.blob);
          await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
          deps.say(hashes.length === 1 ? `“${entry?.name ?? "The picture"}” copied.` : `${plural(hashes.length, "picture")} copied (the first for other apps).`);
        } catch {
          deps.say("Copied for the boards; the picture could not go to the system clipboard.");
        }
      })();
    };
    el.addEventListener("copy", (e) => copy(e, false));
    el.addEventListener("cut", (e) => copy(e, true));

    win.render = async (): Promise<void> => {
      const b = boardOf();
      const l = await listing();
      const name = b ? b.name : win.source === "all" ? "All pictures" : l?.folders.find((f) => `folder:${f.id}` === win.source)?.name ?? "All pictures";
      // (the Styles panel's chooser, part for part: the kind's icon, its name, the chevron)
      pickBtn.innerHTML = `${b ? ICONS.referenceWindow : win.source === "all" ? ICONS.images : ICONS.folder}<span class="pg-name">${esc(name)}</span>${ICONS.chevronDown}`;
      el.querySelector<HTMLElement>("[data-ref-filter-row]")!.hidden = !!b; // (a board shows all its pictures: the search is the gallery's)
      if (b) {
        const count = el.querySelector(".layers-count");
        if (count) count.textContent = String(b.items.length);
      }
      el.dataset["mode"] = b ? "board" : "gallery";
      stage = null;
      area = null;
      if (b) await board();
      else await gallery();
    };
    wins.set(id, win);
    win.applyPrefs();
    void win.render();
    keepNow();
    el.focus({ preventScroll: true });
    return win;
  };

  const toPng = async (blob: Blob): Promise<Blob> => {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    bmp.close();
    return new Promise<Blob>((done, fail) => c.toBlob((b) => (b ? done(b) : fail(new Error("no picture"))), "image/png"));
  };

  /** Pictures put on a board, side by side from a point (each 200 board units wide), at most a thousand on one board. */
  const addTo = (board: string, hashes: readonly string[], at: { x: number; y: number }): void => {
    if (hashes.length) void pressCommand("reference.add", { board, ids: [...hashes], x: at.x, y: at.y });
  };
  /** The folders a gallery showed lately (newest first), for the chooser's menu; kept on this device. */
  const RECENT_KEY = "canvast.reference.recentFolders";
  let recentFolders: string[] = (() => {
    try {
      const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
    } catch {
      return [];
    }
  })();
  const rememberFolder = (fid: string): void => {
    recentFolders = [fid, ...recentFolders.filter((x) => x !== fid)].slice(0, 8);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recentFolders));
    } catch {
      /* (no storage: remembered while the page is open) */
    }
  };
  /** Any folder of the library, found by its name in the shared tree chooser (its search, its tree), shown in the window. */
  const chooseFolder = async (w: Win): Promise<void> => {
    const l = await listing();
    if (!l) return;
    const cur = w.source.startsWith("folder:") ? w.source.slice(7) : "";
    const done = await openTreeChooser({
      title: "Show a folder",
      applyLabel: "Show",
      view: chooserView,
      onView: (v) => void (chooserView = v),
      tabs: [{
        id: "folder", title: "Folder", icon: ICONS.folder, openIcon: ICONS.folderOpen, one: true, noun: "folders",
        nodes: [
          { id: "", name: "All pictures", parent: null, icon: ICONS.images, hint: "Every picture of the library", state: cur ? "off" : "on" },
          ...l.folders.filter((f) => deps.hidden() || !f.hidden).map((f): ChoiceNode => ({ id: f.id, name: f.name, parent: f.parentId, state: f.id === cur ? "on" : "off" })),
        ],
      }],
    });
    const on = done?.get("folder")?.on[0];
    if (on === undefined) return;
    void pressCommand("reference.show", { window: w.id, source: on ? `folder:${on}` : "all" });
  };
  let chooserView: ChooserView = "tree";

  /** What can be done to one moodboard: one list of rows for its ⋯ in the chooser and for the window's More menu (DRY). */
  const boardRows = (bid: string, w: Win): MenuItem[] => {
    const go = (command: string, label: string, icon: string, hint: string, extra: Partial<MenuItem> = {}): MenuItem => ({ label, icon, hint, command, run: () => void pressCommand(command, { window: w.id, board: bid }), ...extra });
    return [
      go("reference.open", "Open in a new window", ICONS.referenceWindow, "This moodboard beside this window", { run: () => void pressCommand("reference.open", { source: `board:${bid}` }) }),
      go("reference.renameBoard", "Rename…", ICONS.textCursorInput, "A new name for it"),
      go("reference.duplicateBoard", "Duplicate", ICONS.copy, "A copy, with the same pictures"),
      go("reference.arrange", "Arrange in a grid", ICONS.arrangeMenu, "Its pictures in rows, tidy"),
      go("reference.fit", "Fit in the window", ICONS.shrink, "Every picture in sight (0)"),
      go("reference.export", "Save as a picture", ICONS.imageDown, "A PNG of it, into the library"),
      go("reference.deleteBoard", "Delete", ICONS.trash, "Its pictures stay in the library", { danger: true, sep: true }),
    ];
  };
  /** A picture's file, or its thumbnail when the file cannot be read (null: neither, or a hidden one out of hidden mode). */
  const blobOf = async (hash: string, maxBytes = Infinity): Promise<Blob | null> => {
    const entry = (await listing())?.byHash.get(hash);
    if (!entry || (entry.hidden && !deps.hidden())) return null;
    const full = (await deps.assets.record(hash).catch(() => undefined))?.blob;
    return full && full.size <= maxBytes ? full : ((await session.catalog?.thumb(hash).catch(() => undefined))?.blob ?? full ?? null);
  };
  const dataUrl = (b: Blob): Promise<string> => new Promise((done, fail) => {
    const r = new FileReader();
    r.onload = () => done(String(r.result));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(b);
  });
  const extentOf = (items: readonly Item[]) => {
    const minX = Math.min(...items.map((i) => i.x)), minY = Math.min(...items.map((i) => i.y));
    return { minX, minY, w: Math.max(...items.map((i) => i.x + i.w)) - minX, h: Math.max(...items.map((i) => i.y + i.w * (ratio.get(i.h) ?? 0.75))) - minY };
  };

  /** A moodboard drawn into one PNG, as it is shown (turned, flipped, grey, see-through), at most 4,096 px a side. */
  const boardPicture = async (b: Board): Promise<Blob | null> => {
    const ex = extentOf(b.items), k = Math.min(4, 4096 / Math.max(ex.w, ex.h, 1));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(ex.w * k));
    c.height = Math.max(1, Math.round(ex.h * k));
    const g = c.getContext("2d");
    if (!g) return null;
    for (const it of b.items) {
      const blob = await blobOf(it.h);
      const bmp = blob && (await createImageBitmap(blob).catch(() => null));
      if (!bmp) continue;
      const w = it.w * k, h = w * (bmp.height / Math.max(1, bmp.width));
      g.save();
      g.translate((it.x - ex.minX) * k + w / 2, (it.y - ex.minY) * k + h / 2);
      g.rotate(((it.r ?? 0) * Math.PI) / 180);
      g.scale(it.fx ? -1 : 1, it.fy ? -1 : 1);
      g.globalAlpha = it.o ?? 1;
      g.filter = it.grey ? "grayscale(1)" : "none";
      g.drawImage(bmp, -w / 2, -h / 2, w, h);
      g.restore();
      bmp.close();
    }
    return new Promise<Blob | null>((done) => c.toBlob(done, "image/png"));
  };

  /**
   * The page a floated window shows (the desktop app's window over every app): what the reference window shows now, its pictures in it
   * (files up to 4 MB, thumbnails past that), panned with a drag and zoomed with the wheel. View only; a snapshot of now.
   */
  const floatPage = async (w: Win): Promise<{ title: string; html: string } | null> => {
    const b = w.source.startsWith("board:") ? boardById(w.source.slice(6)) : undefined;
    const l = await listing();
    let inner = "", title = "Reference";
    if (b) {
      title = b.name;
      const ex = extentOf(b.items);
      for (const it of b.items) {
        const blob = await blobOf(it.h, 4 * 1024 * 1024);
        if (!blob) continue;
        const img = `transform:${it.fx || it.fy ? `scale(${it.fx ? -1 : 1},${it.fy ? -1 : 1})` : "none"};${it.grey ? "filter:grayscale(1);" : ""}`;
        inner += `<div style="position:absolute;left:${it.x - ex.minX}px;top:${it.y - ex.minY}px;width:${it.w}px;${it.r ? `transform:rotate(${it.r}deg);` : ""}${it.o !== undefined ? `opacity:${it.o};` : ""}"><img src="${await dataUrl(blob)}" style="width:100%;display:block;${img}"></div>`;
      }
    } else {
      const fid = w.source.startsWith("folder:") ? w.source.slice(7) : null;
      title = fid ? (l?.folders.find((f) => f.id === fid)?.name ?? "Reference") : "All pictures";
      const pics = l?.entries.filter((e) => isPicture(e) && shows(e) && (!fid || e.folderIds?.includes(fid))).sort((a, c) => c.importedAt - a.importedAt).slice(0, 60) ?? [];
      let x = 0;
      const TILE = 200; // (the floated page is a page of its own, not the app's: its sizes are its own)
      for (const e of pics) {
        const blob = await blobOf(e.hash, 512 * 1024);
        if (blob) inner += `<img src="${await dataUrl(blob)}" style="position:absolute;left:${(x % 6) * (TILE + 10)}px;top:${Math.floor(x++ / 6) * (TILE + 10)}px;width:${TILE}px">`;
      }
    }
    if (!inner) return null;
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${esc(title)}</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#1e1e1e}#s{position:absolute;left:0;top:0;transform-origin:0 0}</style></head><body><div id="s">${inner}</div>
<script>const s=document.getElementById("s");let v={x:0,y:0,k:1};const put=()=>s.style.transform="translate("+v.x+"px,"+v.y+"px) scale("+v.k+")";
const fit=()=>{const r=s.getBoundingClientRect(),w=r.width/v.k,h=r.height/v.k,k=Math.min(innerWidth/w,innerHeight/h)*0.95;v={k,x:(innerWidth-w*k)/2,y:(innerHeight-h*k)/2};put();};
addEventListener("load",fit);addEventListener("dblclick",fit);
addEventListener("wheel",(e)=>{e.preventDefault();const f=Math.exp(-e.deltaY*0.0025),k=Math.min(16,Math.max(0.05,v.k*f));v={k,x:e.clientX-(e.clientX-v.x)*k/v.k,y:e.clientY-(e.clientY-v.y)*k/v.k};put();},{passive:false});
let d=null;addEventListener("pointerdown",(e)=>{d={x:e.clientX-v.x,y:e.clientY-v.y};});addEventListener("pointermove",(e)=>{if(d){v.x=e.clientX-d.x;v.y=e.clientY-d.y;put();}});addEventListener("pointerup",()=>{d=null;});</script></body></html>`;
    return { title, html };
  };

  /** Every moodboard in one list (the shared list dialog): open, rename, copy or delete each. */
  const manage = (w?: Win): void => {
    const btn = (attrs: string, label: string): string => `<button type="button" class="set-done" ${attrs}>${label}</button>`;
    manageList = listDialog({
      title: "Moodboards",
      lines: ["Saved with this workspace. Their pictures stay in the library whatever is done here."],
      testid: "reference-manage",
      body: () =>
        boards().map((b) => plainRowHtml({ label: esc(b.name), help: plural(b.items.length, "picture"), control: btn(`data-mb-act="open" data-mb="${esc(b.id)}"`, "Open") + btn(`data-mb-act="rename" data-mb="${esc(b.id)}"`, "Rename…") + btn(`data-mb-act="copy" data-mb="${esc(b.id)}"`, "Duplicate") + `<button type="button" class="set-reset" data-mb-act="delete" data-mb="${esc(b.id)}" aria-label="Delete ${esc(b.name)}" title="Delete: its pictures stay in the library">${ICONS.trash}</button>` })).join("") ||
        `<p class="set-help">None yet: make one from a reference window's list (New moodboard…).</p>`,
      // (the list is drawn again when the moodboards change: renderAll)
      onClick: (t) => {
        const a = t.closest<HTMLElement>("[data-mb-act]");
        if (!a) return;
        const bid = a.dataset["mb"]!, act = a.dataset["mbAct"];
        if (act === "open") pressCommand(w ? "reference.show" : "reference.open", w ? { window: w.id, source: `board:${bid}` } : { source: `board:${bid}` });
        else pressCommand(act === "rename" ? "reference.renameBoard" : act === "copy" ? "reference.duplicateBoard" : "reference.deleteBoard", { board: bid });
      },
    });
  };

  const newBoard = async (w?: Win): Promise<void> => {
    const name = await promptDialog({ title: "New moodboard", lines: ["Pictures to keep in sight, laid out as you like, saved with this workspace."], value: `Moodboard ${boards().length + 1}`, confirmLabel: "Make it" });
    if (name === null) return void w?.render();
    void pressCommand("reference.newBoard", { name, ...(w ? { window: w.id } : {}) });
  };
  let manageList: { refresh(): void } | null = null;
  const renderAll = (): void => {
    manageList?.refresh();
    for (const w of wins.values()) void w.render();
  };
  const winOf = (o: Readonly<Record<string, unknown>>): Win | undefined => (typeof o["window"] === "string" ? wins.get(o["window"]) : undefined);
  const indices = (v: unknown, b: Board): number[] => (Array.isArray(v) ? [...new Set(v.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < b.items.length))] : []);

  // ---- commands (ADR 0205): every action of the windows, for the buttons, menus, keys, macros and outside callers alike
  const ID: OptionSpec = { name: "board", type: "id", doc: "the moodboard's id", required: true };
  const rc = (id: string, title: string, hint: string, risk: NonNullable<Command["risk"]>, options: readonly OptionSpec[], exec: NonNullable<Command["exec"]>, why: () => string | null = () => null): Command => ({ id, group: "Reference", kind: "reference", title, hint, icon: ICONS.referenceWindow, risk, options, why, exec });
  const hasBoard = (o: Readonly<Record<string, unknown>>): Board | null => boardById(String(o["board"] ?? "")) ?? null;
  commands.setProvider("reference", () => [
    rc("reference.open", "Reference window", "A gallery or a moodboard, over every view", "read", [{ name: "source", type: "text", doc: "all, folder:<id> or board:<id> (a moodboard; all when left out)" }], (o) => {
      const w = open(typeof o["source"] === "string" ? o["source"] : "all");
      return { ok: true, value: w.id };
    }),
    rc("reference.show", "Show in a reference window", "A moodboard, all pictures or a folder", "read", [{ name: "window", type: "text", doc: "the window", required: true }, { name: "source", type: "text", doc: "all, folder:<id> or board:<id>", required: true }], (o) => {
      const w = winOf(o), src = String(o["source"]);
      if (!w) return { ok: false, error: "No such window." };
      if (!/^(all|folder:.+|board:.+)$/.test(src)) return { ok: false, error: '"source" is all, folder:<id> or board:<id>.' };
      if (src.startsWith("folder:")) rememberFolder(src.slice(7));
      w.source = src;
      keepNow();
      void w.render();
      return { ok: true };
    }),
    rc("reference.newBoard", "New moodboard", "An empty moodboard of references", "edit", [{ name: "name", type: "text", doc: "its name", required: true }, { name: "window", type: "text", doc: "the window to show it in (a new one when left out)" }], (o) => {
      const name = String(o["name"]).trim().slice(0, 80) || "Board";
      const all = boards();
      if (all.length >= 100) return { ok: false, error: "There are 100 moodboards already: delete one first." };
      const b: Board = { id: newObjectId(), name, items: [] };
      settings.set("reference.boards", JSON.stringify([...all, b]));
      const w = winOf(o);
      if (w) {
        w.source = `board:${b.id}`;
        keepNow();
        void w.render();
      } else open(`board:${b.id}`);
      return { ok: true, made: [b.id] };
    }),
    rc("reference.renameBoard", "Rename the moodboard", "A new name for it", "edit", [ID, { name: "name", type: "text", doc: "its new name (asked when left out)" }], async (o) => {
      const b = hasBoard(o);
      if (!b) return { ok: false, error: "No such moodboard." };
      const name = typeof o["name"] === "string" ? o["name"] : await promptDialog({ title: "Rename the moodboard", lines: [], value: b.name, confirmLabel: "Rename" });
      if (name === null) return { ok: true };
      updateBoard(b.id, (x) => ({ ...x, name: name.trim().slice(0, 80) || x.name }), false);
      renderAll();
      return { ok: true, changed: [b.id] };
    }),
    rc("reference.deleteBoard", "Delete the moodboard", "Its pictures stay in the library", "confirm", [ID], async (o, ctx) => {
      const b = hasBoard(o);
      if (!b) return { ok: false, error: "No such moodboard." };
      if (ctx.caller !== "agent" && !(await confirmDialog({ title: `Delete the moodboard “${b.name}”?`, lines: [`Its ${plural(b.items.length, "picture")} stay in the library; only the moodboard goes.`], confirmLabel: "Delete it" }))) return { ok: true };
      settings.set("reference.boards", JSON.stringify(boards().filter((x) => x.id !== b.id)));
      history.delete(b.id);
      for (const w of wins.values()) if (w.source === `board:${b.id}`) w.source = "all";
      keepNow();
      renderAll();
      return { ok: true, removed: [b.id] };
    }),
    rc("reference.add", "Put pictures on a moodboard", "Library files, side by side", "edit", [ID, { name: "ids", type: "ids", doc: "the library files (their hashes)", required: true }, { name: "x", type: "number", doc: "where, across" }, { name: "y", type: "number", doc: "where, down" }], async (o) => {
      const b = hasBoard(o);
      if (!b) return { ok: false, error: "No such moodboard." };
      listed = null; // (a picture just imported is in the library now)
      const l = await listing();
      const hs = ((o["ids"] as string[]) ?? []).filter((h) => isPicture(l?.byHash.get(h)));
      if (!hs.length) return { ok: false, error: "Those are not pictures of the library." };
      const room = MAX_ITEMS - b.items.length;
      if (room <= 0) return { ok: false, error: `A moodboard holds at most ${MAX_ITEMS} pictures.` };
      const x = Number(o["x"] ?? 0), y = Number(o["y"] ?? 0);
      const items = hs.slice(0, room).map((h, i): Item => ({ h, x: x + (i % 6) * 220, y: y + Math.floor(i / 6) * 220, w: 200 }));
      updateBoard(b.id, (bd) => ({ ...bd, items: [...bd.items, ...items] }));
      return { ok: true, changed: [b.id] };
    }),
    rc("reference.place", "Move pictures on a moodboard", "Where each is, or how wide", "edit", [ID, { name: "moves", type: "json", doc: "a list of { i: which picture (from 0), x, y, w }", required: true }], (o) => {
      const b = hasBoard(o);
      const moves = Array.isArray(o["moves"]) ? (o["moves"] as Array<Record<string, unknown>>) : [];
      if (!b || !moves.length || !moves.every((m) => typeof m === "object" && m !== null && b.items[Number(m["i"])])) return { ok: false, error: "No such picture on that moodboard." };
      const n = (m: Record<string, unknown>, k: string, now: number, min = -1e7): number => (typeof m[k] === "number" && Number.isFinite(m[k]) ? Math.max(min, Math.min(1e7, m[k] as number)) : now);
      const by = new Map(moves.map((m) => [Number(m["i"]), m]));
      updateBoard(b.id, (bd) => ({ ...bd, items: bd.items.map((it, j) => { const m = by.get(j); return m ? { ...it, x: n(m, "x", it.x), y: n(m, "y", it.y), w: n(m, "w", it.w, 16) } : it; }) }));
      return { ok: true, changed: [b.id] };
    }),
    rc("reference.remove", "Take pictures off a moodboard", "They stay in the library", "edit", [ID, { name: "indices", type: "json", doc: "which pictures (from 0), as a list", required: true }], (o) => {
      const b = hasBoard(o);
      const gone = b ? new Set(indices(o["indices"], b)) : new Set<number>();
      if (!b || !gone.size) return { ok: false, error: "No such picture on that moodboard." };
      updateBoard(b.id, (bd) => ({ ...bd, items: bd.items.filter((_, j) => !gone.has(j)) }));
      return { ok: true, changed: [b.id] };
    }),
    ...(["undo", "redo"] as const).map((dir) =>
      rc(`reference.${dir}`, dir === "undo" ? "Undo on the moodboard" : "Redo on the moodboard", dir === "undo" ? "The board's last change (Ctrl+Z)" : "The change undone (Ctrl+Shift+Z)", "edit", [ID], (o) => {
        const b = hasBoard(o), h = b && history.get(b.id);
        const from = h ? (dir === "undo" ? h.back : h.ahead) : [];
        const items = from.pop();
        if (!b || !h || !items) return { ok: false, error: dir === "undo" ? "Nothing to undo on this moodboard." : "Nothing to redo on this moodboard." };
        (dir === "undo" ? h.ahead : h.back).push(b.items);
        updateBoard(b.id, (bd) => ({ ...bd, items }), false);
        return { ok: true, changed: [b.id] };
      }),
    ),
    rc("reference.look", "Show pictures another way", "Flipped, turned, grey or see-through", "edit", [ID, { name: "indices", type: "json", doc: "which pictures (from 0), as a list", required: true }, { name: "patch", type: "json", doc: "flip: x or y (each a toggle), turn: degrees added, grey: true or false, opacity: 0.1 to 1", required: true }], (o) => {
      const b = hasBoard(o), at = b ? new Set(indices(o["indices"], b)) : new Set<number>(), p = (o["patch"] ?? {}) as Record<string, unknown>;
      if (!b || !at.size) return { ok: false, error: "No such picture on that moodboard." };
      const look = (it: Item): Item => {
        const { fx, fy, r, grey, o: op, ...rest } = it;
        const nfx = p["flip"] === "x" ? !fx : !!fx, nfy = p["flip"] === "y" ? !fy : !!fy;
        const nr = (((r ?? 0) + (typeof p["turn"] === "number" ? p["turn"] : 0)) % 360 + 360) % 360;
        const ng = typeof p["grey"] === "boolean" ? p["grey"] : !!grey;
        const no = typeof p["opacity"] === "number" && Number.isFinite(p["opacity"]) ? Math.min(1, Math.max(0.1, p["opacity"])) : op ?? 1;
        return { ...rest, ...(nfx ? { fx: true as const } : {}), ...(nfy ? { fy: true as const } : {}), ...(nr ? { r: nr } : {}), ...(ng ? { grey: true as const } : {}), ...(no < 1 ? { o: no } : {}) };
      };
      // (an opacity dragged on its slider: one undo step for the whole drag)
      const onlyOpacity = Object.keys(p).length === 1 && "opacity" in p;
      updateBoard(b.id, (bd) => ({ ...bd, items: bd.items.map((it, j) => (at.has(j) ? look(it) : it)) }), true, onlyOpacity ? `opacity:${[...at].join(",")}` : "");
      return { ok: true, changed: [b.id] };
    }),
    rc("reference.order", "Bring pictures forward or back", "Over the others, or under them", "edit", [ID, { name: "indices", type: "json", doc: "which pictures (from 0), as a list", required: true }, { name: "to", type: "choice", doc: "front or back", required: true, choices: ["front", "back"] }], (o) => {
      const b = hasBoard(o), at = b ? new Set(indices(o["indices"], b)) : new Set<number>();
      if (!b || !at.size) return { ok: false, error: "No such picture on that moodboard." };
      const these = b.items.filter((_, j) => at.has(j)), rest = b.items.filter((_, j) => !at.has(j));
      updateBoard(b.id, (bd) => ({ ...bd, items: o["to"] === "front" ? [...rest, ...these] : [...these, ...rest] }));
      return { ok: true, changed: [b.id] };
    }),
    rc("reference.arrange", "Arrange in a grid", "Pictures in rows, tidy", "edit", [ID, { name: "indices", type: "json", doc: "which pictures (from 0), as a list; all when left out" }], (o) => {
      const b = hasBoard(o);
      if (!b || !b.items.length) return { ok: false, error: "No pictures on that moodboard." };
      const at = o["indices"] === undefined ? new Set(b.items.map((_, j) => j)) : new Set(indices(o["indices"], b));
      const these = [...at].sort((x, y) => x - y), first = b.items[these[0]!]!;
      // rows about as wide as tall, each picture as wide as the widest, a gap of a tenth of it; from where the first one is
      const cols = Math.max(1, Math.ceil(Math.sqrt(these.length))), w = Math.max(...these.map((j) => b.items[j]!.w)), gap = w / 10;
      const hOf = (j: number): number => b.items[j]!.w * (ratio.get(b.items[j]!.h) ?? 0.75);
      let y = first.y;
      const placed = new Map<number, Item>();
      for (let r = 0; r * cols < these.length; r++) {
        const row = these.slice(r * cols, r * cols + cols);
        row.forEach((j, c) => placed.set(j, { ...b.items[j]!, x: first.x + c * (w + gap), y }));
        y += Math.max(...row.map(hOf)) + gap;
      }
      updateBoard(b.id, (bd) => ({ ...bd, items: bd.items.map((it, j) => placed.get(j) ?? it) }));
      return { ok: true, changed: [b.id] };
    }),
    rc("reference.duplicateBoard", "Duplicate the moodboard", "A copy with the same pictures", "edit", [ID, { name: "window", type: "text", doc: "the window to show the copy in" }], (o) => {
      const b = hasBoard(o), all = boards();
      if (!b) return { ok: false, error: "No such moodboard." };
      if (all.length >= 100) return { ok: false, error: "There are 100 moodboards already: delete one first." };
      const copy: Board = { ...b, id: newObjectId(), name: `${b.name} copy`.slice(0, 80) };
      settings.set("reference.boards", JSON.stringify([...all, copy]));
      const w = winOf(o);
      if (w) (w.source = `board:${copy.id}`), keepNow();
      renderAll();
      return { ok: true, made: [copy.id] };
    }),
    rc("reference.export", "Save the moodboard as a picture", "A PNG of it, into the library", "edit", [ID], async (o) => {
      const b = hasBoard(o);
      if (!b || !b.items.length) return { ok: false, error: "No pictures on that moodboard." };
      const png = await boardPicture(b);
      if (!png) return { ok: false, error: "The moodboard could not be drawn." };
      const [h] = await deps.importFiles([new File([png], `${b.name}.png`, { type: "image/png" })]);
      deps.say(h ? `“${b.name}.png” is in the library.` : "The picture could not be saved.");
      return h ? { ok: true, made: [h] } : { ok: false, error: "The picture could not be saved." };
    }),
    rc("reference.toCanvas", "Place on the canvas", "Library pictures, in the middle of the view", "edit", [{ name: "ids", type: "ids", doc: "the library files (their hashes)", required: true }], async (o) => {
      const n = await deps.place((o["ids"] as string[]) ?? []);
      return n ? { ok: true } : { ok: false, error: "Open a canvas to place pictures on it." };
    }),
    rc("reference.window", "Set the reference window", "Folded, see-through, clicks through, the gallery's order", "read", [{ name: "window", type: "text", doc: "the window", required: true }, { name: "fold", type: "boolean", doc: "folded to its title" }, { name: "opacity", type: "number", doc: "0.2 to 1" }, { name: "through", type: "boolean", doc: "clicks go through to what is under it (its title still takes them)" }, { name: "sort", type: "choice", doc: "the gallery's order", choices: ["new", "old", "az", "za"] }, { name: "size", type: "choice", doc: "the gallery's pictures", choices: ["s", "m", "l"] }, { name: "look", type: "boolean", doc: "the Opacity strip under its title shown" }], (o) => {
      const w = winOf(o);
      if (!w) return { ok: false, error: "No such window." };
      const p = { ...w.prefs };
      if (typeof o["fold"] === "boolean") p.folded = o["fold"];
      if (typeof o["opacity"] === "number" && Number.isFinite(o["opacity"])) p.opacity = Math.min(1, Math.max(0.2, o["opacity"]));
      if (typeof o["through"] === "boolean") p.through = o["through"];
      if (o["sort"] === "new" || o["sort"] === "old" || o["sort"] === "az" || o["sort"] === "za") p.sort = o["sort"];
      if (o["size"] === "s" || o["size"] === "m" || o["size"] === "l") p.size = o["size"];
      if (typeof o["look"] === "boolean") p.look = o["look"];
      w.prefs = p;
      w.applyPrefs();
      keepNow();
      void w.render();
      return { ok: true };
    }),
    rc("reference.slideshow", "Slideshow", "The gallery's pictures one after another", "read", [{ name: "window", type: "text", doc: "the window", required: true }], (o) => {
      const w = winOf(o);
      if (!w || w.source.startsWith("board:")) return { ok: false, error: "A gallery's window has a slideshow." };
      w.slideshow();
      return { ok: true };
    }),
    rc("reference.float", "Float over other apps", "A window above every app, view only", "read", [{ name: "window", type: "text", doc: "the window", required: true }], async (o) => {
      const w = winOf(o);
      if (!w || !deps.float) return { ok: false, error: "Only the desktop app floats a window over other apps." };
      const page = await floatPage(w);
      if (!page) return { ok: false, error: "Nothing to show in it." };
      await deps.float(page.title, page.html);
      return { ok: true };
    }, () => (deps.float ? null : "Only in the desktop app.")),
    rc("reference.manage", "Manage moodboards", "Rename, copy, open or delete them", "read", [{ name: "window", type: "text", doc: "the window to open one in" }], (o) => {
      manage(winOf(o));
      return { ok: true };
    }),
    rc("reference.fit", "Fit the moodboard", "Every picture in sight, or the ones named", "read", [{ name: "window", type: "text", doc: "the window", required: true }, ID, { name: "indices", type: "json", doc: "only these pictures (from 0), as a list" }], (o) => {
      const w = winOf(o), b = hasBoard(o);
      if (!w || !b) return { ok: false, error: "No such window or moodboard." };
      const area = w.el.querySelector<HTMLElement>("[data-ref-board]");
      const these = o["indices"] === undefined ? b.items : indices(o["indices"], b).map((j) => b.items[j]!);
      if (!area || !these.length) return { ok: true };
      const ex = extentOf(these), minX = ex.minX, minY = ex.minY, maxX = ex.minX + ex.w, maxY = ex.minY + ex.h;
      const k = Math.min(8, Math.max(0.05, Math.min((area.clientWidth - 24) / Math.max(1, maxX - minX), (area.clientHeight - 24) / Math.max(1, maxY - minY))));
      updateBoard(b.id, (bd) => ({ ...bd, view: { k, x: 12 - minX * k + (area.clientWidth - 24 - (maxX - minX) * k) / 2, y: 12 - minY * k } }), false);
      void w.render();
      return { ok: true };
    }),
  ]);

  // the windows open last time, opened again
  for (const w of read<{ source: string; x: number; y: number; w: number; h: number }>("reference.windows")) open(w.source, w);
  return {
    open: (s) => void open(s),
    // (the library or the hidden items changed: read again, drawn again)
    refresh: () => {
      listed = null;
      renderAll();
    },
  };
}
