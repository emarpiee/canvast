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

/**
 * Pins (ADR 0208): windows that float above every view and show a canvas of the workspace, as the main view does: the same engine
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
  /** The windows open, kept on this device (their canvases; the dock keeps their places). */
  read(): string[];
  write(canvases: string[]): void;
}

interface Pin {
  id: string;
  canvasId: string;
  el: HTMLElement;
  /** It shows the main view's document (the canvas open there). */
  onMain: boolean;
  /** Shown again from the right document (the main view opened its canvas, or left it). */
  again(): void;
  show(canvasId: string): void;
  close(): void;
}

export function mountPins(deps: PinsDeps): { open(canvasId?: string): void; refresh(): void } {
  const pins = new Map<string, Pin>();
  const keep = (): void => deps.write([...pins.values()].map((p) => p.canvasId));
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

  const chooserRows = (pin: Pin): MenuItem[] =>
    (deps.session.tree?.boards ?? []).map(({ board, canvases }) => ({
      label: board.name,
      icon: ICONS.squareStack,
      hint: canvases.length === 1 ? "1 canvas" : `${canvases.length} canvases`,
      command: "pins.show",
      run: () => undefined, // (its canvases are in its own list)
      more: canvases.map((c) => ({ label: c.name, icon: ICONS.infinity, hint: c.id === deps.session.current?.canvasId ? "Open in the main view" : "A canvas of this board", command: "pins.show", checked: c.id === pin.canvasId, run: () => void pressCommand("pins.show", { window: pin.id, canvas: c.id }) })),
    }));

  const open = (canvasId = deps.session.current?.canvasId ?? ""): void => {
    if (!canvasId) return;
    const id = newObjectId();
    const el = document.createElement("aside");
    el.className = "layers-panel pins-panel";
    el.dataset["testid"] = "pins";
    el.setAttribute("aria-label", "Pins");
    el.innerHTML = panelHtml({
      title: "Pins",
      sub: `<div class="styles-kinds"><button type="button" class="pick-current" data-pins-source aria-haspopup="menu" aria-label="The canvas it shows" title="The canvas it shows"></button></div>`,
      body: `<div class="pins-view" data-pins-view><canvas class="pins-canvas" tabindex="0" aria-label="A pinned canvas: the canvas's tools, keys and menus"></canvas></div>`,
    });
    const host = el.querySelector<HTMLElement>("[data-pins-view]")!;
    const canvas = el.querySelector<HTMLCanvasElement>("canvas")!;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    let stop: (() => void) | null = null;
    const pin: Pin = {
      id,
      canvasId,
      el,
      onMain: false,
      again: () => void show(pin.canvasId),
      show: (c) => void show(c),
      close: () => {
        stop?.();
        pins.delete(id);
        deps.dock.remove(`pins:${id}`);
        keep();
      },
    };
    pins.set(id, pin);
    const source = el.querySelector<HTMLElement>("[data-pins-source]")!;
    // (one canvas shown at a time: a new one takes the place of the last)
    const show = async (cid: string): Promise<void> => {
      stop?.();
      stop = null;
      pin.canvasId = cid;
      source.innerHTML = `${ICONS.infinity}<span>${esc(canvasName(cid))}</span>${ICONS.chevronDown}`;
      keep();
      // (its frames are its document's: read at once by the view, so the document it has until its own is known is the main one's)
      let shownDoc: DocumentStore = deps.main.doc;
      const view = new ViewState(() => shownDoc.space);
      const got = await docFor(cid, view, (d) => void (shownDoc = d));
      if (!got || pin.canvasId !== cid) return got?.release();
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
    source.addEventListener("click", () => openMoreMenu(source, chooserRows(pin), "The canvas it shows"));
    // commands: pins.close
    el.querySelector("[data-close]")!.addEventListener("click", () => void pressCommand("pins.close", { window: id }));
    document.body.append(el);
    deps.dock.add(el, { id: `pins:${id}`, title: "Pins", side: "float", everywhere: true, width: 360, height: 300 });
    void show(canvasId);
  };

  // ---- commands (ADR 0205): every action of the windows, for the buttons, menus, keys and outside callers alike
  const pc = (id: string, title: string, hint: string, options: readonly OptionSpec[], exec: NonNullable<Command["exec"]>): Command => ({ id, group: "Pins", kind: "pins", title, hint, icon: ICONS.referenceWindow, risk: "read", options, why: () => null, exec });
  const WINDOW: OptionSpec = { name: "window", type: "text", doc: "the window", required: true };
  const known = (c: unknown): boolean => typeof c === "string" && (deps.session.tree?.boards ?? []).some((b) => b.canvases.some((x) => x.id === c));
  commands.setProvider("pins", () => [
    pc("pins.open", "Pin a canvas", "A window above every view that shows a canvas", [{ name: "canvas", type: "text", doc: "the canvas (the one open when left out)" }], (o) => {
      const c = typeof o["canvas"] === "string" ? o["canvas"] : deps.session.current?.canvasId;
      if (!c || !known(c)) return { ok: false, error: "No such canvas." };
      open(c);
      return { ok: true };
    }),
    pc("pins.show", "Show another canvas in a Pins window", "In place of the one it shows", [WINDOW, { name: "canvas", type: "text", doc: "the canvas", required: true }], (o) => {
      const p = pins.get(String(o["window"]));
      if (!p || !known(o["canvas"])) return { ok: false, error: "No such window or canvas." };
      p.show(String(o["canvas"]));
      return { ok: true };
    }),
    pc("pins.close", "Close a Pins window", "Its canvas stays as it is", [WINDOW], (o) => {
      const p = pins.get(String(o["window"]));
      if (!p) return { ok: false, error: "No such window." };
      p.close();
      return { ok: true };
    }),
  ]);

  for (const c of deps.read()) open(c);
  return {
    open,
    // (the boards and canvases changed, or the main view opened another canvas: the names, and one document for each canvas)
    refresh: () => {
      for (const p of pins.values()) {
        if (p.onMain !== (deps.session.current?.canvasId === p.canvasId)) p.again();
        const s = p.el.querySelector<HTMLElement>("[data-pins-source] span");
        if (s) s.textContent = canvasName(p.canvasId);
      }
    },
  };
}
