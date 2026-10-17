/**
 * Drag a number's name left or right to change it (the quick way to a value, as in a design tool): every `<label>` of one
 * `<input type="number">` (wrapped or by `for`) inside `root` becomes draggable. The field gets `input` events while dragging and one `change` on release
 * (so one undo step); a plain click on the name focuses the field. Shift moves ten times faster. Labels with `data-scrub` do their own thing.
 */
export function scrubNumbers(root: HTMLElement, hint = "Drag the name left or right to change it"): void {
  let drag: { label: HTMLElement; input: HTMLInputElement; start: number; x: number; moved: boolean; id: number } | null = null;
  const numberOf = (label: HTMLElement): HTMLInputElement | null => {
    const c = (label as HTMLLabelElement).control; // the wrapped field, or the one `for` names
    return c instanceof HTMLInputElement && c.type === "number" ? c : null;
  };
  root.dataset["scrubRoot"] = "";
  // (a `for` label finds its field only once the root is in the page, so labels are also marked when first touched)
  const mark = (l: HTMLElement | null): HTMLElement | null => {
    if (!l || l.dataset["scrub"] !== undefined || l.closest("[data-scrub-root]") !== root || !numberOf(l)) return null;
    l.dataset["scrubbable"] = "";
    if (!l.title) l.title = hint;
    return l;
  };
  for (const l of root.querySelectorAll<HTMLElement>("label")) mark(l);
  root.addEventListener("pointerover", (e) => mark((e.target as HTMLElement).closest<HTMLElement>("label")));
  const step = (i: HTMLInputElement): number => {
    const s = Number(i.step);
    return Number.isFinite(s) && s > 0 ? s : 0; // "any": decided from the range
  };
  root.addEventListener("pointerdown", (e) => {
    const t = e.target as HTMLElement;
    const label = mark(t.closest<HTMLElement>("label")) ?? t.closest<HTMLElement>("label[data-scrubbable]");
    if (!label || t.tagName === "INPUT" || e.button !== 0 || label.closest("[data-scrub-root]") !== root) return; // (a nested root handles its own)
    const input = numberOf(label)!;
    if (input.disabled || input.readOnly) return;
    drag = { label, input, start: parseFloat(input.value) || 0, x: e.clientX, moved: false, id: e.pointerId };
    label.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  root.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 3) return;
    drag.moved = true;
    const i = drag.input;
    const min = i.min === "" ? -Infinity : Number(i.min);
    const max = i.max === "" ? Infinity : Number(i.max);
    let st = step(i);
    const span = max - min;
    // a short range (a count) moves a step every 8 px, a long one every 2 px; "any" is a hundredth of the range, or 1
    if (!st) st = Number.isFinite(span) ? span / 100 : 1;
    const perPx = span / st <= 60 ? 1 / 8 : 1 / 2;
    let v = drag.start + Math.round(dx * perPx * (e.shiftKey ? 10 : 1)) * st;
    v = Math.min(max, Math.max(min, v));
    const decimals = (String(st).split(".")[1] ?? "").length;
    const text = v.toFixed(Math.min(decimals + (step(i) ? 0 : 2), 6));
    if (text === i.value) return;
    i.value = String(Number(text));
    i.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const end = (e: PointerEvent, cancelled: boolean): void => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    if (d.label.hasPointerCapture(e.pointerId)) d.label.releasePointerCapture(e.pointerId);
    if (!d.moved) return d.input.focus();
    if (cancelled) d.input.value = String(d.start);
    d.input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  root.addEventListener("pointerup", (e) => end(e, false));
  root.addEventListener("pointercancel", (e) => end(e, true));
  // the click that ends a drag on a name would focus its field
  root.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("label[data-scrubbable]") && (e.target as HTMLElement).tagName !== "INPUT") e.preventDefault();
  }, true);
}
