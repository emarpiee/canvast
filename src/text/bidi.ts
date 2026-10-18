/**
 * Text that runs both ways (ADR 0132): the order the letters of a line are set in when it has Hebrew or Arabic among Latin text and numbers
 * (Unicode's bidirectional algorithm, UAX 9, without the explicit embeddings and isolates), the mirrored forms of brackets in right-to-left
 * runs, and which Arabic letters join to their neighbours (so the font's contextual forms can be used). Layout keeps the letters in the
 * order they are typed; only when a line is set are they put in the order they are read.
 */
type Cls = "L" | "R" | "AL" | "EN" | "AN" | "ES" | "ET" | "CS" | "NSM" | "BN" | "WS" | "ON";

const inRanges = (cp: number, ranges: ReadonlyArray<readonly [number, number]>): boolean => ranges.some(([a, b]) => cp >= a && cp <= b);

const HEBREW: ReadonlyArray<readonly [number, number]> = [[0x590, 0x5ff], [0x7c0, 0x85f], [0xfb1d, 0xfb4f], [0x10800, 0x10fff], [0x1e800, 0x1efff]];
const ARABIC: ReadonlyArray<readonly [number, number]> = [[0x600, 0x6ff], [0x700, 0x7bf], [0x750, 0x77f], [0x860, 0x8ff], [0xfb50, 0xfdff], [0xfe70, 0xfeff]];
const MARKS: ReadonlyArray<readonly [number, number]> = [[0x300, 0x36f], [0x483, 0x489], [0x591, 0x5bd], [0x5bf, 0x5bf], [0x5c1, 0x5c2], [0x5c4, 0x5c5], [0x5c7, 0x5c7], [0x610, 0x61a], [0x64b, 0x65f], [0x670, 0x670], [0x6d6, 0x6dc], [0x6df, 0x6e4], [0x6e7, 0x6e8], [0x6ea, 0x6ed], [0x8d3, 0x8ff], [0x20d0, 0x20ff], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f]];

function classOf(cp: number): Cls {
  if (cp === 0x20 || cp === 0x09 || cp === 0xa0 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x3000) return "WS";
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return "BN";
  if (cp === 0x200e) return "L";
  if (cp === 0x200f) return "R";
  if (cp === 0x200b || cp === 0x200c || cp === 0x200d) return "BN";
  if ((cp >= 0x30 && cp <= 0x39) || (cp >= 0x6f0 && cp <= 0x6f9) || cp === 0xb2 || cp === 0xb3 || cp === 0xb9) return "EN";
  if ((cp >= 0x660 && cp <= 0x669) || cp === 0x66b || cp === 0x66c) return "AN";
  if (cp === 0x2b || cp === 0x2d || cp === 0x207a || cp === 0x207b || cp === 0x2212) return "ES";
  if (cp === 0x23 || cp === 0x24 || cp === 0x25 || cp === 0xa2 || cp === 0xa3 || cp === 0xa4 || cp === 0xa5 || cp === 0xb0 || cp === 0xb1 || cp === 0x2030 || cp === 0x2031 || cp === 0x20a0 || (cp >= 0x20a0 && cp <= 0x20cf)) return "ET";
  if (cp === 0x2c || cp === 0x2e || cp === 0x2f || cp === 0x3a || cp === 0xa0 || cp === 0x60c || cp === 0x202f || cp === 0x2044) return "CS";
  if (inRanges(cp, MARKS)) return "NSM";
  if (inRanges(cp, ARABIC)) return /\p{L}/u.test(String.fromCodePoint(cp)) || cp === 0x640 ? "AL" : "ON";
  if (inRanges(cp, HEBREW)) return /\p{L}/u.test(String.fromCodePoint(cp)) ? "R" : "ON";
  return /\p{L}|\p{N}/u.test(String.fromCodePoint(cp)) ? "L" : "ON";
}

/** Whether any of these characters runs right to left (so layout has anything to do). */
export const hasRtl = (cps: readonly number[]): boolean => cps.some((c) => c >= 0x590 && (inRanges(c, HEBREW) || inRanges(c, ARABIC) || c === 0x200f));

