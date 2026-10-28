/**
 * Start from scratch (Settings > Storage): everything canvast keeps in this browser is deleted: the database (boards,
 * canvases, library, styles, backup history, the library folder's link) and the device settings. Only canvast's own keys
 * are removed from localStorage (a `file://` origin is shared with other pages). Files on the disk (the library folder) are never touched.
 */

export interface ResetOptions {
  /** The open connection, closed first so the delete is not blocked by this tab. */
  db: IDBDatabase | null;
  /** Another tab still holds the database open: it is asked to close; this says it is waiting. */
  onBlocked?: () => void;
  /** Keep the device settings (the desktop build's rebuild from the workspace folder clears only its working copy). */
  keepSettings?: boolean;
}

export async function resetAllData(o: ResetOptions): Promise<void> {
  o.db?.close();
  const names = new Set(["canvast"]);
  try {
    for (const d of (await indexedDB.databases?.()) ?? []) if (d.name?.startsWith("canvast")) names.add(d.name);
  } catch {
    // only the main database then
  }
  for (const name of names) {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error ?? new Error("the database could not be deleted"));
      r.onblocked = () => o.onBlocked?.(); // waits: the other tabs close their connection when they are told
    });
  }
  if (!o.keepSettings) try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("canvast")) localStorage.removeItem(k);
    for (const k of Object.keys(sessionStorage)) if (k.startsWith("canvast")) sessionStorage.removeItem(k);
  } catch {
    // blocked storage: nothing was kept there
  }
  location.reload();
}
