/**
 * An invisible watermark in a picture's pixels: a short text or a 32 × 32 black and white logo, hidden in the brightness of its 8 × 8 pixel
 * blocks, where JPEG keeps it. Each block carries one bit in which of two of its middle frequencies (DCT coefficients (1,2) and (2,1)) is
 * the larger, by at least a margin (the strength): the pair is nudged apart only when it is not already so. Saving as JPEG, resizing and
 * changing the contrast shrink or round both alike, so which one is larger survives them. The bits are a frame (a check word, the payload,
 * encrypted, a CRC-32, then Reed–Solomon bytes that put wrong ones right) laid over a tile of blocks that repeats across the picture, so a
 * part of it still holds whole frames, and every copy votes. Reading finds the 8-pixel grid by where the pairs are least often nearly equal
 * (a marked block never is), tries every place a tile can start, and keeps the frame whose CRC is right; the caller tries other scales and
 * quarter turns. Without the password a found frame cannot be read, but it is known to be there.
 *
 * Pure: works on RGBA pixels (`Pixels`), so it runs the same in tests.
 */
import { rsDecode, rsEncode } from "./reed-solomon";

export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export type MarkContent = { readonly kind: "text"; readonly text: string } | { readonly kind: "logo"; readonly bits: Uint8Array };

/** How much the picture may be changed: the margin between the pair of coefficients. Light is hardest to see, Strong survives the most. */
export const STEPS = { light: 8, normal: 14, strong: 24 } as const;
export type Strength = keyof typeof STEPS;

/** At most this many bytes of text (UTF-8). */
export const MAX_MARK_TEXT_BYTES = 64;
/** A logo is this many pixels a side, one bit each. */
export const LOGO_SIDE = 32;

const MAGIC = [0x63, 0x77]; // "cw": the payload was opened with the right key
/**
 * The frames, smallest first: texts of up to 16, 32 or 64 bytes (magic, length, the bytes) and logos (magic, 128 bytes); then a CRC-32 and
 * `PARITY` Reed–Solomon bytes. A short text takes a small tile, so even a small picture holds it many times over.
 */
const FRAMES = [
  { kind: "text" as const, bytes: 2 + 1 + 16, tile: 18 },
  { kind: "text" as const, bytes: 2 + 1 + 32, tile: 21 },
  { kind: "text" as const, bytes: 2 + 1 + MAX_MARK_TEXT_BYTES, tile: 27 },
  { kind: "logo" as const, bytes: 2 + (LOGO_SIDE * LOGO_SIDE) / 8, tile: 35 },
];
/** Up to half as many wrong bytes as this are put right. */
const PARITY = 16;
const frameBits = (f: (typeof FRAMES)[number]): number => (f.bytes + 4 + PARITY) * 8;

/** A frame ready to hide: its bytes and which of `FRAMES` it is. */
export interface Frame {
  readonly frame: Uint8Array;
  readonly cls: number;
}

// ---- the frame: encrypted payload and its CRC ------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The key for a password (empty: the one every copy of the app has, so a mark without a password is read anywhere). */
export async function markKey(password: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode("canvast invisible watermark v1"), iterations: 100_000 }, base, { name: "AES-CTR", length: 256 }, false, ["encrypt"]);
}

