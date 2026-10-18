import { lookFromChoices } from "../doc/stroke-look";
import type { Viewport } from "../core/camera";
import type { FrameCamera } from "../core/frames";
import { cameraIn } from "../scene/frame-index";
import type { EditorState } from "../app/editor-state";
import type { AssetLibrary } from "../assets/asset-library";
import type { ProjectedObject, ScreenBox } from "./projection";
import { projectObject } from "./projection";
import type { RasterSource } from "./draw-objects";
import { addFillPath, batchable, drawCover, drawImageObject, drawPath, drawStroke, strokeBatch, strokeLineWidth } from "./draw-objects";
import type { PathObject, StrokeObject } from "../doc/model";
import { NODE, drawnSubs } from "../doc/path";
import { shapeHandles, gradientHandles, nodesOnScreen } from "../interaction/path-edit";
import { rasterKey } from "../doc/model";
import { drawText } from "./draw-text";
import type { Pt, SelectionFrame } from "./selection-frame";
import { expandStroke } from "../interaction/pens";
import { LABEL_FONT } from "./item-label";
import type { ItemLabel } from "./item-label";
import { cropOf } from "../doc/adjust";
import { itemCorners, rotateHandleAt, selectionFrame } from "./selection-frame";

export interface SceneTheme {
  selection: string;
  /** The names of sheets, and of landmarks. */
  landmarkLabel: string;
  handleFill: string;
  lasso: string;
  imagePlaceholder: string;
  /** Eraser brush and its touched boxes. */
  danger: string;
  dangerWash: string;
  /** Snap guide lines. */
  guide: string;
}

export const HANDLE_SIZE_PX = 9;

/**
 * Batch runs over a whole paint-ordered list: consecutive opaque fast-path
 * strokes of one colour and width (within 1/64 px) share a run number;
 * everything else gets a run of its own. A tile draws a subset of the list
 * and keeps these runs, so it batches exactly as a full frame does.
 */
export function batchRuns(list: readonly ProjectedObject[]): Map<ProjectedObject, number> {
  const runs = new Map<ProjectedObject, number>();
  let id = 0;
  let color = "";
  let width = 0;
  let open = false;
  for (const po of list) {
    if (batchable(po)) {
      const w = strokeLineWidth(po);
      const c = (po.obj as StrokeObject).color;
      if (!open || c !== color || Math.abs(w - width) > 1 / 64) {
        id++;
        color = c;
        width = w;
        open = true;
      }
    } else {
      id++;
      open = false;
    }
    runs.set(po, id);
  }
  return runs;
}

/**
 * Draw objects in paint order. Runs of identical opaque strokes share a
 * call (`runs` from batchRuns over the full frame list; computed here when
 * omitted). Returns true if an image was drawn as a placeholder because its
 * original is still loading (or missing).
 */
/** How many CSS px the longer side of a projected image takes on screen. */
const shownEdge = (po: ProjectedObject): number => {
  if (po.obj.kind !== "image") return Infinity;
  // (what the whole source would take on screen: a crop shows only a window of it)
  const c = cropOf(po.obj);
  return po.proj.ppu * Math.max((po.obj.w * po.obj.pixelW) / c.w, (po.obj.h * po.obj.pixelH) / c.h);
};

