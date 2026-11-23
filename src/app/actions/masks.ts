import * as D from "../../core/dyadic";
import { isLaidOut } from "../../doc/auto-layout";
import { DEFAULT_CONSTRAINT, constraintOf } from "../../doc/constraints";
import { isContainer, isMaskSheet, rootsOf } from "../../doc/containers";
import { normalizeUnit, placeAbove, unionBounds } from "../../doc/edit-ops";
import { expressObjectIn, homeObject, newObjectId } from "../../doc/model";
import { drawnSubs } from "../../doc/path";
import { selected } from "./shared";
import type { Constraint } from "../../doc/constraints";
import type { DocumentStore } from "../../doc/document-store";
import type { CanvasObject, PathObject } from "../../doc/model";
import type { EditorState } from "../editor-state";

// ---- Masks (ADR 0144) ---------------------------------------------------------------------------------------------------------

/** The units (a group at the working level, or a single object) among the picked objects, with the objects of each. */
function pickedUnits(doc: DocumentStore, editor: EditorState): Map<string, CanvasObject[]> {
  const level = editor.entered.length;
  const units = new Map<string, CanvasObject[]>();
  for (const o of selected(doc, editor)) if (!o.locked) (units.get(o.groups?.[level] ?? o.id) ?? units.set(o.groups?.[level] ?? o.id, []).get(o.groups?.[level] ?? o.id)!).push(o);
  return units;
}
const topZ = (os: readonly CanvasObject[]): number => Math.max(...os.map((o) => o.z));

/** Whether two or more things are picked, none of them part of a mask already: the top one can become the mask of the others. */
export function canMakeMask(doc: DocumentStore, editor: EditorState): boolean {
  const units = pickedUnits(doc, editor);
  return units.size >= 2 && [...units.values()].every((u) => u.every((o) => !o.isMask && !o.mask));
}

/**
 * Cut the picked things by the top one (ADR 0144): it becomes a mask that keeps of the others what its opacity (`alpha`) or brightness
 * (`luminance`) lets through. The mask is a group of its own (so a brush mask can add to it), inside a group of the mask and what it cuts.
 */
export function makeMask(doc: DocumentStore, editor: EditorState, mode: "alpha" | "luminance"): void {
  if (editor.blockEdit()) return;
  if (!canMakeMask(doc, editor)) {
    editor.message = "Select two or more objects that are not masks already: the top one becomes the mask of the others.";
    editor.changed();
    return;
  }
  const units = [...pickedUnits(doc, editor).values()].sort((a, b) => topZ(b) - topZ(a));
  const [maskObjs, ...rest] = units as [CanvasObject[], ...CanvasObject[][]];
  const masked = rest.flat();
  const level = editor.entered.length;
  const MG = newObjectId();
  const G = newObjectId();
  const names = { [G]: "Masked", [MG]: "Mask" };
  const place = (o: CanvasObject): CanvasObject => {
    const path = [...(o.groups ?? [])];
    path.splice(level, 0, G);
    return { ...o, groups: path, groupNames: { ...(o.groupNames ?? {}), ...names } };
  };
  if ([...maskObjs, ...masked].some((o) => (o.groups?.length ?? 0) >= 14)) {
    editor.message = "Those groups nest too deeply to add a mask.";
    editor.changed();
    return;
  }
  const out = [
    ...maskObjs.map((o) => place({ ...o, groups: [...(o.groups ?? []), MG], isMask: true as const })),
    ...masked.map((o) => place({ ...o, mask: { by: MG, mode } })),
  ];
  doc.commit(doc.transaction(mode === "alpha" ? "Mask by opacity" : "Mask by brightness", out));
  editor.select(out.map((o) => o.id));
  editor.changed();
}