const xorStream = async (key: CryptoKey, b: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CTR", counter: new Uint8Array(16), length: 64 }, key, b as Uint8Array<ArrayBuffer>));

/** The frame for `content` (encrypted with `key`, then its CRC, then its Reed–Solomon bytes). Throws for a text too long. */
export async function frameOf(content: MarkContent, key: CryptoKey): Promise<Frame> {
  const t = content.kind === "text" ? new TextEncoder().encode(content.text) : null;
  if (t && t.length > MAX_MARK_TEXT_BYTES) throw new RangeError(`the text is more than ${MAX_MARK_TEXT_BYTES} bytes`);
  const cls = FRAMES.findIndex((x) => x.kind === content.kind && (!t || x.bytes - 3 >= t.length));
  const f = FRAMES[cls]!;
  const plain = new Uint8Array(f.bytes);
  plain.set(MAGIC);
  if (t) {
    plain[2] = t.length;
    plain.set(t, 3);
  } else if (content.kind === "logo") plain.set(content.bits.subarray(0, (LOGO_SIDE * LOGO_SIDE) / 8), 2);
  const sealed = await xorStream(key, plain);
  const out = new Uint8Array(f.bytes + 4);
  out.set(sealed);
  new DataView(out.buffer).setUint32(f.bytes, crc32(sealed));
  return { frame: rsEncode(out, PARITY), cls };
}

/** The content of a found frame, or null when `key` is not the one it was hidden with. */
export async function openFrame(found: Frame, key: CryptoKey): Promise<MarkContent | null> {
  const f = FRAMES[found.cls]!;
  const plain = await xorStream(key, found.frame.subarray(0, f.bytes));
  if (plain[0] !== MAGIC[0] || plain[1] !== MAGIC[1]) return null;
  if (f.kind === "logo") return { kind: "logo", bits: plain.slice(2) };
  const n = plain[2]!;
  if (n > f.bytes - 3) return null;
  return { kind: "text", text: new TextDecoder().decode(plain.subarray(3, 3 + n)) };
}

// ---- the blocks: two coefficients each -------------------------------------------------------------------------------------------------

/** The orthonormal 8 × 8 DCT basis of coefficients (1,2) and (2,1), as 64 weights each. */
const BASIS = (() => {
  const a = (k: number): number => (k === 0 ? Math.sqrt(1 / 8) : Math.sqrt(2 / 8));
  const of = (u: number, v: number): Float64Array => {
    const b = new Float64Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) b[y * 8 + x] = a(u) * a(v) * Math.cos(((2 * x + 1) * u * Math.PI) / 16) * Math.cos(((2 * y + 1) * v * Math.PI) / 16);
    return b;
  };
  return [of(1, 2), of(2, 1)];
})();

/** Brightness (0 to 255) of every pixel. */
function lumaOf(p: Pixels): Float32Array {
  const y = new Float32Array(p.width * p.height);
  const d = p.data;
  for (let i = 0, j = 0; i < y.length; i++, j += 4) y[i] = 0.299 * d[j]! + 0.587 * d[j + 1]! + 0.114 * d[j + 2]!;
  return y;
}

const coef = (y: Float32Array, w: number, x0: number, y0: number, b: Float64Array): number => {
  let s = 0;
  for (let r = 0; r < 8; r++) {
    const row = (y0 + r) * w + x0;
    for (let c = 0; c < 8; c++) s += y[row + c]! * b[r * 8 + c]!;
  }
  return s;
};

/** How sure a block's pair is of a 1 (+1) or a 0 (−1): their difference, against the smallest margin. */
const soft = (d: number): number => Math.max(-1, Math.min(1, d / STEPS.light));

/** Which bit of the frame each place of the tile carries: a fixed shuffle (the same everywhere, so a mark is found without its password). */
function tileOrder(tile: number, bits: number): Uint16Array {
  const n = tile * tile;
  const order = new Uint16Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  let s = 0x63616e76 ^ tile;
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  for (let i = 0; i < n; i++) order[i] = order[i]! % bits;
  return order;
}

// ---- hiding -----------------------------------------------------------------------------------------------------------------------------

/**
 * Hide `frame` in the blocks of `p` that lie wholly inside `region` (pixels; default the whole picture), changing the pixels in place. Returns
 * the peak signal-to-noise ratio of the change in dB (higher: less visible; Infinity when nothing changed).
 */
