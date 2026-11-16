/**
 * Turning the pages of a file view (a PDF, a comic book), one rule for each: Page Up and Page Down always; the arrow keys only while the focus
 * is in the pages (a click anywhere on them puts it there), as a player keeps Left and Right while it has the focus; elsewhere the arrows are
 * the viewer's, stepping to the next item. On a touch screen a swipe to the side turns the page.
 */

const BACK = new Set(["ArrowLeft", "ArrowUp", "PageUp"]);
const ON = new Set(["ArrowRight", "ArrowDown", "PageDown"]);

/** The page a key turns to (-1 back, 1 on), 0 when it turns none: an arrow only from inside `pages`. */
export function pageKey(e: KeyboardEvent, pages: HTMLElement): -1 | 0 | 1 {
  if (e.ctrlKey || e.metaKey || e.altKey) return 0;
  const arrow = e.key.startsWith("Arrow");
  if (arrow && !pages.contains(e.target as Node)) return 0;
  return BACK.has(e.key) ? -1 : ON.has(e.key) ? 1 : 0;
}

/** The least sideways travel of a swipe, in CSS pixels, and the longest it takes. */
const SWIPE_PX = 48;
const SWIPE_MS = 700;

/** A swipe to the side on `pages` turns the page: to the left on, to the right back. Not while the pages are wider than the view (the swipe moves them then), nor with two fingers (a pinch). */
export function swipePages(pages: HTMLElement, turn: (dir: -1 | 1) => void): void {
  let start: { x: number; y: number; t: number } | null = null;
  pages.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    start = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, t: e.timeStamp } : null;
  }, { passive: true });
  pages.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    const s = start;
    start = null;
    if (!s || !t || e.touches.length || e.timeStamp - s.t > SWIPE_MS || pages.scrollWidth > pages.clientWidth + 1) return;
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > 1.5 * Math.abs(dy)) turn(dx < 0 ? 1 : -1);
  }, { passive: true });
  pages.addEventListener("touchcancel", () => void (start = null), { passive: true });
}
