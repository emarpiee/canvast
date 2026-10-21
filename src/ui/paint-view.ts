/**
 * The Painting view (ADR 0165): a view of its own beside the Canvas, the Library and Settings, with its own rules: pages in px, a bounded
 * camera, raster layers painted with the brush engine (ADR 0164). Two screens: the workspace's paintings, and an open painting (bar,
 * tools, the page, its layers and its pages). Built from the registries (paint/tools.ts TOOLS, paint/model.ts LAYER_KINDS), the shared
 * panel shape, menus, dialogs and colour picker; nothing here is copied from the canvas.
 */
import { ICONS } from "./icons";
import { esc } from "./format";
import { panelHtml } from "./panel";
import { closeMoreMenu, moreButton, openMoreMenu, type MenuItem } from "./more-menu";
import { confirmDialog, promptDialog } from "./confirm";
import { openColourPopover, rememberColour } from "./colour-popover";
import { liveNumber } from "./live";
import { scrubNumbers } from "../colour-picker/scrub";
import { saveFile } from "./file-actions";
import { pageDialog, type PageSpec } from "./paint-dialogs";
import { shortcutsActive } from "../interaction/shortcut-scope";
import type { SettingsStore } from "../settings/settings";
import { BLEND_MODES, type BlendMode } from "../doc/model";
import { PaintStore } from "../paint/store";
import { PaintSession } from "../paint/session";
import { BrushEngine } from "../paint/engine";
import { composePage } from "../paint/compose";
import { clampCamera, fitCamera, toPage, zoomAt, zoomTo, type PaintCamera } from "../paint/camera";
import { TOOLS, TOOL_IDS, brushOf, toolForKey, valuesOf, type OptionSpec, type ToolId } from "../paint/tools";
import { LAYER_KINDS, type Layer, type Painting } from "../paint/model";

export interface PaintViewDeps {
  readonly db: IDBDatabase | null;
  workspaceId(): string | null;
  readOnly(): boolean;
  readonly settings: SettingsStore;
  /** A notice (the app's notices). */
  tell(text: string): void;
  /** Put a picture on the canvas (through the library) and show the canvas. */
  placeOnCanvas(png: Blob, name: string): Promise<void>;
}

export interface PaintView {
  show(): void;
  hide(): void;
  /** For the test hook: the open painting's session, if any. */
  readonly session: PaintSession | null;
  /** The list of paintings shown (for the test hook). */
  list(): Promise<Painting[]>;
  open(id: string): Promise<void>;
  /** Draw now (the test hook reads pixels after it). */
  drawNow(): void;
  readonly camera: PaintCamera;
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
  let tool: ToolId = deps.settings.get("paint.tool");
  let colour = deps.settings.get("paint.colour");
  const toolValues = (t: ToolId): Record<string, number | boolean> => valuesOf(t, (deps.settings.get("paint.tools") as Record<string, unknown>)[t]);
  const setToolValue = (t: ToolId, key: string, v: number | boolean): void => {
    const all = { ...(deps.settings.get("paint.tools") as Record<string, unknown>) };
    all[t] = { ...toolValues(t), [key]: v };
    deps.settings.set("paint.tools", all);
  };

