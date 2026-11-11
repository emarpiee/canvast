/**
 * The parts of a dialog that writes a name pattern (`doc/name-pattern.ts`), shared by every such dialog (Rename, Export…): the tokens to
 * put in where the cursor is, and the Date row (today, a day set by year, month and day, or each thing's own date), shown only while the
 * pattern holds a date. A dialog puts the markup where it wants and wires it to its own pattern field.
 */
import { PATTERN_TOKENS, hasDate, type DateSource } from "../doc/name-pattern";
import { esc } from "./format";

/** Token chips: the shared ones, then a dialog's own (Export's `{w}` …), each with what it stands for. */
export function patternChipsHtml(extra: ReadonlyArray<{ token: string; what: string }> = []): string {
  return `<div class="np-tokens" role="group" aria-label="Put in a token" data-np-tokens>${[...PATTERN_TOKENS, ...extra].map((t) => `<button type="button" class="tag-chip is-suggest" data-token="${esc(t.token)}" title="${esc(t.what)}">${esc(t.token)}</button>`).join("")}</div>`;
}

/** A press on a chip puts its token in the field where the cursor is (the field's input event follows). */
export function wirePatternChips(root: HTMLElement, field: HTMLInputElement): void {
  root.querySelector("[data-np-tokens]")?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-token]");
    if (!b) return;
    const tok = b.dataset["token"]!;
    const at = field.selectionStart ?? field.value.length, to = field.selectionEnd ?? at;
    field.value = field.value.slice(0, at) + tok + field.value.slice(to);
    field.focus();
    field.setSelectionRange(at + tok.length, at + tok.length);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export interface DateChoice {
  source: DateSource;
  /** The day set, as YYYY-MM-DD (empty: none yet). */
  fixed: string;
}

/** The Date row: Today, This date (with its day), and, where things have one, their own date (`ownLabel`, e.g. "Date added"). */
export function dateRowHtml(choice: DateChoice, ownLabel?: string): string {
  const opt = (v: DateSource, label: string, tip: string): string => `<button type="button" role="radio" data-np-date="${v}" aria-checked="${choice.source === v}" title="${esc(tip)}">${esc(label)}</button>`;
  return `<div class="np-date" data-np-daterow hidden><span class="np-label" id="np-date-l">Date</span><div class="seg" role="radiogroup" aria-labelledby="np-date-l">${opt("today", "Today", "The date of today")}${opt("fixed", "This date", "One day you set: a shoot, a deadline")}${ownLabel ? opt("own", ownLabel, "Each one's own date") : ""}</div><input type="date" data-np-day value="${esc(choice.fixed)}" aria-label="The date to use"${choice.source === "fixed" ? "" : " hidden"}></div>`;
}

/** Wires the Date row to `choice` (changed in place) and returns how to show it for a pattern: only when the pattern holds a date. */
export function wireDateRow(root: HTMLElement, choice: DateChoice, changed: () => void): (pattern: string) => void {
  const row = root.querySelector<HTMLElement>("[data-np-daterow]");
  const day = root.querySelector<HTMLInputElement>("[data-np-day]");
  if (!row || !day) return () => undefined;
  const show = (): void => {
    for (const b of row.querySelectorAll<HTMLElement>("[data-np-date]")) b.setAttribute("aria-checked", String(b.dataset["npDate"] === choice.source));
    day.hidden = choice.source !== "fixed";
  };
  row.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-np-date]");
    if (!b) return;
    choice.source = b.dataset["npDate"] as DateSource;
    if (choice.source === "fixed" && !choice.fixed) {
      const d = new Date();
      choice.fixed = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      day.value = choice.fixed;
    }
    show();
    changed();
  });
  day.addEventListener("input", () => {
    choice.fixed = day.value;
    changed();
  });
  show();
  return (pattern: string) => void (row.hidden = !hasDate(pattern));
}
