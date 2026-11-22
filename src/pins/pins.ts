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
import { addCanvasView, dropBarActions, focusCanvasView, setBarActions } from "../canvas/focus";
import type { PanelDock } from "../ui/panel-dock";
import { panelHtml } from "../ui/panel";
import { openMoreMenu } from "../ui/more-menu";
import type { MenuItem } from "../ui/more-menu";
import { ICONS } from "../ui/icons";
import { esc } from "../ui/format";
import { newObjectId } from "../doc/model";
import { commands, pressCommand } from "../commands/registry";
import type { Command, OptionSpec } from "../commands/types";
import { mountSettings } from "../ui/setting-rows";
import { R } from "../gen/kit";
import { openTreeChooser } from "../ui/tree-chooser";
import type { ChoiceNode, ChooserView } from "../ui/tree-chooser";
import { folderPath } from "../assets/asset-catalog";

/**
 * Pins (ADR 0208): windows that float above every view and show a canvas of the workspace, or the Library. Nothing in them is made for
 * them: a canvas is shown by the canvas engine (src/canvas/canvas-view.ts) on a surface wired by the main view's own function
 * (`wire`: tools, zoom and pan, cursor, menu, drops, the toolbar's tools), and acted on by the canvas's commands and the Actions bar
 * (src/canvas/focus.ts sends them to the view in use); pictures of the library are shown by the library's own viewer (`library`: a second Library, its viewer only).
 * Each window is a panel of the dock (`everywhere`, its own height). The canvas the main view shows is shown from its very document (one
 * canvas, one document); another canvas is read into a document of its own and saved by the same persistence.
 */
export interface PinsDeps {
  dock: PanelDock;
  session: Session;
  /** The main view's document. */
  main: { doc: DocumentStore };
  /** The canvas engine for a view (the main view's settings, theme, pictures and names). */
  engine(o: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; doc: DocumentStore; view: ViewState; editor: EditorState; shown(): boolean }): {
    index: FrameIndex;
    invalidate(): void;
    follow(editor: EditorState): () => void;
    labels(): ItemLabel[];
  };
  /** A drawing surface wired as the main view's is (app/main.ts `wireCanvasView`): its menu and drops on what `now` shows, and `attach`
   * for each canvas it shows, which returns what takes it off. */
  wire(el: HTMLCanvasElement, now: () => ViewParts | null): (p: ViewParts) => () => void;
  /** The canvas's actions for a view (one function for every view), and the Actions bar's. */
  actionsFor(doc: DocumentStore, editor: EditorState, view: ViewState, index: FrameIndex, focus: ReturnType<typeof createFocusCycle>): CanvasActions;
  barActionsFor(doc: DocumentStore, editor: EditorState, view: ViewState): object;
  /** The Library in `host`, as its viewer (app/main.ts: `mountAssetsView`, embedded: its viewer only, no commands of its own). */
  library(host: HTMLElement): { show(): void; viewIn(scope: string): Promise<void> };
  /** Hidden items show (hidden mode): a hidden folder is offered then only. */
  hidden(): boolean;
  /** Library items placed on a view of a canvas, where they were let go (the main canvas's own way). */
  place(t: ViewTarget, hashes: readonly string[], at: { x: number; y: number }): Promise<number>;
  dpr(): number;
  /** The windows open, kept on this device (what each shows, its opacity, whether clicks go through; the dock keeps their places). */
  read(): WindowPrefs[];
  write(windows: WindowPrefs[]): void;
  /** The desktop app: a window above every app, showing this page (view only). */
  float?(title: string, html: string): Promise<unknown>;
}

