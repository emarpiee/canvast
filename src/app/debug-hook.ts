import * as D from "../core/dyadic";
import {
  deserializeCamera,
  screenToWorld,
  serializeCamera,
  worldToScreen,
} from "../core/camera";
import type { ScreenPoint, SerializedCamera } from "../core/camera";
import { findLandmark } from "../scene/landmarks";
import type { ViewState } from "./view-state";
import type { FrameBreakdown, FrameStats } from "./frame-stats";
import type { BenchScene } from "./bench";
import type { SpatialIndex } from "../scene/spatial-index";
import { generateBenchScene } from "./bench";
import { panBy, zoomAt } from "../core/camera";
import type { DocumentStore } from "../doc/document-store";
import type { SerializedObject } from "../doc/model";
import { serializeObject } from "../doc/model";
import type { EditorState, Tool } from "./editor-state";
import type { Session } from "./session";
import { projectObject } from "../render/projection";
import { exactStrokeEdgeDistancePx } from "../render/stroke-coverage";
import type { ScreenBox } from "../render/projection";
import type { LassoFilter } from "../render/hit-test";
import type { AppView } from "../ui/view-switch";
import type { TileCache, TileFrame } from "../render/tile-cache";
import type { DensityLayer } from "../render/density";
import type { CatalogEntry, CatalogListing, GcReport } from "../assets/asset-catalog";
import { done } from "../storage/idb";

/**
 * Inspection API for automated navigation tests and manual diagnosis.
 * Installed only in debug builds or when the page URL hash contains "debug".
 * World coordinates cross this boundary as exact "<mantissa>p<exponent>"
 * strings so tests never see a rounded value.
 */
export interface DebugHook {
  camera(): SerializedCamera;
  setCamera(cam: SerializedCamera): void;
  viewport(): { width: number; height: number };
  worldToScreen(x: string, y: string): ScreenPoint;
  screenToWorld(x: number, y: number): { x: string; y: string };
  landmarkScreen(id: string): ScreenPoint & { sizePx: number };
  frameTimes(): number[];
  resetFrameTimes(): void;
  frameCount(): number;
  nextFrame(): Promise<void>;
  /** Count canvas pixels that differ from the background colour (sampled). */
  inkedPixels(step?: number): number;
  /** RGB of the canvas pixel at CSS px (x, y). */
  pixelAt(x: number, y: number): [number, number, number];
  objects(): SerializedObject[];
  selection(): string[];
  tool(): Tool;
  setTool(t: Tool): void;
  setLassoFilter(f: LassoFilter): void;
  /** Projected screen geometry of an object (null when offscreen). */
  objectScreen(id: string): { box: ScreenBox; q: number[]; radius: number } | null;
  canUndo(): boolean;
  canRedo(): boolean;
  flushSave(): Promise<string>;
  saveStatus(): string;
  /** Workspace/session state for storage tests. */
  session(): {
    current: { workspaceId: string; boardId: string; canvasId: string } | null;
    readOnly: boolean;
    lease: string;
    revision: number;
    lastCommit: { puts: number; deletes: number; revision: number } | null;
    startup: string | null;
    migration: unknown;
    tree: Array<{ id: string; name: string; canvases: Array<{ id: string; name: string; objectCount: number; revision: number }> }> | null;
  };
  /** Ids of the objects stored (in IndexedDB) for a canvas. */
  storedObjectIds(canvasId: string): Promise<string[]>;
  /** Signed px distance from a screen point to a stroke's outline (negative inside), computed exactly. */
  strokeEdgeDistance(id: string, x: number, y: number): number;
  /** Replace the document with a generated benchmark scene (no history, no save). */
  benchLoad(scene: BenchScene): { objects: number; generateMs: number; loadMs: number; heapMB: number | null };
  /**
   * Render `frames` frames synchronously while panning and zooming along a
   * fixed trajectory (pan 37 px/frame in a square, zoom ±0.05 level
   * oscillation), returning timing percentiles.
   */
  benchRun(frames: number, mode?: BenchMode): BenchRunResult;
  /** Turn the density preview on or off; and the squares it drew in the last recomputed frame. */
  setDensity(on: boolean): void;
  densityCells(): number;
  /** Turn the raster tile cache on or off (to compare against direct rendering). */
  setTileCache(on: boolean): void;
  /** Tile use of the last rendered frame (null: rendered directly), and tiles held. */
  tileStats(): { last: TileFrame | null; held: number; renderedTotal: number };
  heapMB(): number | null;
  /** Spatial index size and the result of a query for the current view. */
  indexStats(): { objects: number; levels: number; levelsVisited: number; levelsSkippedSubPixel: number; cellsProbed: number; candidates: number; queryMs: number };
  /** Set an object's opacity through a normal transaction (no UI for this yet). */
  setOpacity(id: string, opacity: number): void;
  /** The visible top-level view. */
  appView(): AppView;
  setView(v: AppView): void;
  /** The asset library as Assets view lists it (after flushing saves). */
  assetListing(): Promise<CatalogListing>;
  /** Every catalog entry, including ones deleted and awaiting collection. */
  catalogEntries(): Promise<CatalogEntry[]>;
  /** Hashes whose original bytes are stored. */
  storedAssetHashes(): Promise<string[]>;
  /** Run asset garbage collection now (writer only). */
  gc(): Promise<GcReport | null>;
  /** Hashes the open document and its undo/redo history can still use. */
  gcRoots(): string[];
  /**
   * Fault injection for tests: set a catalog entry's state directly, skipping
   * the in-use check that the UI applies. Used to prove that collection
   * itself never erases a referenced original.
   */
  forceCatalogState(hash: string, state: "active" | "deleted"): Promise<void>;
  /** Stored objects (serialized, sorted by id) and saved view of a canvas. */
  canvasDump(canvasId: string): Promise<{ objects: SerializedObject[]; view: SerializedCamera | null }>;
  /** Fault injection for tests: remove an original's bytes (a lost or damaged store). */
  removeAssetBytes(hash: string): Promise<void>;
}

