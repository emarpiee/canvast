import * as D from "../core/dyadic";
import { screenToWorld } from "../core/camera";
import type { Frame } from "../core/frames";
import type { WorldPoint } from "../core/camera";
import type { DocumentStore, Transaction } from "../doc/document-store";
import { isContainer } from "../doc/containers";
import { normalizeUnit } from "../doc/edit-ops";
import { groupObjects } from "../doc/groups";
import type { CanvasObject, GenInfo, PathObject } from "../doc/model";
import { homeObject, newObjectId } from "../doc/model";
import type { ObjectId } from "../doc/model";
import { drawnParams, drawnSubs, geometryBounds, mapSubs } from "../doc/path";
import type { Generator, Values } from "../gen";
import { cleanValues, generate } from "../gen";
import { nextSheetName, pruneSelection } from "./actions";
import type { EditorState } from "./editor-state";
import type { ViewState } from "./view-state";

/**
 * Pattern (ADR 0162): put what a generator (src/gen) makes on a sheet, a shape, or a new sheet. While the Pattern panel is open the result
 * is live: each change takes back the last result and makes the new one, so the whole session is one undo step, whatever was tried.
 */
export interface PatternSession {
  /** The step this session last made; it is taken back before the next result as long as it is still the last step of the document. */
  top: Transaction | null;
  /** Where the sheet this session made stands, so the next result lands in the same place. */
  sheet: { frame: Frame | undefined; anchor: WorldPoint; unit: number; w: number; h: number } | null;
}

export const newPatternSession = (): PatternSession => ({ top: null, sheet: null });

/** What the next result would go on: a picked sheet, a picked closed shape (which cuts it), or a new sheet. */
export function patternTarget(doc: DocumentStore, editor: EditorState): { kind: "sheet" | "shape"; obj: PathObject } | null {
  const picked = [...editor.selection].map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o);
  const o = picked.length === 1 ? picked[0]! : undefined;
  if (!o || o.kind !== "path" || o.hidden || o.locked || o.result !== undefined) return null;
  if (isContainer(o)) return { kind: "sheet", obj: o };
  return o.sub.some((s) => s.closed) ? { kind: "shape", obj: o } : null;
}

/** The picked sheets and closed shapes a pattern can go on, when two or more are picked (each gets its own); none when one or none is. */
export function patternTargets(doc: DocumentStore, editor: EditorState): ObjectId[] {
  const picked = editor.selection;
  if (picked.size < 2 || foundPattern(doc, editor)) return []; // (the shapes of a pattern picked: the pattern is being edited, not given another)
  try {
    return [...picked].filter((id) => {
      editor.selection = new Set([id]);
      return patternTarget(doc, editor) !== null;
    });
  } finally {
    editor.selection = picked;
  }
}

/**
 * Make the pattern on each of several picked sheets or shapes (one undo step each; the pick stays, so the next Generate goes on them again).
 * Null when fewer than two can take one (`makePattern` then does the work); else how many were made.
 */
export function makePatternEach(doc: DocumentStore, editor: EditorState, view: ViewState, g: Generator, values: Values, seed: number): number | null {
  const ids = patternTargets(doc, editor);
  if (ids.length < 2) return null;
  const picked = editor.selection;
  let made = 0;
  for (const id of ids) {
    editor.selection = new Set([id]);
    if (makePattern(doc, editor, view, newPatternSession(), g, values, seed)) made++;
  }
  editor.selection = new Set([...picked].filter((id) => !!doc.get(id)));
  editor.message = `Made the pattern on ${made} of ${ids.length} picked.`;
  editor.changed();
  return made;
}

let memo: { doc: DocumentStore; rev: number; sel: string; out: ReturnType<typeof findPattern> } | null = null;

