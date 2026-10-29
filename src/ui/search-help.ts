import { esc } from "./format";
import { ICONS } from "./icons";
import { placeMenu } from "./more-menu";

/**
 * The "how do I combine words" card (ADR 0069), shared by the library search and the canvas search, so nobody has to read the docs:
 * a small ? button beside the box opens it, each row shows the words to type, what they do and an example that fills the box when clicked.
 */
const ROWS: readonly { keys: string; does: string; example: string }[] = [
  { keys: "space · AND · &", does: "both words", example: "red cat" },
  { keys: "OR · |", does: "either word", example: "red OR blue" },
  { keys: "XOR · ^", does: "one of them, not both", example: "red XOR blue" },
  { keys: "NOT · ! · -", does: "leave out", example: "cat -dog" },
  { keys: "( )", does: "group", example: "(red OR blue) cat" },
  { keys: '" "', does: "a phrase as typed", example: '"red cat"' },
  { keys: ".ext", does: "a file type", example: ".png OR .jpg" },
];

/** The words that only the library understands (ADR 0114). */
export const LIBRARY_ROWS: readonly { keys: string; does: string; example: string }[] = [
  { keys: "width> height< pixels> size<", does: "by size (px, mp, kb, mb)", example: "width>1000 size<5mb" },
  { keys: "ratio:  orientation:", does: "shape of the picture", example: "ratio:16x9" },
  { keys: "colour:", does: "the colour that fills most of it", example: "colour:blue" },
  { keys: "kind:", does: "picture, video, audio, gif, font, file", example: "kind:video" },
  { keys: "is:", does: "favourite, used, unused, missing, filed, unfiled, tagged, untagged", example: "is:unused" },
  { keys: "uses>  canvases>", does: "how often it is placed", example: "uses>2" },
  { keys: "date:  date>  date<", does: "the day it was added (2026-10, today, week, month)", example: "date:week" },
  { keys: "on:  folder:", does: "a canvas it is on, a folder it is in", example: "on:moodboard" },
  { keys: "note:  field:", does: "its note, a field (field:source=web)", example: "field:source" },
  { keys: "duration>", does: "the length of a video or sound (30s, 2m, 1:30)", example: "duration>30s" },
];

/** The words that only the canvas search understands. */
export const CANVAS_ROWS: readonly { keys: string; does: string; example: string }[] = [
  { keys: "kind:", does: "picture, video, gif, audio, text, stroke, shape, sheet", example: "kind:text" },
  { keys: "group:  in:", does: "in a group, on a sheet (by name)", example: "in:page" },
  { keys: "fill:  stroke:", does: "the colour of its fill or outline (a name or #hex)", example: "fill:red" },
  { keys: "is:", does: "locked, masked, offscreen, tagged, named", example: "is:locked" },
];

export function searchHelpButton(): string {
  return `<button type="button" class="search-help-btn" aria-haspopup="dialog" aria-expanded="false" aria-label="How to combine search words" title="How to combine search words (AND, OR, XOR, NOT)">${ICONS.circleHelp}</button>`;
}

let current: { card: HTMLElement; anchor: HTMLElement } | null = null;

export function closeSearchHelp(): void {
  if (!current) return;
  current.card.remove();
  current.anchor.setAttribute("aria-expanded", "false");
  current = null;
}

/** Wire the button: it opens the card; choosing an example puts it in `input` (before any `/ # @` the canvas search added) and searches. */
export function wireSearchHelp(button: HTMLElement, input: HTMLInputElement, note = "Type the operators in capitals.", extra: readonly { keys: string; does: string; example: string }[] = []): void {
  button.addEventListener("click", () => {
    if (current?.anchor === button) return closeSearchHelp();
    closeSearchHelp();
    const card = document.createElement("div");
    card.className = "search-help";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Combining search words");
    card.innerHTML = `<table><tbody>${[...ROWS, ...extra].map((r) => `<tr><th scope="row">${esc(r.keys)}</th><td>${esc(r.does)}</td><td><button type="button" data-example="${esc(r.example)}">${esc(r.example)}</button></td></tr>`).join("")}</tbody></table><p>${esc(note)}</p>`;
    document.body.appendChild(card);
    placeMenu(card, button);
    button.setAttribute("aria-expanded", "true");
    current = { card, anchor: button };
    card.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-example]");
      if (!b) return;
      input.value = b.dataset["example"]!;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      closeSearchHelp();
      input.focus();
    });
  });
  // Escape closes only the card; a press elsewhere closes it too.
  document.addEventListener("keydown", (e) => {
    if (current && e.key === "Escape") { e.stopPropagation(); e.preventDefault(); closeSearchHelp(); button.focus(); }
  }, true);
  document.addEventListener("pointerdown", (e) => {
    if (current && !current.card.contains(e.target as Node) && !button.contains(e.target as Node)) closeSearchHelp();
  });
}
