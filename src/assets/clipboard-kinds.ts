/** What each kind of library item is on the system's clipboard: the one place that says so. Pure. */
import { noteKindOf } from "../notes/note-file";

/** `note`, `text`, `rich`: its words. `picture`: a PNG of it. `vector`: an SVG itself, with a PNG of it beside it. `still`: a PNG of something that is more than a picture (a GIF's frame). `thumb`: its library picture. `name`: only its name. */
export type ClipboardKind = "note" | "text" | "rich" | "picture" | "vector" | "still" | "thumb" | "name";

export function clipboardFor(name: string, type: string): ClipboardKind {
  const note = noteKindOf(name);
  if (note) return note === "md" ? "note" : note === "txt" ? "text" : "rich";
  if (type === "image/svg+xml") return "vector";
  if (type === "image/gif") return "still";
  if (type.startsWith("image/")) return "picture";
  if (type.startsWith("video/") || type.startsWith("audio/")) return "thumb";
  return "name";
}

export const isWords = (k: ClipboardKind): boolean => k === "note" || k === "text" || k === "rich";
export const isPicture = (k: ClipboardKind): boolean => k === "picture" || k === "vector" || k === "still";
