import { hasCorners, paramsOf, withRadius, withShapeParams, type ShapePatch } from "../doc/shape-params";
import { DEFAULT_INNER, canRound, type Radius } from "../doc/path";
import type { AlignChoice, CapChoice, JoinChoice } from "../doc/stroke-look";
import { alignChoice, capChoice, joinChoice, lookFromChoices } from "../doc/stroke-look";
import { normalizeTags } from "../assets/asset-catalog";
import { renamedTag, tagFormatNote, tagIsOrUnder } from "../doc/tags";
import { isCard } from "../assets/file-kind";
import * as D from "../core/dyadic";
import { relinkMention } from "../text/markdown";
import { screenToWorld } from "../core/camera";
import type { DocumentStore } from "../doc/document-store";
import type { BlendMode, CanvasObject, ImageObject, MediaState, PathObject, TextObject } from "../doc/model";
import { textOutline } from "../text/outline";
import type { Paint } from "../doc/paint";
import type { BoolOp } from "../doc/boolean";
import { boolGroupsOf, isResult, resultOf } from "../doc/boolean-group";
import { pivotOf } from "../doc/model";
import { MAX_NAME_LENGTH, homeObject, newObjectId } from "../doc/model";
import { localToWorld, normalizeUnit, placeAbove, restack, rotateAbout, translate } from "../doc/edit-ops";
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

