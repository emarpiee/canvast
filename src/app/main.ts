import { ViewState } from "./view-state";
import { FrameStats } from "./frame-stats";
import type { FrameBreakdown } from "./frame-stats";
import { mountHud } from "./hud";
import { installDebugHook } from "./debug-hook";
import { EditorState } from "./editor-state";
import { deleteSelection, importImages, redo, undo } from "./actions";
import { attachNavigation } from "../interaction/navigation";
import { attachTools } from "../interaction/tools";
import { renderFrame } from "../render/canvas2d-renderer";
import type { Theme } from "../render/canvas2d-renderer";
import { batchRuns, drawObjects, drawOverlays } from "../render/scene-renderer";
import { strokeLineWidth } from "../render/draw-objects";
import type { ProjectedObject } from "../render/projection";
import { TileCache } from "../render/tile-cache";
import type { SceneTheme } from "../render/scene-renderer";
import { visibleObjects } from "../render/scene-view";
import { LANDMARKS } from "../scene/landmarks";
import { DocumentStore } from "../doc/document-store";
import { SpatialIndex, syncIndex } from "../scene/spatial-index";
import { AssetLibrary } from "../assets/asset-library";
import { openDb } from "../storage/idb";
import { WorkspaceRepo } from "../storage/workspace-repo";
import type { SaveState } from "../storage/canvas-persistence";
import { Session } from "./session";
import { mountNavigator } from "../ui/navigator";
import { mountStoragePanel } from "../ui/storage-panel";
import { mountToolbar } from "../ui/toolbar";
import { mountDevPanel } from "../ui/dev-panel";
import { mountAssetsView } from "../ui/assets-view";
import { mountViewSwitch } from "../ui/view-switch";
import type { AppView } from "../ui/view-switch";
import { isArchiveFile, runImport } from "../ui/archive-ui";

declare const __CANVAST_DEBUG__: boolean;
declare const __CANVAST_VERSION__: string;

function readTheme(el: HTMLElement): Theme & SceneTheme {
  const css = getComputedStyle(el);
  const v = (name: string): string => css.getPropertyValue(name).trim();
  return {
    background: v("--canvas-bg"),
    grid: v("--canvas-grid"),
    axis: v("--canvas-axis"),
    landmark: v("--canvas-landmark"),
    landmarkLabel: v("--canvas-landmark-label"),
    selection: v("--canvas-selection"),
    handleFill: v("--canvas-handle-fill"),
    lasso: v("--canvas-lasso"),
    imagePlaceholder: v("--canvas-image-placeholder"),
  };
}

const SAVE_TEXT: Record<SaveState, string> = {
  verified: "Saved (verified)",
  committed: "Saved",
  queued: "Unsaved changes…",
  saving: "Saving…",
  readonly: "Read-only (another tab is editing)",
  conflict: "Not saved — changed in another tab; reload to continue",
  error: "Save failed — changes are only in memory",
  unavailable: "Storage unavailable — changes are only in memory",
};

