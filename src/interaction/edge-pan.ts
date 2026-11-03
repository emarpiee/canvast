import { panBy } from "../core/camera";
import type { ScreenPoint } from "../core/camera";
import type { ViewState } from "../app/view-state";

// Edge panning: while something is dragged with the pointer near an edge of the view (or past it), the view moves that way by itself. The nearer the
// edge, the faster, as in other canvas apps. Any drag worked out from world positions can use it (`EdgePan`); the speed is `edgePanStep`, pure.

/** How far in from an edge of the view it starts, CSS px. */
export const EDGE_PAN_ZONE_PX = 48;
/** CSS px a second at the edge itself, at 100% (Settings > Navigation). */
export const EDGE_PAN_MAX_PX_S = 1400;
/** A drag only passing near an edge moves nothing: it starts after this, ms, and comes up to speed over the next `EASE_MS`. */
const DELAY_MS = 200;
const EASE_MS = 200;

/** How much the content moves on the screen in `seconds` for a pointer at `p` (`speed`: 1 is 100%); nothing outside the zones. Each axis on its own. */
export function edgePanStep(p: ScreenPoint, vp: { width: number; height: number }, speed: number, seconds: number): { dx: number; dy: number } {
  const axis = (at: number, size: number): number => {
    const near = (from: number): number => Math.min(1, Math.max(0, 1 - from / EDGE_PAN_ZONE_PX));
    return (near(at) - near(size - at)) * EDGE_PAN_MAX_PX_S * speed * seconds; // (toward the left edge: the content moves right)
  };
  return { dx: axis(p.x, vp.width), dy: axis(p.y, vp.height) };
}

/**
 * The view following one drag near its edges. `at` tells where the pointer is; while it is in a zone the view moves each frame even if the pointer
 * rests, and `onPan(dx, dy)` lets the drag work out its place again (false ends it). `onRest`: the view stopped moving (the pointer left the zones).
 */
export class EdgePan {
  private p: ScreenPoint | null = null;
  private frame = 0;
  private since = 0;
  private last = 0;
  constructor(
    private readonly view: ViewState,
    /** 1 is 100%, 0 off. */
    private readonly speed: () => number,
    private readonly onPan: (p: ScreenPoint, dx: number, dy: number) => boolean,
    private readonly onRest: () => void,
  ) {}

  at(p: ScreenPoint): void {
    this.p = p;
    if (this.frame || !this.speed()) return;
    const { dx, dy } = edgePanStep(p, this.view.viewport, 1, 1);
    if (!dx && !dy) return;
    this.since = this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.frame = 0;
    const p = this.p;
    if (!p) return;
    const seconds = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const ease = Math.min(1, Math.max(0, (now - this.since - DELAY_MS) / EASE_MS));
    const { dx, dy } = edgePanStep(p, this.view.viewport, this.speed() * ease, seconds);
    const inZone = edgePanStep(p, this.view.viewport, 1, 1);
    if (!inZone.dx && !inZone.dy) return this.onRest();
    if (dx || dy) {
      this.view.setCamera(panBy(this.view.camera, dx, dy));
      if (!this.onPan(p, dx, dy)) return this.stop();
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.p = null;
  }
}
