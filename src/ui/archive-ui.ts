import { LIBRARY_FILE, externalFolder } from "../storage/external-folder";
import type { FolderFiles } from "../storage/archive";
import type { Session } from "../app/session";
import { beginProgress } from "../app/progress";
import type { Progress } from "../app/progress";
import { be, plural, were } from "../doc/plural";
import type { ExportScope } from "../storage/archive";
import { scopeWithHiddenChoice, scopeWithPrivacyChoice } from "./hidden-access";
import { ARCHIVE_EXTENSION, ArchiveError } from "../storage/archive";
import { chooseDialog, confirmDialog } from "./confirm";
import { fmtBytes } from "./format";
import { busyProgress } from "./busy-screen";

/** Export, download and import of `.canvast` archives (ADR 0008). Results are reported through the editor message. */

export const ARCHIVE_ACCEPT = `${ARCHIVE_EXTENSION},.zip,application/zip`;

export function isArchiveFile(f: File): boolean {
  return f.name.toLowerCase().endsWith(ARCHIVE_EXTENSION);
}

function tell(session: Session, message: string): void {
  session.editor.message = message;
  session.editor.changed();
}

/** A storage job's report as a progress notice: the stage in words with "n of m", and the bar for that stage. */
const stages = (p: Progress) => (stage: string, done: number, total: number): void => p.update(total > 0 ? done / total : null, `${stage}${total > 1 ? ` (${done} of ${total})` : ""}`);

/** Hand a Blob to the browser's download mechanism. */
function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // The download has started reading by now; keep the URL briefly for slow starts.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function runExport(session: Session, asked: ExportScope): Promise<boolean> {
  const hiddenChosen = await scopeWithHiddenChoice(session, asked);
  const scope = hiddenChosen && (await scopeWithPrivacyChoice(session, hiddenChosen));
  if (!scope) return false;
  const p = beginProgress(session.editor, "export", scope.kind === "workspace" && scope.since !== undefined ? "Exporting the changes" : scope.kind === "workspace" && scope.noBytes ? "Saving the library index" : "Exporting the backup");
  try {
    const r = await session.exportArchive(scope, stages(p));
    p.update(null, "handing the file over");
    download(r.blob, r.fileName);
    const missing = r.manifest.missingAssets.length;
    const inc = r.manifest.incremental;
    const kept = r.manifest.assets.filter((a) => a.file).length;
    p.done(
      `Exported ${r.fileName} (${fmtBytes(r.blob.size)}; ${inc ? `only what changed since ${new Date(inc.since).toLocaleString()}: ` : ""}${plural(r.canvases, "canvas", "canvases")}, ${plural(r.objects, "object")}, ${plural(inc ? kept : r.manifest.assets.length, "file")}; checked before saving).` + (inc ? " Keep it with the full backup and the incremental ones before it: restoring takes them all together." : "") +
        (missing ? ` ${plural(missing, "file")} ${were(missing)} already missing and ${missing === 1 ? "is" : "are"} not included.` : ""),
    );
    return true;
  } catch (e) {
    p.fail(`Export failed: ${(e as Error).message}`);
    return false;
  }
}

/** Export the original files of a scope as a plain ZIP, after asking how to group them. */
export async function runExportFiles(session: Session, asked: ExportScope): Promise<boolean> {
  const scope = await scopeWithHiddenChoice(session, asked);
  if (!scope) return false;
  const layout = await chooseDialog({
    title: "Export the files as a ZIP",
    lines: ["Every file keeps its original name. Choose how they are grouped inside the ZIP."],
    choices: [
      { value: "type", label: "By file type", help: "A folder for each extension: item.obj goes in obj, photo.png in png. Files with no extension go in other." },
      { value: "folder", label: "By my folders", help: "The folders you made in the Library; files with no folder go in the folder of their file type." },
    ],
    confirmLabel: "Export ZIP",
  });
  if (layout !== "type" && layout !== "folder") return false;
  const p = beginProgress(session.editor, "export", "Exporting the files");
  try {
    const r = await session.exportFiles(scope, layout, stages(p));
    if (r.files === 0) {
      p.done("There are no files to export here.");
      return false;
    }
    p.update(null, "handing the file over");
    download(r.blob, r.fileName);
    p.done(`Exported ${r.fileName} (${fmtBytes(r.blob.size)}; ${plural(r.files, "file")}).` + (r.missing ? ` ${plural(r.missing, "file")} ${were(r.missing)} missing and ${be(r.missing)} not included.` : ""));
    return true;
  } catch (e) {
    p.fail(`Export failed: ${(e as Error).message}`);
    return false;
  }
}