/**
 * The embedding level of every character of a paragraph (0 for left to right text, 1 for right to left, 2 for numbers inside it), and the
 * level of the paragraph, which is the direction of its first strong letter (0 when it has none).
 */
export function bidiLevels(cps: readonly number[]): { levels: Uint8Array; paragraph: 0 | 1 } {
  const n = cps.length;
  const t: Cls[] = cps.map(classOf);
  let paragraph: 0 | 1 = 0;
  for (const c of t) {
    if (c === "L") break;
    if (c === "R" || c === "AL") {
      paragraph = 1;
      break;
    }
  }
  const sor: Cls = paragraph === 1 ? "R" : "L";
  // W1 marks take the class of the letter before them; W2 numbers after an Arabic letter are Arabic numbers; W3 AL becomes R
  let prevStrong: Cls = sor;
  for (let i = 0; i < n; i++) {
    if (t[i] === "NSM") t[i] = i === 0 ? sor : t[i - 1] === "BN" ? "ON" : t[i - 1]!;
    if (t[i] === "L" || t[i] === "R" || t[i] === "AL") prevStrong = t[i]!;
    else if (t[i] === "EN" && prevStrong === "AL") t[i] = "AN";
  }
  for (let i = 0; i < n; i++) if (t[i] === "AL") t[i] = "R";
  // W4 a single separator between two numbers of one kind; W5 terminators next to European numbers; W6 the rest are neutral
  for (let i = 1; i < n - 1; i++) {
    if (t[i] === "ES" && t[i - 1] === "EN" && t[i + 1] === "EN") t[i] = "EN";
    else if (t[i] === "CS" && (t[i - 1] === "EN" || t[i - 1] === "AN") && t[i + 1] === t[i - 1]) t[i] = t[i - 1]!;
  }
  for (let i = 0; i < n; i++) {
    if (t[i] !== "ET") continue;
    let a = i;
    while (a < n && t[a] === "ET") a++;
    const next = a < n ? t[a] : undefined;
    const before = i > 0 ? t[i - 1] : undefined;
    if (before === "EN" || next === "EN") for (let k = i; k < a; k++) t[k] = "EN";
    i = a - 1;
  }
  for (let i = 0; i < n; i++) if (t[i] === "ES" || t[i] === "ET" || t[i] === "CS") t[i] = "ON";
  // W7 European numbers after a left to right letter are left to right
  prevStrong = sor;
  for (let i = 0; i < n; i++) {
    if (t[i] === "L" || t[i] === "R") prevStrong = t[i]!;
    else if (t[i] === "EN" && prevStrong === "L") t[i] = "L";
  }
  // N1 and N2 neutrals between two letters of one direction take it (numbers count as right to left); else the paragraph's
  const dir = (c: Cls | undefined): "L" | "R" | null => (c === "L" ? "L" : c === "R" || c === "EN" || c === "AN" ? "R" : null);
  const neutral = (c: Cls): boolean => c === "WS" || c === "ON" || c === "BN";
  for (let i = 0; i < n; i++) {
    if (!neutral(t[i]!)) continue;
    let a = i;
    while (a < n && neutral(t[a]!)) a++;
    const before = i === 0 ? sor : dir(t[i - 1]);
    const after = a === n ? sor : dir(t[a]);
    const d = before !== null && before === after ? before : paragraph === 1 ? "R" : "L";
    for (let k = i; k < a; k++) t[k] = d;
    i = a - 1;
  }
  // I1 and I2: in left to right text a right to left letter is one level up and a number two; in right to left text all but R are two up
  const levels = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const c = t[i]!;
    levels[i] = paragraph === 0 ? (c === "R" ? 1 : c === "EN" || c === "AN" ? 2 : 0) : c === "R" ? 1 : 2;
  }
  return { levels, paragraph };
}

