import type { AssetLibrary, AssetRecord } from "../assets/asset-library";
import type { SettingsStore } from "../settings/settings";
import type { Session } from "./session";
import { SHOT_FORMATS, encodeShot, parseTags, shotFileName } from "./screenshot";
import { fileInLibrary } from "./library-filing";

/**
 * Extracted frames (ADR 0081): the picture a video or GIF shows becomes a new library original with a name, format, folder and tags chosen in
 * Settings > Media and playback.
 */

/** Where in the source the frame is: a video's time as `1h02m03s` or `0m03s`, a GIF's frame as `frame12`. */
export function framePosition(label: string): string {
  const gif = /^Frame (\d+)\b/.exec(label);
  if (gif) return `frame${gif[1]}`;
  const t = /^(?:(\d+):)?(\d+):(\d{2})\b/.exec(label);
  if (!t) return "frame";
  const h = t[1] ? Number(t[1]) : 0;
  const m = Number(t[2]);
  const s = t[3]!;
  return h ? `${h}h${String(m).padStart(2, "0")}m${s}s` : `${m}m${s}s`;
}

export interface FrameShot {
  png: Blob;
  /** The engine's label ("0:03 / 1:20", "Frame 12 / 40"). */
  label: string;
  sourceName: string;
  sourceHash: string;
  /** "edit": a picture made by Make a new picture (ADR 0118), which has its own format, folder, name and tags; else an extracted frame. */
  kind?: "edit";
}

/** Make the frame's file (in the chosen format and name), import it, and file it in the chosen folder with the chosen tags. */
/** The picture file in the chosen format ("png" stays as it is; a failure to encode leaves a PNG). */
export async function encodePicture(png: Blob, format: "png" | "webp" | "jpeg", quality: number): Promise<{ blob: Blob; mime: string; ext: string }> {
  if (format === "png") return { blob: png, mime: "image/png", ext: "png" };
  try {
    const bmp = await createImageBitmap(png);
    const cv = document.createElement("canvas");
    cv.width = bmp.width;
    cv.height = bmp.height;
    const x = cv.getContext("2d")!;
    if (format === "jpeg") {
      x.fillStyle = "#fff";
      x.fillRect(0, 0, cv.width, cv.height);
    }
    x.drawImage(bmp, 0, 0);
    bmp.close();
    const enc = await encodeShot(cv, format, quality);
    return { blob: enc.blob, mime: SHOT_FORMATS[enc.format].mime, ext: SHOT_FORMATS[enc.format].ext };
  } catch {
    return { blob: png, mime: "image/png", ext: "png" }; // the picture stays a PNG
  }
}

/** The name an edited picture gets (Settings > Edited pictures), without its extension: from the original's name. */
export function editedName(session: Session, settings: SettingsStore, sourceName: string): string {
  const stem = sourceName.replace(/\.[^.]*$/, "") || "picture";
  const tree = session.tree;
  const cur = session.current;
  const board = tree?.boards.find((b) => b.board.id === cur?.boardId);
  const canvas = board?.canvases.find((b) => b.id === cur?.canvasId);
  return shotFileName(settings.get("edit.name"), { workspace: tree?.workspace.displayName ?? "workspace", board: board?.board.name ?? "board", canvas: canvas?.name ?? "canvas", at: new Date(), extra: { name: stem, position: "" } }, settings.get("edit.nameStyle"));
}

export async function storeFrame(assets: AssetLibrary, session: Session, settings: SettingsStore, shot: FrameShot): Promise<AssetRecord> {
  const edit = shot.kind === "edit";
  // the settings of what is being made: an edited picture has its own (format, folder, name, tags), an extracted frame has theirs
  const c = edit
    ? { format: settings.get("edit.format"), quality: settings.get("edit.quality"), name: settings.get("edit.name"), style: settings.get("edit.nameStyle"), folder: settings.get("edit.folder"), own: settings.get("edit.tagEdited") ? "edited-picture" : "", source: settings.get("edit.tagSource"), inherit: settings.get("edit.tagInherit"), custom: settings.get("edit.tagsCustom"), fallback: "picture" }
    : { format: settings.get("frame.format"), quality: settings.get("frame.quality"), name: settings.get("frame.name"), style: settings.get("frame.nameStyle"), folder: settings.get("frame.folder"), own: settings.get("frame.tagFrame") ? "extracted-frame" : "", source: settings.get("frame.tagSource"), inherit: settings.get("frame.tagInherit"), custom: settings.get("frame.tagsCustom"), fallback: "frame" };
  const { blob, mime, ext } = await encodePicture(shot.png, c.format, c.quality);
  const stem = shot.sourceName.replace(/\.[^.]*$/, "") || c.fallback;
  const tree = session.tree;
  const cur = session.current;
  const board = tree?.boards.find((b) => b.board.id === cur?.boardId);
  const canvas = board?.canvases.find((b) => b.id === cur?.canvasId);
  const position = edit ? "" : framePosition(shot.label);
  const file = `${shotFileName(c.name, { workspace: tree?.workspace.displayName ?? "workspace", board: board?.board.name ?? "board", canvas: canvas?.name ?? "canvas", at: new Date(), extra: { name: stem, position } }, c.style)}.${ext}`;
  const { record } = await assets.importFileDetailed(new File([blob], file, { type: mime }), true);
  const tags: string[] = [];
  if (c.own) tags.push(c.own);
  if (c.source) tags.push(stem);
  if (c.inherit) tags.push(...((await session.catalog?.entry(shot.sourceHash).catch(() => undefined))?.tags ?? []));
  tags.push(...parseTags(c.custom));
  await fileInLibrary(session, record.hash, c.folder, tags);
  return record;
}
