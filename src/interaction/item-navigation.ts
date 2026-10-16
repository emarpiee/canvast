import * as D from "../core/dyadic";
import type { WorldPoint } from "../core/camera";
import { fitRect, lookAt, worldToScreen, zoomLevel } from "../core/camera";
import { fromLocal, levelsBetween } from "../core/frames";
import type { CanvasObject, ObjectId } from "../doc/model";
import { expressObjectIn } from "../doc/model";
import { unionBounds } from "../doc/edit-ops";
import { isInside, unitKey } from "../doc/groups";
import type { DocumentStore } from "../doc/document-store";
import type { EditorState } from "../app/editor-state";
import type { ViewState } from "../app/view-state";

/**
 * Stepping between items with Ctrl+arrow (ADR 0058). Three ways to pick the next item:
 *  - "view":     the nearest item in the direction, measured on the screen; items too small to see (too deep) or far larger than the
 *                window (too high) are ignored, so the step stays among what can be seen at this zoom.
 *  - "anywhere": the nearest item in the direction by position alone, at any depth and size.
 *  - "layer":    the next item up or down the paint order (top-most first), wherever it is.
 * A group counts as one item. Nothing here moves an item: it only changes the selection and the camera.
 */
export type NavMode = "view" | "anywhere" | "layer";
export type NavDir = "left" | "right" | "up" | "down";

/** On-screen size (px) outside which an item is ignored by the "view" mode. */
const MIN_SEEN_PX = 4;
const MAX_SEEN_VIEWPORTS = 16;
/** Fraction of the window a focused item fills. */
export const FOCUS_FILL = 0.6;

interface Unit {
  key: string;
  members: CanvasObject[];
  z: number;
}

/** The items (groups as one) that can be stepped to at the level the user is working at. */
function unitsOf(doc: DocumentStore, editor: EditorState): Unit[] {
  const level = editor.entered.length;
  const map = new Map<string, Unit>();
  for (const o of doc.ordered()) {
    if (o.hidden || o.locked || !isInside(o, editor.entered)) continue;
    const key = unitKey(o, level);
    const u = map.get(key);
    if (u) {
      u.members.push(o);
      u.z = Math.max(u.z, o.z);
    } else map.set(key, { key, members: [o], z: o.z });
  }
  return [...map.values()];
}

/** The exact box of some objects expressed in the frame the camera is in (null if they cannot be expressed there). */
function boxIn(view: ViewState, objects: readonly CanvasObject[]): { min: WorldPoint; max: WorldPoint } | null {
  try {
    return unionBounds(objects.map((o) => expressObjectIn(o, view.frame)));
  } catch {
    return null;
  }
}

const centreOf = (b: { min: WorldPoint; max: WorldPoint }): WorldPoint => ({ x: D.shift(D.add(b.min.x, b.max.x), -1), y: D.shift(D.add(b.min.y, b.max.y), -1) });

