import * as D from "../core/dyadic";
import type { ScreenPoint, Viewport, WorldPoint } from "../core/camera";
import { screenToWorld } from "../core/camera";
import type { StrokeObject } from "../doc/model";
import { localBounds, newObjectId } from "../doc/model";
import { normalizeUnit } from "../doc/edit-ops";
import { renderFrame } from "../render/canvas2d-renderer";
import type { Theme } from "../render/canvas2d-renderer";
import { projectObject } from "../render/projection";
import { drawStroke } from "../render/draw-objects";
import type { Landmark } from "../scene/landmarks";
import { LANDMARKS } from "../scene/landmarks";
import type { Frame, FrameCamera } from "./frames";
import {
  FrameSpace,
  K,
  depthOf,
  expressExactIn,
  expressIn,
  fjump,
  fpanBy,
  fromAbsoluteCamera,
  fzoomAt,
  levelsBetween,
  localCamera,
  rehome,
  toAbsoluteCamera,
} from "./frames";
import { objectLevel } from "../scene/spatial-index";

/**
 * SPIKE page (dist-spike/frames.html): the camera lives in nested frames and
 * the existing renderer draws a "local world" made of the camera frame's own
 * coordinates. Grid, landmarks and strokes only. Not the app.
 */

interface FStroke {
  f: Frame;
  obj: StrokeObject;
}

const THEME: Theme = {
  background: "#f7f7f5",
  grid: "#e4e4df",
  axis: "#c2410c",
  landmark: "#2563eb",
  landmarkLabel: "#1e3a8a",
};

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const hud = document.getElementById("hud")!;
const ctx = canvas.getContext("2d", { alpha: false })!;
const space = new FrameSpace();
let cam: FrameCamera = { f: space.root, x: D.ZERO, y: D.ZERO, z: 0, pz: 0 };
const strokes: FStroke[] = [];
let vp: Viewport = { width: 1, height: 1 };
let dpr = 1;
let lastMs = 0;
let rebaseCount = 0;
let overlay = false;

/**
 * Objects re-expressed in the camera frame. Rebuilt only when the camera
 * changes frame (or content changes): per frame, nothing touches other
 * frames, so frame cost does not depend on depth.
 */
let scene: { f: Frame; strokes: StrokeObject[]; landmarks: Landmark[]; buildMs: number; skipped: number } | null = null;
/** shortcut: coarse strokes covering the view from more levels below than this are not drawn (exact path is O(levels)); step 3's near-edge set removes the limit. */
const COARSE_EXACT_MAX = 100_000;

/** Exact expression without the far cut-off, for coarse objects that may cover the view (bits grow with the level gap). */
function expressExact(g: Frame, p: WorldPoint, f: Frame): WorldPoint {
  const path = space.path(f);
  let x = p.x;
  let y = p.y;
  for (let i = path.indexOf(g) + 1; i < path.length; i++) {
    const d = path[i]!;
    x = D.shift(D.sub(x, d.ox), K * Number(d.n));
    y = D.shift(D.sub(y, d.oy), K * Number(d.n));
  }
  return { x, y };
}

/** Camera centre in an ancestor frame `g`, approximately (doubles): for a conservative "may cover the view" test. */
function approxIn(g: Frame): { x: number; y: number } {
  let x = D.toNumber(cam.x);
  let y = D.toNumber(cam.y);
  for (let a: Frame = cam.f; a !== g; a = a.parent!) {
    const s = 2 ** (-K * Number(a.n));
    x = D.toNumber(a.ox) + x * s;
    y = D.toNumber(a.oy) + y * s;
  }
  return { x, y };
}