function findPattern(doc: DocumentStore, editor: EditorState): { info: GenInfo; members: CanvasObject[]; host: PathObject } | null {
  for (const id of editor.selection) {
    const o = doc.get(id);
    for (const gid of o?.groups ?? []) {
      const members = [...doc.all()].filter((m) => m.groups?.includes(gid));
      const info = members.find((m) => m.gen?.gid === gid)?.gen;
      const host = members[0]?.parent !== undefined ? doc.get(members[0].parent) : undefined;
      if (info && isContainer(host)) return { info, members, host };
    }
  }
  return null;
}

/** The pattern the picked objects belong to (made by a generator, its settings kept on its first shape): its group, shapes and the sheet that holds them. Remembered until the document or the pick changes (the panel asks on every redraw). */
export function foundPattern(doc: DocumentStore, editor: EditorState): { info: GenInfo; members: CanvasObject[]; host: PathObject } | null {
  const sel = [...editor.selection].sort().join(",");
  if (!memo || memo.doc !== doc || memo.rev !== doc.revision || memo.sel !== sel) memo = { doc, rev: doc.revision, sel, out: findPattern(doc, editor) };
  return memo.out;
}

/** The words for what a result goes on, for the panel. */
export function patternTargetLabel(doc: DocumentStore, editor: EditorState): string {
  const many = patternTargets(doc, editor).length;
  if (many > 1) return `${many} picked shapes: one pattern on each`;
  const f = foundPattern(doc, editor);
  if (f) return `This pattern (${f.info.id}): changes replace it`;
  const t = patternTarget(doc, editor);
  return !t ? "A new sheet" : t.kind === "sheet" ? (t.obj.name ?? "The picked sheet") : `The picked shape (cuts the pattern to its outline)`;
}

const sizeOf = (o: PathObject) => {
  const b = geometryBounds(o.sub);
  return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
};

/**
 * Make the pattern of `g` and put it on the target: one undo step. When `session` still holds the last step of the document it is taken
 * back first (the result is replaced, not stacked). Returns false, with a message, when it cannot be made.
 */
