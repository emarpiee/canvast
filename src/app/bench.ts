import * as D from "../core/dyadic";
import type { Camera } from "../core/camera";
import { lookAt } from "../core/camera";
import type { CanvasObject, StrokeObject } from "../doc/model";
import { normalizeUnit } from "../doc/edit-ops";

/**
 * Deterministic benchmark scenes, generated inside the page (debug builds or
 * #debug only) so million-object scenes never cross the test boundary.
 *
 * - dense:    n short strokes, all inside the viewport at the returned camera.
 * - clusters: n strokes in `clusters` groups scattered across 2^±200 world
 *             units and 2^±60 scales; the camera shows one group.
 * - mixed:    `visible` strokes in view plus n − visible far-away strokes in
 *             clusters (the realistic "huge board, small view" case).
 */
export type BenchScene =
  | { kind: "dense"; n: number; seed?: number }
  | { kind: "clusters"; n: number; clusters: number; seed?: number }
  | { kind: "mixed"; n: number; visible: number; seed?: number }
  /** Hatching: `n` long strokes of many points (a drawing's shading), spread over twice the view so a pan keeps finding more. */
  | { kind: "hatch"; n: number; seed?: number };

const COLORS = ["#1f2329", "#2563eb", "#dc2626", "#16a34a"];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sequential ids so generation does not spend time on crypto randomness. */
function benchId(i: number): string {
  return i.toString(16).padStart(32, "0");
}

/** A short random squiggle of `k` points within ~`size` local units. */
function squiggle(r: () => number, k: number, size: number): number[] {
  const pts: number[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < k; i++) {
    pts.push(x, y);
    x += (r() - 0.5) * size;
    y += (r() - 0.5) * size;
  }
  return pts;
}

function strokeAt(i: number, x: D.Dyadic, y: D.Dyadic, unit: number, r: () => number): StrokeObject {
  return normalizeUnit({
    id: benchId(i),
    kind: "stroke",
    anchor: { x, y },
    unit,
    z: i,
    opacity: 1,
    attachmentTargetId: null,
    points: squiggle(r, 4 + Math.floor(r() * 5), 12),
    width: 1.5 + Math.floor(r() * 3) * 1.5,
    color: COLORS[Math.floor(r() * COLORS.length)]!,
  }) as StrokeObject;
}

/** Fill the 1280×800-ish area around the origin at zoom 0. */
function denseBlock(start: number, n: number, r: () => number, cx: D.Dyadic, cy: D.Dyadic, unit: number, out: CanvasObject[]): void {
  for (let i = 0; i < n; i++) {
    const x = D.add(cx, D.shift(D.fromNumber(Math.round((r() - 0.5) * 1200)), unit));
    const y = D.add(cy, D.shift(D.fromNumber(Math.round((r() - 0.5) * 740)), unit));
    out.push(strokeAt(start + i, x, y, unit, r));
  }
}

/** A hatching stroke: a zigzag of `k` points across ~`len` units, slightly curved, as a pen draws shading. */
function hatch(r: () => number, k: number, len: number): number[] {
  const pts: number[] = [];
  const turn = (r() - 0.5) * 0.6, amp = 20 + r() * 60;
  for (let i = 0; i < k; i++) {
    const t = i / (k - 1);
    pts.push(t * len + Math.sin(t * 3) * 30 * turn, (i % 2 ? amp : -amp) * (0.6 + 0.4 * Math.sin(t * Math.PI)) + t * len * turn);
  }
  return pts;
}

export function generateBenchScene(scene: BenchScene): { objects: CanvasObject[]; camera: Camera } {
  const r = rng(scene.seed ?? 1);
  const out: CanvasObject[] = [];
  if (scene.kind === "hatch") {
    for (let i = 0; i < scene.n; i++) {
      const x = D.fromNumber(Math.round((r() - 0.5) * 2600)), y = D.fromNumber(Math.round((r() - 0.5) * 1600));
      out.push(normalizeUnit({ id: benchId(i), kind: "stroke", anchor: { x, y }, unit: 0, z: i, opacity: 1, attachmentTargetId: null, points: hatch(r, 40 + Math.floor(r() * 120), 150 + r() * 450), width: 2 + Math.floor(r() * 3) * 2, color: COLORS[i % 2 ? 0 : 1]! }) as StrokeObject);
    }
    return { objects: out, camera: lookAt({ x: D.ZERO, y: D.ZERO }, 0) };
  }
  if (scene.kind === "dense") {
    denseBlock(0, scene.n, r, D.ZERO, D.ZERO, 0, out);
    return { objects: out, camera: lookAt({ x: D.ZERO, y: D.ZERO }, 0) };
  }
  const visible = scene.kind === "mixed" ? scene.visible : 0;
  const far = scene.n - visible;
  const clusters = scene.kind === "clusters" ? scene.clusters : Math.max(1, Math.ceil(far / 1000));
  let first: Camera | null = null;
  let id = 0;
  for (let c = 0; c < clusters; c++) {
    // Cluster centre: random sign · mantissa · 2^(0..200); scale 2^(−60..60).
    const e = Math.floor(r() * 200);
    const cx = D.fromBigInt(BigInt(Math.floor((r() - 0.5) * 2 ** 30)), e);
    const cy = D.fromBigInt(BigInt(Math.floor((r() - 0.5) * 2 ** 30)), e);
    const unit = Math.floor((r() - 0.5) * 120);
    const count = Math.floor(far / clusters) + (c < far % clusters ? 1 : 0);
    denseBlock(id, count, r, cx, cy, unit, out);
    id += count;
    if (!first && scene.kind === "clusters") first = lookAt({ x: cx, y: cy }, -unit);
  }
  if (scene.kind === "mixed") {
    denseBlock(id, visible, r, D.ZERO, D.ZERO, 0, out);
    first = lookAt({ x: D.ZERO, y: D.ZERO }, 0);
  }
  return { objects: out, camera: first ?? lookAt({ x: D.ZERO, y: D.ZERO }, 0) };
}
