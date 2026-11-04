/**
 * The one way a long list in a card shows its first rows and the rest on asking: a full-width button, "Show N more" or "Show fewer".
 * A list only a row or two past the limit shows them all: a button would take as much room.
 */
export function capList<T>(items: readonly T[], limit: number, open: boolean, spare = 2): { shown: readonly T[]; hidden: number; long: boolean } {
  const long = items.length > limit + spare;
  const shown = long && !open ? items.slice(0, limit) : items;
  return { shown, hidden: items.length - shown.length, long };
}

/** The button: `attrs` tell the list's handler which it is. `label` for a list that only grows, by pages. */
export function showMoreButton(o: { open?: boolean; hidden?: number; attrs: string; label?: string }): string {
  const text = o.label ?? (o.open ? "Show fewer" : `Show ${o.hidden ?? 0} more`);
  return `<button type="button" class="show-more" ${o.attrs}${o.label ? "" : ` aria-expanded="${!!o.open}"`}>${text}</button>`;
}
