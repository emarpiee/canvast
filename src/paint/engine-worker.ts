/**
 * The brush engine's worker (ADR 0164, 0165): built on its own (scripts/build.mjs) and started from a blob. It holds the WebAssembly
 * engine and the one layer being painted, and answers in the order it is asked (each message waits for the one before).
 */
import { TILE_BYTES, deflate, hashOf, inflate, isEmpty } from "./codec";
import type { EndedTile, FromWorker, LoadTile, ToWorker } from "./engine-protocol";
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
  stroke_live(): number;
  live_tile_size(): number;
  live_ptr(): number;
  live_keys_ptr(): number;
  stroke_end(): number;
  stroke_cancel(): number;
  dirty_ptr(): number;
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

function begin(brush: object, lock: boolean, w: number, h: number): void {
  page = { w, h };
  const j = new TextEncoder().encode(JSON.stringify(brush));
  const p = e.alloc(j.length);
  new Uint8Array(e.memory.buffer, p, j.length).set(j);
  const r = e.stroke_begin(layer, p, j.length, lock ? 1 : 0);
  e.dealloc(p, j.length);
  if (r !== 0) throw new Error(`the brush could not be read (${r})`);
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
          begin(m.brush, m.lock, m.w, m.h);
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
      }
    } catch (err) {
      post({ t: "error", message: (err as Error).message });
    }
  });
};