/** Pick the item to go to from the current selection (null: stay where you are). */
export function pickNeighbour(doc: DocumentStore, view: ViewState, editor: EditorState, dir: NavDir, mode: NavMode): ObjectId[] | null {
  const units = unitsOf(doc, editor);
  if (units.length === 0) return null;
  const selected = new Set(editor.selection);
  const anchors = units.filter((u) => u.members.some((m) => selected.has(m.id)));

  if (mode === "layer") {
    const order = [...units].sort((a, b) => b.z - a.z || a.key.localeCompare(b.key));
    if (anchors.length === 0) return order[0]!.members.map((m) => m.id);
    const top = Math.min(...anchors.map((a) => order.indexOf(a)));
    const bottom = Math.max(...anchors.map((a) => order.indexOf(a)));
    const forward = dir === "down" || dir === "right";
    const next = order[forward ? bottom + 1 : top - 1];
    return next ? next.members.map((m) => m.id) : null;
  }

  const vp = view.viewport;
  const cam = view.camera;
  const boxes = new Map<Unit, { min: WorldPoint; max: WorldPoint }>();
  for (const u of units) {
    const b = boxIn(view, u.members);
    if (b) boxes.set(u, b);
  }
  /** Apparent size on screen in px (the larger side). */
  const seenPx = (b: { min: WorldPoint; max: WorldPoint }): number => {
    const a = worldToScreen(cam, vp, b.min);
    const c = worldToScreen(cam, vp, b.max);
    return Math.max(Math.abs(c.x - a.x), Math.abs(c.y - a.y));
  };
  const inView = (u: Unit): boolean => {
    const b = boxes.get(u);
    if (!b) return false;
    const px = seenPx(b);
    return px >= MIN_SEEN_PX && px <= MAX_SEEN_VIEWPORTS * Math.max(vp.width, vp.height);
  };

  const anchorBox = anchors.length ? boxIn(view, anchors.flatMap((a) => a.members)) : null;
  // The point steps start from: the selection, or (nothing selected) the middle of the window.
  const origin: WorldPoint = anchorBox ? centreOf(anchorBox) : cam.center;
  const pool = units.filter((u) => !anchors.includes(u) && boxes.has(u) && (mode === "anywhere" || inView(u)));
  if (pool.length === 0) return null;

  const offs = pool.map((u) => {
    const c = centreOf(boxes.get(u)!);
    return { u, dx: D.sub(c.x, origin.x), dy: D.sub(c.y, origin.y) };
  });
  if (!anchorBox) {
    // Nothing selected: the item nearest the middle of the window, whatever the direction.
    const nearest = offs.reduce((best, o) => (Math.max(D.log2Abs(o.dx), D.log2Abs(o.dy)) < Math.max(D.log2Abs(best.dx), D.log2Abs(best.dy)) ? o : best));
    return nearest.u.members.map((m) => m.id);
  }
  // Scale the offsets so the nearest is about 1; farther ones may overflow, which only ranks them last.
  const mags = offs.map((o) => Math.max(D.log2Abs(o.dx), D.log2Abs(o.dy))).filter((m) => Number.isFinite(m));
  const k = mags.length ? -Math.floor(Math.min(...mags)) : 0;
  let best: { u: Unit; score: number; dist: number } | null = null;
  for (const o of offs) {
    const sx = D.toNumber(D.shift(o.dx, k));
    const sy = D.toNumber(D.shift(o.dy, k));
    const forward = dir === "left" ? -sx : dir === "right" ? sx : dir === "up" ? -sy : sy;
    // Screen y grows downward; in world space the camera maps the same way, so "up" is negative.
    if (!(forward > 0)) continue;
    const lateral = dir === "left" || dir === "right" ? Math.abs(sy) : Math.abs(sx);
    const score = forward + lateral * 1.5;
    const dist = Math.hypot(sx, sy);
    if (!best || score < best.score || (score === best.score && dist < best.dist)) best = { u: o.u, score, dist };
  }
  return best ? best.u.members.map((m) => m.id) : null;
}

/** Frame objects in the view: fill part of the window (`zoom`), or only bring them to the middle at the present zoom. */
export function focusObjects(doc: DocumentStore, view: ViewState, ids: readonly ObjectId[], zoom: boolean): void {
  const objects = ids.map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o);
  if (objects.length === 0) return;
  // Frame in the first object's own frame: the others are re-expressed there exactly (so deep items stay cheap and exact).
  const f = objects[0]!.frame ?? doc.space.world;
  const bounds = unionBounds(objects.map((o) => expressObjectIn(o, f)));
  if (!bounds) return;
  const here = zoomLevel(view.camera) + levelsBetween(f, view.frame);
  if (zoom) view.setFrameCamera(fromLocal(f, fitRect(bounds.min, bounds.max, view.viewport, FOCUS_FILL, here)));
  else view.setFrameCamera(fromLocal(f, lookAt(centreOf(bounds), Math.floor(here), here - Math.floor(here))));
}

/** Step from the selection to a neighbour and bring it into view. Returns whether anything changed. */
export function stepToNeighbour(doc: DocumentStore, view: ViewState, editor: EditorState, dir: NavDir, mode: NavMode, zoom: boolean): boolean {
  const ids = pickNeighbour(doc, view, editor, dir, mode);
  if (!ids) return false;
  editor.select(ids);
  focusObjects(doc, view, ids, zoom);
  return true;
}
