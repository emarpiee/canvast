/**
 * Sizes from shapes (ADR 0147). A sheet, a picture or a vector has a shape, its aspect ratio (width ÷ height), and no size of its own: the
 * size is chosen when it leaves the canvas, and every length is worked out from the ratio and one number. Pure functions: parsing and
 * showing a ratio, converting px, inches, centimetres and millimetres at a resolution, and the sizes worth suggesting for a ratio.
 */
export type Unit = "px" | "in" | "cm" | "mm";
export const UNITS: readonly Unit[] = ["px", "in", "cm", "mm"];
/** Resolutions (pixels per inch): the screen's 72 and 96, then print. */
export const DPIS: readonly number[] = [72, 96, 150, 300, 600];
/** The most pixels a picture may have on a side, and in all (browsers refuse bigger canvases). */
export const MAX_SIDE = 16384;
export const MAX_AREA = 120_000_000;

const PER_INCH: Record<Unit, number> = { px: 0, in: 1, cm: 2.54, mm: 25.4 };

/** px → length in `unit` at `dpi` pixels per inch. */
export const fromPx = (px: number, unit: Unit, dpi: number): number => (unit === "px" ? px : (px / dpi) * PER_INCH[unit]);
/** A length in `unit` → px at `dpi` pixels per inch. */
export const toPx = (v: number, unit: Unit, dpi: number): number => (unit === "px" ? v : (v / PER_INCH[unit]) * dpi);

/** Named shapes, as width ÷ height in landscape or square (the swap button turns any of them upright). */
export interface RatioPreset {
  readonly id: string;
  readonly label: string;
  /** The name alone, without the numbers. */
  readonly short: string;
  readonly ratio: number;
  readonly group: "Basic" | "Screen" | "Paper" | "Social";
}
export const RATIO_PRESETS: readonly RatioPreset[] = [
  { id: "1:1", short: "Square", label: "Square 1 : 1", ratio: 1, group: "Basic" },
  { id: "5:4", short: "Frame", label: "5 : 4", ratio: 5 / 4, group: "Basic" },
  { id: "4:3", short: "Classic", label: "Classic 4 : 3", ratio: 4 / 3, group: "Basic" },
  { id: "3:2", short: "Photo", label: "Photo 3 : 2", ratio: 3 / 2, group: "Basic" },
  { id: "golden", short: "Golden", label: "Golden 1.618 : 1", ratio: (1 + Math.sqrt(5)) / 2, group: "Basic" },
  { id: "2:1", short: "Wide", label: "Wide 2 : 1", ratio: 2, group: "Basic" },
  { id: "16:10", short: "Laptop", label: "Laptop 16 : 10", ratio: 16 / 10, group: "Screen" },
  { id: "16:9", short: "Video", label: "Video 16 : 9", ratio: 16 / 9, group: "Screen" },
  { id: "21:9", short: "Ultrawide", label: "Ultrawide 21 : 9", ratio: 21 / 9, group: "Screen" },
  { id: "a", short: "A paper", label: "A paper (A4, A3 …) 1.414 : 1", ratio: Math.SQRT2, group: "Paper" },
  { id: "letter", short: "US Letter", label: "US Letter 11 : 8.5", ratio: 11 / 8.5, group: "Paper" },
  { id: "legal", short: "US Legal", label: "US Legal 14 : 8.5", ratio: 14 / 8.5, group: "Paper" },
  { id: "photo-print", short: "Print", label: "Print 7 : 5", ratio: 7 / 5, group: "Paper" },
  { id: "4:5", short: "Portrait post", label: "Portrait post 5 : 4", ratio: 5 / 4, group: "Social" },
  { id: "link", short: "Link preview", label: "Link preview 1.91 : 1", ratio: 1200 / 630, group: "Social" },
  { id: "banner", short: "Banner", label: "Banner 3 : 1", ratio: 3, group: "Social" },
];

/** A ratio from what was typed: "16:9", "16/9", "16 x 9", "1.5", "A4", "letter", "square", "3:2 portrait", a size "2000x1920px" or
 * "2000 px x 1920 px" (px after a number is left out). null when it is not one. */
