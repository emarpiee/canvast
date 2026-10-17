/**
 * Search words that filter by what an image is (ADR 0114), beside `#tag` and `.png`: `width>1000`, `h<=1080`, `pixels>2mp`, `size<500kb`,
 * `ratio>1.5` or `ratio:16x9`, `orientation:portrait`, `colour:red` or `colour:#2563eb`. Size words compare pixel sizes and the file size;
 * a colour word needs the picture's look (read from its thumbnail), which may not be known yet.
 */
import type { Look } from "./look";
import { colourMatches } from "./look";

export interface Subject {
  readonly pixelW: number;
  readonly pixelH: number;
  readonly size: number;
}

export type Verdict = boolean | "unknown";

export interface Filter {
  /** The word needs the picture's look (colour). */
  readonly needsLook: boolean;
  test(s: Subject, look: Look | null | undefined): Verdict;
}

const OPS = [">=", "<=", ">", "<", "=", ":"] as const;
const compare = (a: number, op: (typeof OPS)[number], b: number): boolean => {
  const eps = Math.abs(b) * 1e-9;
  return op === ">" ? a > b : op === ">=" ? a >= b - eps : op === "<" ? a < b : op === "<=" ? a <= b + eps : Math.abs(a - b) <= Math.max(eps, 0.5);
};

const UNITS: Record<string, number> = { "": 1, k: 1e3, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, mp: 1e6, px: 1 };
const KEYS: Record<string, "w" | "h" | "pixels" | "size" | "ratio"> = { width: "w", w: "w", height: "h", h: "h", pixels: "pixels", px: "pixels", mp: "pixels", size: "size", bytes: "size", ratio: "ratio", aspect: "ratio" };

/** The filter a search word stands for, or null when it is an ordinary word. */
export function parseFilter(word: string): Filter | null {
  const w = word.toLowerCase();
  const orient = /^orientation:(landscape|portrait|square)$/.exec(w);
  if (orient) {
    const want = orient[1]!;
    return { needsLook: false, test: (s) => (want === "square" ? Math.abs(s.pixelW - s.pixelH) <= Math.max(1, 0.02 * Math.max(s.pixelW, s.pixelH)) : want === "landscape" ? s.pixelW > s.pixelH * 1.02 : s.pixelH > s.pixelW * 1.02) };
  }
  if (/^colou?r:/.test(w) && w.replace(/^colou?r:/, "")) {
    return { needsLook: true, test: (_s, look) => (look ? colourMatches(look.colour, w) : "unknown") };
  }
  const m = /^([a-z]+)(>=|<=|>|<|=|:)(.+)$/.exec(w);
  if (!m || !(m[1]! in KEYS)) return null;
  const key = KEYS[m[1]!]!;
  const op = m[2] as (typeof OPS)[number];
  const val = m[3]!;
  if (key === "ratio") {
    const r = /^(\d+(?:\.\d+)?)[x/:](\d+(?:\.\d+)?)$/.exec(val);
    const want = r ? Number(r[1]) / Number(r[2]) : Number(val);
    if (!(want > 0) || !Number.isFinite(want)) return null;
    // `:` is "about": within three percent
    return { needsLook: false, test: (s) => (op === ":" || op === "=" ? Math.abs(s.pixelW / s.pixelH - want) <= want * 0.03 : compare(s.pixelW / s.pixelH, op, want)) };
  }
  const n = /^(\d+(?:\.\d+)?)([a-z]*)$/.exec(val);
  if (!n || !(n[2]! in UNITS)) return null;
  const amount = Number(n[1]) * UNITS[n[2]!]!;
  const of = (s: Subject): number => (key === "w" ? s.pixelW : key === "h" ? s.pixelH : key === "pixels" ? s.pixelW * s.pixelH : s.size);
  return { needsLook: false, test: (s) => compare(of(s), op, amount) };
}
