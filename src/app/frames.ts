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
}

/** Make the frame's file (in the chosen format and name), import it, and file it in the chosen folder with the chosen tags. */
export async function storeFrame(assets: AssetLibrary, session: Session, settings: SettingsStore, shot: FrameShot): Promise<AssetRecord> {
  const format = settings.get("frame.format");
  let blob = shot.png;
  let mime = "image/png";
  let ext = "png";
  if (format !== "png") {
    try {
      const bmp = await createImageBitmap(shot.png);
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const x = c.getContext("2d")!;
      if (format === "jpeg") {
        x.fillStyle = "#fff";
        x.fillRect(0, 0, c.width, c.height);
      }
      x.drawImage(bmp, 0, 0);
      bmp.close();
      const enc = await encodeShot(c, format, settings.get("frame.quality"));
      blob = enc.blob;
      mime = SHOT_FORMATS[enc.format].mime;
      ext = SHOT_FORMATS[enc.format].ext;
    } catch {
      // the picture stays a PNG
    }
  }
  const stem = shot.sourceName.replace(/\.[^.]*$/, "") || "frame";
  const tree = session.tree;
  const cur = session.current;
  const board = tree?.boards.find((b) => b.board.id === cur?.boardId);
  const canvas = board?.canvases.find((c) => c.id === cur?.canvasId);
  const position = framePosition(shot.label);
  const file = `${shotFileName(settings.get("frame.name"), { workspace: tree?.workspace.displayName ?? "workspace", board: board?.board.name ?? "board", canvas: canvas?.name ?? "canvas", at: new Date(), extra: { name: stem, position } }, settings.get("frame.nameStyle"))}.${ext}`;
  const { record } = await assets.importFileDetailed(new File([blob], file, { type: mime }), true);
  const tags: string[] = [];
  if (settings.get("frame.tagFrame")) tags.push("extracted-frame");
  if (settings.get("frame.tagSource")) tags.push(stem);
  if (settings.get("frame.tagInherit")) tags.push(...((await session.catalog?.entry(shot.sourceHash).catch(() => undefined))?.tags ?? []));
  tags.push(...parseTags(settings.get("frame.tagsCustom")));
  await fileInLibrary(session, record.hash, settings.get("frame.folder"), tags);
  return record;
}
