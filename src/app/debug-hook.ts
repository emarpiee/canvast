import { externalFolder } from "../storage/external-folder";
import type { PaintView } from "../ui/paint-view";
import { beginProgress } from "./progress";
import type { Progress } from "./progress";
import type { Dir } from "../storage/external-folder";

let testProgressHandle: Progress | null = null;

/** A stand-in for the folder the picker gives (the native picker cannot be driven): files kept in a database of their own, so they outlive a reload. */
function testDb(name: string): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(`test-folder-${name}`, 1); // (not "canvast*": a reset deletes those, and a real folder is on the disk)
    r.onupgradeneeded = () => r.result.createObjectStore("f");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function testDirKeys(name: string): Promise<string[]> {
  const db = await testDb(name);
  return (await req(db.transaction("f").objectStore("f").getAllKeys())) as string[];
}
function testDir(name: string): Dir {
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => req(fn((await testDb(name)).transaction("f", mode).objectStore("f")));
  return {
    name,
    keys: () => ({
      async *[Symbol.asyncIterator]() {
        for (const k of await testDirKeys(name)) yield k;
      },
    }),
    getFileHandle: async (n, o) => {
      if (!(await run("readonly", (s) => s.count(n))) && !o?.create) throw new DOMException("none", "NotFoundError");
      return {
        getFile: async () => new File([(await run("readonly", (s) => s.get(n))) ?? new Blob([])], n),
        createWritable: async () => ({ write: async (b: Blob) => void (await run("readwrite", (s) => s.put(b, n))), close: async () => undefined }),
      };
    },
    removeEntry: async (n) => {
      if (!(await run("readonly", (s) => s.count(n)))) throw new DOMException("none", "NotFoundError");
      await run("readwrite", (s) => s.delete(n));
    },
  };
}
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
import type { FrameIndex } from "../scene/frame-index";
import type { CanvasObject } from "../doc/model";
import { worldForm } from "../doc/model";
import { cameraIn } from "../scene/frame-index";
import { classifyCoarse } from "../render/coarse";
import type { WorldPoint } from "../core/camera";
import { approxIn, depthOf, deserializeFrameCamera, expressExactIn, expressIn, levelsBetween, toAbsoluteCamera } from "../core/frames";
import { generateBenchScene } from "./bench";
import { panBy, zoomAt } from "../core/camera";
import type { DocumentStore } from "../doc/document-store";
import type { SerializedObject } from "../doc/model";
import { serializeObject, serializeWorld } from "../doc/model";
import type { EditorState, Tool } from "./editor-state";
import type { Session } from "./session";
import { projectObject } from "../render/projection";
import { exactStrokeEdgeDistancePx } from "../render/stroke-coverage";
import type { ScreenBox } from "../render/projection";
import type { LassoFilter } from "../render/hit-test";
import type { AppView } from "../ui/view-switch";
import type { TileCache, TileFrame } from "../render/tile-cache";
import type { DensityLayer } from "../render/density";
import type { CatalogEntry, CatalogListing, GcReport, ThumbRecord } from "../assets/asset-catalog";
import { done, req } from "../storage/idb";
import { lastCopiedText } from "../ui/text-editor";
import { glyphScale, layoutOf } from "../text/layout";
import { glyphFont } from "../text/fonts";
import type { PlacedGlyph, Line } from "../text/layout";
import type { TextObject } from "../doc/model";
import { localToWorld } from "../doc/edit-ops";
import type { QualityGovernor } from "./quality";
import { selectedFrame } from "../render/scene-renderer";
import { shapeHandles } from "../interaction/path-edit";
import { visibleObjects } from "../render/scene-view";

/**
 * Inspection API for automated navigation tests and manual diagnosis.
 * Installed only in debug builds or when the page URL hash contains "debug".
 * World coordinates cross this boundary as exact "<mantissa>p<exponent>"
 * strings so tests never see a rounded value.
 */
