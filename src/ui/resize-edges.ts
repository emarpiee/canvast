// Resizing a box from every side and corner (a floating panel, the file window): one set of handles, one way to drag them, for all of them.

/** A side or corner of a box. */
export type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const EDGES: readonly Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/**
 * Handles on every side and corner of `box` (as `.resize-edge` elements in it). A drag on one calls `move` with how far the pointer went
 * since the press and which edge it is; `start` at the press (to read the size then), `end` when let go. Returns a function that takes them away.
 */
export function resizeEdges(box: HTMLElement, opts: { start(): void; move(dx: number, dy: number, edge: Edge): void; end?(): void }): () => void {
  const handles = EDGES.map((edge) => {
    const h = document.createElement("div");
    h.className = "resize-edge";
    h.dataset["edge"] = edge;
    h.setAttribute("aria-hidden", "true");
    // view-state: (sizes the panel or window it is on)
    h.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      h.setPointerCapture(e.pointerId);
      const x0 = e.clientX, y0 = e.clientY;
      box.classList.add("is-resizing");
      opts.start();
      const move = (m: PointerEvent): void => opts.move(m.clientX - x0, m.clientY - y0, edge);
      const up = (): void => {
        h.removeEventListener("pointermove", move);
        box.classList.remove("is-resizing");
        opts.end?.();
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", up, { once: true });
      h.addEventListener("pointercancel", up, { once: true });
    });
    box.append(h);
    return h;
  });
  return () => handles.forEach((h) => h.remove());
}

/** How a box's left, top, width and height change for a drag of `edge` by (dx, dy): what an edge moves, and only that. */
export function resized(r: { x: number; y: number; w: number; h: number }, edge: Edge, dx: number, dy: number, min: { w: number; h: number }): { x: number; y: number; w: number; h: number } {
  let { x, y, w, h } = r;
  if (edge.includes("e")) w = Math.max(min.w, r.w + dx);
  if (edge.includes("s")) h = Math.max(min.h, r.h + dy);
  if (edge.includes("w")) (w = Math.max(min.w, r.w - dx)), (x = r.x + r.w - w);
  if (edge.includes("n")) (h = Math.max(min.h, r.h - dy)), (y = r.y + r.h - h);
  return { x, y, w, h };
}
