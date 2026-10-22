/**
 * The brush engine's worker (ADR 0164, 0165): built on its own (scripts/build.mjs) and started from a blob. It holds the WebAssembly
 * engine and the one layer being painted, and answers in the order it is asked (each message waits for the one before).
 */
import { TILE_BYTES, deflate, hashOf, inflate, isEmpty } from "./codec";
import type { EndedTile, FromWorker, LoadTile, Symmetry, TipBitmap, ToWorker } from "./engine-protocol";
import { TILE, tileKey, tileOf } from "./tiles";

interface Engine {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  layer_new(): number;
  layer_clear(layer: number): number;
  tile_put(layer: number, tx: number, ty: number, data: number): number;
  tile_get(layer: number, tx: number, ty: number, out: number): number;
  stroke_begin(layer: number, json: number, len: number, lock: number): number;
  stroke_feed(pts: number, n: number): number;
  stroke_symmetry(mode: number, cx: number, cy: number, rotation: number): number;
  stroke_live(): number;
  live_tile_size(): number;
  live_ptr(): number;
  live_keys_ptr(): number;
  stroke_end(): number;
  stroke_cancel(): number;
  dirty_ptr(): number;
  out_ptr(): number;
  out_len(): number;
  out_tips_ptr(): number;
  out_tips_len(): number;
  presets_builtin(): number;
  abr_read(data: number, len: number, group: number, glen: number): number;
  pat_read(data: number, len: number, group: number, glen: number): number;
  abr_write(json: number, len: number): number;
  tip_put(key: number, klen: number, w: number, h: number, data: number): number;
  brush_default(): number;
}

const post = (m: FromWorker, transfer: Transferable[] = []): void => (self as unknown as Worker).postMessage(m, transfer);

let e: Engine;
let layer = 0;
let loaded = "";
let tileBuf = 0;
let ptsBuf = 0;
let ptsCap = 0;
let page = { w: 0, h: 0 };

/** Pixels by hash, newest last: what the worker made or decoded, so undo and a layer switch do not decode again. */
const cache = new Map<string, Uint8Array>();
const CACHE_TILES = 384; // (96 MB)
const remember = (hash: string, rgba: Uint8Array): void => {
  cache.delete(hash);
  cache.set(hash, rgba);
  while (cache.size > CACHE_TILES) cache.delete(cache.keys().next().value!);
};

async function load(id: string, tiles: readonly LoadTile[]): Promise<void> {
  if (id === loaded) return;
  e.layer_clear(layer);
  for (const t of tiles) {
    const rgba = cache.get(t.hash) ?? (await inflate(t.data));
    if (!rgba) continue; // (a damaged tile loads as empty; the page says so when it shows the layer)
    remember(t.hash, rgba);
    const [tx, ty] = tileOf(t.k);
    new Uint8Array(e.memory.buffer, tileBuf, TILE_BYTES).set(rgba);
    e.tile_put(layer, tx, ty, tileBuf);
  }
  loaded = id;
}

function begin(brush: object, lock: boolean, w: number, h: number, sym?: Symmetry): void {
  page = { w, h };
  const j = new TextEncoder().encode(JSON.stringify(brush));
  const p = e.alloc(j.length);
  new Uint8Array(e.memory.buffer, p, j.length).set(j);
  const r = e.stroke_begin(layer, p, j.length, lock ? 1 : 0);
  e.dealloc(p, j.length);
  if (r !== 0) throw new Error(`the brush could not be read (${r})`);
  if (sym && e.stroke_symmetry(sym.mode, sym.cx, sym.cy, sym.rotation) !== 0) throw new Error("the symmetry could not be set");
  loaded = ""; // (the layer changes: it is the stroke's now, whatever id the page gives it next)
}

function points(pts: Float32Array): void {
  if (pts.byteLength > ptsCap) {
    if (ptsBuf) e.dealloc(ptsBuf, ptsCap);
    ptsCap = pts.byteLength * 2;
    ptsBuf = e.alloc(ptsCap);
  }
  new Float32Array(e.memory.buffer, ptsBuf, pts.length).set(pts);
  e.stroke_feed(ptsBuf, pts.length / 7);
  const n = e.stroke_live();
  if (n <= 0) return;
  const side = e.live_tile_size();
  const keys = new Int32Array(e.memory.buffer, e.live_keys_ptr(), n * 2).slice();
  const px = new Uint8Array(e.memory.buffer, e.live_ptr(), n * side * side * 4).slice();
  post({ t: "live", keys, px }, [keys.buffer, px.buffer]);
}

