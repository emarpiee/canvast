/**
 * An open painting (ADR 0165): its records, its layers' pixels, its history, and its strokes. Every edit is `commit(label, ops)`: the ops
 * are applied to the records (`apply`, the one place that changes them), the layers whose tiles changed are drawn again, the change is
 * stored (in order, read back), and the step goes on the history. Undo and redo are `apply` of the same ops. Strokes go through the brush
 * engine's worker; the layer is shown with its live stroke while it is painted, and the stroke is one step when it ends.
 */
import type { BrushEngine } from "./engine";
import type { EndedTile, LoadTile } from "./engine-protocol";
import { History, type Op, type Step } from "./history";
import { LAYER_KINDS, TILE, type Layer, type Page, type Painting, type RasterLayer, newId, nextName, newPage, stackOf, tileOf } from "./model";
import type { PaintStore, TileBlob } from "./store";
import { inflate } from "./codec";
import type { BlendMode } from "../doc/model";

/** Fields of a layer to change: false or null takes a flag or the blend mode away; a field left out stays as it is. */
export interface LayerPatch {
  readonly name?: string;
  readonly opacity?: number;
  readonly blend?: BlendMode | null;
  readonly hidden?: boolean;
  readonly locked?: boolean;
  readonly clipBelow?: boolean;
  readonly alphaLock?: boolean;
}

export interface StrokeStart {
  readonly brush: object;
  readonly erase: boolean;
}

/** Decoded tiles by hash, for drawing a layer again (undo, opening) without reading storage: a small, most-recently-used cache. */
const decoded = new Map<string, ImageData>();
const DECODED_TILES = 256;

export class PaintSession {
  painting: Painting;
  readonly layers = new Map<string, Layer>();
  readonly history = new History();
  /** The page shown. */
  pageId: string;
  /** The layer the tools work on. */
  activeId: string | null = null;
  /** Each layer's pixels, page-sized (made when its page is shown). */
  private readonly surfaces = new Map<string, HTMLCanvasElement>();
  /** The stroke being painted: its layer, its live overlay and how it goes over the layer. */
  live: { layerId: string; overlay: HTMLCanvasElement; op: GlobalCompositeOperation } | null = null;
  private overlay: HTMLCanvasElement | null = null;
  private strokeBefore: RasterLayer | null = null;
  /** The stroke that ended and is being turned into tiles (a new stroke waits for it). */
  private ending: Promise<void> = Promise.resolve();
  /** Tiles made here and not yet known to be stored (the engine may need them again before the write ends). */
  private readonly unsaved = new Map<string, Blob>();
  private writes: Promise<void> = Promise.resolve();
  /** The version of each layer's pixels the engine knows them by. */
  private readonly versions = new Map<string, string>();
  private readonly listeners = new Set<(what: "records" | "pixels") => void>();
  /** Told when storing fails (the edit stays on screen and in the history). */
  onError: ((text: string) => void) | null = null;

  private constructor(
    private readonly store: PaintStore,
    private readonly engine: BrushEngine | null,
    painting: Painting,
    layers: readonly Layer[],
    private readonly readOnly: () => boolean,
  ) {
    this.painting = painting;
    for (const l of layers) this.layers.set(l.id, l);
    this.pageId = painting.pages[0]!.id;
    this.activeId = this.stack().at(-1)?.id ?? null;
  }

  static async open(store: PaintStore, engine: BrushEngine | null, id: string, readOnly: () => boolean): Promise<PaintSession | null> {
    const r = await store.load(id);
    if (!r) return null;
    const s = new PaintSession(store, engine, r.painting, r.layers, readOnly);
    await s.showPage(s.pageId);
    return s;
  }

  /** A new painting with one page and one empty paint layer, stored. */
  static async create(store: PaintStore, workspaceId: string, name: string, page: Omit<Page, "id" | "name">): Promise<string> {
    const now = Date.now();
    const p: Painting = { id: newId(), workspaceId, name, pages: [newPage({ ...page, name: "Page 1" })], created: now, modified: now };
    const layer = { ...LAYER_KINDS.raster.fresh({ paintingId: p.id, id: newId(), pageId: p.pages[0]!.id, z: 1, opacity: 1 }), name: "Layer 1" };
    await store.write({ paintings: [p], layers: [layer] });
    return p.id;
  }

