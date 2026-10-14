/**
 * Rotation angles (ADR 0018). An object's rotation is a whole number of
 * 2^-32 turns, so adding and subtracting rotations is exact and a rotation
 * followed by its opposite returns to exactly 0. The matrix is computed with
 * plain + and * only (no Math.sin / Math.cos), because those may differ in the
 * last bit between browsers and a saved drawing must look the same everywhere.
 */
export const TURN = 2 ** 32;
const QUARTER = TURN / 4;
const HALF_PI = 1.5707963267948966;

/** Angle in turns·2^32 reduced to [0, 2^32). */
export const normAngle = (q: number): number => ((q % TURN) + TURN) % TURN;

/** Radians to the nearest whole angle (not reduced). */
export const angleFromRadians = (rad: number): number => Math.round((rad / (2 * Math.PI)) * TURN);

export const radiansFromAngle = (q: number): number => (q / TURN) * 2 * Math.PI;

/** cos and sin of an angle, deterministic. Multiples of a quarter turn are exact. */
export function cosSin(q: number): { c: number; s: number } {
  const n = normAngle(q);
  const quad = Math.floor(n / QUARTER);
  const r = n - quad * QUARTER; // [0, 2^30)
  // Fold at 45 degrees so the series argument stays at most pi/4.
  const flip = r > QUARTER / 2;
  const a = ((flip ? QUARTER - r : r) / QUARTER) * HALF_PI;
  const a2 = a * a;
  let sin = 0;
  let cos = 0;
  let ts = a; // a^(2k+1)/(2k+1)!
  let tc = 1; // a^(2k)/(2k)!
  for (let k = 0; k < 12; k++) {
    sin += ts;
    cos += tc;
    ts = (-ts * a2) / ((2 * k + 2) * (2 * k + 3));
    tc = (-tc * a2) / ((2 * k + 1) * (2 * k + 2));
  }
  const c0 = flip ? sin : cos;
  const s0 = flip ? cos : sin;
  switch (quad) {
    case 0:
      return { c: c0, s: s0 };
    case 1:
      return { c: -s0, s: c0 };
    case 2:
      return { c: -c0, s: -s0 };
    default:
      return { c: s0, s: -c0 };
  }
}
