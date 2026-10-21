import type { Camera, ScreenPoint, Viewport } from "../core/camera";
import { HOME, zoomAt } from "../core/camera";
import type { Frame, FrameCamera, FrameSpace } from "../core/frames";
import { K, expressExactIn, fjump, fromAbsoluteCamera, fromLocal, levelsBetween, localCamera, normalize, toAbsoluteCamera } from "../core/frames";
import * as D from "../core/dyadic";

/** Levels of zoom-out a smooth glide may use before the trip dives instead; and how far out a dive goes (both under a frame step). */
const DIVE_ARC = 8;
const DIVE_OUT = 24;
/** The most levels apart (frames) for a continuous flight; farther trips dive (the exact position of the target is a number this many bits long). */
const MAX_FLIGHT_LEVELS = 20000;
const RHO = Math.SQRT2;

/** A trip as one continuous path: `efolds` long (in e-folds of zoom, a measure of how far it is), `at(q)` the camera `q` along it. */
interface Flight {
  efolds: number;
  at(q: number): FrameCamera;
}

/**
 * Smooth and efficient zooming and panning (van Wijk and Nuij, 2003) between two cameras of any frames: zoom out from here until the places are
 * about a view apart, move across with the constant-speed path of the paper, zoom in to there. The target is expressed exactly in this frame
 * (bits as long as the levels between), so the way is one continuous camera and nothing cuts. `d` is the distance, the unit of the maths;
 * widths are clamped to [2^-2, 2^40] of it so the numbers stay small whatever the depth.
 */
function flightPlan(space: FrameSpace, a: FrameCamera, target: FrameCamera): Flight | null {
  const L = levelsBetween(a.f, target.f);
  if (Math.abs(L) > MAX_FLIGHT_LEVELS) return null;
  let T: { x: D.Dyadic; y: D.Dyadic };
  try {
    T = a.f === target.f ? { x: target.x, y: target.y } : expressExactIn(space, target.f, { x: target.x, y: target.y }, a.f);
  } catch {
    return null;
  }
  const z1 = target.z + L; // the target's zoom in the units of this frame
  const dx = D.sub(T.x, a.x), dy = D.sub(T.y, a.y);
  const dlog = Math.max(D.log2Abs(dx), D.log2Abs(dy));
  const cam = (x: D.Dyadic, y: D.Dyadic, z: number, pz: number): FrameCamera => ({ f: a.f, x, y, z, pz: Math.max(pz, Math.ceil(z)) });
  if (dlog === -Infinity) {
    // The same place: only the zoom changes.
    const efolds = Math.abs(z1 - a.z) * Math.LN2;
    return { efolds, at: (q) => cam(a.x, a.y, a.z + (z1 - a.z) * (efolds > 0 ? q / efolds : 1), a.pz) };
  }
  const h = Math.hypot(D.toNumber(D.shift(dx, -dlog)), D.toNumber(D.shift(dy, -dlog)));
  const base = -dlog - Math.log2(h); // z = base - log2(width / d)
  const clampW = (z: number): number => Math.min(40, Math.max(-2, base - z));
  const lw0 = clampW(a.z), lw1 = clampW(z1);
  const zc0 = base - lw0, zc1 = base - lw1;
  const w0 = 2 ** lw0, w1 = 2 ** lw1;
  const wo = (u: number, v: number): { r0: number; S: number } => {
    const r0 = -Math.asinh((v * v - u * u + 4) / (4 * u));
    const r1 = -Math.asinh((v * v - u * u - 4) / (4 * v));
    return { r0, S: Math.abs(r1 - r0) / RHO };
  };
  const fwd = wo(w0, w1), rev = wo(w1, w0);
  const S = fwd.S;
  const along = (u: number, r0: number, s: number): number => (u / 2) * (Math.cosh(r0) * Math.tanh(RHO * s + r0) - Math.sinh(r0));
  const lenA = Math.abs(zc0 - a.z) * Math.LN2, lenB = RHO * S, lenC = Math.abs(z1 - zc1) * Math.LN2;
  const ex = (f: number, fromEnd: boolean): [D.Dyadic, D.Dyadic] => {
    const k = D.fromNumber(f);
    return fromEnd ? [D.sub(T.x, D.mul(dx, k)), D.sub(T.y, D.mul(dy, k))] : [D.add(a.x, D.mul(dx, k)), D.add(a.y, D.mul(dy, k))];
  };
  return {
    efolds: lenA + lenB + lenC,
    at(q) {
      if (q < lenA) return cam(a.x, a.y, a.z + (zc0 - a.z) * (q / lenA), a.pz);
      if (q < lenA + lenB) {
        const s = (q - lenA) / RHO;
        const w = (w0 * Math.cosh(fwd.r0)) / Math.cosh(RHO * s + fwd.r0);
        const z = base - Math.log2(w);
        const f = along(w0, fwd.r0, s);
        // Past the middle the distance still to go is computed from the other end, so a tiny remainder keeps all its digits.
        const [x, y] = f <= 0.5 ? ex(f, false) : ex(along(w1, rev.r0, S - s), true);
        return cam(x, y, z, a.pz);
      }
      return cam(T.x, T.y, zc1 + (z1 - zc1) * (lenC > 0 ? (q - lenA - lenB) / lenC : 1), target.pz + L);
    },
  };
}

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
    const plan = this.travel === "near" && !(a.f === target.f && Math.abs(target.z - a.z) <= K) ? null : flightPlan(this.space(), a, target);
    if (plan) {
      if (plan.efolds < 0.01 * Math.LN2 && a.f === target.f) return land();
      const levels = plan.efolds / Math.LN2;
      const ms = this.distanceAware ? Math.min(Math.max(this.maxGlideMs, this.glideMs), this.glideMs * (1 + levels / 6)) : this.glideMs;
      const t0 = performance.now();
      const run = (now: number): void => {
        const t = Math.min(1, (now - t0) / ms);
        this.gliding = true;
        try {
          if (t >= 1) this.setFrameCamera(target);
          else this.setFrameCamera(plan.at(plan.efolds * this.easeOf(t)));
        } finally {
          this.gliding = false;
        }
        this.glide = t >= 1 ? 0 : requestAnimationFrame(run);
        if (t >= 1) {
          this.fade?.(1);
          done?.();
        }
      };
      this.glide = requestAnimationFrame(run);
      return;
    }
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

  private easeOf(t: number): number {
    return this.ease === "linear" ? t : this.ease === "out" ? 1 - (1 - t) ** 3 : t * t * (3 - 2 * t);
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
