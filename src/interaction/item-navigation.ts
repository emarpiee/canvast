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
 * Stepping between items with W A S D, or the keys set in Settings > Shortcuts (ADR 0058, 0072). Three ways to pick the next item:
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
/** ...but between two items that are both in the window it is this much, so the step still goes to what can be seen. */
const SIZE_RATIO_IN_VIEW = 60;
/** ...and by a gap wider than this many of the selected item's own sizes (so the rule means the same at every zoom). */
const REACH = 3;

/**
 * "Nearest in view" (ADR 0058): measured on the screen, among what can be seen near the selected item. An item counts only when
 *  1. it is neither too small to see (under 4 px) nor larger than 16 windows,
 *  2. its size on screen is within a factor of 6 of the selected item's (a much larger or smaller item is another depth, not a neighbour),
 *  3. the gap between it and the selected item is at most 3 sizes of the selected item (a far-off item is not a neighbour; measured in
 *     the item's own size, so stepping works the same after the view has zoomed to the item),
 *  (rules 2 and 3 are relaxed, to a factor of 60 and a gap of a window, between two items that are both in the window: what is on the
 *  screen can be stepped to, however small the selected item is),
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
      // Two items that are both in the window are both in view: a tiny one next to a big one, or a gap of a few of its own sizes, does not
      // put the neighbour out of reach (it is right there on the screen); the size and gap rules are for what is not.
      const both = inWindow(a) && inWindow(b);
      const ratio = both ? SIZE_RATIO_IN_VIEW : SIZE_RATIO;
      if (b.size > a.size * ratio || b.size < a.size / ratio) return [];
      const gap = Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minY - b.maxY, b.minY - a.maxY));
      if (gap > (both ? Math.max(REACH * a.size, Math.max(vp.width, vp.height)) : REACH * a.size)) return [];
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
 * Fit the view to as much as it can show legibly (the second press of the focus key, the "fit everything" button): the widest fit at which nothing
 * becomes a speck. Candidates are the items that are legible now (4 px up to 16 windows) and, with a selection, within a factor of 64 of
 * its size; they are taken nearest first (to the selection, or to the middle of the window) and each is added while, after the fit, every
 * included item is still at least 4 px on screen, the selection (if any) at least 14 px, and nothing is more than 40 windows away. So the
 * scope grows as far as the sizes allow and stops before the view would zoom out to nothing. Returns false when there is nothing to fit.
 */
export function fitAllVisible(doc: DocumentStore, view: ViewState, editor?: EditorState): boolean {
  const vp = view.viewport;
  const cam = view.camera;
  interface Cand {
    o: CanvasObject;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    size: number;
    dist: number;
    picked: boolean;
  }
  const px = (b: { min: WorldPoint; max: WorldPoint }): Omit<Cand, "o" | "dist" | "picked"> => {
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
  const anchor = anchorWorld ? px(anchorWorld) : null;
  const maxSize = MAX_SEEN_VIEWPORTS * Math.max(vp.width, vp.height);
  const reach = 40 * Math.max(vp.width, vp.height);
  const cands: Cand[] = [];
  for (const o of doc.ordered()) {
    if (o.hidden) continue;
    const w = boxIn(view, [o]);
    if (!w) continue;
    const b = px(w);
    const isPicked = !!editor && editor.selection.has(o.id);
    if (!isPicked) {
      if (!(b.size >= MIN_SEEN_PX && b.size <= maxSize)) continue;
      if (anchor && (b.size > anchor.size * 64 || b.size < anchor.size / 64)) continue;
    }
    const dist = anchor
      ? Math.hypot(Math.max(0, anchor.minX - b.maxX, b.minX - anchor.maxX), Math.max(0, anchor.minY - b.maxY, b.minY - anchor.maxY))
      : Math.hypot((b.minX + b.maxX) / 2 - vp.width / 2, (b.minY + b.maxY) / 2 - vp.height / 2);
    if (dist > reach) continue;
    cands.push({ o, ...b, dist, picked: isPicked });
  }
  // The selection first, then nearest first.
  cands.sort((x, y) => Number(y.picked) - Number(x.picked) || x.dist - y.dist);
  const included: Cand[] = [];
  let u = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  let smallest = Infinity;
  for (const c of cands) {
    const next = { minX: Math.min(u.minX, c.minX), maxX: Math.max(u.maxX, c.maxX), minY: Math.min(u.minY, c.minY), maxY: Math.max(u.maxY, c.maxY) };
    const scale = Math.min((0.9 * vp.width) / Math.max(1e-9, next.maxX - next.minX), (0.9 * vp.height) / Math.max(1e-9, next.maxY - next.minY));
    const small = Math.min(smallest, c.size);
    const keepsAnchor = !anchor || (anchor.size * scale >= 14);
    // The first items (the selection) are always in; a later one must not shrink anything below legibility.
    if (included.length && !c.picked && (small * scale < MIN_SEEN_PX || !keepsAnchor)) break;
    included.push(c);
    u = next;
    smallest = small;
  }
  const bounds = boxIn(view, included.map((c) => c.o));
  if (!bounds) return false;
  view.setFrameCamera(fromLocal(view.frame, fitRect(bounds.min, bounds.max, vp, 0.9, zoomLevel(view.camera))));
  return true;
}

/**
 * The focus key (F at first; Settings > Shortcuts) cycles the view: the selection, then everything visible at this zoom, then the selection again.
 * A press with nothing selected fits everything. The cycle only continues while the view is where it left it.
 */
export function createFocusCycle(doc: DocumentStore, view: ViewState, editor: EditorState, zoomOnSelection: () => boolean): { tap(): void; fit(kind: "selection" | "all"): void } {
  let last: { kind: "selection" | "all"; cam: string; sel: string } | null = null;
  const selKey = (): string => [...editor.selection].sort().join(",");
  const here = (): string => JSON.stringify(serializeFrameCamera(view.frameCamera));
  const remember = (kind: "selection" | "all"): void => {
    last = { kind, cam: here(), sel: selKey() };
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
      // The cycle goes on only while the view is where it was left AND the same things are selected: a different selection is a new
      // focus (select another item, press the focus key: the view goes to that one, not out to everything).
      const same = last !== null && last.cam === here() && last.sel === selKey();
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
