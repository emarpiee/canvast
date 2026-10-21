/**
 * The Painting view's vector tools (ADR 0166): Move (and resize), Shape, Text and Edit nodes, on the layers that hold canvas objects.
 * Each tool is a gesture: `down` takes the pointer, `move` shows a preview (a layer as it would be, never stored), `up` makes it one undo
 * step. The geometry is the canvas's own: its shapes (objects.ts), its node hits and node moves (interaction/path-edit.ts, doc/path.ts),
 * its path rebuilding (doc/node-edit.ts). Positions come in page px and screen (CSS) px.
 */
import type { CanvasObject, PathObject, TextObject } from "../doc/model";
import { NODE } from "../doc/path";
import { moveHandle, moveNode, nodeCount, splitSegment, toggleSmooth, withNode, type ShapeKind } from "../doc/path";
import { bakedPath, rebuiltPath } from "../doc/node-edit";
import { paintFromText } from "../doc/paint";
import { hitNodes, isSmoothNode, nodesOnScreen, type NodeHit } from "../interaction/path-edit";
import type { PaintCamera } from "./camera";
import { handleAt, handlesOf, resized, HANDLE_PX, type Handle } from "./handles";
import type { Layer, ObjectLayer } from "./model";
import { boxOf, moved, objectsOf, pageSpace, projected, scaled, shapeObject, stored, textObject, type Box } from "./objects";
import type { PaintSession } from "./session";
import type { ToolId, Values } from "./tools";

export interface VectorHost {
  readonly session: PaintSession;
  cam(): PaintCamera;
  view(): { w: number; h: number };
  values(): Values;
  colour(): string;
  tell(text: string): void;
  /** Ask for a text (a new one, or one to change); null: cancelled. */
  askText(title: string, value: string): Promise<string | null>;
}

export interface Point {
  /** Page px. */
  readonly x: number;
  readonly y: number;
  /** Screen (CSS) px in the view. */
  readonly sx: number;
  readonly sy: number;
  readonly shift: boolean;
  readonly alt: boolean;
}

export interface Gesture {
  move(p: Point): void;
  up(p: Point, cancelled: boolean): void;
}

const isObjectLayer = (l: Layer | null | undefined): l is ObjectLayer => !!l && l.kind === "object";
/** The layer's box on screen. */
const onScreen = (b: Box, c: PaintCamera): Box => ({ x: c.x + b.x * c.scale, y: c.y + b.y * c.scale, w: b.w * c.scale, h: b.h * c.scale });
const DRAG_PX = 3;

/** The node being edited (the Edit nodes tool's selection), by layer. */
let nodeSel: { layer: string; s: number; k: number } | null = null;

/** The path an Edit nodes gesture works on: the layer's first path, projected for the view. */
function nodeTarget(h: VectorHost): { l: ObjectLayer; objs: CanvasObject[]; i: number; o: PathObject } | null {
  const l = h.session.active();
  if (!isObjectLayer(l)) return null;
  const objs = objectsOf(l.objs);
  const i = objs.findIndex((o) => o.kind === "path");
  return i < 0 ? null : { l, objs, i, o: objs[i] as PathObject };
}
const viewProjection = (h: VectorHost, o: CanvasObject) => {
  const c = h.cam(), v = h.view();
  return projected([o], { scale: c.scale, x: c.x, y: c.y }, { width: v.w, height: v.h })[0] ?? null;
};

