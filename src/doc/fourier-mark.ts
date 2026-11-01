/**
 * A Fourier template: four faint waves at fixed directions and one frequency, added to a picture marked by blocks (doc/invisible-mark.ts),
 * so a copy turned by any angle or resized to any size can still be read. In the spectrum the four waves are four points (and their mirrors)
 * whose strength does not change when the picture is moved or cropped; a turn turns them and a resize moves them in or out together. The
 * reader looks over turns and radii for where the four stand out most, which says how the copy was turned and resized; the copy is turned
 * and resized back, and the blocks are read as usual.
 *
 * The directions are uneven (12°, 61°, 98°, 143°), so no turn but the true one (or a half turn, which the blocks' quarter turns cover) lines
 * them all up. Few waves at a low frequency: each can be strong enough to be found after JPEG while the picture barely changes.
 * Pure: works on RGBA pixels, so it runs the same in tests.
 */
import type { Pixels } from "./invisible-mark";

/** The waves' frequency in cycles per pixel: low (JPEG keeps it), but well above the picture's broad shapes. */
const RADIUS = 0.07;
const ANGLES = [12, 61, 98, 143].map((d) => (d * Math.PI) / 180);
const PHASES = [0.3, 2.1, 4.0, 5.2];
/** Each wave's amplitude in grey levels. */
const AMPLITUDE = 1.6;

/** Add the template to the brightness of `p`, in place (with a little noise before rounding, so the waves do not mix into others). */
export function hidePilot(p: Pixels): void {
  const w = p.width, h = p.height, d = p.data;
  const add = new Float32Array(w * h);
  const cx = new Float32Array(w), sx = new Float32Array(w);
  for (const [k, t] of ANGLES.entries()) {
    const fx = RADIUS * Math.cos(t), fy = RADIUS * Math.sin(t), ph = PHASES[k]!;
    for (let x = 0; x < w; x++) {
      cx[x] = Math.cos(2 * Math.PI * fx * x + ph);
      sx[x] = Math.sin(2 * Math.PI * fx * x + ph);
    }
    // cos(u + v) = cos u cos v − sin u sin v: each wave is a product of a row and a column table
    for (let y = 0; y < h; y++) {
      const cy = AMPLITUDE * Math.cos(2 * Math.PI * fy * y), sy = AMPLITUDE * Math.sin(2 * Math.PI * fy * y);
      const row = y * w;
      for (let x = 0; x < w; x++) add[row + x]! += cx[x]! * cy - sx[x]! * sy;
    }
  }
  let seed = 0x9e3779b9;
  const dither = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) - 0.5;
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    if (d[j + 3] === 0) continue;
    for (let c = 0; c < 3; c++) d[j + c] = d[j + c]! + add[i]! + dither();
  }
}

// ---- reading ----------------------------------------------------------------------------------------------------------------------------

/** The window the spectrum is taken of (wide: the turn is read from where the peaks are, to a fraction of a step). */
const N = 1024;

/** In-place radix-2 FFT of `re`, `im` (length a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci, ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a]! += tr;
        im[a]! += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

const hann = (i: number, n: number): number => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n);

/** The log spectrum of the middle 1024 × 1024 of the brightness (Hann windowed; a smaller picture is padded), centred. */
function spectrum(p: Pixels): Float32Array {
  const w = p.width, h = p.height;
  const x0 = Math.max(0, Math.floor((w - N) / 2)), y0 = Math.max(0, Math.floor((h - N) / 2));
  const cw = Math.min(N, w), ch = Math.min(N, h);
  const lum = (x: number, y: number): number => {
    const i = ((y0 + y) * w + x0 + x) * 4;
    return 0.299 * p.data[i]! + 0.587 * p.data[i + 1]! + 0.114 * p.data[i + 2]!;
  };
  let mean = 0;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) mean += lum(x, y);
  mean /= cw * ch;
  const re = new Float64Array(N * N), im = new Float64Array(N * N);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) re[y * N + x] = (lum(x, y) - mean) * hann(x, cw) * hann(y, ch);
  const rr = new Float64Array(N), ii = new Float64Array(N);
  for (let y = 0; y < N; y++) {
    rr.set(re.subarray(y * N, y * N + N));
    ii.set(im.subarray(y * N, y * N + N));
    fft(rr, ii);
    re.set(rr, y * N);
    im.set(ii, y * N);
  }
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      rr[y] = re[y * N + x]!;
      ii[y] = im[y * N + x]!;
    }
    fft(rr, ii);
    for (let y = 0; y < N; y++) {
      re[y * N + x] = rr[y]!;
      im[y * N + x] = ii[y]!;
    }
  }
  const L = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const sx = (x + N / 2) % N, sy = (y + N / 2) % N;
    L[y * N + x] = Math.log1p(Math.hypot(re[sy * N + sx]!, im[sy * N + sx]!));
  }
  return L;
}

