/**
 * Reveal and deep pick (ADR 0149): the logic behind holding Ctrl over the canvas. What is under the pointer is found by **shape**, not by
 * paint (`pickAllByShape`), so a shape with no fill and no outline, a sheet, and things behind others are all found; they are drawn as
 * outlines (`render/reveal.ts`) and Ctrl+click picks the very thing (Shift adds or takes it away, Alt goes on to the one below the
 * one already picked). Layers rows reveal the thing they stand for the same way. Nothing here knows the tools: they give it the pointer,
 * the keys and the list of what is visible, and it says what is revealed and what a click picks.
 */
import type { EditorState } from "../app/editor-state";
import type { ObjectId } from "../doc/model";
import { pickAllByShape } from "../render/hit-test";
import type { ProjectedObject } from "../render/projection";

const pickable = (po: ProjectedObject): boolean => !po.obj.hidden && !po.obj.locked;

/** Everything whose shape is under (x, y), top first (hidden and locked things are left out: they cannot be picked). */
export function revealHits(visible: readonly ProjectedObject[], x: number, y: number): ProjectedObject[] {
  return pickAllByShape(visible.filter(pickable), x, y);
}

/** Why a thing under the pointer is shown but cannot be picked. */
export type RevealWhy = "locked" | "hidden" | "mask";
export interface DimHit {
  readonly po: ProjectedObject;
  readonly why: RevealWhy;
}

/**
 * What lies under (x, y) that Reveal shows but a click cannot pick (ADR 0153), top first: locked things, the parts of a mask that cuts something
 * there (`maskPos`), and hidden things (`hidden`: projected by the caller, they are in no index). Hits that can be picked are `revealHits`.
 */
export function dimHits(visible: readonly ProjectedObject[], hidden: readonly ProjectedObject[], x: number, y: number): DimHit[] {
  const out: DimHit[] = [];
  const seen = new Set<ObjectId>();
  const add = (list: readonly ProjectedObject[], why: RevealWhy): void => {
    for (const po of pickAllByShape(list, x, y)) if (!seen.has(po.obj.id)) { seen.add(po.obj.id); out.push({ po, why }); }
  };
  add(visible.filter((po) => po.obj.locked && !po.obj.hidden), "locked");
  add(visible.flatMap((po) => (po.maskPos ?? []).filter((m) => !m.obj.hidden)), "mask");
  add(hidden, "hidden");
  return out;
}

/**
 * The thing a Ctrl+click picks: the top one under the pointer; with `below`, the one under the first of them that is already picked (so
 * repeated Ctrl+Alt+clicks go down the stack, and round to the top again). null when nothing is there.
 */
export function deepPick(hits: readonly ProjectedObject[], picked: ReadonlySet<ObjectId>, below = false): ProjectedObject | null {
  if (!hits.length) return null;
  if (!below) return hits[0]!;
  const at = hits.findIndex((h) => picked.has(h.obj.id));
  return hits[at < 0 ? 0 : (at + 1) % hits.length]!;
}

/** Which of Ctrl, Shift and Alt a pointer press carries, as the deep pick reads them. */
export interface PressKeys {
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}
/** Whether a press is a deep pick: Ctrl (or Cmd), with Shift to add or take away and Alt to go down the stack. */
export const isDeepPress = (k: PressKeys): boolean => k.ctrl;

/**
 * The state of the reveal: where the pointer is, whether Ctrl is down and whether the tool may reveal at all. `changed` is told when what is
 * revealed changes (the canvas redraws); the position is kept in `editor.revealAt` for the renderer.
 */
export function createReveal(editor: EditorState, allowed: () => boolean) {
  let at: { x: number; y: number } | null = null;
  let ctrl = false;
  const update = (): void => {
    const on = ctrl && at !== null && allowed();
    const next = on ? { x: at!.x, y: at!.y } : null;
    const was = editor.revealAt;
    if (!next && !was) return;
    if (next && was && Math.abs(next.x - was.x) < 1 && Math.abs(next.y - was.y) < 1) return;
    editor.revealAt = next;
    editor.redraw(); // (the canvas only: a Layers panel being dragged in must not be rebuilt under the pointer)
  };
  return {
    /** The pointer moved (null: it left the canvas); `ctrlHeld` is the pointer event's. */
    move(p: { x: number; y: number } | null, ctrlHeld: boolean): void {
      at = p;
      ctrl = ctrlHeld;
      update();
    },
    /** Ctrl (or Cmd) went down or came up. */
    key(down: boolean): void {
      ctrl = down;
      update();
    },
    /** Something else took the pointer (a gesture began): nothing is revealed until it ends. */
    refresh: update,
  };
}

/** Reveal the things a Layers row stands for (null: none); drawn as outlines whatever the paint. */
export function revealRow(editor: EditorState, ids: ReadonlySet<ObjectId> | null): void {
  if (editor.revealIds === ids || (editor.revealIds && ids && editor.revealIds.size === ids.size && [...ids].every((i) => editor.revealIds!.has(i)))) return;
  editor.revealIds = ids;
  editor.redraw();
}
