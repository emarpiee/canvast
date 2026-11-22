import type { CanvasActions } from "../app/canvas-commands";
import type { Session } from "../app/session";
import { EditorState } from "../app/editor-state";
import { ViewState } from "../app/view-state";
import { DocumentStore } from "../doc/document-store";
import { CanvasPersistence } from "../storage/canvas-persistence";
import type { FrameIndex } from "../scene/frame-index";
import type { ItemLabel } from "../render/item-label";
import { createFocusCycle, fitAllVisible } from "../interaction/item-navigation";
import { deserializeFrameCamera } from "../core/frames";
import { deserializeCamera } from "../core/camera";
import { addCanvasView, focusCanvasView } from "../canvas/focus";
import type { PanelDock } from "../ui/panel-dock";
import { panelHtml } from "../ui/panel";
import { openMoreMenu } from "../ui/more-menu";
import type { MenuItem } from "../ui/more-menu";
import { ICONS } from "../ui/icons";
import { esc } from "../ui/format";
import { newObjectId } from "../doc/model";
import { commands, pressCommand } from "../commands/registry";
import type { Command, OptionSpec } from "../commands/types";
import { mountGallery } from "./gallery";
import type { GalleryDeps } from "./gallery";
import { openTreeChooser } from "../ui/tree-chooser";
import type { ChoiceNode, ChooserView } from "../ui/tree-chooser";
import { folderPath } from "../assets/asset-catalog";
import { mountSettings } from "../ui/setting-rows";
import { R } from "../gen/kit";

/**
 * Pins (ADR 0208): windows that float above every view and show a canvas of the workspace, or a gallery of the library's pictures (all of them, or
 * a folder's: ./gallery.ts, the library's own cards and viewer). A canvas is shown as the main view shows it: the same engine
 * (src/canvas/canvas-view.ts), the same tools, the same commands (src/canvas/focus.ts sends them to the view in use). Each window is a panel
 * of the dock (`everywhere`, its own height). The canvas the main view shows is shown from its very document (one canvas, one document: the
 * edits and the undo are the same); another canvas is read into a document of its own and saved by the same persistence.
 */
export interface PinsDeps {
  dock: PanelDock;
  session: Session;
  /** The main view's document and editor. */
  main: { doc: DocumentStore };
  /** The canvas engine for a view (the main view's settings, theme, pictures and names). */
  engine(o: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; doc: DocumentStore; view: ViewState; editor: EditorState; shown(): boolean }): {
    index: FrameIndex;
    invalidate(): void;
    labels(): ItemLabel[];
  };
  /** The tools on a view (the main view's, made for this one); returns what takes them off. */
  tools(el: HTMLElement, view: ViewState, doc: DocumentStore, index: FrameIndex, editor: EditorState, focus: { tap(): void }, labels: () => ItemLabel[], active: () => boolean): () => void;
  /** The canvas's actions for a view (one function for every view). */
  actionsFor(doc: DocumentStore, editor: EditorState, view: ViewState, index: FrameIndex, focus: ReturnType<typeof createFocusCycle>): CanvasActions;
  dpr(): number;
  /** A gallery's library: its pictures as the library's cards show them, its viewer, hidden mode. */
  gallery: Omit<GalleryDeps, "session">;
  /** Library items placed on a view of a canvas, where they were let go (the main canvas's own way). */
  place(t: ViewTarget, hashes: readonly string[], at: { x: number; y: number }): Promise<number>;
  /** A view of a canvas takes library items and files dropped on it (the main canvas's own way). */
  takeDrops(t: { doc: DocumentStore; view: ViewState; editor: EditorState; el: HTMLElement }): void;
  /** The windows open, kept on this device (what each shows, its opacity, whether clicks go through; the dock keeps their places). */
  read(): WindowPrefs[];
  write(windows: WindowPrefs[]): void;
  /** The desktop app: a window above every app, showing this page (view only). */
  float?(title: string, html: string): Promise<unknown>;
}

/** A view of a canvas: its document, camera, editor and drawing surface. */
export interface ViewTarget { doc: DocumentStore; view: ViewState; editor: EditorState; el: HTMLElement }

/** A window as it is kept: what it shows (`c`), its opacity (`o`, 0.2 to 1), clicks through it (`t`). */
export interface WindowPrefs { c: string; o?: number; t?: boolean }

