import type { Camera, ScreenPoint, Viewport } from "../core/camera";
import { HOME, zoomAt } from "../core/camera";
import type { Frame, FrameCamera, FrameSpace } from "../core/frames";
import { K, fjump, fromAbsoluteCamera, fromLocal, localCamera, normalize, toAbsoluteCamera } from "../core/frames";

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

  setFrameCamera(fc: FrameCamera): void {
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