async function start(): Promise<void> {
  const debug = __CANVAST_DEBUG__ || location.hash.includes("debug");
  const host = document.getElementById("canvas-host")!;
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    host.textContent = "canvast could not create a 2D drawing surface in this browser.";
    return;
  }

  const view = new ViewState();
  const stats = new FrameStats();
  const doc = new DocumentStore();
  // The spatial index mirrors the document incrementally (changed ids only).
  const index = new SpatialIndex();
  syncIndex(doc, index);
  // Committed objects are drawn through a raster tile cache (ADR 0009).
  const tiles = new TileCache((id) => doc.get(id));
  doc.subscribe((_source, changed) => tiles.invalidate(changed));
  const editor = new EditorState();
  let theme = readTheme(document.documentElement);
  let dpr = window.devicePixelRatio || 1;
  let scheduled = false;
  let frameWaiters: Array<() => void> = [];

  let db: IDBDatabase | null = null;
  let storageError = "";
  try {
    db = await openDb(undefined, {
      onBlocked: () => {
        editor.message = "Upgrading storage: close other canvast tabs to continue.";
        editor.changed();
      },
      onVersionChange: () => {
        editor.message = "canvast was upgraded in another tab. Reload this tab to keep working.";
        editor.readOnly = true;
        editor.changed();
      },
    });
  } catch (e) {
    storageError = (e as Error).message;
  }

  const invalidate = (): void => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(draw);
  };
  const assets = new AssetLibrary(db, () => {
    tiles.dropPending(); // an original finished loading: redraw tiles that showed its placeholder
    invalidate();
  });

  /** Render synchronously and return the timing breakdown. */
  const renderNow = (): FrameBreakdown => {
    const t0 = performance.now();
    const cam = view.camera;
    const vp = view.viewport;
    renderFrame(ctx, cam, vp, dpr, theme, LANDMARKS);
    const t1 = performance.now();
    // Previews (move/resize in progress) change committed objects' appearance: draw directly.
    let runs: Map<ProjectedObject, number> | undefined;
    const tiled =
      editor.preview.kind === "none"
        ? tiles.draw(
            ctx,
            cam,
            vp,
            dpr,
            (infl) => visibleObjects(doc, index, null, cam, infl),
            (c, list, all, infl) => drawObjects(c, list, assets, infl, dpr, theme, (runs ??= batchRuns(all))),
            (po) => (po.obj.kind === "stroke" ? strokeLineWidth(po) / 2 + 2 : 2),
          )
        : null;
    let visible: ReturnType<typeof visibleObjects> | null = null;
    let t2 = performance.now();
    if (!tiled) {
      visible = visibleObjects(doc, index, editor, cam, vp);
      t2 = performance.now();
      drawObjects(ctx, visible, assets, vp, dpr, theme);
    }
    // Selection outlines need the visible selected objects; query only when something is selected.
    const selected = editor.selection.size ? (visible ?? visibleObjects(doc, index, editor, cam, vp)).filter((po) => editor.selection.has(po.obj.id)) : [];
    drawOverlays(ctx, selected, editor, cam, vp, theme);
    const t3 = performance.now();
    const b: FrameBreakdown = {
      totalMs: t3 - t0,
      baseMs: t1 - t0,
      visibleMs: tiled ? 0 : t2 - t1,
      drawMs: tiled ? t3 - t1 : t3 - t2,
      visibleCount: tiled ? tiled.visible : visible!.length,
      tiles: tiled,
    };
    stats.last = b;
    return b;
  };

  let appView: AppView = "canvas";
  const draw = (): void => {
    scheduled = false;
    // Assets view covers the canvas: rendering is suspended (frame waiters still resolve).
    if (appView === "canvas") stats.record(renderNow().totalMs);
    const waiters = frameWaiters;
    frameWaiters = [];
    for (const w of waiters) w();
  };

  const session = new Session(db ? new WorkspaceRepo(db) : null, doc, view, editor, assets);
  if (db) {
    try {
      await session.start();
      if (session.startup?.kind === "migrated") {
        const m = session.startup.migration;
        editor.message = m.verified
          ? `Upgraded your canvas to the new storage format (${m.copied} objects, verified). The old data was kept.`
          : `Upgrade could not be verified (${m.verifyError ?? "unknown"}). The old data was kept unchanged.`;
      }
    } catch (e) {
      editor.message = `Could not open the workspace: ${(e as Error).message}`;
    }
  } else {
    editor.message = `Storage unavailable (${storageError}); work will not be saved.`;
  }
  const persistence = session.persistence;

  const resize = (): void => {
    const r = host.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    view.setViewport({ width: r.width, height: r.height });
    invalidate();
  };
  new ResizeObserver(resize).observe(host);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    theme = readTheme(document.documentElement);
    tiles.clear();
    invalidate();
  });

  view.subscribe(invalidate);
  doc.subscribe(invalidate);
  editor.subscribe(() => {
    canvas.dataset["tool"] = editor.tool;
    invalidate();
  });
  canvas.dataset["tool"] = editor.tool;

  const importFiles = (files: File[]): void => void importImages(files, assets, doc, view, editor);
  attachNavigation(canvas, view);
  attachTools(canvas, view, doc, index, editor);
  mountToolbar(document.getElementById("toolbar")!, editor, doc, {
    importFiles,
    undo: () => undo(doc, editor),
    redo: () => redo(doc, editor),
    deleteSelection: () => deleteSelection(doc, editor),
  });
  mountHud(document.getElementById("hud")!, view, stats, debug, {
    saveText: () => SAVE_TEXT[persistence.state] + (persistence.state === "error" && persistence.lastError ? ` (${persistence.lastError})` : ""),
    saveState: () => persistence.state,
    subscribe: (fn) => void persistence.subscribe(fn),
    notify: (message) => {
      editor.message = message;
      editor.changed();
    },
  });
  if (debug) mountDevPanel(document.getElementById("hud")!, view);
  mountNavigator(document.getElementById("workspace")!, session);

  // Top-level views. The canvas keeps its camera, selection and history while hidden.
  const assetsRoot = document.getElementById("assets-view")!;
  const setView = (v: AppView): void => {
    if (v === appView) return;
    appView = v;
    document.body.dataset["view"] = v;
    markTab(v);
    host.inert = v !== "canvas";
    if (v === "assets") assetsView.show();
    else {
      assetsView.hide();
      invalidate();
      canvas.focus();
    }
    try {
      localStorage.setItem("canvast.view", v);
    } catch {
      // per-device convenience only
    }
  };
  const markTab = mountViewSwitch(document.getElementById("view-switch")!, setView);
  markTab("canvas");
  const assetsView = mountAssetsView(assetsRoot, session, assets, () => setView("canvas"));
  mountStoragePanel(document.getElementById("hud")!, session, document.querySelector<HTMLElement>('[data-testid="save-status"]')!);

  // Drag-and-drop and paste import.
  window.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  });
  // In Assets view, files go into the library only; in Canvas view they are also placed.
  const receive = (all: File[]): void => {
    // Archives are imported (after confirmation); everything else is a media import.
    for (const f of all.filter(isArchiveFile)) void runImport(session, f);
    const files = all.filter((f) => !isArchiveFile(f));
    if (!files.length) return;
    if (appView === "assets") void assetsView.importFiles(files);
    else importFiles(files);
  };
  window.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    receive(files);
  });
  window.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      receive(files);
    }
  });
  // Best-effort flush when the page is hidden; saves are already debounced to 150 ms.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void persistence.flush();
      void persistence.saveCamera();
    }
  });

  if (debug) {
    installDebugHook(
      view,
      stats,
      canvas,
      () => {
        invalidate();
        return new Promise((resolve) => frameWaiters.push(resolve));
      },
      { doc, editor, session, renderNow, index, appView: () => appView, setView, tiles },
    );
  }
  document.documentElement.dataset["version"] = __CANVAST_VERSION__;
  resize();
  canvas.focus();
  editor.changed();
  let lastView: string | null = null;
  try {
    lastView = localStorage.getItem("canvast.view");
  } catch {
    // unavailable: start in Canvas view
  }
  if (lastView === "assets") setView("assets");
}

void start();