export function hideFrame(p: Pixels, sealed: Frame, strength: Strength, region?: { x0: number; y0: number; x1: number; y1: number }): number {
  const f = FRAMES[sealed.cls]!;
  const frame = sealed.frame;
  const bits = frameBits(f);
  if (frame.length * 8 !== bits) throw new RangeError("not a frame of that kind");
  const order = tileOrder(f.tile, bits);
  const step = STEPS[strength];
  const y = lumaOf(p);
  const w = p.width, d = p.data;
  const r = region ?? { x0: 0, y0: 0, x1: p.width, y1: p.height };
  let sq = 0;
  for (let by = 0; by * 8 + 8 <= p.height; by++) {
    for (let bx = 0; bx * 8 + 8 <= p.width; bx++) {
      const x0 = bx * 8, y0 = by * 8;
      if (x0 < r.x0 || y0 < r.y0 || x0 + 8 > r.x1 || y0 + 8 > r.y1) continue;
      const j = order[(by % f.tile) * f.tile + (bx % f.tile)]!;
      const bit = (frame[j >> 3]! >> (7 - (j & 7))) & 1;
      // (1,2) above (2,1) by the margin for a 1, below it for a 0; the pair is moved apart evenly, and only as far as it must
      const diff = coef(y, w, x0, y0, BASIS[0]!) - coef(y, w, x0, y0, BASIS[1]!);
      const want = bit ? step : -step;
      if (bit ? diff >= want : diff <= want) continue;
      const t = (want - diff) / 2;
      const delta = new Float64Array(64);
      for (let k = 0; k < 64; k++) delta[k] = t * (BASIS[0]![k]! - BASIS[1]![k]!);
      // (the same change on red, green and blue changes the brightness by it and leaves the colour)
      for (let k = 0; k < 64; k++) {
        const i = ((y0 + (k >> 3)) * w + x0 + (k & 7)) * 4;
        if (d[i + 3] === 0) continue;
        for (let ch = 0; ch < 3; ch++) {
          const before = d[i + ch]!;
          d[i + ch] = before + delta[k]!;
          sq += (d[i + ch]! - before) ** 2;
        }
      }
    }
  }
  const mse = sq / (p.width * p.height * 3);
  return mse > 0 ? 10 * Math.log10((255 * 255) / mse) : Infinity;
}

// ---- reading ----------------------------------------------------------------------------------------------------------------------------

/** A frame found in a picture: its bytes (still encrypted), its kind, and how sure (the share of its bits all copies agree on, 0.5 to 1). */
export interface FoundFrame extends Frame {
  readonly kind: MarkContent["kind"];
  readonly agree: number;
}


/**
 * The 8-pixel grid offsets most likely to be the mark's, best first. On the mark's grid, blocks a whole tile apart carry the same bit, so
 * their votes agree: for each offset and tile size, the markedness of the blocks of a central window (how well each agrees with the blocks a
 * tile away) is taken, and its best tenth says how well the copies agree there. That needs no tile start.
 */
function gridOffsets(y: Float32Array, w: number, h: number): Array<{ ox: number; oy: number }> {
  const span = Math.min(GRID_WINDOW, Math.floor((w - 7) / 8)), spanY = Math.min(GRID_WINDOW, Math.floor((h - 7) / 8));
  // (the window starts on a multiple of 8, so an offset found in it is one of the whole picture)
  const x0 = Math.max(0, Math.floor((w - span * 8 - 8) / 16) * 8), y0 = Math.max(0, Math.floor((h - spanY * 8 - 8) / 16) * 8);
  const scored: Array<{ ox: number; oy: number; agree: number }> = [];
  const softs = new Float32Array(span * spanY);
  for (let oy = 0; oy < 8; oy++) {
    for (let ox = 0; ox < 8; ox++) {
      let n = 0;
      for (let by = 0; by < spanY; by++) for (let bx = 0; bx < span; bx++) {
        const px = x0 + ox + bx * 8, py = y0 + oy + by * 8;
        softs[by * span + bx] = px + 8 <= w && py + 8 <= h ? soft(coef(y, w, px, py, BASIS[0]!) - coef(y, w, px, py, BASIS[1]!)) : 0;
        n++;
      }
      // (the best tenth of the map: a mark in only a part of the window stands out as much as one over all of it)
      let agree = -Infinity;
      for (const T of new Set(FRAMES.map((f) => f.tile))) {
        const m = markedness(softs, span, spanY, T).sort();
        const top = m.subarray(Math.floor(m.length * 0.9));
        agree = Math.max(agree, top.reduce((a, b) => a + b, 0) / Math.max(1, top.length));
      }
      if (n) scored.push({ ox, oy, agree });
    }
  }
  return scored.sort((a, b) => b.agree - a.agree).slice(0, GRID_TRIES);
}