function buildScene(): NonNullable<typeof scene> {
  const t0 = performance.now();
  const f = cam.f;
  const out: StrokeObject[] = [];
  const onPath = new Set(space.path(f));
  let skipped = 0;
  for (const s of strokes) {
    const d = levelsBetween(s.f, f); // > 0: the stroke's frame is coarser than the camera's
    if (d < -2 * K) continue; // far finer than the view: sub-pixel (density preview is out of the spike's scope)
    let a = expressIn(space, s.f, s.obj.anchor, f);
    if (!a && d > 0 && onPath.has(s.f)) {
      // Coarse stroke whose anchor is far away: it may still cover the view.
      const c = approxIn(s.f);
      const b = localBounds(s.obj);
      const u = 2 ** s.obj.unit;
      const ax = D.toNumber(s.obj.anchor.x);
      const ay = D.toNumber(s.obj.anchor.y);
      const m = 1e-9 * u * (b.maxX - b.minX + b.maxY - b.minY);
      if (c.x >= ax + b.minX * u - m && c.x <= ax + b.maxX * u + m && c.y >= ay + b.minY * u - m && c.y <= ay + b.maxY * u + m) {
        if (d <= COARSE_EXACT_MAX) a = expressExact(s.f, s.obj.anchor, f);
        else skipped++;
      }
    }
    if (a) out.push({ ...s.obj, anchor: a, unit: s.obj.unit + d });
  }
  const lms: Landmark[] = [];
  for (const l of LANDMARKS) {
    const d = levelsBetween(space.world, f);
    const c = expressIn(space, space.world, l.center, f);
    if (c) lms.push({ ...l, center: c, sizeExp: l.sizeExp + d });
  }
  return { f, strokes: out, landmarks: lms, buildMs: performance.now() - t0, skipped };
}

function render(): number {
  const t0 = performance.now();
  if (!scene || scene.f !== cam.f) scene = buildScene();
  const local = localCamera(cam);
  renderFrame(ctx, local, vp, dpr, THEME, scene.landmarks);
  for (const o of scene.strokes) {
    const po = projectObject(o, local, vp);
    if (po) drawStroke(ctx, po, vp);
  }
  if (draft && draft.points.length >= 2) {
    const d = draftObject(draft);
    const a = draft.f === cam.f ? d.anchor : expressExactIn(space, draft.f, d.anchor, cam.f);
    const po = projectObject({ ...d, anchor: a, unit: d.unit + levelsBetween(draft.f, cam.f) }, local, vp, { keepTiny: true });
    if (po) drawStroke(ctx, po, vp);
  }
  if (overlay) drawFrameOverlay();
  lastMs = performance.now() - t0;
  const dep = depthOf(cam);
  hud.textContent =
    `zoom 2^${dep.levels} (+${dep.frac.toFixed(2)}) · render ${lastMs.toFixed(1)} ms · ` +
    `frame #${cam.f.id} (level ${cam.f.level}${cam.f.n > 1n ? `, dive of ${cam.f.n} steps` : ""}) · local z ${cam.z.toFixed(2)} · pz ${cam.pz} · ` +
    `rebases ${rebaseCount} · frames ${space.count} · scene ${scene.strokes.length} strokes, built in ${scene.buildMs.toFixed(1)} ms` +
    (scene.skipped ? ` · ${scene.skipped} coarse strokes not drawn (> ${COARSE_EXACT_MAX} levels above, step 3)` : "");
  return lastMs;
}

/**
 * Debug overlay: the camera frame's own cell (local 0..2^K, orange) and its
 * child cells (integer lines, blue) where they are at least 12 px apart.
 * Rebasing happens when the view moves into one of the blue cells' scale.
 */
