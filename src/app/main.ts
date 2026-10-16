import { ViewState } from "./view-state";
import { isCard } from "../assets/file-kind";
import { downloadOriginal, fileActionsOf, openOriginalInTab } from "../ui/file-actions";
import { FrameStats } from "./frame-stats";
import type { FrameBreakdown } from "./frame-stats";
import { mountHud } from "./hud";
import { installDebugHook } from "./debug-hook";
import { EditorState } from "./editor-state";
import type { LayoutCommand } from "./actions";
import { arrangeSelection, copySelection, cutSelection, duplicateSelection, pasteObjects, layoutSelection, clearFlag, deleteSelection, groupSelection, importImages, moveAbove, setStackOrder, tagObjects, resetRotation, resetProportions, resettable, extractFrame, pruneSelection, redo, setFlag, setMedia, setFlagOn, setOpacityOn, setBlendOn, renameLayer, relinkMentionOn, ungroupSelection, undo } from "./actions";
import { attachNavigation } from "../interaction/navigation";
import { attachTools } from "../interaction/tools";
import { createFocusCycle, focusObjects, stepToNeighbour } from "../interaction/item-navigation";
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
import { mountMediaPlayer } from "../ui/media-player";
import { mountBookmarksPanel } from "../ui/bookmarks-panel";
import { DENSE_MS, DPR_CAP, QualityGovernor } from "./quality";
import { BookmarkList, captureThumb } from "./bookmarks";
import { mountDevPanel } from "../ui/dev-panel";
import { mountAssetsView } from "../ui/assets-view";
import { mountSettingsView } from "../ui/settings-view";
import { mountContextBar } from "../ui/context-bar";
import { installMenuKeys } from "../ui/more-menu";
import { confirmDialog } from "../ui/confirm";
import { mountTagsPanel } from "../ui/tags-panel";
import { mountCanvasSearch } from "../ui/canvas-search";
import { mountNotices } from "../ui/notices";
import { TOOL_KEY_SETTING, TOOL_NAME, TOOL_ORDER, navForKey, releaseStepKeys, toolForKey, toolKeys } from "../settings/shortcuts";
import { mountViewSwitch } from "../ui/view-switch";
import type { AppView } from "../ui/view-switch";
import { isArchiveFile, runImport } from "../ui/archive-ui";
import { copyText, mountTextEditor } from "../ui/text-editor";
import { installTextFont } from "../text/inter";
import { SettingsStore } from "../settings/settings";
import { setThemeInk } from "../render/ink";

declare const __CANVAST_VERSION__: string;

