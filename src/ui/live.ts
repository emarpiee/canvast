/**
 * A number field is live by default (ADR 0128): while it is being changed, by typing, by the arrows or by dragging its name or the field,
 * what it sets is shown at once on the canvas (`apply(value, false)`: nothing is stored); when the change is settled (Enter, leaving
 * the field, the end of a drag) it is stored as one undo step (`apply(value, true)`). Every numeric field of the bars and popovers
 * goes through here, so none can forget to be live.
 */
export function liveNumber(input: HTMLInputElement, apply: (value: number, final: boolean) => void, parse: (text: string) => number = Number): void {
  const read = (): number | null => {
    const t = input.value.trim();
    if (t === "") return null;
    const v = parse(t);
    return Number.isFinite(v) ? v : null;
  };
  input.addEventListener("input", () => {
    const v = read();
    if (v !== null) apply(v, false);
  });
  input.addEventListener("change", () => {
    const v = read();
    if (v !== null) apply(v, true);
  });
}