/** The masks (group ids) of the picked objects: those that are cut by one, and those that are one. */
function pickedMasks(doc: DocumentStore, editor: EditorState): Set<string> {
  const bys = new Set<string>();
  for (const o of selected(doc, editor)) {
    if (o.mask) bys.add(o.mask.by);
    if (o.isMask) for (const g of o.groups ?? []) bys.add(g);
  }
  const real = new Set<string>();
  for (const o of doc.all()) if (o.mask && bys.has(o.mask.by)) real.add(o.mask.by);
  return real;
}

export const canReleaseMask = (doc: DocumentStore, editor: EditorState): boolean => pickedMasks(doc, editor).size > 0 || selected(doc, editor).some((o) => isMaskSheet(o));

/** What the picked masks are now: how they cut and whether they are inverted (the first one); null when none is picked. */
export function selectedMask(doc: DocumentStore, editor: EditorState): { mode: "alpha" | "luminance"; invert: boolean } | null {
  const bys = pickedMasks(doc, editor);
  for (const o of doc.all()) if (o.mask && bys.has(o.mask.by)) return { mode: o.mask.mode, invert: o.mask.invert === true };
  return null;
}

/** Change what the picked masks do (how they cut, whether inverted) or take them away (what they cut is whole again, and their objects are drawn on their own). One undo step. */
export function changeMask(doc: DocumentStore, editor: EditorState, change: { mode?: "alpha" | "luminance"; invert?: boolean; release?: true }): void {
  if (editor.blockEdit()) return;
  const bys = pickedMasks(doc, editor);
  if (!bys.size) {
    if (change.release && selected(doc, editor).some((o) => isMaskSheet(o))) releaseSheets(doc, editor); // a clipping mask: its shape stays
    return;
  }
  const out: CanvasObject[] = [];
  for (const o of doc.all()) {
    if (o.mask && bys.has(o.mask.by)) {
      if (change.release) {
        const { mask: _m, ...rest } = o;
        out.push(rest as CanvasObject);
      } else {
        const invert = change.invert ?? o.mask.invert === true;
        out.push({ ...o, mask: { by: o.mask.by, mode: change.mode ?? o.mask.mode, ...(invert ? { invert: true as const } : {}) } });
      }
    } else if (change.release && o.isMask && o.groups?.some((g) => bys.has(g))) {
      const { isMask: _i, ...rest } = o;
      out.push(rest as CanvasObject);
    }
  }
  if (!out.length) return;
  doc.commit(doc.transaction(change.release ? "Release the mask" : change.invert !== undefined ? "Invert the mask" : "Mask mode", out));
  editor.changed();
}

/** Pick the objects of the mask that cuts the picked objects, so it can be moved or edited (it is shown, see-through, while picked). */
export function selectTheMask(doc: DocumentStore, editor: EditorState): void {
  const bys = pickedMasks(doc, editor);
  const members = [...doc.all()].filter((o) => o.isMask && o.groups?.some((g) => bys.has(g)));
  if (!members.length) return;
  editor.entered = [];
  editor.select(members.map((o) => o.id));
  editor.changed();
}

/**
 * A mask to paint (ADR 0144): the picked things get a mask by brightness that starts as a white rectangle (all shown, black strokes hide)
 * or a black one (all hidden, white strokes show); the Pen then paints into it until it is finished. Returns whether it started.
 */