function drawFrameOverlay(): void {
  const s = 2 ** cam.z;
  const cx = vp.width / 2 - D.toNumber(cam.x) * s;
  const cy = vp.height / 2 - D.toNumber(cam.y) * s;
  ctx.save();
  ctx.lineWidth = 1;
  if (s >= 12) {
    ctx.strokeStyle = "rgba(37,99,235,0.35)";
    ctx.beginPath();
    const x0 = Math.floor(-cx / s);
    const y0 = Math.floor(-cy / s);
    for (let i = x0; cx + i * s <= vp.width; i++) {
      ctx.moveTo(cx + i * s + 0.5, 0);
      ctx.lineTo(cx + i * s + 0.5, vp.height);
    }
    for (let j = y0; cy + j * s <= vp.height; j++) {
      ctx.moveTo(0, cy + j * s + 0.5);
      ctx.lineTo(vp.width, cy + j * s + 0.5);
    }
    ctx.stroke();
  }
  if (cam.f.parent) {
    const e = 2 ** K * s;
    const l = Math.max(-10, Math.min(vp.width + 10, cx));
    const t = Math.max(-10, Math.min(vp.height + 10, cy));
    const r = Math.max(-10, Math.min(vp.width + 10, cx + e));
    const b = Math.max(-10, Math.min(vp.height + 10, cy + e));
    ctx.strokeStyle = "#ea580c";
    ctx.lineWidth = 2;
    ctx.strokeRect(l, t, r - l, b - t);
  }
  ctx.fillStyle = "#ea580c";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(`frame #${cam.f.id} · level ${cam.f.level}`, 8, 52);
  ctx.restore();
}

let scheduled = false;
function invalidate(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    render();
  });
}

function setCam(c: FrameCamera): void {
  if (c.f !== cam.f) rebaseCount++;
  cam = c;
  invalidate();
}

// ---- pen ------------------------------------------------------------------
interface Draft {
  /** The frame the stroke started in: its points stay there even if the camera rebases mid-stroke. */
  f: Frame;
  anchor: WorldPoint;
  unit: number;
  points: number[];
}
let draft: Draft | null = null;
let tool: "pen" | "hand" = "hand";

function draftObject(d: Draft): StrokeObject {
  return { id: newObjectId(), kind: "stroke", anchor: d.anchor, unit: d.unit, z: 0, opacity: 1, attachmentTargetId: null, points: d.points, width: 3 / 2 ** localCamera(cam).zf, color: "#1f2329" };
}

function penPoint(s: ScreenPoint): void {
  const here = screenToWorld(localCamera(cam), vp, s);
  const w = cam.f === draft!.f ? here : expressExactIn(space, cam.f, here, draft!.f);
  draft!.points.push(D.toNumber(D.shift(D.sub(w.x, draft!.anchor.x), -draft!.unit)), D.toNumber(D.shift(D.sub(w.y, draft!.anchor.y), -draft!.unit)));
}

function beginStroke(s: ScreenPoint): void {
  draft = { f: cam.f, anchor: screenToWorld(localCamera(cam), vp, s), unit: -localCamera(cam).zi, points: [] };
  penPoint(s);
}

function endStroke(): void {
  if (draft && draft.points.length >= 2) {
    const o = normalizeUnit(draftObject(draft)) as StrokeObject;
    const pl = rehome(space, { f: draft.f, anchor: o.anchor, unit: o.unit }, objectLevel(o) - o.unit);
    strokes.push({ f: pl.f, obj: { ...o, anchor: pl.anchor, unit: pl.unit } });
    scene = null;
  }
  draft = null;
  invalidate();
}

