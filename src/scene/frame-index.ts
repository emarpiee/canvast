import * as D from "../core/dyadic";
import type { Camera, WorldPoint } from "../core/camera";
import type { Frame, FrameCamera, FrameSpace } from "../core/frames";
import { DRAW_BITS, H, K, approxIn, expressIn, levelsBetween } from "../core/frames";
import type { CoarseInfo } from "../render/coarse";
import type { Landmark } from "./landmarks";
import type { CanvasObject, ObjectId } from "../doc/model";
import { MIN_CELL_PX, SpatialIndex } from "./spatial-index";
import type { Ink } from "./spatial-index";

/**
 * shortcut: an object whose edge stays near the view, in a frame more than
 * this many levels coarser than the camera's, is not drawn (its exact
 * position costs ~levels bits). Objects that cover the view or miss it need
 * no such limit (coarse views below).
 */
export const COARSE_EXACT_MAX = 100_000;

/** Frames this many levels coarser than the camera's are seen with a rounded centre (render/coarse.ts). */
export const COARSE_ROUND_MIN = 4096;
const COARSE_ROUND_BITS = 256;
/** The rounding drops less than 2^-COARSE_ROUND_BITS per frame on the path (under 2^48 frames): all of it is below this. */
const COARSE_ERR_LOG2 = -COARSE_ROUND_BITS + 48;
/** Zoom of the camera used to query a coarse frame's index: its view window (~2^-190) covers the rounding error. */
const COARSE_QUERY_ZI = 200;

export function isCoarse(fc: FrameCamera, g: Frame): boolean {
  return levelsBetween(g, fc.f) > COARSE_ROUND_MIN;
}

const ORIGIN: WorldPoint = { x: D.ZERO, y: D.ZERO };

/**
 * The camera expressed in frame `g` (ADR 0014), or null when nothing of `g`
 * can be on screen. Drawing a frame's objects with this camera gives the
 * same pixels as drawing them re-expressed in the camera's frame, and every
 * number stays small. Finer and nearby frames: g's origin is found in the
 * camera frame (cheap walk). Coarser frames: the camera centre is carried up
 * with the precision the zoom difference needs.
 */
export function cameraIn(fc: FrameCamera, g: Frame): Camera | null {
  const f = fc.f;
  if (g === f) return { center: { x: fc.x, y: fc.y }, zi: Math.floor(fc.z), zf: fc.z - Math.floor(fc.z), pz: fc.pz };
  const space = f.space;
  const L = levelsBetween(g, f); // > 0: g is coarser than the camera frame
  let center: WorldPoint | null;
  if (L <= 0) {
    if (-L > COARSE_EXACT_MAX) return null; // the centre would have ~|L| bits in g's units
    const o = expressIn(space, g, ORIGIN, f, DRAW_BITS - L);
    if (!o) return null;
    center = { x: D.shift(D.sub(fc.x, o.x), -L), y: D.shift(D.sub(fc.y, o.y), -L) };
  } else {
    if (L > COARSE_EXACT_MAX) return null;
    center = expressIn(space, f, { x: fc.x, y: fc.y }, g, DRAW_BITS + L);
    if (!center) return null;
  }
  const zi0 = Math.floor(fc.z); // not fc.z + L: a double that large drops the fraction
  return { center, zi: zi0 + L, zf: fc.z - zi0, pz: fc.pz + L };
}

/** What a coarse frame's objects are drawn from (see classifyCoarse). */
export interface CoarseCamera {
  /** The camera centre in the frame, rounded to 2^-256 of its unit. */
  readonly center: WorldPoint;
  readonly info: CoarseInfo;
  /** A camera for the frame's index: a window around the centre that covers the view and the rounding error. */
  readonly query: Camera;
}

function coarseCameraIn(fc: FrameCamera, g: Frame): CoarseCamera | null {
  const L = levelsBetween(g, fc.f);
  const center = expressIn(fc.f.space, fc.f, { x: fc.x, y: fc.y }, g, COARSE_ROUND_BITS);
  if (!center) return null;
  return { center, info: { errLog2: COARSE_ERR_LOG2, zTrue: fc.z + L }, query: { center, zi: COARSE_QUERY_ZI, zf: 0, pz: COARSE_QUERY_ZI } };
}

export interface FrameDot {
  /** Screen offset (CSS px) of the frame's origin from the viewport centre. */
  readonly dx: number;
  readonly dy: number;
  /** Covered area in CSS px² (may underflow to 0: the dot still shows, see the density layer). */
  readonly areaPx: number;
  readonly ink: Ink;
}

export interface FrameView {
  readonly frame: Frame;
  /** The camera in this frame's coordinates (for a coarse frame: the window used to query its index). */
  readonly cam: Camera;
  readonly index: SpatialIndex;
  /** Set for a frame far coarser than the camera's: its objects are classified against the rounded centre. */
  readonly coarse?: CoarseCamera & { readonly exactCam: () => Camera | null };
}

/**
 * One spatial index per frame, each in its frame's own coordinates (ADR 0014),
 * so index cells stay small integers at any depth.
 */
