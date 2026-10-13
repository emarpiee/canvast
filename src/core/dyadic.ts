/**
 * Exact dyadic rationals: value = m * 2^e, with an arbitrary-size integer
 * mantissa `m` and a small integer exponent `e`.
 *
 * Every IEEE-754 double is a dyadic rational, so conversion from Number is
 * exact. Addition, subtraction and multiplication by powers of two are exact.
 * This is the authoritative representation for world coordinates: it never
 * loses precision when the camera is far from the origin or deeply zoomed.
 *
 * Values are kept canonical (odd mantissa, or m = 0 with e = 0) so that
 * equality and serialization are representation-independent.
 */
export interface Dyadic {
  readonly m: bigint;
  readonly e: number;
}

export const ZERO: Dyadic = Object.freeze({ m: 0n, e: 0 });

/** log10(2), for decimal display of binary magnitudes. */
export const LOG10_2 = Math.LN2 / Math.LN10;

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
// Little-endian is universal on browser targets; verify once at startup.
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const HI = LITTLE_ENDIAN ? 1 : 0;
const LO = LITTLE_ENDIAN ? 0 : 1;

function make(m: bigint, e: number): Dyadic {
  return normalize(m, e);
}

/** Strip trailing zero bits so every value has exactly one representation. */
function normalize(m: bigint, e: number): Dyadic {
  if (m === 0n) return ZERO;
  let tz = trailingZeros(m);
  if (tz > 0) {
    m >>= BigInt(tz);
    e += tz;
  }
  return { m, e };
}

function trailingZeros(m: bigint): number {
  if (m < 0n) m = -m;
  let tz = 0;
  // Peel 32-bit words first; mantissas can be thousands of bits long.
  while ((m & 0xffffffffn) === 0n) {
    m >>= 32n;
    tz += 32;
  }
  let low = Number(m & 0xffffffffn);
  while ((low & 1) === 0) {
    low >>>= 1;
    tz++;
  }
  return tz;
}

/** Number of bits in |m| (0 for m = 0). */
export function bitLength(m: bigint): number {
  if (m < 0n) m = -m;
  if (m === 0n) return 0;
  const hex = m.toString(16);
  return (hex.length - 1) * 4 + (32 - Math.clz32(parseInt(hex[0]!, 16)));
}

/** Exact conversion from a finite double. Throws on NaN or ±Infinity. */
export function fromNumber(x: number): Dyadic {
  if (!Number.isFinite(x)) throw new RangeError(`non-finite coordinate: ${x}`);
  if (x === 0) return ZERO;
  f64[0] = x;
  const hi = u32[HI]!;
  const lo = u32[LO]!;
  const sign = hi >>> 31 ? -1n : 1n;
  const biased = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (biased === 0) {
    e = -1074; // subnormal
  } else {
    mant |= 1n << 52n;
    e = biased - 1075;
  }
  return make(sign * mant, e);
}

export function fromBigInt(n: bigint, e = 0): Dyadic {
  return make(n, e);
}

/** Multiply by 2^k (exact). */
export function shift(a: Dyadic, k: number): Dyadic {
  if (a.m === 0n) return ZERO;
  return { m: a.m, e: a.e + k };
}

export function neg(a: Dyadic): Dyadic {
  return a.m === 0n ? ZERO : { m: -a.m, e: a.e };
}

export function add(a: Dyadic, b: Dyadic): Dyadic {
  if (a.m === 0n) return b;
  if (b.m === 0n) return a;
  if (a.e === b.e) return make(a.m + b.m, a.e);
  if (a.e < b.e) return make(a.m + (b.m << BigInt(b.e - a.e)), a.e);
  return make((a.m << BigInt(a.e - b.e)) + b.m, b.e);
}

export function sub(a: Dyadic, b: Dyadic): Dyadic {
  return add(a, neg(b));
}

/** Exact product. */
export function mul(a: Dyadic, b: Dyadic): Dyadic {
  if (a.m === 0n || b.m === 0n) return ZERO;
  return make(a.m * b.m, a.e + b.e);
}

/**
 * Double-double approximation: hi + lo ≈ a with about 106 significant bits.
 * Used to project local geometry around a far-away anchor without losing the
 * sub-pixel part. hi may be ±Infinity for values beyond the double range.
 */
export function toDD(a: Dyadic): { hi: number; lo: number } {
  const hi = toNumber(a);
  if (!Number.isFinite(hi) || hi === 0) return { hi, lo: 0 };
  return { hi, lo: toNumber(sub(a, fromNumber(hi))) };
}

export function sign(a: Dyadic): -1 | 0 | 1 {
  return a.m === 0n ? 0 : a.m < 0n ? -1 : 1;
}

export function cmp(a: Dyadic, b: Dyadic): -1 | 0 | 1 {
  return sign(sub(a, b));
}

export function equals(a: Dyadic, b: Dyadic): boolean {
  return a.m === b.m && a.e === b.e;
}

