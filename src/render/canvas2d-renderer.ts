import * as D from "../core/dyadic";
import type { Camera, Viewport, WorldPoint } from "../core/camera";
import { worldToScreen } from "../core/camera";
import type { Landmark } from "../scene/landmarks";

/**
 * CPU-compatible Canvas 2D renderer. Draws in CSS pixels; the backing store
 * is scaled by devicePixelRatio. Every screen position is derived from exact
 * world coordinates relative to the camera, so there is no floating origin to
 * rebase and nothing renderer-specific leaks back into the model.
 */
export interface Theme {
  background: string;
  grid: string;
  axis: string;
  landmark: string;
  landmarkLabel: string;
}

/**
 * The pattern behind the content (Settings > Appearance > Canvas pattern): a regular grid of lines, a grid of dots, the multi-scale
 * grid (nested tiers of powers of four, with the origin axes), or none. Landmarks (the orientation squares) are drawn in every one.
 */
export type Pattern = "grid" | "dots" | "scale" | "none";

export interface RenderStats {
  gridLines: number;
  landmarksDrawn: number;
}

/** Grid tiers are powers of 4 (2^G for even G). */
const GRID_MIN_PX = 6;
const GRID_FADE_PX = 64;
const GRID_MAX_PX = 1e5;
const GRID_TIER_ALPHA = 0.16;

