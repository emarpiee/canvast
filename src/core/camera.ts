import * as D from "./dyadic";
import type { Dyadic } from "./dyadic";

/**
 * A point in the authoritative world coordinate space. Both axes are exact
 * dyadic rationals, so there is no finite world rectangle and no precision
 * cliff far from the origin. World +y points down, matching the screen.
 */
export interface WorldPoint {
  readonly x: Dyadic;
  readonly y: Dyadic;
}

/**
 * Camera state.
 *
 *   scale (CSS px per world unit) = 2^(zi + zf),  zi integer, 0 <= zf < 1
 *
 * The zoom is a log2 level split into an integer part (applied exactly to
 * dyadic values as an exponent shift) and a fractional part (applied as a
 * double multiply in [1, 2)). There is no min or max: zi is an ordinary
 * integer that can grow in either direction.
 *
 * `pz` is the precision depth: the finest zoom level whose sub-pixel position
 * the center still remembers. It lets a zoom-out followed by a zoom-in at the
 * same pointer land exactly where it started (see roundCenter).
 */
export interface Camera {
  readonly center: WorldPoint;
  readonly zi: number;
  readonly zf: number;
  readonly pz: number;
}

export interface Viewport {
  /** CSS pixels. */
  readonly width: number;
  readonly height: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Zoom changes are quantized to 2^-20 levels. Every reachable zf is then an
 * exact multiple of 2^-20, so +dz followed by -dz restores the identical
 * camera instead of one that differs in the last bit (an error that a
 * subsequent deep zoom-in would magnify without bound).
 */
export const ZOOM_QUANTUM = 2 ** -20;

/**
 * Screen offsets are quantized to 2^-32 CSS px. With |offset / 2^zf| >= 2^-33,
 * every world offset produced by an input has no bits finer than
 * 2^-(zi + 86), below the camera's guard precision, so zoom and pan never
 * need to round the center at all at depths it still remembers.
 */
const OFFSET_QUANTUM = 2 ** 32;

/** Bits of sub-pixel precision kept below the precision depth `pz`. */
export const CENTER_GUARD_BITS = 96;

/**
 * How many levels coarser than the remembered depth the camera may go before
 * it forgets the finest bits. Exact zoom-out/zoom-in round trips are
 * guaranteed for excursions up to this many binary orders of magnitude
 * (≈ 10^1233); beyond it, the forgotten position is still accurate to
 * 2^-96 px at the coarser scale. This bounds center mantissas to roughly
 * log2|center| + PRECISION_BUDGET + 96 bits.
 */
export const PRECISION_BUDGET = 4096;

export const HOME: Camera = Object.freeze({
  center: Object.freeze({ x: D.ZERO, y: D.ZERO }),
  zi: 0,
  zf: 0,
  pz: 0,
});

export function zoomLevel(cam: Camera): number {
  return cam.zi + cam.zf;
}

function splitLevel(zi: number, zf: number): { zi: number; zf: number } {
  const k = Math.floor(zf);
  return { zi: zi + k, zf: zf - k };
}

function quantizeOffset(o: number): number {
  return Math.round(o * OFFSET_QUANTUM) / OFFSET_QUANTUM;
}

/** Screen offset from the viewport center (CSS px) to a world-space offset. */
function screenOffsetToWorld(cam: Camera, ox: number, oy: number): { dx: Dyadic; dy: Dyadic } {
  const f = 2 ** cam.zf;
  return {
    dx: D.shift(D.fromNumber(quantizeOffset(ox) / f), -cam.zi),
    dy: D.shift(D.fromNumber(quantizeOffset(oy) / f), -cam.zi),
  };
}

export function worldToScreen(cam: Camera, vp: Viewport, p: WorldPoint): ScreenPoint {
  const f = 2 ** cam.zf;
  return {
    x: vp.width / 2 + D.toNumber(D.shift(D.sub(p.x, cam.center.x), cam.zi)) * f,
    y: vp.height / 2 + D.toNumber(D.shift(D.sub(p.y, cam.center.y), cam.zi)) * f,
  };
}

export function screenToWorld(cam: Camera, vp: Viewport, s: ScreenPoint): WorldPoint {
  assertFinite(s.x, s.y);
  const { dx, dy } = screenOffsetToWorld(cam, s.x - vp.width / 2, s.y - vp.height / 2);
  return { x: D.add(cam.center.x, dx), y: D.add(cam.center.y, dy) };
}

function nextDepth(pz: number, zi: number): number {
  return Math.min(Math.max(pz, zi), zi + PRECISION_BUDGET);
}

/**
 * Bound mantissa growth. With quantized inputs this is a no-op unless the
 * camera has gone more than PRECISION_BUDGET levels coarser than `pz`.
 */
function roundCenter(p: WorldPoint, pz: number): WorldPoint {
  const q = -(pz + CENTER_GUARD_BITS);
  return { x: D.roundTo(p.x, q), y: D.roundTo(p.y, q) };
}

/**
 * Change the zoom level by `dz` (log2 units; +1 doubles magnification) while
 * keeping the world point under `anchor` fixed on screen.
 */
export function zoomAt(cam: Camera, vp: Viewport, anchor: ScreenPoint, dz: number): Camera {
  assertFinite(dz, anchor.x, anchor.y);
  const dzq = Math.round(dz / ZOOM_QUANTUM) * ZOOM_QUANTUM;
  if (dzq === 0) return cam;
  const world = screenToWorld(cam, vp, anchor);
  const { zi, zf } = splitLevel(cam.zi, cam.zf + dzq);
  const pz = nextDepth(cam.pz, zi);
  const next: Camera = { center: cam.center, zi, zf, pz };
  const { dx, dy } = screenOffsetToWorld(next, anchor.x - vp.width / 2, anchor.y - vp.height / 2);
  return { center: roundCenter({ x: D.sub(world.x, dx), y: D.sub(world.y, dy) }, pz), zi, zf, pz };
}

/** Move the view so content follows a drag of (dsx, dsy) CSS px. */
export function panBy(cam: Camera, dsx: number, dsy: number): Camera {
  assertFinite(dsx, dsy);
  const { dx, dy } = screenOffsetToWorld(cam, dsx, dsy);
  if (dx.m === 0n && dy.m === 0n) return cam;
  const pz = nextDepth(cam.pz, cam.zi);
  return {
    center: roundCenter({ x: D.sub(cam.center.x, dx), y: D.sub(cam.center.y, dy) }, pz),
    zi: cam.zi,
    zf: cam.zf,
    pz,
  };
}

/** Center the camera on `p` at an absolute zoom level. */
export function lookAt(p: WorldPoint, zi: number, zf = 0): Camera {
  assertFinite(zi, zf);
  const z = splitLevel(zi, Math.round(zf / ZOOM_QUANTUM) * ZOOM_QUANTUM);
  const pz = z.zi;
  return { center: roundCenter(p, pz), zi: z.zi, zf: z.zf, pz };
}

/**
 * The camera that shows the exact world rectangle [min, max] centred, filling
 * at most `fill` of the viewport in each axis. Works at any depth: the
 * centre is exact and the level is derived from the extent's exponent, so a
 * rectangle 2^-5000 wide gets a level near 5000. A degenerate (zero-size)
 * rectangle keeps `fallbackLevel`.
 */
export function fitRect(min: WorldPoint, max: WorldPoint, vp: Viewport, fill: number, fallbackLevel: number): Camera {
  const center = { x: D.shift(D.add(min.x, max.x), -1), y: D.shift(D.add(min.y, max.y), -1) };
  const lw = D.log2Abs(D.sub(max.x, min.x));
  const lh = D.log2Abs(D.sub(max.y, min.y));
  let level = Math.min(Math.log2(fill * vp.width) - lw, Math.log2(fill * vp.height) - lh);
  if (!Number.isFinite(level)) level = fallbackLevel;
  const zi = Math.floor(level);
  // Quantize down so the rectangle never ends up larger than requested.
  const zf = Math.floor((level - zi) / ZOOM_QUANTUM) * ZOOM_QUANTUM;
  return lookAt(center, zi, zf);
}

function assertFinite(...xs: number[]): void {
  for (const x of xs) {
    if (!Number.isFinite(x)) throw new RangeError(`non-finite camera input: ${x}`);
  }
}

export interface SerializedCamera {
  cx: string;
  cy: string;
  zi: number;
  zf: number;
  pz: number;
}

export function serializeCamera(cam: Camera): SerializedCamera {
  return { cx: D.toString(cam.center.x), cy: D.toString(cam.center.y), zi: cam.zi, zf: cam.zf, pz: cam.pz };
}

export function deserializeCamera(s: SerializedCamera): Camera {
  const zfOk = s.zf >= 0 && s.zf < 1 && Number.isInteger(s.zf / ZOOM_QUANTUM);
  if (!Number.isSafeInteger(s.zi) || !zfOk) throw new RangeError(`invalid camera zoom: ${s.zi} + ${s.zf}`);
  const pz = Number.isSafeInteger(s.pz) ? nextDepth(s.pz, s.zi) : s.zi;
  return { center: roundCenter({ x: D.parse(s.cx), y: D.parse(s.cy) }, pz), zi: s.zi, zf: s.zf, pz };
}
