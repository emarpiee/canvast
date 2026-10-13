import { ViewState } from "./view-state";
import { FrameStats } from "./frame-stats";
import { mountHud } from "./hud";
import { installDebugHook } from "./debug-hook";
import { EditorState } from "./editor-state";
import { deleteSelection, importImages, redo, undo } from "./actions";
import { attachNavigation } from "../interaction/navigation";
import { attachTools } from "../interaction/tools";
import { renderFrame } from "../render/canvas2d-renderer";
import type { Theme } from "../render/canvas2d-renderer";
import { drawScene } from "../render/scene-renderer";
import type { SceneTheme } from "../render/scene-renderer";
import { visibleObjects } from "../render/scene-view";
import { LANDMARKS } from "../scene/landmarks";
import { DocumentStore } from "../doc/document-store";
import { AssetLibrary } from "../assets/asset-library";
import { openDb } from "../storage/idb";
import { SnapshotWriter, loadSnapshot } from "../storage/snapshot";
import type { SaveStatus } from "../storage/snapshot";
import { mountToolbar } from "../ui/toolbar";
import { mountDevPanel } from "../ui/dev-panel";

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

const SAVE_TEXT: Record<SaveStatus, string> = {
  saved: "Saved",
  pending: "Unsaved changes…",
  saving: "Saving…",
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
  const editor = new EditorState();
  let theme = readTheme(document.documentElement);
  let dpr = window.devicePixelRatio || 1;
  let scheduled = false;
  let frameWaiters: Array<() => void> = [];

  let db: IDBDatabase | null = null;
  let storageError = "";
  try {
    db = await openDb();
  } catch (e) {
    storageError = (e as Error).message;
  }

  const invalidate = (): void => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(draw);
  };
  const assets = new AssetLibrary(db, invalidate);

  const draw = (): void => {
    scheduled = false;
    const t0 = performance.now();
    const cam = view.camera;
    const vp = view.viewport;
    renderFrame(ctx, cam, vp, dpr, theme, LANDMARKS);
    drawScene(ctx, visibleObjects(doc, editor, cam, vp), editor, assets, cam, vp, dpr, theme);
    stats.record(performance.now() - t0);
    const waiters = frameWaiters;
    frameWaiters = [];
    for (const w of waiters) w();
  };

  if (db) {
    try {
      const loaded = await loadSnapshot(db);
      doc.load(loaded.objects);
      if (loaded.camera) view.setCamera(loaded.camera);
      if (loaded.skipped.length) {
        editor.message = `Skipped ${loaded.skipped.length} damaged item(s) while loading.`;
        console.warn("canvast: skipped while loading", loaded.skipped);
      }
    } catch (e) {
      editor.message = `Could not load the saved canvas: ${(e as Error).message}`;
    }
  } else {
    editor.message = `Storage unavailable (${storageError}); work will not be saved.`;
  }
  const writer = new SnapshotWriter(db, doc, view);

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
  attachTools(canvas, view, doc, editor);
  mountToolbar(document.getElementById("toolbar")!, editor, doc, {
    importFiles,
    undo: () => undo(doc, editor),
    redo: () => redo(doc, editor),
    deleteSelection: () => deleteSelection(doc, editor),
  });
  mountHud(document.getElementById("hud")!, view, stats, debug, {
    saveText: () => SAVE_TEXT[writer.status] + (writer.status === "error" && writer.lastError ? ` (${writer.lastError})` : ""),
    saveState: () => writer.status,
    subscribe: (fn) => void writer.subscribe(fn),
    notify: (message) => {
      editor.message = message;
      editor.changed();
    },
  });
  if (debug) mountDevPanel(document.getElementById("hud")!, view);

  // Drag-and-drop and paste import.
  window.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    importFiles(files);
  });
  window.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      importFiles(files);
    }
  });
  // Best-effort flush when the page is hidden; saves are already debounced to 250 ms.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void writer.flush();
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
      { doc, editor, writer },
    );
  }
  document.documentElement.dataset["version"] = __CANVAST_VERSION__;
  resize();
  canvas.focus();
  editor.changed();
}

void start();