/** Landmarks smaller than this on screen are drawn as a dot or skipped. */
const LANDMARK_MIN_PX = 1.5;
const LANDMARK_LABEL_MIN_PX = 28;

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  dpr: number,
  theme: Theme,
  landmarks: readonly Landmark[],
  /** The world origin in the camera's coordinates (ADR 0014: the camera may be in another frame). */
  worldOrigin: WorldPoint = { x: D.ZERO, y: D.ZERO },
  pattern: Pattern = "scale",
): RenderStats {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, vp.width, vp.height);

  let gridLines = 0;
  if (pattern === "scale") {
    gridLines = drawGrid(ctx, cam, vp, theme);
    drawAxes(ctx, cam, vp, theme, worldOrigin);
  } else if (pattern !== "none") {
    gridLines = drawRegularGrid(ctx, cam, vp, theme, pattern === "dots");
    drawAxes(ctx, cam, vp, theme, worldOrigin);
  }
  const landmarksDrawn = drawLandmarks(ctx, cam, vp, theme, landmarks);
  return { gridLines, landmarksDrawn };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Screen offset (CSS px, from the viewport's top-left) of the first grid line
 * at or before the left/top edge, for spacing 2^g world units. Computed from
 * the exact remainder of the camera center, so it is correct at any distance.
 */
export function firstLineOffset(centerCoord: D.Dyadic, g: number, half: number, cam: Camera): number {
  const k = D.floorDivPow2(centerCoord, g);
  const lineWorld = D.fromBigInt(k, g); // greatest grid line <= center
  const offset = D.diffToNumber(lineWorld, centerCoord, cam.zi) * 2 ** cam.zf; // in (-spacing, 0]
  const spacing = 2 ** (g + cam.zi + cam.zf);
  const steps = Math.ceil((half + offset) / spacing);
  return half + offset - steps * spacing;
}

function drawGrid(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, theme: Theme): number {
  const z = cam.zi + cam.zf;
  // Smallest even G whose on-screen spacing is at least GRID_MIN_PX.
  let g = Math.ceil(Math.log2(GRID_MIN_PX) - z);
  if (g % 2 !== 0) g += 1;
  let lines = 0;
  // 1-px lines as filled rects (same pixels as a stroke at +0.5): stroking
  // hundreds of long lines costs ~15 ms per frame in Firefox, fillRect ~2 ms
  // in both engines. Same-tier crossings blend twice, as tiers already do.
  ctx.fillStyle = theme.grid;
  for (; ; g += 2) {
    const spacing = 2 ** (g + z);
    if (spacing > GRID_MAX_PX || spacing > 4 * Math.max(vp.width, vp.height)) break;
    const alpha = GRID_TIER_ALPHA * smoothstep(GRID_MIN_PX, GRID_FADE_PX, spacing);
    if (alpha <= 0.002) continue;
    ctx.globalAlpha = alpha;
    for (let x = firstLineOffset(cam.center.x, g, vp.width / 2, cam); x <= vp.width; x += spacing) {
      ctx.fillRect(Math.round(x), 0, 1, vp.height);
      lines++;
    }
    for (let y = firstLineOffset(cam.center.y, g, vp.height / 2, cam); y <= vp.height; y += spacing) {
      ctx.fillRect(0, Math.round(y), vp.width, 1);
      lines++;
    }
  }
  ctx.globalAlpha = 1;
  return lines;
}

/** The regular grid keeps its squares between this many and twice this many CSS px as the zoom changes. */
const REGULAR_MIN_PX = 32;

/**
 * One spacing at a time: a power of two chosen so squares stay between 32 and 64 px, with the next finer spacing fading in and the
 * coarser one fading out across each doubling, so the grid never jumps. Lines (or dots at the crossings) are placed from the exact
 * remainder of the camera centre, like every other mark, so they are right at any depth.
 */
function drawRegularGrid(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, theme: Theme, dots: boolean): number {
  const z = cam.zi + cam.zf;
  const g = Math.ceil(Math.log2(REGULAR_MIN_PX) - z);
  const s = 2 ** (g + z);
  const base = dots ? 0.55 : 0.15;
  const tiers = [
    { g: g + 1, a: base * (1 - smoothstep(REGULAR_MIN_PX, 2 * REGULAR_MIN_PX, s)) },
    { g, a: base },
    { g: g - 1, a: base * smoothstep(REGULAR_MIN_PX / 2, REGULAR_MIN_PX, s / 2) },
  ];
  let marks = 0;
  ctx.fillStyle = theme.grid;
  for (const t of tiers) {
    if (t.a <= 0.004) continue;
    const spacing = 2 ** (t.g + z);
    ctx.globalAlpha = t.a;
    const xs: number[] = [];
    for (let x = firstLineOffset(cam.center.x, t.g, vp.width / 2, cam); x <= vp.width; x += spacing) xs.push(x);
    const ys: number[] = [];
    for (let y = firstLineOffset(cam.center.y, t.g, vp.height / 2, cam); y <= vp.height; y += spacing) ys.push(y);
    if (dots) {
      ctx.beginPath();
      for (const x of xs) for (const y of ys) {
        ctx.moveTo(Math.round(x) + 1.3, Math.round(y));
        ctx.arc(Math.round(x), Math.round(y), 1.3, 0, Math.PI * 2);
        marks++;
      }
      ctx.fill();
    } else {
      for (const x of xs) ctx.fillRect(Math.round(x), 0, 1, vp.height);
      for (const y of ys) ctx.fillRect(0, Math.round(y), vp.width, 1);
      marks += xs.length + ys.length;
    }
  }
  ctx.globalAlpha = 1;
  return marks;
}

function drawAxes(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, theme: Theme, origin: WorldPoint): void {
  const o = worldToScreen(cam, vp, origin);
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  if (o.x >= -1 && o.x <= vp.width + 1) {
    const px = Math.round(o.x) + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, vp.height);
  }
  if (o.y >= -1 && o.y <= vp.height + 1) {
    const py = Math.round(o.y) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(vp.width, py);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Clamp an edge coordinate for drawing; far-offscreen edges stay offscreen. */
function clampEdge(v: number, limit: number): number {
  return Math.min(limit + 16, Math.max(-16, v));
}

function drawLandmarks(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  theme: Theme,
  landmarks: readonly Landmark[],
): number {
  let drawn = 0;
  const z = cam.zi + cam.zf;
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "bottom";
  for (const lm of landmarks) {
    const sizePx = 2 ** (lm.sizeExp + z);
    if (sizePx < LANDMARK_MIN_PX * 0.25) continue;
    // Edges are computed exactly in world space. Deriving them from a
    // projected center +/- half size would cancel catastrophically when the
    // square is vastly larger than the screen and its center is far away.
    const half = D.fromBigInt(1n, lm.sizeExp - 1);
    const tl = worldToScreen(cam, vp, { x: D.sub(lm.center.x, half), y: D.sub(lm.center.y, half) });
    const br = worldToScreen(cam, vp, { x: D.add(lm.center.x, half), y: D.add(lm.center.y, half) });
    if (br.x < -2 || br.y < -2 || tl.x > vp.width + 2 || tl.y > vp.height + 2) continue;
    // A square that contains the whole viewport has no visible edge.
    if (tl.x < -2 && tl.y < -2 && br.x > vp.width + 2 && br.y > vp.height + 2) continue;
    drawn++;
    if (sizePx < LANDMARK_MIN_PX) {
      ctx.fillStyle = theme.landmark;
      ctx.fillRect((tl.x + br.x) / 2 - 1, (tl.y + br.y) / 2 - 1, 2, 2);
      continue;
    }
    const x0 = clampEdge(tl.x, vp.width);
    const y0 = clampEdge(tl.y, vp.height);
    const x1 = clampEdge(br.x, vp.width);
    const y1 = clampEdge(br.y, vp.height);
    ctx.strokeStyle = theme.landmark;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    if (sizePx >= LANDMARK_LABEL_MIN_PX && tl.x >= -1 && tl.y >= 14) {
      ctx.fillStyle = theme.landmarkLabel;
      ctx.fillText(lm.label, tl.x + 2, tl.y - 3);
    }
  }
  return drawn;
}
