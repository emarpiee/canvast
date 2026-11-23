/**
 * A class on one element that says something about a few others (a bar shown, a button there, a state), kept true as they change: the
 * app's stylesheet asks for that class, never for a `:has()` selector, which the browser checks again across the page on each change of
 * it (the Library's grid of thousands of cards was restyled at every scroll, drag and panel resize).
 *
 * Only `watched` are observed, and only the attributes named (by default `hidden` and `class`); `test` decides. The class is set at once.
 * Returns what stops it.
 */
export function classWhen(target: Element, cls: string, test: () => boolean, watched: readonly Element[], attributes: readonly string[] = ["hidden", "class"]): () => void {
  const apply = (): void => void target.classList.toggle(cls, test());
  const seen = new MutationObserver(apply);
  for (const el of watched) seen.observe(el, { attributes: true, attributeFilter: [...attributes] });
  apply();
  return () => seen.disconnect();
}