  root.innerHTML = `
    <div class="paint-list" data-screen="list">
      <header class="paint-list-head">
        <h1>Paintings</h1>
        <button type="button" class="is-primary" data-act="new" data-testid="paint-new">${ICONS.newPainting}<span>New painting</span></button>
      </header>
      <ul class="paint-items" data-items aria-label="Paintings"></ul>
    </div>
    <div class="paint-editor" data-screen="editor" hidden>
      <div class="paint-bar" role="toolbar" aria-label="Painting">
        <button type="button" data-act="list" aria-label="All paintings" title="All paintings">${ICONS.paintings}</button>
        <button type="button" class="paint-name" data-act="rename" data-name title="Rename the painting"></button>
        <button type="button" class="paint-size" data-act="page-size" data-page-size title="Page size and resolution">${ICONS.pageSize}<span></span></button>
        <span class="paint-spacer"></span>
        <button type="button" data-act="undo" aria-label="Undo" title="Undo (Ctrl+Z)">${ICONS.undo}</button>
        <button type="button" data-act="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${ICONS.redo}</button>
        <span class="paint-sep" role="separator"></span>
        <button type="button" data-act="zoom-out" aria-label="Zoom out" title="Zoom out (−)">${ICONS.minus}</button>
        <button type="button" class="paint-zoom" data-act="zoom-100" data-zoom title="Actual size, 100 % (Ctrl+1)">100 %</button>
        <button type="button" data-act="zoom-in" aria-label="Zoom in" title="Zoom in (+)">${ICONS.plus}</button>
        <button type="button" data-act="fit" aria-label="Fit the page in the view" title="Fit the page in the view (Ctrl+0)">${ICONS.fitPage}</button>
        <span class="paint-sep" role="separator"></span>
        <button type="button" data-act="export" aria-label="Export the page as PNG" title="Export the page as PNG">${ICONS.imageUp}</button>
        <button type="button" data-act="place" aria-label="Place the page on the canvas" title="Place the page on the canvas: a picture in the library, put in the middle of the canvas view">${ICONS.placeOnCanvas}</button>
      </div>
      <div class="paint-bar paint-options" data-options role="group" aria-label="Tool options"></div>
      <div class="paint-main">
        <div class="paint-rail" role="radiogroup" aria-label="Tool" aria-orientation="vertical">
          ${TOOL_IDS.map((t) => `<button type="button" role="radio" data-tool="${t}" aria-label="${TOOLS[t].label}" title="${TOOLS[t].label} (${TOOLS[t].key}): ${esc(TOOLS[t].hint)}">${(ICONS as Record<string, string>)[TOOLS[t].icon === "eraser" ? "paintEraser" : TOOLS[t].icon]}</button>`).join("")}
          <button type="button" class="swatch swatch-current" data-act="colour" aria-haspopup="dialog" aria-expanded="false" aria-label="Paint colour" title="Paint colour (Alt-click the page to pick one from it)"><span data-chip></span></button>
        </div>
        <div class="paint-stage" data-stage>
          <canvas class="paint-canvas" data-testid="paint-canvas" tabindex="0" aria-label="The page: paint with the picked tool"></canvas>
          <canvas class="paint-cursor" aria-hidden="true"></canvas>
        </div>
        <aside class="paint-layers" data-layers aria-label="Layers"></aside>
      </div>
      <div class="paint-pages" data-pages role="tablist" aria-label="Pages"></div>
    </div>`;
  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const listScreen = $<HTMLElement>('[data-screen="list"]');
  const editor = $<HTMLElement>('[data-screen="editor"]');
  const stage = $<HTMLElement>("[data-stage]");
  const canvas = $<HTMLCanvasElement>(".paint-canvas");
  const cursor = $<HTMLCanvasElement>(".paint-cursor");
  const layersEl = $<HTMLElement>("[data-layers]");
  const pagesEl = $<HTMLElement>("[data-pages]");
  const optionsEl = $<HTMLElement>("[data-options]");

