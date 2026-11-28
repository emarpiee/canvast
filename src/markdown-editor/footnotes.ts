// Footnotes as notes apps show them: a reference's words in a small popover while the pointer is on it, and a click on a reference (or a
// footnote's way back) going to the other end, in view and lit for a moment. One module for the preview's page and live editing.

let pop: HTMLElement | null = null;
let hideTimer = 0;

/** The popover with a footnote's words (`html`, already drawn) under `anchor`; it stays while the pointer is on it. */
export function showFootnote(anchor: HTMLElement, html: string): void {
  window.clearTimeout(hideTimer);
  const doc = anchor.ownerDocument;
  if (!pop || pop.ownerDocument !== doc) {
    pop?.remove();
    pop = doc.createElement("div");
    pop.className = "me-fn-pop me-doc";
    pop.setAttribute("role", "tooltip");
    // view-state: (the popover stays while the pointer is on it, goes when it leaves)
    pop.addEventListener("mouseenter", () => window.clearTimeout(hideTimer));
    pop.addEventListener("mouseleave", () => hideFootnote());
  }
  // (inside the editor's own element, for its colours and tokens; fixed, so no scroll moves it away from the reference)
  (anchor.closest(".me") ?? doc.body).append(pop);
  pop.innerHTML = html;
  const r = anchor.getBoundingClientRect();
  const w = Math.min(420, doc.documentElement.clientWidth - 16);
  Object.assign(pop.style, { left: `${Math.max(8, Math.min(r.left, doc.documentElement.clientWidth - w - 8))}px`, top: `${r.bottom + 6}px`, maxWidth: `${w}px` });
  pop.hidden = false;
}

/** The popover goes, a moment after the pointer leaves (time to reach it). */
export function hideFootnote(now = false): void {
  window.clearTimeout(hideTimer);
  const go = (): void => void (pop && (pop.hidden = true));
  if (now) go();
  else hideTimer = window.setTimeout(go, 200);
}

/** Bring `el` into view in its page and light it for a moment (the footnote gone to, or the reference gone back to). */
export function flashFootnote(el: HTMLElement): void {
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.add("is-target");
  window.setTimeout(() => el.classList.remove("is-target"), 1600);
}

/**
 * A drawn page's footnotes (the preview): hovering a reference shows its words, a click on one goes to its footnote, a footnote's ↩ back.
 * Returns true when a click was a footnote's (the page's own link handling leaves it).
 */
export function footnoteClick(page: HTMLElement, a: Element): boolean {
  const href = a.getAttribute("href") ?? "";
  if (!/^#fn(ref)?-/.test(href)) return false;
  const to = page.querySelector<HTMLElement>(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"], [id="${CSS.escape(href.slice(1))}"]`);
  hideFootnote(true);
  if (to) flashFootnote(to);
  return true;
}

/** Hovering a reference on a drawn page shows its footnote's words (the list's item, without its way back). */
export function footnoteHover(page: HTMLElement): void {
  // view-state: (a footnote's words shown while the pointer is on its reference)
  page.addEventListener("mouseover", (e) => {
    const a = (e.target as Element).closest?.<HTMLAnchorElement>(".footnote-ref a");
    if (!a) return;
    const li = page.querySelector<HTMLElement>(`[id="${CSS.escape((a.getAttribute("href") ?? "").slice(1))}"]`);
    if (!li) return;
    const words = li.cloneNode(true) as HTMLElement;
    words.querySelector(".footnote-backref")?.remove();
    showFootnote(a, words.innerHTML);
  });
  page.addEventListener("mouseout", (e) => void ((e.target as Element).closest?.(".footnote-ref a") && hideFootnote()));
}