/** Start a gesture of a vector tool at `p` (null: the tool does nothing here; it may have said why). */
export function startGesture(tool: ToolId, h: VectorHost, p: Point): Gesture | null {
  const s = h.session;
  switch (tool) {
    case "move": {
      const l = s.active();
      if (!isObjectLayer(l)) {
        h.tell(l?.kind === "raster" ? "Moving a paint layer's pixels is not there yet: Move works on shape, text, picture and pasted layers." : "Pick a shape, text or picture layer to move it.");
        return null;
      }
      if (l.locked) return h.tell("The picked layer is locked."), null;
      const objs0 = objectsOf(l.objs);
      const box0 = boxOf(objs0);
      if (!box0) return null;
      const handle: Handle | null = handleAt(onScreen(box0, h.cam()), p.sx, p.sy);
      let changed = false;
      return {
        move(q) {
          const dx = q.x - p.x, dy = q.y - p.y;
          if (!changed && Math.hypot(q.sx - p.sx, q.sy - p.sy) < DRAG_PX) return;
          changed = true;
          let objs: CanvasObject[];
          if (handle) {
            const nb = resized(box0, handle, dx, dy, q.shift);
            objs = moved(scaled(objs0, box0.x, box0.y, nb.w / Math.max(box0.w, 1e-9), nb.h / Math.max(box0.h, 1e-9)), nb.x - box0.x, nb.y - box0.y);
          } else objs = moved(objs0, dx, dy);
          s.preview({ ...l, objs: stored(objs) });
        },
        up(_q, cancelled) {
          if (cancelled || !changed) s.dropPreview();
          else s.endPreview(handle ? "Resize" : "Move");
        },
      };
    }
    case "shape": {
      const v = h.values();
      const kind = String(v["shape"]) as ShapeKind;
      const fillText = String(v["fill"] ?? "");
      const strokeText = String(v["outline"] ?? "none");
      const look = {
        fill: fillText === "" ? h.colour() : paintFromText(fillText) ?? null,
        stroke: strokeText === "" ? h.colour() : paintFromText(strokeText) ?? null,
        width: Number(v["width"] ?? 4),
        sides: Number(v["sides"] ?? 6),
        tips: Number(v["points"] ?? 5),
      };
      const names = { rect: "Rectangle", ellipse: "Ellipse", polygon: "Polygon", star: "Star", line: "Line" } as const;
      return {
        move(q) {
          let x1 = q.x, y1 = q.y;
          if (q.shift && kind !== "line") {
            const d = Math.max(Math.abs(x1 - p.x), Math.abs(y1 - p.y));
            x1 = p.x + Math.sign(x1 - p.x || 1) * d;
            y1 = p.y + Math.sign(y1 - p.y || 1) * d;
          }
          if (Math.hypot(q.sx - p.sx, q.sy - p.sy) < DRAG_PX) return s.draft(null);
          s.draft(s.freshLayer({ kind: "object", objs: stored([shapeObject(kind, p.x, p.y, x1, y1, look)]) }, names[kind]));
        },
        up(_q, cancelled) {
          if (cancelled) s.dropPreview();
          else s.endPreview(`Draw ${names[kind].toLowerCase()}`);
        },
      };
    }
    case "text": {
      return {
        move() {},
        up(q, cancelled) {
          if (cancelled || Math.hypot(q.sx - p.sx, q.sy - p.sy) >= DRAG_PX) return;
          const l = s.active();
          const hit = isObjectLayer(l) ? objectsOf(l.objs).find((o): o is TextObject => o.kind === "text") : undefined;
          const box = hit && boxOf([hit]);
          // A click on the picked text layer changes its words; anywhere else makes a new text there.
          if (isObjectLayer(l) && hit && box && p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) {
            void h.askText("Change the text", hit.md).then((t) => {
              if (t === null || !t.trim()) return;
              s.replaceLayer({ ...l, objs: stored(objectsOf(l.objs).map((o) => (o === hit ? { ...hit, md: t } : o))) }, "Change text");
            });
            return;
          }
          const size = Number(h.values()["size"] ?? 48);
          void h.askText("New text", "").then((t) => {
            if (t === null || !t.trim()) return;
            s.addLayer(s.freshLayer({ kind: "object", objs: stored([textObject(t, p.x, p.y - size * 0.8, size, h.colour())]) }, t.trim().slice(0, 40)), "New text");
          });
        },
      };
    }
    case "node": {
      const tg = nodeTarget(h);
      if (!tg) return h.tell("Pick a shape layer to edit its nodes."), null;
      if (tg.l.locked) return h.tell("The picked layer is locked."), null;
      const { sub: base, flat } = bakedPath(tg.o);
      const po = viewProjection(h, flat);
      if (!po) return null;
      const sel = nodeSel?.layer === tg.l.id ? nodeSel : null;
      const hit: NodeHit | null = hitNodes(po, p.sx, p.sy, sel);
      if (!hit) {
        nodeSel = null;
        return null;
      }
      nodeSel = { layer: tg.l.id, s: hit.s, k: hit.k };
      const unit = 2 ** tg.o.unit;
      const smooth = isSmoothNode(base[hit.s]!, hit.k);
      const commit = (sub: ReturnType<typeof moveNode>, label: string, store: boolean): void => {
        const next = rebuiltPath(tg.o, sub, pageSpace());
        const l = { ...tg.l, objs: stored(tg.objs.map((o, i) => (i === tg.i ? next : o))) };
        if (store) s.replaceLayer(l, label);
        else s.preview(l);
      };
      let changed = false;
      return {
        move(q) {
          if (hit.kind === "seg") return;
          if (!changed && Math.hypot(q.sx - p.sx, q.sy - p.sy) < DRAG_PX) return;
          changed = true;
          const dx = (q.x - p.x) / unit, dy = (q.y - p.y) / unit;
          const sp = base[hit.s]!, b = hit.k * NODE;
          const sub = hit.kind === "point" ? moveNode(base, hit.s, hit.k, dx, dy) : moveHandle(base, hit.s, hit.k, hit.kind === "in" ? 2 : 4, sp.n[b + (hit.kind === "in" ? 2 : 4)]! + dx, sp.n[b + (hit.kind === "in" ? 3 : 5)]! + dy, smooth && !q.alt);
          commit(sub, "", false);
        },
        up(q, cancelled) {
          if (cancelled) return s.dropPreview();
          if (changed) return s.endPreview(hit.kind === "point" ? "Move node" : "Move handle");
          if (hit.kind === "seg") {
            commit(splitSegment(base, hit.s, hit.k, hit.t), "Add node", true);
            nodeSel = { layer: tg.l.id, s: hit.s, k: hit.k + 1 };
          } else if (hit.kind === "point" && q.alt) commit(toggleSmooth(base, hit.s, hit.k), "Change node", true);
        },
      };
    }
    default:
      return null;
  }
}

