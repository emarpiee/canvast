import { beginProgress } from "./progress";
import { withStyleLinks } from "../doc/style-links";
import { hasCorners, paramsOf, withRadius, withShapeParams, type ShapePatch } from "../doc/shape-params";
import { DEFAULT_INNER, type Radius } from "../doc/path";
import { canRound, nodesIn, roundCorners } from "../doc/rounding";
import type { AlignChoice, CapChoice, JoinChoice } from "../doc/stroke-look";
import { alignChoice, capChoice, dashChoice, joinChoice, lookFromChoices } from "../doc/stroke-look";
import type { DashChoice, StrokeLook } from "../doc/stroke-look";
import { normalizeTags } from "../assets/asset-catalog";
import { renamedTag, tagFormatNote, tagIsOrUnder } from "../doc/tags";
import { isCard } from "../assets/file-kind";
import * as D from "../core/dyadic";
import { screenToWorld } from "../core/camera";
import type { DocumentStore } from "../doc/document-store";
import type { BlendMode, CanvasObject, ImageObject, InitialPaint, InitialShape, MediaState, PathObject, StrokeObject, TextObject } from "../doc/model";
import { fitWidth, withLook, lookOf, sameLook } from "../text/text-style";
import type { TextLook } from "../text/text-style";
import { textOutline } from "../text/outline";
import type { GradientStop, Paint } from "../doc/paint";
import { isGradient, solidOf } from "../doc/paint";
import { plainText } from "../text/markdown";
import type { BoolOp } from "../doc/boolean";
import { boolGroupsOf, isBoolMember, isResult, operandOf, resultOf } from "../doc/boolean-group";
import { ancestorsOf, descendantsOf, isContainer, isMaskSheet, rootsOf } from "../doc/containers";
import { DEFAULT_CONSTRAINT, constraintOf } from "../doc/constraints";
import { cleanAdjust, cropOf, isNeutral, reachFraction } from "../doc/adjust";
import type { Adjust } from "../doc/adjust";
import { cropEdges, uncrop } from "../doc/crop";
import { renderedPicture, setAdjustPreviewing } from "../render/adjust-image";
import { DEFAULT_INK, newInk } from "../render/ink";
import type { Constraint } from "../doc/constraints";
import { MITER_LIMIT, NODE, type Arrow, drawnParams, drawnSubs, geometryBounds, type SubPath } from "../doc/path";
import { fitPolyline, simplifySub } from "../doc/fit-curve";
import { alignedOutlineOf, outlineOf } from "../doc/outline-stroke";
import { divideShapes, pathLookOf, uniteRegions } from "../doc/divide";
import { buildNetwork, regionFillAt, withRegionFill } from "../doc/network";
import { regionIn } from "../doc/boolean-group";
import type { WidthProfile } from "../doc/stroker";
import { angularCount, exportSvg } from "./svg-export";
import { pdfVectorOf } from "./pdf-vector";
import type { PdfVector } from "./pdf-vector";
import type { ExportTarget } from "./export-render";
import type { ObjectId } from "../doc/model";
import { isMaskObject, maskMembers } from "../doc/masks";
import { parseCssPaint } from "./css-paint";
import { parseSvg } from "./svg-import";
import { pivotOf } from "../doc/model";
import { MAX_NAME_LENGTH, editSubs, inkStyle, expressObjectIn, homeObject, localBounds, newObjectId, pathSubs, strokePoints } from "../doc/model";
import { worldBounds } from "../doc/edit-ops";
import { planSheetScale } from "../doc/constraints";
import { localToWorld, normalizeUnit, placeAbove, unionBounds, restack, rotateAbout, translate } from "../doc/edit-ops";
import { expandToUnits, groupObjects, ungroupObjects, unitKey } from "../doc/groups";
import type { AlignKey, GapKey, SortKey, Unit } from "../doc/arrange";
import { buildPayload, ClipboardError, instantiate, parsePayload } from "../doc/clipboard";
import type { ClipboardPayload } from "../doc/clipboard";
import { depthOf } from "../core/frames";
import { alignUnits, arrangeGrid, distributeUnits, gridCells } from "../doc/arrange";
import type { AssetLibrary, AssetRecord } from "../assets/asset-library";
import { duplicateNotice } from "../assets/asset-library";
import type { EditorState } from "./editor-state";
import type { ViewState } from "./view-state";

/** User-level commands shared by keyboard shortcuts, toolbar and tests. */

export function undo(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  doc.undo();
  pruneSelection(doc, editor);
}

export function redo(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  doc.redo();
  pruneSelection(doc, editor);
}

export function pruneSelection(doc: DocumentStore, editor: EditorState): void {
  for (const id of [...editor.selection]) if (!doc.get(id)) editor.selection.delete(id);
  editor.changed();
}

export function deleteSelection(doc: DocumentStore, editor: EditorState): void {
  if (editor.selection.size && editor.blockEdit()) return;
  const ids = [...editor.selection].filter((id) => doc.get(id));
  if (!ids.length) return;
  doc.commit(doc.transaction(ids.length === 1 ? "Delete object" : `Delete ${ids.length} objects`, [], ids));
  editor.select([]);
}

/** The selected objects that exist (in paint order). */
const selected = (doc: DocumentStore, editor: EditorState): CanvasObject[] => doc.ordered().filter((o) => editor.selection.has(o.id));

/** Group the selection (at least two units) into one group at the level the user is working at. */
export function groupSelection(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  const objs = selected(doc, editor);
  const level = editor.entered.length;
  if (new Set(objs.map((o) => o.groups?.[level] ?? o.id)).size < 2) return;
  doc.commit(doc.transaction(`Group ${objs.length} objects`, groupObjects(objs, level)));
  editor.changed();
}

/** Dissolve the selected groups (one level): the members stay selected. */
export function ungroupSelection(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  const changed = ungroupObjects(selected(doc, editor), editor.entered.length);
  if (!changed.length) return;
  doc.commit(doc.transaction("Ungroup", changed));
  editor.changed();
}

/** Bring the selection to the front, or send it to the back, of the paint order. */
export function arrangeSelection(doc: DocumentStore, editor: EditorState, to: "front" | "back"): void {
  if (editor.blockEdit()) return;
  const objs = selected(doc, editor);
  if (!objs.length) return;
  doc.commit(doc.transaction(to === "front" ? "Bring to front" : "Send to back", restack(objs, doc.ordered(), to)));
  editor.changed();
}

export type LayoutCommand = { grid: SortKey; gap?: GapKey } | { align: AlignKey } | { distribute: "x" | "y" };

const LABELS: Record<SortKey, string> = { "name-asc": "A to Z", "name-desc": "Z to A", date: "by date added", size: "by size", type: "by type", stack: "in stacking order" };

/**
 * The selection as units (a group at the level being worked at, else one object) in one frame, without locked ones. Items in different frames
 * are put in the first one's frame exactly (`homed` says they were, so the results go back to the frames that suit them). `within`: the box of
 * the group the unit is in (the one being worked in, or the boolean group the picked shapes are shapes of), which a single unit is lined up with.
 */
function layoutUnits(doc: DocumentStore, editor: EditorState, names: ReadonlyMap<string, { name: string; date: number }>): { units: Unit[]; within: ReturnType<typeof unionBounds>; homed: boolean } | string {
  // (a boolean group's result is derived from its shapes and never moves by itself)
  const chosen = selected(doc, editor);
  const picked = chosen.filter((o) => !o.locked && !isResult(o));
  let level = editor.entered.length;
  // Shapes picked inside one boolean group (in the Layers list, say, without entering it) are lined up with each other, not as the one unit the group is.
  // A boolean group picked as a whole (its result is picked with its shapes) is one unit: it is lined up with what else is picked, or not at all alone.
  const gid = picked[0]?.groups?.[level];
  if (gid && picked.length >= 1 && picked.every((o) => o.groups?.[level] === gid && o.boolOps?.[gid]) && !chosen.some((o) => isResult(o) && o.result === gid)) level += 1;
  const container = level > 0 ? picked[0]?.groups?.[level - 1] : undefined;
  const f0 = picked[0]?.frame ?? doc.space.world;
  const homed = new Set(picked.map((o) => o.frame?.id ?? 0)).size > 1;
  let objs: CanvasObject[];
  let around: CanvasObject[] = [];
  try {
    objs = homed ? picked.map((o) => expressObjectIn(o, f0)) : picked;
    if (container) around = [...doc.all()].filter((o) => o.groups?.includes(container) && !isResult(o) && !o.hidden).map((o) => (homed || (o.frame ?? doc.space.world) !== f0 ? expressObjectIn(o, f0) : o));
  } catch {
    return "These items are too far apart in size to arrange together.";
  }
  const byUnit = new Map<string, CanvasObject[]>();
  for (const o of objs) {
    const k = unitKey(o, level);
    (byUnit.get(k) ?? byUnit.set(k, []).get(k)!).push(o);
  }
  const nameOf = (o: CanvasObject): string => (o.kind === "image" ? (names.get(o.assetId)?.name ?? "") : o.kind === "text" ? plainText(o.md, 40).trim() : "");
  const units = [...byUnit.values()].map((objects) => {
    const first = objects[0]!;
    const date = first.kind === "image" ? names.get(first.assetId)?.date : undefined;
    return { objects, name: nameOf(first), ...(date !== undefined ? { date } : {}) };
  });
  // One item with no group around it but on a sheet is lined up with the sheet (its parent, whatever it holds).
  let within = around.length ? unionBounds(around) : null;
  const parent = units.length === 1 ? objs[0]?.parent : undefined;
  const sheet = parent !== undefined ? doc.get(parent) : undefined;
  if (!within && sheet) {
    try {
      within = worldBounds(expressObjectIn(sheet, f0));
    } catch {
      return "That item is too far from its sheet in size to line it up with it.";
    }
  }
  return { units, within, homed };
}

/**
 * Arrange the selection in a grid, or align or distribute it, as one undoable step of exact translations. `names`
 * maps an image's content hash to its file name and when it was added (for sorting by name or date).
 */
export function layoutSelection(doc: DocumentStore, editor: EditorState, cmd: LayoutCommand, names: ReadonlyMap<string, { name: string; date: number }> = new Map()): void {
  if (editor.blockEdit()) return;
  const laid = layoutUnits(doc, editor, names);
  if (typeof laid === "string") {
    editor.message = laid;
    editor.changed();
    return;
  }
  const { units, within, homed } = laid;
  const need = "distribute" in cmd ? 3 : 2;
  // One item can still be aligned: with what holds it (the group being worked in, the boolean group it is a shape of, or its sheet).
  const alone = "align" in cmd && units.length === 1 && within !== null;
  if (units.length < need && !alone) {
    editor.message = `Select at least ${need} items to ${"distribute" in cmd ? "distribute" : "grid" in cmd ? "arrange" : "align"}${"align" in cmd ? ", or one inside a group or on a sheet to line it up with it" : ""}.`;
    editor.changed();
    return;
  }
  const out = "grid" in cmd ? arrangeGrid(units, cmd.grid, cmd.gap) : "align" in cmd ? alignUnits(units, cmd.align, alone ? (within ?? undefined) : undefined) : distributeUnits(units, cmd.distribute);
  if (!out.length) return; // already in place
  const moved = homed ? out.map((o) => homeObject(o, doc.space)) : out;
  const label = "grid" in cmd ? `Arrange ${units.length} items in a grid ${LABELS[cmd.grid]}` : "align" in cmd ? `Align ${cmd.align}` : `Distribute ${cmd.distribute === "x" ? "horizontally" : "vertically"}`;
  doc.commit(doc.transaction(label, moved));
  editor.changed();
}

// ---- copy, cut, paste, duplicate (ADR 0038) ------------------------------------------------
const CLIP_KEY = "canvast.clipboard";
let inMemory: { payload: ClipboardPayload; text: string } | null = null;
let pastes = 0;
/** CSS px each repeated paste (or duplicate) is moved down and right, so copies do not hide each other. */
const PASTE_STEP_PX = 24;

/** What other apps see on the clipboard as text: the Markdown of copied texts, the SVG of copied shapes (given to copySelection), else a short description. */
const clipboardText = (objs: readonly CanvasObject[]): string => {
  const md = objs.flatMap((o) => (o.kind === "text" ? [o.md] : []));
  return md.length ? md.join("\n\n") : `canvast: ${objs.length} object${objs.length === 1 ? "" : "s"}`;
};

/** Put the selection on the clipboard (the event's, when copying from a copy or cut event). Returns false when nothing is selected. */
export function copySelection(doc: DocumentStore, editor: EditorState, view: ViewState, e?: ClipboardEvent, plain?: string): boolean {
  const objs = selected(doc, editor).filter((o) => !o.locked);
  if (!objs.length) return false;
  const depth = depthOf(view.frameCamera);
  const payload = buildPayload(objs, view.frame, Number(depth.levels) + depth.frac);
  const text = plain ?? clipboardText(objs);
  inMemory = { payload, text };
  pastes = 0;
  try {
    // Another tab of the same browser profile can paste it too (the system clipboard only carries the text).
    localStorage.setItem(CLIP_KEY, JSON.stringify({ payload, text }));
  } catch {
    // too large or storage unavailable: this tab still has it
  }
  e?.clipboardData?.setData("text/plain", text);
  editor.message = `Copied ${objs.length} object${objs.length === 1 ? "" : "s"}`;
  editor.changed();
  return true;
}

/** The text copySelection put on the system clipboard (what a paste must find there to know the copy is still ours). */
export const copiedText = (): string | null => inMemory?.text ?? null;

/** Copy the selection and delete it, as one undo step for the delete. */
export function cutSelection(doc: DocumentStore, editor: EditorState, view: ViewState, e?: ClipboardEvent, plain?: string): boolean {
  if (editor.blockEdit() || !copySelection(doc, editor, view, e, plain)) return false;
  deleteSelection(doc, editor);
  return true;
}

/** The clipboard this tab can paste, if the system clipboard's text is still what was copied (or is not text at all). */
function readClipboard(systemText: string | null): ClipboardPayload | null {
  let own = inMemory;
  if (!own) {
    try {
      const s = JSON.parse(localStorage.getItem(CLIP_KEY) ?? "null") as { payload: unknown; text: string } | null;
      const payload = s && parsePayload(JSON.stringify(s.payload));
      if (payload) own = { payload, text: s.text };
    } catch {
      own = null;
    }
  }
  if (!own) return null;
  // Something else was copied since (outside canvast, or another tab's text): that is not ours to paste.
  return systemText !== null && systemText !== "" && systemText !== own.text ? null : own.payload;
}

/** Whether canvast has objects to paste for this paste event's system clipboard text. */
export const canPaste = (systemText: string | null): boolean => readClipboard(systemText) !== null;

/**
 * Paste the copied objects centred under the pointer (on the middle of the view when the pointer is not on the canvas, each repeat
 * shifting them a little), at the size they had on screen when copied (as one undo step). They become the selection. Returns false if there is nothing to paste.
 */
export function pasteObjects(doc: DocumentStore, editor: EditorState, view: ViewState, systemText: string | null = null, inPlaceOffset = true): boolean {
  if (editor.blockEdit()) return false;
  const payload = readClipboard(systemText);
  if (!payload) return false;
  const cam = view.camera;
  const vp = view.viewport;
  const shift = PASTE_STEP_PX * pastes;
  const p = editor.pointerAt;
  const at = screenToWorld(cam, vp, p ?? { x: vp.width / 2 + (inPlaceOffset ? shift : 0), y: vp.height / 2 + (inPlaceOffset ? shift : 0) });
  const depth = depthOf(view.frameCamera);
  try {
    const { objects, moved } = instantiate(payload, doc.space, doc.topZ(), { frame: view.frame, at, depth: Number(depth.levels) + depth.frac });
    doc.commit(doc.transaction(`Paste ${objects.length} object${objects.length === 1 ? "" : "s"}`, objects));
    editor.select(objects.map((o) => o.id));
    editor.message = moved ? "" : "Pasted in place (copied from a different space)";
    pastes++;
  } catch (e) {
    if (!(e instanceof ClipboardError)) throw e;
    editor.message = e.message;
  }
  editor.changed();
  return true;
}

/** Copy and paste the selection in one step (Ctrl+D): the copy lands a little down and right of the original. */
export function duplicateSelection(doc: DocumentStore, editor: EditorState, view: ViewState, stepPx = PASTE_STEP_PX): void {
  if (editor.blockEdit()) return;
  const objs = selected(doc, editor).filter((o) => !o.locked);
  if (!objs.length) return;
  // Not through the clipboard, which keeps what was copied: the copy lands where the original is, a little offset.
  const depth = depthOf(view.frameCamera);
  const payload = buildPayload(objs, view.frame, Number(depth.levels) + depth.frac);
  const cam = view.camera;
  const centre = payload.centre;
  const at = centre
    ? { x: D.add(D.parse(centre[0]), D.shift(D.fromNumber(stepPx / 2 ** cam.zf), -cam.zi)), y: D.add(D.parse(centre[1]), D.shift(D.fromNumber(stepPx / 2 ** cam.zf), -cam.zi)) }
    : screenToWorld(cam, view.viewport, { x: view.viewport.width / 2, y: view.viewport.height / 2 });
  try {
    const { objects } = instantiate(payload, doc.space, doc.topZ(), { frame: view.frame, at, depth: Number(depth.levels) + depth.frac });
    doc.commit(doc.transaction(`Duplicate ${objects.length} object${objects.length === 1 ? "" : "s"}`, objects));
    editor.select(objects.map((o) => o.id));
  } catch (e) {
    if (!(e instanceof ClipboardError)) throw e;
    editor.message = e.message;
  }
  editor.changed();
}

/** Hide or lock the selected objects (they leave the selection: hidden ones cannot be seen, locked ones cannot be picked). */
export function setFlag(doc: DocumentStore, editor: EditorState, flag: "hidden" | "locked"): void {
  if (editor.blockEdit()) return;
  const objs = selected(doc, editor);
  if (!objs.length) return;
  doc.commit(doc.transaction(flag === "hidden" ? "Hide" : "Lock", objs.map((o) => ({ ...o, [flag]: true }) as CanvasObject)));
  editor.select([]);
}