export interface DebugHook {
  camera(): SerializedCamera;
  /** Zoom by any number of levels (≤ 2^50) about the centre, in frames: cheap at any depth (ADR 0014). */
  jump(levels: number): void;
  /** Gliding between views, in ms (0: off; the test session starts with it off). */
  glide(ms: number): void;
  /** Write a setting by key, as the Settings view does. */
  setSetting(key: string, value: unknown): void;
  /** Absolute zoom level as a BigInt string (exact at any depth). */
  depth(): string;
  /** Each object's frame: level (BigInt string, K-steps below the world frame) and id; world-frame objects have level "0". */
  objectFrames(): Array<{ id: string; kind: string; level: string; frame: number | null }>;
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
  /** The Painting view (ADR 0165): the open painting's records, a layer's pixel (r, g, b, a) at page px, the screen point of a page px, and a wait for the strokes and saves. */
  paint: {
    state(): { paintingId: string; name: string; pageId: string; pages: Array<{ id: string; name: string; w: number; h: number; bg: string | null }>; activeId: string | null; layers: Array<{ id: string; name: string; pageId: string; z: number; tiles: number; hidden?: true; locked?: true; clipBelow?: true; alphaLock?: true; opacity: number; blend?: string }>; canUndo: boolean } | null;
    layerPixel(layerId: string, x: number, y: number): [number, number, number, number] | null;
    screenOf(x: number, y: number): { x: number; y: number } | null;
    settled(): Promise<void>;
    list(): Promise<Array<{ id: string; name: string }>>;
    open(id: string): Promise<void>;
  };
  objects(): SerializedObject[];
  /** Objects as stored (frame form: local numbers, frame id); works at any depth, unlike `objects()`. */
  storedObjects(): SerializedObject[];
  selection(): string[];
  tool(): Tool;
  setTool(t: Tool): void;
  setLassoFilter(f: LassoFilter): void;
  /** The names drawn above items at the last frame (sheets, pictures, named items). */
  itemLabels(): Array<{ id: string; text: string; x: number; y: number; w: number; h: number }>;
  /** Projected screen geometry of an object (null when offscreen). */
  objectScreen(id: string): { box: ScreenBox; q: number[]; radius: number } | null;
  /** Save the view and collect stored frames nothing refers to (normally done after many frames were written). */
  collectFrames(): Promise<void>;
  /** Number of stored frame records of the current canvas. */
  storedFrameCount(): Promise<number>;
  /** How a coarse object (far above the camera) is drawn: "cover", "miss", "exact", or "near" when it is not coarse. */
  coarseState(id: string): "cover" | "miss" | "exact" | "near";
  canUndo(): boolean;
  canRedo(): boolean;
  flushSave(): Promise<string>;
  /** The pictures of the bookmarks ("" where one has none), and taking them all away (to test filling them in). */
  bookmarkThumbs(): string[];
  dropBookmarkThumbs(): Promise<void>;
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
  /** When each step of the startup finished, in ms since the page began to load (`loaded`, `indexed`, `first-frame`; a step not reached yet is absent). */
  startupMarks(): Record<string, number>;
  /** Put a generated benchmark scene in the document and in storage (in chunks, as edits), then wait until it is saved: the stored canvas a restart loads. */
  benchStore(scene: BenchScene): Promise<{ objects: number; ms: number }>;
  /** Replace the document with a generated benchmark scene (no history, no save). */
  benchLoad(scene: BenchScene): Promise<{ objects: number; generateMs: number; loadMs: number; heapMB: number | null }>;
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
  tileStats(): { last: TileFrame | null; held: number; renderedTotal: number; ahead: number };
  /** Decoded images held (count, bytes, budget), and set the budget in bytes (ADR 0027). */
  decodedStats(): { count: number; bytes: number; budget: number; maxRunning: number };
  /** The box of the selection on screen: its rotation (radians) and corners (top-left first, in the box's own axes). */
  selectionFrame(): { angle: number; corners: Array<[number, number]> } | null;
  /** Where the main corner radius dot and each corner's own dot are on screen for the one picked shape (null: none). */
  cornerDots(): { main: [number, number]; corners: Array<[number, number]>; count: [number, number] | null; countCentre: [number, number] | null } | null;
  /** The resize handles of the selection box as last drawn. */
  drawnHandles(): Array<[number, number]>;
  /** The words beside a handle being dragged, or null. */
  handleLabel(): string | null;
  /** The nodes picked together in Edit nodes (ADR 0145): how many on each path. */
  pickedNodes(): Array<[string, number]>;
  /** The line the hovered or dragged radius or ratio handle slides along (screen px), or null. */
  handleGuide(): { x0: number; y0: number; x1: number; y1: number; arc?: { cx: number; cy: number; r: number; a0: number; a1: number } } | null;
  /** Adaptive quality level now (0 full, 1, 2), and set it by hand (ADR 0028). */
  qualityLevel(): number;
  setQualityLevel(level: 0 | 1 | 2): void;
  setDecodedBudget(bytes: number): void;
  heapMB(): number | null;
  /** Spatial index size and the result of a query for the current view. */
  indexStats(): { objects: number; levels: number; levelsVisited: number; levelsSkippedSubPixel: number; cellsProbed: number; candidates: number; queryMs: number };
  /** Set an object's opacity through a normal transaction (no UI for this yet). */
  setOpacity(id: string, opacity: number): void;
  /** Say something through the notice stack, as the app does with `editor.message`; `done` closes the progress notices of a channel. */
  notify(text: string, done?: string): void;
  /** The visible top-level view. */
  appView(): AppView;
  setView(v: AppView): void;
  /** The asset library as Assets view lists it (after flushing saves). */
  assetListing(): Promise<CatalogListing>;
  /** Every catalog entry, including ones deleted and awaiting collection. */
  catalogEntries(): Promise<CatalogEntry[]>;
  /** The persisted thumbnails (hash, type, bytes, size). */
  thumbRecords(): Promise<Array<{ hash: string; type: string; bytes: number; w: number; h: number }>>;
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
  canvasDump(canvasId: string): Promise<{ objects: SerializedObject[]; view: SerializedCamera | null; bookmarks: Array<{ name: string; view: SerializedCamera }> }>;
  /** Fault injection for tests: remove an original's bytes (a lost or damaged store). */
  removeAssetBytes(hash: string): Promise<void>;
  /** Use a private browser directory (OPFS) as the library folder, as the picker would. */
  useTestFolder(name: string): Promise<void>;
  /** Names of the files in the test folder. */
  testFolderFiles(): Promise<string[]>;
  /** Delete a file of the test folder, as a user moving it away would. */
  testFolderDelete(name: string): Promise<void>;
  /** Make a file of the test folder look as one made before names had extensions: renamed to the bare hash, the stub without its file name. */
  makeBareName(hash: string): Promise<void>;
  /** The folder picker answers with the test folder `name` (the native dialog cannot be driven). */
  stubPicker(name: string): void;
  folderList(): Promise<Array<[string, string, number]>>;
  /** Write the library index now if it is out of date (what its timer does after a quiet moment). */
  flushAutoIndex(): Promise<void>;
  /** A progress notice run by hand (app/progress.ts): begin, update (fraction or null, detail), done (result), fail (text). */
  testProgress(op: "begin" | "update" | "done" | "fail", a?: string | number | null, b?: string): void;
  /** "none", "ready", "needs-permission" or "unavailable". */
  folderState(): string;
  /** Text most recently copied by canvast (Copy Markdown). */
  lastCopied(): string;
  /** The n-th visible character of a text object: code point and outline bounds (font units, y up). */
  textGlyph(id: string, n: number): { cp: number; gid: number; xMin: number; yMin: number; xMax: number; yMax: number; upm: number };
  /** Exact world position of a point (font units, upright) of the n-th visible character of a text object. */
  textGlyphWorld(id: string, n: number, fx: number, fy: number): { x: string; y: string };
}

