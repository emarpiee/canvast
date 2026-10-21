import { MAX_CURVE_POINTS, curveFn } from "../doc/adjust";
import { esc } from "./format";

/**
 * The Curves control (ADR 0136), shared by the adjustments' curves and the brush dynamics' response curves: a monotone curve through
 * points on 0..255 × 0..255. Drag a point, click to add one, double-click a point to remove it; [ and ] pick a point, arrows move it.
 */
export const curveCanvas = (label: string, attr = "data-curve"): string =>
  `<canvas class="adj-curve" ${attr} width="192" height="192" tabindex="0" role="application" aria-label="${esc(label)}: drag a point, click to add one, double-click a point to remove it. With the keyboard: [ and ] choose a point, arrows move it, Delete removes it"></canvas>`;

export interface CurveHost {
  /** The points now, in order. */
  points(): Array<[number, number]>;
  /** The new points (sorted). */
  set(pts: Array<[number, number]>): void;
  /** While a point is dragged. */
  input(): void;
  /** A change is done (pointer up, a key, a point removed). */
  commit(): void;
}

/** Make a curve canvas work. `draw` shows the host's points again (after a change from elsewhere); `unpick` forgets the picked point. */
export function wireCurve(cv: HTMLCanvasElement, host: CurveHost): { draw(): void; unpick(): void } {
  let picked = -1;
  const SIZE = 192, PAD = 6;
  const toXY = (x: number, y: number): [number, number] => [PAD + (x / 255) * (SIZE - 2 * PAD), SIZE - PAD - (y / 255) * (SIZE - 2 * PAD)];
  const fromXY = (px: number, py: number): [number, number] => [Math.max(0, Math.min(255, Math.round(((px - PAD) / (SIZE - 2 * PAD)) * 255))), Math.max(0, Math.min(255, Math.round(((SIZE - PAD - py) / (SIZE - 2 * PAD)) * 255)))];
  const points = (): Array<[number, number]> => host.points().map((p) => [p[0], p[1]]);
  const setPoints = (pts: Array<[number, number]>): void => host.set(pts.sort((a, b) => a[0] - b[0]));
  const draw = (): void => {
    const g = cv.getContext("2d")!;
    const css = getComputedStyle(cv);
    g.clearRect(0, 0, SIZE, SIZE);
    g.strokeStyle = css.getPropertyValue("--hud-border") || "#888";
    g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const [x, y] = toXY((i * 255) / 4, (i * 255) / 4);
      g.beginPath();
      g.moveTo(x, PAD);
      g.lineTo(x, SIZE - PAD);
      g.moveTo(PAD, y);
      g.lineTo(SIZE - PAD, y);
      g.stroke();
    }
    const pts = points();
    const f = curveFn(pts);
    g.strokeStyle = css.getPropertyValue("--hud-accent") || "#0a7";
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= 255; x += 3) {
      const [px, py] = toXY(x, f(x));
      if (x === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    g.fillStyle = css.getPropertyValue("--hud-fg") || "#222";
    pts.forEach(([x, y], i) => {
      const [px, py] = toXY(x, y);
      g.beginPath();
      g.arc(px, py, i === picked ? 5 : 3.5, 0, 7);
      g.fill();
    });
  };
  const hit = (px: number, py: number): number => points().findIndex(([x, y]) => Math.hypot(toXY(x, y)[0] - px, toXY(x, y)[1] - py) <= 8);
  const local = (e: PointerEvent): [number, number] => {
    const r = cv.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE];
  };
  cv.addEventListener("pointerdown", (e) => {
    const [px, py] = local(e);
    let i = hit(px, py);
    if (i < 0) {
      const pts = points();
      if (pts.length >= MAX_CURVE_POINTS) return;
      pts.push(fromXY(px, py));
      setPoints(pts);
      i = points().findIndex(([x, y]) => (x === fromXY(px, py)[0] && y === fromXY(px, py)[1]));
      host.input();
    }
    picked = i;
    cv.setPointerCapture(e.pointerId);
    cv.focus();
    draw();
  });
  cv.addEventListener("pointermove", (e) => {
    if (picked < 0 || !(e.buttons & 1)) return;
    const pts = points();
    const [x, y] = fromXY(...local(e));
    // between its neighbours (points stay in order) and anywhere up and down
    const lo = picked > 0 ? pts[picked - 1]![0] + 1 : 0, hi = picked < pts.length - 1 ? pts[picked + 1]![0] - 1 : 255;
    pts[picked] = [Math.max(lo, Math.min(hi, x)), y];
    setPoints(pts);
    draw();
    host.input();
  });
  cv.addEventListener("pointerup", () => {
    if (picked >= 0) host.commit();
  });
  cv.addEventListener("dblclick", (e) => {
    const i = hit(...local(e as unknown as PointerEvent));
    const pts = points();
    if (i < 0 || pts.length <= 2) return;
    pts.splice(i, 1);
    picked = -1;
    setPoints(pts);
    draw();
    host.commit();
  });
  cv.addEventListener("keydown", (e) => {
    const pts = points();
    if (e.key === "[" || e.key === "]") {
      picked = (picked + (e.key === "]" ? 1 : -1) + pts.length) % pts.length;
    } else if (picked >= 0 && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      const step = e.shiftKey ? 10 : 1;
      const [x, y] = pts[picked]!;
      pts[picked] = [Math.max(0, Math.min(255, x + (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0))), Math.max(0, Math.min(255, y + (e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0)))];
      setPoints(pts);
      host.commit();
    } else if ((e.key === "Delete" || e.key === "Backspace") && picked >= 0 && pts.length > 2) {
      pts.splice(picked, 1);
      picked = -1;
      setPoints(pts);
      host.commit();
    } else return;
    e.preventDefault();
    draw();
  });
  draw();
  return { draw, unpick: () => { picked = -1; } };
}