/** Export the changes since the last backup of the workspace (an incremental backup), or tell why that cannot be. */
export async function runExportChanges(session: Session): Promise<void> {
  const last = await session.lastBackup();
  if (!last) return tell(session, "There is no backup to go on from yet: make a full backup first.");
  await runExport(session, { kind: "workspace", since: last.at });
}

/** Validate an archive (or a chain of backups: a full one and the incremental ones after it), show what it contains, and import it only after confirmation. */
export async function runImport(session: Session, picked: File | readonly File[], folder?: FolderFiles): Promise<void> {
  if (session.editor.blockEdit()) return;
  const files = Array.isArray(picked) ? (picked as readonly File[]) : [picked as File];
  if (!files.length) return;
  const file = files.length === 1 ? files[0]! : { name: `${files.length} backup files` };
  let plan;
  // An import keeps the app waiting behind one screen, stage by stage, so nothing is changed half-way.
  const reading = busyProgress(session.editor, `Reading ${file.name}`, ["Checking the file before anything is imported."]);
  try {
    plan = await session.readArchive(files.length === 1 ? files[0]! : files, folder, stages(reading));
    reading.done();
  } catch (e) {
    reading.fail(`Cannot import ${file.name}: ${e instanceof ArchiveError ? e.message : (e as Error).message}`);
    return;
  }
  // A library index and a backup are not the same file: say so, and send the person to the right place (ADR 0159).
  if (plan.libraryFile && !folder) {
    tell(session, `${file.name} is a library index, not a backup: it holds no files. Choose the library folder in Settings > Storage and open it there.`);
    return;
  }
  if (!plan.libraryFile && folder) {
    tell(session, `${file.name} is a backup (it holds the files), not a library index. Use Import archive instead.`);
    return;
  }
  const canvases = plan.boards.reduce((n, b) => n + b.canvases.length, 0);
  const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const facts: Array<[string, string]> = [
    ["From", `“${plan.workspaceName}”${plan.files > 1 ? `, ${plan.files} files of a backup chain` : ""}`],
    ["Exported", plan.exportedAt ? new Date(plan.exportedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "at an unknown time"],
    ["Contains", [count(canvases, "canvas", "canvases"), count(plan.objects, "object"), count(plan.assets.length, "file")].join(" · ")],
    ["Checked", "All checksums and content hashes verified"],
    ["Goes to", plan.scope === "canvas" ? "A new canvas on the open board" : plan.scope === "assets" ? "The library: its files are added to the library" : `${count(plan.boards.length, "new board")}; nothing existing is replaced`],
    ...(folder ? [["Originals", "Its files are the ones in the library folder"] as [string, string]] : []),
  ];
  const settings = session.settingsHook?.restorable(plan.settings) ?? 0;
  const carried = [
    ...(plan.libraryFile ? [{ name: "A library index", text: "Your canvases and the library's names, tags and folders, without the files." }] : []),
    ...(plan.workspaceLock ? [{ name: "The workspace password", text: "Used only if this device has none; the app then asks for it when it opens." }] : []),
    ...(plan.hiddenLock ? [{ name: "The Hidden items password", text: "Used only if this device has none." }] : []),
    ...(settings ? [{ name: "Your settings", text: `${count(settings, "setting")} you have not changed on this device (theme, shortcuts, panel layout) ${settings === 1 ? "is" : "are"} restored; the others stay as they are here.` }] : []),
  ];
  const warnings = [
    ...(plan.incrementalOnly ? ["This is an incremental backup on its own: only the canvases that changed are in it. Add the full backup and the earlier incremental ones to restore everything."] : []),
    ...(plan.unresolved.length ? [`${count(plan.unresolved.length, "image")} ${plan.unresolved.length === 1 ? "refers" : "refer"} to files that are not in the archive; ${plan.unresolved.length === 1 ? "it shows" : "they show"} as missing unless already in your library.`] : []),
    ...(plan.problems.length ? [`Problems (${plan.problems.length}): ${plan.problems.slice(0, 5).join(" ")}${plan.problems.length > 5 ? ` …and ${plan.problems.length - 5} more.` : ""}`] : []),
  ];
  const ok = await confirmDialog({ title: folder ? "Open the library of this folder?" : `Import ${file.name}?`, lines: [], facts, list: { title: "Also in this file", items: carried }, warnings, confirmLabel: folder ? "Open library" : "Import", danger: false });
  if (!ok) return;
  const saving = busyProgress(session.editor, folder ? "Opening the library" : `Importing ${file.name}`, ["Keep the app open until it ends."]);
  saving.update(null, "saving into the workspace");
  try {
    const r = await session.applyImport(plan, stages(saving));
    if (!r) {
      saving.done();
      return;
    }
    const restored = session.settingsHook?.restore(plan.settings) ?? 0;
    const result =
      (restored ? `${plural(restored, "setting")} restored. ` : "") + `Imported ${plural(r.canvases, "canvas", "canvases")} and ${plural(r.objects, "object")}; ${plural(r.assetsAdded, "new file")} stored.` +
      (r.stylesAdded ? ` ${plural(r.stylesAdded, "saved style")} added.` : "") +
      (r.stillMissing ? ` ${plural(r.stillMissing, "file")} ${be(r.stillMissing)} still missing.` : "");
    // The desktop build: the import's files are written into the workspace folder first (the busy screen shows how far), then the
    // app starts again on what it now holds, and says the result.
    if (session.storage?.folderWriting) {
      saving.update(null, "Writing the files into the workspace folder");
      await session.storage.flush(); // (its progress shows on this screen)
      sayAfterReload(result);
      location.reload(); // (the screen stays until the app starts again)
      return;
    }
    saving.done(result);
  } catch (e) {
    saving.fail(`Import failed; nothing was changed: ${(e as Error).message}`);
  }
}

/** Write the library index into the library folder: the workspace without the bytes of the originals (ADR 0159). */
export async function runSaveLibraryFile(session: Session): Promise<boolean> {
  const p = beginProgress(session.editor, "library-index", "Saving the library index");
  try {
    const r = await session.exportArchive({ kind: "workspace", noBytes: true }, stages(p));
    p.update(null, "writing it to the folder");
    await externalFolder.writeLibraryFile(r.blob);
    p.done(`Saved the library index (${LIBRARY_FILE}) in the library folder (${fmtBytes(r.blob.size)}; ${plural(r.canvases, "canvas", "canvases")}, ${plural(r.objects, "object")}, ${plural(r.manifest.assets.length, "library item")}; checked before saving).`);
    return true;
  } catch (e) {
    p.fail(`Could not save the library index: ${(e as Error).message}`);
    return false;
  }
}

/** Open the library of the library folder: its library index is read, and every original in it is matched with a file of the folder. */
export async function runOpenLibraryFile(session: Session): Promise<void> {
  const file = await externalFolder.readLibraryFile();
  if (!file) {
    tell(session, `This folder has no ${LIBRARY_FILE}. On the device that has the library, press “Save library index to the folder”.`);
    return;
  }
  const p = beginProgress(session.editor, "library-index", "Opening the library");
  p.update(null, "looking at the files in the folder");
  const list = await externalFolder.list();
  p.done();
  await runImport(session, new File([file], file.name), list);
}

/** A message kept across a reload of the app (shown once, when it has started again). */
const AFTER_RELOAD_KEY = "canvast.afterReload";

export function sayAfterReload(text: string): void {
  try {
    sessionStorage.setItem(AFTER_RELOAD_KEY, text);
  } catch {
    // (no session storage: the reload just says nothing)
  }
}

/** The message kept for after the reload, once (then forgotten), or null. */
export function takeAfterReload(): string | null {
  try {
    const text = sessionStorage.getItem(AFTER_RELOAD_KEY);
    sessionStorage.removeItem(AFTER_RELOAD_KEY);
    return text;
  } catch {
    return null;
  }
}