/** Set or clear a flag on specific objects (the Layers panel's eye and lock). */
export function setFlagOn(doc: DocumentStore, editor: EditorState, ids: readonly string[], flag: "hidden" | "locked", on: boolean): void {
  if (editor.blockEdit()) return;
  const objs = ids.map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o && !!o[flag] !== on);
  if (!objs.length) return;
  const label = flag === "hidden" ? (on ? "Hide" : "Show") : on ? "Lock" : "Unlock";
  doc.commit(
    doc.transaction(
      label,
      objs.map((o) => {
        const { [flag]: _old, ...rest } = o;
        return (on ? { ...rest, [flag]: true } : rest) as CanvasObject;
      }),
    ),
  );
  if (on && flag === "hidden") for (const o of objs) editor.selection.delete(o.id);
  editor.changed();
}

/** Set the opacity of specific objects (the Layers panel's slider); one undo step. */
export function setOpacityOn(doc: DocumentStore, editor: EditorState, ids: readonly string[], opacity: number, final = true): void {
  if (editor.blockEdit()) return;
  const objs = ids.map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o && o.opacity !== opacity);
  if (!final) return showReplaced(editor, objs.map((o) => ({ ...o, opacity })));
  editor.preview = { kind: "none" };
  if (objs.length) doc.commit(doc.transaction("Set opacity", objs.map((o) => ({ ...o, opacity }))));
  editor.changed();
}

/** Set the blend mode of specific objects (null = normal); one undo step (ADR 0047). */
export function setBlendOn(doc: DocumentStore, editor: EditorState, ids: readonly string[], blend: BlendMode | null): void {
  if (editor.blockEdit()) return;
  const objs = ids.map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o && (o.blend ?? null) !== blend);
  if (!objs.length) return;
  doc.commit(
    doc.transaction(
      "Set blend mode",
      objs.map((o) => {
        const { blend: _b, ...rest } = o;
        return (blend ? { ...rest, blend } : rest) as CanvasObject;
      }),
    ),
  );
}

/** Name a layer (an object id) or a group (a group id); an empty name goes back to the automatic label. One undo step (ADR 0047). */
export function renameLayer(doc: DocumentStore, editor: EditorState, key: string, name: string): void {
  if (editor.blockEdit()) return;
  const clean = name.trim().slice(0, MAX_NAME_LENGTH);
  const one = doc.get(key);
  if (one) {
    if ((one.name ?? "") === clean) return;
    const { name: _n, ...rest } = one;
    doc.commit(doc.transaction("Rename layer", [(clean ? { ...rest, name: clean } : rest) as CanvasObject]));
    return;
  }
  const members = doc.ordered().filter((o) => o.groups?.includes(key));
  if (!members.length || members.every((o) => (o.groupNames?.[key] ?? "") === clean)) return;
  doc.commit(
    doc.transaction(
      "Rename group",
      members.map((o) => {
        const { groupNames, ...rest } = o;
        const { [key]: _old, ...others } = groupNames ?? {};
        const next = clean ? { ...others, [key]: clean } : others;
        return (Object.keys(next).length ? { ...rest, groupNames: next } : rest) as CanvasObject;
      }),
    ),
  );
}

/** Change a media instance's paused position or repeat mode (one undo step); a no-op when nothing changes. */
export function setMedia(doc: DocumentStore, editor: EditorState, id: string, patch: Partial<Pick<MediaState, "t" | "repeat">> & { range?: readonly [number, number] | null; speed?: number }, label = "Media"): void {
  if (editor.blockEdit()) return;
  const o = doc.get(id);
  if (!o || o.kind !== "image" || !o.media) return;
  const { range, speed, ...rest } = patch;
  const { range: oldRange, speed: oldSpeed, ...kept } = o.media;
  const next = range === undefined ? oldRange : (range ?? undefined);
  const rate = speed === undefined ? oldSpeed : speed === 1 ? undefined : Math.max(0.25, Math.min(4, speed));
  const media: MediaState = { ...kept, ...rest, ...(next ? { range: next } : {}), ...(rate ? { speed: rate } : {}) };
  const same = (a?: readonly [number, number], b?: readonly [number, number]): boolean => a?.[0] === b?.[0] && a?.[1] === b?.[1];
  if (media.t === o.media.t && media.repeat === o.media.repeat && same(next, oldRange) && media.speed === o.media.speed) return;
  doc.commit(doc.transaction(label, [{ ...o, media }]));
}

/** Move objects in front of `above` in the paint order (the Layers panel's drag). */
export function moveAbove(doc: DocumentStore, editor: EditorState, ids: readonly string[], aboveId: string): void {
  if (editor.blockEdit()) return;
  const moving = ids.map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o);
  const above = doc.get(aboveId);
  if (!moving.length || !above || moving.some((o) => o.id === aboveId)) return;
  const changed = placeAbove(doc.ordered(), moving, above);
  if (changed.length) doc.commit(doc.transaction("Reorder", changed));
  editor.changed();
}

/**
 * Put the whole stacking order in the given order (front to back), e.g. a name sort from the Layers panel. Only `z` changes: no
 * position, size or group is touched. One undo step.
 */
export function setStackOrder(doc: DocumentStore, editor: EditorState, order: readonly string[], label: string): void {
  if (editor.blockEdit()) return;
  const byId = new Map(doc.ordered().map((o) => [o.id, o] as const));
  const back = [...order].reverse().filter((id) => byId.has(id));
  const changed: CanvasObject[] = [];
  back.forEach((id, z) => {
    const o = byId.get(id)!;
    if (o.z !== z) changed.push({ ...o, z });
  });
  if (!changed.length) {
    editor.message = "Already in that order";
    editor.changed();
    return;
  }
  doc.commit(doc.transaction(label, changed));
  editor.message = `${label} (${changed.length} changed)`;
  editor.changed();
}

/**
 * Add or remove in-canvas tags (ADR 0062) on objects: one undo step. Tags are tidied the same way as library tags (spaces collapsed,
 * a leading # dropped, case-insensitive duplicates merged). Returns how many objects changed.
 */