/** The indices `from` to `to` (exclusive) in the order they are drawn, left to right (UAX 9 rule L2). */
export function visualOrder(levels: ArrayLike<number>, from: number, to: number): number[] {
  const idx = Array.from({ length: to - from }, (_, i) => from + i);
  let max = 0, minOdd = 99;
  for (let i = from; i < to; i++) {
    max = Math.max(max, levels[i]!);
    if (levels[i]! & 1) minOdd = Math.min(minOdd, levels[i]!);
  }
  for (let lvl = max; lvl >= minOdd && lvl > 0; lvl--) {
    for (let i = 0; i < idx.length; ) {
      if (levels[idx[i]!]! < lvl) {
        i++;
        continue;
      }
      let j = i;
      while (j < idx.length && levels[idx[j]!]! >= lvl) j++;
      const part = idx.slice(i, j).reverse();
      for (let k = 0; k < part.length; k++) idx[i + k] = part[k]!;
      i = j;
    }
  }
  return idx;
}

const PAIRS = ["()", "[]", "{}", "<>", "«»", "‹›", "⟨⟩", "⟦⟧", "⁅⁆", "⌈⌉", "⌊⌋"];
const MIRROR = new Map<number, number>();
for (const p of PAIRS) {
  const [a, b] = [p.codePointAt(0)!, p.codePointAt(1)!];
  MIRROR.set(a, b);
  MIRROR.set(b, a);
}
/** The character drawn in place of `cp` inside right to left text (a bracket turns round), or null. */
export const mirrored = (cp: number): number | null => MIRROR.get(cp) ?? null;

// ---- Arabic joining ----------------------------------------------------------------------------------------------------------------

export type Joining = "D" | "R" | "T" | "U";
const RIGHT = new Set([0x622, 0x623, 0x624, 0x625, 0x627, 0x629, 0x62f, 0x630, 0x631, 0x632, 0x648, 0x671, 0x672, 0x673, 0x675, 0x676, 0x677, 0x6c0, 0x6d2, 0x6d3, 0x6d5, 0x6ee, 0x6ef]);

/** How an Arabic character joins: D (both sides), R (to the one before it only), T (a mark: ignored), U (not at all). */
export function joiningOf(cp: number): Joining {
  if (inRanges(cp, MARKS) && cp < 0x700) return "T";
  if (cp === 0x200d) return "D";
  if (cp === 0x640) return "D";
  if (!inRanges(cp, ARABIC) || !/\p{L}/u.test(String.fromCodePoint(cp))) return "U";
  if (RIGHT.has(cp) || (cp >= 0x688 && cp <= 0x699) || (cp >= 0x6c3 && cp <= 0x6cb) || cp === 0x6cd || cp === 0x6cf) return "R";
  if (cp >= 0x620 && cp <= 0x64a) return cp === 0x621 ? "U" : "D";
  if (cp >= 0x66e && cp <= 0x6d3) return "D";
  return cp >= 0x750 && cp <= 0x77f ? (cp === 0x76a || (cp >= 0x759 && cp <= 0x75b) || cp === 0x771 || cp === 0x773 || cp === 0x774 ? "R" : "D") : "U";
}

export type Form = "isol" | "init" | "medi" | "fina";

/** The form each letter of a run takes from its neighbours (null for a letter that does not join at all). */
export function arabicForms(cps: readonly number[]): Array<Form | null> {
  const j = cps.map(joiningOf);
  const out: Array<Form | null> = cps.map(() => null);
  for (let i = 0; i < cps.length; i++) {
    if (j[i] === "U" || j[i] === "T") continue;
    let p = i - 1;
    while (p >= 0 && j[p] === "T") p--;
    let nx = i + 1;
    while (nx < cps.length && j[nx] === "T") nx++;
    const joinsBefore = p >= 0 && j[p] === "D";
    const joinsAfter = j[i] === "D" && nx < cps.length && (j[nx] === "D" || j[nx] === "R");
    out[i] = joinsBefore ? (joinsAfter ? "medi" : "fina") : joinsAfter ? "init" : "isol";
  }
  return out;
}
