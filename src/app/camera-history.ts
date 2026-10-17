/**
 * Previous view and next view (ADR 0116), like a browser's Back and Forward for the camera. A view is remembered once the camera has
 * been still for a moment and is a real move away from the last one remembered (another frame, a zoom level or more, or half a window
 * of distance), so a pan or a zoom is one step and a jump is one step. Going back or forward glides, and does not add steps.
 */
import * as D from "../core/dyadic";
import type { FrameCamera } from "../core/frames";
import type { ViewState } from "./view-state";

const MAX_STEPS = 100;

/** Whether two views are far enough apart to be two places. */
export function apart(a: FrameCamera, b: FrameCamera, width: number): boolean {
  if (a.f !== b.f || Math.abs(a.z - b.z) >= 1) return true;
  const zi = Math.floor(Math.min(a.z, b.z));
  const px = Math.hypot(D.toNumber(D.shift(D.sub(a.x, b.x), zi)), D.toNumber(D.shift(D.sub(a.y, b.y), zi))) * 2 ** (Math.min(a.z, b.z) - zi);
  return px >= 0.5 * Math.max(1, width);
}

export class CameraHistory {
  private readonly stack: FrameCamera[];
  private at = 0;
  private timer = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly view: ViewState, private readonly idleMs = 700) {
    this.stack = [view.frameCamera];
    view.subscribe(() => this.moved());
  }

  subscribe(fn: () => void): void {
    this.listeners.add(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private moved(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.settle(), this.idleMs);
  }

  /** Remember where the camera is now, if that is a new place. */
  settle(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    const now = this.view.frameCamera;
    const here = this.stack[this.at]!;
    if (here.f.space !== now.f.space) {
      // another canvas was opened: its places are not these
      this.stack.length = 0;
      this.stack.push(now);
      this.at = 0;
    } else if (apart(here, now, this.view.viewport.width)) {
      this.stack.length = this.at + 1; // going somewhere new from the middle of the history forgets what was ahead
      this.stack.push(now);
      if (this.stack.length > MAX_STEPS) this.stack.shift();
      this.at = this.stack.length - 1;
    } else this.stack[this.at] = now; // a small move: the place is where it ended
    this.emit();
  }

  canBack(): boolean {
    return this.at > 0 || (this.timer !== 0 && apart(this.stack[this.at]!, this.view.frameCamera, this.view.viewport.width));
  }

  canForward(): boolean {
    return this.at < this.stack.length - 1;
  }

  private go(i: number): void {
    this.at = i;
    this.view.flyTo(this.stack[i]!);
    this.emit();
  }

  back(): void {
    if (this.timer) this.settle(); // the place being left is a step too
    if (this.at > 0) this.go(this.at - 1);
  }

  forward(): void {
    if (this.timer) this.settle();
    if (this.at < this.stack.length - 1) this.go(this.at + 1);
  }
}
