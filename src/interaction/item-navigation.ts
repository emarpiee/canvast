import * as D from "../core/dyadic";
import type { WorldPoint } from "../core/camera";
import { fitRect, lookAt, worldToScreen, zoomLevel } from "../core/camera";
import { fromLocal, levelsBetween, serializeFrameCamera } from "../core/frames";
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
  const anchorBox = anchors.length ? boxIn(view, anchors.flatMap((a) => a.members)) : null;
  const pool = units.filter((u) => !anchors.includes(u) && boxes.has(u));
  if (pool.length === 0) return null;

  if (mode === "view") return pickInView(pool, boxes, anchorBox, anchors.length > 0, dir, view);

  // "Nearest anywhere": by position alone, exact at any depth.
  const origin: WorldPoint = anchorBox ? centreOf(anchorBox) : cam.center;
  const offs = pool.map((u) => {
    const c = centreOf(boxes.get(u)!);
    return { u, dx: D.sub(c.x, origin.x), dy: D.sub(c.y, origin.y) };
  });
  const mag = (o: { dx: D.Dyadic; dy: D.Dyadic }): number => Math.max(D.log2Abs(o.dx), D.log2Abs(o.dy));
  if (!anchorBox) {
    // Nothing selected: the item nearest the middle of the window, whatever the direction.
    return offs.reduce((best, o) => (mag(o) < mag(best) ? o : best)).u.members.map((m) => m.id);
  }
  // Scale the offsets so the nearest is about 1; farther ones may overflow, which only ranks them last.
  const mags = offs.map(mag).filter((m) => Number.isFinite(m));
  const k = mags.length ? -Math.floor(Math.min(...mags)) : 0;
  let best: { u: Unit; score: number } | null = null;
  for (const o of offs) {
    const sx = D.toNumber(D.shift(o.dx, k));
    const sy = D.toNumber(D.shift(o.dy, k));
    const horizontal = dir === "left" || dir === "right";
    const forward = dir === "left" ? -sx : dir === "right" ? sx : dir === "up" ? -sy : sy;
    const across = Math.abs(horizontal ? sy : sx);
    // In the direction pressed: ahead, and not more than about 56 degrees off the line.
    if (!(forward > 0) || across > forward * CONE) continue;
    const score = forward + across * 2;
    if (!best || score < best.score) best = { u: o.u, score };
  }
  return best ? best.u.members.map((m) => m.id) : null;
}

/** How far off the arrow's line a neighbour may lie: across <= ahead x CONE (about 56 degrees). */
const CONE = 1.5;
/** "Nearest in view" ignores items whose size on screen differs from the selected one's by more than this factor. */
const SIZE_RATIO = 6;
/** ...and by a gap wider than this many of the selected item's own sizes (so the rule means the same at every zoom). */
const REACH = 3;

/**
 * "Nearest in view" (ADR 0058): measured on the screen, among what can be seen near the selected item. An item counts only when
 *  1. it is neither too small to see (under 4 px) nor larger than 16 windows,
 *  2. its size on screen is within a factor of 6 of the selected item's (a much larger or smaller item is another depth, not a neighbour),
 *  3. the gap between it and the selected item is at most 3 sizes of the selected item (a far-off item is not a neighbour; measured in
 *     the item's own size, so stepping works the same after the view has zoomed to the item),
 * and it lies ahead in the direction pressed, within about 56 degrees of that line, or overlapping the selected item across it.
 * Of those the nearest wins (distance ahead, and twice the sideways offset). Nothing qualifying: the selection stays.
 * With nothing selected the first step picks the visible item nearest the middle of the window.
 */
