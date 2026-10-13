/**
 * Whether a key event may act as a canvas shortcut. Not while typing in a
 * field, not in Assets view, and not inside a modal dialog (where Escape and
 * Enter belong to the dialog, and Delete must never reach the canvas).
 */
export function canvasShortcutsActive(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return false;
  if (t?.closest?.("dialog")) return false;
  return document.body.dataset["view"] !== "assets";
}
