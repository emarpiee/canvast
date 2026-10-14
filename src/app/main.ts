import { ViewState } from "./view-state";
import { FrameStats } from "./frame-stats";
import type { FrameBreakdown } from "./frame-stats";
import { mountHud } from "./hud";
import { installDebugHook } from "./debug-hook";
import { EditorState } from "./editor-state";
import { arrangeSelection, copySelection, cutSelection, duplicateSelection, pasteObjects, layoutSelection, clearFlag, deleteSelection, groupSelection, importImages, moveAbove, pruneSelection, redo, setFlag, setFlagOn, setOpacityOn, ungroupSelection, undo } from "./actions";
import { attachNavigation } from "../interaction/navigation";
import { attachTools } from "../interaction/tools";
import { renderFrame } from "../render/canvas2d-renderer";
import type { Theme } from "../render/canvas2d-renderer";
import { batchRuns, drawObjects, drawOverlays } from "../render/scene-renderer";
import { strokeLineWidth } from "../render/draw-objects";
import type { ProjectedObject } from "../render/projection";
import { coverObject, projectObject } from "../render/projection";
import { TileCache } from "../render/tile-cache";
import { DensityLayer } from "../render/density";
import type { SceneTheme } from "../render/scene-renderer";
import { visibleObjects } from "../render/scene-view";
import { LANDMARKS } from "../scene/landmarks";
import { DocumentStore } from "../doc/document-store";
import { syncIndex } from "../scene/spatial-index";
import { FrameIndex, cameraIn, isCoarse, worldBackdrop } from "../scene/frame-index";
import type { Frame } from "../core/frames";
import { depthOf, localCamera, normalize } from "../core/frames";
import { AssetLibrary } from "../assets/asset-library";
import { openDb } from "../storage/idb";
import { WorkspaceRepo } from "../storage/workspace-repo";
import type { SaveState } from "../storage/canvas-persistence";
import { Session } from "./session";
import { mountNavigator } from "../ui/navigator";
import { mountStoragePanel } from "../ui/storage-panel";
import { mountToolbar } from "../ui/toolbar";
import { mountLayersPanel } from "../ui/layers-panel";
import { mountBookmarksPanel } from "../ui/bookmarks-panel";
import { DENSE_MS, DPR_CAP, QualityGovernor } from "./quality";
import { BookmarkList, captureThumb } from "./bookmarks";
import { mountDevPanel } from "../ui/dev-panel";
import { mountAssetsView } from "../ui/assets-view";
import { mountViewSwitch } from "../ui/view-switch";
import type { AppView } from "../ui/view-switch";
import { isArchiveFile, runImport } from "../ui/archive-ui";
import { copyText, mountTextEditor } from "../ui/text-editor";
import { installTextFont } from "../text/inter";
import { SettingsStore } from "../settings/settings";

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

  const doc = new DocumentStore();
  const view = new ViewState(() => doc.space);
  const stats = new FrameStats();
  // The spatial index mirrors the document incrementally (changed ids only).
  const index = new FrameIndex(() => doc.space);
  const indexSync = syncIndex(doc, index, {
    onProgress: (done, total) => {
      editor.message = done < total ? `Indexing ${total.toLocaleString()} objects… ${Math.round((100 * done) / total)}%` : "";
      editor.changed();
      invalidate();
    },
  });
  // Committed objects are drawn through a raster tile cache (ADR 0009).
  const tiles = new TileCache(
    (id) => doc.get(id),
    () => invalidate(),
  );
  // Content too small to draw individually is shown as a density preview (ADR 0010).
  const density = new DensityLayer();
  doc.subscribe((_source, changed) => tiles.invalidate(changed));
  const editor = new EditorState();
  // Device settings (ADR 0017): pen and select options come back after a reload.
  const settings = new SettingsStore();
  editor.penColor = settings.get("pen.color");
  editor.penWidthPx = settings.get("pen.widthPx");
  editor.penKind = settings.get("pen.kind");
  editor.stabilizer = { on: settings.get("pen.stabilizer.on"), strength: settings.get("pen.stabilizer.strength") };
  editor.followZoom = settings.get("pen.followZoom");
  editor.ignoreFilling = settings.get("select.ignoreFilling");
  editor.lassoFilter = settings.get("lasso.filter");
  editor.snap = settings.get("snap.enabled");
  editor.alignBox = settings.get("select.alignBox");
  editor.layersOpen = settings.get("ui.layersOpen");
  editor.showFps = settings.get("ui.fps");
  editor.bookmarksOpen = settings.get("ui.bookmarksOpen");
  editor.eraserPx = settings.get("eraser.diameterPx");
  editor.eraseWholeGroups = settings.get("eraser.wholeGroups");
  editor.subscribe(() => {
    settings.set("pen.color", editor.penColor);
    settings.set("pen.widthPx", editor.penWidthPx);
    settings.set("pen.kind", editor.penKind);
    settings.set("pen.stabilizer.on", editor.stabilizer.on);
    settings.set("pen.stabilizer.strength", editor.stabilizer.strength);
    settings.set("pen.followZoom", editor.followZoom);
    settings.set("select.ignoreFilling", editor.ignoreFilling);
    settings.set("lasso.filter", editor.lassoFilter);
    settings.set("snap.enabled", editor.snap);
    settings.set("select.alignBox", editor.alignBox);
    settings.set("ui.layersOpen", editor.layersOpen);
    settings.set("ui.fps", editor.showFps);
    settings.set("ui.bookmarksOpen", editor.bookmarksOpen);
    settings.set("eraser.diameterPx", editor.eraserPx);
    settings.set("eraser.wholeGroups", editor.eraseWholeGroups);
  });
  let theme = readTheme(document.documentElement);
  let dpr = window.devicePixelRatio || 1;
  // Adaptive quality (ADR 0028): slow frames lower the canvas resolution and make zoom previews more eager.
  const quality = new QualityGovernor((level) => {
    tiles.denseMs = DENSE_MS[level];
    tiles.idleBuild = level === 0;
    resize();
  });
  // In debug mode (the tests) the level changes only when asked to, so a slow machine cannot change what a test measures.
  quality.pinned = !settings.get("quality.auto") || debug;
  const effectiveDpr = (): number => Math.min(window.devicePixelRatio || 1, DPR_CAP[quality.level]);
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
  // Before any document loads: text bounds come from the bundled font's metrics.
  installTextFont(() => {
    tiles.clear(); // text drawn before the font was ready used the interim fallback
    invalidate();
  });
  const assets = new AssetLibrary(db, () => {
    tiles.dropPending(); // an original finished loading: redraw tiles that showed its placeholder
    invalidate();
  });
  // Decoded images nothing has asked for lately are released when over budget, even if nothing is drawn (ADR 0027).
  setInterval(() => assets.evict(), 2000);

  let backdrop: ({ f: Frame } & ReturnType<typeof worldBackdrop>) | null = null;
  /** Render synchronously and return the timing breakdown. */
  const renderNow = (): FrameBreakdown => {
    const t0 = performance.now();
    const cam = view.camera;
    const fc = view.frameCamera;
    const vp = view.viewport;
    // Axes and landmarks are world-frame content, re-expressed in the camera frame (once per frame change).
    if (backdrop?.f !== fc.f) backdrop = { f: fc.f, ...worldBackdrop(fc.f, LANDMARKS) };
    renderFrame(ctx, cam, vp, dpr, theme, backdrop.landmarks, backdrop.origin);
    density.draw(ctx, index.views(fc), index.dots(fc), vp, doc.revision);
    const t1 = performance.now();
    // Previews (move/resize in progress) change committed objects' appearance: draw directly.
    let runs: Map<ProjectedObject, number> | undefined;
    const tiled =
      editor.preview.kind === "none"
        ? tiles.draw(
            ctx,
            cam,
            fc.f.id,
            vp,
            dpr,
            (infl) => visibleObjects(doc, index, null, fc, infl),
            (c, list, all, infl) => drawObjects(c, list, assets, infl, dpr, theme, (runs ??= batchRuns(all))),
            (po) => (po.obj.kind === "stroke" ? strokeLineWidth(po) / 2 + 2 : 2),
            (o, infl) => {
              // A changed coarse object may cover any tile: drop them all.
              if (isCoarse(fc, o.frame ?? doc.space.world)) return coverObject(o, infl, {});
              const oc = cameraIn(fc, o.frame ?? doc.space.world);
              return oc && projectObject(o, oc, infl, { keepTiny: true });
            },
            // Idle-time prebuild of the zoom levels around this one (ADR 0033), in the same frame.
            (dz) => {
              const fc2 = normalize(fc.f.space, { ...fc, z: fc.z + dz });
              if (fc2.f !== fc.f) return null;
              let lastAll: readonly ProjectedObject[] | null = null;
              let lastRuns: Map<ProjectedObject, number> | undefined;
              return {
                cam: localCamera(fc2),
                query: (infl) => visibleObjects(doc, index, null, fc2, infl),
                draw: (c, list, all, infl) => {
                  if (all !== lastAll) lastRuns = batchRuns((lastAll = all));
                  return drawObjects(c, list, assets, infl, dpr, theme, lastRuns);
                },
              };
            },
          )
        : null;
    let visible: ReturnType<typeof visibleObjects> | null = null;
    let t2 = performance.now();
    if (!tiled) {
      visible = visibleObjects(doc, index, editor, fc, vp);
      t2 = performance.now();
      drawObjects(ctx, visible, assets, vp, dpr, theme);
    }
    // Selection outlines need the visible selected objects; query only when something is selected.
    const selected = editor.selection.size ? (visible ?? visibleObjects(doc, index, editor, fc, vp)).filter((po) => editor.selection.has(po.obj.id)) : [];
    drawOverlays(ctx, selected, editor, fc, vp, theme);
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
    if (appView === "canvas") {
      const ms = renderNow().totalMs;
      stats.record(ms);
      quality.record(ms);
    }
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
    dpr = effectiveDpr();
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
  // Backend recovery (ADR 0023): if the browser takes the 2D drawing surface away (a GPU reset, memory pressure), keep the
  // document and the camera, drop every cached raster (tiles are canvases of their own and may be lost with it), and redraw.
  canvas.addEventListener("contextlost", (e) => {
    e.preventDefault(); // allows the browser to restore the context
    editor.message = "The browser reset the drawing surface; redrawing.";
    editor.changed();
  });
  canvas.addEventListener("contextrestored", () => {
    tiles.clear();
    editor.message = "";
    editor.changed();
    invalidate();
  });
  doc.subscribe(invalidate);
  editor.subscribe(() => {
    canvas.dataset["tool"] = editor.tool;
    invalidate();
  });
  canvas.dataset["tool"] = editor.tool;

  const importFiles = (files: File[]): void => void importImages(files, assets, doc, view, editor);
  attachNavigation(canvas, view);
  const textEditor = mountTextEditor(host, view, doc, editor, (q) => session.mentionableElsewhere(q, 6));
  attachTools(canvas, view, doc, index, editor, { editText: (t, at) => textEditor.open(t, at) });
  const side = document.createElement("div");
  side.id = "side-panels";
  host.appendChild(side);
  mountBookmarksPanel(side, editor, new BookmarkList(session, view, doc), () => captureThumb(canvas));
  mountLayersPanel(side, editor, doc, {
    setFlagOn: (ids, flag, on) => setFlagOn(doc, editor, ids, flag, on),
    moveAbove: (ids, above) => moveAbove(doc, editor, ids, above),
    setOpacity: (ids, opacity) => setOpacityOn(doc, editor, ids, opacity),
    backlinksElsewhere: (id) => session.backlinksElsewhere(id),
    locateMentions: (ids) => session.locateMentions(ids),
    reveal: (canvasId, ids) => void session.reveal(canvasId ?? session.current!.canvasId, ids),
  });
  mountToolbar(document.getElementById("toolbar")!, editor, doc, {
    importFiles,
    undo: () => undo(doc, editor),
    redo: () => redo(doc, editor),
    deleteSelection: () => deleteSelection(doc, editor),
    groupSelection: () => groupSelection(doc, editor),
    setFlag: (flag) => setFlag(doc, editor, flag),
    clearFlag: (flag) => clearFlag(doc, editor, flag),
    ungroupSelection: () => ungroupSelection(doc, editor),
    arrangeSelection: (to) => arrangeSelection(doc, editor, to),
    layoutSelection: async (cmd) => {
      // Sorting by name needs the file names of the selected images (the document only has their hashes).
      const names = new Map<string, { name: string; date: number }>();
      if ("grid" in cmd && (cmd.grid.startsWith("name") || cmd.grid === "date") && session.catalog) {
        for (const o of doc.ordered()) {
          if (o.kind !== "image" || !editor.selection.has(o.id) || names.has(o.assetId)) continue;
          const e = await session.catalog.entry(o.assetId).catch(() => undefined);
          names.set(o.assetId, { name: e?.name ?? "", date: e?.importedAt ?? 0 });
        }
      }
      layoutSelection(doc, editor, cmd, names);
    },
    depth: () => depthOf(view.frameCamera),
    setSelectedWidth: (px) => {
      // Width in the stroke's own units: screen px / (screen px per local unit). Strokes out of double range are skipped.
      const next = visibleObjects(doc, index, null, view.frameCamera, view.viewport).flatMap((po) => {
        const ppu = po.cover ? 0 : po.proj.ppu;
        return po.obj.kind === "stroke" && editor.selection.has(po.obj.id) && ppu > 0 && ppu < Infinity ? [{ ...po.obj, width: px / ppu }] : [];
      });
      if (next.length) doc.commit(doc.transaction(next.length === 1 ? "Stroke thickness" : `Thickness of ${next.length} strokes`, next));
    },
    copyMarkdown: () => {
      const md = doc.ordered().flatMap((o) => (o.kind === "text" && editor.selection.has(o.id) ? [o.md] : []));
      if (!md.length) return;
      void copyText(md.join("\n\n")).then(() => {
        editor.message = "Copied Markdown";
        editor.changed();
      });
    },
  });
  mountHud(document.getElementById("hud")!, view, stats, debug, {
    saveText: () => SAVE_TEXT[persistence.state] + (persistence.state === "error" && persistence.lastError ? ` (${persistence.lastError})` : ""),
    saveState: () => persistence.state,
    subscribe: (fn) => void persistence.subscribe(fn),
    fpsOn: () => editor.showFps,
    toggleFps: () => {
      editor.showFps = !editor.showFps;
      editor.changed();
    },
    quality: () => quality.level,
    diagnostics: () => {
      const mem = assets.stats();
      const q = assets.decodeLoad();
      const mib = (b: number): string => (b / 2 ** 20).toFixed(0);
      return [
        `objects ${doc.size.toLocaleString()} · drawn ${stats.last?.visibleCount.toLocaleString() ?? 0}${indexSync.building() ? " · indexing…" : ""}`,
        `decoded ${mem.count} images · ${mib(mem.bytes)} / ${mib(mem.budget)} MiB · decoding ${q.running} · waiting ${q.queued}`,
      ];
    },
    notify: (message) => {
      editor.message = message;
      editor.changed();
    },
  });
  if (debug) mountDevPanel(document.getElementById("hud")!, view, doc, () => pruneSelection(doc, editor));
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
    settings.set("ui.view", v);
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
  /** Whether a clipboard event belongs to a text field (or the text editor) rather than to the canvas. */
  const typing = (t: EventTarget | null): boolean => {
    const el = t as HTMLElement | null;
    return !!el && (el.isContentEditable || /^(TEXTAREA|SELECT)$/.test(el.tagName) || (el.tagName === "INPUT" && !/^(range|checkbox|radio|button|color)$/.test((el as HTMLInputElement).type)));
  };
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
    } else if (!typing(e.target) && appView === "canvas" && !textEditor.isOpen && pasteObjects(doc, editor, view, e.clipboardData?.getData("text/plain") ?? null)) e.preventDefault();
  });
  // Copy and cut take the selected objects (text fields and the text editor keep their own).
  for (const kind of ["copy", "cut"] as const) {
    document.addEventListener(kind, (e) => {
      if (typing(e.target) || appView !== "canvas" || textEditor.isOpen) return;
      if ((kind === "copy" ? copySelection : cutSelection)(doc, editor, view, e)) e.preventDefault();
    });
  }
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
      { doc, editor, session, renderNow, index, appView: () => appView, setView, tiles, density, quality, indexReady: () => indexSync.ready() },
    );
  }
  document.documentElement.dataset["version"] = __CANVAST_VERSION__;
  resize();
  canvas.focus();
  editor.changed();
  if (settings.get("ui.view") === "assets") setView("assets");
}

void start();
