// Sections of a panel put in another order: by dragging their heads onto one another, or with Alt+Up and Alt+Down on a head. One way for every panel of
// sections (the library's sidebar, its details panel): the panel draws them in the order it is given and keeps it.

/** A saved order made usable: the known ones in the order saved, then those it does not name yet. */
export function sectionOrder(saved: unknown, known: readonly string[]): string[] {
  const order = Array.isArray(saved) ? saved.filter((c, i, a): c is string => known.includes(c as string) && a.indexOf(c) === i) : [];
  return [...order, ...known.filter((c) => !order.includes(c))];
}

export interface SortableSections {
  /** The data attribute that names a section (`sec` for `data-sec`). */
  key: string;
  /** What is dragged, or pressed with Alt+Up and Alt+Down: a selector inside a section. */
  head: string;
  /** What keeps the keyboard's move, if not the head. */
  keyHead?: string;
  order(): string[];
  /** The new order: keep it and draw the panel again. */
  set(order: string[]): void;
  /** The head to focus after a move with the keyboard. */
  headOf(id: string): HTMLElement | null | undefined;
}

/** Make the sections inside `host` movable. Add it before the host's other drag listeners: a drag of a section ends with it. */
export function sortableSections(host: HTMLElement, s: SortableSections): void {
  const type = `application/x-canvast-section-${s.key.toLowerCase()}`;
  const attr = `[data-${s.key}]`;
  const nameOf = (el: HTMLElement | null | undefined): string | undefined => el?.closest<HTMLElement>(attr)?.dataset[s.key];
  const all = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(attr)];
  let moving: string | null = null;
  const moveTo = (id: string, to: number): void => {
    const order = s.order().filter((x) => x !== id);
    order.splice(Math.max(0, Math.min(order.length, to)), 0, id);
    s.set(order);
  };
  const ours = (e: DragEvent): boolean => !!moving && !!e.dataTransfer?.types.includes(type);
  host.addEventListener("dragstart", (e) => {
    const head = (e.target as HTMLElement).closest<HTMLElement>(s.head);
    const id = nameOf(head);
    if (!id || !e.dataTransfer) return;
    moving = id;
    e.dataTransfer.setData(type, id);
    e.dataTransfer.effectAllowed = "move";
    for (const x of all()) if (x.dataset[s.key] !== id) x.classList.add("drop-zone");
  });
  host.addEventListener("dragend", () => {
    moving = null;
    for (const x of all()) x.classList.remove("drop-zone", "is-drop-target");
  });
  host.addEventListener("keydown", (e) => {
    const head = (e.target as HTMLElement).closest<HTMLElement>(s.keyHead ?? s.head);
    const id = nameOf(head);
    if (!id || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    moveTo(id, s.order().indexOf(id) + (e.key === "ArrowUp" ? -1 : 1));
    s.headOf(id)?.focus();
  });
  host.addEventListener("dragover", (e) => {
    if (!ours(e)) return;
    e.stopImmediatePropagation();
    const over = (e.target as HTMLElement).closest<HTMLElement>(attr);
    for (const x of all()) x.classList.toggle("is-drop-target", x === over && x.dataset[s.key] !== moving);
    if (over && over.dataset[s.key] !== moving) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
    }
  });
  host.addEventListener("drop", (e) => {
    if (!ours(e)) return;
    e.stopImmediatePropagation();
    const over = (e.target as HTMLElement).closest<HTMLElement>(attr);
    const id = moving!;
    if (!over || over.dataset[s.key] === id) return;
    e.preventDefault();
    // Dropped on a section's upper half: before it; on its lower half: after it.
    const r = over.getBoundingClientRect();
    moveTo(id, s.order().filter((x) => x !== id).indexOf(over.dataset[s.key]!) + (e.clientY > r.top + r.height / 2 ? 1 : 0));
  });
}