export function tagObjects(doc: DocumentStore, editor: EditorState, ids: readonly string[], change: { add?: readonly string[]; remove?: readonly string[] }): number {
  if (editor.blockEdit()) return 0;
  const note = tagFormatNote(change.add ?? []);
  if (note) {
    editor.message = note;
    editor.changed();
  }
  const add = normalizeTags(change.add ?? []);
  const drop = new Set((change.remove ?? []).map((t) => t.replace(/^#+/, "").trim().toLowerCase()));
  const changed: CanvasObject[] = [];
  for (const id of ids) {
    const o = doc.get(id);
    if (!o) continue;
    const next = normalizeTags([...(o.tags ?? []).filter((t) => !drop.has(t.toLowerCase())), ...add]);
    if (next.length === (o.tags ?? []).length && next.every((t, i) => t === o.tags![i])) continue;
    const { tags: _old, ...rest } = o;
    changed.push((next.length ? { ...rest, tags: next } : rest) as CanvasObject);
  }
  if (!changed.length) return 0;
  doc.commit(doc.transaction(add.length ? "Add tags" : "Remove tag", changed));
  editor.changed();
  return changed.length;
}

/** Rename (`target`) or remove (null) the in-canvas tag `key` (lower-cased) on every object of the open canvas, as one undo step (ADR 0070). */
export function changeTagOnCanvas(doc: DocumentStore, editor: EditorState, key: string, target: string | null): number {
  if (editor.blockEdit()) return 0;
  const changed: CanvasObject[] = [];
  for (const o of doc.ordered()) {
    if (!(o.tags ?? []).some((t) => tagIsOrUnder(t, key))) continue;
    const next = normalizeTags((o.tags ?? []).flatMap((t) => (tagIsOrUnder(t, key) ? (target ? [renamedTag(t, key, target)!] : []) : [t])));
    const { tags: _old, ...rest } = o;
    changed.push((next.length ? { ...rest, tags: next } : rest) as CanvasObject);
  }
  if (!changed.length) return 0;
  doc.commit(doc.transaction(target ? "Rename tag" : "Remove tag", changed));
  editor.changed();
  return changed.length;
}

/**
 * Take the turn off the selected items (each about its own middle, so none moves) and, separately, give stretched pictures their
 * own proportions back (the same width and middle, the height of the original). One undo step each. Return how many changed.
 */
export function resetRotation(doc: DocumentStore, editor: EditorState): number {
  if (editor.blockEdit()) return 0;
  const turned = selected(doc, editor).filter((o) => !o.locked && o.rot);
  if (!turned.length) return 0;
  const next = turned.map((o) => {
    const pv = pivotOf(o);
    return rotateAbout(o, localToWorld(o, pv.x, pv.y), -(o.rot ?? 0));
  });
  doc.commit(doc.transaction(next.length === 1 ? "Reset rotation" : `Reset rotation of ${next.length} items`, next));
  editor.changed();
  return next.length;
}

const distorted = (o: CanvasObject): o is ImageObject => o.kind === "image" && !o.rot && !o.locked && Math.abs(o.w / o.h / (o.pixelW / o.pixelH) - 1) > 0.002;

export function resetProportions(doc: DocumentStore, editor: EditorState): number {
  if (editor.blockEdit()) return 0;
  const stretched = selected(doc, editor).filter(distorted);
  if (!stretched.length) return 0;
  const next = stretched.map((o): CanvasObject => {
    const h = (o.w * o.pixelH) / o.pixelW;
    // The middle stays where it is: the top moves by half of what the height changes by.
    const anchor = { x: o.anchor.x, y: D.add(o.anchor.y, D.shift(D.fromNumber((o.h - h) / 2), o.unit)) };
    return normalizeUnit({ ...o, h, anchor });
  });
  doc.commit(doc.transaction(next.length === 1 ? "Reset proportions" : `Reset proportions of ${next.length} pictures`, next));
  editor.changed();
  return next.length;
}

/** Whether any selected item is turned, or any selected picture stretched (the selection bar shows the reset buttons then). */
export function resettable(doc: DocumentStore, editor: EditorState): { turned: boolean; stretched: boolean; bakeable: boolean } {
  const sel = selected(doc, editor);
  return { turned: sel.some((o) => !o.locked && !!o.rot), stretched: sel.some(distorted), bakeable: sel.some(canApplyRotation) };
}

/** A turned shape whose paint does not depend on its box: its points can take the turn (a gradient or an objects fill is laid out in the box it is turned with). */
const canApplyRotation = (o: CanvasObject): o is PathObject => o.kind === "path" && !o.locked && !!o.rot && o.result === undefined && (o.fill === null || typeof o.fill === "string") && (o.stroke === null || typeof o.stroke === "string");

/**
 * Make the turn of the selected shapes their own: the points are turned and the turn is set to nothing, so a shape looks the same, is "not turned"
 * (its box fits it, and Reset rotation has nothing to undo) and a later turn starts from here. A polygon or star becomes an ordinary path (its numbers
 * were made for the unturned shape). One undo step. Returns how many changed.
 */
export function applyRotation(doc: DocumentStore, editor: EditorState): number {
  if (editor.blockEdit()) return 0;
  const next = selected(doc, editor).filter(canApplyRotation).map((o) => {
    const { rot: _rot, params: _params, ...rest } = o;
    return { ...rest, sub: pathSubs(o), ...(o.base ? { base: editSubs(o) } : {}) } as PathObject;
  });
  if (!next.length) return 0;
  doc.commit(doc.transaction(next.length === 1 ? "Apply rotation" : `Apply rotation of ${next.length} shapes`, next));
  editor.changed();
  return next.length;
}

/** Show every hidden object, or unlock every locked one. */
export function clearFlag(doc: DocumentStore, editor: EditorState, flag: "hidden" | "locked"): void {
  if (editor.blockEdit()) return;
  const flagged = doc.ordered().filter((o) => o[flag]);
  if (!flagged.length) return;
  doc.commit(
    doc.transaction(
      flag === "hidden" ? "Show all" : "Unlock all",
      flagged.map((o) => {
        const { [flag]: _gone, ...rest } = o;
        return rest as CanvasObject;
      }),
    ),
  );
  editor.message = `${flag === "hidden" ? "Showed" : "Unlocked"} ${flagged.length} object${flagged.length === 1 ? "" : "s"}`;
  editor.changed();
}

/** Largest fraction of the viewport a newly placed image may cover. */
const PLACE_MAX_VIEWPORT_FRACTION = 0.6;
/** Largest fraction of the viewport a batch of imported images may cover together. */
const GRID_VIEWPORT_FRACTION = 0.9;
/** Gap between grid cells, as a fraction of the larger cell side. */
const GRID_GAP = 0.08;

/** What kind of media a stored original is when placed; undefined for a plain image (a still GIF is one). */
function mediaKindOf(rec: Pick<AssetRecord, "type" | "frames">): MediaState["kind"] | undefined {
  if (rec.type?.startsWith("video/")) return "video";
  if (rec.type?.startsWith("audio/")) return "audio";
  return rec.type === "image/gif" && (rec.frames ?? 0) > 1 ? "gif" : undefined;
}

/** The image object for `rec` with its top-left corner at screen (x, y) and a size of wPx by hPx CSS px. */
function imageAt(rec: Pick<AssetRecord, "hash" | "pixelW" | "pixelH" | "type" | "frames">, doc: DocumentStore, view: ViewState, x: number, y: number, wPx: number, hPx: number, z: number): ImageObject {
  const cam = view.camera;
  const f = 2 ** cam.zf; // local unit = 2^-zi world = f CSS px
  const c = screenToWorld(cam, view.viewport, { x, y });
  const unit = -cam.zi;
  const img: ImageObject = {
    id: newObjectId(),
    kind: "image",
    // `c` is in the camera frame's coordinates (ADR 0014).
    ...(view.frame === doc.space.world ? {} : { frame: view.frame }),
    anchor: c,
    unit,
    z,
    opacity: 1,
    attachmentTargetId: null,
    assetId: rec.hash,
    w: wPx / f,
    h: hPx / f,
    pixelW: rec.pixelW,
    pixelH: rec.pixelH,
    // A video is placed paused at its start (never autoplaying), ADR 0041.
    ...(mediaKindOf(rec) ? { media: { kind: mediaKindOf(rec)!, t: 0, repeat: false } } : {}),
  };
  return homeObject(normalizeUnit(img), doc.space) as ImageObject;
}

/**
 * Place one new instance of a stored asset at the viewport centre (shifted by
 * `offsetPx`), at the current scale: 1 source pixel = 1 CSS px, shrunk to fit.
 * Placing does not select it or touch any existing object.
 */
export function placeImage(
  rec: Pick<AssetRecord, "hash" | "pixelW" | "pixelH" | "type" | "frames">,
  doc: DocumentStore,
  view: ViewState,
  offsetPx: number,
  label: string,
  tags: readonly string[] = [],
): ImageObject {
  const vp = view.viewport;
  const fit = Math.min(1, (PLACE_MAX_VIEWPORT_FRACTION * vp.width) / rec.pixelW, (PLACE_MAX_VIEWPORT_FRACTION * vp.height) / rec.pixelH);
  const w = rec.pixelW * fit;
  const h = rec.pixelH * fit;
  const placed = imageAt(rec, doc, view, vp.width / 2 + offsetPx - w / 2, vp.height / 2 + offsetPx - h / 2, w, h, doc.topZ() + 1);
  const obj = tags.length ? ({ ...placed, tags: normalizeTags(tags) } as ImageObject) : placed;
  doc.commit(doc.transaction(label, [obj]));
  return obj;
}

/**
 * Lay a batch of images out in a roughly square grid, centred on the viewport (ADR 0030). Cells are as large as the
 * largest image, each image is centred in its cell, rows fill left to right in the given order, and the columns are
 * chosen so the whole grid is about as wide as it is tall (cols = round(sqrt(n x cellH / cellW))). The grid is then
 * scaled down, never up, to fit 90% of the viewport; every image keeps its own aspect ratio. Sizes and the result are
 * in CSS px, results from the viewport's top-left.
 */
export function gridLayout(sizes: ReadonlyArray<{ w: number; h: number }>, vp: { width: number; height: number }): Array<{ x: number; y: number; w: number; h: number }> {
  const n = sizes.length;
  if (!n) return [];
  const g = gridCells(sizes, GRID_GAP);
  const gridW = g.w;
  const gridH = g.h;
  const k = Math.min(1, (GRID_VIEWPORT_FRACTION * vp.width) / gridW, (GRID_VIEWPORT_FRACTION * vp.height) / gridH);
  const x0 = vp.width / 2 - (gridW * k) / 2;
  const y0 = vp.height / 2 - (gridH * k) / 2;
  return sizes.map((s, i) => ({ x: x0 + g.cells[i]!.x * k, y: y0 + g.cells[i]!.y * k, w: s.w * k, h: s.h * k }));
}

/** Place a batch of images in a grid as one undoable step (see gridLayout). */
export function placeImages(
  recs: ReadonlyArray<Pick<AssetRecord, "hash" | "pixelW" | "pixelH" | "type" | "frames">>,
  doc: DocumentStore,
  view: ViewState,
  label: string,
  /** In-canvas tags to put on each placed instance, by the original's hash. */
  tagsOf: ReadonlyMap<string, readonly string[]> = new Map(),
): ImageObject[] {
  const cells = gridLayout(recs.map((r) => ({ w: r.pixelW, h: r.pixelH })), view.viewport);
  const z = doc.topZ();
  const objs = recs.map((r, i) => {
    const o = imageAt(r, doc, view, cells[i]!.x, cells[i]!.y, cells[i]!.w, cells[i]!.h, z + 1 + i);
    const tags = tagsOf.get(r.hash) ?? [];
    return tags.length ? ({ ...o, tags: normalizeTags(tags) } as ImageObject) : o;
  });
  doc.commit(doc.transaction(label, objs));
  return objs;
}

/**
 * Extract Frame (ADR 0043): the picture a video or GIF instance shows now becomes a new PNG original in the library
 * and a plain image placed just right of the instance, at its size. The source is never changed.
 */
export async function extractFrame(
  doc: DocumentStore,
  editor: EditorState,
  assets: AssetLibrary,
  sourceId: string,
  png: Blob,
  label: string,
  store: (shot: { png: Blob; label: string; sourceName: string; sourceHash: string }) => Promise<AssetRecord>,
): Promise<void> {
  if (editor.blockEdit()) return;
  const src = doc.get(sourceId);
  if (!src || src.kind !== "image" || !src.media) return;
  const sourceName = (await assets.record(src.assetId).catch(() => undefined))?.name ?? "";
  const record = await store({ png, label, sourceName, sourceHash: src.assetId });
  const { media: _m, groups: _g, hidden: _h, locked: _l, rot, ...rest } = src;
  const frame: ImageObject = { ...rest, ...(rot ? { rot } : {}), id: newObjectId(), assetId: record.hash, pixelW: record.pixelW, pixelH: record.pixelH, z: doc.topZ() + 1 };
  const placed = translate(frame, D.shift(D.fromNumber(src.w * 1.05), src.unit), D.ZERO) as ImageObject;
  doc.commit(doc.transaction("Extract frame", [placed]));
  editor.select([placed.id]);
}

/** Import files (any type: pictures, video and audio show as themselves, anything else as a card, ADR 0078) and place one instance of each (see placeImage). */
export async function importImages(
  files: Iterable<File>,
  assets: AssetLibrary,
  doc: DocumentStore,
  view: ViewState,
  editor: EditorState,
): Promise<ImageObject[]> {
  if (editor.blockEdit()) return [];
  const list = [...files];
  const records: AssetRecord[] = [];
  const seen: Array<{ name: string; duplicate: "present" | "restored" }> = [];
  let done = 0;
  const progress = beginProgress(editor, "import", list.length > 1 ? "Importing files" : "Importing");
  for (const file of list) {
    // Say so at once, for one file as for many: reading a big video takes a while.
    progress.update(list.length > 1 ? done / list.length : null, list.length > 1 ? `${done + 1} of ${list.length}, ${file.name || "file"}` : file.name || "file");
    done++;
    try {
      const { record, duplicate } = await assets.importFileDetailed(file, list.length <= 3);
      if (duplicate) seen.push({ name: record.name || file.name, duplicate });
      records.push(record);
    } catch (e) {
      editor.message = `Could not import ${file.name || "file"}: ${(e as Error).message}`;
      editor.changed();
    }
  }
  // One image goes in the middle as before; several go in a grid. Either way, one undo step.
  const placed = records.length === 1 ? [placeImage(records[0]!, doc, view, 0, "Import file")] : records.length ? placeImages(records, doc, view, `Import ${records.length} files`) : [];
  const notice = duplicateNotice(seen, list.length);
  progress.done();
  // A file the app cannot show is kept as a card: say so once, and what to do.
  const cards = records.filter((r) => isCard(r));
  const cardNote = !cards.length ? "" : cards.length === 1 ? `“${cards[0]!.name || "File"}” has no preview here, so it shows as a card. Select it to download it.` : `${cards.length} files have no preview here and show as cards. Select one to download it.`;
  editor.message = notice ?? (cardNote || (list.length > 3 ? `Imported ${records.length} files.` : ""));
  editor.changed();
  return placed;
}

// ---- Fill and outline of paths (ADR 0099) --------------------------------------------------------

/** The selected paths that can be edited (not locked), in paint order. */
const editablePaths = (doc: DocumentStore, editor: EditorState): PathObject[] =>
  // (the shapes inside a boolean group take no paint from outside it: the group's result has the look; they are painted when it is entered)
  selected(doc, editor).filter((o): o is PathObject => o.kind === "path" && !o.locked && boolGroupsOf(o).every((g) => g.own || editor.entered.includes(g.gid)));

/** The picked pictures (not locked): they take an outline and rounded corners as shapes do (ADR 0148), by the same controls. */
const outlinedPictures = (doc: DocumentStore, editor: EditorState): ImageObject[] => selected(doc, editor).filter((o): o is ImageObject => o.kind === "image" && !o.locked);
/** What takes an outline: the picked paths and pictures, in the order they are picked. */
const lined = (doc: DocumentStore, editor: EditorState): Array<PathObject | ImageObject> => selected(doc, editor).filter((o): o is PathObject | ImageObject => !o.locked && (o.kind === "image" || (o.kind === "path" && boolGroupsOf(o).every((g) => g.own || editor.entered.includes(g.gid)))));

/** What a saved colour or gradient can be put on: the picked shapes, texts (the letters' fill and outline) and pen strokes (one colour). */
const paintTargets = (doc: DocumentStore, editor: EditorState): Array<PathObject | TextObject | StrokeObject | ImageObject> => [
  ...editablePaths(doc, editor),
  ...selected(doc, editor).filter((o): o is TextObject | StrokeObject => (o.kind === "text" || o.kind === "stroke") && !o.locked),
  ...outlinedPictures(doc, editor),
];

/** How many selected things a colour or gradient can be put on. */
export const paintTargetCount = (doc: DocumentStore, editor: EditorState): number => paintTargets(doc, editor).length;

/** The solid colours the selected shapes, texts and strokes use, without transparency, each once, in the order they are met. */
export function selectionColours(doc: DocumentStore, editor: EditorState): string[] {
  const out: string[] = [];
  for (const o of paintTargets(doc, editor)) {
    const paints: Array<Paint | null | undefined> = o.kind === "path" ? [o.fill, o.stroke] : o.kind === "text" ? [o.color, o.outline?.c] : o.kind === "image" ? [o.stroke] : [o.color];
    for (const p of paints) if (typeof p === "string" && !out.includes(p.slice(0, 7).toLowerCase())) out.push(p.slice(0, 7).toLowerCase());
  }
  return out;
}

/** The first colour of a paint: a gradient on a thing that has one colour only (a pen stroke) gives its start. */
const firstColour = solidOf;

/** `o` with a fill and outline patch applied the way its kind takes it: a shape has both; a text fills its letters and outlines them; a stroke has one colour. */
export function paintedWith(o: PathObject | TextObject | StrokeObject | ImageObject, patch: PaintPatch, link?: { fill?: string; stroke?: string }): PathObject | TextObject | StrokeObject | ImageObject {
  // The parts the patch changes follow the style it came from (`link`), or none: changing a part by hand unlinks it.
  return withStyleLinks(paintedWithRaw(o, patch), { ...(patch.fill !== undefined && o.kind !== "image" ? { fill: link?.fill ?? null } : {}), ...(patch.stroke !== undefined ? { stroke: link?.stroke ?? null } : {}) }); // (a picture has no fill to follow a style)
}

/** The paint of the patch put on `o`, its links to saved styles untouched (what keeps them in step with a style that changed). */
export function paintedWithRaw(o: PathObject | TextObject | StrokeObject | ImageObject, patch: PaintPatch): PathObject | TextObject | StrokeObject | ImageObject {
  if (o.kind === "image") {
    // a picture has an outline only, a colour or a gradient; none takes the outline away (its width is kept for when it is turned on)
    if (patch.stroke === undefined) return o;
    const { stroke: _s, ...rest } = o;
    return patch.stroke === null ? rest : { ...rest, stroke: patch.stroke, width: o.width ?? Math.max(Math.min(o.w, o.h) / 50, Number.MIN_VALUE) };
  }
  if (o.kind === "path") return { ...o, ...(patch.fill !== undefined ? { fill: patch.fill } : {}), ...(patch.stroke !== undefined ? { stroke: patch.stroke } : {}) };
  if (o.kind === "stroke") {
    const p = patch.fill ?? patch.stroke;
    return p ? { ...o, color: firstColour(p) } : o;
  }
  let t: TextObject = o;
  if (patch.fill) {
    const { gradient: _g, ...rest } = t;
    t = typeof patch.fill === "string" ? { ...rest, color: patch.fill } : isGradient(patch.fill) ? { ...t, gradient: patch.fill } : t;
  }
  if (patch.stroke === null) {
    const { outline: _o, ...rest } = t;
    t = rest;
  } else if (patch.stroke) t = { ...t, outline: { c: firstColour(patch.stroke), w: t.outline?.w ?? 0.05 } };
  return t;
}

/** The fill and outline of the first selected path, or null when none is selected. */
export function selectedPaint(doc: DocumentStore, editor: EditorState): { fill: Paint | null; stroke: Paint | null } | null {
  const o = lined(doc, editor)[0];
  if (o?.kind === "path" && o.net && editor.region?.id === o.id) return { fill: regionFillAt(o, editor.region.at), stroke: o.stroke };
  return o ? (o.kind === "image" ? { fill: null, stroke: o.stroke ?? null } : { fill: o.fill, stroke: o.stroke }) : null;
}

export interface PaintPatch {
  fill?: Paint | null;
  stroke?: Paint | null;
}

/** Show a new fill or outline on the selected paths without storing it (the picker is still being dragged). */
export function previewPaint(doc: DocumentStore, editor: EditorState, patch: PaintPatch): void {
  const ids = lined(doc, editor).map((o) => o.id);
  if (!ids.length || editor.blockEdit()) return;
  if (editor.region && patch.fill !== undefined) return; // (a picked region is coloured when the picker lets go)
  editor.preview = { kind: "paint", ids, ...patch };
  editor.changed();
}

/** Store a new fill or outline on the selected paths: one undo step. */
export function commitPaint(doc: DocumentStore, editor: EditorState, patch: PaintPatch, link?: { fill?: string; stroke?: string }): void {
  editor.preview = { kind: "none" };
  const r = editor.region;
  const net = r ? doc.get(r.id) : undefined;
  if (r && net?.kind === "path" && net.net && patch.fill !== undefined && editor.selection.size === 1 && editor.selection.has(r.id) && !net.locked) {
    // a region of a network is picked: its fill is the one that changes (ADR 0150)
    const regions = withRegionFill(net, r.at, patch.fill);
    if (!editor.blockEdit() && JSON.stringify(regions) !== JSON.stringify(net.regions)) {
      const { regions: _r, ...rest } = net;
      doc.commit(doc.transaction("Change region fill", [regions.fills.length ? { ...rest, regions } : rest]));
    }
    if (patch.stroke === undefined) { editor.changed(); return; }
    patch = { stroke: patch.stroke };
  }
  const next = paintTargets(doc, editor).map((o) => [o, paintedWith(o, patch, link)] as const).filter(([o, n]) => JSON.stringify(paintsOf(o)) !== JSON.stringify(paintsOf(n)) || JSON.stringify(o.styles) !== JSON.stringify(n.styles)); // (the paints only: an object holds big numbers JSON cannot write)
  if (next.length && !editor.blockEdit()) {
    const what = patch.fill !== undefined && patch.stroke !== undefined ? "fill and outline" : patch.fill !== undefined ? "fill" : "outline";
    doc.commit(doc.transaction(next.length === 1 ? `Change ${what}` : `Change ${what} of ${next.length} objects`, next.map(([, n]) => n)));
  }
  editor.changed();
}

/** The corners, ends and place on the edge of the first selected path's outline (null: no path is selected). `closed`: every sub-path is closed, so the outline can be inside or outside. */
export function selectedOutline(doc: DocumentStore, editor: EditorState): { join: JoinChoice; cap: CapChoice; align: AlignChoice; dash: DashChoice; closed: boolean } | null {
  const o = lined(doc, editor)[0];
  return o ? { join: joinChoice(o as PathObject), cap: capChoice(o as PathObject), align: alignChoice(o as PathObject), dash: dashChoice(o as PathObject), closed: o.kind === "image" || (o.sub.length > 0 && o.sub.every((s) => s.closed)) } : null;
}

/** Dash length, gap and start, in widths of the outline, of the first selected path (null: it has no dashes). */
export function selectedDashNumbers(doc: DocumentStore, editor: EditorState): { len: number; gap: number; offset: number } | null {
  const o = lined(doc, editor)[0];
  return o?.dash ? { len: o.dash[0], gap: o.dash[1], offset: o.dashOffset ?? 0 } : null;
}

/** Set the dash numbers of the selected dashed paths: one undo step. A pattern of no length and no gap is refused. */
export function commitDashNumbers(doc: DocumentStore, editor: EditorState, n: { len?: number; gap?: number; offset?: number }): void {
  const paths = lined(doc, editor).filter((o) => o.dash);
  if (!paths.length || editor.blockEdit()) return;
  const next = paths.map((o): PathObject | ImageObject => {
    const len = n.len ?? o.dash![0];
    const gap = n.gap ?? o.dash![1];
    const { dashOffset: _o, cap: _c, ...rest } = o;
    const off = n.offset ?? o.dashOffset ?? 0;
    if (!(len + gap > 0)) return o;
    const look: StrokeLook = { dash: [len, gap], ...(off ? { dashOffset: off } : {}), ...(len !== 0 && o.cap ? { cap: o.cap } : {}) }; // (a dot needs round ends, which is no cap)
    return { ...rest, ...look };
  });
  doc.commit(doc.transaction(paths.length === 1 ? "Dash pattern" : `Dash pattern of ${paths.length} paths`, next));
  editor.changed();
}

/** The angle below which a sharp corner of the first picked path is cut (degrees; the default when none was set). */
export function selectedMiterAngle(doc: DocumentStore, editor: EditorState): number | null {
  const o = lined(doc, editor)[0];
  return o ? Math.round(o.miterAngle ?? (2 * Math.asin(1 / MITER_LIMIT) * 180) / Math.PI) : null;
}

/** Set the angle below which sharp corners are cut on the picked paths (null: the default again): one undo step. */
export function commitMiterAngle(doc: DocumentStore, editor: EditorState, deg: number | null): void {
  const paths = lined(doc, editor);
  if (!paths.length || editor.blockEdit()) return;
  const next = paths.map((o): PathObject | ImageObject => {
    const { miterAngle: _m, ...rest } = o;
    return deg === null ? rest : { ...rest, miterAngle: Math.min(90, Math.max(1, deg)) };
  });
  doc.commit(doc.transaction(paths.length === 1 ? "Sharp corner limit" : `Sharp corner limit of ${paths.length} paths`, next));
  editor.changed();
}

const ARROW_NONE = "none";
/** The arrow heads of the first picked path that has an open outline (null: there is none). */
export function selectedArrows(doc: DocumentStore, editor: EditorState): { start: Arrow | "none"; end: Arrow | "none" } | null {
  const o = editablePaths(doc, editor).find((p) => p.sub.some((s) => !s.closed));
  return o ? { start: o.arrowStart ?? ARROW_NONE, end: o.arrowEnd ?? ARROW_NONE } : null;
}

/** Set or take away the arrow head at the start or the end of the picked open paths: one undo step. */
export function commitArrows(doc: DocumentStore, editor: EditorState, patch: { start?: Arrow | "none"; end?: Arrow | "none" }): void {
  const paths = editablePaths(doc, editor).filter((p) => p.sub.some((s) => !s.closed));
  if (!paths.length || editor.blockEdit()) return;
  const next = paths.map((o): PathObject => {
    const { arrowStart: _s, arrowEnd: _e, ...rest } = o;
    const start = patch.start ?? o.arrowStart ?? ARROW_NONE;
    const end = patch.end ?? o.arrowEnd ?? ARROW_NONE;
    return { ...rest, ...(start !== ARROW_NONE ? { arrowStart: start } : {}), ...(end !== ARROW_NONE ? { arrowEnd: end } : {}) };
  });
  doc.commit(doc.transaction(paths.length === 1 ? "Arrow heads" : `Arrow heads of ${paths.length} paths`, next));
  editor.changed();
}

export interface OutlinePatch {
  join?: JoinChoice;
  cap?: CapChoice;
  align?: AlignChoice;
  dash?: DashChoice;
}

/** Change the corners, ends or place on the edge of the selected paths' outlines: one undo step. */
export function commitOutline(doc: DocumentStore, editor: EditorState, patch: OutlinePatch): void {
  const paths = lined(doc, editor);
  if (!paths.length || editor.blockEdit()) return;
  const next = paths.map((o): PathObject | ImageObject => {
    const { join: _j, cap: _c, align: _a, dash: _d, dashOffset: _o, ...rest } = o;
    const dash = patch.dash ?? dashChoice(o as PathObject);
    const look = lookFromChoices(patch.join ?? joinChoice(o as PathObject), patch.dash === "dotted" ? "round" : patch.cap ?? capChoice(o as PathObject), patch.align ?? alignChoice(o as PathObject), undefined, dash);
    // a changed preset starts its own pattern at 0; any other change keeps the numbers the user typed
    const keep: StrokeLook = {};
    if (patch.dash === undefined && o.dash) {
      keep.dash = o.dash;
      if (o.dashOffset) keep.dashOffset = o.dashOffset;
    }
    return { ...rest, ...look, ...keep } as PathObject | ImageObject;
  });
  const label = patch.align !== undefined ? "Outline position" : patch.dash !== undefined ? "Outline dashes" : patch.join !== undefined ? "Outline corners" : "Outline ends";
  doc.commit(doc.transaction(paths.length === 1 ? label : `${label} of ${paths.length} paths`, next));
  editor.changed();
}

const paintKey = (p: Paint | null): string => JSON.stringify(p);

/** The paints of one picked thing, by part: a shape's fill and outline, a text's fill (its gradient, else its colour) and outline, a stroke's colour. */
function paintsOf(o: PathObject | TextObject | StrokeObject | ImageObject): Array<{ part: "fill" | "stroke"; paint: Paint }> {
  const out: Array<{ part: "fill" | "stroke"; paint: Paint }> = [];
  if (o.kind === "image") {
    if (o.stroke !== undefined) out.push({ part: "stroke", paint: o.stroke });
  } else if (o.kind === "path") {
    if (o.fill !== null) out.push({ part: "fill", paint: o.fill });
    if (o.stroke !== null) out.push({ part: "stroke", paint: o.stroke });
  } else if (o.kind === "text") {
    out.push({ part: "fill", paint: o.gradient ?? o.color });
    if (o.outline) out.push({ part: "stroke", paint: o.outline.c });
  } else out.push({ part: "fill", paint: o.color });
  return out;
}

/** The paints the picked shapes, texts and strokes use, each once (a gradient counts as one paint, equal ones together), in the order they first appear, with how many fills and outlines use it; `count`: how many things. */
export function selectionPaints(doc: DocumentStore, editor: EditorState): { count: number; items: Array<{ paint: Paint; fills: number; strokes: number; ids: string[] }> } {
  const targets = paintTargets(doc, editor);
  const seen = new Map<string, { paint: Paint; fills: number; strokes: number; ids: string[] }>();
  for (const o of targets) {
    for (const { part, paint: v } of paintsOf(o)) {
      const k = paintKey(v);
      const e = seen.get(k) ?? { paint: v, fills: 0, strokes: 0, ids: [] };
      if (!e.ids.includes(o.id)) e.ids.push(o.id);
      if (part === "fill") e.fills++;
      else e.strokes++;
      seen.set(k, e);
    }
  }
  // The most used first, then in the order they first appear.
  return { count: targets.length, items: [...seen.values()].map((e, i) => ({ e, i })).sort((a, b) => b.e.fills + b.e.strokes - (a.e.fills + a.e.strokes) || a.i - b.i).map((x) => x.e) };
}

/** Change one paint to another everywhere the picked shapes, texts and strokes use it (fills and outlines): a colour, a gradient (each shape keeps its own box; a stroke takes the first colour of it), or none (a text and a stroke keep their colour). Shown while a picker is dragged, stored once. */
export function recolour(doc: DocumentStore, editor: EditorState, from: Paint, to: Paint | null, final: boolean): void {
  if (editor.blockEdit()) return;
  const key = paintKey(from);
  const next: Array<PathObject | TextObject | StrokeObject | ImageObject> = [];
  for (const o of paintTargets(doc, editor)) {
    const hit = paintsOf(o).filter((x) => paintKey(x.paint) === key).map((x) => x.part);
    if (!hit.length) continue;
    const patch: PaintPatch = { ...(hit.includes("fill") ? { fill: to } : {}), ...(hit.includes("stroke") ? { stroke: to } : {}) };
    if (o.kind !== "path" && to === null) {
      // nothing to take away from a text's letters or a stroke: only a text's (or a picture's) outline can go
      if ((o.kind === "text" || o.kind === "image") && hit.includes("stroke")) next.push(paintedWith(o, { stroke: null }));
      continue;
    }
    next.push(paintedWith(o, patch));
  }
  if (!final) return showReplaced(editor, next);
  editor.preview = { kind: "none" };
  if (next.length) doc.commit(doc.transaction(next.length === 1 ? "Change colour" : `Change colour of ${next.length} objects`, next));
  editor.changed();
}

/** The objects as a change would leave them, boolean results included (the transaction derives them without storing anything), for a live preview. */
function derivedPreview(doc: DocumentStore, next: readonly PathObject[]): PathObject[] {
  const tx = doc.transaction("preview", next);
  return [...tx.after.values()].filter((o): o is PathObject => !!o && o.kind === "path");
}

/** Show these objects as they would be (a number being changed), without storing them: the live look of every field, until it is committed. */
export function showReplaced(editor: EditorState, next: readonly CanvasObject[]): void {
  editor.preview = next.length ? { kind: "replace", ids: next.map((o) => o.id), objs: new Map(next.map((o) => [o.id, o] as const)) } : { kind: "none" };
  editor.changed();
}

/** What the first selected shape whose numbers can still be changed (a polygon or star made from them) is made of. */
export function selectedShape(doc: DocumentStore, editor: EditorState): { id: string; shape: "polygon" | "star"; sides: number; tips: number; inner: number } | null {
  for (const o of editablePaths(doc, editor)) {
    const p = o.shape === "polygon" || o.shape === "star" ? paramsOf(o) : null;
    if (p && (o.shape === "polygon" || o.shape === "star")) return { id: o.id, shape: o.shape, sides: p.sides ?? 6, tips: p.tips ?? 5, inner: p.inner ?? DEFAULT_INNER };
  }
  return null;
}

export interface ShapeChange {
  sides?: number;
  tips?: number;
  inner?: number;
}

/** Change the sides, points or ratio of the selected polygons and stars: one undo step. */
export function commitShape(doc: DocumentStore, editor: EditorState, change: ShapeChange, final = true): void {
  if (editor.blockEdit()) return;
  const next: PathObject[] = [];
  for (const o of editablePaths(doc, editor)) {
    const patch: ShapePatch = {};
    if (change.sides !== undefined && o.shape === "polygon") patch.sides = change.sides;
    if (change.tips !== undefined && o.shape === "star") patch.tips = change.tips;
    if (change.inner !== undefined && o.shape === "star") patch.inner = change.inner;
    if (!Object.keys(patch).length) continue;
    const made = withShapeParams(o, patch);
    if (made) next.push(made);
  }
  if (!final) return showReplaced(editor, next);
  editor.preview = { kind: "none" };
  if (!next.length) return editor.changed();
  const what = change.sides !== undefined ? "Sides" : change.tips !== undefined ? "Points" : "Star ratio";
  doc.commit(doc.transaction(next.length === 1 ? what : `${what} of ${next.length} shapes`, next));
  editor.changed();
}

/**
 * The corner radius of the first selected path that has corners to round (a rectangle, polygon, star, any path with sharp nodes between
 * straight lines, a boolean group's result): in local units, with whether it takes one radius per corner (a rectangle made as one).
 */
export function selectedCorners(doc: DocumentStore, editor: EditorState): { id: string; radius: Radius; nodes: number; mixed: boolean } | null {
  for (const o of lined(doc, editor)) {
    if (o.kind === "image") {
      // a picture has four corners, like a rectangle
      const r = o.radius ?? 0;
      return { id: o.id, radius: r, nodes: 4, mixed: typeof r !== "number" && new Set(r).size > 1 };
    }
    if (!(hasCorners(o) || (o.result !== undefined && canRound(o.sub)))) continue;
    const r = o.radius ?? 0;
    return { id: o.id, radius: r, nodes: o.result !== undefined ? 0 : nodesIn(o.base ?? o.sub), mixed: typeof r !== "number" && new Set(r).size > 1 };
  }
  return null;
}

/** Set the radius of one corner (its place among the nodes of the sharp outline) of one path, the others as they are: one undo step. */
export function commitCornerAt(doc: DocumentStore, editor: EditorState, id: string, index: number, px: number, ppu: number, final = true): void {
  commitCornerSet(doc, editor, id, new Map([[index, px]]), ppu, final);
}

/** Set the radius of several corners (place among the nodes of the sharp outline, and px at this zoom) of one path at once, the others as they are: one undo step. */
export function commitCornerSet(doc: DocumentStore, editor: EditorState, id: string, changes: ReadonlyMap<number, number>, ppu: number, final = true): void {
  const o = doc.get(id);
  if (editor.blockEdit() || !o || (o.kind !== "path" && o.kind !== "image") || o.locked || !(ppu > 0 && ppu < Infinity)) return;
  if (o.kind === "image") {
    // a picture has four corners (top left, top right, bottom right, bottom left), none rounder than half its shorter side
    const now = o.radius === undefined ? [0, 0, 0, 0] : typeof o.radius === "number" ? [o.radius, o.radius, o.radius, o.radius] : [...o.radius];
    for (const [index, px] of changes) now[index] = Math.min(Math.max(0, px / ppu), Math.min(o.w, o.h) / 2);
    const { radius: _r, ...rest } = o;
    const made: ImageObject = now.every((v) => v === 0) ? rest : { ...rest, radius: now };
    if (!final) return showReplaced(editor, [made]);
    editor.preview = { kind: "none" };
    doc.commit(doc.transaction("Corner radius", [made]));
    editor.changed();
    return;
  }
  const nodes = nodesIn(o.base ?? o.sub);
  const now = o.radius === undefined ? new Array<number>(nodes).fill(0) : typeof o.radius === "number" ? new Array<number>(nodes).fill(o.radius) : [...o.radius];
  for (const [index, px] of changes) now[index] = Math.max(0, px / ppu);
  const made = withRadius(o, now);
  if (!final) return showReplaced(editor, [made]);
  editor.preview = { kind: "none" };
  doc.commit(doc.transaction("Corner radius", [made]));
  editor.changed();
}

/** Round the corners of the selected paths (px at this zoom: one value, or four for a rectangle: top left, top right, bottom right, bottom left): one undo step. */
export function commitCorners(doc: DocumentStore, editor: EditorState, px: readonly number[], ppuOf: (id: string) => number, final = true): void {
  if (editor.blockEdit() || !px.length) return;
  const next: Array<PathObject | ImageObject> = [];
  for (const o of lined(doc, editor)) {
    if (o.kind === "image") {
      const ppuI = ppuOf(o.id);
      if (!(ppuI > 0 && ppuI < Infinity)) continue;
      const cap = Math.min(o.w, o.h) / 2;
      const local = px.map((v) => Math.min(Math.max(0, v / ppuI), cap));
      const { radius: _r, ...rest } = o;
      const radius = px.length > 1 && px.length === 4 ? local : local[0]!;
      next.push(typeof radius === "number" && radius === 0 ? rest : { ...rest, radius });
      continue;
    }
    if (!(hasCorners(o) || (o.result !== undefined && canRound(o.sub)))) continue;
    const ppu = ppuOf(o.id);
    if (!(ppu > 0 && ppu < Infinity)) continue;
    const each = o.result === undefined && px.length > 1 && px.length === nodesIn(o.base ?? o.sub); // one for every corner (a rectangle: four)
    next.push(withRadius(o, each ? px.map((v) => v / ppu) : px[0]! / ppu));
  }
  if (!final) return showReplaced(editor, next.some((o) => o.kind === "path" && o.result !== undefined) ? derivedPreview(doc, next.filter((o): o is PathObject => o.kind === "path")) : next);
  editor.preview = { kind: "none" };
  if (!next.length) return editor.changed();
  doc.commit(doc.transaction(next.length === 1 ? "Corner radius" : `Corner radius of ${next.length} shapes`, next));
  editor.changed();
}

/** The corner smoothing (0 to 100, a share) of the first picked rounded shape, or null when none is rounded (a boolean group's result is not smoothed). */
export function selectedSmoothing(doc: DocumentStore, editor: EditorState): number | null {
  const o = editablePaths(doc, editor).find((p) => p.base && p.radius !== undefined && p.result === undefined);
  return o ? Math.round((o.smoothing ?? 0) * 100) : null;
}

/** Smooth the corners of the picked rounded shapes (ADR 0143): the rounding is made again with the curve blending into the line. One undo step. */
export function commitSmoothing(doc: DocumentStore, editor: EditorState, pct: number, final = true): void {
  if (editor.blockEdit()) return;
  const s = Math.min(1, Math.max(0, pct / 100));
  const next = editablePaths(doc, editor)
    .filter((p) => p.base && p.radius !== undefined && p.result === undefined)
    .map((o): PathObject => {
      const { smoothing: _s, ...rest } = o;
      return { ...rest, ...(s > 0 ? { smoothing: s } : {}), sub: roundCorners(o.base!, o.radius!, s) };
    });
  if (!final) return showReplaced(editor, next);
  editor.preview = { kind: "none" };
  if (!next.length) return editor.changed();
  doc.commit(doc.transaction(next.length === 1 ? "Corner smoothing" : `Corner smoothing of ${next.length} shapes`, next));
  editor.changed();
}

// ---- The initial state (ADR 0106) -----------------------------------------------------------------------------------

/** The boolean group picked whole (its result and every object in it, nested groups too), if the selection is one. */
function pickedGroup(doc: DocumentStore, editor: EditorState): { top: PathObject; objs: PathObject[] } | null {
  const b = booleanSelection(doc, editor);
  const top = b ? resultOf(doc.all(), b.gid) : undefined;
  if (!b || !top) return null;
  return { top, objs: [...doc.all()].filter((o): o is PathObject => o.kind === "path" && !!o.groups?.includes(b.gid)) };
}

/** Where the middle of an object's box is, in frame `f` (exactly). */
function centreIn(o: CanvasObject, f: ReturnType<typeof expressObjectIn>["frame"]): { x: D.Dyadic; y: D.Dyadic } {
  const e = expressObjectIn(o, f ?? o.frame!.space.world);
  const b = localBounds(e);
  return { x: D.add(e.anchor.x, D.shift(D.fromNumber((b.minX + b.maxX) / 2), e.unit)), y: D.add(e.anchor.y, D.shift(D.fromNumber((b.minY + b.maxY) / 2), e.unit)) };
}

/** The shape an object is saved as: its geometry in its own unit. */
const paintOf = (o: PathObject): InitialPaint => ({ fill: o.fill, stroke: o.stroke, width: o.width, ...(o.join ? { join: o.join } : {}), ...(o.cap ? { cap: o.cap } : {}), ...(o.dash ? { dash: o.dash } : {}), ...(o.dashOffset ? { dashOffset: o.dashOffset } : {}), ...(o.miterAngle !== undefined ? { miterAngle: o.miterAngle } : {}), ...(o.align ? { align: o.align } : {}), ...(o.arrowStart ? { arrowStart: o.arrowStart } : {}), ...(o.arrowEnd ? { arrowEnd: o.arrowEnd } : {}), opacity: o.opacity, ...(o.blend ? { blend: o.blend } : {}), ...(o.evenodd ? { evenodd: true as const } : {}), ...(o.profile ? { profile: o.profile } : {}) });
const snapshotOf = (o: PathObject, withPaint = false): InitialShape => ({ ...(withPaint ? { paint: paintOf(o) } : {}), sub: o.base ?? o.sub, ...(o.base ? { base: o.base, sub: o.sub } : {}), ...(o.radius !== undefined ? { radius: o.radius } : {}), ...(o.smoothing !== undefined ? { smoothing: o.smoothing } : {}), ...(o.params ? { params: o.params } : {}), ...(o.rot ? { rot: o.rot } : {}), unit: o.unit });

/** The object with its saved shape put back, its middle at `centre` (the same frame as the object). */
function shapeBack(o: PathObject, init: InitialShape, centre: { x: D.Dyadic; y: D.Dyadic }): PathObject {
  const { rot: _r, radius: _rad, smoothing: _sm, base: _b, params: _p, ...bare } = o;
  // a saved look replaces the current one whole (an option it did not have is cleared)
  const { join: _j, cap: _c, dash: _d, dashOffset: _do, miterAngle: _m, align: _al, arrowStart: _as, arrowEnd: _ae, blend: _bl, evenodd: _eo, profile: _pr, ...unpainted } = bare;
  const rest: typeof bare = init.paint ? { ...unpainted, ...init.paint } : bare;
  const back: PathObject = { ...rest, sub: init.sub, unit: init.unit, ...(init.base ? { base: init.base } : {}), ...(init.radius !== undefined ? { radius: init.radius } : {}), ...(init.smoothing !== undefined ? { smoothing: init.smoothing } : {}), ...(init.params ? { params: init.params } : {}), ...(init.rot ? { rot: init.rot } : {}) };
  const then = localBounds(back);
  return { ...back, anchor: { x: D.sub(centre.x, D.shift(D.fromNumber((then.minX + then.maxX) / 2), init.unit)), y: D.sub(centre.y, D.shift(D.fromNumber((then.minY + then.maxY) / 2), init.unit)) } };
}

/**
 * What can be saved and brought back for the picked items: each picked vector shape's own shape; or, with a boolean group picked whole, the
 * group: its shapes, where each is in the group, its operation and its radius (the result is derived, so it is these that are saved).
 */
export function initialShapeState(doc: DocumentStore, editor: EditorState): { count: number; saved: number; group: boolean } | null {
  const g = pickedGroup(doc, editor);
  if (g) return { count: 1, saved: g.top.initial ? 1 : 0, group: true };
  const paths = editablePaths(doc, editor).filter((o) => o.result === undefined);
  return paths.length ? { count: paths.length, saved: paths.filter((o) => o.initial).length, group: false } : null;
}

/** Save the picked shapes' shape (or the picked boolean group, as a whole) as their initial one ("Set" where there is none, "Update" to replace it): kept with the objects. One undo step. */
export function setInitialShape(doc: DocumentStore, editor: EditorState, onlyMissing = false, withPaint = false): void {
  if (editor.blockEdit()) return;
  const g = pickedGroup(doc, editor);
  if (g) {
    if (onlyMissing && g.top.initial) return;
    const f0 = g.top.frame ?? doc.space.world;
    const centre = centreIn(g.top, f0);
    const next = g.objs.map((o): PathObject => {
      if (o.result !== undefined) return { ...o, initial: { ...snapshotOf(o, withPaint), op: o.boolOps?.[o.result] ?? "union" } };
      const e = expressObjectIn(o, f0) as PathObject;
      const c = centreIn(o, f0);
      return { ...o, initial: { ...snapshotOf(o, withPaint), offset: { x: D.toNumber(D.shift(D.sub(c.x, centre.x), -e.unit)), y: D.toNumber(D.shift(D.sub(c.y, centre.y), -e.unit)) } } };
    });
    doc.commit(doc.transaction(g.top.initial ? "Update initial state of the group" : "Set initial state of the group", next));
    editor.changed();
    return;
  }
  const paths = editablePaths(doc, editor).filter((o) => o.result === undefined && !(onlyMissing && o.initial));
  if (!paths.length) return;
  const next = paths.map((o): PathObject => ({ ...o, initial: snapshotOf(o, withPaint) }));
  const updating = paths.every((o) => o.initial);
  doc.commit(doc.transaction(updating ? (paths.length === 1 ? "Update initial state" : `Update initial state of ${paths.length} shapes`) : paths.length === 1 ? "Set initial state" : `Set initial state of ${paths.length} shapes`, next));
  editor.changed();
}

/**
 * Put the picked shapes back to their initial state, about where their middle is now (paint, place and layer are as they are); or, with a
 * boolean group picked whole, the group back as it was saved: each shape of it as saved and where it was in the group (about the group's
 * middle now), its operation and its radius. Shapes added to the group since, or taken from it, are not touched. One undo step.
 */
export function resetToInitialShape(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  const g = pickedGroup(doc, editor);
  if (g) {
    if (!g.top.initial) return;
    const f0 = g.top.frame ?? doc.space.world;
    const centre = centreIn(g.top, f0);
    const out = new Map<string, CanvasObject>();
    for (const o of g.objs) {
      if (o.result !== undefined) {
        const init = o.initial;
        if (!init) continue;
        const { radius: _r, ...rest } = o;
        out.set(o.id, init.radius !== undefined ? { ...rest, radius: init.radius } : (rest as PathObject));
      } else if (o.initial?.offset) {
        const e = expressObjectIn(o, f0) as PathObject;
        const init = e.initial!;
        const at = { x: D.add(centre.x, D.shift(D.fromNumber(init.offset!.x), init.unit)), y: D.add(centre.y, D.shift(D.fromNumber(init.offset!.y), init.unit)) };
        out.set(o.id, homeObject(normalizeUnit(shapeBack(e, init, at)), doc.space));
      }
    }
    // the operation of each group as saved, on every object that is in it
    for (const r of g.objs) {
      const op = r.result !== undefined ? r.initial?.op : undefined;
      if (!op) continue;
      for (const o of g.objs) if (o.groups?.includes(r.result!)) {
        const cur = out.get(o.id) ?? o;
        out.set(o.id, { ...cur, boolOps: { ...(cur.boolOps ?? {}), [r.result!]: op } } as CanvasObject);
      }
    }
    if (!out.size) return;
    doc.commit(doc.transaction("Reset to initial state of the group", [...out.values()]));
    editor.changed();
    return;
  }
  const next: PathObject[] = [];
  for (const o of editablePaths(doc, editor)) {
    if (!o.initial || o.result !== undefined) continue;
    next.push(homeObject(normalizeUnit(shapeBack(o, o.initial, centreIn(o, o.frame ?? doc.space.world))), doc.space) as PathObject);
  }
  if (!next.length) return;
  doc.commit(doc.transaction(next.length === 1 ? "Reset to initial state" : `Reset ${next.length} shapes to their initial state`, next));
  editor.changed();
}

// ---- Combining shapes (ADR 0101, 0103) ------------------------------------------------------------------------------

const COMBINE_LABEL: Record<BoolOp, string> = { union: "Union", intersect: "Intersect", subtract: "Subtract", exclude: "Exclude" };

/** The units (at the level being worked at) of the selection: each a plain path, or a boolean group; null when something else is selected. */
function combineUnits(doc: DocumentStore, editor: EditorState): { objs: CanvasObject[]; units: number } | { problem: string } {
  const level = editor.entered.length;
  const objs = selected(doc, editor).filter((o) => !o.locked);
  const keys = new Set<string>();
  for (const o of objs) {
    const key = o.groups?.[level] ?? o.id;
    // a unit is a plain path or a boolean group (whose members and result are all selected with it)
    if (key !== o.id && !o.boolOps?.[key]) return { problem: "Ungroup those first: only shapes, and boolean groups, can be combined." };
    if (o.kind !== "path") return { problem: o.kind === "text" ? "Only shapes can be combined. Turn the text into a path first (Ctrl+E)." : "Only shapes can be combined." };
    keys.add(key);
  }
  return { objs, units: keys.size };
}

/** The boolean group that is the whole selection (its members and result), if it is: its id and operation. */
export function booleanSelection(doc: DocumentStore, editor: EditorState): { gid: string; op: BoolOp } | null {
  const level = editor.entered.length;
  const objs = selected(doc, editor);
  const gid = objs[0]?.groups?.[level];
  if (!gid || !objs.every((o) => o.groups?.[level] === gid && o.boolOps?.[gid])) return null;
  const op = objs[0]!.boolOps![gid]!;
  return resultOf(doc.all(), gid) ? { gid, op } : null;
}

export const canCombine = (doc: DocumentStore, editor: EditorState): boolean => {
  const u = combineUnits(doc, editor);
  return ("units" in u && u.units >= 2) || booleanSelection(doc, editor) !== null;
};
/** (the Combine button is also there to take shapes out of the group being worked in: see `groupJoinMode`) */

/**
 * How the picked shapes can join or leave a boolean group: "add" when one boolean group is picked with plain shapes beside it (they can
 * become shapes of it, as well as being combined with it as a whole); "out" when shapes of the group being worked in are picked (they can
 * be taken out of it); null otherwise.
 */
export function groupJoinMode(doc: DocumentStore, editor: EditorState): "add" | "out" | null {
  const level = editor.entered.length;
  const objs = selected(doc, editor).filter((o) => !o.locked);
  if (!objs.length) return null;
  const inner = editor.entered[level - 1];
  if (inner && objs.every((o) => o.boolOps?.[inner] && operandOf(o) === inner && !(isResult(o) && o.result === inner))) return "out";
  const keys = new Map<string, CanvasObject[]>();
  for (const o of objs) {
    const k = o.groups?.[level] ?? o.id;
    keys.set(k, [...(keys.get(k) ?? []), o]);
  }
  const groups = [...keys.entries()].filter(([k, list]) => list.some((o) => k !== o.id && o.boolOps?.[k]));
  const plain = [...keys.entries()].filter(([k, list]) => list.length === 1 && list[0]!.id === k && list[0]!.kind === "path");
  return groups.length === 1 && plain.length >= 1 && groups.length + plain.length === keys.size ? "add" : null;
}

/** Make the plain shapes picked beside a boolean group shapes of it (as the group's own operation). One undo step: the result follows. */
export function addToBooleanGroup(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit() || groupJoinMode(doc, editor) !== "add") return;
  const level = editor.entered.length;
  const objs = selected(doc, editor).filter((o) => !o.locked);
  const gid = objs.map((o) => o.groups?.[level]).find((k): k is string => !!k && objs.some((x) => x.boolOps?.[k] && x.groups?.[level] === k))!;
  const op = objs.find((o) => o.boolOps?.[gid])!.boolOps![gid]!;
  const plain = objs.filter((o) => o.groups?.[level] === undefined && o.kind === "path");
  const next = plain.map((o) => ({ ...o, groups: [...(o.groups ?? []), gid], boolOps: { ...(o.boolOps ?? {}), [gid]: op } }) as CanvasObject);
  doc.commit(doc.transaction(next.length === 1 ? "Add to the group" : `Add ${next.length} shapes to the group`, next));
  editor.select(expandToUnits(doc.ordered(), [resultOf(doc.all(), gid)!], editor.entered));
}

/** Take the shapes picked inside a boolean group out of it (they stay where they are, as plain shapes of the level above). One undo step: the result follows. */
export function takeOutOfBooleanGroup(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit() || groupJoinMode(doc, editor) !== "out") return;
  const gid = editor.entered[editor.entered.length - 1]!;
  const objs = selected(doc, editor).filter((o) => !o.locked);
  const next = objs.map((o): CanvasObject => {
    const { [gid]: _op, ...ops } = o.boolOps ?? {};
    const { [gid]: _name, ...names } = o.groupNames ?? {};
    const chain = (o.groups ?? []).filter((g) => g !== gid);
    const { boolOps: _b, groups: _g, groupNames: _gn, ...rest } = o;
    return { ...rest, ...(chain.length ? { groups: chain } : {}), ...(Object.keys(ops).length ? { boolOps: ops } : {}), ...(Object.keys(names).length ? { groupNames: names } : {}) } as CanvasObject;
  });
  doc.commit(doc.transaction(next.length === 1 ? "Take out of the group" : `Take ${next.length} shapes out of the group`, next));
  editor.entered = editor.entered.slice(0, -1);
  editor.select(next.map((o) => o.id));
}

/**
 * Combine the selected shapes with a Boolean operation (union, intersect, subtract the front ones from the back one, exclude where they
 * overlap), without destroying them (ADR 0103): they become a group with an operation, stay editable inside it, and
 * the group's result, made in the same transaction, is what is drawn. One undo step. On a boolean group, it changes the operation instead.
 */
export function combineSelection(doc: DocumentStore, editor: EditorState, op: BoolOp): void {
  if (editor.blockEdit()) return;
  const say = (m: string): void => {
    editor.message = m;
    editor.changed();
  };
  const current = booleanSelection(doc, editor);
  if (current) return setBooleanOp(doc, editor, current.gid, op);
  const u = combineUnits(doc, editor);
  if ("problem" in u) return say(u.problem);
  if (u.units < 2) return say("Select two or more shapes to combine them.");
  const gid = newObjectId();
  const next = groupObjects(u.objs, editor.entered.length, gid).map((o) => ({ ...o, boolOps: { ...(o.boolOps ?? {}), [gid]: op } }) as CanvasObject);
  const tx = doc.transaction(u.units === 2 ? COMBINE_LABEL[op] : `${COMBINE_LABEL[op]} of ${u.units} shapes`, next);
  const made = tx.after.get([...tx.after.keys()].find((id) => { const o = tx.after.get(id); return o && isResult(o) && o.result === gid; }) ?? "");
  if (!made) return say("Those shapes could not be combined: their outlines meet in a way that cannot be told apart. Move one a little and try again.");
  doc.commit(tx);
  editor.select(expandToUnits(doc.ordered(), [made], editor.entered));
}

/** Change the operation of a boolean group (its members and its result carry it); the result follows. */
export function setBooleanOp(doc: DocumentStore, editor: EditorState, gid: string, op: BoolOp): void {
  if (editor.blockEdit()) return;
  const members = [...doc.all()].filter((o) => o.boolOps?.[gid] && o.boolOps[gid] !== op);
  if (!members.length) return;
  doc.commit(doc.transaction(`Change to ${COMBINE_LABEL[op].toLowerCase()}`, members.map((o) => ({ ...o, boolOps: { ...o.boolOps, [gid]: op } }) as CanvasObject)));
  editor.changed();
}

/** Take a boolean group apart: its shapes come back as they were (still where they are), and its result goes. */
export function releaseBoolean(doc: DocumentStore, editor: EditorState, gid: string): void {
  if (editor.blockEdit()) return;
  const all = [...doc.all()].filter((o) => o.groups?.includes(gid));
  const result = all.find((o) => isResult(o) && o.result === gid);
  const members = all.filter((o) => o !== result).map((o): CanvasObject => {
    const { boolOps, groupNames, groups, ...rest } = o;
    const { [gid]: _op, ...ops } = boolOps ?? {};
    const { [gid]: _name, ...names } = groupNames ?? {};
    const chain = (groups ?? []).filter((g) => g !== gid);
    return { ...rest, ...(chain.length ? { groups: chain } : {}), ...(Object.keys(ops).length ? { boolOps: ops } : {}), ...(Object.keys(names).length ? { groupNames: names } : {}) } as CanvasObject;
  });
  doc.commit(doc.transaction("Release the shapes", members, result ? [result.id] : []));
  editor.select(members.map((o) => o.id));
}

/** Make a boolean group one plain path: its result stays (with its look), the shapes inside it go. One undo step brings them back. */
export function flattenBoolean(doc: DocumentStore, editor: EditorState, gid: string): void {
  if (editor.blockEdit()) return;
  const all = [...doc.all()].filter((o) => o.groups?.includes(gid));
  const result = all.find((o) => isResult(o) && o.result === gid) as PathObject | undefined;
  if (!result) return;
  const { boolOps, groupNames, groups, result: _r, radius: _rad, base: _base, ...rest } = result;
  const { [gid]: _op, ...ops } = boolOps ?? {};
  const { [gid]: _name, ...names } = groupNames ?? {};
  const chain = (groups ?? []).filter((g) => g !== gid);
  const flat = { ...rest, ...(chain.length ? { groups: chain } : {}), ...(Object.keys(ops).length ? { boolOps: ops } : {}), ...(Object.keys(names).length ? { groupNames: names } : {}) } as PathObject;
  doc.commit(doc.transaction("Flatten", [flat], all.filter((o) => o !== result).map((o) => o.id)));
  editor.select([flat.id]);
}

/** Flatten what is selected (Ctrl+E): a boolean group becomes one path, text becomes paths. */
export function flattenSelection(doc: DocumentStore, editor: EditorState): void {
  const b = booleanSelection(doc, editor);
  if (b) flattenBoolean(doc, editor, b.gid);
  else convertTextToPath(doc, editor);
}

// ---- Text to path (ADR 0102) ----------------------------------------------------------------------------------------

/** The selected text objects that can be turned into paths (not locked). */
const outlinable = (doc: DocumentStore, editor: EditorState): TextObject[] => selected(doc, editor).filter((o): o is TextObject => o.kind === "text" && !o.locked);

export const canOutline = (doc: DocumentStore, editor: EditorState): boolean => outlinable(doc, editor).length > 0;

/**
 * Turn the selected text into paths, in place: the same object (its id, so a mention of it still finds it, its layer name, group, tags,
 * place in the stacking order and opacity), now a filled compound path of the letters' own outlines. One undo step. Characters the
 * bundled font lacks (drawn by the system font) have no outline and are left out, which is said.
 */
export function convertTextToPath(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  const texts = outlinable(doc, editor);
  if (!texts.length) return;
  let missing = 0;
  const made: CanvasObject[] = [];
  for (const o of texts) {
    const { sub, missing: m } = textOutline(o);
    missing += m;
    if (!sub.length) continue;
    const { kind: _k, md, w: _w, size, color, rot: _r, lineHeight: _l, tracking: _t, align: _a, autoWidth: _f, ...base } = o;
    const plain = plainText(md, MAX_NAME_LENGTH).replace(/\s+/g, " ").trim(); // (the words, not the Markdown: no tags, no marks)
    const path: PathObject = { ...base, kind: "path", sub, fill: color, stroke: null, width: Math.max(size * 0.05, Number.MIN_VALUE), ...(!base.name && plain ? { name: plain } : {}) };
    made.push(homeObject(normalizeUnit(path), doc.space));
  }
  if (!made.length) {
    editor.message = "There is nothing in that text to turn into a path.";
    editor.changed();
    return;
  }
  doc.commit(doc.transaction(made.length === 1 ? "Convert text to path" : `Convert ${made.length} texts to paths`, made));
  editor.message = missing ? `${missing} character${missing === 1 ? "" : "s"} in a system font could not be turned into a path and ${missing === 1 ? "was" : "were"} left out.` : "";
  editor.changed();
}

const strokable = (doc: DocumentStore, editor: EditorState): PathObject[] => selected(doc, editor).filter((o): o is PathObject => o.kind === "path" && o.stroke !== null && !o.result && !o.container && o.sub.length > 0);
export const canOutlineStroke = (doc: DocumentStore, editor: EditorState): boolean => strokable(doc, editor).length > 0;

/**
 * Make the stroke of the picked paths a shape (ADR 0143), with a width profile when one is given (a taper). A path with no fill becomes
 * the shape in place (the same object, the stroke's paint as its fill); one with a fill keeps it and gets the shape as a new object above.
 * Width, corners, ends, dashes and arrow heads are in the shape. One undo step.
 */
export function outlineStroke(doc: DocumentStore, editor: EditorState, given?: WidthProfile): void {
  if (editor.blockEdit()) return;
  const paths = strokable(doc, editor);
  const changed: CanvasObject[] = [];
  const picked: string[] = [];
  const all = doc.ordered();
  let profile = given;
  for (const o of paths) {
    profile = given ?? o.profile; // (a live width profile goes into the shape)
    const { rot: _r0, base: _b0, ...flat } = o;
    const turned: PathObject = o.rot ? { ...flat, sub: pathSubs(o) } : o;
    const aligned = alignedOutlineOf(turned, profile);
    if (!aligned) editor.message = "That outline could not be made inside or outside the edge; it is centred.";
    const sub = aligned ?? outlineOf(turned, profile);
    if (!sub.length) continue;
    const { profile: _pf, net: _nt, regions: _rg, join: _j, cap: _c, align: _a, dash: _d, dashOffset: _do, arrowStart: _as, arrowEnd: _ae, miterAngle: _m, shape: _s, params: _p, radius: _r, base: _b, initial: _i, evenodd: _e, rot: _rot, sub: _sub, fill, stroke, ...keep } = o;
    const shape: PathObject = { ...keep, kind: "path", sub, fill: stroke, stroke: null, width: o.width };
    if (fill !== null) {
      const bare: PathObject = { ...keep, kind: "path", sub: o.sub, fill, stroke: null, width: o.width, ...(o.rot ? { rot: o.rot } : {}), ...(o.shape ? { shape: o.shape } : {}), ...(o.params ? { params: o.params } : {}), ...(o.radius !== undefined ? { radius: o.radius } : {}), ...(o.base ? { base: o.base } : {}), ...(o.evenodd ? { evenodd: true as const } : {}) };
      const made = normalizeUnit({ ...shape, id: newObjectId(), name: `${o.name ?? "Path"} outline`.slice(0, MAX_NAME_LENGTH) }) as PathObject;
      const placed = placeAbove(all, [made], o)[0] ?? made;
      changed.push(bare, placed);
      picked.push(placed.id);
    } else {
      changed.push(shape);
      picked.push(o.id);
    }
  }
  if (!changed.length) {
    editor.message = "There is no stroke to turn into a shape.";
    editor.changed();
    return;
  }
  doc.commit(doc.transaction(profile ? `Width: ${profile}` : paths.length === 1 ? "Outline stroke" : `Outline stroke of ${paths.length} paths`, changed));
  editor.select(picked);
  editor.changed();
}

/** Give the picked lines a width profile that stays live (a taper, ADR 0150), or take it away with null; asking for the one they have takes it away. One undo step. */
export function setWidthProfile(doc: DocumentStore, editor: EditorState, profile: WidthProfile | null): void {
  if (editor.blockEdit()) return;
  const paths = strokable(doc, editor).filter((o) => !o.net);
  const next = paths.map((o) => {
    const { profile: _p, ...rest } = o;
    return profile && o.profile !== profile ? { ...rest, profile } : rest;
  });
  if (!next.length) return;
  doc.commit(doc.transaction(profile ? `Width: ${profile}` : "Width: even", next));
  editor.changed();
}

const simplifiable = (doc: DocumentStore, editor: EditorState): PathObject[] => selected(doc, editor).filter((o): o is PathObject => o.kind === "path" && !o.result && !o.container && o.sub.some((s) => s.n.length / NODE > 2));
export const canSimplify = (doc: DocumentStore, editor: EditorState): boolean => simplifiable(doc, editor).length > 0;
const penStrokes = (doc: DocumentStore, editor: EditorState): StrokeObject[] => selected(doc, editor).filter((o): o is StrokeObject => o.kind === "stroke" && o.points.length >= 4);
export const canStrokeToPath = (doc: DocumentStore, editor: EditorState): boolean => penStrokes(doc, editor).length > 0;

/**
 * Fewer nodes for the same shape (curve fitting within a fiftieth of the shape's longer side, but never finer than half its outline). A
 * shape made by a tool (rectangle, polygon, rounded corners) is no longer that shape afterwards, so it loses its parameters. One undo step.
 */
export function simplifySelection(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  const paths = simplifiable(doc, editor);
  let before = 0;
  let after = 0;
  const next = paths.flatMap((o): PathObject[] => {
    const b = geometryBounds(o.sub);
    const tol = Math.max(Math.max(b.maxX - b.minX, b.maxY - b.minY) / 400, o.width / 8, Number.MIN_VALUE);
    const sub = o.sub.map((s) => simplifySub(s, tol));
    const count = (subs: readonly SubPath[]): number => subs.reduce((a, s) => a + s.n.length / NODE, 0);
    if (count(sub) >= count(o.sub)) return [];
    before += count(o.sub);
    after += count(sub);
    const { shape: _s, params: _p, radius: _r, base: _b, initial: _i, ...rest } = o;
    return [{ ...rest, sub }];
  });
  if (!next.length) {
    editor.message = "Those paths cannot be simplified further.";
    editor.changed();
    return;
  }
  doc.commit(doc.transaction(next.length === 1 ? "Simplify path" : `Simplify ${next.length} paths`, next));
  editor.message = `${before} nodes became ${after}.`;
  editor.changed();
}

/** Pen strokes as open paths of the same colour and width, with round ends (curve fitting within a quarter of the width): editable with Edit nodes. One undo step. */
export function strokeToPath(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  const made = penStrokes(doc, editor).map((o): CanvasObject => {
    const { kind: _k, points: _pts, color, rot: _r, ...base } = o;
    const path: PathObject = { ...base, kind: "path", sub: [fitPolyline(strokePoints(o), Math.max(o.width / 4, Number.MIN_VALUE))], fill: null, stroke: color, width: o.width };
    return homeObject(normalizeUnit(path), doc.space);
  });
  if (!made.length) return;
  doc.commit(doc.transaction(made.length === 1 ? "Pen stroke to path" : `${made.length} pen strokes to paths`, made));
  editor.changed();
}

/**
 * What Export… would send out (ADR 0147), or null when nothing is picked: a sheet (its own box, with what is on it) when one sheet is
 * picked, otherwise the picked things (their box, with half the widest outline added). Only these are drawn, not what lies behind them.
 */
export function exportTarget(doc: DocumentStore, editor: EditorState): ExportTarget | null {
  const sel = selected(doc, editor).filter((o) => !o.hidden && !isMaskObject(o));
  if (!sel.length) return null;
  const ids = new Set<ObjectId>([...sel.map((o) => o.id)]);
  for (const id of descendantsOf(doc.all(), new Set(ids))) ids.add(id);
  const sheets = sel.filter((o) => isContainer(o) && !o.rot);
  const sheet = sheets.length === 1 && sel.every((o) => o.id === sheets[0]!.id || ids.has(o.id) && descendantsOf(doc.all(), new Set([sheets[0]!.id])).includes(o.id)) ? sheets[0]! : null;
  return buildTarget(doc, sel, sheet);
}

/**
 * Everything Export… would send out: one target, or one for each sheet when several sheets are picked (and nothing but them and what is on
 * them), in reading order, so they can leave together (a ZIP, or the pages of one PDF).
 */
export function exportTargets(doc: DocumentStore, editor: EditorState): ExportTarget[] {
  const sel = selected(doc, editor).filter((o) => !o.hidden && !isMaskObject(o));
  const plainSheet = (o: CanvasObject): boolean => isContainer(o) && !o.rot && !isMaskSheet(o);
  const sheets: CanvasObject[] = sel.filter(plainSheet);
  if (sheets.length >= 2) {
    const within = new Set<ObjectId>(sheets.map((o) => o.id));
    for (const id of descendantsOf(doc.all(), new Set(within))) within.add(id);
    if (sel.every((o) => within.has(o.id))) {
      const rows = [...sheets].sort((a, b) => {
        const ba = worldBounds(a), bb = worldBounds(b);
        return D.cmp(ba.min.y, bb.min.y) || D.cmp(ba.min.x, bb.min.x);
      });
      return rows.map((sh) => buildTarget(doc, [sh], sh)).filter((t): t is ExportTarget => t !== null);
    }
  }
  const one = exportTarget(doc, editor);
  return one ? [one] : [];
}

/** The sheets that cut an object: those it is on that hide what lies outside them, innermost first (what the canvas does when it draws it). */
const clipSheetsOf = (doc: DocumentStore) => (o: CanvasObject): PathObject[] => ancestorsOf((id) => doc.get(id), o).filter((a) => a.container.clip);

export function buildTarget(doc: DocumentStore, sel: readonly CanvasObject[], sheet: CanvasObject | null): ExportTarget | null {
  const ids = new Set<ObjectId>([...sel.map((o) => o.id)]);
  for (const id of descendantsOf(doc.all(), new Set(ids))) ids.add(id);
  const all = [...ids].map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o && !o.hidden && !isMaskObject(o));
  const first = sheet ?? sel[0]!;
  const frame = first.frame ?? doc.space.world;
  let bounds: { min: { x: D.Dyadic; y: D.Dyadic }; max: { x: D.Dyadic; y: D.Dyadic } } | null = null;
  if (sheet) bounds = worldBounds(sheet);
  else {
    // the outlines are part of what is seen: add half the widest to every side; what a clipping sheet holds counts only where the sheet lets it
    // through (a pattern that runs past its sheet is framed by the sheet), and what lies wholly outside it not at all
    const half = Math.max(0, ...sel.map((o) => (o.kind === "path" ? (inkStyle(o)?.width ?? 0) / 2 : o.kind === "stroke" ? o.width / 2 : 0) * 2 ** (o.unit - first.unit)));
    const pad = D.shift(D.fromNumber(half), first.unit);
    const clips = clipSheetsOf(doc);
    for (const o of sel) {
      const b = worldBounds(expressObjectIn(o, frame));
      // a blur or a drop shadow spreads past the object: the picture leaves room for it, so it is not cut (a share of the object's own size, as on the canvas)
      const spread = reachFraction(o.adjust, o.kind === "image");
      const room = spread ? D.shift(D.fromNumber(spread * Math.max(D.toNumber(D.shift(D.sub(b.max.x, b.min.x), -first.unit)), D.toNumber(D.shift(D.sub(b.max.y, b.min.y), -first.unit)))), first.unit) : null;
      const pad2 = room ? D.add(pad, room) : pad;
      let [x0, y0, x1, y1] = [D.sub(b.min.x, pad2), D.sub(b.min.y, pad2), D.add(b.max.x, pad2), D.add(b.max.y, pad2)];
      const cuts = clips(o);
      for (const c of cuts) {
        const cb = worldBounds(expressObjectIn(c, frame));
        if (D.cmp(cb.min.x, x0) > 0) x0 = cb.min.x;
        if (D.cmp(cb.min.y, y0) > 0) y0 = cb.min.y;
        if (D.cmp(cb.max.x, x1) < 0) x1 = cb.max.x;
        if (D.cmp(cb.max.y, y1) < 0) y1 = cb.max.y;
      }
      if (cuts.length && (D.cmp(x0, x1) >= 0 || D.cmp(y0, y1) >= 0)) continue;
      if (!bounds) bounds = { min: { x: x0, y: y0 }, max: { x: x1, y: y1 } };
      else {
        if (D.cmp(x0, bounds.min.x) < 0) bounds.min.x = x0;
        if (D.cmp(y0, bounds.min.y) < 0) bounds.min.y = y0;
        if (D.cmp(x1, bounds.max.x) > 0) bounds.max.x = x1;
        if (D.cmp(y1, bounds.max.y) > 0) bounds.max.y = y1;
      }
    }
  }
  if (!bounds) return null;
  const { min, max } = bounds;
  const lw = D.toNumber(D.shift(D.sub(max.x, min.x), -first.unit)), lh = D.toNumber(D.shift(D.sub(max.y, min.y), -first.unit));
  if (!(lw > 0 && lh > 0) || !Number.isFinite(lw + lh)) return null;
  const paths = all.filter((o): o is PathObject => o.kind === "path" && !isBoolMember(o));
  const vectors = all.every((o) => o.kind === "path") && paths.length ? paths : null;
  const only = sel.length === 1 ? sel[0]! : null;
  const original = only && only.kind === "image" && !only.crop ? { w: only.pixelW, h: only.pixelH } : null;
  const name = sheet?.name ?? only?.name ?? (only ? (only.kind === "image" ? "picture" : only.kind === "path" ? "shape" : only.kind) : "selection");
  return { kind: sheet ? "sheet" : "selection", name, frame, min, max, ids, ratio: lw / lh, vectors, original };
}

