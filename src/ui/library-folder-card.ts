import type { Session } from "../app/session";
import { plural } from "../doc/plural";
import { esc } from "./format";
import { LIBRARY_FILE, externalFolder, folderSupported, libraryCounts } from "../storage/external-folder";
import { runOpenLibraryFile, runSaveLibraryFile } from "./archive-ui";
import { addExtensions, moveFromFolder, moveToFolder } from "../storage/folder-move";

/**
 * The library folder card of Settings > Storage (ADR 0159): where the originals are kept, and the moves between the
 * browser's storage and a folder on the disk. Returns the function that draws it again; the card draws itself after each action.
 */
export function mountLibraryFolderCard(host: HTMLElement, session: Session): () => Promise<void> {
  const draw = async (): Promise<void> => {
    const db = session.repo?.db;
    if (!db) {
      host.innerHTML = `<p>Storage is not available in this tab.</p>`;
      return;
    }
    const st = externalFolder.state;
    const intro = `<p>Keep the files of your library as plain files in a folder on your disk instead of in this browser's storage. A folder has no size limit, so the library can grow as large as your disk.</p>`;
    if (st === "none" && !folderSupported()) {
      host.innerHTML = `${intro}<p data-testid="storage-folder"><strong>Not available in this browser.</strong> It needs Chromium (Chrome, Edge, Brave). Your files stay in the browser's storage.</p>`;
      return;
    }
    const { inFolder, inBrowser, bareNames } = await libraryCounts(db);
    /** A button; `blocked` (a reason) or a read-only tab turns it off, with the reason as its title. */
    const btn = (action: string, label: string, blocked = ""): string => {
      const why = session.readOnly ? "Read-only: another tab is editing" : blocked;
      return `<button type="button" data-folder="${action}"${why ? ` disabled title="${esc(why)}"` : ""}>${label}</button>`;
    };
    if (st === "none") {
      host.innerHTML = `${intro}<p data-testid="storage-folder"><strong>Not set.</strong> Files are kept in the browser's storage.</p><div class="storage-actions">${btn("choose", "Choose library folder…")}</div>`;
      return;
    }
    const name = esc(externalFolder.name);
    if (st !== "ready") {
      host.innerHTML = `${intro}<p data-testid="storage-folder"><strong>${name}</strong> ${st === "needs-permission" ? `needs your permission again (the browser asks once each time it restarts). ${plural(inFolder, "file")} in it show as missing until you allow it.` : "cannot be used right now."}</p><div class="storage-actions">${btn("reconnect", st === "needs-permission" ? "Reconnect folder" : "Try again")}</div>`;
      return;
    }
    const saved = await externalFolder.readLibraryFile();
    host.innerHTML = `${intro}
      <dl data-testid="storage-folder">
        <dt>Folder</dt><dd><strong>${name}</strong>: new files are stored there.</dd>
        <dt>Files in the folder</dt><dd data-testid="folder-count">${inFolder}</dd>
        <dt>Files in the browser</dt><dd data-testid="browser-count">${inBrowser}</dd>
        <dt>Library file</dt><dd data-testid="library-file">${saved ? `${esc(LIBRARY_FILE)}, saved ${new Date(saved.lastModified).toLocaleString()}` : "not saved yet"}</dd>
      </dl>
      <h4>Use this folder on another device</h4>
      <p>The folder holds the files. Your canvases and the names, tags and folders of the library are kept in the browser, so they are not in the folder unless you save them: <strong>Save library to the folder</strong> writes ${esc(LIBRARY_FILE)} beside the files (a small file, without the files themselves; it is not a backup). On the other device, choose the same folder and press <strong>Open library from the folder</strong>: the canvases are added and every file is matched. Do it on a device that has no canvases of its own yet, or they will be added a second time.</p>
      <div class="storage-actions">
        ${btn("save-library", "Save library to the folder")}
        ${btn("open-library", "Open library from the folder", saved ? "" : `No ${LIBRARY_FILE} in the folder yet`)}
      </div>
      <div class="storage-actions">
        ${btn("in", "Move browser files into the folder", inBrowser ? "" : "Nothing in the browser to move")}
        ${btn("out", "Move files back into the browser", inFolder ? "" : "Nothing in the folder to move")}
        ${bareNames ? btn("names", `Add file extensions to ${plural(bareNames, "file")}`) : ""}
        ${btn("choose", "Choose another folder…", inFolder ? "Move the files back into the browser first, or they would show as missing" : "")}
        ${btn("forget", "Stop using this folder", inFolder ? "Move the files back into the browser first" : "")}
      </div>
      <p class="storage-note">Files are named by their content and keep their extension (<code>a07c9f….png</code>), so other programs can open them. Do not move, rename or edit them: canvast finds each one by that name.${bareNames ? ` ${plural(bareNames, "file")} still ${bareNames === 1 ? "has" : "have"} no extension (kept before extensions were added): the button above writes them again with one.` : ""} A backup (.canvast) holds their bytes as always.</p>`;
  };

  host.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-folder]");
    const db = session.repo?.db;
    if (!b || !db || b.disabled) return;
    const act = b.dataset["folder"];
    const say = (t: string): void => {
      const el = host.querySelector<HTMLElement>('[data-testid="folder-count"]') ?? host;
      el.textContent = t;
    };
    try {
      if (act === "choose") {
        await externalFolder.choose(db);
        // A folder that already holds a library (saved on another device) is offered at once: one more click, not three.
        if (await externalFolder.readLibraryFile()) await runOpenLibraryFile(session);
      }
      else if (act === "reconnect") await externalFolder.reconnect();
      else if (act === "forget") await externalFolder.forget(db);
      else if (act === "save-library") await runSaveLibraryFile(session);
      else if (act === "open-library") await runOpenLibraryFile(session);
      else if (act === "names") {
        const r = await addExtensions(db, (d, n) => say(`Renaming files… ${d} of ${n}`));
        session.tell(r.failed ? `Added extensions to ${plural(r.moved, "file")}; ${r.failed} could not be changed (${r.why}).` : `Added extensions to ${plural(r.moved, "file")}.`);
      }
      else {
        const r = await (act === "in" ? moveToFolder : moveFromFolder)(db, (d, n) => say(`Moving files… ${d} of ${n}`));
        session.tell(r.failed ? `Moved ${plural(r.moved, "file")}; ${r.failed} could not be moved (${r.why}). They stay where they were.` : `Moved ${plural(r.moved, "file")}.`);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") session.tell(`Library folder: ${(err as Error).message}`); // (closing the picker is not an error)
    }
    void draw();
  });
  externalFolder.subscribe(() => void draw());
  return draw;
}