export function drawObjects(
  ctx: CanvasRenderingContext2D,
  list: readonly ProjectedObject[],
  assets: AssetLibrary,
  vp: Viewport,
  dpr: number,
  theme: SceneTheme,
  runs: ReadonlyMap<ProjectedObject, number> = batchRuns(list),
): boolean {
  let pending = false;
  let run: ProjectedObject[] = [];
  let runId = -1;
  const flush = (): void => {
    if (run.length) strokeBatch(ctx, run, strokeLineWidth(run[0]!), vp);
    run = [];
  };
  for (const po of list) {
    if (batchable(po)) {
      const r = runs.get(po) ?? -1;
      if (run.length && r !== runId) flush();
      runId = r;
      run.push(po);
      continue;
    }
    flush();
    // On a clipping sheet (ADR 0108): cut by the sheet's shape (rounded corners, turned, exact at depth, as it is drawn itself).
    if (po.clip) {
      ctx.save();
      for (const c of po.clip) {
        ctx.beginPath();
        addFillPath(ctx, c, vp);
        ctx.clip(c.obj.kind === "path" && c.obj.evenodd ? "evenodd" : "nonzero");
      }
    }
    if (po.rotated) {
      // A turned image or text: draw the unturned one into the widened viewport, with the canvas turned.
      const t = po.rotated;
      ctx.save();
      ctx.translate(t.cx, t.cy);
      ctx.rotate(Math.atan2(t.s, t.c));
      ctx.translate(-t.vvp.width / 2, -t.vvp.height / 2);
      if (po.obj.kind === "text") drawText(ctx, t.inner, t.vvp, dpr);
      else if (po.obj.kind === "image") {
        const shown = shownEdge(t.inner);
        const edge = po.obj.media ? 0 : Math.max(po.obj.pixelW, po.obj.pixelH);
        const key = rasterKey(po.obj);
        const src = assets.get(key, shown, edge);
        if (!src || !assets.wantedReady(key, shown, edge)) pending = true;
        drawImageObject(ctx, t.inner, t.vvp, dpr, src, theme.imagePlaceholder, 0.5);
      }
      ctx.restore();
    } else if (po.cover) {
      const src = po.obj.kind === "image" ? assets.get(rasterKey(po.obj)) : null;
      if (po.obj.kind === "image" && !src) pending = true;
      drawCover(ctx, po, vp, src, theme.imagePlaceholder);
    } else if (po.obj.kind === "stroke") drawStroke(ctx, po, vp);
    else if (po.obj.kind === "text") drawText(ctx, po, vp, dpr);
    else if (po.obj.kind === "path") drawPath(ctx, po, vp);
    else {
      const shown = shownEdge(po);
      const edge = po.obj.media ? 0 : Math.max(po.obj.pixelW, po.obj.pixelH);
      const key = rasterKey(po.obj);
      const src = assets.get(key, shown, edge);
      if (!src || !assets.wantedReady(key, shown, edge)) pending = true;
      drawImageObject(ctx, po, vp, dpr, src, theme.imagePlaceholder);
    }
    if (po.clip) ctx.restore();
  }
  flush();
  return pending;
}

/**
 * Everything drawn on top of committed objects, never cached: the stroke
 * being drawn, selection outlines and handles (`selected` holds the visible
 * selected objects), lasso and marquee.
 */