/** The shapes an objects fill repeats, hidden ones too (hiding the source is the usual way to use it), for the SVG; null when any is not a shape. */
const sourceShapes = (doc: DocumentStore) => (ids: readonly string[]): PathObject[] | null => {
  const os = ids.map((id) => doc.get(id));
  return os.length && os.every((o): o is PathObject => o?.kind === "path") ? os.map((o) => ({ ...o, hidden: false })) : null;
};

/** The picked vectors as SVG text with the width and height the export asks for (any unit SVG knows), or null when it cannot. */
export function svgOfTarget(doc: DocumentStore, t: ExportTarget, size: { w: string; h: string }): string | null {
  return t.vectors ? exportSvg(t.vectors, doc.space, (by) => maskMembers(doc.all(), by).filter((o): o is PathObject => o.kind === "path"), size, sourceShapes(doc), false, 0, clipSheetsOf(doc)) : null;
}

/** The picked vectors as a PDF page of this size in points (ADR 0153), or null when the target is not all plain vectors or needs a picture. */
export const pdfVectorOfTarget = (doc: DocumentStore, t: ExportTarget, wPt: number, hPt: number): PdfVector | null => (t.vectors ? pdfVectorOf(t.vectors, doc.space, wPt, hPt, clipSheetsOf(doc)) : null);