/** The window the grid is found in, in blocks a side (512 pixels). */
const GRID_WINDOW = 64;
/** How many of the likeliest grid offsets are read in full. */
const GRID_TRIES = 3;

/** Look for a frame in `p` as it is (the caller turns and scales it to try more). Null: none found. */
export function findFrame(p: Pixels): FoundFrame | null {
  const y = lumaOf(p);
  const w = p.width, h = p.height;
  if (w < 16 || h < 16) return null;
  for (const g of gridOffsets(y, w, h)) {
    const found = framesAt(y, w, h, g.ox, g.oy);
    if (found) return found;
  }
  return null;
}

function framesAt(y: Float32Array, w: number, h: number, ox: number, oy: number): FoundFrame | null {
  const nx = Math.floor((w - ox) / 8), ny = Math.floor((h - oy) / 8);
  const softs = new Float32Array(nx * ny);
  for (let by = 0; by < ny; by++) for (let bx = 0; bx < nx; bx++) {
    const x0 = ox + bx * 8, y0 = oy + by * 8;
    softs[by * nx + bx] = soft(coef(y, w, x0, y0, BASIS[0]!) - coef(y, w, x0, y0, BASIS[1]!));
  }
  let best: FoundFrame | null = null;
  for (const [cls, f] of FRAMES.entries()) {
    const T = f.tile, bits = frameBits(f);
    if (nx * ny < bits) continue; // (too small to hold one frame)
    const order = tileOrder(T, bits);
    // Each block's vote counted by how marked it looks (a mark in a part of the picture); then, if that finds nothing, every vote alike (a
    // small picture marked all over holds too few copies for the map).
    for (const weight of [markedness(softs, nx, ny, T).map(weightOf), null]) {
    // The blocks summed by their place in the tile (their block numbers modulo the tile): a tile start only renumbers these.
    const cell = new Float32Array(T * T);
    for (let by = 0; by < ny; by++) for (let bx = 0; bx < nx; bx++) cell[(by % T) * T + (bx % T)]! += softs[by * nx + bx]! * (weight ? weight[by * nx + bx]! : 1);
    const votes = new Float32Array(bits);
    const frame = new Uint8Array(bits / 8);
    for (let py = 0; py < T; py++) {
      for (let px = 0; px < T; px++) {
        votes.fill(0);
        for (let cy = 0; cy < T; cy++) {
          const ty = (cy - py + T) % T;
          for (let cx = 0; cx < T; cx++) votes[order[ty * T + ((cx - px + T) % T)]!]! += cell[cy * T + cx]!;
        }
        frame.fill(0);
        for (let j = 0; j < bits; j++) if (votes[j]! > 0) frame[j >> 3]! |= 1 << (7 - (j & 7));
        const fixed = rsDecode(frame, PARITY);
        if (!fixed || crc32(fixed.subarray(0, f.bytes)) !== new DataView(fixed.buffer).getUint32(f.bytes)) continue;
        const agree = agreement(softs, nx, ny, T, px, py, order, rsEncode(fixed, PARITY));
        if (!best || agree > best.agree) best = { frame: fixed, cls, kind: f.kind, agree };
      }
    }
    if (best) return best;
    }
  }
  return best;
}

/** The least size (pixels a side) of a part of a picture that holds `content` well enough to be found: two tiles each way. */
export function minPart(content: MarkContent): number {
  const t = content.kind === "text" ? new TextEncoder().encode(content.text).length : 0;
  const f = FRAMES.find((x) => x.kind === content.kind && (content.kind === "logo" || x.bytes - 3 >= t)) ?? FRAMES[FRAMES.length - 1]!;
  return 2 * f.tile * 8;
}

