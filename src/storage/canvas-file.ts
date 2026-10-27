/**
 * A canvas file of a workspace folder (`<board>/<canvas>.cvst`, ADR 0177): the same JSON a backup writes for a canvas
 * (`archive.ts`, `canvasJson` / `readCanvasData`), after a header that says what it is and which save it is.
 * The name is not in the file (it is the file's name, and `workspace.json` keeps it as typed); the camera is per device.
 */
import { ArchiveError, readCanvasData } from "./archive";
import type { PlannedCanvas } from "./archive";

export const CANVAS_FILE_FORMAT = "canvast-canvas";
export const CANVAS_FILE_VERSION = 1;
export const CANVAS_FILE_EXT = "cvst";

export interface CanvasFileHead {
  format: typeof CANVAS_FILE_FORMAT;
  version: number;
  /** The canvas's id: a file renamed or moved outside the app is still this canvas. */
  id: string;
  /** The canvas's revision when it was written; with `savedBy`, tells a file another device wrote. */
  revision: number;
  savedAt: string;
  /** The device that wrote it. */
  savedBy: string;
}

export function canvasFileHead(id: string, revision: number, savedBy: string, now = new Date()): CanvasFileHead {
  return { format: CANVAS_FILE_FORMAT, version: CANVAS_FILE_VERSION, id, revision, savedAt: now.toISOString(), savedBy };
}

export interface ReadCanvasFile {
  head: CanvasFileHead;
  canvas: PlannedCanvas;
  /** What was skipped as damaged, in plain words. */
  problems: string[];
  /** The library hashes its objects use. */
  referenced: Set<string>;
}

/** Read and validate a canvas file. Throws ArchiveError when it is not one (or a newer version than this app reads). */
export function readCanvasFile(text: string, name: string): ReadCanvasFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ArchiveError(`“${name}” is not a canvas file (it is not JSON)`);
  }
  const o = data as Partial<CanvasFileHead> | null;
  if (!o || typeof o !== "object" || o.format !== CANVAS_FILE_FORMAT) throw new ArchiveError(`“${name}” is not a canvas file`);
  if (typeof o.version !== "number" || o.version > CANVAS_FILE_VERSION) throw new ArchiveError(`“${name}” was written by a newer canvast (canvas file version ${String(o.version)})`);
  if (typeof o.id !== "string" || !/^[0-9a-f]{32}$/.test(o.id) || typeof o.revision !== "number" || !Number.isInteger(o.revision) || o.revision < 0) {
    throw new ArchiveError(`the header of “${name}” is damaged`);
  }
  const head: CanvasFileHead = {
    format: CANVAS_FILE_FORMAT,
    version: o.version,
    id: o.id,
    revision: o.revision,
    savedAt: typeof o.savedAt === "string" ? o.savedAt : "",
    savedBy: typeof o.savedBy === "string" ? o.savedBy : "",
  };
  const problems: string[] = [];
  const referenced = new Set<string>();
  return { head, canvas: readCanvasData(data, name, problems, referenced), problems, referenced };
}
