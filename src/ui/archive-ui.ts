import type { Session } from "../app/session";
import { be, plural, were } from "../doc/plural";
import type { ExportScope } from "../storage/archive";
import { ARCHIVE_EXTENSION, ArchiveError } from "../storage/archive";
import { chooseDialog, confirmDialog } from "./confirm";
import { fmtBytes } from "./format";

/** Export, download and import of `.canvast` archives (ADR 0008). Results are reported through the editor message. */

export const ARCHIVE_ACCEPT = `${ARCHIVE_EXTENSION},.zip,application/zip`;

export function isArchiveFile(f: File): boolean {
  return f.name.toLowerCase().endsWith(ARCHIVE_EXTENSION);
}

function tell(session: Session, message: string): void {
  session.editor.message = message;
  session.editor.changed();
}

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

export async function runExport(session: Session, scope: ExportScope): Promise<void> {
  tell(session, "Preparing the export…");
  try {
    const r = await session.exportArchive(scope);
    download(r.blob, r.fileName);
    const missing = r.manifest.missingAssets.length;
    const inc = r.manifest.incremental;
    const kept = r.manifest.assets.filter((a) => a.file).length;
    tell(
      session,
      `Exported ${r.fileName} (${fmtBytes(r.blob.size)}; ${inc ? `only what changed since ${new Date(inc.since).toLocaleString()}: ` : ""}${plural(r.canvases, "canvas", "canvases")}, ${plural(r.objects, "object")}, ${plural(inc ? kept : r.manifest.assets.length, "original")}; checked before saving).` + (inc ? " Keep it with the full backup and the incremental ones before it: restoring takes them all together." : "") +
        (missing ? ` ${plural(missing, "original")} ${were(missing)} already missing and ${missing === 1 ? "is" : "are"} not included.` : ""),
    );
  } catch (e) {
    tell(session, `Export failed: ${(e as Error).message}`);
  }
}

/** Export the original files of a scope as a plain ZIP, after asking how to group them. */
export async function runExportFiles(session: Session, scope: ExportScope): Promise<void> {
  const layout = await chooseDialog({
    title: "Export the files as a ZIP",
    lines: ["Every file keeps its original name. Choose how they are grouped inside the ZIP."],
    choices: [
      { value: "type", label: "By file type", help: "A folder for each extension: item.obj goes in obj, photo.png in png. Files with no extension go in other." },
      { value: "folder", label: "By my folders", help: "The folders you made in the Library; files with no folder go in the folder of their file type." },
    ],
    confirmLabel: "Export ZIP",
  });
  if (layout !== "type" && layout !== "folder") return;
  tell(session, "Preparing the ZIP…");
  try {
    const r = await session.exportFiles(scope, layout);
    if (r.files === 0) return tell(session, "There are no files to export here.");
    download(r.blob, r.fileName);
    tell(session, `Exported ${r.fileName} (${fmtBytes(r.blob.size)}; ${plural(r.files, "file")}).` + (r.missing ? ` ${plural(r.missing, "original")} ${were(r.missing)} missing and ${be(r.missing)} not included.` : ""));
  } catch (e) {
    tell(session, `Export failed: ${(e as Error).message}`);
  }
}

/** Export the changes since the last backup of the workspace (an incremental backup), or tell why that cannot be. */
export async function runExportChanges(session: Session): Promise<void> {
  const last = await session.lastBackup();
  if (!last) return tell(session, "There is no backup to go on from yet: make a full backup first.");
  await runExport(session, { kind: "workspace", since: last.at });
}

/** Validate an archive (or a chain of backups: a full one and the incremental ones after it), show what it contains, and import it only after confirmation. */
export async function runImport(session: Session, picked: File | readonly File[]): Promise<void> {
  if (session.editor.blockEdit()) return;
  const files = Array.isArray(picked) ? (picked as readonly File[]) : [picked as File];
  if (!files.length) return;
  const file = files.length === 1 ? files[0]! : { name: `${files.length} backup files` };
  let plan;
  try {
    plan = await session.readArchive(files.length === 1 ? files[0]! : files);
  } catch (e) {
    tell(session, `Cannot import ${file.name}: ${e instanceof ArchiveError ? e.message : (e as Error).message}`);
    return;
  }
  const canvases = plan.boards.reduce((n, b) => n + b.canvases.length, 0);
  const where =
    plan.scope === "canvas" ? "It will be added as a new canvas on the open board."
    : plan.scope === "assets" ? "The originals will be added to the library."
    : `It will be added as ${plural(plan.boards.length, "new board")}; nothing existing is replaced.`;
  const lines = [
    `Exported ${plan.exportedAt ? new Date(plan.exportedAt).toLocaleString() : "at an unknown time"} from “${plan.workspaceName}”${plan.files > 1 ? `, put together from ${plan.files} files of a backup chain` : ""}.`,
    ...(plan.incrementalOnly ? ["This is an incremental backup on its own: only the canvases that changed are in it. Add the full backup and the earlier incremental ones to restore everything."] : []),
    `Contains ${plural(canvases, "canvas", "canvases")}, ${plural(plan.objects, "object")} and ${plural(plan.assets.length, "original")}. All checksums and content hashes were verified.`,
    where,
  ];
  if (plan.unresolved.length) lines.push(`${plural(plan.unresolved.length, "image")} ${plan.unresolved.length === 1 ? "refers" : "refer"} to originals that are not in the archive; ${plan.unresolved.length === 1 ? "it shows" : "they show"} as missing unless already in your library.`);
  if (plan.problems.length) {
    lines.push(`Problems (${plan.problems.length}):`, ...plan.problems.slice(0, 5));
    if (plan.problems.length > 5) lines.push(`…and ${plan.problems.length - 5} more.`);
  }
  const ok = await confirmDialog({ title: `Import ${file.name}?`, lines, confirmLabel: "Import", danger: false });
  if (!ok) return;
  try {
    const r = await session.applyImport(plan);
    if (!r) return;
    tell(
      session,
      `Imported ${plural(r.canvases, "canvas", "canvases")} and ${plural(r.objects, "object")}; ${plural(r.assetsAdded, "new original")} stored.` +
        (r.stylesAdded ? ` ${plural(r.stylesAdded, "saved style")} added.` : "") +
        (r.stillMissing ? ` ${plural(r.stillMissing, "original")} ${be(r.stillMissing)} still missing.` : ""),
    );
  } catch (e) {
    tell(session, `Import failed; nothing was changed: ${(e as Error).message}`);
  }
}
