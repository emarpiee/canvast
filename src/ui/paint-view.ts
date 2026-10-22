/**
 * The Painting view (ADR 0165): a view of its own beside the Canvas, the Library and Settings, with its own rules: pages in px, a bounded
 * camera, raster layers painted with the brush engine (ADR 0164). Two screens: the workspace's paintings, and an open painting (bar,
 * tools, the page, its layers and its pages). Built from the registries (paint/tools.ts TOOLS, paint/model.ts LAYER_KINDS), the shared
 * panel shape, menus, dialogs and colour picker; nothing here is copied from the canvas.
 */
import { sampleAt } from "../interaction/eyedropper";
import { ICONS } from "./icons";
import { esc } from "./format";
import { panelHtml } from "./panel";
import { closeMoreMenu, moreButton, openMoreMenu, type MenuItem } from "./more-menu";
import { confirmDialog, promptDialog } from "./confirm";
import { buildAdjustPanel, openColourPopover, openPaintPopover, rememberColour } from "./colour-popover";
import { liveNumber } from "./live";
import { scrubNumbers } from "../colour-picker/scrub";
import { saveFile } from "./file-actions";
import { pageDialog, type PageSpec } from "./paint-dialogs";
import { shortcutsActive } from "../interaction/shortcut-scope";
import type { SettingsStore } from "../settings/settings";
import { BLEND_MODES, type BlendMode } from "../doc/model";
import { paintFromText, paintToText, type Paint, type GradientStop } from "../doc/paint";
import type { Adjust } from "../doc/adjust";
import { parsePayload, instantiate } from "../doc/clipboard";
import type { AssetLibrary } from "../assets/asset-library";
import type { SceneTheme } from "../render/scene-renderer";
import { GENERATORS, defaultValues } from "../gen";
import { PaintStore } from "../paint/store";
import { PaintSession } from "../paint/session";
import { BrushEngine } from "../paint/engine";
import { composePage, drawLayerAlone, type Scene } from "../paint/compose";
import { createVectorHost, type VectorHost } from "../paint/vector-host";
import { openRevealList } from "./reveal-list";
import { copySelection, cutSelection, pasteObjects } from "../app/actions";
import type { Tool } from "../app/editor-state";
import { pageSpace, patternObjects, pictureObject, placeOnPage, stored, type ObjectEnv } from "../paint/objects";
import { clampCamera, fitCamera, toPage, zoomAt, zoomTo, type PaintCamera } from "../paint/camera";
import { TOOLS, TOOL_IDS, valuesOf, type OptionSpec, type ToolId, type Values } from "../paint/tools";
import { brushOf, cleanBrush, tipsOf, type Brush } from "../paint/brushes";
import { drawThumb, mountBrushPanels, type BrushPanels } from "./brush-panels";
import type { DockSpec } from "./panel-dock";
import { LAYER_KINDS, nextName, type Layer, type Painting } from "../paint/model";

export interface PaintViewDeps {
  readonly db: IDBDatabase | null;
  workspaceId(): string | null;
  readOnly(): boolean;
  readonly settings: SettingsStore;
  /** A notice (the app's notices). */
  tell(text: string): void;
  /** Put a picture on the canvas (through the library) and show the canvas. */
  placeOnCanvas(png: Blob, name: string): Promise<void>;
  /** The library (pictures and fonts of shape, text and picture layers) and the theme the canvas's renderer draws with (ADR 0166). */
  readonly assets: AssetLibrary;
  /** The Properties bar's place for the painting tools' options (ui/toolbar.ts, ADR 0168): the rail and the bars are the canvas's. */
  readonly optionsSlot: HTMLElement;
  theme(): SceneTheme;
  /** Bring a file into the library (a picture for a picture layer); null when it is not a picture. */
  importPicture(file: File): Promise<{ hash: string; pixelW: number; pixelH: number } | null>;
  /** The saved styles (an adjustment layer's numbers can be saved as one, as in the Adjust panel). */
  styles: { save(name: string, a: Adjust): Promise<void>; gradients(): Array<{ name: string; stops: readonly GradientStop[] }> };
  /** Put a panel in the panel dock (the Brushes and Brush settings panels; the dock is the canvas's, ADR 0123). */
  dock(el: HTMLElement, spec: DockSpec): void;
}

export interface PaintView {
  show(): void;
  hide(): void;
  /** The Brushes and Brush settings panels (the test hook reads the presets). */
  readonly brushes: BrushPanels;
  /** The painting tool in use and its brush (the test hook). */
  brushState(): { tool: ToolId; preset: string; brush: Brush; values: Values } | null;
  /** For the test hook: the open painting's session, if any. */
  readonly session: PaintSession | null;
  /** The list of paintings shown (for the test hook). */
  list(): Promise<Painting[]>;
  open(id: string): Promise<void>;
  /** Draw now (the test hook reads pixels after it). */
  drawNow(): void;
  readonly camera: PaintCamera;
  /** The painting's bar (name, page size), which main.ts puts beside the view tabs. */
  readonly head: HTMLElement;
  /** The picked vector layer's document, editor, view, index and text editor: what the shared bars work on in this view (ADR 0168). */
  readonly vector: VectorHost;
  fit(): void;
  /** The view's turn and mirror menu (the view controls' button) and, for the test hook, where a page px is in the window. */
  turnMenu(anchor: HTMLElement): void;
  clientOf(x: number, y: number): { x: number; y: number };
}