  const view = (): { w: number; h: number } => ({ w: stage.clientWidth || 1, h: stage.clientHeight || 1 });
  const page = () => session!.page();

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
    composePage(g, { page: s.page(), stack: s.stack(), image: (l) => s.image(l), live: s.live }, { scale: cam.scale * dpr, x: cam.x * dpr, y: cam.y * dpr, checker: true }, { light: css.getPropertyValue("--check-a").trim() || "#ffffff", dark: css.getPropertyValue("--check-b").trim() || "#d9d9d9" });
    $<HTMLElement>("[data-zoom]").textContent = `${Math.round(cam.scale * 100)} %`;
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
    if (!pointerAt || !TOOLS[tool].action.paint || panning) return;
    const r = (Number(toolValues(tool)["size"]) / 2) * cam.scale * dpr;
    g.lineWidth = 1;
    for (const [c, d] of [[css.getPropertyValue("--white").trim() || "#fff", 1], [css.getPropertyValue("--black").trim() || "#000", 0]] as const) {
      g.strokeStyle = c;
      g.beginPath();
      g.arc(pointerAt.x * dpr, pointerAt.y * dpr, Math.max(1.5, r + d), 0, Math.PI * 2);
      g.stroke();
    }
  };
  new ResizeObserver(() => {
    if (!session) return;
    cam = clampCamera(cam, page(), view());
    redraw();
  }).observe(stage);

  // ---- the bar, the rail, the options --------------------------------------------------------------------------------------------------

  const optionHtml = (o: OptionSpec, v: number | boolean): string =>
    o.kind === "number"
      ? `<label class="tb-count" title="${esc(o.hint)}">${esc(o.label)} <input type="number" data-opt="${o.key}" min="${o.min}" max="${o.max}" step="${o.step}" inputmode="numeric" value="${v}" aria-label="${esc(o.label)}${o.percent ? " (%)" : o.unit ? ` (${o.unit})` : ""}"></label>`
      : `<label class="tb-count" title="${esc(o.hint)}"><input type="checkbox" data-opt="${o.key}"${v ? " checked" : ""}> ${esc(o.label)}</label>`;
  const renderOptions = (): void => {
    const vals = toolValues(tool);
    optionsEl.innerHTML = (TOOLS[tool].options as readonly OptionSpec[]).map((o) => optionHtml(o, vals[o.key]!)).join("");
    for (const f of optionsEl.querySelectorAll<HTMLInputElement>('input[type="number"]')) liveNumber(f, (v) => setToolValue(tool, f.dataset["opt"]!, v));
    for (const c of optionsEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) c.addEventListener("change", () => setToolValue(tool, c.dataset["opt"]!, c.checked));
  };
  scrubNumbers(optionsEl);
  const setTool = (t: ToolId): void => {
    tool = t;
    deps.settings.set("paint.tool", t);
    for (const b of root.querySelectorAll<HTMLElement>(".paint-rail [data-tool]")) b.setAttribute("aria-checked", String(b.dataset["tool"] === t));
    stage.dataset["tool"] = t;
    renderOptions();
    drawCursor();
  };
  const renderBar = (): void => {
    if (!session) return;
    const p = page();
    $<HTMLElement>("[data-name]").textContent = session.painting.name;
    $<HTMLElement>("[data-page-size] span").textContent = `${p.w} × ${p.h} px · ${p.dpi} DPI`;
    $<HTMLButtonElement>('[data-act="undo"]').disabled = !session.history.canUndo;
    $<HTMLButtonElement>('[data-act="redo"]').disabled = !session.history.canRedo;
    $<HTMLElement>("[data-chip]").style.setProperty("--paint", colour);
  };

  // ---- the layers panel -----------------------------------------------------------------------------------------------------------

  const renderLayers = (): void => {
    if (!session) return;
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
        ${flag("data-alpha", !!l.alphaLock, ICONS.alphaLock, `Alpha lock ${l.name}`, l.alphaLock ? "Alpha lock on: painting only colours what already has paint. Press to paint anywhere" : "Alpha lock: painting only colours what already has paint")}
        ${moreButton(`More actions for layer ${l.name}`, `data-layer-more="${l.id}"`)}
      </li>`;
    };
    const pct = Math.round((act?.opacity ?? 1) * 100);
    const modes = ["", ...BLEND_MODES].map((m) => `<option value="${m}"${m === (act?.blend ?? "") ? " selected" : ""}>${m ? m.replace(/-/g, " ") : "normal"}</option>`).join("");
    layersEl.innerHTML = panelHtml({
      title: "Layers",
      count: stack.length,
      tools: `<button type="button" class="layer-btn" data-act="new-layer" aria-label="New layer" title="New layer, above the picked one">${ICONS.newLayer}</button><button type="button" class="layer-btn" data-act="delete-layer" aria-label="Delete the layer" title="Delete the picked layer">${ICONS.trash}</button>`,
      body: `<ul class="paint-layer-list" role="listbox" aria-label="Layers, top first">${stack.map(row).join("")}</ul>`,
      foot: act ? `<label class="layers-blend">Blend <select data-blend aria-label="Blend mode of the picked layer">${modes}</select></label><label class="layers-opacity">Opacity <input type="range" data-opacity min="0" max="100" step="1" value="${pct}" aria-label="Opacity of the picked layer"> <output>${pct}%</output></label>` : "",
    });
    layersEl.querySelector("[data-close]")?.remove(); // (part of the view, not a floating panel)
  };

  const layerMenu = (anchor: HTMLElement, l: Layer): void => {
    const s = session!;
    const items: MenuItem[] = [
      { id: "rename", label: "Rename", icon: ICONS.textCursorInput, run: () => void renameLayer(l) },
      { id: "up", label: "Move up", icon: ICONS.arrowUp, disabled: s.stack().at(-1)?.id === l.id, run: () => s.moveLayer(l.id, 1) },
      { id: "down", label: "Move down", icon: ICONS.arrowDown, disabled: s.stack()[0]?.id === l.id, run: () => s.moveLayer(l.id, -1) },
      { id: "delete", label: "Delete", icon: ICONS.trash, danger: true, disabled: s.stack().length <= 1, run: () => s.deleteLayer(l.id) },
    ];
    openMoreMenu(anchor, items, `Layer ${l.name}`);
  };
  const renameLayer = async (l: Layer): Promise<void> => {
    const name = await promptDialog({ title: "Rename the layer", lines: [], value: l.name, confirmLabel: "Rename" });
    if (name?.trim()) session?.setLayer(l.id, { name: name.trim().slice(0, 80) }, "Rename layer");
  };

  layersEl.addEventListener("click", (e) => {
    const s = session;
    if (!s) return;
    const t = e.target as HTMLElement;
    if (t.closest('[data-act="new-layer"]')) return void s.addLayer();
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
    if (t.closest("[data-alpha]")) return s.setLayer(l.id, { alphaLock: !l.alphaLock }, l.alphaLock ? "Unlock transparency" : "Lock transparency");
    s.activeId = l.id;
    renderLayers();
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
            void store.collect(session?.roots() ?? new Set());
            void renderList();
          }) },
        ], `Painting ${p.name}`);
      });
      return;
    }
    const act = t.closest<HTMLElement>("[data-act]")?.dataset["act"];
    if (act) void action(act, t.closest<HTMLElement>("[data-act]")!);
    const tb = t.closest<HTMLElement>(".paint-rail [data-tool]");
    if (tb) setTool(tb.dataset["tool"] as ToolId);
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

  const fit = (): void => {
    if (!session) return;
    cam = fitCamera(page(), view());
    redraw();
  };
  const screen = (which: "list" | "editor"): void => {
    listScreen.hidden = which !== "list";
    editor.hidden = which !== "editor";
    root.dataset["screen"] = which;
  };
  const close = async (): Promise<void> => {
    if (!session) return;
    const s = session;
    s.cancel();
    await s.settled();
    unsub?.();
    unsub = null;
    session = null;
    if (store) void store.collect(new Set()).catch(() => undefined); // (the closed painting's undo can no longer bring tiles back)
  };
  const open = async (id: string): Promise<void> => {
    if (!store) return;
    await close();
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
    const s = await PaintSession.open(store, engine, id, deps.readOnly);
    if (!s) return deps.tell("That painting could not be opened (it was deleted, or its record is damaged).");
    session = s;
    s.onError = deps.tell;
    unsub = s.subscribe((what) => {
      if (what === "records") {
        renderBar();
        renderLayers();
        renderPages();
      }
      redraw();
    });
    screen("editor");
    renderBar();
    renderLayers();
    renderPages();
    setTool(tool);
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
      case "colour":
        openColourPopover(el, {
          name: "Paint colour",
          value: colour,
          onInput: (hex) => setColour(hex.slice(0, 7)),
          onChange: (hex) => rememberColour(hex.slice(0, 7)),
        });
        return;
    }
  };
  const setColour = (hex: string): void => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    colour = hex.toLowerCase();
    deps.settings.set("paint.colour", colour);
    renderBar();
  };

  /** The page at 1:1 as PNG: the same drawing as the view (ADR 0165: what is exported is what is seen), without the checkerboard. */
  const pagePng = async (): Promise<Blob> => {
    const s = session!;
    const p = s.page();
    const c = document.createElement("canvas");
    c.width = p.w;
    c.height = p.h;
    composePage(c.getContext("2d")!, { page: p, stack: s.stack(), image: (l) => s.image(l) }, { scale: 1, x: 0, y: 0 });
    return await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("the page could not be made into a PNG"))), "image/png"));
  };

  // ---- the pointer ----------------------------------------------------------------------------------------------------------------

  const pointers = new Map<number, { x: number; y: number }>();
  let panning: { id: number; x: number; y: number } | null = null;
  let pinch: { d: number; mx: number; my: number } | null = null;
  let stroke: { id: number; started: boolean; queue: number[] } | null = null;
  let spaceDown = false;
  /** Where the last stroke ended, in page px (Shift-click draws a straight line from it). */
  let lastEnd: [number, number] | null = null;
  const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
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

  const pickColour = (p: { x: number; y: number }): void => {
    const dpr = window.devicePixelRatio || 1;
    const d = canvas.getContext("2d")!.getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1).data;
    setColour(`#${[d[0], d[1], d[2]].map((v) => v!.toString(16).padStart(2, "0")).join("")}`);
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (!session) return;
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
    if (e.button === 1 || spaceDown || tool === "hand") {
      panning = { id: e.pointerId, x: p.x, y: p.y };
      stage.classList.add("is-panning");
      e.preventDefault();
      return;
    }
    if (e.button !== 0 || !TOOLS[tool].action.paint) return;
    if (e.altKey) return pickColour(p);
    const why = session.cannotPaint();
    if (why) return deps.tell(why);
    const s = session;
    const st = { id: e.pointerId, started: false, queue: [] as number[] };
    stroke = st;
    const first = sample(e);
    if (e.shiftKey && lastEnd) st.queue.push(lastEnd[0], lastEnd[1], first[2]!, 0, 0, 0, first[6]! - 1);
    st.queue.push(...first);
    const a = TOOLS[tool].action;
    void s.begin({ brush: brushOf(tool, toolValues(tool), colour), erase: a.paint && a.erase }).then((ok) => {
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
    void s.end(tool === "eraser" ? "Erase" : "Paint").then(() => redraw());
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

  // ---- keys -----------------------------------------------------------------------------------------------------------------------

  window.addEventListener("keydown", (e) => {
    if (!session || !shortcutsActive(e, "paint")) return;
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) session.redo();
      else session.undo();
    } else if (mod && k.toLowerCase() === "y") {
      e.preventDefault();
      session.redo();
    } else if (mod && k === "0") {
      e.preventDefault();
      fit();
    } else if (mod && k === "1") {
      e.preventDefault();
      void action("zoom-100", canvas);
    } else if (mod || e.altKey) return;
    else if (k === " ") {
      e.preventDefault();
      if (!spaceDown) stage.classList.add("is-hand");
      spaceDown = true;
    } else if (k === "+" || k === "=") void action("zoom-in", canvas);
    else if (k === "-") void action("zoom-out", canvas);
    else if ((k === "[" || k === "]") && TOOLS[tool].action.paint) {
      const v = Number(toolValues(tool)["size"]);
      setToolValue(tool, "size", Math.min(1000, Math.max(1, Math.round(k === "]" ? Math.max(v + 1, v * 1.15) : Math.min(v - 1, v / 1.15)))));
      renderOptions();
      drawCursor();
    } else if (k === "Escape" && stroke) {
      session.cancel();
      stroke = null;
    } else {
      const t = toolForKey(k);
      if (t) {
        e.preventDefault();
        setTool(t);
      }
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.key !== " ") return;
    spaceDown = false;
    stage.classList.remove("is-hand");
  });

  setTool(tool);
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
    },
    hide() {
      visible = false;
      root.hidden = true;
      closeMoreMenu();
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
  };
}
