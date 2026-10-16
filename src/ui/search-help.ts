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
];

export function searchHelpButton(): string {
  return `<button type="button" class="search-help-btn" aria-haspopup="dialog" aria-expanded="false" aria-label="How to combine search words" title="How to combine search words (AND, OR, XOR, NOT)">${ICONS.info}</button>`;
}

let current: { card: HTMLElement; anchor: HTMLElement } | null = null;

export function closeSearchHelp(): void {
  if (!current) return;
  current.card.remove();
  current.anchor.setAttribute("aria-expanded", "false");
  current = null;
}

/** Wire the button: it opens the card; choosing an example puts it in `input` (before any `/ # @` the canvas search added) and searches. */
export function wireSearchHelp(button: HTMLElement, input: HTMLInputElement, note = "Type the operators in capitals."): void {
  button.addEventListener("click", () => {
    if (current?.anchor === button) return closeSearchHelp();
    closeSearchHelp();
    const card = document.createElement("div");
    card.className = "search-help";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Combining search words");
    card.innerHTML = `<table><tbody>${ROWS.map((r) => `<tr><th scope="row">${esc(r.keys)}</th><td>${esc(r.does)}</td><td><button type="button" data-example="${esc(r.example)}">${esc(r.example)}</button></td></tr>`).join("")}</tbody></table><p>${esc(note)}</p>`;
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
