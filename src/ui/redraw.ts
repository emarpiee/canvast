/**
 * Draw a part of the interface again from its markup without losing the person's place: nothing happens when the markup did not
 * change; otherwise the content is replaced while the scroll positions around it and the focused field (its text selection) are kept.
 * Any panel drawn again on updates (a status that changes while it is open) goes through this, so the page never jumps to the top or
 * loses what is being typed or pressed.
 */
const last = new WeakMap<Element, string>();

/** Whether a focused element can be found again after the redraw: its id, its test id, or its data-* attributes. */
function keyOf(el: Element): string | null {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const attrs = [...el.attributes].filter((a) => a.name.startsWith("data-")).map((a) => `[${a.name}="${CSS.escape(a.value)}"]`);
  return attrs.length ? `${el.tagName.toLowerCase()}${attrs.join("")}` : null;
}

export function redraw(host: Element, html: string): void {
  if (last.get(host) === html && host.firstChild) return;
  last.set(host, html);
  // (every scrolling element around it, the page's included)
  const scrolled: Array<[Element, number, number]> = [];
  for (let el: Element | null = host; el; el = el.parentElement) if (el.scrollTop || el.scrollLeft) scrolled.push([el, el.scrollTop, el.scrollLeft]);
  const focused = document.activeElement && host.contains(document.activeElement) ? document.activeElement : null;
  const key = focused ? keyOf(focused) : null;
  const sel: [number | null, number | null] | null = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement ? [focused.selectionStart, focused.selectionEnd] : null;
  host.innerHTML = html;
  for (const [el, top, left] of scrolled) {
    el.scrollTop = top;
    el.scrollLeft = left;
  }
  if (key) {
    const again = host.querySelector<HTMLElement>(key);
    again?.focus({ preventScroll: true });
    if (sel && (again instanceof HTMLInputElement || again instanceof HTMLTextAreaElement)) {
      try {
        again.setSelectionRange(sel[0] ?? 0, sel[1] ?? sel[0] ?? 0);
      } catch {
        /* (a checkbox has no selection) */
      }
    }
  }
}
