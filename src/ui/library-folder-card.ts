import type { Session } from "../app/session";
import { plural } from "../doc/plural";
import { esc } from "./format";
import { LIBRARY_FILE, externalFolder, folderSupported, libraryCounts } from "../storage/external-folder";
import { runOpenLibraryFile, runSaveLibraryFile } from "./archive-ui";
import { beginProgress } from "../app/progress";
import { addExtensions, moveFromFolder, moveToFolder } from "../storage/folder-move";

/**
 * The library folder card of Settings > Storage (ADR 0159): where the originals are kept, and the moves between the
 * browser's storage and a folder on the disk. Returns the function that draws it again; the card draws itself after each action.
 */
export function mountLibraryFolderCard(host: HTMLElement, session: Session): () => Promise<void> {
  const draw = async (): Promise<void> => {
    const db = session.storage?.db;
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
    /** One action: its button (short) and what it does beside it. */
    const row = (action: string, label: string, what: string, blocked = ""): string => `<div class="action-row">${btn(action, label, blocked)}<span>${what}</span></div>`;
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
    const autoOn = session.settingsHook?.getAuto() ?? true;
    host.innerHTML = `${intro}
      <dl data-testid="storage-folder">
        <dt>Folder</dt><dd><strong>${name}</strong>: new files are stored there.</dd>
        <dt>Files in the folder</dt><dd data-testid="folder-count">${inFolder}</dd>
        <dt>Files in the browser</dt><dd data-testid="browser-count">${inBrowser}</dd>
        <dt>Library index</dt><dd data-testid="library-file">${saved ? `${esc(LIBRARY_FILE)} (hidden), saved ${new Date(saved.lastModified).toLocaleString()}` : "not saved yet"}</dd>
      </dl>
      <h4>Use this folder on another device</h4>
      <p>Your canvases and the library's names, tags and folders live in the browser. The <strong>library index</strong> (the hidden file <code>${esc(LIBRARY_FILE)}</code>, small, without the files) carries them into the folder, so another device that chooses this folder can open them. It is <strong>not a backup</strong>, and not a cache to delete.</p>
      <label class="storage-check"><input type="checkbox" data-auto-index${autoOn ? " checked" : ""}${session.readOnly ? " disabled" : ""}> Keep the library index up to date automatically</label>
      <div class="action-rows">
        ${row("save-library", "Save index", "Write the index into the folder now. canvast also does it by itself a little after each change.")}
        ${row("open-library", "Open index", "Add the canvases of this folder's index to this device. Use it on a device that has none of its own yet, or they are added twice.", saved ? "" : `No ${LIBRARY_FILE} in the folder yet`)}
        ${row("in", "Move into folder", "Move the files kept in the browser into this folder.", inBrowser ? "" : "Nothing in the browser to move")}
        ${row("out", "Move back to browser", "Move the files from this folder back into the browser's storage.", inFolder ? "" : "Nothing in the folder to move")}
        ${bareNames ? row("names", "Add extensions", `Write ${plural(bareNames, "older file")} again as <code>hash.ext</code>, so other programs can open ${bareNames === 1 ? "it" : "them"}.`) : ""}
        ${row("choose", "Choose another folder…", "Use a different folder.", inFolder ? "Move the files back into the browser first, or they would show as missing" : "")}
        ${row("forget", "Stop using folder", "Go back to the browser's storage only. The folder and its files stay on your disk.", inFolder ? "Move the files back into the browser first" : "")}
      </div>
      <p class="storage-note">Files are named by their content and keep their extension (<code>a07c9f….png</code>). Do not move, rename or edit them: canvast finds each one by that name.</p>`;
  };

  host.addEventListener("change", (e) => {
    const box = (e.target as HTMLElement).closest<HTMLInputElement>("[data-auto-index]");
    if (!box) return;
    session.settingsHook?.setAuto(box.checked);
    if (box.checked) session.autoIndex?.poke();
  });
  let busy = false;
  host.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-folder]");
    const db = session.storage?.db;
    if (!b || !db || b.disabled || busy) return;
    busy = true; // (one job at a time: the buttons do nothing until it ends)
    const act = b.dataset["folder"];
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
        const p = beginProgress(session.editor, "folder", "Adding extensions to the files");
        const r = await addExtensions(db, (d, n) => p.update(n ? d / n : null, `${d} of ${n}`));
        p.done(r.failed ? `Added extensions to ${plural(r.moved, "file")}; ${r.failed} could not be changed (${r.why}).` : `Added extensions to ${plural(r.moved, "file")}.`);
      } else {
        const p = beginProgress(session.editor, "folder", act === "in" ? "Moving files into the folder" : "Moving files back into the browser");
        const r = await (act === "in" ? moveToFolder : moveFromFolder)(db, (d, n) => p.update(n ? d / n : null, `${d} of ${n}`));
        p.done(r.failed ? `Moved ${plural(r.moved, "file")}; ${r.failed} could not be moved (${r.why}). They stay where they were.` : `Moved ${plural(r.moved, "file")}.`);
      }
    } catch (err) {
      session.editor.progressDone.add("folder"); // (a job that threw ends its notice)
      if ((err as Error).name !== "AbortError") session.tell(`Library folder: ${(err as Error).message}`); // (closing the picker is not an error)
    }
    busy = false;
    session.autoIndex?.poke(); // (files moved or a folder chosen: the index is out of date)
    void draw();
  });
  externalFolder.subscribe(() => void draw());
  externalFolder.subscribeSaved(() => void draw()); // (the library index was written by itself)
  return draw;
}