  subscribe(fn: (what: "records" | "pixels") => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private tell(what: "records" | "pixels"): void {
    for (const fn of this.listeners) fn(what);
  }

  page(): Page {
    return this.painting.pages.find((p) => p.id === this.pageId) ?? this.painting.pages[0]!;
  }
  /** The shown page's layers, bottom first. */
  stack(pageId = this.pageId): Layer[] {
    return stackOf(this.layers.values(), pageId);
  }
  active(): Layer | null {
    const l = this.activeId ? this.layers.get(this.activeId) : undefined;
    return l && l.pageId === this.pageId ? l : null;
  }
  image(l: Layer): HTMLCanvasElement | null {
    return this.surfaces.get(l.id) ?? null;
  }

  // ---- pixels ------------------------------------------------------------------------------------------------------------------------

  private async pixelsOf(hash: string): Promise<ImageData | null> {
    let d = decoded.get(hash);
    if (d) {
      decoded.delete(hash);
      decoded.set(hash, d);
      return d;
    }
    const blob = this.unsaved.get(hash) ?? (await this.store.tile(hash));
    const rgba = blob && (await inflate(blob));
    if (!rgba) return null;
    d = new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer), TILE, TILE);
    decoded.set(hash, d);
    while (decoded.size > DECODED_TILES) decoded.delete(decoded.keys().next().value!);
    return d;
  }

  /** Draw tiles `keys` of a layer from its tile map (all of them when absent): what changed after an undo, a load, a page switch. */
  private async drawTiles(l: Layer, keys?: Iterable<string>): Promise<void> {
    const page = this.painting.pages.find((p) => p.id === l.pageId);
    if (!page) return;
    let c = this.surfaces.get(l.id);
    if (!c) {
      c = document.createElement("canvas");
      c.width = page.w;
      c.height = page.h;
      this.surfaces.set(l.id, c);
      keys = undefined; // (a new surface needs every tile)
    }
    const g = c.getContext("2d")!;
    const todo = keys ? [...keys] : Object.keys(l.tiles);
    let missing = 0;
    await Promise.all(
      todo.map(async (k) => {
        const [tx, ty] = tileOf(k);
        const hash = l.tiles[k];
        const d = hash ? await this.pixelsOf(hash) : null;
        if (hash && !d) missing++;
        // (the layer may have changed again while this tile was read: only its latest tile is drawn)
        if ((this.layers.get(l.id) ?? l).tiles[k] !== hash) return;
        g.clearRect(tx * TILE, ty * TILE, TILE, TILE);
        if (d) g.putImageData(d, tx * TILE, ty * TILE);
      }),
    );
    if (missing) this.onError?.(`${missing} tile${missing === 1 ? "" : "s"} of “${l.name}” could not be read and show empty.`);
  }

  /** Show a page: its layers' pixels are made (and the other pages' let go, to keep memory to one page). */
  async showPage(id: string): Promise<void> {
    if (!this.painting.pages.some((p) => p.id === id)) return;
    this.pageId = id;
    for (const [lid] of this.surfaces) if (this.layers.get(lid)?.pageId !== id) this.surfaces.delete(lid);
    await Promise.all(this.stack().map((l) => (this.surfaces.has(l.id) ? null : this.drawTiles(l))));
    if (!this.active()) this.activeId = this.stack().at(-1)?.id ?? null;
    this.tell("records");
    this.tell("pixels");
  }

  // ---- edits -------------------------------------------------------------------------------------------------------------------------

  /** Change the records (the only place that does): memory, then what must be drawn again. */
  private apply(s: Step): void {
    const redraw: Array<[Layer, string[] | undefined]> = [];
    let resized = false;
    for (const o of s.ops) {
      if (o.store === "painting") {
        const was = this.painting.pages.find((p) => p.id === this.pageId);
        const now = o.after.pages.find((p) => p.id === this.pageId);
        resized ||= !!was && !!now && (was.w !== now.w || was.h !== now.h);
        this.painting = o.after;
        continue;
      }
      const was = o.before ?? (o.after ? this.layers.get(o.after.id) : undefined) ?? null;
      if (o.after) this.layers.set(o.after.id, o.after);
      else if (o.before) {
        this.layers.delete(o.before.id);
        this.surfaces.delete(o.before.id);
        this.versions.delete(o.before.id);
      }
      if (o.after && o.after.pageId === this.pageId) {
        const changed = was ? [...new Set([...Object.keys(was.tiles), ...Object.keys(o.after.tiles)])].filter((k) => was.tiles[k] !== o.after!.tiles[k]) : undefined;
        if (!was || changed!.length) {
          redraw.push([o.after, changed]);
          this.versions.delete(o.after.id); // (the engine loads it again before painting it)
        }
      }
    }
    if (!this.painting.pages.some((p) => p.id === this.pageId)) void this.showPage(this.painting.pages[0]!.id);
    else if (resized) {
      // (the shown page has a new size: its layers' pixels are made again at that size, where they were)
      for (const l of this.stack()) this.surfaces.delete(l.id);
      void this.showPage(this.pageId);
    }
    if (this.activeId && !this.layers.has(this.activeId)) this.activeId = this.stack().at(-1)?.id ?? null;
    this.tell("records");
    if (redraw.length) void Promise.all(redraw.map(([l, k]) => this.drawTiles(l, k))).then(() => this.tell("pixels"));
  }

  /** Store a step's records, in order after the ones before; tiles made here go with them. */
  private persist(s: Step, tiles: readonly TileBlob[] = []): void {
    const layers: Layer[] = [], gone: Array<[string, string]> = [];
    let painting: Painting | null = null;
    for (const o of s.ops) {
      if (o.store === "painting") painting = o.after;
      else if (o.after) layers.push(o.after);
      else if (o.before) gone.push([o.before.paintingId, o.before.id]);
    }
    const p = { ...(painting ?? this.painting), modified: Date.now() };
    this.painting = p;
    this.writes = this.writes
      .then(() => this.store.write({ paintings: [p], layers, deleteLayers: gone, tiles }))
      .then(() => {
        for (const t of tiles) this.unsaved.delete(t.hash);
      })
      .catch((e: unknown) => this.onError?.(`The painting could not be saved: ${(e as Error).message}`));
  }

  /** Resolves when everything changed so far is stored. */
  settled(): Promise<void> {
    return this.ending.then(() => this.writes);
  }

  private blocked(): boolean {
    if (!this.readOnly()) return false;
    this.onError?.("This tab is read-only (canvast is open in another tab that saves): the painting cannot be changed here.");
    return true;
  }

  /** One undo step: apply, store, remember. */
  commit(label: string, ops: readonly Op[], tiles: readonly TileBlob[] = []): void {
    if (!ops.length || this.blocked()) return;
    const s = { label, ops };
    this.apply(s);
    this.persist(s, tiles);
    this.history.push(s);
  }

  undo(): void {
    if (this.live || this.blocked()) return;
    const s = this.history.undo();
    if (!s) return;
    this.apply(s);
    this.persist(s);
  }

  redo(): void {
    if (this.live || this.blocked()) return;
    const s = this.history.redo();
    if (!s) return;
    this.apply(s);
    this.persist(s);
  }

  /** Change fields of a layer (one step; nothing when nothing changes). */
  setLayer(id: string, patch: LayerPatch, label: string): void {
    const l = this.layers.get(id);
    if (!l) return;
    const next = { ...l } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch) as Array<[string, unknown]>) {
      if (v === undefined) continue;
      if (v === false || v === null) delete next[k];
      else next[k] = v;
    }
    if (JSON.stringify(next) === JSON.stringify(l)) return;
    this.commit(label, [{ store: "layer", before: l, after: next as unknown as Layer }]);
  }

  /** A new empty paint layer just above the active one (or on top). */
  addLayer(): void {
    const stack = this.stack();
    const at = this.active();
    const i = at ? stack.indexOf(at) : stack.length - 1;
    const z = i < 0 ? 1 : i === stack.length - 1 ? stack[i]!.z + 1 : (stack[i]!.z + stack[i + 1]!.z) / 2;
    const l = { ...LAYER_KINDS.raster.fresh({ paintingId: this.painting.id, id: newId(), pageId: this.pageId, z, opacity: 1 }), name: nextName("Layer", [...this.layers.values()].map((x) => x.name)) };
    this.commit("New layer", [{ store: "layer", before: null, after: l }]);
    this.activeId = l.id;
    this.tell("records");
  }

  deleteLayer(id: string): void {
    const l = this.layers.get(id);
    if (!l) return;
    if (this.stack(l.pageId).length <= 1) return this.onError?.("A page keeps at least one layer.");
    this.commit("Delete layer", [{ store: "layer", before: l, after: null }]);
  }

  /** Move a layer one place up (+1) or down (-1) on its page. */
  moveLayer(id: string, dir: 1 | -1): void {
    const l = this.layers.get(id);
    if (!l) return;
    const stack = this.stack(l.pageId);
    const i = stack.indexOf(l), j = i + dir;
    if (j < 0 || j >= stack.length) return;
    const o = stack[j]!;
    this.commit(dir > 0 ? "Move layer up" : "Move layer down", [{ store: "layer", before: l, after: { ...l, z: o.z } }, { store: "layer", before: o, after: { ...o, z: l.z } }]);
  }

  private setPainting(next: Painting, label: string): void {
    if (JSON.stringify(next) === JSON.stringify(this.painting)) return;
    this.commit(label, [{ store: "painting", before: this.painting, after: next }]);
  }

  rename(name: string): void {
    const n = name.trim().slice(0, 80);
    if (n) this.setPainting({ ...this.painting, name: n }, "Rename painting");
  }

  setPage(id: string, patch: Partial<Omit<Page, "id">>, label: string): void {
    this.setPainting({ ...this.painting, pages: this.painting.pages.map((p) => (p.id === id ? { ...p, ...patch } : p)) }, label);
  }

  /** A new page after the shown one, the same size, resolution and background, with one empty layer; it is shown. */
  addPage(): void {
    const cur = this.page();
    const page = newPage({ name: nextName("Page", this.painting.pages.map((p) => p.name)), w: cur.w, h: cur.h, dpi: cur.dpi, bg: cur.bg });
    const pages = [...this.painting.pages];
    pages.splice(pages.indexOf(cur) + 1, 0, page);
    const layer = { ...LAYER_KINDS.raster.fresh({ paintingId: this.painting.id, id: newId(), pageId: page.id, z: 1, opacity: 1 }), name: "Layer 1" };
    this.commit("New page", [{ store: "painting", before: this.painting, after: { ...this.painting, pages } }, { store: "layer", before: null, after: layer }]);
    void this.showPage(page.id);
  }

  deletePage(id: string): void {
    if (this.painting.pages.length <= 1) return this.onError?.("A painting keeps at least one page.");
    const ops: Op[] = this.stack(id).map((l) => ({ store: "layer", before: l, after: null }));
    ops.push({ store: "painting", before: this.painting, after: { ...this.painting, pages: this.painting.pages.filter((p) => p.id !== id) } });
    this.commit("Delete page", ops);
  }

  movePage(id: string, dir: 1 | -1): void {
    const pages = [...this.painting.pages];
    const i = pages.findIndex((p) => p.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= pages.length) return;
    [pages[i], pages[j]] = [pages[j]!, pages[i]!];
    this.setPainting({ ...this.painting, pages }, "Move page");
  }

  // ---- strokes -----------------------------------------------------------------------------------------------------------------------

  /** Why the active layer cannot be painted now, or null. */
  cannotPaint(): string | null {
    const l = this.active();
    if (!this.engine) return "The brush engine did not start in this browser.";
    if (!l) return "Pick a layer to paint on.";
    if (l.hidden) return "The picked layer is hidden.";
    if (l.locked) return "The picked layer is locked.";
    return null;
  }

  /** The tiles of a layer as the engine loads them (stored form; the worker keeps the pixels it already has by hash). */
  private async loadTiles(l: Layer): Promise<LoadTile[]> {
    const out: LoadTile[] = [];
    for (const [k, hash] of Object.entries(l.tiles)) {
      const data = this.unsaved.get(hash) ?? (await this.store.tile(hash));
      if (data) out.push({ k, hash, data });
    }
    return out;
  }

  /** Have the engine hold the active layer as it is now (done ahead of a stroke when a layer is picked). */
  async prepare(): Promise<void> {
    const l = this.active();
    if (!l || !this.engine) return;
    let v = this.versions.get(l.id);
    if (!v) this.versions.set(l.id, (v = newId()));
    await this.engine.load(v, await this.loadTiles(l));
  }

  /** Start a stroke on the active layer (false: it cannot be painted; `cannotPaint` says why). */
  async begin(s: StrokeStart): Promise<boolean> {
    await this.ending;
    if (this.cannotPaint() || this.blocked() || this.live) return false;
    const l = this.active() as RasterLayer;
    await this.prepare();
    const page = this.page();
    const overlay = (this.overlay ??= document.createElement("canvas"));
    overlay.width = page.w; // (and cleared)
    overlay.height = page.h;
    this.strokeBefore = l;
    this.live = { layerId: l.id, overlay, op: s.erase ? "destination-out" : l.alphaLock ? "source-atop" : "source-over" };
    this.engine!.begin(s.brush, l.alphaLock === true, page);
    return true;
  }

  /** Samples of the stroke (7 floats each, see engine-protocol.ts). */
  points(pts: Float32Array): void {
    if (this.live) this.engine!.points(pts);
  }

  /** Live tiles from the engine: drawn into the stroke's overlay. */
  showLive(keys: Int32Array, px: Uint8Array, side: number): void {
    if (!this.live) return;
    const g = this.live.overlay.getContext("2d")!;
    const n = side * side * 4;
    for (let i = 0; i < keys.length / 2; i++) g.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset + i * n, n), side, side), keys[2 * i]! * side, keys[2 * i + 1]! * side);
    this.tell("pixels");
  }

  /** End the stroke: the engine's tiles become the layer's (one step), drawn at once, stored after. */
  end(label = "Paint"): Promise<void> {
    if (!this.live || !this.strokeBefore) return Promise.resolve();
    const before = this.strokeBefore;
    this.ending = (async () => {
      const tiles = await this.engine!.end();
      this.applyStroke(before, tiles, label);
      this.live = null;
      this.strokeBefore = null;
      this.tell("pixels");
    })();
    return this.ending;
  }

  private applyStroke(before: RasterLayer, ended: readonly EndedTile[], label: string): void {
    if (!ended.length) return;
    const cur = this.layers.get(before.id) as RasterLayer | undefined;
    if (!cur) return;
    const tiles: Record<string, string> = { ...cur.tiles };
    const blobs: TileBlob[] = [];
    const c = this.surfaces.get(cur.id);
    const g = c?.getContext("2d");
    for (const t of ended) {
      const [tx, ty] = tileOf(t.k);
      if (t.hash && t.rgba && t.data) {
        tiles[t.k] = t.hash;
        blobs.push({ hash: t.hash, data: t.data });
        this.unsaved.set(t.hash, t.data);
        const d = new ImageData(new Uint8ClampedArray(t.rgba.buffer as ArrayBuffer), TILE, TILE);
        decoded.set(t.hash, d);
        g?.clearRect(tx * TILE, ty * TILE, TILE, TILE);
        g?.putImageData(d, tx * TILE, ty * TILE);
      } else {
        delete tiles[t.k];
        g?.clearRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }
    const after: RasterLayer = { ...cur, tiles };
    // (drawn here already: the step is applied without drawing these tiles again, and the engine keeps what it has)
    this.layers.set(cur.id, after);
    const v = newId();
    this.versions.set(cur.id, v);
    this.engine!.adopt(v);
    const s = { label, ops: [{ store: "layer" as const, before: cur, after }] };
    this.persist(s, blobs);
    this.history.push(s);
    this.tell("records");
  }

  /** Drop the stroke being painted: the layer is as it was. */
  cancel(): void {
    if (!this.live) return;
    this.engine!.cancel();
    this.live = null;
    this.strokeBefore = null;
    this.tell("pixels");
  }

  /** Every tile this session can still bring back (kept by the tile GC). */
  roots(): Set<string> {
    const r = this.history.roots();
    for (const l of this.layers.values()) for (const h of Object.values(l.tiles)) r.add(h);
    for (const h of this.unsaved.keys()) r.add(h);
    return r;
  }
}