async function end(): Promise<void> {
  const r = e.stroke_end();
  const tiles: EndedTile[] = [];
  if (r === 1) {
    const [x0, y0, x1, y1] = new Int32Array(e.memory.buffer, e.dirty_ptr(), 4);
    // (only the page's own tiles: paint past its edge is not kept)
    const tx0 = Math.max(0, Math.floor(x0! / TILE)), ty0 = Math.max(0, Math.floor(y0! / TILE));
    const tx1 = Math.min(Math.ceil(page.w / TILE), Math.ceil(x1! / TILE)), ty1 = Math.min(Math.ceil(page.h / TILE), Math.ceil(y1! / TILE));
    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = tx0; tx < tx1; tx++) {
        const k = tileKey(tx, ty);
        if (e.tile_get(layer, tx, ty, tileBuf) !== 1) {
          tiles.push({ k, hash: null, rgba: null, data: null });
          continue;
        }
        const rgba = new Uint8Array(e.memory.buffer, tileBuf, TILE_BYTES).slice();
        if (isEmpty(rgba)) {
          tiles.push({ k, hash: null, rgba: null, data: null });
          continue;
        }
        const hash = await hashOf(rgba);
        remember(hash, rgba);
        tiles.push({ k, hash, rgba: rgba.slice(), data: await deflate(rgba) });
      }
    }
  }
  post({ t: "ended", tiles }, tiles.flatMap((t) => (t.rgba ? [t.rgba.buffer] : [])));
}

// ---- presets (ADR 0169) -----------------------------------------------------------------------------------------------------------

/** Run `f` with `bytes` copied into the engine's memory. */
function withBytes<T>(bytes: Uint8Array, f: (ptr: number) => T): T {
  const p = e.alloc(bytes.length);
  new Uint8Array(e.memory.buffer, p, bytes.length).set(bytes);
  try {
    return f(p);
  } finally {
    e.dealloc(p, bytes.length);
  }
}
const outBytes = (): Uint8Array => new Uint8Array(e.memory.buffer, e.out_ptr(), e.out_len()).slice();
const outJson = (): unknown => JSON.parse(new TextDecoder().decode(outBytes()));

function putTip(t: TipBitmap): void {
  const key = new TextEncoder().encode(t.key);
  withBytes(key, (k) => withBytes(new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength), (d) => e.tip_put(k, key.length, t.w, t.h, d)));
}

/** A file's presets (or the built-in ones), their bitmaps hashed and kept in the engine; the presets still name them "#n" (n = index). */
async function presets(id: number, abr?: Uint8Array, group?: string, pat?: boolean): Promise<void> {
  const g = new TextEncoder().encode(group ?? "");
  const n = abr ? withBytes(abr, (pa) => withBytes(g, (pg) => (pat ? e.pat_read : e.abr_read)(pa, abr.length, pg, g.length))) : e.presets_builtin();
  if (n < 0) return post({ t: "failed", id, message: new TextDecoder().decode(outBytes()) });
  const j = outJson() as { presets: object[]; warnings: string[]; tips: Array<[number, number]> };
  const all = new Uint8Array(e.memory.buffer, e.out_tips_ptr(), e.out_tips_len()).slice();
  const tips: TipBitmap[] = [];
  let at = 0;
  for (const [w, h] of j.tips) {
    const bytes = all.slice(at, at + w * h * 2);
    at += w * h * 2;
    const t = { key: await hashOf(bytes), w, h, data: new Uint16Array(bytes.buffer) };
    putTip(t);
    tips.push(t);
  }
  post({ t: "presets", id, presets: j.presets, tips, warnings: j.warnings }, tips.map((t) => t.data.buffer));
}

let queue: Promise<void> = Promise.resolve();
self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  queue = queue.then(async () => {
    try {
      switch (m.t) {
        case "init": {
          e = (await WebAssembly.instantiate(m.module, {})).exports as unknown as Engine;
          layer = e.layer_new();
          tileBuf = e.alloc(TILE_BYTES);
          post({ t: "ready", live: e.live_tile_size() });
          break;
        }
        case "load":
          await load(m.id, m.tiles);
          post({ t: "loaded", id: m.id });
          break;
        case "adopt":
          loaded = m.id;
          break;
        case "begin":
          begin(m.brush, m.lock, m.w, m.h, m.sym);
          break;
        case "points":
          points(m.pts);
          break;
        case "end":
          await end();
          break;
        case "cancel":
          e.stroke_cancel();
          break;
        case "tips":
          for (const t of m.tips) putTip(t);
          break;
        case "presets":
          await presets(m.id, m.abr, m.group, m.pat);
          break;
        case "abr-write": {
          const json = new TextEncoder().encode(JSON.stringify(m.presets));
          const n = withBytes(json, (p) => e.abr_write(p, json.length));
          if (n < 0) post({ t: "failed", id: m.id, message: "the brushes could not be written" });
          else {
            const bytes = outBytes();
            post({ t: "file", id: m.id, bytes }, [bytes.buffer]);
          }
          break;
        }
        case "default":
          e.brush_default();
          post({ t: "presets", id: m.id, presets: [], tips: [], warnings: [], brush: outJson() as object });
          break;
      }
    } catch (err) {
      post({ t: "error", message: (err as Error).message });
    }
  });
};
