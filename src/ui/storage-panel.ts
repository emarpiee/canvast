import type { Session } from "../app/session";
import { plural } from "../doc/plural";
import { esc, fmtBytes } from "./format";
import { ARCHIVE_ACCEPT, runExport, runExportChanges, runImport } from "./archive-ui";
import { externalFolder, externalHashes, folderSupported } from "../storage/external-folder";
import { moveFromFolder, moveToFolder } from "../storage/folder-move";

/**
 * Storage status popover (opened from the HUD save indicator). It states
 * plainly what the browser does and does not guarantee (ADR 0006): save
 * state, writer role, quota estimate, persistence permission, the last
 * verified save, and the fact that browser storage is not a backup.
 */
export function mountStoragePanel(root: HTMLElement, session: Session, opener: HTMLElement): void {
  const panel = document.createElement("div");
  panel.className = "storage-panel";
  panel.dataset["testid"] = "storage-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Storage status");
  panel.hidden = true;
  root.appendChild(panel);

  const fmtTime = (t: number | null): string => (t ? new Date(t).toLocaleTimeString() : "not yet");

  const render = async (): Promise<void> => {
    const p = session.persistence;
    const sm = (navigator as Navigator & { storage?: StorageManager }).storage;
    let quota = "unknown (not reported by this browser)";
    let persisted = "unknown";
    if (sm?.estimate) {
      try {
        const est = await sm.estimate();
        if (est.usage !== undefined && est.quota !== undefined) quota = `${fmtBytes(est.usage)} used of about ${fmtBytes(est.quota)} (browser estimate)`;
      } catch {
        // leave unknown
      }
    }
    if (sm?.persisted) {
      try {
        persisted = (await sm.persisted()) ? "granted — the browser should not evict this data under storage pressure" : "not granted — the browser may evict this data under storage pressure";
      } catch {
        // leave unknown
      }
    }
    const db = session.repo?.db ?? null;
    const folder = db ? await folderRow(db, session.readOnly) : "";
    const backup = await session.lastBackup();
    const backupText = backup
      ? `${new Date(backup.at).toLocaleString()} — ${esc(backup.fileName)}, ${fmtBytes(backup.bytes)} (${plural(backup.canvases, "canvas", "canvases")}, ${plural(backup.objects, "object")}, ${plural(backup.assets, "original")}); checked before saving. The browser does not report whether the download finished, so keep the file somewhere safe.`
      : "none. Browser storage is not a backup: export one and keep the file safe.";
    const mig = session.startup?.kind === "migrated" ? session.startup.migration : null;
    panel.innerHTML = `
      <h2>Storage</h2>
      <dl>
        <dt>Save state</dt><dd data-testid="storage-save-state">${p.state}${p.lastError ? ` — ${esc(p.lastError)}` : ""}</dd>
        <dt>Last verified save</dt><dd>${fmtTime(p.lastVerifiedAt)}${p.lastCommit ? ` (revision ${p.revision}, ${p.lastCommit.puts} written, ${p.lastCommit.deletes} deleted)` : ""}</dd>
        <dt>This tab</dt><dd data-testid="storage-role">${session.readOnly ? "read-only (another tab is editing)" : "editing (writer)"} · lease via ${session.lease.mechanism}</dd>
        <dt>Space</dt><dd>${quota}</dd>
        <dt>Persistence</dt><dd>${persisted}${typeof sm?.persist === "function" ? ` <button type="button" data-action="persist">Request persistent storage</button>` : ""}</dd>
        ${folder}
        <dt>Last backup</dt><dd data-testid="storage-backup">${backupText}</dd>
        ${mig ? `<dt>Upgrade</dt><dd>Migrated ${mig.copied} of ${plural(mig.sourceObjects, "object")} from the previous format${mig.verified ? " (verified)" : ` — verification failed: ${esc(mig.verifyError ?? "unknown")}`}. The old data was kept unchanged.</dd>` : ""}
      </dl>
      <div class="storage-actions">
        <button type="button" data-action="export" data-testid="export-workspace">Export workspace backup</button>
        <button type="button" data-action="export-changes" data-testid="export-changes" title="Only what changed since the last backup">Export changes only</button>
        <button type="button" data-action="import" data-testid="import-archive"${session.readOnly ? ' disabled title="Read-only: another tab is editing"' : ""}>Import archive…</button>
        <input type="file" multiple accept="${ARCHIVE_ACCEPT}" hidden data-testid="import-archive-input">
      </div>
      <p class="storage-note">Data lives in this browser profile's storage for local files. Another browser, profile or private window will not see it, and clearing site data deletes it.</p>`;
  };

  /** The library folder row (ADR 0159): where originals are kept, and the moves between it and the browser. */
  const folderRow = async (db: IDBDatabase, readOnly: boolean): Promise<string> => {
    const st = externalFolder.state;
    if (st === "none" && !folderSupported()) return `<dt>Library folder</dt><dd data-testid="storage-folder">Not available in this browser (it needs Chromium). Files stay in the browser's storage.</dd>`;
    const inFolder = (await externalHashes(db)).length;
    const dis = readOnly ? ' disabled title="Read-only: another tab is editing"' : "";
    const btn = (action: string, label: string, extra = ""): string => `<button type="button" data-action="${action}"${dis}${extra}>${label}</button>`;
    const pick = folderSupported() ? btn("folder-choose", st === "none" ? "Choose library folder…" : "Choose another folder…") : "";
    const where = esc(externalFolder.name);
    if (st === "none") return `<dt>Library folder</dt><dd data-testid="storage-folder">Not set. Files are kept in the browser's storage, which has a size limit. A folder on your disk has none. ${pick}</dd>`;
    if (st === "needs-permission") return `<dt>Library folder</dt><dd data-testid="storage-folder"><strong>${where}</strong> needs your permission again after a restart. ${inFolder} files from it show as missing until then. ${btn("folder-reconnect", "Reconnect folder")}</dd>`;
    if (st === "unavailable") return `<dt>Library folder</dt><dd data-testid="storage-folder"><strong>${where}</strong> cannot be used right now. ${btn("folder-reconnect", "Try again")}</dd>`;
    return `<dt>Library folder</dt><dd data-testid="storage-folder"><strong>${where}</strong>: new files are stored there (${plural(inFolder, "file")} so far). Do not move or edit the files in it; they are named by their content.
      <span class="storage-actions">${btn("folder-in", "Move browser files into the folder")}${inFolder ? btn("folder-out", "Move files back into the browser") : btn("folder-forget", "Stop using this folder")}${pick}</span></dd>`;
  };

  const toggle = (): void => {
    panel.hidden = !panel.hidden;
    opener.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) void render();
  };
  opener.addEventListener("click", toggle);
  panel.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (b?.dataset["action"] === "export") {
      await runExport(session, { kind: "workspace" });
      void render();
    } else if (b?.dataset["action"] === "export-changes") {
      await runExportChanges(session);
      void render();
    } else if (b?.dataset["action"] === "import") {
      panel.querySelector<HTMLInputElement>('[data-testid="import-archive-input"]')!.click();
    }
    const act = b?.dataset["action"] ?? "";
    const db = session.repo?.db;
    if (db && act.startsWith("folder-")) {
      const say = (t: string): void => {
        const el = panel.querySelector<HTMLElement>('[data-testid="storage-folder"]');
        if (el) el.textContent = t;
      };
      try {
        if (act === "folder-choose") await externalFolder.choose(db);
        else if (act === "folder-reconnect") await externalFolder.reconnect();
        else if (act === "folder-forget") await externalFolder.forget(db);
        else {
          const r = await (act === "folder-in" ? moveToFolder : moveFromFolder)(db, (d, n) => say(`Moving files… ${d} of ${n}`));
          session.tell(r.failed ? `Moved ${plural(r.moved, "file")}; ${r.failed} could not be moved (${r.why}). They stay where they were.` : `Moved ${plural(r.moved, "file")}.`);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") session.tell(`Library folder: ${(e as Error).message}`); // (closing the picker is not an error)
      }
      void render();
    }
    if (b?.dataset["action"] === "persist") {
      const sm = (navigator as Navigator & { storage?: StorageManager }).storage;
      try {
        await sm?.persist?.();
      } finally {
        void render();
      }
    }
  });
  panel.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length) void runImport(session, files).then(() => render());
  });
  document.addEventListener("pointerdown", (e) => {
    if (!panel.hidden && (e.target as Element).closest?.("dialog")) return; // the import confirmation
    if (!panel.hidden && !panel.contains(e.target as Node) && e.target !== opener) toggle();
  });
  session.persistence.subscribe(() => {
    if (!panel.hidden) void render();
  });
}
