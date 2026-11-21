import type { AssetLibrary } from "../assets/asset-library";
import type { AssetFolder, CatalogEntry } from "../assets/asset-catalog";
import type { Session } from "../app/session";
import type { SettingsStore } from "../settings/settings";
import { commands, pressCommand } from "../commands/registry";
import type { Command, OptionSpec } from "../commands/types";
import { folderPath } from "../assets/asset-catalog";
import { newObjectId } from "../doc/model";
import { plural } from "../doc/plural";
import { confirmDialog, promptDialog } from "./confirm";
import { esc } from "./format";
import { ICONS } from "./icons";
import { commandRows, openMoreMenu } from "./more-menu";
import { panelHtml } from "./panel";
import { showMoreButton } from "./show-more";

/**
 * Reference windows (ADR 0207): small windows that float over every view (the canvas, the Library, PhotoCraft, Settings), above the bars and
 * panels and under menus and dialogs, to keep references in sight while working. One shows a **gallery** (the pictures of a library folder,
 * or all of them), the other a **board**: a simple surface, panned and zoomed as the canvas is but not endless, where pictures dragged from
 * the Library, the canvas or another app are laid out. Boards are saved with the workspace (Settings `reference.boards`); the windows open
 * on a device are opened again (`reference.windows`). A window only shows: it changes no picture. Hidden items show only while the hidden
 * items do, as on a canvas (a padlock in their place otherwise). Keys, pastes and the wheel inside a window are the window's: they never
 * reach the canvas or the Library behind it.
 */

