/**
 * Whether this page is a guest's of a shared workspace (ADR 0184), and how read-only is said. No imports: the writer lease and the
 * interface ask early, before the remote bridge and the library are loaded.
 */

/** Served by a host that shares its workspace (the single file opened from a disk never is). */
export const isGuestPage = (): boolean => typeof document !== "undefined" && location.protocol === "https:" && !!document.querySelector('meta[name="canvast-guest"]');

/** Why this page cannot change the workspace: another tab edits it, or it is a guest of a shared one. */
export const readOnlyWhy = (): string => (isGuestPage() ? "this workspace is shared with you to look at" : "another tab is editing");
/** The longer line, with what to do. */
export const readOnlyLine = (): string => (isGuestPage() ? "Read-only: this workspace is shared with you to look at; nothing here can change it." : "Read-only: this workspace is open for editing in another tab. Use “Take over” to edit here.");