/** The spectrum at (x, y) from its centre, between its points. */
const at = (s: Float32Array, x: number, y: number): number => {
  const fx = N / 2 + x, fy = N / 2 + y, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  if (x0 < 0 || y0 < 0 || x0 + 1 >= N || y0 + 1 >= N) return 0;
  return s[y0 * N + x0]! * (1 - ax) * (1 - ay) + s[y0 * N + x0 + 1]! * ax * (1 - ay) + s[(y0 + 1) * N + x0]! * (1 - ax) * ay + s[(y0 + 1) * N + x0 + 1]! * ax * ay;
};

/** How much a point stands out of the spectrum a little in and out along its direction (the picture's own level there). */
const standOut = (s: Float32Array, r: number, t: number): number => {
  const c = Math.cos(t), sn = Math.sin(t);
  return at(s, r * c, r * sn) - (at(s, (r - 4) * c, (r - 4) * sn) + at(s, (r + 4) * c, (r + 4) * sn)) / 2;
};

/** How far the weakest of the four must stand out (log units) for the template to count as found. */
const MIN_WEAKEST = 1;

/**
 * How a copy was turned and resized, from where the template's four waves are: `turn` in radians (up to a half turn, in the spectrum's sense)
 * and `scale` (the copy's size against the picture marked). Null when no template stands out.
 */
export function findPilot(p: Pixels): { turn: number; scale: number } | null {
  const s = spectrum(p);
  let best = { score: -Infinity, turn: 0, r: 0 };
  // radii for copies from a quarter to four times the size; turns in steps of a quarter degree over half a turn
  for (let r = (RADIUS / 4) * N; r <= Math.min(0.45, RADIUS * 4) * N; r *= 1.006) {
    for (let a = 0; a < 720; a++) {
      const turn = (a * Math.PI) / 720;
      // (the weakest of the four: a turn that lines up only some of them by chance does not count)
      let weakest = Infinity;
      for (const t of ANGLES) weakest = Math.min(weakest, standOut(s, r, t + turn));
      if (weakest > best.score) best = { score: weakest, turn, r };
    }
  }
  if (best.score < MIN_WEAKEST) return null;
  // Each peak placed finely, at the centre of the strength around where it was found; the turn and the radius from the four together.
  let turnSum = 0, rSum = 0;
  for (const t of ANGLES) {
    const px = best.r * Math.cos(t + best.turn), py = best.r * Math.sin(t + best.turn);
    let wsum = 0, mx = 0, my = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = Math.round(px) + dx, y = Math.round(py) + dy;
      const v = Math.max(0, Math.expm1(at(s, x, y)) - Math.expm1(at(s, px * 1.15, py * 1.15))); // (strength above the level beside it)
      wsum += v;
      mx += v * x;
      my += v * y;
    }
    const cx = wsum ? mx / wsum : px, cy = wsum ? my / wsum : py;
    let d = Math.atan2(cy, cx) - t - best.turn;
    d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    turnSum += d;
    rSum += Math.hypot(cx, cy);
  }
  const turn = best.turn + turnSum / ANGLES.length, r = rSum / ANGLES.length;
  return { turn, scale: (RADIUS * N) / r }; // (a copy made k times as big has the waves at 1 / k of their frequency)
}

/**
 * `p` turned by −`turn` and resized by 1 / `scale` about its centre (bilinear): the copy brought back to the marked picture's turn and size,
 * as near as can be (what the turn left outside is grey). `scale` is the copy's size against the marked picture's.
 */
export function undoPilot(p: Pixels, turn: number, scale: number): Pixels {
  const w = Math.max(16, Math.round(p.width / scale)), h = Math.max(16, Math.round(p.height / scale));
  const out = new Uint8ClampedArray(w * h * 4);
  const c = Math.cos(turn), sn = Math.sin(turn);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ux = (x - w / 2) * scale, uy = (y - h / 2) * scale;
    const sx = c * ux - sn * uy + p.width / 2, sy = sn * ux + c * uy + p.height / 2;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    const o = (y * w + x) * 4;
    for (let ch = 0; ch < 3; ch++) {
      const g = (xx: number, yy: number): number => (xx < 0 || yy < 0 || xx >= p.width || yy >= p.height ? 128 : p.data[(yy * p.width + xx) * 4 + ch]!);
      out[o + ch] = g(x0, y0) * (1 - fx) * (1 - fy) + g(x0 + 1, y0) * fx * (1 - fy) + g(x0, y0 + 1) * (1 - fx) * fy + g(x0 + 1, y0 + 1) * fx * fy;
    }
    out[o + 3] = 255;
  }
  return { width: w, height: h, data: out };
}