/** The selection as units (a group at the level being worked at, else one object) in one frame, without locked ones. */
function layoutUnits(doc: DocumentStore, editor: EditorState, names: ReadonlyMap<string, { name: string; date: number }>): Unit[] | string {
  const objs = selected(doc, editor).filter((o) => !o.locked);
  if (new Set(objs.map((o) => o.frame?.id ?? 0)).size > 1) return "These items are in different spaces; arrange them one space at a time.";
  const level = editor.entered.length;
  const byUnit = new Map<string, CanvasObject[]>();
  for (const o of objs) {
    const k = unitKey(o, level);
    (byUnit.get(k) ?? byUnit.set(k, []).get(k)!).push(o);
  }
  const nameOf = (o: CanvasObject): string => (o.kind === "image" ? (names.get(o.assetId)?.name ?? "") : o.kind === "text" ? o.md.replace(/[#*_`>\\-]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) : "");
  return [...byUnit.values()].map((objects) => {
    const first = objects[0]!;
    const date = first.kind === "image" ? names.get(first.assetId)?.date : undefined;
    return { objects, name: nameOf(first), ...(date !== undefined ? { date } : {}) };
  });
}

/**
 * Arrange the selection in a grid, or align or distribute it, as one undoable step of exact translations. `names`
 * maps an image's content hash to its file name and when it was added (for sorting by name or date).
 */
export function layoutSelection(doc: DocumentStore, editor: EditorState, cmd: LayoutCommand, names: ReadonlyMap<string, { name: string; date: number }> = new Map()): void {
  if (editor.blockEdit()) return;
  const units = layoutUnits(doc, editor, names);
  if (typeof units === "string") {
    editor.message = units;
    editor.changed();
    return;
  }
  const need = "distribute" in cmd ? 3 : 2;
  if (units.length < need) {
    editor.message = `Select at least ${need} items to ${"distribute" in cmd ? "distribute" : "grid" in cmd ? "arrange" : "align"}.`;
    editor.changed();
    return;
  }
  const moved = "grid" in cmd ? arrangeGrid(units, cmd.grid, cmd.gap) : "align" in cmd ? alignUnits(units, cmd.align) : distributeUnits(units, cmd.distribute);
  if (!moved.length) return; // already in place
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

/** What other apps see on the clipboard: the Markdown of copied texts, else a short description. */
const clipboardText = (objs: readonly CanvasObject[]): string => {
  const md = objs.flatMap((o) => (o.kind === "text" ? [o.md] : []));
  return md.length ? md.join("\n\n") : `canvast: ${objs.length} object${objs.length === 1 ? "" : "s"}`;
};

/** Put the selection on the clipboard (the event's, when copying from a copy or cut event). Returns false when nothing is selected. */
export function copySelection(doc: DocumentStore, editor: EditorState, view: ViewState, e?: ClipboardEvent): boolean {
  const objs = selected(doc, editor).filter((o) => !o.locked);
  if (!objs.length) return false;
  const depth = depthOf(view.frameCamera);
  const payload = buildPayload(objs, view.frame, Number(depth.levels) + depth.frac);
  const text = clipboardText(objs);
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

/** Copy the selection and delete it, as one undo step for the delete. */
export function cutSelection(doc: DocumentStore, editor: EditorState, view: ViewState, e?: ClipboardEvent): boolean {
  if (editor.blockEdit() || !copySelection(doc, editor, view, e)) return false;
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
 * Paste the copied objects centred on the middle of the view, at the size they had on screen when copied (as one
 * undo step); each repeat shifts them a little. They become the selection. Returns false if there is nothing to paste.
 */
export function pasteObjects(doc: DocumentStore, editor: EditorState, view: ViewState, systemText: string | null = null, inPlaceOffset = true): boolean {
  if (editor.blockEdit()) return false;
  const payload = readClipboard(systemText);
  if (!payload) return false;
  const cam = view.camera;
  const vp = view.viewport;
  const shift = PASTE_STEP_PX * pastes;
  const at = screenToWorld(cam, vp, { x: vp.width / 2 + (inPlaceOffset ? shift : 0), y: vp.height / 2 + (inPlaceOffset ? shift : 0) });
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
export function setOpacityOn(doc: DocumentStore, editor: EditorState, ids: readonly string[], opacity: number): void {
  if (editor.blockEdit()) return;
  const objs = ids.map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o && o.opacity !== opacity);
  if (!objs.length) return;
  doc.commit(doc.transaction("Set opacity", objs.map((o) => ({ ...o, opacity }))));
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

/** Point the mentions of a missing item in a text at another item; one undo step (ADR 0047). */
export function relinkMentionOn(doc: DocumentStore, editor: EditorState, textId: string, oldId: string, newId: string, label: string): void {
  if (editor.blockEdit()) return;
  const t = doc.get(textId);
  if (!t || t.kind !== "text" || oldId === newId) return;
  const md = relinkMention(t.md, oldId, newId, label);
  if (md === t.md) return;
  doc.commit(doc.transaction("Relink mention", [{ ...t, md }]));
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
export function setMedia(doc: DocumentStore, editor: EditorState, id: string, patch: Partial<Pick<MediaState, "t" | "repeat">>, label = "Media"): void {
  if (editor.blockEdit()) return;
  const o = doc.get(id);
  if (!o || o.kind !== "image" || !o.media) return;
  const media = { ...o.media, ...patch };
  if (media.t === o.media.t && media.repeat === o.media.repeat) return;
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
export function resettable(doc: DocumentStore, editor: EditorState): { turned: boolean; stretched: boolean } {
  const sel = selected(doc, editor);
  return { turned: sel.some((o) => !o.locked && !!o.rot), stretched: sel.some(distorted) };
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
  for (const file of list) {
    done++;
    // Say so at once, for one file as for many: reading a big video takes a while.
    editor.message = list.length > 1 ? `Importing ${done} of ${list.length}…` : `Importing ${file.name || "file"}…`;
    editor.changed();
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
  editor.progressDone.add("import");
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

/** The fill and outline of the first selected path, or null when none is selected. */
export function selectedPaint(doc: DocumentStore, editor: EditorState): { fill: Paint | null; stroke: Paint | null } | null {
  const o = editablePaths(doc, editor)[0];
  return o ? { fill: o.fill, stroke: o.stroke } : null;
}

export interface PaintPatch {
  fill?: Paint | null;
  stroke?: Paint | null;
}

/** Show a new fill or outline on the selected paths without storing it (the picker is still being dragged). */
export function previewPaint(doc: DocumentStore, editor: EditorState, patch: PaintPatch): void {
  const ids = editablePaths(doc, editor).map((o) => o.id);
  if (!ids.length || editor.blockEdit()) return;
  editor.preview = { kind: "paint", ids, ...patch };
  editor.changed();
}

/** Store a new fill or outline on the selected paths: one undo step. */
export function commitPaint(doc: DocumentStore, editor: EditorState, patch: PaintPatch): void {
  editor.preview = { kind: "none" };
  const differs = (o: PathObject): boolean => (patch.fill !== undefined && o.fill !== patch.fill) || (patch.stroke !== undefined && o.stroke !== patch.stroke);
  const paths = editablePaths(doc, editor).filter(differs);
  if (paths.length && !editor.blockEdit()) {
    const what = patch.fill !== undefined && patch.stroke !== undefined ? "fill and outline" : patch.fill !== undefined ? "fill" : "outline";
    doc.commit(doc.transaction(paths.length === 1 ? `Change ${what}` : `Change ${what} of ${paths.length} paths`, paths.map((o) => ({ ...o, ...(patch.fill !== undefined ? { fill: patch.fill } : {}), ...(patch.stroke !== undefined ? { stroke: patch.stroke } : {}) }))));
  }
  editor.changed();
}

/** The corners, ends and place on the edge of the first selected path's outline (null: no path is selected). `closed`: every sub-path is closed, so the outline can be inside or outside. */
export function selectedOutline(doc: DocumentStore, editor: EditorState): { join: JoinChoice; cap: CapChoice; align: AlignChoice; closed: boolean } | null {
  const o = editablePaths(doc, editor)[0];
  return o ? { join: joinChoice(o), cap: capChoice(o), align: alignChoice(o), closed: o.sub.length > 0 && o.sub.every((s) => s.closed) } : null;
}

export interface OutlinePatch {
  join?: JoinChoice;
  cap?: CapChoice;
  align?: AlignChoice;
}

/** Change the corners, ends or place on the edge of the selected paths' outlines: one undo step. */
export function commitOutline(doc: DocumentStore, editor: EditorState, patch: OutlinePatch): void {
  const paths = editablePaths(doc, editor);
  if (!paths.length || editor.blockEdit()) return;
  const next = paths.map((o): PathObject => {
    const { join: _j, cap: _c, align: _a, ...rest } = o;
    const look = lookFromChoices(patch.join ?? joinChoice(o), patch.cap ?? capChoice(o), patch.align ?? alignChoice(o));
    return { ...rest, ...look };
  });
  const label = patch.align !== undefined ? "Outline position" : patch.join !== undefined ? "Outline corners" : "Outline ends";
  doc.commit(doc.transaction(paths.length === 1 ? label : `${label} of ${paths.length} paths`, next));
  editor.changed();
}

/** Show these objects as they would be (a number being dragged), without storing them. */
function showReplaced(editor: EditorState, next: readonly PathObject[]): void {
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
export function selectedCorners(doc: DocumentStore, editor: EditorState): { id: string; radius: Radius; perCorner: boolean } | null {
  for (const o of editablePaths(doc, editor)) if (hasCorners(o) || (o.result !== undefined && canRound(o.sub))) return { id: o.id, radius: o.radius ?? 0, perCorner: o.shape === "rect" && paramsOf(o) !== null };
  return null;
}

/** Round the corners of the selected paths (px at this zoom: one value, or four for a rectangle: top left, top right, bottom right, bottom left): one undo step. */
export function commitCorners(doc: DocumentStore, editor: EditorState, px: readonly number[], ppuOf: (id: string) => number, final = true): void {
  if (editor.blockEdit() || !px.length) return;
  const next: PathObject[] = [];
  for (const o of editablePaths(doc, editor)) {
    if (!(hasCorners(o) || (o.result !== undefined && canRound(o.sub)))) continue;
    const ppu = ppuOf(o.id);
    if (!(ppu > 0 && ppu < Infinity)) continue;
    const four = px.length === 4 && o.shape === "rect" && paramsOf(o) !== null;
    next.push(withRadius(o, four ? px.map((v) => v / ppu) : px[0]! / ppu));
  }
  if (!final) return showReplaced(editor, next);
  editor.preview = { kind: "none" };
  if (!next.length) return editor.changed();
  doc.commit(doc.transaction(next.length === 1 ? "Corner radius" : `Corner radius of ${next.length} shapes`, next));
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
  const { boolOps, groupNames, groups, result: _r, radius: _rad, ...rest } = result;
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
    const { kind: _k, md, w: _w, size, color, rot: _r, ...base } = o;
    const plain = md.replace(/[#*_`>\\-]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
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
