/**
 * Export (ADR 0147): what leaves the canvas as a picture of a chosen size. A target is a region of the canvas, its shape being the ratio:
 * a sheet (its own box, with what is on it), or the things picked (their box). The size is only chosen here. The picture is drawn by the
 * same code as the canvas, on a canvas of its own with the camera fitted so the region fills it, so any size is sharp and nothing of the
 * screen (zoom, panels, other objects) is in it.
 */
import type { Viewport } from "../core/camera";
import { lookAt, ZOOM_QUANTUM } from "../core/camera";
import * as D from "../core/dyadic";
import type { Frame } from "../core/frames";
import { fromLocal } from "../core/frames";
import type { WorldPoint } from "../core/camera";
import type { AssetLibrary } from "../assets/asset-library";
import type { DocumentStore } from "../doc/document-store";
import type { ObjectId, PathObject } from "../doc/model";
import { drawObjects } from "../render/scene-renderer";
import type { EditorState } from "./editor-state";
import type { SceneTheme } from "../render/scene-renderer";
import { projectObject } from "../render/projection";
import type { ProjectedObject } from "../render/projection";
import { visibleObjects } from "../render/scene-view";
import type { FrameIndex } from "../scene/frame-index";
import { cameraIn } from "../scene/frame-index";
import { MAX_AREA, MAX_SIDE } from "./export-size";

export interface ExportTarget {
  /** A sheet (its own box) or the things picked (their box). */
  readonly kind: "sheet" | "selection";
  /** What the file is called: the sheet's name, or what was picked. */
  readonly name: string;
  readonly frame: Frame;
  readonly min: WorldPoint;
  readonly max: WorldPoint;
  /** What is drawn: the picked objects and everything on them. */
  readonly ids: ReadonlySet<ObjectId>;
  /** Width ÷ height of the box. */
  readonly ratio: number;
  /** All of it is vector paths: it can leave as an SVG too. */
  readonly vectors: readonly PathObject[] | null;
  /** One picture, whole: the pixels it has. */
  readonly original: { readonly w: number; readonly h: number } | null;
}

export type Background = "transparent" | "white" | "black";

export interface RenderDeps {
  readonly doc: DocumentStore;
  readonly index: FrameIndex;
  readonly assets: AssetLibrary;
  readonly theme: SceneTheme;
  /** Draw the objects as a gesture shows them before it is committed (a texture's tile following a drag); absent: as stored. */
  readonly editor?: EditorState | null;
}

/** The camera that makes the target's box cover a canvas of `w` × `h` (to within a hundredth of a pixel), centred on it. */
export function exportCamera(t: ExportTarget, w: number, h: number): ReturnType<typeof fromLocal> {
  const lw = D.log2Abs(D.sub(t.max.x, t.min.x)), lh = D.log2Abs(D.sub(t.max.y, t.min.y));
  const level = Math.max(Math.log2(w) - lw, Math.log2(h) - lh);
  const zi = Math.floor(level);
  const zf = Math.ceil((level - zi) / ZOOM_QUANTUM) * ZOOM_QUANTUM; // (rounded up: the box covers the canvas, never leaves a line of it bare)
  const centre = { x: D.shift(D.add(t.min.x, t.max.x), -1), y: D.shift(D.add(t.min.y, t.max.y), -1) };
  return fromLocal(t.frame, lookAt(centre, zi, zf));
}

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * One drawing of the target on `ctx` (`w` × `h` px, the camera fitted to its box). True while something is still being decoded, so the
 * drawing is not final. The one place a target is drawn: Export waits for it (`renderExport`), a texture tile (`render/texture.ts`) takes it once.
 */
export function paintExport(deps: RenderDeps, t: ExportTarget, ctx: CanvasRenderingContext2D, w: number, h: number, bg: Background, withHidden = false): boolean {
  const fc = exportCamera(t, w, h);
  const vp: Viewport = { width: w, height: h };
  ctx.clearRect(0, 0, w, h);
  if (bg !== "transparent") {
    ctx.fillStyle = bg === "white" ? "#ffffff" : "#000000";
    ctx.fillRect(0, 0, w, h);
  }
  let list = visibleObjects(deps.doc, deps.index, deps.editor ?? null, fc, vp).filter((po) => t.ids.has(po.obj.id) && !po.obj.hidden);
  if (deps.editor) {
    // (the canvas shows a selection being moved see-through; a picture of it shows the objects as they will be)
    const moving = deps.editor.previewIds();
    list = list.map((po) => (moving.has(po.obj.id) ? { ...po, obj: { ...po.obj, opacity: deps.doc.get(po.obj.id)?.opacity ?? po.obj.opacity } } : po));
  }
  if (withHidden) {
    // (a texture's tile may be made of objects that are hidden: they are in no index, so they are projected on their own, and put in paint order)
    const extra: ProjectedObject[] = [];
    for (const id of t.ids) {
      const o = deps.doc.get(id);
      const cam = o?.hidden && !o.isMask ? cameraIn(fc, o.frame ?? deps.doc.space.world) : null;
      const po = o && cam ? projectObject(o, cam, vp, { keepTiny: true }) : null;
      if (po) extra.push(po);
    }
    if (extra.length) list = [...list, ...extra].sort((a, b) => a.obj.z - b.obj.z);
  }
  return drawObjects(ctx, list, deps.assets, vp, 1, deps.theme);
}

/**
 * The target drawn on a new canvas of `w` × `h` px (more than the limits is refused). Pictures that are still being decoded are waited
 * for (up to about three seconds), so the file is not left with a blurry stand-in.
 */
export async function renderExport(deps: RenderDeps, t: ExportTarget, w: number, h: number, bg: Background): Promise<HTMLCanvasElement> {
  w = Math.round(w);
  h = Math.round(h);
  if (!(w >= 1 && h >= 1) || w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_AREA) throw new RangeError("that size is more than a picture can be");
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("the browser could not make a picture this size");
  for (let i = 0; i < 60; i++) {
    if (!paintExport(deps, t, ctx, w, h, bg)) break;
    await pause(50);
  }
  return canvas;
}