export function parseRatio(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/(\d)\s*px\b/g, "$1").replace(/[×x*÷]/g, ":").replace(/\s+/g, " ");
  if (!t) return null;
  const portrait = /\bportrait\b/.test(t);
  const landscape = /\blandscape\b/.test(t);
  const core = t.replace(/\b(portrait|landscape)\b/g, "").trim();
  let r: number | null = null;
  const pair = /^(\d+(?:[.,]\d+)?)\s*[:/]\s*(\d+(?:[.,]\d+)?)$/.exec(core.replace(/\s*([:/])\s*/g, "$1"));
  if (pair) {
    const a = Number(pair[1]!.replace(",", ".")), b = Number(pair[2]!.replace(",", "."));
    r = b > 0 ? a / b : null;
  } else if (/^\d+(?:[.,]\d+)?$/.test(core)) r = Number(core.replace(",", "."));
  else if (/^(a|b)\d{1,2}$/.test(core) || core === "paper") r = Math.SQRT2;
  else if (core === "letter" || core === "us letter") r = 11 / 8.5;
  else if (core === "legal") r = 14 / 8.5;
  else if (core === "square") r = 1;
  else if (core === "golden") r = (1 + Math.sqrt(5)) / 2;
  else if (core === "hd" || core === "video" || core === "wide") r = 16 / 9;
  if (r === null || !Number.isFinite(r) || r <= 0 || r > 100 || r < 0.01) return null;
  if (portrait && r > 1) r = 1 / r;
  if (landscape && r < 1) r = 1 / r;
  return r;
}

/**
 * A ratio as short words: "16 : 9" when it is a small whole-number ratio (or exactly a larger one, as sizes typed in px give: 2000 × 1920 is
 * "25 : 24"), else "1 : 1.414" (the longer side as 1.000 to the shorter side).
 */
export function formatRatio(r: number): string {
  if (!(r > 0) || !Number.isFinite(r)) return "";
  const long = Math.max(r, 1 / r);
  for (let d = 1; d <= 100; d++) {
    const n = Math.round(long * d);
    // (up to 20 a near match will do; past it only an exact one, so a shape dragged to any width keeps its decimals)
    if (n >= 1 && Math.abs(n / d - long) / long < (d <= 20 ? 0.0005 : 1e-7)) {
      const [a, b] = reduce(n, d);
      return r >= 1 ? `${a} : ${b}` : `${b} : ${a}`;
    }
  }
  const t = Number(long.toFixed(3));
  return r >= 1 ? `${t} : 1` : `1 : ${t}`;
}

function reduce(a: number, b: number): [number, number] {
  const g = (x: number, y: number): number => (y ? g(y, x % y) : x);
  const d = g(a, b);
  return [a / d, b / d];
}

/** The ratio of a preset that `r` equals (within half a percent, either way up), for showing "Video 16 : 9" in the list. */
export function presetOf(r: number): RatioPreset | null {
  const long = Math.max(r, 1 / r);
  return RATIO_PRESETS.find((p) => Math.abs(p.ratio - long) / p.ratio < 0.005) ?? null;
}

/** The height for a width at a ratio, and the other way (rounded to whole px only by the caller). */
export const heightFor = (w: number, ratio: number): number => w / ratio;
export const widthFor = (h: number, ratio: number): number => h * ratio;

/** A size clamped to what a picture may be, keeping the ratio; `capped` says whether it was. */
export function clampSize(w: number, h: number): { w: number; h: number; capped: boolean } {
  let k = 1;
  if (w > MAX_SIDE) k = Math.min(k, MAX_SIDE / w);
  if (h > MAX_SIDE) k = Math.min(k, MAX_SIDE / h);
  if (w * h * k * k > MAX_AREA) k = Math.min(k, Math.sqrt(MAX_AREA / (w * h)));
  const round = k < 1 ? Math.floor : Math.round; // (floored when capped, so rounding never goes over a limit)
  const rw = Math.max(1, round(w * k)), rh = Math.max(1, round(h * k));
  return { w: rw, h: rh, capped: k < 1 };
}

