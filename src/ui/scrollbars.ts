const SHOWN_AFTER_MS = 800;

/** A scrollbar shows while the pointer is over its area (the stylesheet) or while it scrolls by other means, a key or a finger: this marks what is scrolling. */
export function followScrolling(): void {
  const timers = new WeakMap<Element, number>();
  document.addEventListener("scroll", (e) => {
    const el = e.target instanceof Document ? e.target.documentElement : (e.target as Element);
    if (!(el instanceof Element)) return;
    const was = timers.get(el);
    if (was) clearTimeout(was);
    else el.classList.add("is-scrolling");
    timers.set(el, window.setTimeout(() => {
      timers.delete(el);
      el.classList.remove("is-scrolling");
    }, SHOWN_AFTER_MS));
  }, { capture: true, passive: true });
}