// ---- input ------------------------------------------------------------------
const local = (e: { clientX: number; clientY: number }): ScreenPoint => {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
let panFrom: ScreenPoint | null = null;
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  setCam(fzoomAt(space, cam, vp, local(e), Math.max(-2, Math.min(2, -e.deltaY / 240))));
}, { passive: false });
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (tool === "pen" && e.button === 0) beginStroke(local(e));
  else panFrom = local(e);
});
canvas.addEventListener("pointermove", (e) => {
  const s = local(e);
  if (draft) {
    penPoint(s);
    invalidate();
  } else if (panFrom) {
    setCam(fpanBy(space, cam, s.x - panFrom.x, s.y - panFrom.y));
    panFrom = s;
  }
});
canvas.addEventListener("pointerup", () => {
  if (draft) endStroke();
  panFrom = null;
});
window.addEventListener("keydown", (e) => {
  const step = 0.125 * Math.min(vp.width, vp.height);
  const k = e.key;
  if (k === "p") tool = "pen";
  else if (k === "f") {
    overlay = !overlay;
    invalidate();
  }
  else if (k === "h") tool = "hand";
  else if (k === "+" || k === "=") setCam(fzoomAt(space, cam, vp, { x: vp.width / 2, y: vp.height / 2 }, 0.5));
  else if (k === "-") setCam(fzoomAt(space, cam, vp, { x: vp.width / 2, y: vp.height / 2 }, -0.5));
  else if (k === "ArrowLeft") setCam(fpanBy(space, cam, step, 0));
  else if (k === "ArrowRight") setCam(fpanBy(space, cam, -step, 0));
  else if (k === "ArrowUp") setCam(fpanBy(space, cam, 0, step));
  else if (k === "ArrowDown") setCam(fpanBy(space, cam, 0, -step));
  else if (k === "j") {
    const v = Number(prompt("Zoom by how many levels? (e.g. 1000000000000 or -1000)") ?? "");
    if (Number.isFinite(v) && v) setCam(fjump(space, cam, v));
  } else return;
  canvas.dataset["tool"] = tool;
  e.preventDefault();
});

// Jump panel (as the app's dev panel): whole frames and giant jumps.
const panel = document.createElement("div");
panel.id = "jumps";
const JUMPS = [-1e12, -1e9, -1e6, -1000, -K, K, 1000, 1e6, 1e9, 1e12];
panel.innerHTML =
  JUMPS.map((j) => `<button type="button" data-jump="${j}">${j > 0 ? "+" : "−"}${Math.abs(j) === K ? "1 frame" : Math.abs(j).toExponential(0).replace("e+", "e")}</button>`).join("") +
  `<button type="button" data-home>Home</button><button type="button" data-overlay>Frames (F)</button>`;
document.body.append(panel);
panel.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b) return;
  if (b.dataset["jump"]) setCam(fjump(space, cam, Number(b.dataset["jump"])));
  else if ("home" in b.dataset) setCam(fromAbsoluteCamera(space, { x: D.ZERO, y: D.ZERO }, 0));
  else if ("overlay" in b.dataset) {
    overlay = !overlay;
    invalidate();
  }
  canvas.focus();
});

function resize(): void {
  const r = canvas.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  vp = { width: r.width, height: r.height };
  invalidate();
}
new ResizeObserver(resize).observe(canvas);

