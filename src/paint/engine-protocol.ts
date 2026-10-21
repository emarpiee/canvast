/**
 * The messages between the page and the brush engine's worker (ADR 0164, 0165). The worker holds the engine and one layer loaded in it
 * (the one being painted); the page sends the layer's tiles, the brush and the pointer's samples, and gets back the live stroke (coverage
 * tiles) and, when the stroke ends, the layer's changed tiles: pixels, stored form and hash.
 */

/** A tile of the layer to load: its stored form, unless the worker already has those pixels (by hash). */
export interface LoadTile {
  readonly k: string;
  readonly hash: string;
  readonly data: Blob;
}

export type ToWorker =
  | { readonly t: "init"; readonly module: WebAssembly.Module }
  /** Make the engine's layer this one (`id` names the version: the same id twice loads nothing). */
  | { readonly t: "load"; readonly id: string; readonly tiles: readonly LoadTile[] }
  /** The engine's layer, as the last stroke left it, is now the version `id` (nothing to load). */
  | { readonly t: "adopt"; readonly id: string }
  | { readonly t: "begin"; readonly brush: object; readonly lock: boolean; readonly w: number; readonly h: number }
  /** Samples, 7 floats each: x, y (page px), pressure (0..1), tilt x, tilt y (degrees), rotation (degrees), time (ms). */
  | { readonly t: "points"; readonly pts: Float32Array }
  | { readonly t: "end" }
  | { readonly t: "cancel" };

/** A tile changed by a stroke: null pixels when it is empty now (it is then not stored). */
export interface EndedTile {
  readonly k: string;
  readonly hash: string | null;
  readonly rgba: Uint8Array | null;
  readonly data: Blob | null;
}

export type FromWorker =
  | { readonly t: "ready"; readonly live: number }
  | { readonly t: "loaded"; readonly id: string }
  /** The live stroke since the last message: `keys` (tx, ty pairs of live tiles), their pixels one after another. */
  | { readonly t: "live"; readonly keys: Int32Array; readonly px: Uint8Array }
  | { readonly t: "ended"; readonly tiles: readonly EndedTile[] }
  | { readonly t: "error"; readonly message: string };