export function makePattern(doc: DocumentStore, editor: EditorState, view: ViewState, session: PatternSession, g: Generator, values: Values, seed: number): boolean {
  if (editor.blockEdit()) return false;
  const editing = foundPattern(doc, editor)?.info.gid ?? null; // (looked for before a step is taken back: the picked shapes may be the ones about to go)
  if (session.top && doc.lastTransaction === session.top) {
    doc.undo();
    pruneSelection(doc, editor);
  } else session.sheet = null; // (something else was done since: this is a new result, in a new place)
  session.top = null;

  const old = editing ? [...doc.all()].filter((m) => m.groups?.includes(editing)) : [];
  const oldHost = old[0]?.parent !== undefined ? doc.get(old[0].parent) : undefined;
  const again = editing !== null && old.length > 0 && isContainer(oldHost) ? oldHost : null; // the pattern being changed: its shapes are replaced on the sheet that holds them
  const t = again ? { kind: "sheet" as const, obj: again } : patternTarget(doc, editor);
  if (t?.obj.rot) {
    editor.message = "Straighten that shape first: a pattern is made upright.";
    editor.changed();
    return false;
  }
  const z0 = doc.topZ();
  const fresh: CanvasObject[] = [];
  let host: PathObject | undefined; // the sheet the pieces are put on (a sheet cut to the shape, or the picked sheet)
  let frame: Frame | undefined;
  let anchor: WorldPoint;
  let unit: number;
  let box: { x: number; y: number; w: number; h: number };

  if (t) {
    const b = sizeOf(t.obj);
    if (!(b.w > 0 && b.h > 0) || !Number.isFinite(b.w + b.h)) {
      editor.message = "That shape has no size to fill.";
      editor.changed();
      return false;
    }
    ({ frame, anchor, unit } = t.obj);
    box = b;
    if (t.kind === "sheet") host = t.obj;
    else {
      // the picked shape itself becomes the clipping mask that holds the pattern (its place, layer, groups and name stay; its fill and outline
      // are kept for when it is released, as Clipping mask does), not a copy of it on top with the shape left under it
      const o = t.obj;
      host = { ...o, fill: null, stroke: null, container: { clip: true, mask: true, was: { fill: o.fill, stroke: o.stroke } }, ...(o.name ? {} : { name: `Mask ${maskNumber(doc)}` }) } as PathObject;
      fresh.push(host);
    }
  } else {
    if (!session.sheet) {
      const cam = view.camera, vp = view.viewport;
      const px = 0.62 * Math.min(vp.width, vp.height * 1.5), k = 1 / 2 ** cam.zf;
      const w = px * k, h = ((px * 2) / 3) * k, u = -cam.zi;
      const at = screenToWorld(cam, vp, { x: vp.width / 2, y: vp.height / 2 });
      session.sheet = { frame: view.frame === doc.space.world ? undefined : view.frame, anchor: { x: D.sub(at.x, D.shift(D.fromNumber(w / 2), u)), y: D.sub(at.y, D.shift(D.fromNumber(h / 2), u)) }, unit: u, w, h };
    }
    const s = session.sheet;
    ({ frame, anchor, unit } = s);
    box = { x: 0, y: 0, w: s.w, h: s.h };
    const params = drawnParams("rect", 0, 0, s.w, s.h, 6, 5);
    const sheet: PathObject = {
      id: newObjectId(), kind: "path", ...(s.frame ? { frame: s.frame } : {}), anchor: s.anchor, unit: s.unit, z: z0 + 1, opacity: 1, attachmentTargetId: null,
      sub: drawnSubs("rect", 0, 0, s.w, s.h, 6, 5), fill: "#ffffff", stroke: null, width: Math.max(Math.min(s.w, s.h) / 100, Number.MIN_VALUE), shape: "rect",
      ...(params ? { params } : {}), container: { clip: true }, name: nextSheetName(doc.all()),
    };
    host = homeObject(normalizeUnit(sheet), doc.space) as PathObject;
    fresh.push(host);
  }

  const shapes = generate(g, values, seed, box.w, box.h);
  const base = { ...(frame ? { frame } : {}), anchor, unit, attachmentTargetId: null, opacity: 1, parent: host.id };
  // a pattern that is being changed keeps its place in the stack (spread over the range its shapes had); a new one goes on top
  const zLow = again ? Math.min(...old.map((o) => o.z)) : z0 + 2, zSpan = again ? Math.max(...old.map((o) => o.z)) - zLow + 0.5 : shapes.length;
  const prefix = again ? (old[0]!.groups ?? []).slice(0, (old[0]!.groups ?? []).indexOf(editing!)) : [];
  const pieces = shapes.map((s, i): CanvasObject => homeObject(normalizeUnit({
    ...base, id: newObjectId(), kind: "path", z: zLow + (zSpan * i) / Math.max(1, shapes.length), ...(prefix.length ? { groups: prefix } : {}),
    sub: mapSubs(s.sub, (x, y) => [x + box.x, y + box.y]), fill: s.fill, stroke: s.stroke, width: s.width,
    ...(s.evenodd ? { evenodd: true as const } : {}), ...(s.name ? { name: s.name } : {}),
  } as PathObject), doc.space));
  const gid = again ? editing! : newObjectId();
  const info: GenInfo = { id: g.id, gid, seed, v: cleanValues(g, values) };
  const grouped = groupObjects(pieces, prefix.length, gid).map((o, i) => ({ ...o, groupNames: { ...(again ? old[0]!.groupNames : {}), [gid]: g.label }, ...(i === 0 ? { gen: info } : {}) }) as CanvasObject);

  const tx = doc.transaction(`Pattern: ${g.label}`, [...fresh, ...grouped], again ? old.map((o) => o.id) : []);
  doc.commit(tx);
  session.top = tx;
  if (again) editor.select(grouped.map((o) => o.id));
  else if (!t) editor.select([host.id]);
  editor.changed();
  return true;
}

const maskNumber = (doc: DocumentStore): number => {
  let n = 0;
  for (const o of doc.all()) n = Math.max(n, Number(/^Mask (\d+)$/.exec(o.name ?? "")?.[1] ?? 0));
  return n + 1;
};