/** ldexp that never overflows in an intermediate step. */
function ldexp(x: number, e: number): number {
  if (x === 0) return 0;
  if (e > 2200) return x > 0 ? Infinity : -Infinity;
  if (e < -2200) return x > 0 ? 0 : -0;
  while (e > 1000) {
    x *= 2 ** 1000;
    e -= 1000;
  }
  while (e < -1000) {
    x *= 2 ** -1000;
    e += 1000;
  }
  return x * 2 ** e;
}

/**
 * log2|a| as a double (−Infinity for zero). Exact in the exponent at any
 * magnitude, so it never overflows the way toNumber does.
 */
export function log2Abs(a: Dyadic): number {
  if (a.m === 0n) return -Infinity;
  const m = a.m < 0n ? -a.m : a.m;
  const bl = bitLength(m);
  const drop = Math.max(0, bl - 64);
  return Math.log2(Number(m >> BigInt(drop))) + drop + a.e;
}

/**
 * Nearest double. Magnitudes beyond the double range become ±Infinity (callers
 * treat that as "far offscreen"); this never produces NaN.
 */
export function toNumber(a: Dyadic): number {
  if (a.m === 0n) return 0;
  let m = a.m;
  let e = a.e;
  const bl = bitLength(m);
  if (bl > 64) {
    // Keep 64 significant bits; Number() then rounds to 53. The extra bits
    // make the double rounding error far below one ulp of the result.
    const drop = bl - 64;
    m >>= BigInt(drop);
    e += drop;
  }
  return ldexp(Number(m), e);
}

/**
 * toNumber((a − b) · 2^k). When one operand is more than 2^128 times smaller
 * than the other, it cannot change the double result (relative effect below
 * 2^-127, so at most a different rounding in a tie), and the exact
 * difference is skipped. That difference would need a mantissa as long as
 * the exponent gap: 10 million bits for a landmark seen from 2^10,000,000.
 */
export function diffToNumber(a: Dyadic, b: Dyadic, k: number): number {
  const ta = a.m === 0n ? -Infinity : bitLength(a.m) + a.e;
  const tb = b.m === 0n ? -Infinity : bitLength(b.m) + b.e;
  if (ta > tb + 128) return toNumber(shift(a, k));
  if (tb > ta + 128) return -toNumber(shift(b, k));
  return toNumber(shift(sub(a, b), k));
}

/**
 * Round to the nearest multiple of 2^q, ties toward +∞ (floor(a/2^q + 1/2)).
 * The tie rule does not depend on where zero is, so rounding a position
 * measured from the origin or from any grid-aligned frame corner gives the
 * same point (nested frames, ADR 0014). Used to bound mantissa growth of
 * camera state and scaled anchors; the error is at most 2^(q-1).
 */
export function roundTo(a: Dyadic, q: number): Dyadic {
  if (a.m === 0n || a.e >= q) return a;
  const s = BigInt(q - a.e);
  // BigInt >> floors for negatives too.
  return make((a.m + (1n << (s - 1n))) >> s, q);
}

/** floor(a / 2^g) as an integer. */
export function floorDivPow2(a: Dyadic, g: number): bigint {
  if (a.m === 0n) return 0n;
  const k = a.e - g;
  if (k >= 0) return a.m << BigInt(k);
  // BigInt >> on negatives rounds toward -infinity, which is floor.
  return a.m >> BigInt(-k);
}

/** Serialize as "<mantissa>p<exponent>", e.g. "-3p-2" = -0.75. */
export function toString(a: Dyadic): string {
  return `${a.m}p${a.e}`;
}

const PATTERN = /^(-?\d+)p(-?\d+)$/;

export function parse(s: string): Dyadic {
  const match = PATTERN.exec(s);
  if (!match) throw new SyntaxError(`invalid dyadic: ${s}`);
  const e = Number(match[2]);
  if (!Number.isSafeInteger(e)) throw new RangeError(`dyadic exponent out of range: ${s}`);
  return make(BigInt(match[1]!), e);
}

/** Compact human-readable decimal approximation, for HUD display only. */
export function toDisplay(a: Dyadic, digits = 4): string {
  if (a.m === 0n) return "0";
  const n = toNumber(a);
  if (Number.isFinite(n) && n !== 0) {
    const abs = Math.abs(n);
    if (abs >= 1e-3 && abs < 1e6) return n.toPrecision(digits).replace(/\.?0+$/, "");
    return n.toExponential(digits - 1);
  }
  // Outside the double range: log10|a| = log10|m| + e*log10(2).
  const bl = bitLength(a.m);
  const top = bl > 64 ? Number(a.m >> BigInt(bl - 64)) : Number(a.m);
  const topE = bl > 64 ? a.e + bl - 64 : a.e;
  const log10 = Math.log10(Math.abs(top)) + topE * LOG10_2;
  const exp = Math.floor(log10);
  const mant = 10 ** (log10 - exp);
  return `${top < 0 ? "-" : ""}${mant.toFixed(digits - 1)}e${exp}`;
}
