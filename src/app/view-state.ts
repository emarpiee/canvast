import type { Camera, Viewport } from "../core/camera";
import { HOME } from "../core/camera";

/**
 * Owner of the live camera and viewport. The camera is replaced, never
 * mutated, so listeners and tests can hold on to snapshots safely.
 */
export class ViewState {
  private cam: Camera = HOME;
  private vp: Viewport = { width: 1, height: 1 };
  private readonly listeners = new Set<() => void>();

  get camera(): Camera {
    return this.cam;
  }

  get viewport(): Viewport {
    return this.vp;
  }

  setCamera(cam: Camera): void {
    if (cam === this.cam) return;
    this.cam = cam;
    this.emit();
  }

  setViewport(vp: Viewport): void {
    if (vp.width === this.vp.width && vp.height === this.vp.height) return;
    this.vp = vp;
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
