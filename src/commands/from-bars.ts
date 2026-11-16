import type { Command } from "./types";

/**
 * Every control of the bars as a command (ADR 0129), read from the page, so a button added to a bar is in the palette without a line of
 * code: a bar says what it is called (`data-cmd-group`), and each button, switch, field or menu in it that shows now becomes one command (a
 * button is pressed, a field or a menu is focused). What is hidden or switched off is not offered, which is exactly what can be done now.
 * Controls that are many and nameless on their own (colour chips) say so with `data-no-command`.
 */
const CONTROLS = "button, input:not([type=hidden]):not([type=file]), select";

/**
 * A bar shown another way (ADR 0198: as value chips, in the Properties panel) keeps some controls out of sight, in a closed chip or a folded
 * section; it is marked `data-parked`, and its controls count as there when nothing inside it hides them. Before one runs, the layout shows it.
 */
let reveal: ((el: HTMLElement) => void) | null = null;
export const setControlRevealer = (fn: (el: HTMLElement) => void): void => void (reveal = fn);

/**
 * Put on each control of a bar the id of the command it runs (`data-command`), from a table of selectors (ADR 0205): the bar is then made of
 * commands, the live audit finds it, and the reading of the bar below leaves it to that command. Called again when a bar is drawn again.
 */
export function markCommands(root: ParentNode, table: ReadonlyArray<readonly [selector: string, id: string]>): void {
  for (const [sel, id] of table) for (const el of root.querySelectorAll<HTMLElement>(sel)) if (el.dataset["command"] !== id) el.dataset["command"] = id;
}

function usable(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  const parked = el.closest<HTMLElement>("[data-parked]");
  if (!parked) return !el.closest("[hidden], [data-off], [data-no-command]") && el.getClientRects().length > 0;
  for (let e: HTMLElement | null = el; e; e = e === parked ? null : e.parentElement) if (e.hidden || e.hasAttribute("data-off") || e.hasAttribute("data-no-command")) return false;
  return true;
}

/** The words a control is called by: its accessible name, else its tooltip, else its text. */
const labelOf = (el: HTMLElement): string => (el.getAttribute("aria-label") ?? el.title ?? el.textContent ?? "").replace(/\s+/g, " ").trim();

/** The name without the explanation after it: "Union: join the shapes into one" is "Union"; "Undo (Ctrl+Z)" is "Undo"; a trailing "panel" goes. */
export const shortTitle = (label: string): string => label.replace(/\s*\([^)]*\)\s*$/, "").split(/:\s/)[0]!.replace(/\s+panel$/i, "").trim();

/** The key in a tooltip's last brackets ("Undo (Ctrl+Z)"), when it looks like one. */
export function keysIn(tooltip: string): string | undefined {
  const k = /\(([^()]*)\)\s*$/.exec(tooltip)?.[1]?.trim();
  return k && k.length <= 24 && /^(?:Ctrl|Alt|Shift|Meta|Cmd|Esc|Enter|Delete|Space|[A-Z0-9+\-−/[\]]{1,3})(?:[+\s]|$)/.test(k) ? k : undefined;
}

const slugOf = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

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
      const runs = el.closest<HTMLElement>("[data-command]")?.dataset["command"];
      out.push({
        id: `bar.${slugOf(group)}:${slugOf(title)}`,
        hint: tooltip.length > 60 ? `${tooltip.slice(0, 57)}…` : tooltip,
        risk: "edit",
        paletteOnly: true,
        ...(runs ? { paletteOf: runs } : {}),
        title: field ? `Edit ${title.toLowerCase()}` : title,
        group,
        kind: "toolbar",
        ...(keysIn(tooltip) ? { keys: keysIn(tooltip)! } : {}),
        words: `${label} ${field ? "field" : "button"}`,
        enabled: () => usable(el),
        exec: () => {
          if (el.closest("[data-parked]")) reveal?.(el);
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