export function drawOverlays(
  ctx: CanvasRenderingContext2D,
  selected: readonly ProjectedObject[],
  editor: EditorState,
  fc: FrameCamera,
  vp: Viewport,
  theme: SceneTheme,
  members: readonly ProjectedObject[] = [],
  labels: readonly ItemLabel[] = [],
): void {
  // The names above the items (ADR 0108, 0125).
  if (labels.length) {
    ctx.save();
    ctx.font = LABEL_FONT;
    ctx.textBaseline = "middle";
    for (const l of labels) {
      ctx.fillStyle = editor.selection.has(l.id) ? theme.selection : theme.landmarkLabel;
      ctx.save();
      ctx.beginPath();
      ctx.rect(l.x, l.y, l.w, l.h);
      ctx.clip();
      ctx.fillText(l.text, l.x + 4, l.y + l.h / 2);
      ctx.restore();
    }
    ctx.restore();
  }
  // The members of the boolean group that has been entered, as outlines over its result (ADR 0103).
  if (members.length) {
    ctx.save();
    ctx.strokeStyle = theme.selection;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.85;
    for (const po of members) {
      if (po.cover || !po.path) continue;
      ctx.beginPath();
      for (const f of po.path) {
        const p = f.pts;
        if (p.length < 4) continue;
        ctx.moveTo(p[0]!, p[1]!);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
        if (f.closed) ctx.closePath();
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  // Object eraser: the brush, and what the swipe has touched so far (it is removed when the pointer is released).
  if (editor.tool === "eraser" && editor.eraser) {
    ctx.save();
    for (const b of editor.eraser.boxes) {
      ctx.fillStyle = theme.dangerWash;
      ctx.strokeStyle = theme.danger;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    }
    if (editor.eraser.at) {
      ctx.setLineDash([]);
      ctx.strokeStyle = theme.danger;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(editor.eraser.at.x, editor.eraser.at.y, editor.eraserPx / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Snap guides: where the moving selection lines up with another object.
  if (editor.guides) {
    ctx.save();
    ctx.strokeStyle = theme.guide;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    if (editor.guides.x !== undefined) {
      ctx.moveTo(Math.round(editor.guides.x) + 0.5, 0);
      ctx.lineTo(Math.round(editor.guides.x) + 0.5, vp.height);
    }
    if (editor.guides.y !== undefined) {
      ctx.moveTo(0, Math.round(editor.guides.y) + 0.5);
      ctx.lineTo(vp.width, Math.round(editor.guides.y) + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }
  // In-progress stroke, drawn through the same projection as committed ones (with the camera in its frame).
  for (const d of [...editor.draftDone, ...(editor.draft ? [editor.draft] : [])]) {
    const cam = cameraIn(fc, d.frame);
    if (!cam || d.points.length < 2) continue;
    // The pen's own strokes, so what is drawn while drawing is what is committed.
    for (const piece of expandStroke(d.kind, { points: d.points, width: d.width, ...(d.pressure ? { pressure: d.pressure } : {}), ...(d.speed ? { speed: d.speed } : {}) })) {
      const draft: StrokeObject = {
        id: DRAFT_ID,
        kind: "stroke",
        anchor: d.anchor,
        unit: d.unit,
        z: Infinity,
        opacity: piece.opacity,
        attachmentTargetId: null,
        points: piece.points,
        width: piece.width,
        color: d.color,
      };
      const po = projectObject(draft, cam, vp, { keepTiny: true });
      if (po) drawStroke(ctx, po, vp);
    }
  }

  // The shape being dragged out and the path being drawn, through the same projection as committed paths.
  const sd = editor.shapeDraft;
  if (sd && (sd.bw || sd.bh)) {
    const cam = cameraIn(fc, sd.frame);
    const draft: PathObject = {
      id: DRAFT_ID,
      kind: "path",
      anchor: sd.anchor,
      unit: sd.unit,
      z: Infinity,
      opacity: 1,
      attachmentTargetId: null,
      sub: drawnSubs(sd.kind, sd.bx, sd.by, sd.bw, sd.bh, sd.sides, sd.tips),
      fill: sd.fill,
      stroke: sd.stroke,
      width: sd.width,
      ...lookFromChoices(editor.shapeJoin, editor.shapeCap, editor.shapeAlign, sd.kind === "rect" || sd.kind === "polygon" || sd.kind === "star" ? "miter" : undefined, editor.shapeDash),
    };
    const po = cam && projectObject(draft, cam, vp, { keepTiny: true });
    if (po) drawPath(ctx, po, vp);
  }
  const pd = editor.pathDraft;
  if (pd && pd.n.length) {
    const cam = cameraIn(fc, pd.frame);
    // The nodes so far, and a last segment running to the pointer.
    const n = pd.cursor ? [...pd.n, pd.cursor.x, pd.cursor.y, pd.cursor.x, pd.cursor.y, pd.cursor.x, pd.cursor.y] : pd.n;
    const draft: PathObject = {
      id: DRAFT_ID,
      kind: "path",
      anchor: pd.anchor,
      unit: pd.unit,
      z: Infinity,
      opacity: 1,
      attachmentTargetId: null,
      sub: [{ n, closed: false }],
      fill: null,
      stroke: pd.stroke ?? "#1f2329",
      width: pd.width,
      ...lookFromChoices(editor.shapeJoin, editor.shapeCap, "centre", undefined, editor.shapeDash),
    };
    const po = cam && projectObject(draft, cam, vp, { keepTiny: true });
    if (po && !po.cover) {
      drawPath(ctx, po, vp);
      ctx.save();
      ctx.strokeStyle = theme.selection;
      ctx.fillStyle = theme.handleFill;
      ctx.lineWidth = 1.25;
      const nodes = nodesOnScreen(po);
      nodes.slice(0, pd.n.length / NODE).forEach((m, i) => {
        const h = i === 0 ? HANDLE_SIZE_PX + 2 : HANDLE_SIZE_PX - 2; // the first is larger: pressing it closes the path
        ctx.fillRect(m.p[0] - h / 2, m.p[1] - h / 2, h, h);
        ctx.strokeRect(m.p[0] - h / 2, m.p[1] - h / 2, h, h);
      });
      ctx.restore();
    }
  }

  drawSelection(ctx, selected, editor, theme, vp);
  if (editor.tool === "node") drawNodes(ctx, selected, editor, theme);
  if (editor.tool === "select") drawCornerHandles(ctx, selected, editor, theme);
  if (editor.tool === "select" || editor.tool === "node") drawGradientHandles(ctx, selected, theme, editor.gradientFocus);

  if (editor.lasso && editor.lasso.length >= 4) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = theme.lasso;
    ctx.beginPath();
    ctx.moveTo(editor.lasso[0]!, editor.lasso[1]!);
    for (let i = 2; i < editor.lasso.length; i += 2) ctx.lineTo(editor.lasso[i]!, editor.lasso[i + 1]!);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  if (editor.marquee) {
    const m = editor.marquee;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = theme.lasso;
    ctx.strokeRect(Math.min(m.x0, m.x1) + 0.5, Math.min(m.y0, m.y1) + 0.5, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
    ctx.restore();
  }
}

/** Nodes and handles of the one selected path, for the Edit nodes tool: squares for nodes, circles for the handles of the selected one. */
function drawNodes(ctx: CanvasRenderingContext2D, selected: readonly ProjectedObject[], editor: EditorState, theme: SceneTheme): void {
  if (selected.length !== 1) return;
  const po = selected[0]!;
  if (po.obj.kind !== "path" || po.cover) return;
  const half = HANDLE_SIZE_PX / 2;
  const sel = editor.nodeSel;
  ctx.save();
  ctx.strokeStyle = theme.selection;
  ctx.lineWidth = 1.25;
  const nodes = nodesOnScreen(po);
  for (const n of nodes) {
    if (!sel || n.s !== sel.s || n.k !== sel.k) continue;
    // The handles of the selected node, each on a line from it.
    ctx.fillStyle = theme.handleFill;
    for (const [on, h] of [[n.hasIn, n.i], [n.hasOut, n.o]] as const) {
      if (!on) continue;
      ctx.beginPath();
      ctx.moveTo(n.p[0], n.p[1]);
      ctx.lineTo(h[0], h[1]);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(h[0], h[1], half - 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  for (const n of nodes) {
    const on = !!sel && n.s === sel.s && n.k === sel.k;
    ctx.fillStyle = on ? theme.selection : theme.handleFill;
    ctx.fillRect(n.p[0] - half + 1, n.p[1] - half + 1, HANDLE_SIZE_PX - 2, HANDLE_SIZE_PX - 2);
    ctx.strokeRect(n.p[0] - half + 1, n.p[1] - half + 1, HANDLE_SIZE_PX - 2, HANDLE_SIZE_PX - 2);
  }
  ctx.restore();
}

/** The main corner radius dot (large, filled), one small dot per corner when the corners are opened out, and a star's ratio handle (ADR 0105). */
function drawCornerHandles(ctx: CanvasRenderingContext2D, selected: readonly ProjectedObject[], editor: EditorState, theme: SceneTheme): void {
  if (selected.length !== 1 || selected[0]!.obj.kind !== "path") return;
  const po = selected[0]!;
  if (editor.selection.size !== 1 && (po.obj as PathObject).result === undefined) return; // (a group picked whole is its result alone on screen)
  const open = editor.cornersOpen === po.obj.id;
  const h = shapeHandles(po, open, editor);
  if (!h) return;
  ctx.save();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = theme.selection;
  if (open) {
    // One corner's own radius: a small ring with a dot in it.
    for (const d of h.corners) {
      ctx.fillStyle = theme.handleFill;
      ctx.beginPath();
      ctx.arc(d.x, d.y, HANDLE_SIZE_PX / 2 - 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = theme.selection;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (h.main) {
    // The one that sets them all: bigger than the rest, filled, with a ring round it.
    ctx.fillStyle = theme.selection;
    ctx.beginPath();
    ctx.arc(h.main.x, h.main.y, HANDLE_SIZE_PX / 2 + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = theme.handleFill;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = theme.selection;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(h.main.x, h.main.y, HANDLE_SIZE_PX / 2 + 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  const r = HANDLE_SIZE_PX / 2 + 1;
  if (h.ratio) {
    // The ratio of a star: a diamond.
    ctx.fillStyle = theme.selection;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(h.ratio.x, h.ratio.y - r);
    ctx.lineTo(h.ratio.x + r, h.ratio.y);
    ctx.lineTo(h.ratio.x, h.ratio.y + r);
    ctx.lineTo(h.ratio.x - r, h.ratio.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = theme.handleFill;
    ctx.stroke();
  }
  if (h.count) {
    // How many corners: a triangle pointing the way round the middle that it is dragged.
    const k = h.count;
    const a = Math.atan2(k.y - k.cy, k.x - k.cx) + Math.PI / 2;
    ctx.fillStyle = theme.handleFill;
    ctx.strokeStyle = theme.selection;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const t = a + (i * 2 * Math.PI) / 3;
      const px = k.x + Math.sin(t) * (r + 2);
      const py = k.y - Math.cos(t) * (r + 2);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  if (editor.handleLabel?.guide) {
    // The line the handle slides along, with an arrowhead at each end: the way it moves is shown before and while it is dragged.
    const { x0, y0, x1, y1 } = editor.handleLabel.guide;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len > 4) {
      const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
      ctx.strokeStyle = theme.selection;
      ctx.fillStyle = theme.selection;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [x, y, d] of [[x0, y0, -1], [x1, y1, 1]] as const) {
        const tx = x + ux * 5 * d, ty = y + uy * 5 * d;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x - uy * 4, y + ux * 4);
        ctx.lineTo(x + uy * 4, y - ux * 4);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  if (editor.handleLabel) {
    // What is being changed, and to what, beside the handle.
    const { x, y, text } = editor.handleLabel;
    ctx.font = "600 12px system-ui, sans-serif";
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = theme.selection;
    ctx.beginPath();
    ctx.roundRect(x + 14, y - 26, w, 20, 5);
    ctx.fill();
    ctx.fillStyle = theme.handleFill;
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 20, y - 16);
  }
  ctx.restore();
}

/** The axis or the rings of the gradient of the one selected path, with handles to drag (ADR 0100). */
function drawGradientHandles(ctx: CanvasRenderingContext2D, selected: readonly ProjectedObject[], theme: SceneTheme, focus: "fill" | "stroke" | null): void {
  if (selected.length !== 1 || selected[0]!.obj.kind !== "path") return;
  const h = gradientHandles(selected[0]!, focus);
  if (!h) return;
  ctx.save();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = theme.selection;
  ctx.fillStyle = theme.handleFill;
  if (h.ring) {
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(h.ring.x, h.ring.y, Math.min(h.ring.r, 1e5), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.beginPath();
    ctx.moveTo(h.pts[0]!.x, h.pts[0]!.y);
    ctx.lineTo(h.pts[1]!.x, h.pts[1]!.y);
    ctx.stroke();
    for (const s of h.stops) {
      // a stop on the axis, in its own colour
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.arc(s.x, s.y, HANDLE_SIZE_PX / 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = theme.handleFill;
  }
  for (const q of h.pts) {
    ctx.beginPath();
    ctx.arc(q.x, q.y, HANDLE_SIZE_PX / 2 + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** Placeholder id for the in-progress stroke; never stored. */
const DRAFT_ID = "0".repeat(32);

function clampBox(b: ScreenBox, vp: Viewport): ScreenBox {
  const m = 4;
  return {
    minX: Math.max(b.minX, -m),
    minY: Math.max(b.minY, -m),
    maxX: Math.min(b.maxX, vp.width + m),
    maxY: Math.min(b.maxY, vp.height + m),
  };
}

/** The box of the visible selected objects (turned with them when they share a rotation, see selection-frame.ts). */
export function selectedFrame(visible: readonly ProjectedObject[], editor: EditorState, vp: Viewport): { frame: SelectionFrame; handle: Pt } | null {
  const frame = selectionFrame(visible.filter((po) => editor.selection.has(po.obj.id)), editor.alignBox);
  return frame ? { frame, handle: rotateHandleAt(frame, vp) } : null;
}

/** Rotation is offered when something selected is visible and not a covering approximation. */
export function canRotate(visible: readonly ProjectedObject[], editor: EditorState): boolean {
  let any = false;
  for (const po of visible) {
    if (!editor.selection.has(po.obj.id)) continue;
    if (po.cover) return false;
    any = true;
  }
  return any;
}

const finite = (p: Pt): boolean => Math.abs(p[0]) < 1e6 && Math.abs(p[1]) < 1e6;

function drawSelection(
  ctx: CanvasRenderingContext2D,
  visible: readonly ProjectedObject[],
  editor: EditorState,
  theme: SceneTheme,
  vp: Viewport,
): void {
  if (editor.selection.size === 0) {
    editor.selectionBoxOnScreen = null;
    return;
  }
  ctx.save();
  ctx.strokeStyle = theme.selection;
  ctx.lineWidth = 1;
  // Each selected object is outlined by the rectangle it occupies, turned with it.
  for (const po of visible) {
    if (!editor.selection.has(po.obj.id)) continue;
    const c = itemCorners(po);
    if (!c.every(finite)) continue;
    ctx.beginPath();
    ctx.moveTo(c[0]![0], c[0]![1]);
    for (let i = 1; i < c.length; i++) ctx.lineTo(c[i]![0], c[i]![1]);
    ctx.closePath();
    ctx.stroke();
    if (editor.highlight?.has(po.obj.id)) {
      // Lit up: the shapes that use the colour the pointer is on.
      ctx.save();
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
  }
  // Editing nodes: the nodes are the handles; the selection's own handles would sit on top of them.
  const sel = editor.tool === "node" ? null : selectedFrame(visible, editor, vp);
  if (editor.tool === "node") editor.selectionBoxOnScreen = null;
  if (sel && sel.frame.corners.every(finite)) {
    const { frame, handle } = sel;
    // The box the handles sit on, always drawn: for one object in an axis-aligned box it is not the object's own outline.
    ctx.beginPath();
    ctx.moveTo(frame.corners[0][0], frame.corners[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(frame.corners[i]![0], frame.corners[i]![1]);
    ctx.closePath();
    ctx.stroke();
    editor.selectionBoxOnScreen = { frame, handle, rotatable: canRotate(visible, editor) };
    ctx.fillStyle = theme.handleFill;
    ctx.lineWidth = 1.25;
    const handles: Array<[number, number]> = [...frame.corners.map((c) => [c[0], c[1]] as [number, number])];
    {
      // The middle of each side, turned box or not, when the side is long enough to hold a handle beside the corners (tools.ts resizeHandles).
      const [c0, c1, c2, c3] = frame.corners;
      if (Math.hypot(c1![0] - c0![0], c1![1] - c0![1]) >= 3 * HANDLE_SIZE_PX && Math.hypot(c3![0] - c0![0], c3![1] - c0![1]) >= 3 * HANDLE_SIZE_PX) {
        const mid = (a: readonly number[], b: readonly number[]): [number, number] => [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2];
        handles.push(mid(c0!, c1!), mid(c3!, c2!), mid(c1!, c2!), mid(c0!, c3!));
      }
    }
    editor.drawnHandles = handles;
    const cropping = editor.cropId !== null && editor.selection.size === 1 && editor.selection.has(editor.cropId);
    if (cropping) drawCropBrackets(ctx, frame.corners, theme);
    else
      for (const [x, y] of handles) {
        const h = HANDLE_SIZE_PX;
        ctx.fillRect(x - h / 2, y - h / 2, h, h);
        ctx.strokeRect(x - h / 2, y - h / 2, h, h);
      }
    if (canRotate(visible, editor)) {
      const top: Pt = [(frame.corners[0][0] + frame.corners[1][0]) / 2, (frame.corners[0][1] + frame.corners[1][1]) / 2];
      ctx.beginPath();
      ctx.moveTo(handle[0], handle[1]);
      ctx.lineTo(top[0], top[1]);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(handle[0], handle[1], HANDLE_SIZE_PX / 2 + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Crop mode looks unlike resizing (ADR 0118): the corners are thick L brackets and the sides short bars (not squares), the part of the picture
 * that is cut away shows faintly around the window (`drawCropGhost`), and a "Crop" tag sits above it.
 */
function drawCropBrackets(ctx: CanvasRenderingContext2D, corners: readonly (readonly number[])[], theme: SceneTheme): void {
  const [a, b, c, d] = corners as [number[], number[], number[], number[]];
  const left = Math.min(a[0]!, c[0]!), right = Math.max(a[0]!, c[0]!), top = Math.min(a[1]!, c[1]!), bottom = Math.max(a[1]!, c[1]!);
  const arm = Math.min(CROP_ARM_PX, (right - left) / 3, (bottom - top) / 3);
  if (!(arm > 2)) return;
  const mx = (left + right) / 2, my = (top + bottom) / 2;
  const path = (): void => {
    ctx.beginPath();
    for (const [x, y, dx, dy] of [[left, top, 1, 1], [right, top, -1, 1], [right, bottom, -1, -1], [left, bottom, 1, -1]] as const) {
      ctx.moveTo(x + dx * arm, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * arm);
    }
    const half = arm / 2;
    ctx.moveTo(mx - half, top); ctx.lineTo(mx + half, top);
    ctx.moveTo(mx - half, bottom); ctx.lineTo(mx + half, bottom);
    ctx.moveTo(left, my - half); ctx.lineTo(left, my + half);
    ctx.moveTo(right, my - half); ctx.lineTo(right, my + half);
  };
  ctx.save();
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";
  path();
  ctx.strokeStyle = theme.handleFill;
  ctx.lineWidth = CROP_BRACKET_PX + 2;
  ctx.stroke();
  path();
  ctx.strokeStyle = theme.selection;
  ctx.lineWidth = CROP_BRACKET_PX;
  ctx.stroke();
  // The tag.
  ctx.font = LABEL_FONT;
  ctx.textBaseline = "middle";
  const text = "Crop";
  const w = ctx.measureText(text).width + 14;
  const x = left, y = top - 26; // (the turn handle is above the middle)
  ctx.fillStyle = theme.selection;
  ctx.beginPath();
  ctx.roundRect(x, y, w, 18, 9);
  ctx.fill();
  ctx.fillStyle = theme.handleFill;
  ctx.fillText(text, x + 7, y + 9);
  ctx.restore();
  void b; void d;
}

const CROP_ARM_PX = 16;
const CROP_BRACKET_PX = 3;

/** Around the crop window: the canvas is dimmed and what the crop cuts away of the picture shows faintly (ADR 0118); drag outward to bring it back. */
export function drawCropGhost(ctx: CanvasRenderingContext2D, po: ProjectedObject, src: RasterSource | null, vp: Viewport): void {
  const o = po.obj;
  if (o.kind !== "image" || !src || o.rot) return;
  const [l, t, r, b] = po.q as unknown as [number, number, number, number];
  const crop = cropOf(o);
  const sx = (r - l) / crop.w, sy = (b - t) / crop.h;
  const x = l - crop.x * sx, y = t - crop.y * sy, w = o.pixelW * sx, h = o.pixelH * sy;
  if (![l, t, r, b].every(Number.isFinite)) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, vp.width, vp.height);
  ctx.rect(l, t, r - l, b - t);
  ctx.clip("evenodd");
  // Everything outside the window is dimmed, so the window stands out; the cut-away part of the picture shows through that dimness.
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(0, 0, vp.width, vp.height);
  if ([x, y, w, h].every(Number.isFinite) && w < 1e5 && h < 1e5) {
    ctx.globalAlpha = 0.55;
    ctx.drawImage(src.source, x, y, w, h);
  }
  ctx.restore();
}
