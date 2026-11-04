import { desktopBridge } from "../storage/desktop-bridge";
import { hashOf, isDisk, writeProven } from "../storage/disk-file";
import { externalFolder } from "../storage/external-folder";
import type { AssetLibrary } from "../assets/asset-library";
import { describeFile, viewableBlob } from "../assets/file-kind";

/** What can be done with an asset's original, for any kind of file (ADR 0078). */
export interface FileActions {
  /** A tab can show it (a PDF, plain text) when asked. */
  canOpen: boolean;
}

export const fileActionsOf = (name: string, type: string): FileActions => ({ canOpen: describeFile(name, type).openIn !== null });

/** Save a blob under a name (the browser's download). */
export async function saveFile(name: string, blob: Blob): Promise<boolean> {
  if (isDisk(blob)) {
    // Too big to pass through the page: where the person chooses, a part at a time, read back before it is there.
    const stream = desktopBridge()!.stream;
    const place = await stream.save(name);
    if (!place) return false;
    const want = await hashOf(blob);
    await writeProven(stream, place.id, blob, want);
    return true;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/** Save a copy of the original, under its own name. Returns false when the original is not stored. */
export async function downloadOriginal(assets: AssetLibrary, hash: string): Promise<boolean> {
  const rec = await assets.record(hash);
  if (!rec) return false;
  return saveFile(rec.name || `file-${hash.slice(0, 8)}`, await externalFolder.fileOf(rec));
}

/** Show a PDF or a text file in a new tab. It is opened as a typed copy (a PDF as a PDF, text as plain text), never as a page. */
export async function openOriginalInTab(assets: AssetLibrary, hash: string): Promise<boolean> {
  const rec = await assets.record(hash);
  const how = rec ? describeFile(rec.name, rec.type).openIn : null;
  if (!rec || !how) return false;
  const url = URL.createObjectURL(viewableBlob(rec.blob, how));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  return true;
}