export interface DebugDeps {
  doc: DocumentStore;
  editor: EditorState;
  session: Session;
  renderNow: () => FrameBreakdown;
  index: SpatialIndex;
  appView: () => AppView;
  setView: (v: AppView) => void;
  tiles: TileCache;
  density: DensityLayer;
}

/**
 * Bench trajectories. "panzoom": pan 37 px and zoom ±0.05 every frame (the
 * Phase 0C trajectory: the zoom changes each frame, so no tiles are used).
 * "pan": pan 37 px per frame in a square, fixed zoom. "static": the camera
 * stays put and only an overlay changes (like drawing a stroke). "zoom":
 * zoom ±0.05 about the centre every frame, no pan (stays on the content).
 * "zoomin": zoom +0.05 per frame about the centre (a steady gesture: 1 level per 20 frames).
 */
export type BenchMode = "panzoom" | "pan" | "static" | "zoom" | "zoomin";

export interface BenchRunResult {
  frames: number;
  /** Render calls plus a forced 1-px readback, so deferred rasterization is included. */
  frameMs: Percentiles;
  /** Render calls only (CPU recording time). */
  totalMs: Percentiles;
  visibleMs: Percentiles;
  drawMs: Percentiles;
  visibleCount: { min: number; max: number };
}

export interface Percentiles {
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function installDebugHook(
  view: ViewState,
  stats: FrameStats,
  canvas: HTMLCanvasElement,
  nextFrame: () => Promise<void>,
  deps: DebugDeps,
): void {
  const { doc, editor, session, renderNow } = deps;
  const writer = session.persistence;
  const heapMB = (): number | null => {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return m ? Math.round((m.usedJSHeapSize / 2 ** 20) * 10) / 10 : null;
  };
  const pct = (xs: number[]): Percentiles => {
    const s = [...xs].sort((a, b) => a - b);
    const at = (p: number): number => s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? 0;
    return { p50: at(50), p95: at(95), p99: at(99), max: s[s.length - 1] ?? 0 };
  };
  const hook: DebugHook = {
    camera: () => serializeCamera(view.camera),
    setCamera: (c) => view.setCamera(deserializeCamera(c)),
    viewport: () => ({ ...view.viewport }),
    worldToScreen: (x, y) => worldToScreen(view.camera, view.viewport, { x: D.parse(x), y: D.parse(y) }),
    screenToWorld: (x, y) => {
      const p = screenToWorld(view.camera, view.viewport, { x, y });
      return { x: D.toString(p.x), y: D.toString(p.y) };
    },
    landmarkScreen: (id) => {
      const lm = findLandmark(id);
      if (!lm) throw new Error(`unknown landmark ${id}`);
      const s = worldToScreen(view.camera, view.viewport, lm.center);
      return { ...s, sizePx: 2 ** (lm.sizeExp + view.camera.zi + view.camera.zf) };
    },
    frameTimes: () => stats.snapshot(),
    resetFrameTimes: () => stats.reset(),
    frameCount: () => stats.count,
    nextFrame,
    inkedPixels: (step = 1) => {
      const ctx = canvas.getContext("2d")!;
      const { width, height } = canvas;
      const data = ctx.getImageData(0, 0, width, height).data;
      // The background is the most common sampled colour.
      const counts = new Map<number, number>();
      const samples: number[] = [];
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const i = (y * width + x) * 4;
          const rgb = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
          samples.push(rgb);
          counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
        }
      }
      let bg = 0;
      let best = -1;
      for (const [rgb, c] of counts) if (c > best) [bg, best] = [rgb, c];
      const channelDiff = (a: number, b: number): number =>
        Math.abs((a >> 16) - (b >> 16)) + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) + Math.abs((a & 255) - (b & 255));
      let n = 0;
      for (const rgb of samples) if (channelDiff(rgb, bg) > 6) n++;
      return n;
    },
    pixelAt: (x, y) => {
      const dpr = canvas.width / view.viewport.width;
      const d = canvas.getContext("2d")!.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!];
    },
    objects: () => doc.ordered().map(serializeObject),
    selection: () => [...editor.selection].sort(),
    tool: () => editor.tool,
    setTool: (t) => editor.setTool(t),
    setLassoFilter: (f) => {
      editor.lassoFilter = f;
      editor.changed();
    },
    objectScreen: (id) => {
      const o = doc.get(id);
      if (!o) throw new Error(`no object ${id}`);
      const po = projectObject(o, view.camera, view.viewport, { keepTiny: true });
      return po ? { box: { ...po.box }, q: [...po.q], radius: po.radius } : null;
    },
    canUndo: () => doc.canUndo,
    canRedo: () => doc.canRedo,
    flushSave: async () => {
      await writer.flush();
      await writer.saveCamera();
      return writer.state === "verified" || writer.state === "committed" ? "saved" : writer.state;
    },
    saveStatus: () => writer.state,
    session: () => ({
      current: session.current,
      readOnly: session.readOnly,
      lease: session.lease.mechanism,
      revision: writer.revision,
      lastCommit: writer.lastCommit ? { puts: writer.lastCommit.puts, deletes: writer.lastCommit.deletes, revision: writer.lastCommit.revision } : null,
      startup: session.startup?.kind ?? null,
      migration: session.startup?.kind === "migrated" ? session.startup.migration : null,
      tree: session.tree
        ? session.tree.boards.map((b) => ({ id: b.board.id, name: b.board.name, canvases: b.canvases.map((c) => ({ id: c.id, name: c.name, objectCount: c.objectCount, revision: c.revision })) }))
        : null,
    }),
    storedObjectIds: async (canvasId) => {
      // Raw object records under this canvas id (works for a deleted canvas too).
      const range = IDBKeyRange.bound([canvasId, ""], [canvasId, "\uffff"]);
      const keys = await new Promise<IDBValidKey[]>((res, rej) => {
        const r = session.repo!.db.transaction("objects", "readonly").objectStore("objects").getAllKeys(range);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return (keys as Array<[string, string]>).map((k) => k[1]).sort();
    },
    strokeEdgeDistance: (id, x, y) => {
      const o = doc.get(id);
      if (!o || o.kind !== "stroke") throw new Error(`no stroke ${id}`);
      const po = projectObject(o, view.camera, view.viewport, { keepTiny: true });
      return po ? exactStrokeEdgeDistancePx(po, x, y) : Infinity;
    },
    benchLoad: (scene) => {
      const t0 = performance.now();
      const { objects, camera } = generateBenchScene(scene);
      const t1 = performance.now();
      doc.load(objects);
      view.setCamera(camera);
      const t2 = performance.now();
      return { objects: objects.length, generateMs: t1 - t0, loadMs: t2 - t1, heapMB: heapMB() };
    },
    setDensity: (on) => {
      deps.density.enabled = on;
    },
    densityCells: () => deps.density.lastCells,
    setTileCache: (on) => {
      deps.tiles.enabled = on;
      deps.tiles.clear();
    },
    tileStats: () => ({ last: stats.last?.tiles ?? null, held: deps.tiles.tileCount, renderedTotal: deps.tiles.renderedTotal }),
    benchRun: (frames, mode = "panzoom") => {
      const total: number[] = [];
      const frame: number[] = [];
      const ctx2d = canvas.getContext("2d")!;
      const vis: number[] = [];
      const drw: number[] = [];
      let minC = Infinity;
      let maxC = 0;
      const legs: Array<[number, number]> = [[37, 0], [0, 37], [-37, 0], [0, -37]];
      for (let i = 0; i < frames; i++) {
        const vp = view.viewport;
        const [dx, dy] = legs[Math.floor(i / 10) % 4]!;
        if (mode === "zoom" || mode === "zoomin") {
          view.setCamera(zoomAt(view.camera, vp, { x: vp.width / 2, y: vp.height / 2 }, mode === "zoomin" || i % 20 < 10 ? 0.05 : -0.05));
        } else if (mode !== "static") {
          let cam = panBy(view.camera, dx, dy);
          if (mode === "panzoom") cam = zoomAt(cam, vp, { x: vp.width / 2, y: vp.height / 2 }, i % 20 < 10 ? 0.05 : -0.05);
          view.setCamera(cam);
        }
        const t0 = performance.now();
        const b = renderNow();
        ctx2d.getImageData(0, 0, 1, 1); // flush: include rasterization
        frame.push(performance.now() - t0);
        total.push(b.totalMs);
        vis.push(b.visibleMs);
        drw.push(b.drawMs);
        minC = Math.min(minC, b.visibleCount);
        maxC = Math.max(maxC, b.visibleCount);
      }
      return { frames, frameMs: pct(frame), totalMs: pct(total), visibleMs: pct(vis), drawMs: pct(drw), visibleCount: { min: minC, max: maxC } };
    },
    heapMB,
    indexStats: () => {
      const t0 = performance.now();
      const q = deps.index.query(view.camera, view.viewport);
      const queryMs = performance.now() - t0;
      return {
        objects: deps.index.size,
        levels: deps.index.levelCount,
        levelsVisited: q.levelsVisited,
        levelsSkippedSubPixel: q.levelsSkippedSubPixel,
        cellsProbed: q.cellsProbed,
        candidates: q.candidates,
        queryMs,
      };
    },
    setOpacity: (id, opacity) => {
      const o = doc.get(id);
      if (!o) throw new Error(`no object ${id}`);
      doc.commit(doc.transaction("Set opacity", [{ ...o, opacity }]));
    },
    appView: deps.appView,
    setView: deps.setView,
    assetListing: async () => {
      await writer.flush();
      return session.catalog!.list();
    },
    catalogEntries: () => readAll<CatalogEntry>("assetCatalog"),
    storedAssetHashes: async () => {
      const tx = session.repo!.db.transaction("assets", "readonly");
      const keys = await new Promise<IDBValidKey[]>((res, rej) => {
        const r = tx.objectStore("assets").getAllKeys();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return (keys as string[]).sort();
    },
    gc: () => session.collectGarbage(),
    gcRoots: () => [...session.gcRoots()].sort(),
    forceCatalogState: async (hash, state) => {
      const tx = session.repo!.db.transaction("assetCatalog", "readwrite");
      const store = tx.objectStore("assetCatalog");
      const r = store.get(hash);
      r.onsuccess = () => {
        if (r.result) store.put({ ...r.result, state, deletedAt: state === "deleted" ? Date.now() : null });
      };
      await done(tx);
    },
    canvasDump: async (canvasId) => {
      await writer.flush();
      await writer.saveCamera();
      const loaded = await session.repo!.loadCanvas(canvasId);
      return { objects: loaded.objects.map(serializeObject).sort((a, b) => (a.id < b.id ? -1 : 1)), view: loaded.camera };
    },
    removeAssetBytes: async (hash) => {
      const tx = session.repo!.db.transaction("assets", "readwrite");
      tx.objectStore("assets").delete(hash);
      await done(tx);
    },
  };
  function readAll<T>(store: string): Promise<T[]> {
    return new Promise((res, rej) => {
      const r = session.repo!.db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => res(r.result as T[]);
      r.onerror = () => rej(r.error);
    });
  }
  (window as unknown as { __canvastDebug: DebugHook }).__canvastDebug = hook;
}
