import type { Command } from "./types";
import { OPEN_SECTION_EVENT } from "../ui/bar";

/**
 * Every control of the bars as a command (ADR 0129), read from the page, so a button added to a bar is in the palette without a line of
 * code: a bar says what it is called (`data-cmd-group`), and each button, switch, field or menu in it that shows now becomes one command (a
 * button is pressed, a field or a menu is focused). What is hidden or switched off is not offered, which is exactly what can be done now.
 * Controls that are many and nameless on their own (colour chips) say so with `data-no-command`.
 */
const CONTROLS = "button, input:not([type=hidden]):not([type=file]), select";

/** In a section of the Properties bar that is not open (ADR 0197): it can still be used, its section is opened first. */
const inClosedSection = (el: HTMLElement): HTMLElement | null => (el.closest("[data-section-off]") ? el.closest<HTMLElement>("[data-section]") : null);

const usable = (el: HTMLElement): boolean => !el.closest("[hidden], [data-off], [data-no-command]") && (el.getClientRects().length > 0 || !!inClosedSection(el)) && !(el as HTMLButtonElement).disabled;

/** The words a control is called by: its accessible name, else its tooltip, else its text. */
const labelOf = (el: HTMLElement): string => (el.getAttribute("aria-label") ?? el.title ?? el.textContent ?? "").replace(/\s+/g, " ").trim();

/** The name without the explanation after it: "Union: join the shapes into one" is "Union"; "Undo (Ctrl+Z)" is "Undo"; a trailing "panel" goes. */
export const shortTitle = (label: string): string => label.replace(/\s*\([^)]*\)\s*$/, "").split(/:\s/)[0]!.replace(/\s+panel$/i, "").trim();

/** The key in a tooltip's last brackets ("Undo (Ctrl+Z)"), when it looks like one. */
export function keysIn(tooltip: string): string | undefined {
  const k = /\(([^()]*)\)\s*$/.exec(tooltip)?.[1]?.trim();
  return k && k.length <= 24 && /^(?:Ctrl|Alt|Shift|Meta|Cmd|Esc|Enter|Delete|Space|[A-Z0-9+\-−/[\]]{1,3})(?:[+\s]|$)/.test(k) ? k : undefined;
}

export function barCommands(root: ParentNode = document): Command[] {
  const out: Command[] = [];
  for (const bar of root.querySelectorAll<HTMLElement>("[data-cmd-group]")) {
    const group = bar.dataset["cmdGroup"]!;
    for (const el of bar.querySelectorAll<HTMLElement>(CONTROLS)) {
      if (el.closest("[data-cmd-group]") !== bar || !usable(el)) continue;
      const label = labelOf(el);
      const title = shortTitle(label);
      if (!title) continue;
      const field = el instanceof HTMLInputElement || el instanceof HTMLSelectElement;
      const tooltip = el.title || label;
      out.push({
        title: field ? `Edit ${title.toLowerCase()}` : title,
        group,
        kind: "toolbar",
        ...(keysIn(tooltip) ? { keys: keysIn(tooltip)! } : {}),
        words: `${label} ${field ? "field" : "button"}`,
        enabled: () => usable(el),
        run: () => {
          const closed = inClosedSection(el);
          if (closed) el.dispatchEvent(new CustomEvent(OPEN_SECTION_EVENT, { detail: closed.dataset["section"], bubbles: true }));
          if (field) {
            el.focus();
            if (el instanceof HTMLInputElement) el.select();
          } else el.click();
        },
      });
    }
  }
  return out;
}
