import type { StoredFrameView } from "../core/frames";

/**
 * View bookmarks (ADR 0025): a named place on a canvas, kept as the camera in
 * frame form so it reaches any depth, with a small picture of what was there.
 */
export interface Bookmark {
  id: string;
  name: string;
  view: StoredFrameView;
  /** A JPEG data URL of the view when it was saved (small); absent if it could not be made. */
  thumb?: string;
  /** Saved at (ms since 1970). */
  at: number;
}

export const MAX_BOOKMARKS = 500;
export const MAX_BOOKMARK_NAME = 80;
const MAX_THUMB_CHARS = 24_000;

/** A bookmark from stored or imported data, or null when it is not one. The frame it names is checked by the caller. */
export function readBookmark(x: unknown): Bookmark | null {
  if (!x || typeof x !== "object") return null;
  const b = x as Record<string, unknown>;
  const v = b["view"] as Record<string, unknown> | undefined;
  if (typeof b["id"] !== "string" || !/^[0-9a-f]{32}$/.test(b["id"]) || typeof b["name"] !== "string" || !b["name"] || b["name"].length > MAX_BOOKMARK_NAME) return null;
  if (!v || v["v"] !== 2 || typeof v["frame"] !== "string" || typeof v["x"] !== "string" || typeof v["y"] !== "string" || typeof v["z"] !== "number" || !Number.isFinite(v["z"]) || !Number.isSafeInteger(v["pz"])) return null;
  const at = typeof b["at"] === "number" && Number.isFinite(b["at"]) ? b["at"] : 0;
  const thumb = typeof b["thumb"] === "string" && b["thumb"].startsWith("data:image/jpeg;base64,") && b["thumb"].length <= MAX_THUMB_CHARS ? b["thumb"] : undefined;
  return { id: b["id"], name: b["name"], view: v as unknown as StoredFrameView, ...(thumb ? { thumb } : {}), at };
}

export const readBookmarks = (xs: unknown): Bookmark[] => (Array.isArray(xs) ? xs.slice(0, MAX_BOOKMARKS).flatMap((x) => readBookmark(x) ?? []) : []);