export class FrameIndex {
  private readonly byFrame = new Map<Frame, SpatialIndex>();
  private readonly frameOf = new Map<ObjectId, Frame>();
  private version = 0;
  private cached: { fc: FrameCamera; version: number; views: FrameView[]; dots: FrameDot[] } | null = null;

  constructor(private readonly space: () => FrameSpace) {}

  get size(): number {
    return this.frameOf.size;
  }

  clear(): void {
    this.byFrame.clear();
    this.frameOf.clear();
    this.version++;
  }

  rebuild(objects: Iterable<CanvasObject>): void {
    this.clear();
    for (const o of objects) this.insert(o);
  }

  insert(o: CanvasObject): void {
    this.remove(o.id);
    const f = o.frame ?? this.space().world;
    let ix = this.byFrame.get(f);
    if (!ix) {
      this.byFrame.set(f, (ix = new SpatialIndex()));
      this.version++;
    }
    ix.insert(o);
    this.frameOf.set(o.id, f);
  }

  remove(id: ObjectId): void {
    const f = this.frameOf.get(id);
    if (!f) return;
    const ix = this.byFrame.get(f)!;
    ix.remove(id);
    this.frameOf.delete(id);
    if (!ix.size) {
      this.byFrame.delete(f);
      this.version++;
    }
  }

  /** The index of an object's frame. */
  indexOf(id: ObjectId): SpatialIndex | undefined {
    const f = this.frameOf.get(id);
    return f && this.byFrame.get(f);
  }

  /**
   * Every frame with content that can be on screen, with the camera in its
   * coordinates. Cached per camera (cameras are replaced, never mutated).
   * shortcut: visits every frame with content (cheap walks); cull by the frame tree when documents hold thousands of frames.
   */
  views(fc: FrameCamera): FrameView[] {
    return this.split(fc).views;
  }

  /**
   * Frames so much finer than the camera that all their content is below a
   * pixel: each is one density dot at its origin (screen offset from the
   * viewport centre), with its total ink. Querying their index in their own
   * units would need numbers of ~levels bits.
   */
  dots(fc: FrameCamera): FrameDot[] {
    return this.split(fc).dots;
  }

  private split(fc: FrameCamera): { views: FrameView[]; dots: FrameDot[] } {
    if (this.cached && this.cached.fc === fc && this.cached.version === this.version) return this.cached;
    const views: FrameView[] = [];
    const dots: FrameDot[] = [];
    for (const [frame, index] of this.byFrame) {
      const L = levelsBetween(frame, fc.f);
      // Content of a frame lies within ~2^(K+H+2) of its units of its origin (rehome bounds).
      if (L < 0 && fc.z + L + K + H + 2 < Math.log2(MIN_CELL_PX) - 8) {
        const o = expressIn(fc.f.space, frame, ORIGIN, fc.f);
        if (o && index.total.a > 0) {
          // At the content's ink centre: frame corners can lie a pixel away from content that straddles them.
          const s = 2 ** fc.z;
          const c = index.inkCentre;
          const g = 2 ** (fc.z + L);
          dots.push({ dx: D.toNumber(D.sub(o.x, fc.x)) * s + c.x * g, dy: D.toNumber(D.sub(o.y, fc.y)) * s + c.y * g, areaPx: index.total.a * g * g, ink: index.total });
        }
        continue;
      }
      if (L > COARSE_ROUND_MIN) {
        const coarse = coarseCameraIn(fc, frame);
        if (coarse) {
          let exact: Camera | null | undefined;
          views.push({ frame, cam: coarse.query, index, coarse: { ...coarse, exactCam: () => (exact === undefined ? (exact = cameraIn(fc, frame)) : exact) } });
        }
        continue;
      }
      const cam = cameraIn(fc, frame);
      if (cam) views.push({ frame, cam, index });
    }
    this.cached = { fc, version: this.version, views, dots };
    return this.cached;
  }
}

/** Beyond 2^80 frame units a coordinate is off screen at any zoom a frame allows. */
const OFF_SCREEN = D.fromBigInt(1n, 100);

/**
 * World-frame backdrop content in the coordinates of frame `f`: the world
 * origin (for the axes; each coordinate separately, since one axis can be
 * on screen while the other is far) and the landmarks near `f`. Cheap walks;
 * the result changes only when the camera changes frame.
 * shortcut: a landmark much coarser than `f` whose edge crosses the view from far below is not drawn (near-edge set, step 3).
 */
export function worldBackdrop(f: Frame, landmarks: readonly Landmark[]): { origin: WorldPoint; landmarks: Landmark[] } {
  const space = f.space;
  const w = space.world;
  const o = approxIn(space, w, ORIGIN, f);
  const near = (v: D.Dyadic): D.Dyadic => (D.log2Abs(v) < 80 ? v : OFF_SCREEN);
  const d = levelsBetween(w, f);
  const out: Landmark[] = [];
  for (const l of landmarks) {
    const c = expressIn(space, w, l.center, f);
    if (c) out.push({ ...l, center: c, sizeExp: l.sizeExp + d });
  }
  return { origin: { x: near(o.x), y: near(o.y) }, landmarks: out };
}