/** Delete the selected node of the Edit nodes tool (a path keeps at least two). */
export function deleteNode(h: VectorHost): boolean {
  const tg = nodeTarget(h);
  if (!tg || !nodeSel || nodeSel.layer !== tg.l.id) return false;
  const { sub } = bakedPath(tg.o);
  const sp = sub[nodeSel.s];
  if (!sp || nodeCount(sp) <= 2) return h.tell("A path keeps at least two nodes."), true;
  const next = rebuiltPath(tg.o, withNode(sub, nodeSel.s, nodeSel.k, null), pageSpace());
  h.session.replaceLayer({ ...tg.l, objs: stored(tg.objs.map((o, i) => (i === tg.i ? next : o))) }, "Delete node");
  nodeSel = null;
  return true;
}

/** What the vector tools show over the page (screen px, `g` has no transform; `dpr` device px per CSS px). */
export function drawToolOverlay(tool: ToolId, h: VectorHost, g: CanvasRenderingContext2D, dpr: number, colours: { line: string; fill: string }): void {
  if (tool === "move") {
    const l = h.session.active();
    if (!isObjectLayer(l)) return;
    const b = boxOf(objectsOf(l.objs));
    if (!b) return;
    const s = onScreen(b, h.cam());
    g.save();
    g.scale(dpr, dpr);
    g.strokeStyle = colours.line;
    g.lineWidth = 1;
    g.strokeRect(s.x, s.y, s.w, s.h);
    g.fillStyle = colours.fill;
    for (const q of handlesOf(s)) {
      g.fillRect(q.x - HANDLE_PX / 2, q.y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
      g.strokeRect(q.x - HANDLE_PX / 2, q.y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
    }
    g.restore();
  } else if (tool === "node") {
    const tg = nodeTarget(h);
    const po = tg && viewProjection(h, bakedPath(tg.o).flat);
    if (!po) return;
    g.save();
    g.scale(dpr, dpr);
    g.strokeStyle = colours.line;
    g.fillStyle = colours.fill;
    g.lineWidth = 1;
    for (const n of nodesOnScreen(po)) {
      const on = nodeSel?.layer === tg!.l.id && nodeSel.s === n.s && nodeSel.k === n.k;
      if (on) {
        for (const q of [n.hasIn ? n.i : null, n.hasOut ? n.o : null]) {
          if (!q) continue;
          g.beginPath();
          g.moveTo(n.p[0], n.p[1]);
          g.lineTo(q[0], q[1]);
          g.stroke();
          g.beginPath();
          g.arc(q[0], q[1], 3.5, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
      }
      g.fillStyle = on ? colours.line : colours.fill;
      g.fillRect(n.p[0] - 4, n.p[1] - 4, 8, 8);
      g.strokeRect(n.p[0] - 4, n.p[1] - 4, 8, 8);
      g.fillStyle = colours.fill;
    }
    g.restore();
  }
}
