/**
 * A picture as it looks, as a PNG: its crop, flip and adjustments, and its watermark (doc/watermark.ts) when it has one. Without a watermark
 * the source pixels are worked on directly (`renderedPicture`); with one, an upright copy of the picture alone is drawn by the export
 * renderer (the same code as the canvas) on a page of its own, at the size of its source pixels.
 */
import * as D from "../core/dyadic";
import type { AssetLibrary } from "../assets/asset-library";
import { cropOf } from "../doc/adjust";
import { DocumentStore } from "../doc/document-store";
import type { ImageObject } from "../doc/model";
import { renderedPicture } from "../render/adjust-image";
import type { SceneTheme } from "../render/scene-renderer";
import { FrameIndex } from "../scene/frame-index";
import { renderExport } from "./export-render";
import { MAX_AREA, MAX_SIDE } from "./export-size";

/** The theme pictures are drawn with (only placeholders use it); set by the app. */
export const bakeTheme: { current: SceneTheme | null } = { current: null };

export async function bakedPicture(o: ImageObject, blob: Blob, assets: AssetLibrary): Promise<Blob | null> {
  if (!o.watermark || !bakeTheme.current) return renderedPicture(blob, o);
  const c = cropOf(o);
  // (the picture's shape as shown, at its source pixels' width; a page too big is made smaller)
  let w = c.w, h = Math.max(1, Math.round((c.w * o.h) / o.w));
  const k = Math.min(1, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)));
  w = Math.max(1, Math.floor(w * k));
  h = Math.max(1, Math.floor(h * k));
  // Only what belongs to the picture's pixels: not its place, turn, corners, outline, see-through or blend (those stay on the instance).
  const { frame: _f, rot: _r, radius: _ra, stroke: _s, width: _w, join: _j, cap: _c, align: _a, dash: _d, dashOffset: _do, miterAngle: _m, blend: _b, mask: _mk, parent: _p, groups: _g, hidden: _h, locked: _l, ...rest } = o;
  const copy: ImageObject = { ...rest, anchor: { x: D.ZERO, y: D.ZERO }, unit: 0, w, h, opacity: 1, attachmentTargetId: null };
  const doc = new DocumentStore();
  doc.load([copy]);
  const index = new FrameIndex(() => doc.space);
  index.rebuild([copy]);
  const t = { kind: "selection" as const, name: "", frame: doc.space.world, min: { x: D.ZERO, y: D.ZERO }, max: { x: D.fromNumber(w), y: D.fromNumber(h) }, ids: new Set([copy.id]), ratio: w / h, vectors: null, original: null };
  const canvas = await renderExport({ doc, index, assets, theme: bakeTheme.current }, t, w, h, "transparent");
  return new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
}