// ---- measurement hook ---------------------------------------------------------
const pct = (xs: number[]): { p50: number; p95: number; max: number } => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number): number => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? 0;
  return { p50: at(50), p95: at(95), max: s[s.length - 1] ?? 0 };
};
(window as unknown as { __spike: unknown }).__spike = {
  /** Jump by `levels` about the screen centre; returns ms (including one render). */
  jump: (levels: number): number => {
    const t0 = performance.now();
    cam = fjump(space, cam, levels);
    render();
    return performance.now() - t0;
  },
  pan: (dx: number, dy: number): void => setCam(fpanBy(space, cam, dx, dy)),
  zoomAt: (x: number, y: number, dz: number): void => setCam(fzoomAt(space, cam, vp, { x, y }, dz)),
  /** Draw a stroke through screen points (as the pen would). */
  stroke: (pts: Array<[number, number]>): void => {
    beginStroke({ x: pts[0]![0], y: pts[0]![1] });
    for (const [x, y] of pts.slice(1)) penPoint({ x, y });
    endStroke();
  },
  render,
  /** Frame-local camera (all small numbers). */
  camera: () => ({ frame: cam.f.id, level: String(cam.f.level), n: String(cam.f.n), x: D.toString(cam.x), y: D.toString(cam.y), z: cam.z, pz: cam.pz }),
  /**
   * The camera in the old absolute form ("<m>p<e>" strings, zoom levels as in
   * SerializedCamera), exact. Debug only: its size grows with depth.
   */
  absoluteCamera: () => {
    const a = toAbsoluteCamera(space, cam);
    return { cx: D.toString(a.center.x), cy: D.toString(a.center.y), zi: a.zi, zf: a.zf, pz: a.pz };
  },
  setAbsoluteCamera: (c: { cx: string; cy: string; zi: number; zf: number; pz: number }): void =>
    setCam(fromAbsoluteCamera(space, { x: D.parse(c.cx), y: D.parse(c.cy) }, c.zi + c.zf, c.pz)),
  /** Screen position of an absolute world point (null when far off screen): the cheap path, small numbers. */
  worldToScreen: (x: string, y: string): ScreenPoint | null => {
    const p = expressIn(space, space.world, { x: D.parse(x), y: D.parse(y) }, cam.f);
    if (!p) return null;
    const s = 2 ** cam.z;
    return { x: vp.width / 2 + D.toNumber(D.sub(p.x, cam.x)) * s, y: vp.height / 2 + D.toNumber(D.sub(p.y, cam.y)) * s };
  },
  /** Exact absolute world position under a screen point. Debug only: size grows with depth. */
  screenToWorld: (x: number, y: number): { x: string; y: string } => {
    const p = expressExactIn(space, cam.f, screenToWorld(localCamera(cam), vp, { x, y }), space.world);
    return { x: D.toString(p.x), y: D.toString(p.y) };
  },
  rebases: (): number => rebaseCount,
  setOverlay: (on: boolean): void => {
    overlay = on;
    invalidate();
  },
  /** Strokes with their frame and frame-local anchor. */
  objects: () => strokes.map((s) => ({ id: s.obj.id, frame: s.f.id, level: String(s.f.level), ax: D.toString(s.obj.anchor.x), ay: D.toString(s.obj.anchor.y), unit: s.obj.unit })),
  depth: (): string => {
    const d = depthOf(cam);
    return `${d.levels}+${d.frac}`;
  },
  frames: (): number => space.count,
  sceneStats: () => ({ strokes: scene?.strokes.length ?? 0, landmarks: scene?.landmarks.length ?? 0, buildMs: scene?.buildMs ?? 0 }),
  /** Screen position of point `k` of stroke `i` (null when not in the current scene). */
  strokePoint: (i: number, k = 0): ScreenPoint | null => {
    if (!scene || scene.f !== cam.f) scene = buildScene();
    const s = strokes[i];
    const o = s && scene.strokes.find((x) => x.id === s.obj.id);
    if (!o) return null;
    const po = projectObject(o, localCamera(cam), vp, { keepTiny: true });
    return po ? { x: po.q[2 * k]!, y: po.q[2 * k + 1]! } : null;
  },
  pixelAt: (x: number, y: number): number[] => [...ctx.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data.slice(0, 3)],
  /**
   * Render `n` frames, render-call ms percentiles. "panzoom": pan 37 px and
   * zoom ±0.05 per frame; "zoomin": +0.25 levels per frame (crosses a frame every ~128 frames).
   */
  bench: (n: number, mode: "panzoom" | "zoomin" = "panzoom") => {
    const ms: number[] = [];
    let rebuilds = 0;
    for (let i = 0; i < n; i++) {
      const before = cam.f;
      if (mode === "zoomin") cam = fzoomAt(space, cam, vp, { x: vp.width / 2, y: vp.height / 2 }, 0.25);
      else {
        cam = fpanBy(space, cam, i % 40 < 20 ? 37 : -37, 0);
        cam = fzoomAt(space, cam, vp, { x: vp.width / 2, y: vp.height / 2 }, i % 20 < 10 ? 0.05 : -0.05);
      }
      if (cam.f !== before) rebuilds++;
      ms.push(render());
      ctx.getImageData(0, 0, 1, 1);
    }
    return { ...pct(ms), rebuilds };
  },
};
