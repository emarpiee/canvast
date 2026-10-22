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

/** A bitmap a brush names (a sampled tip or a texture): its key (the SHA-256 of `data`'s bytes), size and u16 samples, row by row. */
/** Painting symmetry (the engine's modes, 1 vertical axis, 2 horizontal, 3 both, 4 diagonal) about a point of the page, turned by degrees. */
export interface Symmetry {
  readonly mode: 1 | 2 | 3 | 4;
  readonly cx: number;
  readonly cy: number;
  readonly rotation: number;
}

/** A smudge stroke: how much of the carried colour each dab lays down, and whether it starts with the brush's colour. */
export interface Smudge {
  readonly strength: number;
  readonly finger: boolean;
}

/** What a stroke is besides a plain one: painted with symmetry, a smudge, or a clone stamp from (dx, dy) away. */
export interface StrokeKind {
  readonly sym?: Symmetry;
  readonly smudge?: Smudge;
  readonly clone?: { readonly dx: number; readonly dy: number };
}

export interface TipBitmap {
  readonly key: string;
  readonly w: number;
  readonly h: number;
  readonly data: Uint16Array;
}

export type ToWorker =
  | { readonly t: "init"; readonly module: WebAssembly.Module }
  /** Make the engine's layer this one (`id` names the version: the same id twice loads nothing). */
  | { readonly t: "load"; readonly id: string; readonly tiles: readonly LoadTile[] }
  /** The engine's layer, as the last stroke left it, is now the version `id` (nothing to load). */
  | { readonly t: "adopt"; readonly id: string }
  | { readonly t: "begin"; readonly brush: object; readonly lock: boolean; readonly w: number; readonly h: number; readonly sym?: Symmetry; /** A smudge (0..1 strength; finger: start with the brush's colour). */ readonly smudge?: Smudge; /** A clone stamp: from (dx, dy) away. */ readonly clone?: { readonly dx: number; readonly dy: number } }
  /** Samples, 7 floats each: x, y (page px), pressure (0..1), tilt x, tilt y (degrees), rotation (degrees), time (ms). */
  | { readonly t: "points"; readonly pts: Float32Array }
  | { readonly t: "end" }
  | { readonly t: "cancel" }
  /** Bitmaps the next brushes name (kept in the engine from then on). */
  | { readonly t: "tips"; readonly tips: readonly TipBitmap[] }
  /** Presets: a brush file's (`abr`, listed under `group`), or the engine's built-in ones; answered by a `presets` reply. */
  | { readonly t: "presets"; readonly id: number; readonly abr?: Uint8Array; readonly group?: string; /** The file is a `.pat` (patterns), not an `.abr`. */ readonly pat?: true }
  /** Presets (their bitmaps sent before with `tips`) as an `.abr` file; answered by a `file` reply. */
  | { readonly t: "abr-write"; readonly id: number; readonly presets: readonly object[] }
  /** The engine's default brush; answered by a `presets` reply with `brush`. */
  | { readonly t: "default"; readonly id: number };

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
  | { readonly t: "error"; readonly message: string }
  /** Presets with their bitmaps taken out (each named by its hash in `tips`), and what could not be read of them. */
  | { readonly t: "presets"; readonly id: number; readonly presets: readonly object[]; readonly tips: readonly TipBitmap[]; readonly warnings: readonly string[]; readonly brush?: object }
  | { readonly t: "file"; readonly id: number; readonly bytes: Uint8Array }
  | { readonly t: "failed"; readonly id: number; readonly message: string };