export function startBrushMask(doc: DocumentStore, editor: EditorState, revealed: boolean): void {
  if (editor.blockEdit()) return;
  const roots = rootsOf(selected(doc, editor).filter((o) => !o.locked));
  const level = editor.entered.length;
  if (!roots.length || roots.some((o) => o.isMask || o.mask)) {
    editor.message = "Select the objects to paint a mask for (not masks already).";
    editor.changed();
    return;
  }
  const f0 = roots[0]!.frame ?? doc.space.world;
  const b = unionBounds(roots.map((o) => expressObjectIn(o, f0)))!;
  const unit = roots[0]!.unit;
  const w = D.toNumber(D.shift(D.sub(b.max.x, b.min.x), -unit));
  const h = D.toNumber(D.shift(D.sub(b.max.y, b.min.y), -unit));
  if (!(w > 0 && h > 0 && Number.isFinite(w + h))) {
    editor.message = "Those objects have no common size to paint a mask on.";
    editor.changed();
    return;
  }
  const members = selected(doc, editor).filter((o) => !o.locked);
  if (members.some((o) => (o.groups?.length ?? 0) >= 14)) return;
  const MG = newObjectId();
  const G = newObjectId();
  const names = { [G]: "Masked", [MG]: "Mask" };
  const backdrop: PathObject = {
    id: newObjectId(),
    kind: "path",
    ...(f0 === doc.space.world ? {} : { frame: f0 }),
    anchor: b.min,
    unit,
    z: doc.topZ() + 1,
    opacity: 1,
    attachmentTargetId: null,
    sub: drawnSubs("rect", 0, 0, w, h, 6, 5),
    fill: revealed ? "#ffffff" : "#000000",
    stroke: null,
    width: Math.max(Math.min(w, h) / 100, Number.MIN_VALUE),
    shape: "rect",
    isMask: true,
    groups: [MG],
  };
  const place = (o: CanvasObject): CanvasObject => {
    const path = [...(o.groups ?? [])];
    path.splice(level, 0, G);
    return { ...o, groups: path, groupNames: { ...(o.groupNames ?? {}), ...names } };
  };
  const out = [place(homeObject(normalizeUnit(backdrop), doc.space)), ...members.map((o) => place({ ...o, mask: { by: MG, mode: "luminance" } }))];
  doc.commit(doc.transaction("Painted mask", out));
  editor.entered = [];
  editor.select(out.map((o) => o.id));
  editor.maskEdit = { groups: [G, MG], ink: revealed ? "#000000" : "#ffffff" };
  editor.setTool("pen");
  editor.message = revealed ? "Painting the mask: the Pen hides (black); the buttons switch to showing (white)." : "Painting the mask: the Pen shows (white); the buttons switch to hiding (black).";
  editor.changed();
}

/** Paint the mask in white (shows) or black (hides), or stop painting it. */
export function paintMask(editor: EditorState, ink: "show" | "hide" | "done"): void {
  if (!editor.maskEdit) return;
  if (ink === "done") editor.maskEdit = null;
  else editor.maskEdit = { ...editor.maskEdit, ink: ink === "show" ? "#ffffff" : "#000000" };
  editor.changed();
}

/** The topmost picked shape cuts what else is picked, clipping it to the shape's outline (a sheet of any shape, ADR 0108, 0144). */
export function makeClippingMask(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  const picked = selected(doc, editor).filter((o) => !o.locked);
  const roots = rootsOf(picked);
  const shapes = roots.filter((o): o is PathObject => o.kind === "path" && !o.container && !o.result && !o.groups?.length && o.sub.some((s) => s.closed));
  const maskShape = shapes.sort((a, b) => b.z - a.z)[0];
  if (!maskShape || roots.length < 2) {
    editor.message = "Select a closed shape and what it should cut: the top shape becomes the clipping mask.";
    editor.changed();
    return;
  }
  const content = roots.filter((o) => o !== maskShape);
  const all = doc.ordered();
  const lowest = Math.min(...content.map((o) => o.z));
  const below = [...all].filter((o) => o.z < lowest && o.id !== maskShape.id).pop();
  const parents = new Set(content.map((o) => o.parent));
  const parent = parents.size === 1 ? [...parents][0] : undefined;
  let n = 0;
  for (const o of all) n = Math.max(n, Number(/^Mask (\d+)$/.exec(o.name ?? "")?.[1] ?? 0));
  const { parent: _p, ...bare } = maskShape;
  const body: PathObject = { ...bare, fill: null, stroke: null, container: { clip: true, mask: true, was: { fill: maskShape.fill, stroke: maskShape.stroke } }, name: `Mask ${n + 1}`, ...(parent !== undefined ? { parent } : {}) };
  const placed = below ? (placeAbove(all, [body], below)[0] ?? body) : { ...body, z: lowest - 1 };
  const inside = content.map((o) => ({ ...o, parent: body.id }) as CanvasObject);
  doc.commit(doc.transaction("Clipping mask", [placed, ...inside]));
  editor.select([body.id, ...picked.map((o) => o.id)]);
  editor.changed();
}