export interface Suggestion {
  readonly label: string;
  /** Pixels. */
  readonly w: number;
  readonly h: number;
  /** The resolution it asks for (print sizes), or null. */
  readonly dpi: number | null;
  /** Said as an exact fit: the ratio is the one this size is made for. */
  readonly exact: boolean;
}

/** Real paper and print sizes, in millimetres (the shorter side first), at the 300 ppi print sizes are asked at. */
const PAPERS: ReadonlyArray<{ label: string; w: number; h: number; unit: "mm" | "in" }> = [
  { label: "A4", w: 210, h: 297, unit: "mm" },
  { label: "A3", w: 297, h: 420, unit: "mm" },
  { label: "A5", w: 148, h: 210, unit: "mm" },
  { label: "A6", w: 105, h: 148, unit: "mm" },
  { label: "US Letter", w: 8.5, h: 11, unit: "in" },
  { label: "US Legal", w: 8.5, h: 14, unit: "in" },
  { label: "Photo 4 × 6 in", w: 4, h: 6, unit: "in" },
  { label: "Photo 5 × 7 in", w: 5, h: 7, unit: "in" },
  { label: "Photo 8 × 10 in", w: 8, h: 10, unit: "in" },
  { label: "Square 8 × 8 in", w: 8, h: 8, unit: "in" },
];
/** Screens and posts: the pixels they ask for, the shorter side first. */
const SCREENS: ReadonlyArray<{ label: string; w: number; h: number; upright?: true }> = [
  { label: "Instagram square", w: 1080, h: 1080 },
  { label: "Instagram portrait", w: 1080, h: 1350, upright: true },
  { label: "Story", w: 1080, h: 1920, upright: true },
  { label: "HD 720p", w: 720, h: 1280 },
  { label: "Full HD", w: 1080, h: 1920 },
  { label: "4K", w: 2160, h: 3840 },
  { label: "Link preview", w: 630, h: 1200 },
  { label: "Banner", w: 500, h: 1500 },
];

/**
 * The sizes worth offering for a ratio: the real formats that have this exact shape first (A4, a story, Full HD …, each at the size it asks
 * for), then the widths everyone reaches for (640, 1080, 1920, 3840 px) and print widths at 300 ppi (4, 6, 8, 12 in), each with the
 * height that keeps the ratio. Never more than `max`, and never one past what a picture may be.
 */
export function sizeSuggestions(ratio: number, max = 8): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const add = (s: Suggestion): void => {
    const c = clampSize(s.w, s.h);
    if (c.capped) return;
    const key = `${c.w}x${c.h}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...s, w: c.w, h: c.h });
  };
  const near = (a: number, b: number): boolean => Math.abs(a - b) / b < 0.01;
  const upright = ratio < 1;
  const long = Math.max(ratio, 1 / ratio);
  for (const s of SCREENS) {
    if (!near(long, s.h / s.w) || (s.upright && !upright)) continue;
    const [w, h] = upright ? [s.w, s.h] : [s.h, s.w];
    add({ label: s.label, w, h, dpi: null, exact: true });
  }
  for (const p of PAPERS) {
    const r = p.h / p.w;
    if (!near(long, r)) continue;
    const wpx = Math.round(toPx(p.w, p.unit, 300)), hpx = Math.round(toPx(p.h, p.unit, 300));
    const [w, h] = upright ? [wpx, hpx] : [hpx, wpx];
    add({ label: p.unit === "mm" ? `${p.label} · ${p.w} × ${p.h} mm` : p.label, w, h, dpi: 300, exact: true });
  }
  for (const wpx of [640, 1080, 1920, 3840]) add({ label: `${wpx} px wide`, w: wpx, h: Math.round(wpx / ratio), dpi: null, exact: false });
  for (const win of [4, 6, 8, 12]) add({ label: `${win} in wide · 300 ppi`, w: Math.round(win * 300), h: Math.round((win * 300) / ratio), dpi: 300, exact: false });
  return out.slice(0, max);
}