/** The paths Export as SVG takes: the picked paths, a boolean group by its result (its shapes are not drawn on their own). */
const svgPaths = (doc: DocumentStore, editor: EditorState): PathObject[] => selected(doc, editor).filter((o): o is PathObject => o.kind === "path" && !isBoolMember(o) && !isMaskObject(o));

/** The words that warn that an SVG holds a picture of an angular gradient (SVG has none), or null when none of the shapes has one. */
export const angularWarning = (shapes: number): string | null => (shapes ? `${shapes === 1 ? "The angular gradient of 1 shape is" : `The angular gradients of ${shapes} shapes are`} saved as a picture inside the SVG: SVG has no angular gradient.` : null);

/** The warning for the SVG of these export targets (see `angularWarning`). */
export const svgWarningOfTargets = (ts: readonly ExportTarget[]): string | null => angularWarning(ts.reduce((n, t) => n + (t.vectors ? angularCount(t.vectors) : 0), 0));

/** The warning for the SVG of the picked paths (Save as SVG, Copy as SVG, Save to library as SVG). */
export const svgWarningOfSelection = (doc: DocumentStore, editor: EditorState): string | null => angularWarning(angularCount(svgPaths(doc, editor)));

export const canExportSvg = (doc: DocumentStore, editor: EditorState): boolean => svgPaths(doc, editor).length > 0;