/** What a window shows: `canvas:<id>`, `all` (the library's pictures) or `folder:<id>` (a folder's, and its folders'). */
export type PinSource = string;
const RECENT_KEY = "canvast.pins.recentFolders";

interface Pin {
  id: string;
  source: PinSource;
  opacity: number;
  through: boolean;
  el: HTMLElement;
  /** It shows the main view's document (the canvas open there). */
  onMain: boolean;
  /** Shown again from the right document (the main view opened its canvas, or left it). */
  again(): void;
  show(source: PinSource): void;
  /** Its opacity and clicks-through shown. */
  apply(): void;
  /** Its gallery read again (the library changed). */
  refreshGallery(): void;
  /** The canvas it shows, while it shows one. */
  target: ViewTarget | null;
  close(): void;
}

export function mountPins(deps: PinsDeps): { open(source?: PinSource): void; refresh(): void; dropAt(x: number, y: number, hashes: readonly string[]): boolean } {
  const pins = new Map<string, Pin>();
  const keep = (): void => deps.write([...pins.values()].map((p) => ({ c: p.source, ...(p.opacity < 1 ? { o: p.opacity } : {}), ...(p.through ? { t: true } : {}) })));
  const canvasOf = (src: PinSource): string | null => (src.startsWith("canvas:") ? src.slice(7) : null);
  // (the folders a gallery showed lately, newest first, for the chooser; kept on this device)
  let recent: string[] = (() => {
    try {
      const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
    } catch {
      return [];
    }
  })();
  const remember = (fid: string): void => {
    recent = [fid, ...recent.filter((x) => x !== fid)].slice(0, 8);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {
      /* (no storage: remembered while the page is open) */
    }
  };
  let folders: Array<{ id: string; name: string; parentId: string | null; hidden?: boolean }> = [];
  const loadFolders = async (): Promise<void> => void (folders = (await deps.session.catalog?.list().catch(() => null))?.folders ?? folders);
  const nameOf = (src: PinSource): string => {
    const cid = canvasOf(src);
    if (cid) return canvasName(cid);
    if (src === "all") return "All pictures";
    const f = folders.find((x) => x.id === src.slice(7));
    return f ? folderPath(folders as never, f.id).join(" › ") : "A folder";
  };
  const canvasName = (id: string): string => {
    for (const { board, canvases } of deps.session.tree?.boards ?? []) for (const c of canvases) if (c.id === id) return `${board.name} › ${c.name}`;
    return "Canvas";
  };

  /** A canvas's document for a pinned view: the main view's when it shows that canvas, else one of its own (read once, saved as the main one is). */
  const own = new Map<string, { doc: DocumentStore; persistence: CanvasPersistence; users: number; placed: boolean }>();
  const docFor = async (canvasId: string, view: ViewState, use: (doc: DocumentStore) => void): Promise<{ doc: DocumentStore; placed: boolean; release(): void } | null> => {
    if (deps.session.current?.canvasId === canvasId) return { doc: deps.main.doc, placed: false, release: () => undefined };
    const repo = deps.session.repo;
    if (!repo) return null;
    let o = own.get(canvasId);
    let placed = false;
    if (!o) {
      const loaded = await repo.loadCanvas(canvasId).catch(() => null);
      if (!loaded) return null;
      const doc = new DocumentStore();
      doc.load(loaded.objects, loaded.space);
      use(doc); // (the view's frames are this document's before its camera is placed in them)
      const persistence = new CanvasPersistence(repo, doc, view);
      persistence.attach(canvasId, loaded.canvas.revision, loaded.space, loaded.bookmarks);
      try {
        // (its view where it was left, as the main view opens it)
        if (loaded.camera) {
          if ("v" in loaded.camera) view.setFrameCamera(deserializeFrameCamera(loaded.space, loaded.camera));
          else view.setWorldCamera(deserializeCamera(loaded.camera));
          placed = true;
        }
      } catch {
        /* (no view kept: fitted below) */
      }
      o = { doc, persistence, users: 0, placed };
      own.set(canvasId, o);
    }
    o.users++;
    const it = o;
    return {
      doc: it.doc,
      placed: it.placed,
      release: () => {
        if (--it.users > 0) return;
        void it.persistence.flush();
        own.delete(canvasId);
      },
    };
  };

  let chooserView: ChooserView = "tree";
  /** Any folder of the library, found by its name in the shared folder chooser. */
  const chooseFolder = async (pin: Pin): Promise<void> => {
    await loadFolders();
    const cur = pin.source.startsWith("folder:") ? pin.source.slice(7) : "";
    const done = await openTreeChooser({
      title: "Show a folder",
      applyLabel: "Show",
      view: chooserView,
      onView: (v) => void (chooserView = v),
      tabs: [{
        id: "folder", title: "Folder", icon: ICONS.folder, openIcon: ICONS.folderOpen, one: true, noun: "folders",
        nodes: [
          { id: "", name: "All pictures", parent: null, icon: ICONS.images, hint: "Every picture of the library", state: pin.source === "all" ? "on" : "off" },
          ...folders.filter((f) => deps.gallery.hidden() || !f.hidden).map((f): ChoiceNode => ({ id: f.id, name: f.name, parent: f.parentId, state: f.id === cur ? "on" : "off" })),
        ],
      }],
    });
    const on = done?.get("folder")?.on[0];
    if (on !== undefined) void pressCommand("pins.show", { window: pin.id, source: on ? `folder:${on}` : "all" });
  };
  const chooserRows = (pin: Pin): MenuItem[] => [
    ...(deps.session.tree?.boards ?? []).map(({ board, canvases }) => ({
      label: board.name,
      icon: ICONS.squareStack,
      hint: canvases.length === 1 ? "1 canvas" : `${canvases.length} canvases`,
      command: "pins.show",
      run: () => undefined, // (its canvases are in its own list)
      more: canvases.map((c) => ({ label: c.name, icon: ICONS.infinity, hint: c.id === deps.session.current?.canvasId ? "Open in the main view" : "A canvas of this board", command: "pins.show", checked: pin.source === `canvas:${c.id}`, run: () => void pressCommand("pins.show", { window: pin.id, source: `canvas:${c.id}` }) })),
    })),
    { label: "All pictures", icon: ICONS.images, hint: "A gallery of the library", command: "pins.show", checked: pin.source === "all", sep: true, run: () => void pressCommand("pins.show", { window: pin.id, source: "all" }) },
    ...recent.filter((fid) => folders.some((f) => f.id === fid)).map((fid) => ({ label: folderPath(folders as never, fid).join(" › "), icon: ICONS.folder, hint: "A folder shown lately", command: "pins.show", checked: pin.source === `folder:${fid}`, run: () => void pressCommand("pins.show", { window: pin.id, source: `folder:${fid}` }) })),
    { label: "Choose a folder…", icon: ICONS.folderTree, hint: "Find any folder by its name", command: "pins.show", run: () => void chooseFolder(pin) },
  ];

  const open = (source: PinSource = deps.session.current ? `canvas:${deps.session.current.canvasId}` : "all", prefs: Omit<WindowPrefs, "c"> = {}): void => {
    const id = newObjectId();
    const el = document.createElement("aside");
    el.className = "layers-panel pins-panel";
    el.dataset["testid"] = "pins";
    el.setAttribute("aria-label", "Pins");
    el.innerHTML = panelHtml({
      title: "Pins",
      count: 0,
      tools: `<button type="button" class="layer-btn" data-pins-more aria-haspopup="menu" aria-label="More" title="More: opacity, clicks through, float over other apps">${ICONS.ellipsis}</button>`,
      sub: `<div class="styles-kinds"><button type="button" class="pick-current" data-pins-source aria-haspopup="menu" aria-label="What it shows" title="What it shows: a canvas, or a gallery of the library"></button></div><div class="layers-filter" data-pins-search hidden><input type="search" placeholder="Search pictures" aria-label="Search the pictures by name" autocomplete="off"></div><div class="pins-look" data-pins-look hidden></div>`,
      body: `<div class="pins-view" data-pins-view><canvas class="pins-canvas" tabindex="0" aria-label="A pinned canvas: the canvas's tools, keys and menus"></canvas></div><div class="pins-gallery" data-pins-gallery hidden></div>`,
    });
    const host = el.querySelector<HTMLElement>("[data-pins-view]")!;
    const canvas = el.querySelector<HTMLCanvasElement>("canvas")!;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    const galleryHost = el.querySelector<HTMLElement>("[data-pins-gallery]")!;
    const searchRow = el.querySelector<HTMLElement>("[data-pins-search]")!;
    const search = searchRow.querySelector("input")!;
    let gallery: ReturnType<typeof mountGallery> | null = null;
    const count = el.querySelector<HTMLElement>(".layers-count");
    // view-state: (the gallery's pictures narrowed by name)
    search.addEventListener("input", () => {
      gallery?.search(search.value);
      setTimeout(() => void (count && (count.textContent = String(gallery?.count() ?? 0))), 120);
    });
    let stop: (() => void) | null = null;
    const pin: Pin = {
      id,
      source,
      opacity: Math.min(1, Math.max(0.2, prefs.o ?? 1)),
      through: !!prefs.t,
      el,
      onMain: false,
      target: null,
      apply: () => undefined,
      refreshGallery: () => gallery?.refresh(),
      again: () => void show(pin.source),
      show: (c) => void show(c),
      close: () => {
        stop?.();
        pins.delete(id);
        deps.dock.remove(`pins:${id}`);
        keep();
      },
    };
    pins.set(id, pin);
    const picker = el.querySelector<HTMLElement>("[data-pins-source]")!;
    // (one thing shown at a time: a canvas or a gallery takes the place of the last)
    const show = async (src: PinSource): Promise<void> => {
      stop?.();
      stop = null;
      pin.source = src;
      await loadFolders();
      const cid = canvasOf(src);
      picker.innerHTML = `${cid ? ICONS.infinity : src === "all" ? ICONS.images : ICONS.folder}<span>${esc(nameOf(src))}</span>${ICONS.chevronDown}`;
      keep();
      host.hidden = !cid;
      galleryHost.hidden = !!cid;
      searchRow.hidden = !!cid;
      if (count) count.hidden = !!cid;
      pin.target = null;
      if (!cid) {
        pin.onMain = false;
        if (src.startsWith("folder:")) remember(src.slice(7));
        search.value = "";
        gallery = mountGallery(galleryHost, { session: deps.session, ...deps.gallery }, src.startsWith("folder:") ? src.slice(7) : null);
        setTimeout(() => void (count && (count.textContent = String(gallery?.count() ?? 0))), 300);
        stop = () => void (gallery = null);
        return;
      }
      // (its frames are its document's: read at once by the view, so the document it has until its own is known is the main one's)
      let shownDoc: DocumentStore = deps.main.doc;
      const view = new ViewState(() => shownDoc.space);
      const got = await docFor(cid, view, (d) => void (shownDoc = d));
      if (!got || pin.source !== src) return got?.release();
      const doc = got.doc;
      shownDoc = doc;
      pin.onMain = doc === deps.main.doc;
      const editor = new EditorState();
      editor.setTool("select");
      const shown = (): boolean => !el.hidden && pins.has(id);
      const engine = deps.engine({ canvas, ctx, doc, view, editor, shown });
      const focus = createFocusCycle(doc, view, editor, () => true);
      const offTools = deps.tools(canvas, view, doc, engine.index, editor, focus, engine.labels, () => focusedHere());
      const offView = addCanvasView(id, deps.actionsFor(doc, editor, view, engine.index, focus));
      pin.target = { doc, view, editor, el: canvas };
      if (!dropsTaken) deps.takeDrops(pin.target), (dropsTaken = true);
      const unsubs = [view.subscribe(engine.invalidate), doc.subscribe(engine.invalidate), editor.subscribe(engine.invalidate)];
      const size = (): void => {
        const r = host.getBoundingClientRect(), dpr = deps.dpr();
        canvas.width = Math.max(1, Math.round(r.width * dpr));
        canvas.height = Math.max(1, Math.round(r.height * dpr));
        view.setViewport({ width: Math.max(1, r.width), height: Math.max(1, r.height) });
        engine.invalidate();
      };
      const ro = new ResizeObserver(size);
      ro.observe(host);
      size();
      if (doc !== deps.main.doc && !got.placed) fitAllVisible(doc, view, editor); // (no view kept for it: all of it in sight)
      stop = () => {
        ro.disconnect();
        for (const u of unsubs) u();
        offTools();
        offView();
        got.release();
      };
    };
    // shortcut: a drop goes to the document shown when the window first showed a canvas; change it with the canvas when Pins switches canvases often
    let dropsTaken = false;
    let here = false;
    const focusedHere = (): boolean => here;
    // view-state: (the view in use: the commands, keys and menus act on it while it is)
    el.addEventListener("pointerdown", () => {
      here = true;
      focusCanvasView(id);
    }, true);
    // view-state: (another view pressed: this one is no longer in use)
    window.addEventListener("pointerdown", (e) => {
      if (!el.contains(e.target as Node)) here = false;
    }, true);
    // commands: pins.show
    picker.addEventListener("click", () => void loadFolders().then(() => openMoreMenu(picker, chooserRows(pin), "What it shows")));
    // commands: pins.close
    el.querySelector("[data-close]")!.addEventListener("click", () => void pressCommand("pins.close", { window: id }));
    // ---- the window's own options: its opacity (the shared settings rows), clicks through it, and floated above other apps
    const lookHost = el.querySelector<HTMLElement>("[data-pins-look]")!;
    const look = mountSettings(lookHost, {
      sections: () => [{ title: "Opacity", items: [R("opacity", "Window opacity", 20, 100, 100)] }],
      get: () => Math.round(pin.opacity * 100),
      set: (_k, v) => void pressCommand("pins.window", { window: id, opacity: Number(v) / 100 }),
      reset: () => void pressCommand("pins.window", { window: id, opacity: 1 }),
      idPrefix: `pins-${id}-`,
      noHeads: true,
    });
    pin.apply = () => {
      const box = el.closest<HTMLElement>(".dock-item") ?? el;
      box.style.opacity = pin.opacity < 1 ? String(pin.opacity) : "";
      box.classList.toggle("is-through", pin.through);
      look.sync();
    };
    // commands: pins.window, pins.float
    el.querySelector("[data-pins-more]")!.addEventListener("click", (e) => openMoreMenu(e.currentTarget as HTMLElement, [
      { label: "Opacity…", icon: ICONS.windowOpacity, hint: "A slider; see what is behind it", command: "pins.window", checked: !lookHost.hidden, run: () => void ((lookHost.hidden = !lookHost.hidden), look.build()) },
      { label: "Let clicks through", icon: ICONS.clickThrough, hint: "To what is under it; not its title", command: "pins.window", checked: pin.through, run: () => void pressCommand("pins.window", { window: id, through: !pin.through }) },
      ...(deps.float ? [{ label: "Float over other apps", icon: ICONS.floatOnTop, hint: "A picture of it in a window above every app", command: "pins.float", run: () => void pressCommand("pins.float", { window: id }) }] : []),
    ], "More"));
    document.body.append(el);
    deps.dock.add(el, { id: `pins:${id}`, title: "Pins", side: "float", everywhere: true, width: 360, height: 300 });
    pin.apply();
    void show(source);
  };

  // ---- commands (ADR 0205): every action of the windows, for the buttons, menus, keys and outside callers alike
  const pc = (id: string, title: string, hint: string, options: readonly OptionSpec[], exec: NonNullable<Command["exec"]>): Command => ({ id, group: "Pins", kind: "pins", title, hint, icon: ICONS.referenceWindow, risk: "read", options, why: () => null, exec });
  const WINDOW: OptionSpec = { name: "window", type: "text", doc: "the window", required: true };
  const known = (c: unknown): boolean => typeof c === "string" && (deps.session.tree?.boards ?? []).some((b) => b.canvases.some((x) => x.id === c));
  /** A source a window can show: a canvas of the workspace, all pictures, or a folder (as `canvas`, an id alone, it is a canvas). */
  const sourceOf = (o: Readonly<Record<string, unknown>>): PinSource | null => {
    const s = typeof o["source"] === "string" ? o["source"] : typeof o["canvas"] === "string" ? `canvas:${o["canvas"]}` : null;
    if (!s) return null;
    if (s.startsWith("canvas:")) return known(s.slice(7)) ? s : null;
    return s === "all" || /^folder:.+/.test(s) ? s : null;
  };
  commands.setProvider("pins", () => [
    pc("pins.open", "Pins", "A window above every view that shows a canvas, or the library's pictures", [{ name: "source", type: "text", doc: "canvas:<id>, all or folder:<id> (the canvas open when left out)" }, { name: "canvas", type: "text", doc: "a canvas, by its id" }], (o) => {
      const s = o["source"] === undefined && o["canvas"] === undefined ? (deps.session.current ? `canvas:${deps.session.current.canvasId}` : "all") : sourceOf(o);
      if (!s) return { ok: false, error: "No such canvas or folder." };
      open(s);
      return { ok: true };
    }),
    pc("pins.show", "Show something else in a Pins window", "A canvas, all pictures or a folder, in place of what it shows", [WINDOW, { name: "source", type: "text", doc: "canvas:<id>, all or folder:<id>" }, { name: "canvas", type: "text", doc: "a canvas, by its id" }], (o) => {
      const p = pins.get(String(o["window"])), s = sourceOf(o);
      if (!p || !s) return { ok: false, error: "No such window, canvas or folder." };
      p.show(s);
      return { ok: true };
    }),
    pc("pins.window", "Set a Pins window", "Its opacity, clicks through it", [WINDOW, { name: "opacity", type: "number", doc: "0.2 to 1" }, { name: "through", type: "boolean", doc: "clicks go through to what is under it (its title still takes them)" }], (o) => {
      const p = pins.get(String(o["window"]));
      if (!p) return { ok: false, error: "No such window." };
      if (typeof o["opacity"] === "number") p.opacity = Math.min(1, Math.max(0.2, o["opacity"]));
      if (typeof o["through"] === "boolean") p.through = o["through"];
      p.apply();
      keep();
      return { ok: true };
    }),
    pc("pins.float", "Float a Pins window over other apps", "A picture of it, in a window above every app (view only)", [WINDOW], (o) => {
      const p = pins.get(String(o["window"]));
      if (!p || !deps.float) return { ok: false, error: deps.float ? "No such window." : "Only in the desktop app." };
      const c = p.el.querySelector<HTMLCanvasElement>(".pins-canvas");
      const pic = canvasOf(p.source) && c ? c.toDataURL("image/png") : null;
      if (!pic) return { ok: false, error: "Float a window that shows a canvas." };
      const title = nameOf(p.source);
      // (a page of its own, no script: the picture fitted in the window)
      void deps.float(title, `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${esc(title)}</title><style>html,body{margin:0;height:100%;background:#1e1e1e}img{width:100%;height:100%;object-fit:contain;display:block}</style></head><body><img src="${pic}" alt="${esc(title)}"></body></html>`);
      return { ok: true };
    }),
    pc("pins.view", "Open a picture in the library's viewer", "From a Pins gallery: its zoom, its slideshow", [{ name: "id", type: "text", doc: "the item (its hash)", required: true }], (o) => {
      if (typeof o["id"] !== "string") return { ok: false, error: "Which item?" };
      deps.gallery.open(o["id"]);
      return { ok: true };
    }),
    pc("pins.close", "Close a Pins window", "Its canvas stays as it is", [WINDOW], (o) => {
      const p = pins.get(String(o["window"]));
      if (!p) return { ok: false, error: "No such window." };
      p.close();
      return { ok: true };
    }),
  ]);

  // (the windows open last time; one saved before galleries came is a canvas's id alone)
  for (const w of deps.read()) open(/^(canvas:|folder:|all$)/.test(w.c) ? w.c : `canvas:${w.c}`, w);
  return {
    open,
    // (pictures dragged off the main canvas, let go over a pinned canvas: placed there)
    dropAt: (x, y, hashes) => {
      for (const p of pins.values()) {
        const r = p.target?.el.getBoundingClientRect();
        if (!p.target || !r || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
        void deps.place(p.target, hashes, { x, y });
        return true;
      }
      return false;
    },
    // (the boards and canvases changed, or the main view opened another canvas: the names, and one document for each canvas)
    refresh: () => {
      for (const p of pins.values()) {
        const cid = canvasOf(p.source);
        if (cid && p.onMain !== (deps.session.current?.canvasId === cid)) p.again();
        const s = p.el.querySelector<HTMLElement>("[data-pins-source] span");
        if (s) s.textContent = nameOf(p.source);
        p.refreshGallery();
      }
    },
  };
}
