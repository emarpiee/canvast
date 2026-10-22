/**
 * An open painting (ADR 0165): its records, its layers' pixels, its history, and its strokes. Every edit is `commit(label, ops)`: the ops
 * are applied to the records (`apply`, the one place that changes them), the layers whose tiles changed are drawn again, the change is
 * stored (in order, read back), and the step goes on the history. Undo and redo are `apply` of the same ops. Strokes go through the brush
 * engine's worker; the layer is shown with its live stroke while it is painted, and the stroke is one step when it ends.
 */
import type { BrushEngine } from "./engine";
import type { EndedTile, LoadTile } from "./engine-protocol";
import { History, type Op, type Step } from "./history";
import { LAYER_KINDS, TILE, hashesOf, tilesOf, type Layer, type LayerFields, type LayerMask, type Page, type Painting, type RasterLayer, newId, nextName, newPage, stackOf, tileOf } from "./model";
import { rasterize } from "./rasterize";
import type { PaintStore, TileBlob } from "./store";
import { deflate, hashOf, inflate, isEmpty } from "./codec";
import { edgeOf } from "./selection";
import { drawWarp, type Quad } from "./warp";
import { moved, objectsOf, scaled, stored } from "./objects";
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
  /** null: no mask. */
  readonly mask?: LayerMask | null;
}

export interface StrokeStart {
  readonly brush: object;
  readonly erase: boolean;
}