export interface DebugDeps {
  doc: DocumentStore;
  editor: EditorState;
  session: Session;
  renderNow: () => FrameBreakdown;
  index: FrameIndex;
  appView: () => AppView;
  /** Write a setting of this device by key (tests: travel and tour settings). */
  setSetting: (key: string, value: unknown) => void;
  setView: (v: AppView) => void;
  tiles: TileCache;
  density: DensityLayer;
  quality: QualityGovernor;
  /** Resolves when the index of a big document has been built slice by slice. */
  indexReady: () => Promise<void>;
  /** The names above the items as last drawn. */
  labels: () => readonly { id: string; text: string; x: number; y: number; w: number; h: number }[];
  paint: PaintView;
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
  const glyphOf = (id: string, n: number): { o: TextObject; line: Line; g: PlacedGlyph } => {
    const stored = doc.get(id);
    const o = stored && worldForm(stored); // the hook speaks world coordinates
    if (!o || o.kind !== "text") throw new Error(`no text ${id}`);
    let i = 0;
    for (const line of layoutOf(o).lines) {
      for (const g of line.glyphs) if (g.cp !== 32 && i++ === n) return { o, line, g };
    }
    throw new Error(`text ${id} has no character ${n}`);
  };
  // The hook speaks world-frame (absolute) coordinates, as before frames (ADR 0014); conversions are exact or within 2^-192 frame units.
  const toView = (p: WorldPoint): WorldPoint => expressIn(doc.space, doc.space.world, p, view.frame) ?? approxIn(doc.space, doc.space.world, p, view.frame);
  /** The camera in an object's frame, or null when the object cannot be on screen. */
  const camFor = (o: CanvasObject) => cameraIn(view.frameCamera, o.frame ?? doc.space.world);
  const hook: DebugHook = {
    camera: () => serializeCamera(view.worldCamera()),
    jump: (levels) => view.zoomBy(levels),
    glide: (ms) => void (view.glideMs = ms),
    setSetting: (key, value) => deps.setSetting(key, value),
    depth: () => {
      const d = depthOf(view.frameCamera);
      return `${d.levels}`;
    },
    objectFrames: () => doc.ordered().map((o) => ({ id: o.id, kind: o.kind, level: `${o.frame?.level ?? 0n}`, frame: o.frame?.id ?? null })),
    setCamera: (c) => view.setWorldCamera(deserializeCamera(c)),
    viewport: () => ({ ...view.viewport }),
    worldToScreen: (x, y) => worldToScreen(view.camera, view.viewport, toView({ x: D.parse(x), y: D.parse(y) })),
    screenToWorld: (x, y) => {
      const p = expressExactIn(doc.space, view.frame, screenToWorld(view.camera, view.viewport, { x, y }), doc.space.world);
      return { x: D.toString(p.x), y: D.toString(p.y) };
    },
    landmarkScreen: (id) => {
      const lm = findLandmark(id);
      if (!lm) throw new Error(`unknown landmark ${id}`);
      const s = worldToScreen(view.camera, view.viewport, toView(lm.center));
      const d = levelsBetween(doc.space.world, view.frame);
      return { ...s, sizePx: 2 ** (lm.sizeExp + d + view.camera.zi + view.camera.zf) };
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
    paint: {
      state: () => {
        const s = deps.paint.session;
        if (!s) return null;
        return {
          paintingId: s.painting.id,
          name: s.painting.name,
          pageId: s.pageId,
          pages: s.painting.pages.map((p) => ({ id: p.id, name: p.name, w: p.w, h: p.h, bg: p.bg })),
          activeId: s.activeId,
          layers: [...s.layers.values()].sort((a, b) => a.z - b.z).map((l) => ({ id: l.id, name: l.name, pageId: l.pageId, z: l.z, tiles: Object.keys(l.tiles).length, opacity: l.opacity, ...(l.hidden ? { hidden: true as const } : {}), ...(l.locked ? { locked: true as const } : {}), ...(l.clipBelow ? { clipBelow: true as const } : {}), ...(l.alphaLock ? { alphaLock: true as const } : {}), ...(l.blend ? { blend: l.blend } : {}) })),
          canUndo: s.history.canUndo,
        };
      },
      layerPixel: (id, x, y) => {
        const s = deps.paint.session;
        const l = s?.layers.get(id);
        const c = l && s!.image(l);
        return c ? ([...c.getContext("2d")!.getImageData(x, y, 1, 1).data] as [number, number, number, number]) : null;
      },
      screenOf: (x, y) => {
        const c = deps.paint.camera;
        const el = document.querySelector<HTMLElement>(".paint-canvas");
        if (!el || !deps.paint.session) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + c.x + x * c.scale, y: r.top + c.y + y * c.scale };
      },
      settled: async () => {
        await deps.paint.session?.settled();
        deps.paint.drawNow();
      },
      list: async () => (await deps.paint.list()).map((p) => ({ id: p.id, name: p.name })),
      open: (id) => deps.paint.open(id),
    },
    pixelAt: (x, y) => {
      const dpr = canvas.width / view.viewport.width;
      const d = canvas.getContext("2d")!.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!];
    },
    objects: () => doc.ordered().map(serializeWorld),
    storedObjects: () => doc.ordered().map(serializeObject),
    selection: () => [...editor.selection].sort(),
    tool: () => editor.tool,
    setTool: (t) => editor.setTool(t),
    setLassoFilter: (f) => {
      editor.lassoFilter = f;
      editor.changed();
    },
    itemLabels: () => deps.labels().map((l) => ({ id: l.id, text: l.text, x: l.x, y: l.y, w: l.w, h: l.h })),
    objectScreen: (id) => {
      const o = doc.get(id);
      if (!o) throw new Error(`no object ${id}`);
      const cam = camFor(o);
      const po = cam && projectObject(o, cam, view.viewport, { keepTiny: true });
      return po ? { box: { ...po.box }, q: [...po.q], radius: po.radius } : null;
    },
    collectFrames: async () => {
      await writer.flush();
      await writer.saveCamera(true);
    },
    storedFrameCount: async () => {
      const range = IDBKeyRange.bound([session.current!.canvasId, ""], [session.current!.canvasId, "\uffff"]);
      const tx = session.repo!.db.transaction("frames", "readonly");
      return req<number>(tx.objectStore("frames").count(range));
    },
    coarseState: (id) => {
      const o = doc.get(id);
      if (!o) throw new Error(`no object ${id}`);
      const c = deps.index.views(view.frameCamera).find((v) => v.frame === (o.frame ?? doc.space.world))?.coarse;
      if (!c) return "near";
      const r = classifyCoarse(o, c.center, c.info, view.viewport, c.terms);
      return typeof r === "string" ? r : "cover";
    },
    canUndo: () => doc.canUndo,
    canRedo: () => doc.canRedo,
    bookmarkThumbs: () => session.persistence.bookmarks.map((b) => b.thumb ?? ""),
    dropBookmarkThumbs: async () => {
      await session.persistence.saveBookmarks(session.persistence.bookmarks.map(({ thumb: _t, ...b }) => b));
      editor.changed();
    },
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
      const cam = camFor(o);
      const po = cam && projectObject(o, cam, view.viewport, { keepTiny: true });
      return po ? exactStrokeEdgeDistancePx(po, x, y) : Infinity;
    },
    startupMarks: () => Object.fromEntries(performance.getEntriesByType("mark").filter((m) => m.name.startsWith("canvast:")).map((m) => [m.name.slice(8), m.startTime])),
    benchStore: async (scene) => {
      const t0 = performance.now();
      const { objects } = generateBenchScene(scene);
      const CHUNK = 2_000;
      for (let i = 0; i < objects.length; i += CHUNK) doc.commit(doc.transaction("Seed", objects.slice(i, i + CHUNK)));
      await session.persistence?.flush();
      return { objects: objects.length, ms: performance.now() - t0 };
    },
    benchLoad: async (scene) => {
      const t0 = performance.now();
      const { objects, camera } = generateBenchScene(scene);
      const t1 = performance.now();
      doc.load(objects);
      view.setWorldCamera(camera);
      await deps.indexReady(); // benchmarks measure a complete index
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
    decodedStats: () => ({ ...session.assets!.stats(), maxRunning: session.assets!.maxRunning }),
    selectionFrame: () => {
      const sel = selectedFrame(visibleObjects(doc, deps.index, null, view.frameCamera, view.viewport), editor, view.viewport);
      return sel ? { angle: sel.frame.angle, corners: sel.frame.corners.map(([x, y]) => [x, y] as [number, number]) } : null;
    },
    cornerDots: () => {
      const po = visibleObjects(doc, deps.index, null, view.frameCamera, view.viewport).find((p) => editor.selection.has(p.obj.id));
      const h = po && shapeHandles(po, editor.cornersOpen === po.obj.id, editor);
      return h?.main ? { main: [h.main.x, h.main.y], corners: h.corners.map((d) => [d.x, d.y] as [number, number]), count: h.count ? ([h.count.x, h.count.y] as [number, number]) : null, countCentre: h.count ? ([h.count.cx, h.count.cy] as [number, number]) : null } : null;
    },
    handleLabel: () => editor.handleLabel?.text ?? null,
    pickedNodes: () => [...editor.nodeMulti].map(([id, set]) => [id, set.size] as [string, number]),
    handleGuide: () => editor.handleLabel?.guide ?? null,
    drawnHandles: () => editor.drawnHandles.map(([x, y]) => [x, y] as [number, number]),
    qualityLevel: () => deps.quality.level,
    setQualityLevel: (l) => deps.quality.force(l),
    setDecodedBudget: (bytes) => session.assets!.setBudget(bytes),
    tileStats: () => ({ last: stats.last?.tiles ?? null, held: deps.tiles.tileCount, renderedTotal: deps.tiles.renderedTotal, ahead: deps.tiles.aheadTiles }),
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
      const views = deps.index.views(view.frameCamera);
      const qs = views.map((v) => v.index.query(v.cam, view.viewport));
      const queryMs = performance.now() - t0;
      const sum = (k: "levelsVisited" | "levelsSkippedSubPixel" | "cellsProbed" | "candidates"): number => qs.reduce((a, q) => a + q[k], 0);
      return {
        objects: deps.index.size,
        levels: views.reduce((a, v) => a + v.index.levelCount, 0),
        levelsVisited: sum("levelsVisited"),
        levelsSkippedSubPixel: sum("levelsSkippedSubPixel"),
        cellsProbed: sum("cellsProbed"),
        candidates: sum("candidates"),
        queryMs,
      };
    },
    setOpacity: (id, opacity) => {
      const o = doc.get(id);
      if (!o) throw new Error(`no object ${id}`);
      doc.commit(doc.transaction("Set opacity", [{ ...o, opacity }]));
    },
    notify: (text, done) => {
      if (done) deps.editor.progressDone.add(done);
      deps.editor.message = text;
      deps.editor.changed();
    },
    appView: deps.appView,
    setView: deps.setView,
    assetListing: async () => {
      await writer.flush();
      return session.catalog!.list();
    },
    catalogEntries: () => readAll<CatalogEntry>("assetCatalog"),
    thumbRecords: async () => (await readAll<ThumbRecord>("thumbs")).map((t) => ({ hash: t.hash, type: t.blob.type, bytes: t.blob.size, w: t.w, h: t.h })),
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
      // The hook speaks absolute (world-frame) coordinates.
      const view = loaded.camera && ("v" in loaded.camera ? serializeCamera(toAbsoluteCamera(loaded.space, deserializeFrameCamera(loaded.space, loaded.camera))) : loaded.camera);
      const bookmarks = loaded.bookmarks.map((b) => ({ name: b.name, view: serializeCamera(toAbsoluteCamera(loaded.space, deserializeFrameCamera(loaded.space, b.view))) }));
      return { objects: loaded.objects.map(serializeWorld).sort((a, b) => (a.id < b.id ? -1 : 1)), view, bookmarks };
    },
    useTestFolder: async (name) => {
      await externalFolder.use(testDir(name)); // (not saved: a reload attaches it again, as the saved handle would be)
    },
    testFolderFiles: async () => (await testDirKeys(externalFolder.name)).sort(),
    testFolderDelete: async (name) => {
      await testDir(externalFolder.name).removeEntry(name);
    },
    makeBareName: async (hash) => {
      const dir = testDir(externalFolder.name);
      const name = (await testDirKeys(externalFolder.name)).find((k) => k.startsWith(hash))!;
      const blob = await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer();
      const w = await (await dir.getFileHandle(hash, { create: true })).createWritable();
      await w.write(new Blob([blob]));
      await w.close();
      await dir.removeEntry(name);
      const db = session.repo!.db;
      const tx = db.transaction("assets", "readwrite");
      const r = tx.objectStore("assets").get(hash);
      r.onsuccess = () => {
        const { file: _f, ...rest } = r.result;
        tx.objectStore("assets").put(rest, hash);
      };
      await done(tx);
    },
    testProgress: (op, a, b) => {
      if (op === "begin") testProgressHandle = beginProgress(deps.editor, "test", String(a));
      else if (op === "update") testProgressHandle?.update(a as number | null, b);
      else if (op === "done") testProgressHandle?.done(a as string);
      else testProgressHandle?.fail(String(a));
    },
    flushAutoIndex: async () => void (await session.autoIndex?.flush()),
    folderList: async () => [...(await externalFolder.list())].map(([h, v]) => [h.slice(0, 6), v.file.slice(60), v.size]),
    stubPicker: (name) => {
      externalFolder.saveHandle = false;
      (window as unknown as { showDirectoryPicker: () => Promise<Dir> }).showDirectoryPicker = async () => testDir(name);
    },
    folderState: () => externalFolder.state,
    removeAssetBytes: async (hash) => {
      const tx = session.repo!.db.transaction("assets", "readwrite");
      tx.objectStore("assets").delete(hash);
      await done(tx);
    },
    lastCopied: lastCopiedText,
    textGlyph: (id, n) => {
      const { o, g } = glyphOf(id, n);
      const f = glyphFont(o, g);
      const gl = f.glyph(g.gid);
      return { cp: g.cp, gid: g.gid, xMin: gl.xMin, yMin: gl.yMin, xMax: gl.xMax, yMax: gl.yMax, upm: f.unitsPerEm };
    },
    textGlyphWorld: (id, n, fx, fy) => {
      const { o, line, g } = glyphOf(id, n);
      // Same exact arithmetic as draw-text.ts (upright, unshifted).
      const SIZE = D.fromNumber(o.size);
      const C = D.mul(SIZE, D.fromNumber(glyphScale(line, g) / glyphFont(o, g).unitsPerEm));
      const lx = D.add(D.mul(D.fromNumber(g.x), SIZE), D.mul(D.fromNumber(fx), C));
      const ly = D.sub(D.mul(D.fromNumber(line.baseline), SIZE), D.mul(D.fromNumber(fy), C));
      const at = localToWorld(o, 0, 0);
      return { x: D.toString(D.add(at.x, D.shift(lx, o.unit))), y: D.toString(D.add(at.y, D.shift(ly, o.unit))) };
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