/** The picked paths as SVG text (ADR 0107), or null when none is picked or they cannot be placed together. */
export const svgOfSelection = (doc: DocumentStore, editor: EditorState): string | null => exportSvg(svgPaths(doc, editor), doc.space, (by) => maskMembers(doc.all(), by).filter((o): o is PathObject => o.kind === "path"), undefined, sourceShapes(doc), false, 0, clipSheetsOf(doc));

/** Pasted CSS text (a gradient such as `linear-gradient(...)`, or a colour such as `#71ddd3` or `oklch(...)`) becomes the fill of what is picked; false when it is not one or nothing can take it. */
export function pasteCssPaint(doc: DocumentStore, editor: EditorState, text: string): boolean {
  const g = parseCssPaint(text);
  if (!g || paintTargetCount(doc, editor) === 0 || editor.blockEdit()) return false;
  commitPaint(doc, editor, { fill: g });
  editor.message = typeof g === "string" ? "Pasted the colour as the fill." : `Pasted the ${(g as { type: string }).type} gradient as the fill.`;
  editor.changed();
  return true;
}

/**
 * Put the shapes of SVG text on the canvas (ADR 0107): centred in the view, the longer side half of the shorter side of the view, grouped
 * when there are several, picked. False (with a message) when the text is not a drawing the app can read.
 */
export function importSvg(doc: DocumentStore, editor: EditorState, view: ViewState, text: string): boolean {
  if (editor.blockEdit()) return false;
  const svg = parseSvg(text);
  if (!svg) {
    editor.message = "That is not an SVG drawing this app can read.";
    editor.changed();
    return false;
  }
  const cam = view.camera;
  const vp = view.viewport;
  const at = screenToWorld(cam, vp, editor.pointerAt ?? { x: vp.width / 2, y: vp.height / 2 }); // (under the pointer, else the middle)
  const k = (0.5 * Math.min(vp.width, vp.height)) / 2 ** cam.zf / Math.max(svg.box.w, svg.box.h);
  const cx = svg.box.x + svg.box.w / 2, cy = svg.box.y + svg.box.h / 2;
  const z0 = doc.topZ();
  const base = { ...(view.frame === doc.space.world ? {} : { frame: view.frame }), anchor: at, unit: -cam.zi, attachmentTargetId: null };
  const toLocal = (sub: readonly SubPath[]): SubPath[] => sub.map((p) => ({ n: p.n.map((v, j) => (v - (j % 2 === 0 ? cx : cy)) * k), closed: p.closed }));
  // a clip-path of the drawing is a clipping mask (a sheet of the clip's shape, ADR 0108, 0144) that holds what it cuts, behind it
  const masks = svg.clips.map((c, ci) => {
    const first = svg.shapes.findIndex((s) => s.clip === ci);
    return first < 0 ? null : homeObject(normalizeUnit({
      ...base, id: newObjectId(), kind: "path", z: z0 + first + 0.5 - 1, opacity: 1, sub: toLocal(c.sub), fill: null, stroke: null, width: 1e-9,
      container: { clip: true, mask: true, was: { fill: null, stroke: null } }, name: `Clip ${ci + 1}`,
    } as PathObject), doc.space) as PathObject;
  });
  let objs: CanvasObject[] = svg.shapes.map((s, i): PathObject => homeObject(normalizeUnit({
    ...base,
    id: newObjectId(),
    kind: "path",
    z: z0 + 1 + i,
    opacity: s.opacity,
    ...(s.clip !== undefined && masks[s.clip] ? { parent: masks[s.clip]!.id } : {}),
    sub: toLocal(s.sub),
    fill: s.fill,
    stroke: s.stroke,
    width: s.width * k,
    ...(s.join ? { join: s.join } : {}),
    ...(s.cap ? { cap: s.cap } : {}),
    ...(s.dash ? { dash: s.dash } : {}),
    ...(s.evenodd ? { evenodd: true as const } : {}),
    ...(s.adjust ? { adjust: s.adjust } : {}),
    ...(s.name ? { name: s.name } : {}),
  } as PathObject), doc.space) as PathObject);
  objs = [...masks.filter((m): m is PathObject => m !== null), ...objs];
  if (objs.length > 1) objs = groupObjects(objs, 0);
  doc.commit(doc.transaction(`Import SVG (${objs.length} ${objs.length === 1 ? "shape" : "shapes"})`, objs));
  editor.select(objs.map((o) => o.id));
  editor.changed();
  return true;
}

/** Whether a sheet hides what lies outside it (ADR 0108): one undo step. */
export function setSheetClip(doc: DocumentStore, editor: EditorState, id: string, clip: boolean): void {
  const f = doc.get(id);
  if (editor.blockEdit() || !isContainer(f) || f.container.clip === clip) return;
  doc.commit(doc.transaction(clip ? "Clip content" : "Show content outside the sheet", [{ ...f, container: { ...f.container, clip } }]));
  editor.changed();
}

/** The next free "Sheet n" name. */
export const nextSheetName = (all: Iterable<CanvasObject>): string => {
  let n = 0;
  for (const o of all) if (isContainer(o)) n = Math.max(n, Number(/^Sheet (\d+)$/.exec(o.name ?? "")?.[1] ?? 0));
  return `Sheet ${n + 1}`;
};

/**
 * A sheet just drawn over objects takes the ones that lie wholly inside it (ADR 0108): they go on the sheet (`roots`: the ones not already on
 * another of them; what is on a sheet or in a group goes with it), the sheet goes just behind them so they stay in sight, in one step.
 */