/** Release the picked sheets (ADR 0108): what is on them stays where it is, on the sheet around them (or on the canvas); the sheets go. */
export function releaseSheets(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  const frames = selected(doc, editor).filter(isContainer);
  if (!frames.length) return;
  const gone = new Map(frames.map((f) => [f.id, f]));
  const next: CanvasObject[] = [];
  // A clipping mask goes back to being the shape it was made from (with the fill and outline it had); only plain sheets go.
  const shapes = frames.filter((f) => isMaskSheet(f)).map((f): CanvasObject => {
    const { container, name: _n, ...rest } = f;
    const was = container.was;
    const fill = was ? was.fill : f.fill;
    const stroke = was ? was.stroke : f.stroke === null && f.fill === null ? "#1f2329" : f.stroke; // (an old mask that kept nothing: given an outline, or it would be invisible)
    return { ...rest, fill, stroke } as CanvasObject;
  });
  for (const o of doc.all()) {
    if (gone.has(o.id) || o.parent === undefined || !gone.has(o.parent)) continue;
    let up = gone.get(o.parent)!.parent;
    while (up !== undefined && gone.has(up)) up = gone.get(up)!.parent; // (a released sheet inside a released sheet)
    const { parent: _p, ...rest } = o;
    next.push((up !== undefined ? { ...rest, parent: up } : rest) as CanvasObject);
  }
  const kept = new Set(shapes.map((s) => s.id));
  doc.commit(doc.transaction(frames.length === 1 ? "Release sheet" : `Release ${frames.length} sheets`, [...next, ...shapes], [...gone.keys()].filter((id) => !kept.has(id))));
  editor.select([...next, ...shapes].map((o) => o.id));
  editor.changed();
}

/** The constraint of the first picked object that is directly on a sheet (null: none is). */
export function selectedPin(doc: DocumentStore, editor: EditorState): Constraint | null {
  if (selected(doc, editor).some(isContainer)) return null; // (a sheet picked with what is on it: the pins are the objects', not shown)
  const on = selected(doc, editor).find((o) => o.parent !== undefined && isContainer(doc.get(o.parent)));
  return on ? constraintOf(on) : null;
}

/** Change how the picked objects that are on a sheet follow it when it is resized (ADR 0108): one undo step. */
export function setPin(doc: DocumentStore, editor: EditorState, patch: { h?: Constraint["h"]; v?: Constraint["v"] }): void {
  const on = selected(doc, editor).filter((o) => o.parent !== undefined && isContainer(doc.get(o.parent)) && !o.locked);
  if (!on.length || editor.blockEdit()) return;
  const next = on.map((o): CanvasObject => {
    const c = constraintOf(o);
    const h = patch.h ?? c.h, v = patch.v ?? c.v;
    const { constraint: _c, ...rest } = o;
    return (h === DEFAULT_CONSTRAINT.h && v === DEFAULT_CONSTRAINT.v ? rest : { ...rest, constraint: { h, v } }) as CanvasObject;
  });
  doc.commit(doc.transaction(on.length === 1 ? "Change pin" : `Change pin of ${on.length} objects`, next));
  editor.changed();
}

/** Whether a sheet that has things on it is picked (Fit to contents applies; a sheet with auto layout sizes itself: hug). */
export const canFitSheet = (doc: DocumentStore, editor: EditorState): boolean =>
  selected(doc, editor).some((o) => isContainer(o) && !o.rot && o.radius === undefined && !isLaidOut(o) && [...doc.all()].some((k) => k.parent === o.id));

