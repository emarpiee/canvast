/**
 * Reed–Solomon codes over GF(256) (polynomial 0x11d, first root α^0): `rsEncode` appends `nsym` check bytes, `rsDecode` corrects up to
 * `nsym / 2` wrong bytes anywhere (null: more than that). Used by the invisible watermark (doc/invisible-mark.ts), whose bits come back
 * from a picture with some of them wrong.
 */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();

const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);
const div = (a: number, b: number): number => (a === 0 ? 0 : EXP[(LOG[a]! + 255 - LOG[b]!) % 255]!);
const pow = (a: number, n: number): number => EXP[(LOG[a]! * n) % 255]!;
const inv = (a: number): number => EXP[255 - LOG[a]!]!;

/** Polynomials are arrays of coefficients, highest power first. */
const polyMul = (p: number[], q: number[]): number[] => {
  const r = new Array<number>(p.length + q.length - 1).fill(0);
  for (let j = 0; j < q.length; j++) for (let i = 0; i < p.length; i++) r[i + j] = r[i + j]! ^ mul(p[i]!, q[j]!);
  return r;
};
const polyEval = (p: number[], x: number): number => {
  let y = p[0]!;
  for (let i = 1; i < p.length; i++) y = mul(y, x) ^ p[i]!;
  return y;
};

const generator = (nsym: number): number[] => {
  let g = [1];
  for (let i = 0; i < nsym; i++) g = polyMul(g, [1, pow(2, i)]);
  return g;
};

export function rsEncode(msg: Uint8Array, nsym: number): Uint8Array {
  if (msg.length + nsym > 255) throw new RangeError("a Reed–Solomon block is at most 255 bytes");
  const g = generator(nsym);
  const out = new Uint8Array(msg.length + nsym);
  out.set(msg);
  for (let i = 0; i < msg.length; i++) {
    const c = out[i]!;
    if (c !== 0) for (let j = 1; j < g.length; j++) out[i + j] = out[i + j]! ^ mul(g[j]!, c);
  }
  out.set(msg);
  return out;
}

/** The message of `code` with its errors corrected, or null when there are too many to correct. */
export function rsDecode(code: Uint8Array, nsym: number): Uint8Array | null {
  const n = code.length;
  const c = [...code];
  const synd = Array.from({ length: nsym }, (_, i) => polyEval(c, pow(2, i)));
  if (synd.every((s) => s === 0)) return code.slice(0, n - nsym);
  // Berlekamp–Massey: the error locator (lowest power first here).
  let loc = [1], old = [1];
  for (let i = 0; i < nsym; i++) {
    let delta = synd[i]!;
    for (let j = 1; j < loc.length; j++) delta ^= mul(loc[j]!, synd[i - j]!);
    old = [0, ...old];
    if (delta !== 0) {
      if (old.length > loc.length) {
        const next = old.map((x) => mul(x, delta));
        old = loc.map((x) => mul(x, inv(delta)));
        loc = next;
      }
      const len = Math.max(loc.length, old.length);
      const a = [...loc, ...new Array<number>(len - loc.length).fill(0)];
      for (let j = 0; j < old.length; j++) a[j] = a[j]! ^ mul(delta, old[j]!);
      loc = a;
    }
  }
  while (loc.length > 1 && loc[loc.length - 1] === 0) loc.pop();
  const errs = loc.length - 1;
  if (errs * 2 > nsym) return null;
  // Chien search: the positions whose inverse is a root of the locator.
  const pos: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = inv(pow(2, n - 1 - i));
    let y = 0;
    for (let j = loc.length - 1; j >= 0; j--) y = mul(y, x) ^ loc[j]!;
    if (y === 0) pos.push(i);
  }
  if (pos.length !== errs) return null;
  // Forney: the size of each error, from the error evaluator Ω = S·Λ mod x^nsym.
  const omega = new Array<number>(nsym).fill(0);
  for (let i = 0; i < nsym; i++) for (let j = 0; j < loc.length && j <= i; j++) omega[i] = omega[i]! ^ mul(synd[i - j]!, loc[j]!);
  for (const p of pos) {
    const xi = pow(2, n - 1 - p), xinv = inv(xi);
    let num = 0;
    for (let i = nsym - 1; i >= 0; i--) num = mul(num, xinv) ^ omega[i]!;
    let den = 0;
    for (let j = 1; j < loc.length; j += 2) den ^= mul(loc[j]!, pow(xinv, j - 1));
    if (den === 0) return null;
    c[p] = c[p]! ^ mul(xi, div(num, den));
  }
  return polyEval(c, 1) === 0 && Array.from({ length: nsym }, (_, i) => polyEval(c, pow(2, i))).every((s) => s === 0) ? Uint8Array.from(c.slice(0, n - nsym)) : null;
}
