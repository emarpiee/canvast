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