/**
 * How much each block looks marked (about 1 in a marked part, about 0 elsewhere). In a marked part, blocks a tile apart carry the same bit,
 * so their votes agree; elsewhere they are unrelated. The agreement with the four blocks a tile away, averaged over the blocks around (a few
 * blocks each way), makes a map that is high over the marked part, so a mark in only a part of the picture is not drowned by the rest.
 */
function markedness(softs: Float32Array, nx: number, ny: number, T: number): Float32Array {
  const agree = new Float32Array(nx * ny);
  for (let by = 0; by < ny; by++) for (let bx = 0; bx < nx; bx++) {
    let sum = 0, n = 0;
    for (const [dx, dy] of [[T, 0], [-T, 0], [0, T], [0, -T]] as const) {
      const x = bx + dx, y = by + dy;
      if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
      sum += softs[by * nx + bx]! * softs[y * nx + x]!;
      n++;
    }
    agree[by * nx + bx] = n ? sum / n : 0;
  }
  // the average over a square of blocks, from a summed table
  const R = MARKED_RADIUS, W = nx + 1;
  const table = new Float64Array(W * (ny + 1));
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) table[(y + 1) * W + x + 1] = agree[y * nx + x]! + table[y * W + x + 1]! + table[(y + 1) * W + x]! - table[y * W + x]!;
  const out = new Float32Array(nx * ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const x0 = Math.max(0, x - R), x1 = Math.min(nx, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(ny, y + R + 1);
    const avg = (table[y1 * W + x1]! - table[y0 * W + x1]! - table[y1 * W + x0]! + table[y0 * W + x0]!) / ((x1 - x0) * (y1 - y0));
    out[y * nx + x] = avg;
  }
  return out;
}

/** A block's weight from its markedness: nothing for the faint agreement of unmarked blocks, all of it from about half agreement up. */
const weightOf = (m: number): number => Math.max(0, Math.min(1, (m - 0.12) / 0.3));

/** How many blocks each way the markedness is averaged over. */
const MARKED_RADIUS = 3;

/** The share of blocks whose own bit agrees with the frame found (0.5: chance, 1: every one). */
function agreement(softs: Float32Array, nx: number, ny: number, T: number, px: number, py: number, order: Uint16Array, frame: Uint8Array): number {
  let yes = 0, n = 0;
  for (let by = 0; by < ny; by++) for (let bx = 0; bx < nx; bx++) {
    const s = softs[by * nx + bx]!;
    if (s === 0) continue;
    const j = order[((by - py + T * 64) % T) * T + ((bx - px + T * 64) % T)]!;
    const bit = (frame[j >> 3]! >> (7 - (j & 7))) & 1;
    if ((s > 0) === (bit === 1)) yes++;
    n++;
  }
  return n ? yes / n : 0;
}

// ---- logos ------------------------------------------------------------------------------------------------------------------------------

/** A picture's pixels as a 32 × 32 black and white logo (dark = 1), cut at its mean brightness. */
export function logoBits(p: Pixels): Uint8Array {
  const n = LOGO_SIDE;
  const v = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = Math.min(p.width - 1, Math.floor(((i + 0.5) * p.width) / n)), y = Math.min(p.height - 1, Math.floor(((j + 0.5) * p.height) / n));
    const k = (y * p.width + x) * 4, a = p.data[k + 3]! / 255;
    v[j * n + i] = 255 - a * (255 - (0.299 * p.data[k]! + 0.587 * p.data[k + 1]! + 0.114 * p.data[k + 2]!)); // (transparent counts as white)
  }
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const out = new Uint8Array((n * n) / 8);
  for (let i = 0; i < n * n; i++) if (v[i]! < mean) out[i >> 3]! |= 1 << (7 - (i & 7));
  return out;
}
