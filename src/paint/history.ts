/**
 * The painting's undo history (ADR 0165). Every edit, from any tool, panel or command, is a list of record replacements, `Op`: a layer or
 * the painting record (with its pages) as it was and as it is. A stroke is its layer with the new tile map, a new layer is `before: null`,
 * a deleted one `after: null`. Undo applies the same ops backwards, so a new kind of edit gets undo by being a list of ops, nothing more.
 * Pixels are never copied: a tile map names tiles by hash, and the tiles stay stored while a step can bring them back (`roots`).
 */
import type { Layer, Painting } from "./model";

export type Op = { readonly store: "layer"; readonly before: Layer | null; readonly after: Layer | null } | { readonly store: "painting"; readonly before: Painting; readonly after: Painting };

export interface Step {
  readonly label: string;
  readonly ops: readonly Op[];
}

/** The ops of `s` undone: each one swapped, in the reverse order. */
export const inverse = (s: Step): Step => ({ label: s.label, ops: [...s.ops].reverse().map((o) => ({ ...o, before: o.after, after: o.before }) as Op) });

export class History {
  private done: Step[] = [];
  private undone: Step[] = [];

  constructor(private readonly limit = 200) {}

  get canUndo(): boolean {
    return this.done.length > 0;
  }
  get canRedo(): boolean {
    return this.undone.length > 0;
  }
  get undoLabel(): string | null {
    return this.done.at(-1)?.label ?? null;
  }

  push(s: Step): void {
    this.done.push(s);
    if (this.done.length > this.limit) this.done.shift();
    this.undone = [];
  }

  /** The step to apply to undo (already inverted), or null. */
  undo(): Step | null {
    const s = this.done.pop();
    if (!s) return null;
    this.undone.push(s);
    return inverse(s);
  }

  redo(): Step | null {
    const s = this.undone.pop();
    if (!s) return null;
    this.done.push(s);
    return s;
  }

  /** Every tile hash a step could bring back: kept by the tile GC while this history lives. */
  roots(): Set<string> {
    const out = new Set<string>();
    for (const s of [...this.done, ...this.undone]) for (const o of s.ops) if (o.store === "layer") for (const l of [o.before, o.after]) if (l) for (const h of Object.values(l.tiles)) out.add(h);
    return out;
  }
}
