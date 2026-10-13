import type { Session } from "../app/session";
import type { ExportScope } from "../storage/archive";
import { ARCHIVE_EXTENSION, ArchiveError } from "../storage/archive";
import { confirmDialog } from "./confirm";
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
    tell(
      session,
      `Exported ${r.fileName} (${fmtBytes(r.blob.size)}; ${r.canvases} canvas(es), ${r.objects} object(s), ${r.manifest.assets.length} original(s); checked before saving).` +
        (missing ? ` ${missing} original(s) were already missing and are not included.` : ""),
    );
  } catch (e) {
    tell(session, `Export failed: ${(e as Error).message}`);
  }
}

/** Validate an archive, show what it contains, and import it only after confirmation. */
export async function runImport(session: Session, file: File): Promise<void> {
  if (session.editor.blockEdit()) return;
  let plan;
  try {
    plan = await session.readArchive(file);
  } catch (e) {
    tell(session, `Cannot import ${file.name}: ${e instanceof ArchiveError ? e.message : (e as Error).message}`);
    return;
  }
  const canvases = plan.boards.reduce((n, b) => n + b.canvases.length, 0);
  const where =
    plan.scope === "canvas" ? "It will be added as a new canvas on the open board."
    : plan.scope === "assets" ? "The originals will be added to the Assets library."
    : `It will be added as ${plan.boards.length} new board(s); nothing existing is replaced.`;
  const lines = [
    `Exported ${plan.exportedAt ? new Date(plan.exportedAt).toLocaleString() : "at an unknown time"} from “${plan.workspaceName}”.`,
    `Contains ${canvases} canvas(es), ${plan.objects} object(s) and ${plan.assets.length} original(s). All checksums and content hashes were verified.`,
    where,
  ];
  if (plan.unresolved.length) lines.push(`${plan.unresolved.length} image(s) refer to originals that are not in the archive; they show as missing unless already in your library.`);
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
      `Imported ${r.canvases} canvas(es) and ${r.objects} object(s); ${r.assetsAdded} new original(s) stored.` +
        (r.stillMissing ? ` ${r.stillMissing} original(s) are still missing.` : ""),
    );
  } catch (e) {
    tell(session, `Import failed; nothing was changed: ${(e as Error).message}`);
  }
}
