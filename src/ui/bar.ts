/**
 * The one way every bar of the app is built (ADR 0128): a row of `.tb-group`s, each a set of controls that go together. A group shows when
 * something in it shows; the line between groups comes from one CSS rule (`.tb-group:not([hidden]) ~ .tb-group:not([hidden])`), never from
 * separator elements, so a bar needs no code to keep its dividers right.
 */

/** A control or group is out: hidden by its own logic, or switched off because it is not for the kind being edited (`data-off`). */
export const isOff = (e: HTMLElement): boolean => !!e.hidden || e.hasAttribute("data-off");

/** Show each direct group of `bar` that `wanted` allows (default: all) and that has a control showing; hide the others. */
export function syncGroups(bar: HTMLElement, wanted: (group: HTMLElement) => boolean = () => true): void {
  for (const g of bar.querySelectorAll<HTMLElement>(":scope > .tb-group")) g.hidden = g.hasAttribute("data-off") || !wanted(g) || ![...g.children].some((c) => !isOff(c as HTMLElement));
}

/**
 * A bar of the standard shape: a `.toolbar` with one row of groups that scrolls sideways, with faded ends, when it is wider than its room.
 * Every bar that sits in the top stack (the Properties bar, the colours of a selection) is made this way and kept right with
 * `syncGroups` and `syncScroll`; a new one needs no CSS of its own.
 */
export function createBar(label: string, commandGroup: string): { el: HTMLElement; row: HTMLElement } {
  const el = document.createElement("div");
  el.className = "toolbar";
  el.dataset["cmdGroup"] = commandGroup; // (what the command palette calls its controls, src/commands/from-bars.ts)
  el.setAttribute("role", "toolbar");
  el.setAttribute("aria-label", label);
  el.hidden = true;
  const row = document.createElement("div");
  row.className = "tb-options-row";
  el.append(row);
  return { el, row };
}

/** Mark a row that is wider than its room, so its ends fade (CSS `[data-scroll]`). */
export function syncScroll(row: HTMLElement): void {
  row.toggleAttribute("data-scroll", row.scrollWidth > row.clientWidth + 1);
}
