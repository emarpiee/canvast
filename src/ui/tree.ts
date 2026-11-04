import { ICONS } from "./icons";

/**
 * The one tree of the app: the guide lines, the arrow that folds a branch and the walk through what is open. The layers, the library's folders and
 * the tree chooser all draw their rows with it; a row is `.tree-row` with `--depth`, and brings only what it shows.
 */
export interface TreeSpot {
  depth: number;
  /** The last of its parent's children. */
  last: boolean;
  /** For each ancestor below the top, whether its own branch goes on below it (its guide line continues). */
  conts: readonly boolean[];
  hasKids: boolean;
  open: boolean;
}

/** The guide lines of a row. */
export function treeGuides(depth: number, last: boolean, conts: readonly boolean[]): string {
  if (depth === 0) return "";
  const parts: string[] = [];
  for (let j = 0; j < depth - 1; j++) if (conts[j]) parts.push(`<i class="tg" style="--l:${j}"></i>`);
  parts.push(`<i class="tg tg-own${last ? " is-last" : ""}" style="--l:${depth - 1}"></i>`);
  return `<span class="tree" aria-hidden="true">${parts.join("")}</span>`;
}

/** The arrow of a row that has children. `attrs` tells the row's handler which it is. */
export function treeTwist(open: boolean, attrs: string): string {
  return `<button type="button" class="tree-twist" ${attrs} aria-label="${open ? "Collapse" : "Expand"}" aria-expanded="${open}">${open ? ICONS.chevronDown : ICONS.chevronRight}</button>`;
}

/** The arrow's place at the start of a row: the arrow when it has children, else the same room, empty, so that all rows line up. */
export const treeSlot = (at: { hasKids: boolean; open: boolean }, attrs: string): string => (at.hasKids ? treeTwist(at.open, attrs) : `<span class="tree-twist is-empty" aria-hidden="true"></span>`);

/** Every row of these roots and of what is open under them, in order. */
export function walkTree<T>(roots: readonly T[], kids: (t: T) => readonly T[], isOpen: (t: T) => boolean, row: (t: T, at: TreeSpot) => string): string {
  const walk = (list: readonly T[], depth: number, conts: readonly boolean[]): string =>
    list
      .map((t, i) => {
        const last = i === list.length - 1;
        const under = kids(t);
        const open = under.length > 0 && isOpen(t);
        return row(t, { depth, last, conts, hasKids: under.length > 0, open }) + (open ? walk(under, depth + 1, depth >= 1 ? [...conts, !last] : conts) : "");
      })
      .join("");
  return walk(roots, 0, []);
}

/**
 * A search in a tree: what matches, by its whole path as a path is typed (`art/ink`, so a parent's name finds what is under it too), and `keep`: those and
 * what leads to them.
 */
export function treeSearch<T extends { id: string }>(all: readonly T[], parentOf: (t: T) => string | null, typed: (t: T) => string, words: string): { hits: T[]; keep: Set<string> } {
  const q = words.trim().toLowerCase();
  const hits = q ? all.filter((t) => typed(t).toLowerCase().includes(q)) : [...all];
  const byId = new Map(all.map((t) => [t.id, t]));
  const keep = new Set<string>();
  for (const hit of hits) {
    for (let at: T | undefined = hit; at && !keep.has(at.id); ) {
      keep.add(at.id);
      const up: string | null = parentOf(at);
      at = up === null ? undefined : byId.get(up);
    }
  }
  return { hits, keep };
}

/** A flat list of names that are paths (`art/ink`): a node for each, and one for each parent no name stands for. */
export function pathNodes<V>(names: ReadonlyArray<{ id: string; name: string; value: V }>, sep = "/"): Array<{ id: string; name: string; parent: string | null; value: V | null }> {
  const out = new Map<string, { id: string; name: string; parent: string | null; value: V | null }>();
  for (const n of names) {
    const parts = n.name.split(sep).filter(Boolean);
    let at = "";
    parts.forEach((part, i) => {
      const parent = at || null;
      at = at ? `${at}${sep}${part}` : part;
      const id = at.toLowerCase();
      const whole = i === parts.length - 1;
      const had = out.get(id);
      if (!had) out.set(id, { id, name: part, parent: parent && parent.toLowerCase(), value: whole ? n.value : null });
      else if (whole) had.value = n.value;
    });
  }
  return [...out.values()];
}