const ZOOM_STEP = 1.25;
const fileName = (s: string): string => s.replace(/[\\/:*?"<>|]+/g, " ").trim() || "page";

export function mountPaintView(root: HTMLElement, deps: PaintViewDeps): PaintView {
  const store = deps.db ? new PaintStore(deps.db) : null;
  let session: PaintSession | null = null;
  let unsub: (() => void) | null = null;
  let engine: BrushEngine | null = null;
  let engineError: string | null = null;
  let visible = false;
  let cam: PaintCamera = { scale: 1, x: 0, y: 0 };
  /** A painting tool's state (setting paint.tools): its options bar's values, its brush (the preset's, changed in Brush settings, ADR 0169) and
   * the preset it came from. */
  const toolState = (t: ToolId): Record<string, unknown> => {
    const v = (deps.settings.get("paint.tools") as Record<string, unknown>)[t];
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  };
  const toolValues = (t: ToolId): Record<string, number | boolean | string> => valuesOf(t, toolState(t));
  const toolBrush = (t: ToolId): Brush => cleanBrush(toolState(t)["brush"]) ?? {};
  const toolPreset = (t: ToolId): string => (typeof toolState(t)["preset"] === "string" ? (toolState(t)["preset"] as string) : "");
  const setTool = (t: ToolId, patch: { values?: Values; brush?: Brush; preset?: string }): void => {
    const all = { ...(deps.settings.get("paint.tools") as Record<string, unknown>) };
    all[t] = { ...toolValues(t), ...patch.values, brush: patch.brush ?? toolBrush(t), preset: patch.preset ?? toolPreset(t) };
    deps.settings.set("paint.tools", all);
    renderOptions();
    drawCursor();
    brushPanels.changed();
  };
  const setToolValue = (t: ToolId, key: string, v: number | boolean | string): void => setTool(t, { values: { ...toolValues(t), [key]: v } });

  const nextLayerName = (s: PaintSession, stem: string): string => nextName(stem, [...s.layers.values()].map((l) => l.name));

  root.innerHTML = `
    <div class="paint-list" data-screen="list">
      <header class="paint-list-head">
        <h1>Paintings</h1>
        <button type="button" class="is-primary" data-act="new" data-testid="paint-new">${ICONS.newPainting}<span>New painting</span></button>
      </header>
      <ul class="paint-items" data-items aria-label="Paintings"></ul>
    </div>
    <div class="paint-editor" data-screen="editor" hidden>
      <div class="paint-main">
        <div class="paint-stage" data-stage>
          <div class="paint-turn" data-turn>
            <canvas class="paint-canvas" data-testid="paint-canvas" tabindex="0" aria-label="The page: paint with the picked tool"></canvas>
            <canvas class="paint-cursor" aria-hidden="true"></canvas>
          </div>
        </div>
        <input type="file" accept="image/*" hidden data-testid="paint-picture-input">
      </div>
      <div class="paint-pages" data-pages role="tablist" aria-label="Pages"></div>
    </div>`;
  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const listScreen = $<HTMLElement>('[data-screen="list"]');
  const editor = $<HTMLElement>('[data-screen="editor"]');
  const stage = $<HTMLElement>("[data-stage]");
  /** The box the page is drawn in, turned and mirrored inside the still stage (the view only, not the pixels): big enough to cover it. */
  const turnEl = $<HTMLElement>("[data-turn]");
  let turn = 0;
  let mirror = false;
  /** The page box's size, from the stage as it is now (not from the box's own layout, which follows a frame later). */
  const view = (): { w: number; h: number } => {
    const W = stage.clientWidth || 1, H = stage.clientHeight || 1;
    const a = (turn * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    return { w: Math.ceil(W * c + H * s), h: Math.ceil(W * s + H * c) };
  };
  const layoutTurn = (): void => {
    const W = stage.clientWidth || 1, H = stage.clientHeight || 1;
    const { w, h } = view();
    Object.assign(turnEl.style, { width: `${w}px`, height: `${h}px`, left: `${(W - w) / 2}px`, top: `${(H - h) / 2}px`, transform: turn || mirror ? `rotate(${turn}deg)${mirror ? " scaleX(-1)" : ""}` : "" });
  };
  /** A point of the window in the page box's own px (what the camera places the page in), and back: through the turn and the mirror. */
  const toLocal = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = stage.getBoundingClientRect(), v = view();
    const dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
    const a = (-turn * Math.PI) / 180;
    const x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a);
    return { x: (mirror ? -x : x) + v.w / 2, y: y + v.h / 2 };
  };
  const clientOf = (lx: number, ly: number): { x: number; y: number } => {
    const r = stage.getBoundingClientRect(), v = view();
    const dx = (mirror ? -1 : 1) * (lx - v.w / 2), dy = ly - v.h / 2;
    const a = (turn * Math.PI) / 180;
    return { x: r.left + r.width / 2 + dx * Math.cos(a) - dy * Math.sin(a), y: r.top + r.height / 2 + dx * Math.sin(a) + dy * Math.cos(a) };
  };
  /** Turn (degrees, clockwise) and mirror the view about its middle: the page pixel there stays there. */
  const setTurn = (deg: number, mir = mirror): void => {
    const v0 = view();
    const [px, py] = toPage(cam, v0.w / 2, v0.h / 2);
    turn = ((((Math.round(deg) % 360) + 540) % 360) - 180) || 0;
    mirror = mir;
    layoutTurn();
    const v = view();
    if (session) cam = clampCamera({ ...cam, x: v.w / 2 - px * cam.scale, y: v.h / 2 - py * cam.scale }, page(), v);
    const b = document.querySelector<HTMLElement>('.hud-controls [data-action="view-turn"]');
    if (b) b.textContent = `${turn}°${mirror ? " ⇋" : ""}`;
    redraw();
  };
  const TURN_STEP = 15;
  const turnMenu = (anchor: HTMLElement): void => {
    const items = (): MenuItem[] => [
      { id: "turn-left", label: `Turn left ${TURN_STEP}°`, hint: "4", icon: ICONS.rotateCcwSquare, run: () => setTurn(turn - TURN_STEP) },
      { id: "turn-right", label: `Turn right ${TURN_STEP}°`, hint: "6", icon: ICONS.rotateCw, run: () => setTurn(turn + TURN_STEP) },
      { id: "mirror", label: "Mirror", hint: "M: left and right swapped, to check a drawing", icon: ICONS.flipHorizontal, checked: mirror, run: () => setTurn(turn, !mirror) },
      { id: "reset", label: "Reset rotation", hint: "5", icon: ICONS.rotateCcw, disabled: !turn && !mirror, run: () => setTurn(0, false) },
    ];
    openMoreMenu(anchor, items(), "View rotation", { keepOpen: true, refresh: items });
  };
  const canvas = $<HTMLCanvasElement>(".paint-canvas");
  const cursor = $<HTMLCanvasElement>(".paint-cursor");
  /** A panel of the view in the canvas's dock (ADR 0123), shown only in the Paint view. */
  const dockPanel = (cls: string, label: string, attr: string): HTMLElement => {
    const el = document.createElement("aside");
    el.className = `layers-panel ${cls}`;
    el.setAttribute("aria-label", label);
    el.setAttribute(attr, "");
    el.dataset["only"] = "paint";
    return el;
  };
  const layersEl = dockPanel("paint-layers", "Layers", "data-paint-layers");
  const adjustEl = dockPanel("adjust-panel paint-adjust", "Adjustment", "data-adjust");
  adjustEl.hidden = true;
  deps.dock(layersEl, { id: "paint-layers", title: "Layers", side: "right" });
  deps.dock(adjustEl, { id: "paint-adjust", title: "Adjustment", side: "right" });
  const pagesEl = $<HTMLElement>("[data-pages]");
  const optionsEl = deps.optionsSlot;
  /** The painting's own bar, beside the view tabs (main.ts puts it in the top bar): its name, its page size, and what is done with a page. */
  const head = document.createElement("div");
  head.className = "nav paint-head";
  head.dataset["only"] = "paint";
  // (the canvas's own pill: what the board and canvas menu is on the canvas)
  head.innerHTML = `<div class="nav-pill" data-active="true"><button type="button" class="nav-crumb" data-act="list" data-testid="paint-list" aria-label="All paintings" title="All paintings">${ICONS.paintings}</button><button type="button" class="nav-name-btn" data-act="painting-menu" data-testid="painting-menu" aria-haspopup="menu" aria-expanded="false" title="The painting: rename, page size, export, place on the canvas"><span class="nav-crumb-text" data-name></span>${ICONS.chevronDown}</button></div>`;
  head.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (b) void action(b.dataset["act"]!, b);
  });
  const pictureInput = $<HTMLInputElement>('[data-testid="paint-picture-input"]');
  /** The canvas's own tools on the picked vector layer (ADR 0167). */
  const vhost: VectorHost = createVectorHost({
        el: canvas,
        stage: turnEl,
        session: () => session,
        active: () => vectorOn(),
        camera: () => cam,
        setCamera: (c) => {
          if (!session) return;
          cam = clampCamera(c, page(), view());
          redraw();
        },
        size: () => view(),
        redraw: () => redraw(),
        assets: deps.assets,
        theme: deps.theme,
        revealList: (at, things, pick) => openRevealList(canvas, vhost.editor, at, things, pick),
        keysActive: () => !!session && visible,
        sample: (at, size) => samplePage(at, size),
        toLocal: (e) => toLocal(e),
      });
  /** The rail's tool, as the canvas's tools keep it (one rail for both views, ADR 0168). */
  const tool = (): Tool => vhost.editor.tool;
  /** The painting tool in use, when the rail's tool paints here: the Brush, the Pencil, or the Eraser on a layer that is not a vector layer
   * (whose shapes the canvas's Eraser takes, as on the canvas). Every other tool is the canvas's. */
  const paintTool = (): ToolId | null => {
    const t = tool();
    return t === "brush" || t === "pencil" ? t : t === "eraser" && (session?.active()?.kind !== "object" || session.editsMask()) ? "eraser" : null;
  };
  /** The paint colour: the canvas's pen colour (the Properties bar's colour, ADR 0168). */
  const colour = (): string => vhost.editor.penColor;

  /** The Eyedropper's colour under a point of the view (CSS px), in page px: the page as it looks (no checkerboard, no overlays) or the
   * picked layer alone. */
  const samplePage = (at: { x: number; y: number }, size: number): string | null => {
    if (!session) return null;
    const [x, y] = toPage(cam, at.x, at.y);
    if (vhost.editor.sampleLayer) {
      const l = session.active();
      const c = l && session.image(l);
      return c ? sampleAt(c, x, y, size) : null;
    }
    const h = Math.floor(size / 2);
    const c = document.createElement("canvas");
    c.width = c.height = size;
    composePage(c.getContext("2d")!, scene(session, false), { scale: 1, x: h - Math.floor(x), y: h - Math.floor(y), checker: false });
    return sampleAt(c, h, h, size);
  };
  const page = () => session!.page();
  const env = (): ObjectEnv | null => (deps.assets ? { assets: deps.assets, theme: deps.theme() } : null);
  /** The page as the session has it now, for drawing (the view, an export, a rasterized layer). */
  const scene = (s: PaintSession, live = true): Scene => ({ page: s.page(), stack: s.stack(), image: (l) => s.image(l), mask: (l) => s.mask(l), live: live ? s.live : null, env: env(), vector: live && vhost ? vhost.drawLayer : null });

  // ---- drawing ------------------------------------------------------------------------------------------------------------------------

  let scheduled = false;
  const css = getComputedStyle(document.documentElement);
  const draw = (): void => {
    scheduled = false;
    if (!session || !visible) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = view();
    for (const c of [canvas, cursor]) {
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
    }
    const g = canvas.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    const s = session;
    layoutTurn();
    vhost?.syncCamera();
    const pending = composePage(g, scene(s), { scale: cam.scale * dpr, x: cam.x * dpr, y: cam.y * dpr, checker: true }, { light: css.getPropertyValue("--check-a").trim() || "#ffffff", dark: css.getPropertyValue("--check-b").trim() || "#d9d9d9" });
    if (pending) window.setTimeout(redraw, 120); // (a picture of a layer is still being decoded)
    vhost.drawOverlay(g, dpr);
    drawCursor();
  };
  const redraw = (): void => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(draw);
  };
  let pointerAt: { x: number; y: number } | null = null;
  const drawCursor = (): void => {
    const g = cursor.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cursor.width, cursor.height);
    const t = paintTool();
    if (!pointerAt || !t || panning) return;
    const r = (Number(toolValues(t)["size"]) / 2) * cam.scale * dpr;
    g.lineWidth = 1;
    for (const [c, d] of [[css.getPropertyValue("--white").trim() || "#fff", 1], [css.getPropertyValue("--black").trim() || "#000", 0]] as const) {
      g.strokeStyle = c;
      g.beginPath();
      g.arc(pointerAt.x * dpr, pointerAt.y * dpr, Math.max(1.5, r + d), 0, Math.PI * 2);
      g.stroke();
    }
  };
  new ResizeObserver(() => {
    layoutTurn();
    if (!session) return;
    cam = clampCamera(cam, page(), view());
    redraw();
  }).observe(stage);

  // ---- the painting tools' options (in the Properties bar, ADR 0168) ------------------------------------------------------------------

  /** One option of a painting tool, from its schema (paint/tools.ts): each kind of option is one control. */
  const optionHtml = (o: OptionSpec, v: number | boolean): string =>
    o.kind === "number"
      ? `<label class="tb-count" title="${esc(o.hint)}">${esc(o.label)} <input type="number" data-opt="${o.key}" min="${o.min}" max="${o.max}" step="${o.step}" inputmode="numeric" value="${v}" aria-label="${esc(o.label)}${o.percent ? " (%)" : o.unit ? ` (${o.unit})` : ""}"></label>`
      : `<button type="button" data-opt="${o.key}" aria-pressed="${!!v}" title="${esc(o.hint)}">${esc(o.label)}</button>`; // (a switch: the bar's toggle, as the canvas's)
  let optionsFor: string | undefined;
  const renderOptions = (): void => {
    const t = paintTool();
    const preset = t ? brushPanels.presetName(t) : "";
    const key = t ? `${t}\n${preset}\n${JSON.stringify(toolValues(t))}\n${JSON.stringify(toolBrush(t)["tip"] ?? "")}` : "";
    if (key === optionsFor) return;
    optionsFor = key;
    if (!t) return void (optionsEl.innerHTML = "");
    const vals = toolValues(t);
    const panelBtn = (id: "brushes" | "settings", icon: string, label: string, title: string): string => `<button type="button" data-brush-panel="${id}" aria-pressed="${brushPanels.isOpen(id)}" aria-label="${esc(label)}" title="${esc(title)}">${icon}</button>`;
    // (the Brushes button shows the tool's tip, as the presets do)
    optionsEl.innerHTML = panelBtn("brushes", `<canvas class="paint-tip" width="56" height="56" aria-hidden="true"></canvas>`, preset ? `Brushes: ${preset}` : "Brushes", `Brushes: the presets${preset ? ` (now ${preset})` : ""}`) + TOOLS[t].options.map((o) => optionHtml(o, vals[o.key] as number | boolean)).join("") + panelBtn("settings", ICONS.brushSettings, "Brush settings", "Brush settings: the tip, its dynamics, scattering, texture and more");
    const tipEl = optionsEl.querySelector<HTMLCanvasElement>(".paint-tip")!;
    drawThumb(tipEl, brushOf(t, vals, toolBrush(t), "#000000"), getComputedStyle(tipEl.parentElement!).color);
    for (const b of optionsEl.querySelectorAll<HTMLElement>("[data-brush-panel]")) b.addEventListener("click", () => {
      brushPanels.toggle(b.dataset["brushPanel"] as "brushes" | "settings");
      b.setAttribute("aria-pressed", String(brushPanels.isOpen(b.dataset["brushPanel"] as "brushes" | "settings")));
    });
    for (const f of optionsEl.querySelectorAll<HTMLInputElement>('input[type="number"]')) liveNumber(f, (v) => setToolValue(t, f.dataset["opt"]!, v));
    for (const b of optionsEl.querySelectorAll<HTMLElement>("button[data-opt]")) b.addEventListener("click", () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", String(on));
      setToolValue(t, b.dataset["opt"]!, on);
    });
  };
  const startEngine = async (): Promise<BrushEngine | null> => {
    if (!engine && !engineError) {
      try {
        engine = await BrushEngine.start();
        engine.onError = (m) => deps.tell(`The brush engine: ${m}`);
        engine.onLive = (keys, px, side) => session?.showLive(keys, px, side);
      } catch (e) {
        engineError = (e as Error).message;
        deps.tell(`The brush engine did not start (${engineError}): the painting opens, but cannot be painted here.`);
      }
    }
    return engine;
  };
  const brushPanels = mountBrushPanels({
    store,
    view: () => deps.settings.get("paint.brushView"),
    setView: (v) => deps.settings.set("paint.brushView", v),
    engine: startEngine,
    readOnly: deps.readOnly,
    tell: deps.tell,
    tool: () => paintTool(),
    values: toolValues,
    brush: toolBrush,
    preset: toolPreset,
    setTool,
    dock: deps.dock,
  });
  /** The bitmaps the tools' brushes name: kept by the tile GC. */
  const toolTips = (): string[] => TOOL_IDS.flatMap((t) => tipsOf(toolBrush(t)).map((x) => x.key));
  /** Give the engine the bitmaps a brush names (from storage, once each); a missing one paints with its small preview. */
  const ensureTips = async (b: Brush): Promise<void> => {
    const eng = engine;
    if (!eng || !store) return;
    const want = tipsOf(b).filter((t) => !eng.hasTip(t.key));
    if (!want.length) return;
    const got = await Promise.all(want.map((t) => store.tip(t.key, t.w, t.h).catch(() => null)));
    eng.putTips(got.filter((t) => t !== null));
  };
  scrubNumbers(optionsEl);
  /** The rail's tool changed (or the picked layer, which decides what the Eraser takes): the options, the cursor, what is remembered. */
  vhost.editor.layersOpen = true;
  const followTool = (): void => {
    layersEl.hidden = !vhost.editor.layersOpen; // (the dock's Layers button: the canvas's, ADR 0168)
    stage.dataset["tool"] = tool();
    document.body.dataset["paintTarget"] = session?.active()?.kind === "object" && !session.editsMask() ? "vector" : "pixels";
    renderOptions();
    brushPanels.sync(visible && !!session);
    if (deps.settings.get("paint.tool") !== tool()) deps.settings.set("paint.tool", tool());
    if (deps.settings.get("paint.colour") !== colour()) deps.settings.set("paint.colour", colour());
    if (deps.settings.get("eyedropper.size") !== vhost.editor.sampleSize) deps.settings.set("eyedropper.size", vhost.editor.sampleSize);
    if (deps.settings.get("eyedropper.layer") !== vhost.editor.sampleLayer) deps.settings.set("eyedropper.layer", vhost.editor.sampleLayer);
    drawCursor();
  };
  vhost.editor.subscribe(followTool);
  const setColour = (hex: string): void => {
    vhost.editor.penColor = hex;
    vhost.editor.changed();
  };
  const renderBar = (): void => {
    if (!session) return;
    const p = page();
    head.querySelector<HTMLElement>("[data-name]")!.textContent = `${session.painting.name} · ${p.w} × ${p.h} px`;
    vhost.editor.changed(); // (the rail's undo and redo follow the painting's history)
  };

  // ---- the layers panel -----------------------------------------------------------------------------------------------------------

  const renderLayers = (): void => {
    if (!session) return;
    vhost.sync(); // (a pick of a layer only sets activeId: the canvas's tools must follow it now, not on the next change)
    const s = session;
    const stack = s.stack().reverse(); // (top first, as a painting program lists them)
    const act = s.active();
    const row = (l: Layer): string => {
      const on = act?.id === l.id;
      const flag = (attr: string, pressed: boolean, icon: string, label: string, title: string): string => `<button type="button" class="layer-state" ${attr} aria-pressed="${pressed}" aria-label="${esc(label)}" title="${esc(title)}">${icon}</button>`;
      return `<li role="option" class="layer paint-layer${on ? " is-selected" : ""}${l.hidden ? " is-hidden" : ""}" aria-selected="${on}" data-layer="${l.id}">
        <span class="layer-icon">${(ICONS as Record<string, string>)[LAYER_KINDS[l.kind].icon] ?? ""}</span>
        <span class="layer-name" title="${esc(l.name)} (double-click to rename)">${esc(l.name)}</span>
        ${flag("data-eye", !!l.hidden, l.hidden ? ICONS.eyeOff : ICONS.eye, `${l.hidden ? "Show" : "Hide"} ${l.name}`, l.hidden ? "Hidden: show it" : "Hide it")}
        ${flag("data-lock", !!l.locked, ICONS.lockKeyhole, `Lock ${l.name}`, l.locked ? "Locked: it cannot be painted or changed. Press to unlock" : "Lock it: it cannot be painted or changed")}
        ${flag("data-clip", !!l.clipBelow, ICONS.clipBelow, `Clip ${l.name} to the layer below`, l.clipBelow ? "Clipped: shown only where the layer below has paint. Press to show it everywhere" : "Clip to the layer below: show it only where that layer has paint")}
        ${l.mask ? `<button type="button" class="layer-mask${l.mask.off ? " is-off" : ""}" data-mask aria-pressed="${on && s.maskEdit}" aria-label="Paint the mask of ${esc(l.name)}" title="${l.mask.off ? "The mask (turned off). " : "The mask: "}press to paint it (black hides, white shows); press the name to paint the layer again"><canvas data-mask-thumb width="32" height="20" aria-hidden="true"></canvas></button>` : ""}
        ${l.kind === "raster" ? flag("data-alpha", !!l.alphaLock, ICONS.alphaLock, `Alpha lock ${l.name}`, l.alphaLock ? "Alpha lock on: painting only colours what already has paint. Press to paint anywhere" : "Alpha lock: painting only colours what already has paint") : ""}
        ${moreButton(`More actions for layer ${l.name}`, `data-layer-more="${l.id}"`)}
      </li>`;
    };
    const pct = Math.round((act?.opacity ?? 1) * 100);
    const modes = ["", ...BLEND_MODES].map((m) => `<option value="${m}"${m === (act?.blend ?? "") ? " selected" : ""}>${m ? m.replace(/-/g, " ") : "normal"}</option>`).join("");
    layersEl.innerHTML = panelHtml({
      title: "Layers",
      count: stack.length,
      tools: `<button type="button" class="layer-btn" data-act="new-layer" aria-haspopup="menu" aria-expanded="false" aria-label="New layer" title="New layer, above the picked one: paint, fill, adjustment, pattern or picture">${ICONS.newLayer}</button><button type="button" class="layer-btn" data-act="delete-layer" aria-label="Delete the layer" title="Delete the picked layer">${ICONS.trash}</button>`,
      body: `<ul class="paint-layer-list" role="listbox" aria-label="Layers, top first">${stack.map(row).join("")}</ul>`,
      foot: act ? `<label class="layers-blend">Blend <select data-blend aria-label="Blend mode of the picked layer">${modes}</select></label><label class="layers-opacity">Opacity <input type="range" data-opacity min="0" max="100" step="1" value="${pct}" aria-label="Opacity of the picked layer"> <output>${pct}%</output></label>` : "",
    });
    drawMaskThumbs();
  };

  /** The masks' small pictures in the Layers rows: white shows, black hides. */
  const drawMaskThumbs = (): void => {
    if (!session) return;
    for (const c of layersEl.querySelectorAll<HTMLCanvasElement>("[data-mask-thumb]")) {
      const l = session.layers.get(c.closest<HTMLElement>("[data-layer]")!.dataset["layer"]!);
      const m = l && session.mask(l);
      const g = c.getContext("2d")!;
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, c.width, c.height);
      if (m) g.drawImage(m, 0, 0, c.width, c.height);
    }
  };

  /** What a new layer can be (ADR 0166): each kind of layer, made with the canvas's own makers (objects.ts). */
  const newLayerMenu = (anchor: HTMLElement): void => {
    const s = session!;
    const p = s.page();
    const named = (stem: string): string => nextLayerName(s, stem);
    const items: MenuItem[] = [
      { id: "paint", label: "Paint layer", hint: "An empty layer to paint on", icon: ICONS.newLayer, run: () => s.addLayer() },
      { id: "vector", label: "Vector layer", hint: "An empty layer for shapes, paths, pen strokes and texts, edited with the canvas's tools", icon: ICONS.vectorLayer, run: () => {
        s.addLayer(s.freshLayer({ kind: "object", objs: [] }, named("Vector")), "New vector layer");
        if (paintTool()) vhost.editor.setTool("select");
      } },
      { id: "fill", label: "Fill layer", hint: "The page covered by a colour, a gradient or a texture", icon: ICONS.fillLayer, run: () => s.addLayer(s.freshLayer({ kind: "fill", paint: colour() }, named("Fill")), "New fill layer") },
      { id: "adjust", label: "Adjustment layer", hint: "Exposure, colour, levels, curves… of everything below it", icon: ICONS.slidersVertical, run: () => {
        s.addLayer(s.freshLayer({ kind: "adjust", adjust: {} }, named("Adjustment")), "New adjustment layer");
        renderAdjust();
      } },
      { id: "pattern", label: "Pattern…", hint: "One of the pattern generators over the page, as shapes", icon: ICONS.mountainSnow, run: () => {
        closeMoreMenu();
        openMoreMenu(anchor, GENERATORS.map((g): MenuItem => ({ id: g.id, label: g.label, run: () => {
          const seed = Math.floor(Math.random() * 2 ** 31);
          const v = defaultValues(g);
          s.addLayer(s.freshLayer({ kind: "object", objs: stored(patternObjects(g, v, seed, p.w, p.h)), gen: { id: g.id, seed, v } }, g.label), `Pattern: ${g.label}`);
        } })), "Patterns", { compact: true });
      } },
      { id: "picture", label: "Import a picture…", hint: "A picture file, kept in the library, on a layer of its own", icon: ICONS.arrowDownToLine, run: () => pictureInput.click() },
    ];
    openMoreMenu(anchor, items, "New layer");
  };

  const layerMenu = (anchor: HTMLElement, l: Layer): void => {
    const s = session!;
    const items: MenuItem[] = [
      { id: "rename", label: "Rename", icon: ICONS.textCursorInput, run: () => void renameLayer(l) },
      ...(l.kind === "fill" ? [{ id: "fill", label: "Change the fill…", icon: ICONS.fillLayer, run: () => editFill(anchor, l) }] : []),
      ...(l.kind === "adjust" ? [{ id: "adjust", label: "Change the adjustment", icon: ICONS.slidersVertical, run: () => {
        s.activeId = l.id;
        renderLayers();
        renderAdjust();
      } }] : []),
      ...(l.kind === "object" && l.gen ? [{ id: "seed", label: "New seed", hint: "The same pattern, made again with another seed", icon: ICONS.shuffle, run: () => {
        const g = GENERATORS.find((x) => x.id === l.gen!.id);
        if (!g) return;
        const seed = Math.floor(Math.random() * 2 ** 31);
        const pg = s.painting.pages.find((x) => x.id === l.pageId)!;
        s.replaceLayer({ ...l, objs: stored(patternObjects(g, l.gen!.v as never, seed, pg.w, pg.h)), gen: { ...l.gen!, seed } }, "New seed");
      } }] : []),
      ...(l.kind !== "raster" ? [{ id: "rasterize", label: "Rasterize", hint: "Make it a paint layer of the same look, to paint on", icon: ICONS.rasterize, run: () => void rasterize(s, l) }] : []),
      { id: "up", label: "Move up", icon: ICONS.arrowUp, disabled: s.stack().at(-1)?.id === l.id, run: () => s.moveLayer(l.id, 1) },
      { id: "down", label: "Move down", icon: ICONS.arrowDown, disabled: s.stack()[0]?.id === l.id, run: () => s.moveLayer(l.id, -1) },
      { id: "delete", label: "Delete", icon: ICONS.trash, danger: true, disabled: s.stack().length <= 1, run: () => s.deleteLayer(l.id) },
      ...(l.mask
        ? [
            { id: "mask-off", label: l.mask.off ? "Turn the mask on" : "Turn the mask off", hint: "Kept as it is, shown or not", icon: ICONS.eyeClosed, run: () => s.setLayer(l.id, { mask: l.mask!.off ? { tiles: l.mask!.tiles } : { ...l.mask!, off: true } }, l.mask!.off ? "Turn the mask on" : "Turn the mask off") },
            { id: "mask-delete", label: "Delete the mask", hint: "The whole layer shows again", icon: ICONS.trash, run: () => s.setLayer(l.id, { mask: null }, "Delete the mask") },
          ]
        : [{ id: "mask-add", label: "Add a mask", hint: "Paint it black to hide parts of the layer, white to show them again", icon: ICONS.eclipse, run: () => {
            s.setLayer(l.id, { mask: { tiles: {} } }, "Add a mask");
            s.activeId = l.id;
            s.maskEdit = true;
            renderLayers();
            void s.prepare();
          } }]),
    ];
    openMoreMenu(anchor, items, `Layer ${l.name}`);
  };
  /** A layer of any kind made a paint layer (its pictures decoded first, so nothing is left out). */
  const rasterize = async (s: PaintSession, l: Layer): Promise<void> => {
    const p = s.page();
    const probe = document.createElement("canvas");
    probe.width = p.w;
    probe.height = p.h;
    await whenReady(() => drawLayerAlone(probe.getContext("2d")!, scene(s, false), l));
    await s.rasterizeLayer(l.id, (g) => drawLayerAlone(g, scene(s, false), l));
  };

  /** A fill layer's paint, with the canvas's paint chooser (colour, gradient, texture): live while chosen, one step when chosen. */
  const editFill = (anchor: HTMLElement, l: Extract<Layer, { kind: "fill" }>): void => {
    const s = session!;
    openPaintPopover(anchor, {
      name: "Fill",
      paint: l.paint,
      noneLabel: "No fill",
      modes: ["solid", "linear", "radial", "angular", "image", "objects"],
      onInput: (p) => p && s.preview({ ...l, paint: p }),
      onChange: (p) => {
        if (p) s.preview({ ...l, paint: p });
        s.endPreview("Change fill");
      },
      onClose: () => s.dropPreview(),
    });
  };

  /** The adjustment layer picked: its numbers in the panel under the layers (the canvas's Adjust panel, the same controls). */
  let adjustFor: string | null = null;
  const renderAdjust = (): void => {
    const a = session?.active();
    if (!a || a.kind !== "adjust") {
      adjustEl.hidden = true;
      adjustFor = null;
      return;
    }
    adjustEl.hidden = false;
    if (adjustFor === a.id) return;
    adjustFor = a.id;
    adjustEl.innerHTML = panelHtml({ title: "Adjustment", body: `<div data-adjust-body></div>` });
    adjustEl.querySelector("[data-close]")?.addEventListener("click", () => {
      adjustEl.hidden = true;
    });
    const s = session!;
    const id = a.id;
    buildAdjustPanel(adjustEl.querySelector<HTMLElement>("[data-adjust-body]")!, {
      adjust: a.adjust,
      stills: true,
      count: 1,
      onInput: (adjust) => {
        const l = s.layers.get(id);
        if (l?.kind === "adjust") s.preview({ ...l, adjust });
      },
      onChange: (adjust, label) => {
        const l = s.layers.get(id);
        if (l?.kind !== "adjust") return;
        s.preview({ ...l, adjust });
        s.endPreview(label || "Adjust");
      },
      styles: deps.styles,
      onStyles: () => deps.tell("Saved adjustments are in the Styles panel of the canvas."),
    });
  };

  const renameLayer = async (l: Layer): Promise<void> => {
    const name = await promptDialog({ title: "Rename the layer", lines: [], value: l.name, confirmLabel: "Rename" });
    if (name?.trim()) session?.setLayer(l.id, { name: name.trim().slice(0, 80) }, "Rename layer");
  };

  layersEl.addEventListener("click", (e) => {
    const s = session;
    if (!s) return;
    const t = e.target as HTMLElement;
    if (t.closest("[data-close]")) {
      vhost.editor.layersOpen = false;
      return vhost.editor.changed();
    }
    const add = t.closest<HTMLElement>('[data-act="new-layer"]');
    if (add) return newLayerMenu(add);
    if (t.closest('[data-act="delete-layer"]')) {
      const a = s.active();
      if (a) s.deleteLayer(a.id);
      return;
    }
    const li = t.closest<HTMLElement>("[data-layer]");
    if (!li) return;
    const l = s.layers.get(li.dataset["layer"]!);
    if (!l) return;
    const more = t.closest<HTMLElement>("[data-layer-more]");
    if (more) return layerMenu(more, l);
    if (t.closest("[data-eye]")) return s.setLayer(l.id, { hidden: !l.hidden }, l.hidden ? "Show layer" : "Hide layer");
    if (t.closest("[data-lock]")) return s.setLayer(l.id, { locked: !l.locked }, l.locked ? "Unlock layer" : "Lock layer");
    if (t.closest("[data-clip]")) return s.setLayer(l.id, { clipBelow: !l.clipBelow }, l.clipBelow ? "Release the clip" : "Clip to the layer below");
    if (t.closest("[data-alpha]") && l.kind === "raster") return s.setLayer(l.id, { alphaLock: !l.alphaLock }, l.alphaLock ? "Unlock transparency" : "Lock transparency");
    s.maskEdit = !!t.closest("[data-mask]"); // (the mask's picture paints the mask; the rest of the row, the layer)
    s.activeId = l.id;
    renderLayers();
    renderAdjust();
    drawCursor();
    void s.prepare(); // (the engine holds the layer before the first stroke)
  });
  layersEl.addEventListener("dblclick", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-layer]");
    const l = li && session?.layers.get(li.dataset["layer"]!);
    if (l && (e.target as HTMLElement).closest(".layer-name")) void renameLayer(l);
  });
  layersEl.addEventListener("change", (e) => {
    const t = e.target as HTMLElement;
    const a = session?.active();
    if (!a) return;
    if (t.matches("[data-blend]")) session!.setLayer(a.id, { blend: ((t as HTMLSelectElement).value || null) as BlendMode | null }, "Blend mode");
    if (t.matches("[data-opacity]")) session!.setLayer(a.id, { opacity: Number((t as HTMLInputElement).value) / 100 }, "Layer opacity");
  });
  layersEl.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.matches("[data-opacity]")) return;
    t.parentElement!.querySelector("output")!.textContent = `${t.value}%`;
  });

  // ---- the pages strip --------------------------------------------------------------------------------------------------------------

  const renderPages = (): void => {
    if (!session) return;
    const s = session;
    pagesEl.innerHTML = s.painting.pages
      .map((p) => `<span class="paint-page${p.id === s.pageId ? " is-on" : ""}"><button type="button" role="tab" aria-selected="${p.id === s.pageId}" data-page="${p.id}" title="${p.w} × ${p.h} px">${esc(p.name)}</button>${moreButton(`More actions for page ${p.name}`, `data-page-more="${p.id}"`)}</span>`)
      .join("") + `<button type="button" class="paint-add-page" data-act="new-page" aria-label="New page" title="New page after this one, the same size">${ICONS.newPage}</button>`;
  };
  pagesEl.addEventListener("click", (e) => {
    const s = session;
    if (!s) return;
    const t = e.target as HTMLElement;
    if (t.closest('[data-act="new-page"]')) return void s.addPage();
    const more = t.closest<HTMLElement>("[data-page-more]");
    if (more) {
      const p = s.painting.pages.find((x) => x.id === more.dataset["pageMore"]);
      if (!p) return;
      const i = s.painting.pages.indexOf(p);
      openMoreMenu(more, [
        { id: "rename", label: "Rename", icon: ICONS.textCursorInput, run: () => void promptDialog({ title: "Rename the page", lines: [], value: p.name, confirmLabel: "Rename" }).then((n) => n?.trim() && s.setPage(p.id, { name: n.trim().slice(0, 80) }, "Rename page")) },
        { id: "size", label: "Size and resolution…", icon: ICONS.pageSize, run: () => void editPage(p.id) },
        { id: "left", label: "Move earlier", icon: ICONS.arrowUp, disabled: i === 0, run: () => s.movePage(p.id, -1) },
        { id: "right", label: "Move later", icon: ICONS.arrowDown, disabled: i === s.painting.pages.length - 1, run: () => s.movePage(p.id, 1) },
        { id: "delete", label: "Delete", icon: ICONS.trash, danger: true, disabled: s.painting.pages.length <= 1, run: () => void confirmDialog({ title: `Delete “${p.name}”?`, lines: ["The page and its layers are taken out of the painting (Undo brings them back)."], confirmLabel: "Delete" }).then((ok) => ok && s.deletePage(p.id)) },
      ], `Page ${p.name}`);
      return;
    }
    const b = t.closest<HTMLElement>("[data-page]");
    if (b) void s.showPage(b.dataset["page"]!).then(() => fit());
  });

  /** The page's size, resolution and background: a new size keeps the pixels where they are (a larger page has empty room right and below). */
  const editPage = async (id: string): Promise<void> => {
    const s = session!;
    const p = s.painting.pages.find((x) => x.id === id);
    if (!p) return;
    const r = await pageDialog({ title: "Page size and resolution", confirmLabel: "Apply", withName: false, value: { name: p.name, w: p.w, h: p.h, dpi: p.dpi, bg: p.bg } });
    if (!r) return;
    s.setPage(id, { w: r.w, h: r.h, dpi: r.dpi, bg: r.bg }, "Page size");
    fit();
  };

  // ---- the list of paintings --------------------------------------------------------------------------------------------------------

  const list = async (): Promise<Painting[]> => {
    const ws = deps.workspaceId();
    return store && ws ? store.list(ws) : [];
  };
  const renderList = async (): Promise<void> => {
    const items = await list();
    const ul = $<HTMLElement>("[data-items]");
    if (!store) {
      ul.innerHTML = `<li class="paint-empty">Paintings need the browser's storage, which is not available here.</li>`;
      return;
    }
    ul.innerHTML = items.length
      ? items.map((p) => `<li class="paint-item" data-open="${p.id}"><button type="button" class="paint-item-open" data-open-btn="${p.id}"><strong>${esc(p.name)}</strong><small>${p.pages.length} page${p.pages.length === 1 ? "" : "s"} · ${p.pages[0]!.w} × ${p.pages[0]!.h} px · ${new Date(p.modified).toLocaleString()}</small></button>${moreButton(`More actions for painting ${p.name}`, `data-item-more="${p.id}"`)}</li>`).join("")
      : `<li class="paint-empty">No paintings yet. New painting makes one: a page of the size you choose, with one layer to paint on.</li>`;
  };
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const openBtn = t.closest<HTMLElement>("[data-open-btn]");
    if (openBtn) return void open(openBtn.dataset["openBtn"]!);
    const more = t.closest<HTMLElement>("[data-item-more]");
    if (more && store) {
      const id = more.dataset["itemMore"]!;
      void list().then((all) => {
        const p = all.find((x) => x.id === id);
        if (!p) return;
        openMoreMenu(more, [
          { id: "rename", label: "Rename", icon: ICONS.textCursorInput, run: () => void promptDialog({ title: "Rename the painting", lines: [], value: p.name, confirmLabel: "Rename" }).then(async (n) => {
            if (!n?.trim() || deps.readOnly()) return;
            await store.write({ paintings: [{ ...p, name: n.trim().slice(0, 80), modified: Date.now() }] });
            void renderList();
          }) },
          { id: "delete", label: "Delete", icon: ICONS.trash, danger: true, run: () => void confirmDialog({ title: `Delete “${p.name}”?`, lines: ["The painting, its pages and their layers are deleted. This cannot be undone."], confirmLabel: "Delete" }).then(async (ok) => {
            if (!ok || deps.readOnly()) return;
            await store.write({ deletePaintings: [p.id] });
            void store.collect(new Set([...(session?.roots() ?? []), ...toolTips()]));
            void renderList();
          }) },
        ], `Painting ${p.name}`);
      });
      return;
    }
    const act = t.closest<HTMLElement>("[data-act]")?.dataset["act"];
    if (act) void action(act, t.closest<HTMLElement>("[data-act]")!);
  });

  const newPainting = async (): Promise<void> => {
    const ws = deps.workspaceId();
    if (!store || !ws) return deps.tell("Paintings need the browser's storage, which is not available here.");
    if (deps.readOnly()) return deps.tell("This tab is read-only (canvast is open in another tab that saves).");
    const names = (await list()).map((p) => p.name);
    let n = 1;
    while (names.includes(`Painting ${n}`)) n++;
    const spec: PageSpec | null = await pageDialog({ title: "New painting", confirmLabel: "Create", withName: true, value: { name: `Painting ${n}`, w: 1920, h: 1080, dpi: 72, bg: "#ffffff" } });
    if (!spec) return;
    const id = await PaintSession.create(store, ws, spec.name, { w: spec.w, h: spec.h, dpi: spec.dpi, bg: spec.bg });
    await open(id);
  };

  // ---- opening and closing --------------------------------------------------------------------------------------------------------

  /** The whole page in view, as it is turned: its turned box fits the stage, and it is centred in the page box. */
  const fit = (): void => {
    if (!session) return;
    const p = page(), a = (turn * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const { scale } = fitCamera({ w: p.w * c + p.h * s, h: p.w * s + p.h * c }, { w: stage.clientWidth || 1, h: stage.clientHeight || 1 });
    const v = view();
    cam = { scale, x: (v.w - p.w * scale) / 2, y: (v.h - p.h * scale) / 2 };
    redraw();
  };
  const screen = (which: "list" | "editor"): void => {
    listScreen.hidden = which !== "list";
    editor.hidden = which !== "editor";
    root.dataset["screen"] = which;
    document.body.dataset["paintScreen"] = which; // (the bars are for an open painting: the list has none)
  };
  const close = async (): Promise<void> => {
    if (!session) return;
    const s = session;
    s.cancel();
    await s.settled();
    unsub?.();
    unsub = null;
    session = null;
    brushPanels.sync(false);
    if (store) void store.collect(new Set(toolTips())).catch(() => undefined); // (the closed painting's undo can no longer bring tiles back)
  };
  const open = async (id: string): Promise<void> => {
    if (!store) return;
    await close();
    await startEngine();
    const s = await PaintSession.open(store, engine, id, deps.readOnly);
    if (!s) return deps.tell("That painting could not be opened (it was deleted, or its record is damaged).");
    session = s;
    s.onError = deps.tell;
    unsub = s.subscribe((what) => {
      vhost?.sync();
      drawMaskThumbs();
      if (what === "records") {
        renderBar();
        renderLayers();
        renderPages();
      }
      redraw();
    });
    screen("editor");
    vhost?.sync();
    renderBar();
    renderLayers();
    renderPages();
    followTool();
    fit();
    void s.prepare();
  };

  const action = async (act: string, el: HTMLElement): Promise<void> => {
    const s = session;
    switch (act) {
      case "new":
        return newPainting();
      case "list":
        await close();
        screen("list");
        return renderList();
      case "rename":
        if (s) {
          const n = await promptDialog({ title: "Rename the painting", lines: [], value: s.painting.name, confirmLabel: "Rename" });
          if (n !== null) s.rename(n);
        }
        return;
      case "page-size":
        if (s) await editPage(s.pageId);
        return;
      case "painting-menu":
        if (s) {
          const p = page();
          openMoreMenu(el, [
            { id: "rename", label: "Rename…", icon: ICONS.textCursorInput, run: () => void action("rename", el) },
            { id: "page-size", label: "Page size and resolution…", hint: `${p.w} × ${p.h} px · ${p.dpi} DPI`, icon: ICONS.pageSize, run: () => void action("page-size", el) },
            { id: "export", label: "Export the page as PNG", icon: ICONS.imageUp, run: () => void action("export", el) },
            { id: "place", label: "Place the page on the canvas", hint: "A picture in the library, put in the middle of the canvas view", icon: ICONS.placeOnCanvas, run: () => void action("place", el) },
          ], s.painting.name);
        }
        return;
      case "undo":
        return s?.undo();
      case "redo":
        return s?.redo();
      case "zoom-in":
      case "zoom-out":
        if (s) {
          const v = view();
          cam = zoomAt(cam, act === "zoom-in" ? ZOOM_STEP : 1 / ZOOM_STEP, v.w / 2, v.h / 2, page(), v);
          redraw();
        }
        return;
      case "zoom-100":
        if (s) {
          cam = zoomTo(cam, 1, page(), view());
          redraw();
        }
        return;
      case "fit":
        return fit();
      case "export":
        if (s) saveFile(`${fileName(`${s.painting.name} ${page().name}`)}.png`, await pagePng());
        return;
      case "place":
        if (s) await deps.placeOnCanvas(await pagePng(), `${fileName(`${s.painting.name} ${page().name}`)}.png`);
        return;
    }
  };

  /** Draw until every picture the drawing needs is decoded (or two seconds have gone by): an export or a rasterized layer is never made half-drawn. */
  const whenReady = async (draw: () => boolean): Promise<void> => {
    for (let i = 0; i < 40 && draw(); i++) await new Promise((r) => setTimeout(r, 50));
  };
  /** The page at 1:1 as PNG: the same drawing as the view (ADR 0165: what is exported is what is seen), without the checkerboard. */
  const pagePng = async (): Promise<Blob> => {
    const s = session!;
    const p = s.page();
    const c = document.createElement("canvas");
    c.width = p.w;
    c.height = p.h;
    await whenReady(() => {
      const g = c.getContext("2d")!;
      g.clearRect(0, 0, p.w, p.h);
      return composePage(g, scene(s, false), { scale: 1, x: 0, y: 0 });
    });
    return await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("the page could not be made into a PNG"))), "image/png"));
  };

  // ---- the pointer ----------------------------------------------------------------------------------------------------------------

  const pointers = new Map<number, { x: number; y: number }>();
  /** Not a painting tool: the canvas's tools have the pointer (vector-host.ts). */
  const vectorOn = (): boolean => !!session && paintTool() === null;
  let panning: { id: number; x: number; y: number } | null = null;
  let pinch: { d: number; mx: number; my: number } | null = null;
  let stroke: { id: number; started: boolean; queue: number[]; erase: boolean } | null = null;
  let spaceDown = false;
  /** Where the last stroke ended, in page px (Shift-click draws a straight line from it). */
  let lastEnd: [number, number] | null = null;
  const local = toLocal;
  const sample = (e: PointerEvent): number[] => {
    const p = local(e);
    const [x, y] = toPage(cam, p.x, p.y);
    const pressure = e.pointerType === "mouse" ? 1 : e.pressure > 0 ? e.pressure : 0.5;
    return [x, y, pressure, e.tiltX || 0, e.tiltY || 0, e.twist || 0, e.timeStamp];
  };
  const send = (nums: number[]): void => {
    if (!stroke) return;
    if (!stroke.started) {
      stroke.queue.push(...nums);
      return;
    }
    session?.points(new Float32Array(nums));
  };

  /** Alt-click with a painting tool: the Eyedropper's pick. */
  const pickColour = (p: { x: number; y: number }): void => {
    const c = samplePage(p, vhost.editor.sampleSize);
    if (c) setColour(c);
  };

  /** Whether a colour (#rrggbb) is light: on a mask it shows rather than hides. */
  const light = (hex: string): boolean => [1, 3, 5].reduce((a, i, n) => a + parseInt(hex.slice(i, i + 2), 16) * [0.2126, 0.7152, 0.0722][n]!, 0) >= 128;
  /** Whether the active layer's pixel at page px (x, y) is the paint colour (the Pencil's Auto erase). */
  const onColour = (s: PaintSession, x: number, y: number): boolean => {
    const l = s.active();
    const c = l && s.image(l);
    if (!c || x < 0 || y < 0 || x >= c.width || y >= c.height) return false;
    const d = c.getContext("2d")!.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    return d[3]! > 0 && `#${[d[0], d[1], d[2]].map((v) => v!.toString(16).padStart(2, "0")).join("")}` === colour().toLowerCase();
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (!session || vectorOn()) return;
    canvas.focus();
    const p = local(e);
    pointers.set(e.pointerId, p);
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      // A second finger: the stroke is dropped and the two fingers pan and zoom.
      if (stroke) {
        session.cancel();
        stroke = null;
      }
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      panning = null;
      return;
    }
    if (pointers.size > 2) return;
    if (e.button === 1 || spaceDown) {
      panning = { id: e.pointerId, x: p.x, y: p.y };
      stage.classList.add("is-panning");
      e.preventDefault();
      return;
    }
    const pt = paintTool();
    if (e.button !== 0 || !pt) return;
    if (e.altKey) return pickColour(p);
    const why = session.cannotPaint();
    if (why) return deps.tell(why);
    const s = session;
    const first = sample(e);
    const onMask = s.editsMask();
    const brush = brushOf(pt, toolValues(pt), toolBrush(pt), onMask ? "#000000" : colour());
    if (onMask) brush["erase"] = pt === "eraser" || light(colour()); // (on a mask dark paint hides and light paint, or the Eraser, shows)
    else if (toolValues(pt)["autoErase"] === true && onColour(s, first[0]!, first[1]!)) brush["erase"] = true;
    const st = { id: e.pointerId, started: false, queue: [] as number[], erase: brush["erase"] === true };
    stroke = st;
    if (e.shiftKey && lastEnd) st.queue.push(lastEnd[0], lastEnd[1], first[2]!, 0, 0, 0, first[6]! - 1);
    st.queue.push(...first);
    void ensureTips(brush).then(() => s.begin({ brush, erase: st.erase })).then((ok) => {
      if (stroke !== st) return; // (cancelled meanwhile)
      if (!ok) {
        stroke = null;
        return;
      }
      st.started = true;
      if (st.queue.length) s.points(new Float32Array(st.queue));
      st.queue = [];
      if (st.id === -1) finish(s, st); // (the pointer was lifted before the stroke began)
    });
  });
  const finish = (s: PaintSession, st: NonNullable<typeof stroke>): void => {
    void s.end(st.erase ? "Erase" : "Paint").then(() => redraw());
    if (stroke === st) stroke = null;
  };
  canvas.addEventListener("pointermove", (e) => {
    const p = local(e);
    pointerAt = p;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pinch && pointers.size === 2 && session) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      cam = zoomAt({ ...cam, x: cam.x + mx - pinch.mx, y: cam.y + my - pinch.my }, pinch.d > 0 ? d / pinch.d : 1, mx, my, page(), view());
      pinch = { d, mx, my };
      redraw();
    } else if (panning && panning.id === e.pointerId && session) {
      cam = clampCamera({ ...cam, x: cam.x + p.x - panning.x, y: cam.y + p.y - panning.y }, page(), view());
      panning = { ...panning, x: p.x, y: p.y };
      redraw();
    } else if (stroke && stroke.id === e.pointerId) {
      const evs = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      send((evs.length ? evs : [e]).flatMap(sample));
    }
    drawCursor();
  });
  const up = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) pinch = null;
    if (panning?.id === e.pointerId) {
      panning = null;
      stage.classList.remove("is-panning");
    }
    if (!stroke || stroke.id !== e.pointerId || !session) return;
    const st = stroke;
    if (e.type === "pointercancel") {
      session.cancel();
      stroke = null;
      return;
    }
    const s = sample(e);
    lastEnd = [s[0]!, s[1]!];
    if (!st.started) {
      st.id = -1; // (it ends as soon as it has begun)
      return;
    }
    finish(session, st);
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("pointerleave", () => {
    pointerAt = null;
    drawCursor();
  });
  canvas.addEventListener("wheel", (e) => {
    if (!session) return;
    e.preventDefault();
    const p = local(e);
    if (e.shiftKey) cam = clampCamera({ ...cam, x: cam.x - e.deltaY, y: cam.y }, page(), view());
    else cam = zoomAt(cam, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), p.x, p.y, page(), view());
    redraw();
    drawCursor();
  }, { passive: false });

  // ---- pictures and pasting (ADR 0166) ----------------------------------------------------------------------------------------------

  /** A picture file: into the library, then on a layer of its own. */
  const addPicture = async (file: File): Promise<void> => {
    const s = session;
    if (!s) return;
    const rec = await deps.importPicture(file);
    if (!rec) return;
    s.addLayer(s.freshLayer({ kind: "object", objs: stored([pictureObject(rec, s.page())]) }, file.name.replace(/\.[^.]*$/, "").slice(0, 60) || "Picture"), "Import a picture");
  };
  pictureInput.addEventListener("change", () => {
    const f = pictureInput.files?.[0];
    pictureInput.value = "";
    if (f) void addPicture(f);
  });
  /** Pasted: objects copied on the canvas come as a shape layer, at the size they were seen at (fitted to the page); a picture as a picture layer. */
  const typing = (e: Event): boolean => !!(e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable], dialog");
  // With a vector tool, copy, cut and paste are the canvas's own, on the picked vector layer (ADR 0167).
  for (const kind of ["copy", "cut"] as const) {
    document.addEventListener(kind, (e) => {
      if (!visible || typing(e) || !vhost || !vectorOn()) return;
      if ((kind === "copy" ? copySelection : cutSelection)(vhost.doc, vhost.editor, vhost.view, e)) e.preventDefault();
    });
  }
  document.addEventListener("paste", (e) => {
    const s = session;
    if (!s || !visible || typing(e)) return;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (vhost && vectorOn() && text && pasteObjects(vhost.doc, vhost.editor, vhost.view, text)) {
      e.preventDefault();
      return;
    }
    const payload = parsePayload(text);
    if (payload) {
      e.preventDefault();
      try {
        const objs = instantiate(payload, pageSpace(), 0).objects;
        s.addLayer(s.freshLayer({ kind: "object", objs: stored(placeOnPage(objs, payload.depth, s.page())) }, nextLayerName(s, "Pasted")), "Paste");
      } catch {
        deps.tell("Those objects were copied deep inside a zoom of the canvas and cannot come to a page; copy them at the top level, or paste them as a picture.");
      }
      return;
    }
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
    if (file) {
      e.preventDefault();
      void addPicture(file);
    }
  });

  // ---- keys -----------------------------------------------------------------------------------------------------------------------

  // The tool letters, undo and redo, Delete, Enter, Escape and the Ctrl keys are the canvas's tools' (vector-host.ts, one keymap, ADR 0168);
  // the Painting view keeps its zoom, the brush size and Space for the painting tools.
  window.addEventListener("keydown", (e) => {
    if (!session || !shortcutsActive(e, "paint") || e.key !== "Escape" || !stroke) return;
    e.stopImmediatePropagation(); // (Escape drops the stroke being painted, and does nothing else)
    session.cancel();
    stroke = null;
  }, { capture: true });
  window.addEventListener("keydown", (e) => {
    if (!session || !shortcutsActive(e, "paint")) return;
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    const pt = paintTool();
    if (mod && k === "0") {
      e.preventDefault();
      fit();
    } else if (mod && k === "1") {
      e.preventDefault();
      void action("zoom-100", canvas);
    } else if (mod || e.altKey) return;
    else if (k === " " && pt) {
      e.preventDefault();
      if (!spaceDown) stage.classList.add("is-hand");
      spaceDown = true;
    } else if (k === "4" || k === "6") setTurn(turn + (k === "4" ? -TURN_STEP : TURN_STEP));
    else if (k === "5") setTurn(0, false);
    else if (k === "m" || k === "M") setTurn(turn, !mirror);
    else if (k === "+" || k === "=") void action("zoom-in", canvas);
    else if (k === "-") void action("zoom-out", canvas);
    else if ((k === "[" || k === "]") && pt) {
      const v = Number(toolValues(pt)["size"]);
      setToolValue(pt, "size", Math.min(1000, Math.max(1, Math.round(k === "]" ? Math.max(v + 1, v * 1.15) : Math.min(v - 1, v / 1.15)))));
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.key !== " ") return;
    spaceDown = false;
    stage.classList.remove("is-hand");
  });

  if (deps.settings.get("paint.tool") !== vhost.editor.tool) vhost.editor.setTool(deps.settings.get("paint.tool"));
  vhost.editor.penColor = deps.settings.get("paint.colour");
  screen("list");

  return {
    show() {
      visible = true;
      root.hidden = false;
      if (session) {
        renderBar();
        renderLayers();
        renderPages();
        redraw();
      } else void renderList();
      brushPanels.sync(!!session);
    },
    hide() {
      visible = false;
      root.hidden = true;
      closeMoreMenu();
      brushPanels.sync(false);
    },
    get session() {
      return session;
    },
    list,
    open,
    drawNow: draw,
    get camera() {
      return cam;
    },
    head,
    vector: vhost,
    fit,
    turnMenu,
    clientOf: (x, y) => clientOf(cam.x + x * cam.scale, cam.y + y * cam.scale),
    brushes: brushPanels,
    brushState: () => {
      const t = paintTool();
      return t ? { tool: t, preset: toolPreset(t), brush: toolBrush(t), values: toolValues(t) } : null;
    },
  };
}