function readTheme(el: HTMLElement): Theme & SceneTheme & { ink: string } {
  // A token may hold var() and calc() (the hue and colourfulness dials); a probe element resolves it to the plain colour the canvas can draw with.
  const probe = document.createElement("span");
  probe.style.display = "none";
  el.appendChild(probe);
  const v = (name: string): string => {
    probe.style.color = "";
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };
  const theme = {
    background: v("--canvas-bg"),
    grid: v("--canvas-grid"),
    axis: v("--canvas-axis"),
    landmark: v("--canvas-landmark"),
    landmarkLabel: v("--canvas-landmark-label"),
    selection: v("--canvas-selection"),
    handleFill: v("--canvas-handle-fill"),
    lasso: v("--canvas-lasso"),
    imagePlaceholder: v("--canvas-image-placeholder"),
    ink: v("--canvas-ink"),
    danger: v("--canvas-danger"),
    dangerWash: v("--canvas-danger-wash"),
    guide: v("--canvas-guide"),
  };
  probe.remove();
  return theme;
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
      if (done >= total) editor.progressDone.add("index");
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
  // Objects with a blend mode (ADR 0047): tiles hold paint without its backdrop, so a view that shows one is drawn directly.
  const blended = new Set<string>();
  doc.subscribe((_source, changed) => {
    if (changed === null) {
      blended.clear();
      for (const o of doc.all()) if (o.blend) blended.add(o.id);
      return;
    }
    for (const id of changed) {
      if (doc.get(id)?.blend) blended.add(id);
      else blended.delete(id);
    }
  });
  const editor = new EditorState();
  const notices = mountNotices(document.body, editor);
  // Device settings (ADR 0017): pen and select options come back after a reload.
  const settings = new SettingsStore();
  releaseStepKeys(settings); // a tool key set to W A S D before they became the step keys goes back to its own letter (ADR 0072)
  // Developer tools (the panel, the diagnostics, the test hook): on for a session with #debug at the end of the address (the tests use
  // this), or always once switched on in Settings > Develop (applies after a reload). There is no separate debug build.
  const debug = location.hash.includes("debug") || settings.get("dev.tools");
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
  editor.bookmarksOpen = settings.get("ui.bookmarksOpen");
  editor.tagsOpen = settings.get("ui.tagsOpen");
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
    settings.set("ui.bookmarksOpen", editor.bookmarksOpen);
    settings.set("ui.tagsOpen", editor.tagsOpen);
    settings.set("eraser.diameterPx", editor.eraserPx);
    settings.set("eraser.wholeGroups", editor.eraseWholeGroups);
  });
  // Theme chosen in Settings (ui.theme): "system" leaves the attribute off so the operating system decides.
  const applyThemeAttribute = (): void => {
    const t = settings.get("ui.theme");
    if (t === "system") delete document.documentElement.dataset["theme"];
    else document.documentElement.dataset["theme"] = t;
  };
  // Interface size, contrast and motion (Settings > Appearance): attributes and a variable on the root, read by the stylesheet.
  // Zen mode (ui.zen): an attribute on the root, read by the stylesheet, and the pressed state of the button beside Home.
  const applyZen = (): void => {
    const on = settings.get("ui.zen");
    if (on) document.documentElement.dataset["zen"] = "on";
    else delete document.documentElement.dataset["zen"];
    document.querySelector('[data-action="zen"]')?.setAttribute("aria-pressed", String(on));
  };
  const applyAppearance = (): void => {
    const root = document.documentElement;
    root.style.setProperty("--ui-scale", String(Number(settings.get("ui.textScale")) / 100));
    root.style.setProperty("--hue", String(settings.get("ui.hue")));
    root.style.setProperty("--vivid", String(settings.get("ui.vivid") / 100));
    if (settings.get("ui.density") === "comfortable") root.dataset["density"] = "comfortable";
    else delete root.dataset["density"]; // compact is the default
    if (settings.get("ui.contrast") === "high") root.dataset["contrast"] = "high";
    else delete root.dataset["contrast"];
    const m = settings.get("ui.motion");
    if (m === "system") delete root.dataset["motion"];
    else root.dataset["motion"] = m;
  };
  applyAppearance();
  applyZen();
  applyThemeAttribute();
  let theme = readTheme(document.documentElement);
  setThemeInk(theme.ink);
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
    renderFrame(ctx, cam, vp, dpr, theme, backdrop.landmarks, backdrop.origin, settings.get("ui.pattern"));
    density.draw(ctx, index.views(fc), index.dots(fc), vp, doc.revision);
    const t1 = performance.now();
    // Previews (move/resize in progress) change committed objects' appearance: draw directly.
    let runs: Map<ProjectedObject, number> | undefined;
    let blendShown = false;
    for (const id of blended) {
      const o = doc.get(id);
      if (!o || o.hidden) continue;
      const oc = cameraIn(fc, o.frame ?? doc.space.world);
      if (isCoarse(fc, o.frame ?? doc.space.world) || (oc && projectObject(o, oc, vp, { keepTiny: true }))) {
        blendShown = true;
        break;
      }
    }
    const tiled =
      editor.preview.kind === "none" && !blendShown
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
  let contextUpdate: () => void = () => undefined;
  const draw = (): void => {
    scheduled = false;
    // Assets view covers the canvas: rendering is suspended (frame waiters still resolve).
    if (appView === "canvas") {
      const ms = renderNow().totalMs;
      stats.record(ms);
      quality.record(ms);
      contextUpdate();
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
    setThemeInk(theme.ink);
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
  const textEditor = mountTextEditor(host, view, doc, editor, (q) => session.mentionableElsewhere(q, 6), async (hash) => (await session.catalog?.entry(hash).catch(() => undefined))?.name ?? "");
  const bookmarkList = new BookmarkList(session, view, doc);
  installMenuKeys();
  const focusCycle = createFocusCycle(doc, view, editor, () => true);
  const canvasSearch = mountCanvasSearch(host, {
    doc,
    editor,
    bookmarks: bookmarkList,
    entry: async (hash) => {
      const e = await session.catalog?.entry(hash);
      return e ? { name: e.name, tags: e.tags ?? [] } : undefined;
    },
    focus: (ids) => focusObjects(doc, view, ids, settings.get("nav.arrive") === "focus"),
  });
  attachTools(canvas, view, doc, index, editor, { editText: (t, at) => textEditor.open(t, at), toolForKey: (k) => toolForKey(settings, k), navForKey: (k) => navForKey(settings, k),
    navigate: (dir) => void stepToNeighbour(doc, view, editor, dir, settings.get("nav.mode"), settings.get("nav.arrive") === "focus"),
    focusSelection: () => focusCycle.tap(),
    openSearch: (prefix) => canvasSearch.open(prefix),
  });
  const side = document.createElement("div");
  side.id = "side-panels";
  host.appendChild(side);
  mountBookmarksPanel(side, editor, bookmarkList, () => captureThumb(canvas));
  mountMediaPlayer(host, view, doc, editor, assets, settings, { setMedia: (id, patch, label) => setMedia(doc, editor, id, patch, label), extract: (id, png) => void extractFrame(doc, editor, assets, id, png), repaint: (id) => { tiles.invalidate(new Set([id])); invalidate(); } });
  mountLayersPanel(side, editor, doc, {
    setFlagOn: (ids, flag, on) => setFlagOn(doc, editor, ids, flag, on),
    moveAbove: (ids, above) => moveAbove(doc, editor, ids, above),
    setOrder: (order, label) => setStackOrder(doc, editor, order, label),
    setOpacity: (ids, opacity) => setOpacityOn(doc, editor, ids, opacity),
    setBlend: (ids, blend) => setBlendOn(doc, editor, ids, blend),
    rename: (key, name) => renameLayer(doc, editor, key, name),
    relink: (textId, oldId, newId, label) => relinkMentionOn(doc, editor, textId, oldId, newId, label),
    mentionable: (query) => session.mentionableElsewhere(query, 6),
    backlinksElsewhere: (id) => session.backlinksElsewhere(id),
    locateMentions: (ids) => session.locateMentions(ids),
    assetName: async (hash) => (await session.catalog?.entry(hash).catch(() => undefined))?.name ?? "",
    reveal: (canvasId, ids) => void session.reveal(canvasId ?? session.current!.canvasId, ids),
  });
  const tagsPanel = mountTagsPanel(side, editor, doc, {
    tag: (ids, change) => void tagObjects(doc, editor, ids, change),
    renameTag: (from, to) => void session.changeCanvasTag(from, to),
    deleteTag: (tag) =>
      void confirmDialog({
        title: `Delete the tag “${tag}” from every canvas?`,
        lines: ["The items stay. On this canvas Undo brings it back; on the other canvases it cannot be undone."],
        confirmLabel: "Delete tag",
      }).then((ok) => (ok ? session.changeCanvasTag(tag, null) : 0)),
  });
const runLayout = async (cmd: LayoutCommand): Promise<void> => {
    // Sorting by name needs the file names of the selected images (the document only has their hashes).
    const names = new Map<string, { name: string; date: number }>();
    if ("grid" in cmd && (cmd.grid.startsWith("name") || cmd.grid === "date") && session.catalog) {
      for (const o of doc.ordered()) {
        if (o.kind !== "image" || !editor.selection.has(o.id) || names.has(o.assetId)) continue;
        const e = await session.catalog.entry(o.assetId).catch(() => undefined);
        names.set(o.assetId, { name: e?.name ?? "", date: e?.importedAt ?? 0 });
      }
    }
    // The grid is laid out with the chosen space between items; the last grid is kept so a new spacing can lay it out again.
    const full: LayoutCommand = "grid" in cmd ? { grid: cmd.grid, gap: settings.get("arrange.gap") } : cmd;
    if ("grid" in full) lastGrid = { cmd: full, ids: [...editor.selection].sort().join() };
    layoutSelection(doc, editor, full, names);
  };
  let lastGrid: { cmd: Extract<LayoutCommand, { grid: unknown }>; ids: string } | null = null;
  mountToolbar(document.getElementById("toolbar")!, editor, doc, {
    importFiles,
    openSearch: (prefix) => canvasSearch.open(prefix),
    undo: () => undo(doc, editor),
    redo: () => redo(doc, editor),
    clearFlag: (flag) => clearFlag(doc, editor, flag),
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
    fit: (kind) => focusCycle.fit(kind),
    hasSelection: () => editor.selection.size > 0,
    toggleZen: () => void settings.set("ui.zen", !settings.get("ui.zen")),
    subscribeSelection: (fn) => void editor.subscribe(fn),
    saveText: () => SAVE_TEXT[persistence.state] + (persistence.state === "error" && persistence.lastError ? ` (${persistence.lastError})` : ""),
    saveState: () => persistence.state,
    subscribe: (fn) => void persistence.subscribe(fn),
    pattern: () => settings.get("ui.pattern"),
    setPattern: (p) => void settings.set("ui.pattern", p),
    subscribePattern: (fn) => void settings.subscribe((key) => key === "ui.pattern" && fn()),
    infoMode: () => settings.get("ui.info"),
    setInfoMode: (m) => void settings.set("ui.info", m),
    subscribeInfo: (fn) => void settings.subscribe((key) => key === "ui.info" && fn()),
    scene: () => ({ objects: doc.size, drawn: stats.last?.visibleCount ?? 0, indexing: indexSync.building() }),
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
  applyZen(); // the button beside Home exists now
  if (debug) mountDevPanel(document.getElementById("hud")!, view, doc, () => pruneSelection(doc, editor), (n) => notices.push(n));
  const markNav = mountNavigator(document.getElementById("workspace")!, session, () => setView("canvas"));

  const fileKinds = new Map<string, { card: boolean; open: boolean }>();
  // The selection action bar follows the selection box (updated after each drawn frame).
  const contextBar = mountContextBar(
    host,
    editor,
    doc,
    {
      duplicate: () => duplicateSelection(doc, editor, view),
      resetRotation: () => void resetRotation(doc, editor),
      resetProportions: () => void resetProportions(doc, editor),
      resettable: () => resettable(doc, editor),
      tag: () => {
        editor.tagsOpen = true;
        editor.changed();
        requestAnimationFrame(() => tagsPanel.focusAdd());
      },
      fileSelection: () => {
        const ids = [...editor.selection];
        const o = ids.length === 1 ? doc.get(ids[0]!) : undefined;
        if (o?.kind !== "image") return null;
        if (!fileKinds.has(o.assetId)) {
          fileKinds.set(o.assetId, { card: false, open: false });
          void session.catalog?.entry(o.assetId).then((e) => {
            if (!e) return;
            fileKinds.set(o.assetId, { card: isCard(e), open: fileActionsOf(e.name, e.type).canOpen });
            contextBar.update();
          });
        }
        const k = fileKinds.get(o.assetId)!;
        return k.card ? { hash: o.assetId, open: k.open } : null;
      },
      downloadFile: () => {
        const o = [...editor.selection].map((id) => doc.get(id)).find((x) => x?.kind === "image");
        if (o?.kind === "image") void downloadOriginal(assets, o.assetId);
      },
      openFile: () => {
        const o = [...editor.selection].map((id) => doc.get(id)).find((x) => x?.kind === "image");
        if (o?.kind === "image") void openOriginalInTab(assets, o.assetId);
      },
      hasLibraryItems: () => [...editor.selection].some((id) => doc.get(id)?.kind === "image"),
      showInLibrary: () => {
        const hashes = [...new Set([...editor.selection].map((id) => doc.get(id)).flatMap((o) => (o?.kind === "image" ? [o.assetId] : [])))];
        if (!hashes.length) return;
        setView("assets");
        void assetsView.reveal(hashes);
      },
      group: () => groupSelection(doc, editor),
      ungroup: () => ungroupSelection(doc, editor),
      arrange: (to) => arrangeSelection(doc, editor, to),
      layout: (cmd) => void runLayout(cmd),
      gap: () => settings.get("arrange.gap"),
      setGap: (gap) => {
        settings.set("arrange.gap", gap);
        // Choosing another space right after arranging the same items lays them out again with it (one more undo step).
        if (lastGrid && lastGrid.ids === [...editor.selection].sort().join()) void runLayout({ grid: lastGrid.cmd.grid });
      },
      setFlag: (flag) => setFlag(doc, editor, flag),
      deleteSelection: () => deleteSelection(doc, editor),
    },
    () => appView !== "canvas" || textEditor.isOpen,
  );
  contextUpdate = contextBar.update;

  // The tools start where the view tabs and the workspace menu end (stylesheet: --nav-w).
  const navBox = document.getElementById("nav")!;
  const barBox = document.getElementById("toolbar")!;
  const measureNav = (): void => {
    const root = document.documentElement.style;
    root.setProperty("--nav-w", `${Math.ceil(navBox.getBoundingClientRect().right)}px`);
    // The tool options sit between the view tabs and the dock (history, panels, import) at the top right.
    const dock = barBox.querySelector<HTMLElement>(".dock")?.getBoundingClientRect();
    root.setProperty("--dock-w", `${Math.ceil(dock ? dock.width : 0)}px`);
    // Side panels start below the toolbar, however many rows it wraps to.
    const opts = barBox.querySelector<HTMLElement>(".toolbar");
    const bottoms = [navBox.getBoundingClientRect().bottom, dock?.bottom ?? 0, opts && !opts.hidden ? opts.getBoundingClientRect().bottom : 0];
    root.setProperty("--bar-bottom", `${Math.ceil(Math.max(...bottoms))}px`);
  };
  new ResizeObserver(measureNav).observe(navBox);
  new ResizeObserver(measureNav).observe(barBox);
  window.addEventListener("resize", measureNav);
  measureNav();

  // Top-level views. The canvas keeps its camera, selection and history while hidden.
  const assetsRoot = document.getElementById("assets-view")!;
  const setView = (v: AppView): void => {
    if (v === appView) return;
    const was = appView;
    appView = v;
    document.body.dataset["view"] = v;
    markTab(v);
    markNav(v);
    host.inert = v !== "canvas";
    if (was === "assets") assetsView.hide();
    if (was === "settings") settingsView.hide();
    if (v === "assets") assetsView.show();
    else if (v === "settings") settingsView.show();
    else {
      invalidate();
      canvas.focus();
    }
    // The Settings view is not remembered: a reload opens the canvas or the Assets view.
    if (v !== "settings") settings.set("ui.view", v);
  };
  const markTab = mountViewSwitch(document.getElementById("view-switch")!, setView);
  markTab("canvas");
  markNav("canvas");
  const assetsView = mountAssetsView(assetsRoot, session, assets, () => setView("canvas"), notices, settings);
  // The Zen key (Settings > Shortcuts, Z at first) fades the floating bars and panels out and back, on the canvas.
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.key.toLowerCase() !== settings.get("key.zen")) return;
    if (document.body.dataset["view"] !== "canvas" || typing(e.target) || (e.target as HTMLElement | null)?.closest?.("dialog")) return;
    e.preventDefault();
    settings.set("ui.zen", !settings.get("ui.zen"));
  });
  // Ctrl+F searches what you are looking at (the canvas, or the library in the Assets view); Ctrl+Shift+F goes to the library's search
  // from anywhere. The browser's own find is not used for these.
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== "f") return;
    if (document.querySelector("dialog[open]") || appView === "settings") return;
    e.preventDefault();
    if (e.shiftKey || appView === "assets") {
      setView("assets");
      assetsView.focusSearch();
    } else canvasSearch.open("");
  });
  // Tool buttons say which key picks them (the keys can be changed in Settings).
  const updateToolTitles = (): void => {
    const keys = toolKeys(settings);
    for (const t of TOOL_ORDER) document.querySelector<HTMLElement>(`button[data-tool="${t}"]`)?.setAttribute("title", `${TOOL_NAME[t]} (${keys[t].toUpperCase()})`);
  };
  updateToolTitles();
  const settingsView = mountSettingsView(document.getElementById("settings-view")!, settings, () => setView("canvas"));
  // A setting changed in the Settings view reaches the tools and the drawing (the toolbars write to the store the other way).
  settings.subscribe((key) => {
    switch (key) {
      case "pen.color": editor.penColor = settings.get(key); break;
      case "pen.widthPx": editor.penWidthPx = settings.get(key); break;
      case "pen.kind": editor.penKind = settings.get(key); break;
      case "pen.stabilizer.on":
      case "pen.stabilizer.strength": editor.stabilizer = { on: settings.get("pen.stabilizer.on"), strength: settings.get("pen.stabilizer.strength") }; break;
      case "pen.followZoom": editor.followZoom = settings.get(key); break;
      case "select.ignoreFilling": editor.ignoreFilling = settings.get(key); break;
      case "lasso.filter": editor.lassoFilter = settings.get(key); break;
      case "snap.enabled": editor.snap = settings.get(key); break;
      case "select.alignBox": editor.alignBox = settings.get(key); break;
      case "eraser.diameterPx": editor.eraserPx = settings.get(key); break;
      case "eraser.wholeGroups": editor.eraseWholeGroups = settings.get(key); break;
      case "quality.auto": quality.pinned = !settings.get("quality.auto") || debug; break;
      case "ui.textScale":
      case "ui.density":
      case "ui.contrast":
      case "ui.motion":
        applyAppearance();
        return;
      case "ui.zen":
        applyZen();
        return;
      case "ui.pattern":
        invalidate();
        return;
      case "ui.hue":
      case "ui.vivid":
        // The canvas colours follow the dials too: read them again and redraw.
        applyAppearance();
        theme = readTheme(document.documentElement);
        setThemeInk(theme.ink);
        tiles.clear();
        invalidate();
        return;
      case "ui.theme":
        applyThemeAttribute();
        theme = readTheme(document.documentElement);
        setThemeInk(theme.ink);
        tiles.clear();
        invalidate();
        return;
      default:
        if (key.startsWith("key.")) updateToolTitles();
        return;
    }
    editor.changed();
  });
  mountStoragePanel(document.getElementById("hud")!, session, document.querySelector<HTMLElement>('[data-testid="save-status"]')!);

  // "?" opens the shortcut list (not while typing).
  window.addEventListener("keydown", (e) => {
    if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || (e.target as HTMLElement | null)?.closest?.("dialog")) return;
    e.preventDefault();
    if (appView !== "settings") setView("settings");
    settingsView.show("shortcuts");
  });

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
  // A drag that starts inside the app (a picture dragged out of the library, a layer row) is never a file import: the browser would hand
  // the dragged thumbnail over as a new file and store it as an asset of its own.
  let internalDrag = false;
  window.addEventListener("dragstart", () => (internalDrag = true));
  window.addEventListener("dragend", () => (internalDrag = false));
  window.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (internalDrag) {
      if (files.length) e.preventDefault();
      internalDrag = false;
      return;
    }
    if (!files.length) return;
    e.preventDefault();
    receive(files);
  });
  window.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
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