function pickInView(
  pool: readonly Unit[],
  boxes: ReadonlyMap<Unit, { min: WorldPoint; max: WorldPoint }>,
  anchorBox: { min: WorldPoint; max: WorldPoint } | null,
  hasAnchor: boolean,
  dir: NavDir,
  view: ViewState,
): ObjectId[] | null {
  const vp = view.viewport;
  const cam = view.camera;
  interface Px {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    cx: number;
    cy: number;
    size: number;
  }
  const px = (b: { min: WorldPoint; max: WorldPoint }): Px => {
    const a = worldToScreen(cam, vp, b.min);
    const c = worldToScreen(cam, vp, b.max);
    const minX = Math.min(a.x, c.x);
    const maxX = Math.max(a.x, c.x);
    const minY = Math.min(a.y, c.y);
    const maxY = Math.max(a.y, c.y);
    return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, size: Math.max(maxX - minX, maxY - minY) };
  };
  const legible = (b: Px): boolean => b.size >= MIN_SEEN_PX && b.size <= MAX_SEEN_VIEWPORTS * Math.max(vp.width, vp.height);
  const inWindow = (b: Px): boolean => b.maxX > 0 && b.minX < vp.width && b.maxY > 0 && b.minY < vp.height;
  const a = anchorBox ? px(anchorBox) : null;
  const cands = pool.flatMap((u) => {
    const b = px(boxes.get(u)!);
    if (!legible(b)) return [];
    if (a) {
      if (b.size > a.size * SIZE_RATIO || b.size < a.size / SIZE_RATIO) return [];
      const gap = Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minY - b.maxY, b.minY - a.maxY));
      if (gap > REACH * a.size) return [];
    } else if (!inWindow(b)) return [];
    return [{ u, b }];
  });
  if (!a || !hasAnchor) {
    // Nothing selected: the nearest to the middle of the window.
    const mx = vp.width / 2;
    const my = vp.height / 2;
    const first = cands.reduce<{ u: Unit; d: number } | null>((best, c) => {
      const d = Math.hypot(c.b.cx - mx, c.b.cy - my);
      return !best || d < best.d ? { u: c.u, d } : best;
    }, null);
    return first ? first.u.members.map((m) => m.id) : null;
  }
  const horizontal = dir === "left" || dir === "right";
  let best: { u: Unit; score: number } | null = null;
  for (const { u, b } of cands) {
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const forward = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy;
    if (!(forward > 0)) continue;
    const across = Math.abs(horizontal ? dy : dx);
    // Overlapping the selected item across the arrow's line counts as straight ahead.
    const overlaps = horizontal ? b.minY < a.maxY && b.maxY > a.minY : b.minX < a.maxX && b.maxX > a.minX;
    if (!overlaps && across > forward * CONE) continue;
    const score = forward + across * 2;
    if (!best || score < best.score) best = { u, score };
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

/**
 * Fit the view to everything that counts as visible at this zoom (the second tap of Alt, the "fit everything" button).
 *  - With a selection: the selected items and every other item that is legible (4 px up to 16 windows), within a factor of 8 of the
 *    selection's size, and not more than 12 selection-sizes away. That is what "at this zoom" means: the same depth, and near, however
 *    far the view has zoomed in on the selection. Items far off or of a very different size stay out.
 *  - With nothing selected: the items near the window (within 3 window-widths of it) that are legible and at most 4 windows large.
 * Returns false when there is nothing to fit.
 */
export function fitAllVisible(doc: DocumentStore, view: ViewState, editor?: EditorState): boolean {
  const vp = view.viewport;
  const cam = view.camera;
  interface Px {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    size: number;
  }
  const pxBox = (b: { min: WorldPoint; max: WorldPoint }): Px => {
    const a = worldToScreen(cam, vp, b.min);
    const c = worldToScreen(cam, vp, b.max);
    const minX = Math.min(a.x, c.x);
    const maxX = Math.max(a.x, c.x);
    const minY = Math.min(a.y, c.y);
    const maxY = Math.max(a.y, c.y);
    return { minX, maxX, minY, maxY, size: Math.max(maxX - minX, maxY - minY) };
  };
  const picked = editor ? doc.ordered().filter((o) => editor.selection.has(o.id)) : [];
  const anchorWorld = picked.length ? boxIn(view, picked) : null;
  const anchor = anchorWorld ? pxBox(anchorWorld) : null;
  const near: CanvasObject[] = [...picked];
  const reachX = 3 * vp.width;
  const reachY = 3 * vp.height;
  for (const o of doc.ordered()) {
    if (o.hidden || (editor && editor.selection.has(o.id))) continue;
    const w = boxIn(view, [o]);
    if (!w) continue;
    const b = pxBox(w);
    if (anchor) {
      if (!(b.size >= MIN_SEEN_PX && b.size <= MAX_SEEN_VIEWPORTS * Math.max(vp.width, vp.height))) continue;
      if (b.size > anchor.size * 8 || b.size < anchor.size / 8) continue;
      const gap = Math.hypot(Math.max(0, anchor.minX - b.maxX, b.minX - anchor.maxX), Math.max(0, anchor.minY - b.maxY, b.minY - anchor.maxY));
      if (gap > 12 * anchor.size) continue;
    } else {
      if (!(b.size >= MIN_SEEN_PX && b.size <= 4 * Math.max(vp.width, vp.height))) continue;
      if (b.maxX < -reachX || b.minX > vp.width + reachX || b.maxY < -reachY || b.minY > vp.height + reachY) continue;
    }
    near.push(o);
  }
  const bounds = boxIn(view, near);
  if (!bounds) return false;
  view.setFrameCamera(fromLocal(view.frame, fitRect(bounds.min, bounds.max, vp, 0.9, zoomLevel(view.camera))));
  return true;
}

/**
 * Alt, pressed and released alone, cycles the view: the selection, then everything visible at this zoom, then the selection again.
 * A press with nothing selected fits everything. The cycle only continues while the view is where it left it.
 */
export function createFocusCycle(doc: DocumentStore, view: ViewState, editor: EditorState, zoomOnSelection: () => boolean): { tap(): void; fit(kind: "selection" | "all"): void } {
  let last: { kind: "selection" | "all"; cam: string } | null = null;
  const here = (): string => JSON.stringify(serializeFrameCamera(view.frameCamera));
  const remember = (kind: "selection" | "all"): void => {
    last = { kind, cam: here() };
  };
  const all = (): void => {
    if (fitAllVisible(doc, view, editor)) remember("all");
    else {
      editor.message = "Nothing to fit at this zoom.";
      editor.changed();
    }
  };
  const selection = (): void => {
    if (!editor.selection.size) return all();
    focusObjects(doc, view, [...editor.selection], zoomOnSelection());
    remember("selection");
  };
  return {
    tap() {
      const same = last !== null && last.cam === here();
      if (!editor.selection.size) return all();
      if (same && last!.kind === "selection") return all();
      return selection();
    },
    fit(kind) {
      if (kind === "all") all();
      else selection();
    },
  };
}
