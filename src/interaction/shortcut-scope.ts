/**
 * Whether a key event may act as a canvas shortcut. Not while typing in a text
 * field, not in Assets view, and not inside a modal dialog (where Escape and
 * Enter belong to the dialog, and Delete must never reach the canvas).
 */
export function canvasShortcutsActive(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  // Not while typing text. A slider, checkbox or radio button keeps keyboard focus after it is used, and must not
  // swallow Ctrl+Z, Delete and the tool keys.
  if (t && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName))) return false;
  if (t?.tagName === "INPUT" && !/^(range|checkbox|radio|button|color)$/.test((t as HTMLInputElement).type)) return false;
  if (t?.closest?.("dialog")) return false;
  return (document.body.dataset["view"] ?? "canvas") === "canvas";
}
