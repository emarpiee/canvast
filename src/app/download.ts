/**
 * Download the original files of the picked media (ADR 0119): one file as it is, several in one ZIP. A still with a crop or adjustments
 * also brings the edited picture (as it looks now), named as Settings > Edited pictures says. Video, GIF and audio keep their
 * adjustments only on the canvas (they cannot be baked into the file), so their originals come as they are.
 */
import type { DocumentStore } from "../doc/document-store";
import type { ImageObject } from "../doc/model";
import { cropOf, isNeutral } from "../doc/adjust";
import { renderedPicture } from "../render/adjust-image";
import type { AssetLibrary } from "../assets/asset-library";
import type { SettingsStore } from "../settings/settings";
import { writeZip } from "../storage/zip";
import type { ZipInput } from "../storage/zip";
import { saveFile } from "../ui/file-actions";
import { safeName } from "../storage/files-zip";
import { encodePicture, editedName } from "./frames";
import type { Session } from "./session";
import type { EditorState } from "./editor-state";

/** The picked objects that are files of the library (pictures, video, GIF, audio, any other file). */
export const pickedFiles = (doc: DocumentStore, editor: EditorState): ImageObject[] =>
  [...editor.selection].map((id) => doc.get(id)).filter((o): o is ImageObject => o?.kind === "image");

/** A name not yet taken in the ZIP: "a.png", "a (2).png", without regard to case. */
function free(taken: Set<string>, name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 1; ; n++) {
    const c = n === 1 ? name : `${stem} (${n})${ext}`;
    if (!taken.has(c.toLowerCase())) {
      taken.add(c.toLowerCase());
      return c;
    }
  }
}

export async function downloadSelection(doc: DocumentStore, editor: EditorState, assets: AssetLibrary, session: Session, settings: SettingsStore): Promise<void> {
  const objs = pickedFiles(doc, editor);
  if (!objs.length) return;
  const taken = new Set<string>();
  const entries: ZipInput[] = [];
  const done = new Set<string>();
  let edited = 0;
  let unbaked = 0;
  let missing = 0;
  for (const o of objs) {
    const rec = await assets.record(o.assetId).catch(() => undefined);
    if (!rec) {
      missing++;
      continue;
    }
    const base = safeName(rec.name, `file-${o.assetId.slice(0, 8)}`);
    if (!done.has(o.assetId)) {
      done.add(o.assetId); // (one original, however many times it is on the canvas)
      entries.push({ name: free(taken, base), data: rec.blob });
    }
    const changed = !!o.crop || !isNeutral(o.adjust);
    if (!changed) continue;
    if (o.media || rec.card) {
      if (!isNeutral(o.adjust)) unbaked++;
      continue;
    }
    const png = await renderedPicture(rec.blob, cropOf(o), o.adjust);
    if (!png) continue;
    const enc = await encodePicture(png, settings.get("edit.format"), settings.get("edit.quality"));
    entries.push({ name: free(taken, `${safeName(editedName(session, settings, rec.name), "picture")}.${enc.ext}`), data: enc.blob });
    edited++;
  }
  if (!entries.length) {
    editor.message = "Nothing to download: the files are not stored.";
    return editor.changed();
  }
  let how: string;
  if (entries.length === 1) {
    saveFile(entries[0]!.name, entries[0]!.data);
    how = entries[0]!.name;
  } else {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
    const name = `canvast-files-${stamp}.zip`;
    saveFile(name, await writeZip(entries));
    how = `${name} (${entries.length} files)`;
  }
  editor.message =
    `Downloaded ${how}.` +
    (edited ? ` ${edited} edited ${edited === 1 ? "picture" : "pictures"} (as it looks now) came with the file${edited === 1 ? "" : "s"}.` : "") +
    (unbaked ? ` The adjustments of ${unbaked} video, GIF or other ${unbaked === 1 ? "file" : "files"} stay on the canvas: the file was downloaded.` : "") +
    (missing ? ` ${missing} original${missing === 1 ? " is" : "s are"} missing.` : "");
  editor.changed();
}