/** The parts of a view of a canvas the wiring needs (app/main.ts `ViewParts`). */
export interface ViewParts { doc: DocumentStore; view: ViewState; editor: EditorState; index: FrameIndex; focus: { tap(): void }; labels: () => ItemLabel[]; active: () => boolean }
/** A view of a canvas: its document, camera, editor and drawing surface. */
export interface ViewTarget { doc: DocumentStore; view: ViewState; editor: EditorState; el: HTMLElement }
/** A window as it is kept: what it shows (`c`), its opacity (`o`, 0.2 to 1), clicks through it (`t`). */
export interface WindowPrefs { c: string; o?: number; t?: boolean }
/** What a window shows: `canvas:<id>`, or the Library's viewer on `all` its pictures or a folder's (`folder:<id>`). */
export type PinSource = string;

interface Pin {
  id: string;
  source: PinSource;
  opacity: number;
  through: boolean;
  el: HTMLElement;
  /** It shows the main view's document (the canvas open there). */
  onMain: boolean;
  /** The canvas it shows, while it shows one. */
  target: ViewTarget | null;
  again(): void;
  show(source: PinSource): void;
  apply(): void;
  close(): void;
}

/** A Pins window's canvas menu: what a board of references needs (ordering, copying, removing, finding its way); the rest is the main canvas's. */
export const PINS_MENU_ROWS: ReadonlySet<string> = new Set(["Copy", "Copy file", "Paste", "Duplicate", "Bring to front", "Send to back", "Delete the selection", "Select everything", "Fit everything in view"]);

