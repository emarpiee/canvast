/**
 * What an image looks like, from its small stored thumbnail (ADR 0114): the colour that fills most of it (for the colour filter) and a
 * 64-bit difference hash (for finding near-duplicates). Pure, over a square RGBA grid the caller drew the thumbnail into.
 */
export interface Look {
  /** The dominant colour, 0..255 each. */
  readonly colour: readonly [number, number, number];
  /** 64 bits as 16 hex digits: for each of 8 rows of 9 cells, whether a cell is brighter than the one to its right. */
  readonly dhash: string;
}

/** The side of the grid `lookOf` reads. */
export const LOOK_SIZE = 32;

export function lookOf(rgba: ArrayLike<number>, size = LOOK_SIZE): Look {
  // Dominant colour: the busiest cell of a 4x4x4 colour grid among the opaque pixels, averaged over its pixels.
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  const gray = new Float64Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const r = rgba[i * 4]!, g = rgba[i * 4 + 1]!, b = rgba[i * 4 + 2]!, a = rgba[i * 4 + 3]! / 255;
    // (a see-through pixel counts as the white page behind it)
    const R = r * a + 255 * (1 - a), G = g * a + 255 * (1 - a), B = b * a + 255 * (1 - a);
    gray[i] = 0.299 * R + 0.587 * G + 0.114 * B;
    if (a < 0.5) continue;
    const k = ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6);
    const e = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    bins.set(k, e);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const e of bins.values()) if (!best || e.n > best.n) best = e;
  const colour: [number, number, number] = best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : [255, 255, 255];
  // Difference hash: the grid reduced to 9 columns by 8 rows of mean brightness.
  const cols = 9, rows = 8;
  const cell = new Float64Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const x0 = Math.floor((x * size) / cols), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * size) / cols));
      const y0 = Math.floor((y * size) / rows), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * size) / rows));
      let sum = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) (sum += gray[yy * size + xx]!), n++;
      cell[y * cols + x] = sum / n;
    }
  }
  let hex = "";
  for (let y = 0; y < rows; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (cell[y * cols + x]! > cell[y * cols + x + 1]! ? 1 : 0);
    hex += byte.toString(16).padStart(2, "0");
  }
  return { colour, dhash: hex };
}

/** How many of the 64 bits differ. */
export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) (d += x & 1), (x >>= 1);
  }
  return d;
}

/** Two pictures this near count as the same picture seen differently (resized, recompressed, lightly edited). */
export const SIMILAR_BITS = 6;

export const COLOUR_NAMES = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "brown", "black", "white", "grey"] as const;
export type ColourName = (typeof COLOUR_NAMES)[number];

/** The name of a colour (the nearest of twelve words people use). */
export function colourName([r, g, b]: readonly [number, number, number]): ColourName {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l < 0.12) return "black";
  if (l > 0.92 && s < 0.5) return "white";
  if (s < 0.14) return l > 0.82 ? "white" : l < 0.18 ? "black" : "grey";
  let h = d === 0 ? 0 : max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h >= 15 && h < 45 && l < 0.4 && s > 0.25) return "brown";
  if (h < 15 || h >= 345) return l > 0.7 && s < 0.9 ? "pink" : "red";
  if (h < 45) return "orange";
  if (h < 70) return "yellow";
  if (h < 170) return "green";
  if (h < 200) return "cyan";
  if (h < 260) return "blue";
  if (h < 300) return "purple";
  return "pink";
}

/** Whether a colour matches a word (`red`) or a hex colour (`#2563eb`, near it). */
export function colourMatches(c: readonly [number, number, number], want: string): boolean {
  const w = want.toLowerCase().replace(/^colou?r:/, "");
  if (/^#[0-9a-f]{6}$/.test(w)) {
    const t = [1, 3, 5].map((i) => parseInt(w.slice(i, i + 2), 16));
    return Math.hypot(c[0] - t[0]!, c[1] - t[1]!, c[2] - t[2]!) <= 70;
  }
  const names: readonly string[] = COLOUR_NAMES;
  return names.includes(w) && colourName(c) === w;
}

/**
 * Groups of pictures that look alike (hashes within SIMILAR_BITS of each other, or a chain of them), each of two or more, biggest first.
 * Hashes are cut into SIMILAR_BITS+1 pieces: two that differ in at most SIMILAR_BITS bits share a whole piece, so only pictures sharing a piece are compared.
 */
export function similarGroups(items: ReadonlyArray<{ id: string; dhash: string }>): string[][] {
  const pieces = SIMILAR_BITS + 1;
  const bitsOf = (hex: string): string => [...hex].map((c) => parseInt(c, 16).toString(2).padStart(4, "0")).join("");
  const bits = items.map((it) => bitsOf(it.dhash));
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const buckets = new Map<string, number[]>();
  const width = Math.ceil(64 / pieces);
  bits.forEach((b, i) => {
    for (let p = 0; p < pieces; p++) {
      const key = `${p}:${b.slice(p * width, (p + 1) * width)}`;
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(i);
    }
  });
  for (const list of buckets.values()) {
    if (list.length < 2 || list.length > 400) continue; // (a piece nearly every picture shares, a plain background, says nothing)
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const i = list[a]!, j = list[b]!;
        if (find(i) !== find(j) && hamming(items[i]!.dhash, items[j]!.dhash) <= SIMILAR_BITS) parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, string[]>();
  items.forEach((it, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(it.id));
  return [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length);
}