/** The engine's name for a layer's mask (its pixels go by the layer's id). */
const maskKey = (id: string): string => `${id}#mask`;

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
  /** Each layer's mask, page-sized, alpha = hidden (made when its page is shown). */
  private readonly maskSurfaces = new Map<string, HTMLCanvasElement>();
  /** The tools paint the active layer's mask, not its pixels (when it has one). */
  maskEdit = false;
  /** The pixels selected on the shown page (alpha = how much), and its outline; null: none (painting goes everywhere).
   * shortcut: a selection is not a step of the history (undo does not bring one back), add it to the steps if people miss it. */
  selection: { readonly mask: HTMLCanvasElement; readonly edge: HTMLCanvasElement } | null = null;
  /** Pixels lifted to be moved, scaled, turned or distorted (free transform): the layer (or its mask) without them, them cut to their box,
   * the selection's part in that box, and the four corners they go to. Shown, not stored, until applied. */
  float: { readonly layerId: string; readonly mask: boolean; readonly rest: HTMLCanvasElement; readonly src: HTMLCanvasElement; readonly sel: HTMLCanvasElement | null; q: Quad } | null = null;
  /** The stroke being painted: its layer, its live overlay, how it goes over the layer, and whether it is the mask's. */
  live: { layerId: string; overlay: HTMLCanvasElement; op: GlobalCompositeOperation; mask?: true } | null = null;
  private overlay: HTMLCanvasElement | null = null;
  private strokeBefore: { layer: Layer; mask: boolean } | null = null;
  /** The stroke that ended and is being turned into tiles, or a pixel edit being made (a new stroke waits for it). */
  private ending: Promise<void> = Promise.resolve();
  /** Tiles being drawn again after a step (an undo, an edit): what `settled` also waits for. */
  private drawing: Promise<unknown> = Promise.resolve();
  /** Tiles made here and not yet known to be stored (the engine may need them again before the write ends). */
  private readonly unsaved = new Map<string, Blob>();
  private writes: Promise<void> = Promise.resolve();
  /** The version of each layer's pixels the engine knows them by. */
  private readonly versions = new Map<string, string>();
  private readonly listeners = new Set<(what: "records" | "pixels") => void>();
  /** Layers as a gesture would leave them, shown and never stored (ADR 0166): a move, a resize, a node; and a new layer being drawn. */
  private readonly previews = new Map<string, Layer>();
  private draftLayer: Layer | null = null;
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
  /** The shown page's layers, bottom first, as they are shown (with what a gesture would make of them). */
  stack(pageId = this.pageId): Layer[] {
    const shown = [...this.layers.values()].map((l) => this.previews.get(l.id) ?? l);
    return stackOf(this.draftLayer ? [...shown, this.draftLayer] : shown, pageId);
  }
  active(): Layer | null {
    const l = this.activeId ? this.layers.get(this.activeId) : undefined;
    return l && l.pageId === this.pageId ? l : null;
  }

  // ---- previews (a gesture's result, shown, not stored) ----------------------------------------------------------------------------

  preview(l: Layer): void {
    this.previews.set(l.id, l);
    this.tell("pixels");
  }
  /** A new layer being drawn (null: none). */
  draft(l: Layer | null): void {
    this.draftLayer = l;
    this.tell("pixels");
  }
  dropPreview(): void {
    this.previews.clear();
    this.draftLayer = null;
    this.tell("pixels");
  }
  /** What the gesture made becomes one step; a drawn layer is picked. */
  endPreview(label: string): void {
    const ops: Op[] = [...this.previews.values()].flatMap((l): Op[] => {
      const before = this.layers.get(l.id);
      return before ? [{ store: "layer", before, after: l }] : [];
    });
    const fresh = this.draftLayer;
    if (fresh) ops.push({ store: "layer", before: null, after: fresh });
    this.previews.clear();
    this.draftLayer = null;
    this.commit(label, ops);
    if (fresh) this.activeId = fresh.id;
    this.tell("records");
    this.tell("pixels");
  }

  /** A new layer of this page with these fields, just above the picked one (or on top), not yet added. */
  freshLayer(fields: LayerFields, name: string): Layer {
    const stack = this.stack().filter((l) => l !== this.draftLayer);
    const at = this.active();
    const i = at ? stack.indexOf(at) : stack.length - 1;
    const z = i < 0 ? 1 : i === stack.length - 1 ? stack[i]!.z + 1 : (stack[i]!.z + stack[i + 1]!.z) / 2;
    return { opacity: 1, ...fields, paintingId: this.painting.id, id: newId(), pageId: this.pageId, z, name } as Layer;
  }
  image(l: Layer): HTMLCanvasElement | null {
    return this.surfaces.get(l.id) ?? null;
  }
  mask(l: Layer): HTMLCanvasElement | null {
    return this.maskSurfaces.get(l.id) ?? null;
  }
  /** Select these pixels (a mask of the page's size), or nothing. */
  select(mask: HTMLCanvasElement | null): void {
    this.selection = mask ? { mask, edge: edgeOf(mask) } : null;
    this.tell("pixels");
  }
  /** Whether the tools paint the active layer's mask now. */
  editsMask(): boolean {
    return this.maskEdit && !!this.active()?.mask;
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

  /** Draw tiles `keys` of a layer's pixels or mask from its tile map (all of them when absent): what changed after an undo, a load, a page switch. */
  private async drawTiles(l: Layer, keys?: Iterable<string>, mask = false): Promise<void> {
    const page = this.painting.pages.find((p) => p.id === l.pageId);
    if (!page || (mask ? !l.mask : l.kind !== "raster")) return;
    const tilesFor = (x: Layer): Readonly<Record<string, string>> => (mask ? (x.mask?.tiles ?? {}) : tilesOf(x));
    const surfaces = mask ? this.maskSurfaces : this.surfaces;
    let c = surfaces.get(l.id);
    if (!c) {
      c = document.createElement("canvas");
      c.width = page.w;
      c.height = page.h;
      surfaces.set(l.id, c);
      keys = undefined; // (a new surface needs every tile)
    }
    const g = c.getContext("2d")!;
    const todo = keys ? [...keys] : Object.keys(tilesFor(l));
    let missing = 0;
    await Promise.all(
      todo.map(async (k) => {
        const [tx, ty] = tileOf(k);
        const hash = tilesFor(l)[k];
        const d = hash ? await this.pixelsOf(hash) : null;
        if (hash && !d) missing++;
        // (the layer may have changed again while this tile was read: only its latest tile is drawn)
        if (tilesFor(this.layers.get(l.id) ?? l)[k] !== hash) return;
        g.clearRect(tx * TILE, ty * TILE, TILE, TILE);
        if (d) g.putImageData(d, tx * TILE, ty * TILE);
      }),
    );
    if (missing) this.onError?.(`${missing} tile${missing === 1 ? "" : "s"} of “${l.name}” could not be read and show empty.`);
  }

  /** Show a page: its layers' pixels are made (and the other pages' let go, to keep memory to one page). */
  async showPage(id: string): Promise<void> {
    if (!this.painting.pages.some((p) => p.id === id)) return;
    if (id !== this.pageId) this.selection = null; // (a selection belongs to its page)
    this.pageId = id;
    for (const m of [this.surfaces, this.maskSurfaces]) for (const [lid] of m) if (this.layers.get(lid)?.pageId !== id) m.delete(lid);
    await Promise.all(this.stack().flatMap((l) => [this.surfaces.has(l.id) || l.kind !== "raster" ? null : this.drawTiles(l), this.maskSurfaces.has(l.id) || !l.mask ? null : this.drawTiles(l, undefined, true)]));
    if (!this.active()) this.activeId = this.stack().at(-1)?.id ?? null;
    this.tell("records");
    this.tell("pixels");
  }

  // ---- edits -------------------------------------------------------------------------------------------------------------------------

  /** Change the records (the only place that does): memory, then what must be drawn again. */
  private apply(s: Step): void {
    const redraw: Array<[Layer, string[] | undefined, boolean?]> = [];
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
        this.maskSurfaces.delete(o.before.id);
        this.versions.delete(o.before.id);
        this.versions.delete(maskKey(o.before.id));
      }
      if (o.after && o.after.pageId === this.pageId) {
        // (the mask's tiles that changed are drawn again; a mask taken away goes)
        const wm = was?.mask?.tiles ?? {}, am = o.after.mask?.tiles;
        const has = this.maskSurfaces.has(o.after.id);
        if (!am) this.maskSurfaces.delete(o.after.id);
        else {
          const changed = [...new Set([...Object.keys(wm), ...Object.keys(am)])].filter((k) => wm[k] !== am[k]);
          if (!has || changed.length) {
            redraw.push([o.after, has ? changed : undefined, true]);
            this.versions.delete(maskKey(o.after.id));
          }
        }
      }
      if (o.after && o.after.kind !== "raster") this.surfaces.delete(o.after.id); // (only a paint layer has pixels of its own)
      if (o.after && o.after.pageId === this.pageId && o.after.kind === "raster") {
        const wt = was ? tilesOf(was) : {}, at = tilesOf(o.after);
        const changed = was && was.kind === "raster" ? [...new Set([...Object.keys(wt), ...Object.keys(at)])].filter((k) => wt[k] !== at[k]) : undefined;
        if (!was || was.kind !== "raster" || changed!.length) {
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
    if (redraw.length) this.drawing = Promise.all([this.drawing, ...redraw.map(([l, k, m]) => this.drawTiles(l, k, m))]).then(() => this.tell("pixels"));
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
    return this.ending.then(() => this.drawing).then(() => this.writes);
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

  /** Add a layer (one step) and pick it; without one, a new empty paint layer just above the picked one. */
  addLayer(l: Layer = this.freshLayer({ kind: "raster", tiles: {} }, nextName("Layer", [...this.layers.values()].map((x) => x.name))), label = "New layer"): void {
    this.commit(label, [{ store: "layer", before: null, after: l }]);
    this.activeId = l.id;
    this.tell("records");
  }

  /** A layer replaced by `l` (the same id; its kind may change, as when it is rasterized). One step. */
  replaceLayer(l: Layer, label: string): void {
    const before = this.layers.get(l.id);
    if (before) this.commit(label, [{ store: "layer", before, after: l }]);
  }

  /**
   * A layer of any kind made a paint layer of the same look (one step): `draw` draws it at 1:1 on a page-sized canvas (its kind's own
   * renderer, compose.ts), and the pixels become its tiles.
   */
  async rasterizeLayer(id: string, draw: (g: CanvasRenderingContext2D) => void): Promise<void> {
    const l = this.layers.get(id);
    const page = l && this.painting.pages.find((p) => p.id === l.pageId);
    if (!l || !page || l.kind === "raster" || this.blocked()) return;
    const r = await rasterize(page.w, page.h, draw);
    for (const [k, d] of r.pixels) decoded.set(r.tiles[k]!, d);
    for (const b of r.blobs) this.unsaved.set(b.hash, b.data);
    const { objs: _o, gen: _g, paint: _p, adjust: _a, ...common } = l as Layer & Record<string, unknown>;
    if (l.mask && !l.mask.off) delete common["mask"]; // (drawn into the pixels already)
    this.commit("Rasterize", [{ store: "layer", before: l, after: { ...(common as unknown as RasterLayer), kind: "raster", tiles: r.tiles } }], r.blobs);
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

  /**
   * A new size for a page, as one step: `canvas` keeps the pixels at their size (cut or given room, placed by `anchor`, 0 to 1 on each
   * axis); `image` scales everything to the new size (resampled). Every paint layer and mask is made again, vector layers are moved or
   * scaled; fill and adjustment layers cover any page. `patch` is the rest of the page's settings. The selection goes.
   */
  resizePage(id: string, w: number, h: number, how: "canvas" | "image", anchor: readonly [number, number], patch: Partial<Omit<Page, "id" | "w" | "h">>, label: string): Promise<void> {
    this.ending = this.ending.then(() => this.resizePageNow(id, w, h, how, anchor, patch, label));
    return this.ending;
  }
  private async resizePageNow(id: string, w: number, h: number, how: "canvas" | "image", anchor: readonly [number, number], patch: Partial<Omit<Page, "id" | "w" | "h">>, label: string): Promise<void> {
    if (this.blocked() || this.live) return;
    if (id !== this.pageId) await this.showPage(id);
    const page = this.page();
    const dx = Math.round((w - page.w) * anchor[0]), dy = Math.round((h - page.h) * anchor[1]);
    const blobs: TileBlob[] = [];
    const again = async (src: HTMLCanvasElement | undefined): Promise<Record<string, string>> => {
      const r = await rasterize(w, h, (g) => {
        if (!src) return;
        if (how === "canvas") return g.drawImage(src, dx, dy);
        g.imageSmoothingQuality = "high";
        g.drawImage(src, 0, 0, w, h);
      });
      for (const [k, d] of r.pixels) decoded.set(r.tiles[k]!, d);
      for (const b of r.blobs) {
        this.unsaved.set(b.hash, b.data);
        blobs.push(b);
      }
      return r.tiles;
    };
    const ops: Op[] = [{ store: "painting", before: this.painting, after: { ...this.painting, pages: this.painting.pages.map((p) => (p.id === id ? { ...p, ...patch, w, h } : p)) } }];
    for (const l of stackOf(this.layers.values(), id)) {
      let after: Layer = l;
      if (l.kind === "raster") after = { ...l, tiles: await again(this.surfaces.get(l.id)) };
      else if (l.kind === "object") after = { ...l, objs: stored(how === "canvas" ? moved(objectsOf(l.objs), dx, dy) : scaled(objectsOf(l.objs), 0, 0, w / page.w, h / page.h)) };
      if (l.mask) after = { ...after, mask: { ...l.mask, tiles: await again(this.maskSurfaces.get(l.id)) } };
      if (after !== l) ops.push({ store: "layer", before: l, after });
    }
    this.selection = null;
    this.commit(label, ops, blobs);
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
    if (this.editsMask()) {
      if (l.mask!.off) return "The mask is turned off: turn it on (the layer's ⋯ menu) to paint it.";
    } else if (l.kind !== "raster") return `“${l.name}” is a ${LAYER_KINDS[l.kind].label.toLowerCase()}: pick a paint layer, or Rasterize this one (its ⋯ menu) to paint on it.`;
    if (l.hidden) return "The picked layer is hidden.";
    if (l.locked) return "The picked layer is locked.";
    return null;
  }

  /** The tiles of a layer as the engine loads them (stored form; the worker keeps the pixels it already has by hash). */
  private async loadTiles(l: Layer, mask = false): Promise<LoadTile[]> {
    const out: LoadTile[] = [];
    for (const [k, hash] of Object.entries(mask ? (l.mask?.tiles ?? {}) : tilesOf(l))) {
      const data = this.unsaved.get(hash) ?? (await this.store.tile(hash));
      if (data) out.push({ k, hash, data });
    }
    return out;
  }

  /** Have the engine hold the active layer as it is now (done ahead of a stroke when a layer is picked). */
  async prepare(): Promise<void> {
    const l = this.active();
    if (!l || !this.engine) return;
    const mask = this.editsMask(), key = mask ? maskKey(l.id) : l.id;
    let v = this.versions.get(key);
    if (!v) this.versions.set(key, (v = newId()));
    await this.engine.load(v, await this.loadTiles(l, mask));
  }

  /** Start a stroke on the active layer (false: it cannot be painted; `cannotPaint` says why). */
  async begin(s: StrokeStart): Promise<boolean> {
    await this.ending;
    if (this.cannotPaint() || this.blocked() || this.live) return false;
    const l = this.active()!;
    const mask = this.editsMask();
    const lock = !mask && l.kind === "raster" && l.alphaLock === true;
    await this.prepare();
    const page = this.page();
    const overlay = (this.overlay ??= document.createElement("canvas"));
    overlay.width = page.w; // (and cleared)
    overlay.height = page.h;
    this.strokeBefore = { layer: l, mask };
    this.live = { layerId: l.id, overlay, op: s.erase ? "destination-out" : lock ? "source-atop" : "source-over", ...(mask ? { mask: true as const } : {}) };
    this.engine!.begin(s.brush, lock, page);
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
    const sel = this.selection?.mask;
    for (let i = 0; i < keys.length / 2; i++) {
      const x = keys[2 * i]! * side, y = keys[2 * i + 1]! * side;
      g.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset + i * n, n), side, side), x, y);
      if (!sel) continue;
      // (painted only inside the selection, as it will be when the stroke ends)
      g.globalCompositeOperation = "destination-in";
      g.drawImage(sel, x, y, side, side, x, y, side, side);
      g.globalCompositeOperation = "source-over";
    }
    this.tell("pixels");
  }

  /** End the stroke: the engine's tiles become the layer's (one step), drawn at once, stored after. */
  end(label = "Paint"): Promise<void> {
    if (!this.live || !this.strokeBefore) return Promise.resolve();
    const before = this.strokeBefore;
    this.ending = (async () => {
      const sel = this.selection?.mask;
      const ended = await this.engine!.end();
      const tiles = sel ? await this.clipped(before, ended, sel) : ended;
      this.applyStroke(before, tiles, label, !!sel);
      this.live = null;
      this.strokeBefore = null;
      this.tell("pixels");
    })();
    return this.ending;
  }

  /** The stroke's tiles kept only inside the selection: outside it each pixel is as it was, on a feathered edge it is mixed by how much is selected. */
  private async clipped(before: { layer: Layer; mask: boolean }, ended: readonly EndedTile[], sel: HTMLCanvasElement): Promise<EndedTile[]> {
    const was = (before.mask ? this.maskSurfaces : this.surfaces).get(before.layer.id);
    const sg = sel.getContext("2d", { willReadFrequently: true })!;
    const wg = was?.getContext("2d", { willReadFrequently: true });
    return Promise.all(
      ended.map(async (t): Promise<EndedTile> => {
        const [tx, ty] = tileOf(t.k);
        const s = sg.getImageData(tx * TILE, ty * TILE, TILE, TILE).data;
        const old = wg ? wg.getImageData(tx * TILE, ty * TILE, TILE, TILE).data : new Uint8ClampedArray(TILE * TILE * 4);
        const now = t.rgba ?? new Uint8Array(TILE * TILE * 4);
        const out = new Uint8Array(TILE * TILE * 4);
        for (let i = 0; i < out.length; i += 4) {
          const k = s[i + 3]! / 255;
          // (mixed premultiplied, so a soft edge over a clear pixel does not darken)
          const ao = old[i + 3]!, an = now[i + 3]!, a = ao + (an - ao) * k;
          out[i + 3] = Math.round(a);
          if (a > 0) for (let c = 0; c < 3; c++) out[i + c] = Math.round((old[i + c]! * ao + (now[i + c]! * an - old[i + c]! * ao) * k) / a);
        }
        if (isEmpty(out)) return { k: t.k, hash: null, rgba: null, data: null };
        return { k: t.k, hash: await hashOf(out), rgba: out, data: await deflate(out) };
      }),
    );
  }

  private applyStroke(before: { layer: Layer; mask: boolean }, ended: readonly EndedTile[], label: string, clipped = false): void {
    if (!ended.length) return;
    const cur = this.layers.get(before.layer.id);
    const mask = before.mask;
    if (!cur || (mask ? !cur.mask : cur.kind !== "raster")) return;
    const tiles: Record<string, string> = { ...(mask ? cur.mask!.tiles : tilesOf(cur)) };
    const blobs: TileBlob[] = [];
    const c = (mask ? this.maskSurfaces : this.surfaces).get(cur.id);
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
    const after: Layer = mask ? { ...cur, mask: { ...cur.mask!, tiles } } : { ...(cur as RasterLayer), tiles };
    // (drawn here already: the step is applied without drawing these tiles again, and the engine keeps what it has)
    this.layers.set(cur.id, after);
    if (clipped) this.versions.delete(mask ? maskKey(cur.id) : cur.id); // (the engine holds the stroke unclipped: it loads the layer again)
    else {
      const v = newId();
      this.versions.set(mask ? maskKey(cur.id) : cur.id, v);
      this.engine!.adopt(v);
    }
    const s = { label, ops: [{ store: "layer" as const, before: cur, after }] };
    this.persist(s, blobs);
    this.history.push(s);
    this.tell("records");
  }

  /**
   * Put `ink` (page-sized, in page px) on the active layer, or on its mask when that is what is painted, inside the selection: over it,
   * inside its paint with alpha lock, or taking away with `erase` (on a mask: hiding, or showing with `erase`). One step. The fill bucket,
   * the gradient and clearing the selection use it; the engine is not involved.
   */
  editPixels(ink: HTMLCanvasElement, label: string, erase = false): Promise<void> {
    this.ending = this.ending.then(() => this.editPixelsNow(ink, label, erase));
    return this.ending;
  }
  private async editPixelsNow(ink: HTMLCanvasElement, label: string, erase: boolean): Promise<void> {
    const why = this.cannotPaint();
    if (why) return void this.onError?.(why);
    if (this.blocked() || this.live) return;
    const l = this.active()!;
    const mask = this.editsMask();
    const page = this.page();
    const surface = (mask ? this.maskSurfaces : this.surfaces).get(l.id);
    let src = ink;
    if (this.selection) {
      src = document.createElement("canvas");
      src.width = page.w;
      src.height = page.h;
      const k = src.getContext("2d")!;
      k.drawImage(ink, 0, 0);
      k.globalCompositeOperation = "destination-in";
      k.drawImage(this.selection.mask, 0, 0);
    }
    const r = await rasterize(page.w, page.h, (g) => {
      if (surface) g.drawImage(surface, 0, 0);
      g.globalCompositeOperation = erase ? "destination-out" : !mask && l.kind === "raster" && l.alphaLock ? "source-atop" : "source-over";
      g.drawImage(src, 0, 0);
    });
    for (const [k, d] of r.pixels) decoded.set(r.tiles[k]!, d);
    for (const b of r.blobs) this.unsaved.set(b.hash, b.data);
    const cur = this.layers.get(l.id) ?? l;
    const after: Layer = mask ? { ...cur, mask: { ...cur.mask!, tiles: r.tiles } } : { ...(cur as RasterLayer), tiles: r.tiles };
    this.commit(label, [{ store: "layer", before: cur, after }], r.blobs);
  }

  /** Lift the active layer's pixels (or its mask's), the selected ones when there is a selection, for a free transform. False: nothing to lift. */
  startFloat(): boolean {
    const why = this.cannotPaint();
    if (why) return this.onError?.(why), false;
    if (this.live || this.float) return !!this.float;
    const l = this.active()!;
    const mask = this.editsMask();
    const surface = (mask ? this.maskSurfaces : this.surfaces).get(l.id);
    if (!surface) return false;
    const page = this.page();
    const canvas = (w: number, h: number): HTMLCanvasElement => Object.assign(document.createElement("canvas"), { width: w, height: h });
    const lifted = canvas(page.w, page.h);
    const lg = lifted.getContext("2d", { willReadFrequently: true })!;
    lg.drawImage(surface, 0, 0);
    const sel = this.selection?.mask;
    if (sel) {
      lg.globalCompositeOperation = "destination-in";
      lg.drawImage(sel, 0, 0);
    }
    // (the box of the selection, which moves whole; without one, of what has paint)
    const d = (sel ? sel.getContext("2d", { willReadFrequently: true })! : lg).getImageData(0, 0, page.w, page.h).data;
    let x0 = page.w, y0 = page.h, x1 = -1, y1 = -1;
    for (let y = 0; y < page.h; y++) for (let x = 0; x < page.w; x++) if (d[(y * page.w + x) * 4 + 3]) (x < x0 && (x0 = x), x > x1 && (x1 = x), y < y0 && (y0 = y), y > y1 && (y1 = y));
    if (x1 < 0) return false;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const src = canvas(w, h);
    src.getContext("2d")!.drawImage(lifted, -x0, -y0);
    const rest = canvas(page.w, page.h);
    const rg = rest.getContext("2d")!;
    rg.drawImage(surface, 0, 0);
    rg.globalCompositeOperation = "destination-out";
    rg.drawImage(sel ?? surface, 0, 0);
    let selBox: HTMLCanvasElement | null = null;
    if (sel) {
      selBox = canvas(w, h);
      selBox.getContext("2d")!.drawImage(sel, -x0, -y0);
    }
    this.float = { layerId: l.id, mask, rest, src, sel: selBox, q: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]] };
    this.tell("pixels");
    return true;
  }
  /** Where the lifted pixels go now (shown at once). */
  moveFloat(q: Quad): void {
    if (!this.float) return;
    this.float.q = q;
    this.tell("pixels");
  }
  /** Put the lifted pixels back as they are not moved. */
  cancelFloat(): void {
    if (!this.float) return;
    this.float = null;
    this.tell("pixels");
  }
  /** Apply the free transform: the layer (or mask) becomes what is shown, one step; the selection goes with the pixels. */
  applyFloat(label = "Transform"): Promise<void> {
    const f = this.float;
    if (!f) return Promise.resolve();
    this.ending = this.ending.then(async () => {
      this.float = null;
      const l = this.layers.get(f.layerId);
      const page = this.page();
      if (!l || this.blocked()) return void this.tell("pixels");
      const r = await rasterize(page.w, page.h, (g) => {
        g.drawImage(f.rest, 0, 0);
        drawWarp(g, f.src, f.q);
      });
      for (const [k, d] of r.pixels) decoded.set(r.tiles[k]!, d);
      for (const b of r.blobs) this.unsaved.set(b.hash, b.data);
      const after: Layer = f.mask ? { ...l, mask: { ...l.mask!, tiles: r.tiles } } : { ...(l as RasterLayer), tiles: r.tiles };
      this.commit(label, [{ store: "layer", before: l, after }], r.blobs);
      if (f.sel) {
        const m = Object.assign(document.createElement("canvas"), { width: page.w, height: page.h });
        drawWarp(m.getContext("2d")!, f.sel, f.q);
        this.select(m);
      }
    });
    return this.ending;
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
    for (const l of this.layers.values()) for (const h of hashesOf(l)) r.add(h);
    for (const h of this.unsaved.keys()) r.add(h);
    return r;
  }
}
