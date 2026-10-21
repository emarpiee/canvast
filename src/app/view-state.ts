import type { Camera, ScreenPoint, Viewport } from "../core/camera";
import { HOME, zoomAt } from "../core/camera";
import type { Frame, FrameCamera, FrameSpace } from "../core/frames";
import { K, fjump, fromAbsoluteCamera, fromLocal, localCamera, normalize, toAbsoluteCamera } from "../core/frames";
import * as D from "../core/dyadic";

/** Levels of zoom-out a smooth glide may use before the trip dives instead; and how far out a dive goes (both under a frame step). */
const DIVE_ARC = 8;
const DIVE_OUT = 24;

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

  /** The base time of a glide to another view (ms); 0: views are reached at once (ADR 0116). */
  glideMs = 0;
  /** How views far away are reached (ADR 0163): "fly" glides near ones and dives (out, then in) to far ones; "near" cuts far ones; "cut" always. */
  travel: "fly" | "near" | "cut" = "fly";
  /** The time grows with the levels travelled (`distanceAware`) or stays `glideMs`, and never passes `maxGlideMs`. */
  distanceAware = true;
  maxGlideMs = 3000;
  ease: "smooth" | "linear" | "out" = "smooth";
  /** Called with the opacity (0 to 1) the canvas should have during a dive, so the switch in the middle is a quick dip, not a cut; null: off. */
  fade: ((opacity: number) => void) | null = null;
  /** Why trips cut because of the motion settings ("" when they do not), and who to tell (once). */
  cutReason = "";
  onCut: ((why: string) => void) | null = null;
  private glide = 0;
  private gliding = false;

  /**
   * Go to another view: at once, or by gliding (ADR 0116) when `glideMs` is set. Near views (the same frame, within a frame step of
   * zoom, not further than `DIVE_ARC` levels of zoom-out away) are reached by one smooth path that eases out and back in when the
   * places are far apart. Farther ones (other frames, or too far to show the way) dive: zoom out from here, then in to there, the
   * switch happening where both are tiny (ADR 0163). A glide is cut short by anything else that moves the camera; `done` runs on arrival
   * (at once when there is no glide), never after an interruption.
   */
  flyTo(target: FrameCamera, done?: () => void): void {
    const a = this.frameCamera;
    this.cancelGlide();
    const land = (): void => {
      if (!(this.glideMs > 0) && this.cutReason) this.onCut?.(this.cutReason);
      this.setFrameCamera(target);
      done?.();
    };
    if (!(this.glideMs > 0) || this.travel === "cut") return land();
    const sameFrame = a.f === target.f && Math.abs(target.z - a.z) <= K;
    let arc = 0;
    let dive = !sameFrame;
    if (sameFrame) {
      const dx = D.sub(target.x, a.x), dy = D.sub(target.y, a.y);
      const zmin = Math.min(a.z, target.z);
      const apart = Math.hypot(D.toNumber(D.shift(dx, Math.floor(zmin))), D.toNumber(D.shift(dy, Math.floor(zmin)))) * 2 ** (zmin - Math.floor(zmin));
      // When the places are further apart than the view is wide, the glide zooms out in the middle, by the extra levels that would be needed.
      arc = Math.max(0, Math.log2(apart / (0.6 * Math.max(1, this.vp.width))));
      if (apart < 0.5 && Math.abs(target.z - a.z) < 0.01) return land();
      if (arc > DIVE_ARC) dive = true;
    }
    if (dive && this.travel === "near") return land();
    const arcUsed = Math.min(arc, DIVE_ARC);
    const levels = dive ? 2 * DIVE_OUT : Math.abs(target.z - a.z) + 2 * arcUsed;
    const ms = this.distanceAware ? Math.min(Math.max(this.maxGlideMs, this.glideMs), this.glideMs * (1 + levels / 6)) : this.glideMs;
    const ease = (t: number): number => (this.ease === "linear" ? t : this.ease === "out" ? 1 - (1 - t) ** 3 : t * t * (3 - 2 * t));
    const t0 = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - t0) / ms);
      this.gliding = true;
      try {
        if (t >= 1) this.setFrameCamera(target);
        else if (dive) {
          this.fade?.(Math.min(1, Math.abs(t - 0.5) / 0.08)); // dark for a moment around the switch
          // First half: out from here (speeding up); second half: in to there (slowing down); both linear when the easing is.
          const lin = this.ease === "linear";
          if (t < 0.5) {
            const u = t * 2, e = lin ? u : u * u;
            this.setFrameCamera({ ...a, z: a.z - DIVE_OUT * e });
          } else {
            const u = (t - 0.5) * 2, e = lin ? u : 1 - (1 - u) ** 2;
            this.setFrameCamera({ ...target, z: target.z - DIVE_OUT * (1 - e) });
          }
        } else {
          const e = ease(t);
          const dx = D.sub(target.x, a.x), dy = D.sub(target.y, a.y);
          this.setFrameCamera({ f: a.f, x: D.add(a.x, D.mul(dx, D.fromNumber(e))), y: D.add(a.y, D.mul(dy, D.fromNumber(e))), z: a.z + (target.z - a.z) * e - arcUsed * Math.sin(Math.PI * e), pz: a.pz });
        }
      } finally {
        this.gliding = false;
      }
      this.glide = t >= 1 ? 0 : requestAnimationFrame(step);
      if (t >= 1) {
        this.fade?.(1);
        done?.();
      }
    };
    this.glide = requestAnimationFrame(step);
  }

  private cancelGlide(): void {
    if (this.glide) this.fade?.(1);
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