export function drawSheetOver(doc: DocumentStore, editor: EditorState, sheet: PathObject, roots: readonly CanvasObject[]): void {
  const all = doc.ordered();
  const lowest = Math.min(...roots.map((o) => o.z));
  const below = [...all].filter((o) => o.z < lowest).pop();
  const body = { ...sheet, z: lowest - 1 };
  const placed = below ? (placeAbove(all, [body], below)[0] ?? body) : body;
  doc.commit(doc.transaction("Draw sheet", [placed, ...roots.map((o) => ({ ...o, parent: sheet.id }) as CanvasObject)]));
  editor.select([placed.id]);
  editor.message = `${sheet.name ?? "The sheet"} holds ${roots.length === 1 ? "1 item" : `${roots.length} items`} it was drawn over.`;
  editor.changed();
}

/**
 * Put the picked objects on a sheet (ADR 0108): a sheet exactly the size of the objects, put behind them, which holds them. What is inside another
 * sheet goes on the new one, which is itself on that sheet. The picked objects must be in one space.
 */
export function sheetSelection(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  const picked = selected(doc, editor).filter((o) => !o.locked);
  const roots = rootsOf(picked);
  if (!roots.length) return;
  const f0 = roots[0]!.frame ?? doc.space.world;
  // (deep in a zoom, near objects can be filed in different frames: the box is taken in the first one's, and they stay where they are filed)
  const b = unionBounds(roots.map((o) => expressObjectIn(o, f0)))!;
  const unit = roots[0]!.unit;
  const w = D.toNumber(D.shift(D.sub(b.max.x, b.min.x), -unit));
  const h = D.toNumber(D.shift(D.sub(b.max.y, b.min.y), -unit));
  if (!(w > 0 && h > 0 && Number.isFinite(w + h))) {
    editor.message = "Those objects have no size to put on a sheet.";
    editor.changed();
    return;
  }
  const parents = new Set(roots.map((o) => o.parent));
  const parent = parents.size === 1 ? [...parents][0] : undefined;
  const all = doc.ordered();
  const lowest = Math.min(...roots.map((o) => o.z));
  const below = [...all].filter((o) => o.z < lowest).pop();
  const body0: PathObject = {
    id: newObjectId(),
    kind: "path",
    ...(f0 === doc.space.world ? {} : { frame: f0 }),
    anchor: b.min,
    unit,
    z: lowest - 1,
    opacity: 1,
    attachmentTargetId: null,
    sub: drawnSubs("rect", 0, 0, w, h, 6, 5),
    fill: "#ffffff",
    stroke: null,
    width: Math.max(Math.min(w, h) / 100, Number.MIN_VALUE),
    shape: "rect",
    container: { clip: true },
    name: nextSheetName(all),
    ...(parent !== undefined ? { parent } : {}),
  };
  const params = drawnParams("rect", 0, 0, w, h, 6, 5);
  const body = homeObject(normalizeUnit(params ? { ...body0, params } : body0), doc.space) as PathObject;
  const placed = below ? (placeAbove(all, [body], below)[0] ?? body) : body;
  const inside = roots.map((o) => ({ ...o, parent: body.id }) as CanvasObject);
  doc.commit(doc.transaction("Put on a sheet", [placed, ...inside]));
  editor.select([placed.id, ...picked.map((o) => o.id)]);
  editor.changed();
}

// ---- Vector networks (ADR 0146) --------------------------------------------------------------------------------------------

const networkable = (doc: DocumentStore, editor: EditorState): PathObject[] => selected(doc, editor).filter((o): o is PathObject => o.kind === "path" && !o.container && !o.result && !o.locked);
export const canMakeNetwork = (doc: DocumentStore, editor: EditorState): boolean => networkable(doc, editor).some((o) => !o.net);
export const canReleaseNetwork = (doc: DocumentStore, editor: EditorState): boolean => networkable(doc, editor).some((o) => o.net);

/**
 * The picked paths become one vector network: their sub-paths are its edges, ends close together become one vertex, an end on another
 * edge splits it there, and the regions the edges enclose are filled. It has the look of the top path (and the first fill any has).
 */
export function makeNetwork(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  const paths = networkable(doc, editor);
  if (!paths.length) return;
  const back = [...paths].sort((a, b) => a.z - b.z)[0]!;
  const regions = paths.map((o) => regionIn(o, back, doc.space));
  if (regions.some((r) => !r)) {
    editor.message = "Those paths cannot be placed together.";
    editor.changed();
    return;
  }
  const subs = regions.map((r) => r!.subs);
  const box = geometryBounds(subs.flat());
  const tol = Math.max(Math.hypot(box.maxX - box.minX, box.maxY - box.minY) * 0.003, 1e-9);
  const edges = buildNetwork(subs, tol);
  if (!edges.length) {
    editor.message = "There is nothing to make a network of.";
    editor.changed();
    return;
  }
  const top = [...paths].sort((a, b) => b.z - a.z)[0]!;
  const fill = [...paths].sort((a, b) => b.z - a.z).find((o) => o.fill !== null)?.fill ?? null;
  const made: PathObject = { ...pathLookOf(top), id: newObjectId(), kind: "path", anchor: back.anchor, unit: back.unit, ...(back.frame ? { frame: back.frame } : {}), z: top.z, sub: edges, net: true, fill, name: "Network" };
  doc.commit(doc.transaction(paths.length === 1 ? "Vector network" : `Vector network of ${paths.length} paths`, [homeObject(normalizeUnit(made), doc.space)], paths.map((o) => o.id)));
  editor.select([made.id]);
  editor.changed();
}

/** A network goes back to an ordinary path (its edges are its sub-paths): one undo step. */
export function releaseNetwork(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  const nets = networkable(doc, editor).filter((o) => o.net);
  if (!nets.length) return;
  doc.commit(doc.transaction("Release the network", nets.map((o) => { const { net: _n, regions: _rg, ...rest } = o; return rest as PathObject; })));
  editor.changed();
}

// ---- Divide and the Shape builder (ADR 0145) -------------------------------------------------------------------------------

const dividable = (doc: DocumentStore, editor: EditorState): PathObject[] => selected(doc, editor).filter((o): o is PathObject => o.kind === "path" && !o.container && !o.result && !o.locked && o.sub.some((s) => s.closed));
export const canDivide = (doc: DocumentStore, editor: EditorState): boolean => dividable(doc, editor).length >= 2;

/** Cut the picked shapes into the regions they overlap in: each region a shape of its own with the look of the one on top. One undo step. */
export function divide(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  const shapes = dividable(doc, editor);
  const made = divideShapes(shapes, doc.space);
  if (typeof made === "string") {
    editor.message = made;
    editor.changed();
    return;
  }
  const top = [...shapes].sort((a, b) => b.z - a.z)[0]!;
  const placed = placeAbove(doc.ordered(), made.map((r) => homeObject(normalizeUnit(r.obj), doc.space)), top);
  doc.commit(doc.transaction(`Divide into ${made.length} regions`, placed, shapes.map((o) => o.id)));
  editor.select(placed.map((o) => o.id));
  editor.changed();
}

/** Open the Shape builder on the picked shapes: their regions are drawn instead of them; drag across regions to merge them, Alt-drag to delete them, Enter to finish. */
export function startShapeBuilder(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit() || editor.builder) return;
  const shapes = dividable(doc, editor);
  const made = divideShapes(shapes, doc.space);
  if (typeof made === "string") {
    editor.message = made;
    editor.changed();
    return;
  }
  editor.builder = { faces: made, srcIds: shapes.map((o) => o.id), world: doc.space.world, merged: [], deleted: new Set(), hover: null, touched: [], removing: false };
  editor.preview = { kind: "edit", ids: shapes.map((o) => o.id) };
  editor.message = "Shape builder: drag across regions to merge them, Alt-drag to delete them, Enter to finish, Esc to cancel.";
  editor.changed();
}

/** Close the Shape builder: with `apply`, the shapes are replaced by the regions as they were left (merged ones united, deleted ones gone). */
export function finishShapeBuilder(doc: DocumentStore, editor: EditorState, apply: boolean): void {
  const b = editor.builder;
  if (!b) return;
  editor.builder = null;
  editor.preview = { kind: "none" };
  if (!apply) return editor.changed();
  const grouped = new Set(b.merged.flat());
  const parts: PathObject[] = [];
  for (const group of b.merged) {
    const united = uniteRegions(group.filter((i) => !b.deleted.has(i)).map((i) => b.faces[i]!.obj));
    if (!united) {
      editor.message = "Those regions could not be merged: their outlines graze each other.";
      editor.changed();
      return;
    }
    parts.push(united);
  }
  b.faces.forEach((f, i) => {
    if (!grouped.has(i) && !b.deleted.has(i)) parts.push(f.obj);
  });
  const sources = b.srcIds.map((id) => doc.get(id)).filter((o): o is PathObject => o?.kind === "path");
  if (!sources.length) return editor.changed();
  const top = [...sources].sort((a, c) => c.z - a.z)[0]!;
  const placed = parts.length ? placeAbove(doc.ordered(), parts.map((o) => homeObject(normalizeUnit(o), doc.space)), top) : [];
  doc.commit(doc.transaction("Shape builder", placed, sources.map((o) => o.id)));
  editor.select(placed.map((o) => o.id));
  editor.changed();
}

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
    editor.message = "Pick two or more things that are not masks already: the top one becomes the mask of the others.";
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
    editor.message = "Pick the things to paint a mask for (not masks already).";
    editor.changed();
    return;
  }
  const f0 = roots[0]!.frame ?? doc.space.world;
  const b = unionBounds(roots.map((o) => expressObjectIn(o, f0)))!;
  const unit = roots[0]!.unit;
  const w = D.toNumber(D.shift(D.sub(b.max.x, b.min.x), -unit));
  const h = D.toNumber(D.shift(D.sub(b.max.y, b.min.y), -unit));
  if (!(w > 0 && h > 0 && Number.isFinite(w + h))) {
    editor.message = "Those things have no common size to paint a mask on.";
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
  doc.commit(doc.transaction("Brush mask", out));
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
    editor.message = "Pick a closed shape and what it should cut: the top shape becomes the clipping mask.";
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

/** Whether a sheet that has things on it is picked (Fit to contents applies). */
export const canFitSheet = (doc: DocumentStore, editor: EditorState): boolean =>
  selected(doc, editor).some((o) => isContainer(o) && !o.rot && o.radius === undefined && [...doc.all()].some((k) => k.parent === o.id));

/** The one picked sheet (upright), when exactly one is picked. */
const pickedSheet = (doc: DocumentStore, editor: EditorState) => {
  const sheets = selected(doc, editor).filter(isContainer);
  return sheets.length === 1 && !sheets[0]!.rot ? sheets[0]! : null;
};

/** Whether the one picked sheet scales what is on it when it is resized (ADR 0133). */
export const sheetScalesContents = (doc: DocumentStore, editor: EditorState): boolean => pickedSheet(doc, editor)?.container.scale === true;

/** Turn Scale contents on or off for the picked sheet (a property of the sheet, so it is kept, copied and undone with it). */
export function setSheetScale(doc: DocumentStore, editor: EditorState, on: boolean): void {
  const s = pickedSheet(doc, editor);
  if (editor.blockEdit() || !s || (s.container.scale === true) === on) return;
  const { scale: _old, ...rest } = s.container;
  doc.commit(doc.transaction(on ? "Scale contents with the sheet" : "Keep what is on the sheet as it is", [{ ...s, container: on ? { ...rest, scale: true } : rest }]));
  editor.changed();
}

/** The shape of the one picked sheet: its width ÷ height (ADR 0147: a sheet has a shape, and gets a size only when it is exported), or null. */
export function sheetRatio(doc: DocumentStore, editor: EditorState): number | null {
  const s = pickedSheet(doc, editor);
  const sz = s && sheetLocalSize(s);
  return sz ? sz.w / sz.h : null;
}

/** Scale the picked sheet by (kx, ky) about its top-left corner: what is on it follows its pin, or all of it scales (`container.scale`). One undo step. */
function scaleSheet(doc: DocumentStore, editor: EditorState, s: CanvasObject, kx: number, ky: number, final: boolean, label: string): void {
  if (Math.abs(kx - 1) < 1e-9 && Math.abs(ky - 1) < 1e-9) {
    if (final && editor.preview.kind !== "none") {
      editor.preview = { kind: "none" };
      editor.changed();
    }
    return;
  }
  const group = [s, ...descendantsOf(doc.all(), new Set([s.id])).map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o)];
  const plan = planSheetScale(group, worldBounds(s).min, kx, ky, false, false);
  if (!final) return showReplaced(editor, [...plan.values()]);
  editor.preview = { kind: "none" };
  doc.commit(doc.transaction(label, [...plan.values()]));
  editor.changed();
}

/**
 * Give the picked sheet another shape (width ÷ height), keeping its area and its top-left corner: dragging a ratio, picking a preset or
 * turning it on its side. Only the sheet changes: what is on it follows its own pin (left/top by default, so it stays as it is; "Scale"
 * makes it grow with the sheet), unless the sheet has Scale contents. One undo step (shown only while `final` is false).
 */
export function setSheetRatio(doc: DocumentStore, editor: EditorState, ratio: number, final = true): void {
  const s = pickedSheet(doc, editor);
  const sz = s && sheetLocalSize(s);
  if (editor.blockEdit() || !s || !sz || !(ratio > 0.01 && ratio < 100) || !Number.isFinite(ratio)) return;
  const area = sz.w * sz.h;
  scaleSheet(doc, editor, s, Math.sqrt(area * ratio) / sz.w, Math.sqrt(area / ratio) / sz.h, final, "Sheet shape");
}

/** Make each picked sheet exactly as large as what is directly on it (ADR 0108): one undo step. */
export function fitSheet(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  const next: CanvasObject[] = [];
  for (const s of selected(doc, editor).filter(isContainer)) {
    if (s.rot || s.radius !== undefined) continue;
    const kids = [...doc.all()].filter((k) => k.parent === s.id && !k.hidden).map((k) => expressObjectIn(k, s.frame ?? doc.space.world));
    const b = kids.length ? unionBounds(kids) : null;
    if (!b) continue;
    const w = D.toNumber(D.shift(D.sub(b.max.x, b.min.x), -s.unit));
    const h = D.toNumber(D.shift(D.sub(b.max.y, b.min.y), -s.unit));
    if (!(w > 0 && h > 0 && Number.isFinite(w + h))) continue;
    const params = drawnParams("rect", 0, 0, w, h, 6, 5);
    next.push(homeObject(normalizeUnit({ ...s, anchor: b.min, sub: drawnSubs("rect", 0, 0, w, h, 6, 5), ...(params ? { params } : {}) }), doc.space));
  }
  if (!next.length) return;
  doc.commit(doc.transaction(next.length === 1 ? "Fit sheet to its contents" : `Fit ${next.length} sheets to their contents`, next));
  editor.changed();
}

/**
 * Attach the picked objects to `targetId` (ADR 0109): they follow it from now on when it moves (a move, turn or stretch of the target
 * takes them along, as one picks them with it). The target itself and anything it already follows (which would make a loop) are left out.
 */
export function attachSelection(doc: DocumentStore, editor: EditorState, targetId: string): boolean {
  const target = doc.get(targetId);
  if (editor.blockEdit() || !target) return false;
  // everything that follows the target, directly or not, would make a loop
  const following = new Set(descendantsOf(doc.all(), new Set([targetId])));
  const next = selected(doc, editor)
    .filter((o) => o.id !== targetId && !following.has(o.id) && !o.locked && o.attachmentTargetId !== targetId)
    .map((o) => ({ ...o, attachmentTargetId: targetId }) as CanvasObject);
  if (!next.length) {
    editor.message = "Nothing to attach: the picked objects already follow it, or it follows them.";
    editor.changed();
    return false;
  }
  doc.commit(doc.transaction(next.length === 1 ? "Attach" : `Attach ${next.length} objects`, next));
  editor.select([targetId, ...next.map((o) => o.id)]);
  editor.changed();
  return true;
}

/** Whether a picked object is attached to another. */
export const canDetach = (doc: DocumentStore, editor: EditorState): boolean => selected(doc, editor).some((o) => o.attachmentTargetId !== null);

/** Let the picked objects go: they stay where they are and no longer follow anything. */
export function detachSelection(doc: DocumentStore, editor: EditorState): void {
  if (editor.blockEdit()) return;
  const next = selected(doc, editor).filter((o) => o.attachmentTargetId !== null).map((o) => ({ ...o, attachmentTargetId: null }) as CanvasObject);
  if (!next.length) return;
  doc.commit(doc.transaction(next.length === 1 ? "Detach" : `Detach ${next.length} objects`, next));
  editor.changed();
}

/** The look (text/text-style.ts) of the first picked text, at the zoom `ppuOf` says (null: no text is picked). */
export function selectedTextStyle(doc: DocumentStore, editor: EditorState, ppuOf: (id: string) => number): ReturnType<typeof lookOf> | null {
  const t = selected(doc, editor).find((o): o is TextObject => o.kind === "text");
  return t ? lookOf(t, ppuOf(t.id)) : null;
}

/** Change the look of the picked texts (ADR 0126: size, line height, letter spacing, alignment, width mode, colour): one undo step; `final` false only shows it. */
export function setTextStyle(doc: DocumentStore, editor: EditorState, look: TextLook, ppuOf: (id: string) => number, final = true): void {
  const texts = selected(doc, editor).filter((o): o is TextObject => o.kind === "text" && !o.locked);
  if (!texts.length || editor.blockEdit()) return;
  const next = texts.map((t) => withLook(t, look, ppuOf(t.id)));
  const changed = next.filter((n, i) => !sameLook(n, texts[i]!));
  if (!final) return showReplaced(editor, changed);
  editor.preview = { kind: "none" };
  if (changed.length) doc.commit(doc.transaction(changed.length === 1 ? "Change text" : `Change ${changed.length} texts`, changed));
  editor.changed();
}

// ---- pictures: crop and adjustments (ADR 0118) ----------------------------------------------------------------------------------------

/** The picked pictures (stills, video and GIF; audio has no picture). */
const pictures = (doc: DocumentStore, editor: EditorState): ImageObject[] => selected(doc, editor).filter((o): o is ImageObject => o.kind === "image" && o.media?.kind !== "audio" && !o.locked);

