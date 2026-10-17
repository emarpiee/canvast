import type { Camera, ScreenPoint, Viewport } from "../core/camera";
import { HOME, zoomAt } from "../core/camera";
import type { Frame, FrameCamera, FrameSpace } from "../core/frames";
import { K, fjump, fromAbsoluteCamera, fromLocal, localCamera, normalize, toAbsoluteCamera } from "../core/frames";
import * as D from "../core/dyadic";

/**
 * Owner of the live camera and viewport. The camera lives in nested frames
 * (ADR 0014): `camera` is the ordinary camera in the coordinates of `frame`,
 * so every number on the per-frame path stays small at any depth. Cameras
 * are replaced, never mutated, so listeners and tests can hold snapshots.
 */
export class ViewState {
  private fc: FrameCamera;
  private local: Camera;
  private vp: Viewport = { width: 1, height: 1 };
  private readonly listeners = new Set<() => void>();

  /** `space` returns the document's frame tree (it is replaced when a canvas loads). */
  constructor(private readonly space: () => FrameSpace) {
    this.fc = { f: space().world, x: HOME.center.x, y: HOME.center.y, z: 0, pz: 0 };
    this.local = localCamera(this.fc);
  }

  get frameCamera(): FrameCamera {
    this.adopt();
    return this.fc;
  }

  /** The camera in the coordinates of `frame`. */
  get camera(): Camera {
    this.adopt();
    return this.local;
  }

  get frame(): Frame {
    this.adopt();
    return this.fc.f;
  }

  get viewport(): Viewport {
    return this.vp;
  }

  /** Set the camera from one in the coordinates of the current `frame` (rebased as needed). */
  setCamera(cam: Camera): void {
    if (cam === this.local) return;
    this.setFrameCamera(fromLocal(this.frame, cam));
  }

  /** How long a glide to another view takes (ms); 0: views are reached at once (ADR 0116). */
  glideMs = 0;
  private glide = 0;
  private gliding = false;

  /**
   * Go to another view: at once, or by gliding (ADR 0116) when `glideMs` is set and the two views are in the same frame within a
   * frame step of zoom. The glide runs in a smooth path (the view eases out and back in when the places are far apart, so the
   * way is seen), takes the whole path in exact numbers, and is cut short by anything else that moves the camera.
   */
  flyTo(target: FrameCamera): void {
    const a = this.frameCamera;
    this.cancelGlide();
    if (!(this.glideMs > 0) || a.f !== target.f || Math.abs(target.z - a.z) > K) return this.setFrameCamera(target);
    const dx = D.sub(target.x, a.x), dy = D.sub(target.y, a.y);
    const zmin = Math.min(a.z, target.z);
    const apart = Math.hypot(D.toNumber(D.shift(dx, Math.floor(zmin))), D.toNumber(D.shift(dy, Math.floor(zmin)))) * 2 ** (zmin - Math.floor(zmin));
    // When the places are further apart than the view is wide, the glide zooms out in the middle, by the extra levels that would be needed.
    const arc = Math.min(6, Math.max(0, Math.log2(apart / (0.6 * Math.max(1, this.vp.width)))));
    if (apart < 0.5 && Math.abs(target.z - a.z) < 0.01) return this.setFrameCamera(target);
    const t0 = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - t0) / this.glideMs);
      const e = t * t * (3 - 2 * t);
      this.gliding = true;
      try {
        if (t >= 1) this.setFrameCamera(target);
        else this.setFrameCamera({ f: a.f, x: D.add(a.x, D.mul(dx, D.fromNumber(e))), y: D.add(a.y, D.mul(dy, D.fromNumber(e))), z: a.z + (target.z - a.z) * e - arc * Math.sin(Math.PI * e), pz: a.pz });
      } finally {
        this.gliding = false;
      }
      this.glide = t >= 1 ? 0 : requestAnimationFrame(step);
    };
    this.glide = requestAnimationFrame(step);
  }

  private cancelGlide(): void {
    if (this.glide) cancelAnimationFrame(this.glide);
    this.glide = 0;
  }

  setFrameCamera(fc: FrameCamera): void {
    if (!this.gliding) this.cancelGlide(); // any other move of the camera ends a glide
    const n = normalize(fc.f.space, fc);
    this.fc = n;
    this.local = localCamera(n);
    this.emit();
  }

  /** Zoom by `dz` levels about a screen point; giant changes (beyond one frame step) about the centre. */
  zoomBy(dz: number, at: ScreenPoint = { x: this.vp.width / 2, y: this.vp.height / 2 }): void {
    if (Math.abs(dz) <= K) this.setCamera(zoomAt(this.camera, this.vp, at, dz));
    else this.setFrameCamera(fjump(this.space(), this.frameCamera, dz));
  }

  home(): void {
    this.setFrameCamera({ f: this.space().world, x: HOME.center.x, y: HOME.center.y, z: 0, pz: 0 });
  }

  /** The camera in world-frame (absolute) form. Exact; costs about the depth in bits (saving, debugging, tests). */
  worldCamera(): Camera {
    return toAbsoluteCamera(this.space(), this.frameCamera);
  }

  /** Set the camera from world-frame (absolute) form, as saved by v0.8 and earlier. */
  setWorldCamera(cam: Camera): void {
    this.setFrameCamera(fromAbsoluteCamera(this.space(), cam.center, cam.zi + cam.zf, cam.pz));
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

  /** After a canvas load replaced the frame tree, re-express the camera in it (exact, once). */
  private adopt(): void {
    const space = this.space();
    if (this.fc.f.space === space) return;
    const w = toAbsoluteCamera(this.fc.f.space, this.fc);
    this.fc = fromAbsoluteCamera(space, w.center, w.zi + w.zf, w.pz);
    this.local = localCamera(this.fc);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