export type RefSource = string; // "all" | "folder:<id>" | "board:<id>"
interface Item { h: string; x: number; y: number; w: number }
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
  /** A board's change (one undo step of the board's own history), then each window showing it follows. */
  const history = new Map<string, { back: Item[][]; ahead: Item[][] }>();
  const updateBoard = (id: string, f: (b: Board) => Board, step = true): void => {
    const all = boards();
    const was = all.find((b) => b.id === id);
    if (!was) return;
    const now = f(was);
    if (step && JSON.stringify(now.items) !== JSON.stringify(was.items)) {
      const h = history.get(id) ?? { back: [], ahead: [] };
      h.back.push(was.items);
      if (h.back.length > 100) h.back.shift();
      h.ahead = [];
      history.set(id, h);
    }
    settings.set("reference.boards", JSON.stringify(all.map((b) => (b.id === id ? now : b))));
    for (const w of wins.values()) if (w.source === `board:${id}`) w.sync();
  };

  // ---- pictures: a thumbnail at first, the file itself when shown large; one address per file, for every window
  const urls = new Map<string, { thumb?: Promise<string | null>; full?: Promise<string | null> }>();
  const urlOf = (hash: string, full: boolean): Promise<string | null> => {
    const at = urls.get(hash) ?? {};
    urls.set(hash, at);
    const key = full ? "full" : "thumb";
    at[key] ??= (async () => {
      const blob = full ? (await deps.assets.record(hash).catch(() => undefined))?.blob : (await session.catalog?.thumb(hash).catch(() => undefined))?.blob;
      return blob ? URL.createObjectURL(blob) : full ? urlOf(hash, false) : null;
    })();
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
  let keepTimer = 0;
  /** Where the windows are, kept for the next start: once they rest, not at every step of a move or a resize. */
  const keepWindows = (): void => {
    clearTimeout(keepTimer);
    keepTimer = window.setTimeout(() => settings.set("reference.windows", JSON.stringify([...wins.values()].map((w) => ({ source: w.source, x: w.el.offsetLeft, y: w.el.offsetTop, w: w.el.offsetWidth, h: w.el.offsetHeight })))), 500);
  };

  interface Win { id: string; source: RefSource; el: HTMLElement; render(): Promise<void>; sync(): void; close(): void }

  /** The pictures copied in a reference window last (Ctrl+C there), to paste on another board. */
  let copied: string[] = [];

  const open = (source: RefSource = "all", at?: { x: number; y: number; w: number; h: number }): Win => {
    const id = newObjectId();
    const el = document.createElement("aside");
    el.className = "layers-panel ref-window";
    el.dataset["testid"] = "reference-window";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Reference window");
    el.tabIndex = -1;
    el.innerHTML = panelHtml({
      title: "Reference",
      tools: `<button type="button" class="ref-source" data-ref-source aria-haspopup="listbox" aria-expanded="false" aria-label="What it shows" title="What it shows: a gallery of the library, or a board"><span data-ref-source-name></span>${ICONS.chevronDown}</button><button type="button" class="layer-btn" data-ref-more aria-haspopup="menu" aria-label="Boards" title="Boards: a new one, rename or delete this one, fit it in the window">${ICONS.ellipsis}</button>`,
      body: `<div class="ref-body" data-ref-body></div>`,
    });
    const n = wins.size;
    const box = at ?? { x: Math.max(8, window.innerWidth - 380 - 24 * n), y: 72 + 24 * n, w: 360, h: 300 };
    Object.assign(el.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${Math.max(MIN_W, box.w)}px`, height: `${Math.max(MIN_H, box.h)}px` });
    document.body.append(el);
    const body = el.querySelector<HTMLElement>("[data-ref-body]")!;
    const pickBtn = el.querySelector<HTMLButtonElement>("[data-ref-source]")!;
    const win: Win = { id, source, el, render: async () => undefined, sync: () => undefined, close: () => undefined };
    let choosing = false;

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
    new ResizeObserver(() => keepWindows()).observe(el);
    // view-state: (closes this window; its board is kept)
    el.querySelector("[data-close]")!.addEventListener("click", () => win.close());
    win.close = (): void => {
      el.remove();
      wins.delete(id);
      keepWindows();
    };
    // view-state: (the list of what this window can show, inside it: a click on one shows it; a new board is the command's)
    pickBtn.addEventListener("click", () => {
      choosing = !choosing;
      void win.render();
    });
    el.querySelector<HTMLElement>("[data-ref-more]")!.addEventListener("click", (e) => {
      const b = win.source.startsWith("board:") ? win.source.slice(6) : null;
      openMoreMenu(e.currentTarget as HTMLElement, commandRows([
        ["reference.newBoard", { hint: "An empty board in this window" }] as const,
        ...(b ? [["reference.renameBoard", { hint: "A new name for this board" }] as const, ["reference.fit", { hint: "Every picture in sight (0)" }] as const, ["reference.deleteBoard", { hint: "This board; its pictures stay in the library", danger: true }] as const] : []),
      ]).map((r) => ({ ...r, run: () => (r.command === "reference.newBoard" ? void newBoard(win) : void pressCommand(r.command, { window: id, board: b ?? "" })) })), "Boards");
    });
    // The window takes the focus when pressed, so its keys are its own (not the canvas's behind it)
    el.addEventListener("pointerdown", (e) => {
      if (!(e.target as HTMLElement).closest("input, button, select, [tabindex]:not(.ref-window)")) el.focus({ preventScroll: true });
    }, true);

    // ---- the list of what it shows: all pictures, a folder (as a tree), a board, a new board; searched by name
    let filter = "";
    const chooser = async (): Promise<void> => {
      const l = await listing();
      const folders = (l?.folders ?? []).filter((f) => deps.hidden() || !f.hidden);
      const depth = (f: AssetFolder): number => folderPath(l!.folders, f.id).length - 1;
      const tree = folders.map((f) => ({ f, path: folderPath(l!.folders, f.id) })).sort((a, b) => a.path.join("\u0000").localeCompare(b.path.join("\u0000")));
      const q = filter.trim().toLowerCase();
      const row = (value: string, icon: string, label: string, title: string, d = 0): string => `<button type="button" class="ref-choice${value === win.source ? " is-on" : ""}" role="option" aria-selected="${value === win.source}" data-ref-choose="${esc(value)}" style="--depth:${d}" title="${esc(title)}">${icon}<span>${esc(label)}</span></button>`;
      const fold = tree.filter((t) => !q || t.path.join(" ").toLowerCase().includes(q));
      const bs = boards().filter((b) => !q || b.name.toLowerCase().includes(q));
      body.innerHTML = `<div class="ref-chooser" role="listbox" aria-label="What it shows"><input type="search" class="ref-filter" data-ref-filter placeholder="Find a folder or a board" aria-label="Find a folder or a board" value="${esc(filter)}">
        <p class="ref-group">Boards</p>${bs.map((b) => row(`board:${b.id}`, ICONS.referenceWindow, b.name, `${b.name}: ${plural(b.items.length, "picture")}`)).join("")}${row("new", ICONS.plus, "New board…", "A new, empty board")}
        <p class="ref-group">Gallery</p>${!q ? row("all", ICONS.images, "All pictures", "Every picture of the library") : ""}${fold.map((t) => row(`folder:${t.f.id}`, ICONS.folder, q ? t.path.join(" › ") : t.f.name, t.path.join(" › "), q ? 0 : depth(t.f))).join("")}</div>`;
      const input = body.querySelector<HTMLInputElement>("[data-ref-filter]")!;
      input.focus({ preventScroll: true });
      input.setSelectionRange(filter.length, filter.length);
      // view-state: (the list narrowed to what the words find)
      input.addEventListener("input", () => {
        filter = input.value;
        void chooser();
      });
    };
    // view-state: (a choice of the list: what this window shows; a new board is the command's, through its dialog)
    body.addEventListener("click", (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>("[data-ref-choose]");
      if (!c) return;
      choosing = false;
      filter = "";
      if (c.dataset["refChoose"] === "new") return void newBoard(win);
      win.source = c.dataset["refChoose"]!;
      picked.clear();
      keepWindows();
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
      shown = l.entries.filter((e) => isPicture(e) && shows(e) && (!fid || e.folderIds?.some((f) => under.has(f)))).sort((a, b) => b.importedAt - a.importedAt);
      if (one !== null && shown[one]) {
        const e = shown[one]!;
        body.innerHTML = `<div class="ref-one"><img data-ref-big alt="${esc(e.name)}" draggable="false"><div class="ref-one-bar"><button type="button" class="layer-btn" data-ref-back aria-label="Back to the gallery" title="Back to the gallery (Esc)">${ICONS.layoutGrid}</button><span class="ref-one-name" title="${esc(e.name)}">${esc(e.name)}</span><button type="button" class="layer-btn" data-ref-prev aria-label="Previous picture" title="Previous picture (←)">${ICONS.chevronLeft}</button><button type="button" class="layer-btn" data-ref-next aria-label="Next picture" title="Next picture (→)">${ICONS.chevronRight}</button></div></div>`;
        void urlOf(e.hash, true).then((u) => { const img = body.querySelector<HTMLImageElement>("[data-ref-big]"); if (img && u) img.src = u; });
        return;
      }
      one = null;
      const count = Math.min(shown.length, pages * PAGE);
      body.innerHTML = shown.length
        ? `<p class="adj-note">${plural(shown.length, "picture")}</p><div class="ref-grid">${shown.slice(0, count).map((e, i) => `<button type="button" class="ref-thumb" data-ref-i="${i}" draggable="true" title="${esc(e.name)}" aria-label="${esc(e.name)}"><img alt="" draggable="false" loading="lazy" decoding="async"></button>`).join("")}</div>${count < shown.length ? showMoreButton({ attrs: "data-ref-page", hidden: shown.length - count, label: `Show ${Math.min(PAGE, shown.length - count)} more` }) : ""}`
        : `<p class="adj-note">No pictures here${deps.hidden() ? "" : " (hidden ones show in hidden mode)"}.</p>`;
      const io = new IntersectionObserver((seen) => {
        for (const s of seen) {
          if (!s.isIntersecting) continue;
          io.unobserve(s.target);
          const e = shown[Number((s.target as HTMLElement).dataset["refI"])];
          if (e) void urlOf(e.hash, false).then((u) => { const img = s.target.querySelector("img"); if (img && u) img.src = u; });
        }
      }, { root: body.closest(".panel-body"), rootMargin: "200px" });
      for (const t of body.querySelectorAll(".ref-thumb")) io.observe(t);
    };
    // view-state: (one picture large, the next or the one before, back to the gallery, the next pictures)
    body.addEventListener("click", (e) => {
      if (win.source.startsWith("board:") || choosing) return;
      const t = e.target as HTMLElement;
      const th = t.closest<HTMLElement>(".ref-thumb");
      if (th) one = Number(th.dataset["refI"]);
      else if (t.closest("[data-ref-back]")) one = null;
      else if (t.closest("[data-ref-prev]") && one !== null) one = (one - 1 + shown.length) % shown.length;
      else if (t.closest("[data-ref-next]") && one !== null) one = (one + 1) % shown.length;
      else if (t.closest("[data-ref-page]")) pages++;
      else return;
      void win.render();
    });
    // a picture of the gallery dragged onto a board (or onto the Library's folders, the canvas: what a Library card carries)
    body.addEventListener("dragstart", (e) => {
      const th = (e.target as HTMLElement).closest<HTMLElement>(".ref-thumb");
      const entry = th && shown[Number(th.dataset["refI"])];
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
    const ratio = new Map<string, number>(); // (each picture's height over width, once its thumbnail is read)
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
      node.innerHTML = (!e ? `<span class="ref-gone">${ICONS.fileMissing}<span>Missing</span></span>` : hiddenNow ? `<span class="ref-gone">${ICONS.lockKeyhole}<span>Hidden</span></span>` : `<img alt="${esc(e.name)}" draggable="false" decoding="async">`) + `<span class="ref-grip" data-ref-grip aria-hidden="true"></span>`;
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
        node.classList.toggle("is-picked", picked.has(i));
      });
      for (const extra of nodes.slice(b.items.length)) extra.remove();
      area?.querySelector(".ref-empty")?.toggleAttribute("hidden", b.items.length > 0);
      upgrade();
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
      const grip = !!t.closest("[data-ref-grip]");
      const pan = e.button === 1 || space;
      area.focus({ preventScroll: true });
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, v0 = { ...view };
      // a click picks (Shift or Ctrl adds or takes away), a picture already picked keeps the others for the drag
      if (!pan && i !== null && !picked.has(i)) {
        if (!(e.shiftKey || e.ctrlKey || e.metaKey)) picked.clear();
        picked.add(i);
      } else if (!pan && i !== null && (e.shiftKey || e.ctrlKey || e.metaKey)) picked.delete(i);
      const moving = !pan && i !== null ? [...picked].map((j) => ({ j, it: { ...b.items[j]! }, node: stage!.querySelector<HTMLElement>(`[data-ref-item="${j}"]`) })) : [];
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
              const w = Math.max(16, it.w + dx / view.k);
              nd.style.width = `${w}px`;
              nd.style.height = `${w * (ratio.get(it.h) ?? 0.75)}px`;
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
        const dx = u.clientX - sx, dy = u.clientY - sy, far = Math.hypot(dx, dy) > 2;
        if (pan) return saveView();
        if (moving.length && far) {
          const moves = moving.map(({ j, it }) => (grip ? { i: j, w: Math.max(16, it.w + dx / view.k) } : { i: j, x: it.x + dx / view.k, y: it.y + dy / view.k }));
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
    body.addEventListener("dblclick", (e) => {
      if (boardOf() && !(e.target as HTMLElement).closest("[data-ref-item]")) void pressCommand("reference.fit", { window: id, board: boardOf()!.id });
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
        if (e.key === "Escape") one = null;
        else if (e.key === "ArrowLeft" || e.key === "ArrowRight") one = (one + (e.key === "ArrowLeft" ? -1 : 1) + shown.length) % shown.length;
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
      else if (!mod && (e.key === "+" || e.key === "=")) zoomAt(mid.x, mid.y, e.shiftKey ? 2 : 1.25);
      else if (!mod && (e.key === "-" || e.key === "_")) zoomAt(mid.x, mid.y, e.shiftKey ? 0.5 : 0.8);
      else if (!mod && (e.key === "0" || e.key === "Home")) void pressCommand("reference.fit", { window: id, board: b.id });
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
      el.querySelector<HTMLElement>("[data-ref-source-name]")!.textContent = choosing ? "Choose…" : b ? b.name : win.source === "all" ? "All pictures" : l?.folders.find((f) => `folder:${f.id}` === win.source)?.name ?? "All pictures";
      pickBtn.setAttribute("aria-expanded", String(choosing));
      el.dataset["mode"] = choosing ? "choose" : b ? "board" : "gallery";
      stage = null;
      area = null;
      if (choosing) return chooser();
      if (b) await board();
      else await gallery();
    };
    wins.set(id, win);
    void win.render();
    keepWindows();
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
  const newBoard = async (w?: Win): Promise<void> => {
    const name = await promptDialog({ title: "New board", lines: ["A board of references, saved with this workspace."], value: `Board ${boards().length + 1}`, confirmLabel: "Make it" });
    if (name === null) return void w?.render();
    void pressCommand("reference.newBoard", { name, ...(w ? { window: w.id } : {}) });
  };
  const renderAll = (): void => {
    for (const w of wins.values()) void w.render();
  };
  const winOf = (o: Readonly<Record<string, unknown>>): Win | undefined => (typeof o["window"] === "string" ? wins.get(o["window"]) : undefined);
  const indices = (v: unknown, b: Board): number[] => (Array.isArray(v) ? [...new Set(v.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < b.items.length))] : []);

  // ---- commands (ADR 0205): every action of the windows, for the buttons, menus, keys, macros and outside callers alike
  const ID: OptionSpec = { name: "board", type: "id", doc: "the board's id", required: true };
  const rc = (id: string, title: string, hint: string, risk: NonNullable<Command["risk"]>, options: readonly OptionSpec[], exec: NonNullable<Command["exec"]>, why: () => string | null = () => null): Command => ({ id, group: "Reference", kind: "reference", title, hint, icon: ICONS.referenceWindow, risk, options, why, exec });
  const hasBoard = (o: Readonly<Record<string, unknown>>): Board | null => boardById(String(o["board"] ?? "")) ?? null;
  commands.setProvider("reference", () => [
    rc("reference.open", "Reference window", "A gallery or a board, over every view (Shift+R)", "read", [{ name: "source", type: "text", doc: "all, folder:<id> or board:<id> (all when left out)" }], (o) => {
      const w = open(typeof o["source"] === "string" ? o["source"] : "all");
      return { ok: true, value: w.id };
    }),
    rc("reference.newBoard", "New board", "An empty board of references", "edit", [{ name: "name", type: "text", doc: "its name", required: true }, { name: "window", type: "text", doc: "the window to show it in (a new one when left out)" }], (o) => {
      const name = String(o["name"]).trim().slice(0, 80) || "Board";
      const all = boards();
      if (all.length >= 100) return { ok: false, error: "There are 100 boards already: delete one first." };
      const b: Board = { id: newObjectId(), name, items: [] };
      settings.set("reference.boards", JSON.stringify([...all, b]));
      const w = winOf(o);
      if (w) {
        w.source = `board:${b.id}`;
        keepWindows();
        void w.render();
      } else open(`board:${b.id}`);
      return { ok: true, made: [b.id] };
    }),
    rc("reference.renameBoard", "Rename the board", "A new name for it", "edit", [ID, { name: "name", type: "text", doc: "its new name (asked when left out)" }], async (o) => {
      const b = hasBoard(o);
      if (!b) return { ok: false, error: "No such board." };
      const name = typeof o["name"] === "string" ? o["name"] : await promptDialog({ title: "Rename the board", lines: [], value: b.name, confirmLabel: "Rename" });
      if (name === null) return { ok: true };
      updateBoard(b.id, (x) => ({ ...x, name: name.trim().slice(0, 80) || x.name }), false);
      renderAll();
      return { ok: true, changed: [b.id] };
    }),
    rc("reference.deleteBoard", "Delete the board", "Its pictures stay in the library", "confirm", [ID], async (o, ctx) => {
      const b = hasBoard(o);
      if (!b) return { ok: false, error: "No such board." };
      if (ctx.caller !== "agent" && !(await confirmDialog({ title: `Delete the board “${b.name}”?`, lines: [`Its ${plural(b.items.length, "picture")} stay in the library; only the board goes.`], confirmLabel: "Delete it" }))) return { ok: true };
      settings.set("reference.boards", JSON.stringify(boards().filter((x) => x.id !== b.id)));
      history.delete(b.id);
      for (const w of wins.values()) if (w.source === `board:${b.id}`) w.source = "all";
      keepWindows();
      renderAll();
      return { ok: true, removed: [b.id] };
    }),
    rc("reference.add", "Put pictures on a board", "Library files, side by side", "edit", [ID, { name: "ids", type: "ids", doc: "the library files (their hashes)", required: true }, { name: "x", type: "number", doc: "where, across" }, { name: "y", type: "number", doc: "where, down" }], async (o) => {
      const b = hasBoard(o);
      if (!b) return { ok: false, error: "No such board." };
      listed = null; // (a picture just imported is in the library now)
      const l = await listing();
      const hs = ((o["ids"] as string[]) ?? []).filter((h) => isPicture(l?.byHash.get(h)));
      if (!hs.length) return { ok: false, error: "Those are not pictures of the library." };
      const room = MAX_ITEMS - b.items.length;
      if (room <= 0) return { ok: false, error: `A board holds at most ${MAX_ITEMS} pictures.` };
      const x = Number(o["x"] ?? 0), y = Number(o["y"] ?? 0);
      const items = hs.slice(0, room).map((h, i): Item => ({ h, x: x + (i % 6) * 220, y: y + Math.floor(i / 6) * 220, w: 200 }));
      updateBoard(b.id, (bd) => ({ ...bd, items: [...bd.items, ...items] }));
      return { ok: true, changed: [b.id] };
    }),
    rc("reference.place", "Move pictures on a board", "Where each is, or how wide", "edit", [ID, { name: "moves", type: "json", doc: "a list of { i: which picture (from 0), x, y, w }", required: true }], (o) => {
      const b = hasBoard(o);
      const moves = Array.isArray(o["moves"]) ? (o["moves"] as Array<Record<string, unknown>>) : [];
      if (!b || !moves.length || !moves.every((m) => typeof m === "object" && m !== null && b.items[Number(m["i"])])) return { ok: false, error: "No such picture on that board." };
      const n = (m: Record<string, unknown>, k: string, now: number, min = -1e7): number => (typeof m[k] === "number" && Number.isFinite(m[k]) ? Math.max(min, Math.min(1e7, m[k] as number)) : now);
      const by = new Map(moves.map((m) => [Number(m["i"]), m]));
      updateBoard(b.id, (bd) => ({ ...bd, items: bd.items.map((it, j) => { const m = by.get(j); return m ? { ...it, x: n(m, "x", it.x), y: n(m, "y", it.y), w: n(m, "w", it.w, 16) } : it; }) }));
      return { ok: true, changed: [b.id] };
    }),
    rc("reference.remove", "Take pictures off a board", "They stay in the library", "edit", [ID, { name: "indices", type: "json", doc: "which pictures (from 0), as a list", required: true }], (o) => {
      const b = hasBoard(o);
      const gone = b ? new Set(indices(o["indices"], b)) : new Set<number>();
      if (!b || !gone.size) return { ok: false, error: "No such picture on that board." };
      updateBoard(b.id, (bd) => ({ ...bd, items: bd.items.filter((_, j) => !gone.has(j)) }));
      return { ok: true, changed: [b.id] };
    }),
    ...(["undo", "redo"] as const).map((dir) =>
      rc(`reference.${dir}`, dir === "undo" ? "Undo on the board" : "Redo on the board", dir === "undo" ? "The board's last change (Ctrl+Z)" : "The change undone (Ctrl+Shift+Z)", "edit", [ID], (o) => {
        const b = hasBoard(o), h = b && history.get(b.id);
        const from = h ? (dir === "undo" ? h.back : h.ahead) : [];
        const items = from.pop();
        if (!b || !h || !items) return { ok: false, error: dir === "undo" ? "Nothing to undo on this board." : "Nothing to redo on this board." };
        (dir === "undo" ? h.ahead : h.back).push(b.items);
        updateBoard(b.id, (bd) => ({ ...bd, items }), false);
        return { ok: true, changed: [b.id] };
      }),
    ),
    rc("reference.fit", "Fit the board", "Every picture in sight", "read", [{ name: "window", type: "text", doc: "the window", required: true }, ID], (o) => {
      const w = winOf(o), b = hasBoard(o);
      if (!w || !b) return { ok: false, error: "No such window or board." };
      const area = w.el.querySelector<HTMLElement>("[data-ref-board]");
      if (!area || !b.items.length) return { ok: true };
      const minX = Math.min(...b.items.map((i) => i.x)), maxX = Math.max(...b.items.map((i) => i.x + i.w)), minY = Math.min(...b.items.map((i) => i.y)), maxY = Math.max(...b.items.map((i) => i.y + i.w));
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