/** The one picked picture that can be cropped: a still, upright (null otherwise). */
export function croppablePicture(doc: DocumentStore, editor: EditorState): ImageObject | null {
  const sel = selected(doc, editor);
  const o = sel.length === 1 ? sel[0]! : null;
  return o && o.kind === "image" && o.media?.kind !== "audio" && !o.rot && !o.locked ? o : null; // (a video and a GIF too: the window of each frame)
}

/** Whether the picked picture is cropped (so it can be shown whole again). */
export const isCropped = (doc: DocumentStore, editor: EditorState): boolean => !!croppablePicture(doc, editor)?.crop;

/** Show the whole source of the picked picture again, at the same scale and place: one undo step. */
export function uncropPicture(doc: DocumentStore, editor: EditorState): void {
  const o = croppablePicture(doc, editor);
  if (!o?.crop || editor.blockEdit()) return;
  doc.commit(doc.transaction("Show the whole picture", [uncrop(o)]));
  editor.changed();
}

/** What can be adjusted: pictures (stills, video, GIF), and shapes, pen strokes and texts (adjusted as they look once drawn). */
const adjustables = (doc: DocumentStore, editor: EditorState): CanvasObject[] =>
  selected(doc, editor).filter((o) => !o.locked && (o.kind === "path" || o.kind === "stroke" || o.kind === "text" || (o.kind === "image" && o.media?.kind !== "audio")));

/** The adjustments of the first picked object, and whether every picked picture is a still (video and GIF show only some of them). */
export function selectedAdjust(doc: DocumentStore, editor: EditorState): { adjust: Adjust; stills: boolean; count: number } | null {
  const ps = adjustables(doc, editor);
  return ps.length ? { adjust: ps[0]!.adjust ?? {}, stills: ps.every((p) => p.kind !== "image" || !p.media), count: ps.length } : null;
}

/** Show the adjustments on the picked pictures without storing them (a slider being dragged). */
export function previewAdjust(doc: DocumentStore, editor: EditorState, adjust: Adjust): void {
  const ps = adjustables(doc, editor);
  if (!ps.length || editor.blockEdit()) return;
  const clean = cleanAdjust(adjust);
  setAdjustPreviewing(true);
  const next = new Map(ps.map((p): [string, CanvasObject] => {
    const { adjust: _a, ...rest } = p;
    return [p.id, clean ? { ...rest, adjust: clean } : rest];
  }));
  editor.preview = { kind: "replace", ids: [...next.keys()], objs: next };
  editor.changed();
}

/** Store the adjustments on the picked pictures: one undo step. */
export function commitAdjust(doc: DocumentStore, editor: EditorState, adjust: Adjust | undefined, label = "Adjust picture", styleId?: string): void {
  const ps = adjustables(doc, editor);
  editor.preview = { kind: "none" };
  setAdjustPreviewing(false);
  if (!ps.length || editor.blockEdit()) return editor.changed();
  const clean = adjust ? cleanAdjust(adjust) : undefined;
  // The pictures follow the saved adjustment it came from (`styleId`); any other way of changing them unlinks them (ADR 0157).
  const next = ps
    .map((p): CanvasObject => {
      const { adjust: _a, ...rest } = p;
      return withStyleLinks(clean ? { ...rest, adjust: clean } : rest, { adjust: styleId ?? null });
    })
    .filter((n, i) => JSON.stringify(ps[i]!.adjust ?? null) !== JSON.stringify(clean ?? null) || JSON.stringify(ps[i]!.styles) !== JSON.stringify(n.styles));
  if (next.length) doc.commit(doc.transaction(next.length === 1 ? label : `${label} (${next.length} pictures)`, next));
  editor.changed();
}

/** How many pictures (still, video, GIF) are picked: a gradient from the Styles goes on them as a gradient map (ADR 0122). */
export const pictureCount = (doc: DocumentStore, editor: EditorState): number => adjustables(doc, editor).length;

/** Put a gradient map made of `stops` on the picked pictures, keeping their other adjustments (and the amount, when they had a map): one undo step. */
export function applyGradientMap(doc: DocumentStore, editor: EditorState, stops: readonly GradientStop[], label: string): void {
  const ps = adjustables(doc, editor);
  if (!ps.length || editor.blockEdit()) return;
  const next = ps.map((p): CanvasObject => {
    const { adjust: _a, ...rest } = p;
    const clean = cleanAdjust({ ...p.adjust, map: { stops, amount: p.adjust?.map?.amount ?? 100 } });
    return withStyleLinks(clean ? { ...rest, adjust: clean } : rest, { adjust: null }); // (changed by hand: no longer follows a saved adjustment)
  });
  doc.commit(doc.transaction(next.length === 1 ? label : `${label} (${next.length} pictures)`, next));
  editor.changed();
}

let copiedAdjust: Adjust | null = null;
/** Remember the adjustments of the first picked picture, to paste on others. */
export function copyAdjustments(doc: DocumentStore, editor: EditorState): boolean {
  const ps = adjustables(doc, editor);
  if (!ps.length) return false;
  copiedAdjust = ps[0]!.adjust ?? {};
  editor.message = isNeutral(ps[0]!.adjust) ? "That picture has no adjustments to copy." : "Adjustments copied: paste them on other pictures, video or GIFs.";
  editor.changed();
  return true;
}
export const canPasteAdjustments = (): boolean => copiedAdjust !== null;
export function pasteAdjustments(doc: DocumentStore, editor: EditorState): void {
  if (copiedAdjust) commitAdjust(doc, editor, copiedAdjust, "Paste adjustments");
}

/** The picked still as a PNG with its crop and adjustments baked in (null for a GIF or video, or when no still is picked). */
export async function renderedStill(doc: DocumentStore, editor: EditorState, assets: AssetLibrary): Promise<Blob | null> {
  const o = croppablePicture(doc, editor) ?? pictures(doc, editor).find((p) => !p.media);
  const rec = o && (await assets.record(o.assetId).catch(() => undefined));
  return o && rec ? await renderedPicture(rec.blob, cropOf(o), o.adjust) : null;
}

/** The picked still as a PNG with its crop and adjustments baked in, on the system clipboard. */
export async function copyRenderedPicture(doc: DocumentStore, editor: EditorState, assets: AssetLibrary): Promise<void> {
  const png = await renderedStill(doc, editor, assets);
  try {
    if (!png) throw new Error("no picture");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    forgetCopiedPicture();
    editor.message = "Copied the picture as it looks now (crop and adjustments baked in).";
  } catch {
    editor.message = "Could not copy the picture to the clipboard.";
  }
  editor.changed();
}

/** The "N objects" line copySelection writes when there is nothing better to say as text (a picture then goes alone, so an app that prefers text still gets the picture). */
export const isPlaceholderText = (s: string): boolean => /^canvast: \d+ objects?$/.test(s);

/**
 * Whether the picture on the system clipboard is still the one copySelection put there. A browser may re-encode a copied picture, so it cannot be
 * recognised by its bytes: it counts while nothing else could have been copied (this window kept the focus and the app copied nothing else).
 */
let pictureIsOurs = false;
export const markCopiedPicture = (): void => { pictureIsOurs = true; };
export const forgetCopiedPicture = (): void => { pictureIsOurs = false; };
export const isCopiedPicture = (): boolean => pictureIsOurs;
if (typeof window !== "undefined") window.addEventListener("blur", forgetCopiedPicture);

/** Make a new picture of the picked still as it looks now (crop and adjustments baked in), beside it, in the library too. */
export async function bakePicture(
  doc: DocumentStore,
  editor: EditorState,
  assets: AssetLibrary,
  store: (shot: { png: Blob; label: string; sourceName: string; sourceHash: string; kind?: "edit" }) => Promise<AssetRecord>,
): Promise<void> {
  const o = pictures(doc, editor).find((p) => !p.media);
  if (!o || editor.blockEdit()) return;
  const rec = await assets.record(o.assetId).catch(() => undefined);
  const c = cropOf(o);
  const png = rec ? await renderedPicture(rec.blob, c, o.adjust) : null;
  if (!rec || !png) {
    editor.message = "Could not make the picture.";
    return editor.changed();
  }
  const record = await store({ png, label: "Edited", sourceName: rec.name, sourceHash: o.assetId, kind: "edit" });
  const { crop: _c, adjust: _a, groups: _g, hidden: _h, locked: _l, parent: _p, ...rest } = o;
  const copy: ImageObject = { ...rest, id: newObjectId(), assetId: record.hash, pixelW: record.pixelW, pixelH: record.pixelH, z: doc.topZ() + 1 };
  const placed = translate(copy, D.shift(D.fromNumber(o.w * 1.05), o.unit), D.ZERO) as ImageObject;
  doc.commit(doc.transaction("Make a new picture of it as it looks", [placed]));
  editor.select([placed.id]);
  editor.changed();
}

// ---- Text on a path (ADR 0131) ----------------------------------------------------------------------------------------------------

/** The one picked text and the one picked path a text can be put on, when exactly those two are picked (and neither is turned or in another frame). */
function textAndPath(doc: DocumentStore, editor: EditorState): { text: TextObject; path: PathObject } | null {
  const sel = selected(doc, editor);
  if (sel.length !== 2) return null;
  const text = sel.find((o): o is TextObject => o.kind === "text" && !o.locked);
  const path = sel.find((o): o is PathObject => o.kind === "path" && o.sub.some((s) => s.n.length >= 12));
  return text && path && text.frame === path.frame && !text.rot ? { text, path } : null;
}

/** Whether a text and a path are picked: the text can be set along the path. */
export const canSetOnPath = (doc: DocumentStore, editor: EditorState): boolean => textAndPath(doc, editor) !== null;

/** Whether a picked text runs along a curve: it can be taken off. */
export const canTakeOffPath = (doc: DocumentStore, editor: EditorState): boolean => selected(doc, editor).some((o) => o.kind === "text" && o.onPath !== undefined && !o.locked);

/** Set the picked text along the picked path: the text keeps a copy of the path's first sub-path (in its own units), one undo step. The path stays where it is. */
export function setTextOnPath(doc: DocumentStore, editor: EditorState): void {
  const tp = textAndPath(doc, editor);
  if (!tp || editor.blockEdit()) return;
  const { text, path } = tp;
  const sub = pathSubs(path).find((s) => s.n.length >= 12)!;
  // the path's local units to the text's: the path's anchor relative to the text's (exact), then the units' ratio
  const k = 2 ** (path.unit - text.unit);
  const dx = D.toNumber(D.shift(D.sub(path.anchor.x, text.anchor.x), -text.unit));
  const dy = D.toNumber(D.shift(D.sub(path.anchor.y, text.anchor.y), -text.unit));
  const n = sub.n.map((v, i) => v * k + (i % 2 === 0 ? dx : dy));
  if (!n.every((v) => Number.isFinite(v))) {
    editor.message = "The path is too far from the text to set it along.";
    editor.changed();
    return;
  }
  doc.commit(doc.transaction("Set text on path", [{ ...text, onPath: { n, closed: sub.closed } }]));
  editor.changed();
}

/** Take the picked texts off their curves: they are set straight again, as wide as they were. */
export function takeTextOffPath(doc: DocumentStore, editor: EditorState): void {
  const next = selected(doc, editor).filter((o): o is TextObject => o.kind === "text" && o.onPath !== undefined && !o.locked).map((o) => {
    const { onPath: _p, ...rest } = o;
    return fitWidth(rest);
  });
  if (!next.length || editor.blockEdit()) return;
  doc.commit(doc.transaction(next.length === 1 ? "Take text off path" : `Take ${next.length} texts off paths`, next));
  editor.changed();
}

// ---- Position and size on a sheet (ADR 0133) ------------------------------------------------------------------------------------

/** The one picked object that sits on a sheet, with its sheet (null when none or several are picked). */
function pickedOnSheet(doc: DocumentStore, editor: EditorState): { o: CanvasObject; sheet: CanvasObject } | null {
  const sel = selected(doc, editor);
  if (sel.length !== 1) return null;
  const o = sel[0]!;
  const sheet = o.parent !== undefined ? doc.get(o.parent) : undefined;
  return sheet && isContainer(sheet) && !o.locked ? { o, sheet } : null;
}

/** The size of a sheet in its own units (so it is a plain number at any depth), or null. */
function sheetLocalSize(sheet: CanvasObject): { w: number; h: number } | null {
  const b = worldBounds(sheet);
  const w = D.toNumber(D.shift(D.sub(b.max.x, b.min.x), -sheet.unit)), h = D.toNumber(D.shift(D.sub(b.max.y, b.min.y), -sheet.unit));
  return Number.isFinite(w + h) && w > 0 && h > 0 ? { w, h } : null;
}

/**
 * Where the one picked object on a sheet is and how big it is, as percentages of the sheet (X and Y from its top-left corner, W and H of
 * its width and height; ADR 0147: a sheet has a shape, not a size); `resizable`: it may be given another width and height of its own
 * (strokes and text only scale as a whole).
 */
export function boxOnSheet(doc: DocumentStore, editor: EditorState): { x: number; y: number; w: number; h: number; resizable: boolean } | null {
  const t = pickedOnSheet(doc, editor);
  const sz = t && sheetLocalSize(t.sheet);
  if (!t || !sz) return null;
  const b = worldBounds(expressObjectIn(t.o, t.sheet.frame ?? doc.space.world)), sb = worldBounds(t.sheet); // (the object may be filed in another frame than its sheet)
  const loc = (d: D.Dyadic): number => D.toNumber(D.shift(d, -t.sheet.unit));
  const x = (loc(D.sub(b.min.x, sb.min.x)) / sz.w) * 100, y = (loc(D.sub(b.min.y, sb.min.y)) / sz.h) * 100;
  const w = (loc(D.sub(b.max.x, b.min.x)) / sz.w) * 100, h = (loc(D.sub(b.max.y, b.min.y)) / sz.h) * 100;
  return Number.isFinite(x + y + w + h) ? { x, y, w, h, resizable: !t.o.rot && (t.o.kind === "path" || t.o.kind === "image") } : null;
}

/** Put the picked object on a sheet at (x, y) per cent of the sheet from its corner: one undo step (shown only while `final` is false). */
export function moveOnSheet(doc: DocumentStore, editor: EditorState, x: number, y: number, final = true): void {
  const now = boxOnSheet(doc, editor);
  const t = pickedOnSheet(doc, editor);
  const sz = t && sheetLocalSize(t.sheet);
  if (!now || !t || !sz || editor.blockEdit() || !Number.isFinite(x + y)) return;
  const dx = D.shift(D.fromNumber(((x - now.x) / 100) * sz.w), t.sheet.unit), dy = D.shift(D.fromNumber(((y - now.y) / 100) * sz.h), t.sheet.unit);
  if (dx.m === 0n && dy.m === 0n) {
    if (final) {
      editor.preview = { kind: "none" };
      editor.changed();
    }
    return;
  }
  editor.preview = { kind: "move", ids: [t.o.id], frame: doc.space.world, dx, dy };
  if (!final) return editor.changed();
  const n = editor.previewed(t.o);
  editor.preview = { kind: "none" };
  if (n) doc.commit(doc.transaction("Move", [homeObject(n, doc.space)]));
  editor.changed();
}

/** Give the picked object on a sheet this width and height in per cent of the sheet (its top-left corner stays): one undo step (shown only while `final` is false). */
export function resizeOnSheet(doc: DocumentStore, editor: EditorState, w: number, h: number, final = true): void {
  const now = boxOnSheet(doc, editor);
  const t = pickedOnSheet(doc, editor);
  if (!now || !t || !now.resizable || editor.blockEdit() || !(w > 0 && h > 0 && Number.isFinite(w + h))) return;
  const kx = w / now.w, ky = h / now.h;
  if (Math.abs(kx - 1) < 1e-9 && Math.abs(ky - 1) < 1e-9) return;
  const group = [t.o, ...descendantsOf(doc.all(), new Set([t.o.id])).map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o)];
  const plan = planSheetScale(group, worldBounds(t.o).min, kx, ky, false, false);
  if (!final) return showReplaced(editor, [...plan.values()]);
  editor.preview = { kind: "none" };
  doc.commit(doc.transaction("Resize", [...plan.values()]));
  editor.changed();
}

/**
 * Drawings made before v0.25.3 keep the default near-black ink, which a dark canvas used to draw light; it is drawn as stored now. Give every
 * such colour (outline, fill, a pen stroke's, a text's and its outline's) the canvas's readable ink: one undo step. Locked objects are left.
 * Returns how many objects changed.
 */
export function recolourOldInk(doc: DocumentStore, editor: EditorState): number {
  if (editor.blockEdit()) return 0;
  const to = newInk(DEFAULT_INK);
  if (to === DEFAULT_INK) {
    editor.message = "This canvas is light: the near-black ink can be read as it is.";
    editor.changed();
    return 0;
  }
  const old = (c: unknown): boolean => typeof c === "string" && c.toLowerCase() === DEFAULT_INK;
  const next: CanvasObject[] = [];
  for (const o of doc.all()) {
    if (o.locked) continue;
    if (o.kind === "stroke" && old(o.color)) next.push({ ...o, color: to });
    else if (o.kind === "path" && (old(o.fill) || old(o.stroke))) next.push({ ...o, ...(old(o.fill) ? { fill: to } : {}), ...(old(o.stroke) ? { stroke: to } : {}) });
    else if (o.kind === "text" && (old(o.color) || old(o.outline?.c))) next.push({ ...o, ...(old(o.color) ? { color: to } : {}), ...(o.outline && old(o.outline.c) ? { outline: { ...o.outline, c: to } } : {}) });
  }
  if (!next.length) {
    editor.message = "Nothing on this canvas has the old default ink.";
    editor.changed();
    return 0;
  }
  doc.commit(doc.transaction(`Change the old default ink (${next.length} ${next.length === 1 ? "object" : "objects"})`, next));
  editor.message = `Changed the old default ink of ${next.length} ${next.length === 1 ? "object" : "objects"} to the canvas's ink.`;
  editor.changed();
  return next.length;
}