export function mountPins(deps: PinsDeps): { open(source?: PinSource): void; refresh(): void; dropAt(x: number, y: number, hashes: readonly string[]): boolean; barHost(id: string): HTMLElement | null } {
  const pins = new Map<string, Pin>();
  const keep = (): void => deps.write([...pins.values()].map((p) => ({ c: p.source, ...(p.opacity < 1 ? { o: p.opacity } : {}), ...(p.through ? { t: true } : {}) })));
  const canvasOf = (src: PinSource): string | null => (src.startsWith("canvas:") ? src.slice(7) : null);
  const canvasName = (id: string): string => {
    for (const { board, canvases } of deps.session.tree?.boards ?? []) for (const c of canvases) if (c.id === id) return `${board.name} › ${c.name}`;
    return "Canvas";
  };
  // (the folders a gallery showed lately, newest first, for the chooser; kept on this device)
  const RECENT_KEY = "canvast.pins.recentFolders";
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
    if (canvasOf(src)) return canvasName(canvasOf(src)!);
    if (src === "all") return "All pictures";
    const f = folders.find((x) => x.id === src.slice(7));
    return f ? folderPath(folders as never, f.id).join(" › ") : "A folder";
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
          ...folders.filter((f) => deps.hidden() || !f.hidden).map((f): ChoiceNode => ({ id: f.id, name: f.name, parent: f.parentId, state: f.id === cur ? "on" : "off" })),
        ],
      }],
    });
    const on = done?.get("folder")?.on[0];
    if (on !== undefined) void pressCommand("pins.show", { window: pin.id, source: on ? `folder:${on}` : "all" });
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

  const chooserRows = (pin: Pin): MenuItem[] => [
    ...(deps.session.tree?.boards ?? []).map(({ board, canvases }) => ({
      label: board.name,
      icon: ICONS.squareStack,
      hint: canvases.length === 1 ? "1 canvas" : `${canvases.length} canvases`,
      command: "pins.show",
      run: () => undefined, // (its canvases are in its own list)
      more: canvases.map((c) => ({ label: c.name, icon: ICONS.infinity, hint: c.id === deps.session.current?.canvasId ? "Open in the main view" : "A canvas of this board", command: "pins.show", checked: pin.source === `canvas:${c.id}`, run: () => void pressCommand("pins.show", { window: pin.id, source: `canvas:${c.id}` }) })),
    })),
    { label: "All pictures", icon: ICONS.images, hint: "The library's viewer, on every picture", command: "pins.show", checked: pin.source === "all", sep: true, run: () => void pressCommand("pins.show", { window: pin.id, source: "all" }) },
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
      tools: `<button type="button" class="layer-btn" data-pins-more aria-haspopup="menu" aria-label="More" title="More: opacity, clicks through, float over other apps">${ICONS.ellipsis}</button>`,
      sub: `<div class="styles-kinds"><button type="button" class="pick-current" data-pins-source aria-haspopup="menu" aria-label="What it shows" title="What it shows: a canvas, or pictures of the library"></button></div><div class="pins-look" data-pins-look hidden></div>`,
      body: `<div class="pins-view" data-pins-view><canvas class="pins-canvas" tabindex="0" aria-label="A pinned canvas: the canvas's tools, keys and menus"></canvas></div><div class="pins-library" data-pins-library hidden></div><div class="pins-bar" data-pins-bar></div>`,
    });
    const host = el.querySelector<HTMLElement>("[data-pins-view]")!;
    const canvas = el.querySelector<HTMLCanvasElement>("canvas")!;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    const libraryHost = el.querySelector<HTMLElement>("[data-pins-library]")!;
    let library: { show(): void; viewIn(scope: string): Promise<void> } | null = null;
    // (its surface wired once, as the main view's: the menu and drops act on the canvas it shows now)
    let parts: ViewParts | null = null;
    const attach = deps.wire(canvas, () => parts);
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
      again: () => void show(pin.source),
      show: (c) => void show(c),
      close: () => {
        stop?.();
        focusCanvasView("main"); // (closed: its keys go back to the main view)
        pins.delete(id);
        deps.dock.remove(`pins:${id}`);
        keep();
      },
    };
    pins.set(id, pin);
    const picker = el.querySelector<HTMLElement>("[data-pins-source]")!;
    let here = false;
    const focusedHere = (): boolean => here;
    /** A canvas in the window: its engine, wired as the main view's (`attach`), its actions for the commands and the Actions bar, kept the size of the window. */
    const runView = (doc: DocumentStore, view: ViewState, editor: EditorState, release: () => void): void => {
      const shown = (): boolean => !el.hidden && pins.has(id);
      const engine = deps.engine({ canvas, ctx, doc, view, editor, shown });
      const focus = createFocusCycle(doc, view, editor, () => true);
      parts = { doc, view, editor, index: engine.index, focus, labels: engine.labels, active: () => focusedHere() };
      const offTools = attach(parts);
      const offView = addCanvasView(id, deps.actionsFor(doc, editor, view, engine.index, focus), editor, doc);
      setBarActions(id, deps.barActionsFor(doc, editor, view));
      pin.target = { doc, view, editor, el: canvas };
      const unsubs = [engine.follow(editor)]; // (drawn again on every change, a drag's too, as the main view is)
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
      stop = () => {
        ro.disconnect();
        for (const u of unsubs) u();
        offTools();
        offView();
        dropBarActions(id);
        parts = null;
        pin.target = null;
        release();
      };
    };
    // (one thing shown at a time: a canvas, or the library's viewer on all its pictures or a folder's)
    const show = async (src: PinSource): Promise<void> => {
      stop?.();
      stop = null;
      pin.source = src;
      const cid = canvasOf(src);
      await loadFolders();
      picker.innerHTML = `${cid ? ICONS.infinity : src === "all" ? ICONS.images : ICONS.folder}<span>${esc(nameOf(src))}</span>${ICONS.chevronDown}`;
      keep();
      host.hidden = !cid;
      libraryHost.hidden = !!cid;
      if (!cid) {
        pin.onMain = false;
        // (the library's own viewer, made once for the window when it is first shown, on the pictures chosen)
        if (src.startsWith("folder:")) remember(src.slice(7));
        library ??= deps.library(libraryHost);
        library.show();
        await library.viewIn(src);
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
      runView(doc, view, editor, got.release);
      if (doc !== deps.main.doc && !got.placed) fitAllVisible(doc, view, editor); // (no view kept for it: all of it in sight)
    };
    // view-state: (the view in use: the commands, keys and menus act on it while it is)
    el.addEventListener("pointerdown", (e) => {
      here = true;
      focusCanvasView(id); // (the view in use, a canvas or the library's pictures: the main view's keys stand down)
      // (the keys come to this page: a press the canvas takes for itself moves no focus, so a view in a frame, PhotoCraft, kept them)
      const had = document.activeElement as HTMLElement | null;
      if (had && had !== document.body && !el.contains(had) && !(e.target as Element).closest("input, textarea, select, [contenteditable]")) had.blur();
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
    deps.dock.add(el, { id: `pins:${id}`, title: "Pins", side: "float", everywhere: true, width: canvasOf(source) ? 360 : 640, height: canvasOf(source) ? 300 : 480 });
    pin.apply();
    void show(source);
  };

  // view-state: (a press outside every Pins window: the main view is in use again, its keys its own)
  window.addEventListener("pointerdown", (e) => {
    if (!(e.target as Element | null)?.closest?.(".pins-panel, .pop-menu, dialog")) focusCanvasView("main");
  }, true);

  // ---- commands (ADR 0205): every action of the windows, for the buttons, menus, keys and outside callers alike
  const pc = (id: string, title: string, hint: string, options: readonly OptionSpec[], exec: NonNullable<Command["exec"]>): Command => ({ id, group: "Pins", kind: "pins", title, hint, icon: ICONS.referenceWindow, risk: "read", options, why: () => null, exec });
  const WINDOW: OptionSpec = { name: "window", type: "text", doc: "the window", required: true };
  const known = (c: unknown): boolean => typeof c === "string" && (deps.session.tree?.boards ?? []).some((b) => b.canvases.some((x) => x.id === c));
  /** A source a window can show: a canvas of the workspace (as `canvas`, an id alone), all pictures, or a folder (`library` from before is all). */
  const sourceOf = (o: Readonly<Record<string, unknown>>): PinSource | null => {
    const s = typeof o["source"] === "string" ? o["source"] : typeof o["canvas"] === "string" ? `canvas:${o["canvas"]}` : null;
    if (!s) return null;
    if (s.startsWith("canvas:")) return known(s.slice(7)) ? s : null;
    return s === "library" || s === "all" ? "all" : /^folder:.+/.test(s) ? s : null;
  };
  commands.setProvider("pins", () => [
    pc("pins.open", "Pins", "A window above every view that shows a canvas, or pictures of the library in its viewer", [{ name: "source", type: "text", doc: "canvas:<id>, all or folder:<id> (the canvas open when left out)" }, { name: "canvas", type: "text", doc: "a canvas, by its id" }], (o) => {
      const s = o["source"] === undefined && o["canvas"] === undefined ? (deps.session.current ? `canvas:${deps.session.current.canvasId}` : "all") : sourceOf(o);
      if (!s) return { ok: false, error: "No such canvas." };
      open(s);
      return { ok: true };
    }),
    pc("pins.show", "Show something else in a Pins window", "A canvas, or pictures of the library, in place of what it shows", [WINDOW, { name: "source", type: "text", doc: "canvas:<id>, all or folder:<id>" }, { name: "canvas", type: "text", doc: "a canvas, by its id" }], (o) => {
      const p = pins.get(String(o["window"])), s = sourceOf(o);
      if (!p || !s) return { ok: false, error: "No such window or canvas." };
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
    pc("pins.close", "Close a Pins window", "What it shows stays as it is", [WINDOW], (o) => {
      const p = pins.get(String(o["window"]));
      if (!p) return { ok: false, error: "No such window." };
      p.close();
      return { ok: true };
    }),
  ]);

  // (the windows open last time; one saved before is a canvas's id alone)
  for (const w of deps.read()) open(/^(canvas:|folder:|all$)/.test(w.c) ? w.c : w.c === "library" ? "all" : `canvas:${w.c}`, w);
  return {
    open,
    // (where a window's canvas, when it is the view in use, has the app's Actions bar)
    barHost: (id) => pins.get(id)?.el.querySelector<HTMLElement>("[data-pins-bar]") ?? null,
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
      }
    },
  };
}
