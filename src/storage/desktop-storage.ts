/**
 * The desktop build's storage (ADR 0177): the same storage as the browser build, in this workspace's own IndexedDB (a
 * storage partition per workspace folder), which the workspace folder follows (`WorkspaceMirror`): boards as folders,
 * canvases as `.cvst` files, `.canvast/workspace.json` and `library.json`. Every original is a readable file under
 * `library/`, written through the library-folder code (ADR 0159) with readable names and moved when it is filed or renamed.
 */
import { isHiddenFile } from "./hidden-vault";
import type { DeleteMode, DesktopBridge } from "./desktop-bridge";
import type { Dir } from "./external-folder";
import { externalFolder } from "./external-folder";
import { openBrowserStorage } from "./idb-storage";
import { DesktopCatalog, DesktopLibrary, DesktopOriginals, moveIdbLibrary } from "./desktop-library";
import type { IdbBackups, IdbStorage } from "./idb-storage";
import type { CustomThumbStore, FolderSync, FolderWriting, OpenHooks } from "./store";
import { sha256Hex } from "../assets/sha256";
import { LIBRARY_DIR, LIBRARY_JSON } from "./library-mirror";
import { WORKSPACE_FILE, WorkspaceMirror, watched } from "./workspace-mirror";
import { BOARDS_DIR, WORKSPACE_NAMING } from "./workspace-names";
import { HIDDEN_JSON, HiddenVault, isHiddenCopy } from "./hidden-store";
import { useScrypt } from "./hidden-vault";
import { sealedHooks, thumbHooks } from "./archive";
import { resetAllData } from "./reset";


/** The workspace folder as a directory of the library-folder code; paths are relative to the workspace. */
export function bridgeDir(bridge: DesktopBridge, name: string, deleteTo: () => DeleteMode = () => "trash"): Dir {
  const notFound = (path: string): DOMException => new DOMException(`${path} is not there`, "NotFoundError");
  return {
    name,
    async getFileHandle(path, o) {
      if (!o?.create && !(await bridge.exists(path))) throw notFound(path);
      return {
        async getFile() {
          const bytes = await bridge.read(path);
          if (!bytes) throw notFound(path);
          return new File([bytes as Uint8Array<ArrayBuffer>], path.slice(path.lastIndexOf("/") + 1));
        },
        async createWritable() {
          const parts: Blob[] = [];
          return {
            write: async (b: Blob) => void parts.push(b),
            close: async () => bridge.write(path, new Uint8Array(await new Blob(parts).arrayBuffer())),
          };
        },
      };
    },
    removeEntry: (path) => bridge.remove(path, deleteTo()),
    sizes: (paths) => bridge.sizes(paths),
  };
}

export async function openDesktopStorage(raw: DesktopBridge, opts: OpenHooks): Promise<IdbStorage> {
  // What the app itself writes, moves or deletes is noted for a few seconds, so its own changes are not taken for outside ones.
  const recent = new Map<string, number>();
  const note = (...paths: string[]): void => {
    const now = Date.now();
    for (const p of paths) recent.set(p, now);
  };
  const bridge: DesktopBridge = {
    ...raw,
    write: (p, b, o) => (note(p), raw.write(p, b, o)),
    rename: (a, b) => (note(a, b), raw.rename(a, b)),
    remove: (p, how) => (note(p), raw.remove(p, how)),
    erase: (p) => (note(p), raw.erase(p)),
    makeFolder: (p) => (note(p), raw.makeFolder(p)),
    removeEmptyFolder: (p) => (note(p), raw.removeEmptyFolder(p)),
  };
  const ws = await bridge.workspace();
  if (!ws) throw new Error("the desktop app did not say which workspace folder is open");
  const storage = await openBrowserStorage(opts);
  externalFolder.naming = WORKSPACE_NAMING;
  externalFolder.saveHandle = false; // (the folder is the workspace itself, never a handle kept in the database)
  const deleteTo = (): DeleteMode => opts.deleteTo?.() ?? "trash";
  await externalFolder.use(bridgeDir(bridge, ws.name, deleteTo));
  useScrypt((password, salt, N, r, p) => raw.scrypt(password, salt, N, r, p)); // (natively, in the main process)
  // The library: in the main process's SQLite file (a library of a million items opens in seconds there), not in the page's storage.
  const lib = new DesktopLibrary(raw.lib);
  await moveIdbLibrary(storage.db, lib);
  const desktopCatalog = new DesktopCatalog(storage.db, lib);
  const hidden = new HiddenVault(bridge, async () => (await desktopCatalog.pages.counts()).hidden); // (counted in the main process)
  desktopCatalog.vault = hidden;
  const mirror = new WorkspaceMirror(storage.db, lib, storage.workspace, bridge, deviceId(), hidden, deleteTo);
  // Hidden originals are sealed files: read through the key, in memory (none while locked); their thumbnails are stored encrypted.
  externalFolder.unseal = {
    open: async (blob) => {
      const bytes = await hidden.open(new Uint8Array(await blob.arrayBuffer()));
      return bytes && new Blob([bytes]);
    },
    ready: () => hidden.isOpen(),
  };
  // An import's originals go straight into the workspace folder: nothing large passes through the app's storage (ADR 0177).
  (storage.backups as IdbBackups).writeOriginals = (batch) => mirror.writeOriginals(batch);
  (storage.backups as IdbBackups).library = lib;
  mirror.onError = (text) => opts.onNotice?.(text);
  hidden.onNotice = (text) => opts.onNotice?.(text);
  // Settings > Privacy: hidden items' names out of this device's cache while locked. What waits is written before the key goes; once
  // locked (and at start-up, locked), the names are blanked; opening fills them in again from the sealed index.
  hidden.beforeLock = () => mirror.flush();
  hidden.subscribe(() => void (!hidden.isOpen() && opts.hiddenNamesOff?.() && mirror.blankHidden()));
  // Backups carry hidden items as they are sealed here, with the key file (archive version 7).
  sealedHooks.key = () => hidden.keyText();
  sealedHooks.write = (files, key) => mirror.importSealed(files, key);
  await mirror.adoptLocks().catch(() => undefined); // (before the app asks for the workspace password)
  const writingFns = new Set<(done: number, total: number, encrypting?: boolean) => void>();
  let writingNow: { done: number; total: number } | null = null;
  mirror.onProgress = (done, total, encrypting) => {
    writingNow = total ? { done, total } : null;
    for (const fn of writingFns) fn(done, total, encrypting);
  };
  const folderWriting: FolderWriting = {
    subscribe: (fn) => (writingFns.add(fn), () => void writingFns.delete(fn)),
    now: () => writingNow,
  };
  const tree = (): void => mirror.tree();
  const canvases = (r: { canvases: string[] }): void => r.canvases.forEach((id) => mirror.canvas(id));
  const workspace = watched(storage.workspace, {
    // The folder is read before the session opens anything (its current canvas may be one the folder brought).
    startup: async (r) => {
      await mirror.start();
      if (opts.hiddenNamesOff?.()) await mirror.blankHidden();
      const days = opts.trashDays?.() ?? 0;
      if (days > 0) void raw.emptyOldTrash(days).catch(() => 0); // (Settings > Storage: what has been in .trash long enough goes)
      const current = await storage.workspace.current();
      return current ? { ...r, current } : r;
    },
    commit: (_r, id) => mirror.canvas(id),
    saveBookmarks: (_r, id) => mirror.canvas(id),
    changeObjectTag: canvases,
    removeAssetInstances: canvases,
    formatStoredTags: () => mirror.everything(),
    saveCamera: () => mirror.device(),
    setCurrent: () => mirror.device(),
    createWorkspace: tree,
    createBoard: tree,
    createCanvas: tree,
    duplicateCanvas: tree,
    duplicateBoard: tree,
    moveCanvas: tree,
    moveBoard: tree,
    renameWorkspace: tree,
    setViewGround: tree,
    renameBoard: tree,
    renameCanvas: tree,
    deleteCanvas: tree,
    deleteBoard: tree,
    saveStyles: tree,
  });
  const backups = watched(storage.backups, { applyImport: () => mirror.everything(), recordBackup: () => mirror.device() });
  const library = (): void => mirror.library();
  const folderSync: FolderSync = {
    checkFiles: (onStep, quick) => mirror.checkFiles(onStep, quick),
    start(on) {
      mirror.importFiles = (files) => on.importFiles(files);
      mirror.askHiddenKey = (names) => on.hiddenNeedsKey(names);
      mirror.scanHiddenLater = () => void mirror.rescan(() => on.libraryChanged());
      // Start-up: only what changed in library/ since the last look here (the whole folder the first time); the look is then kept.
      void raw
        .libraryChanges()
        .catch(() => null)
        .then((changed) => mirror.rescan(() => on.libraryChanged(), false, changed ?? undefined))
        .then(() => raw.libraryLookDone().catch(() => undefined));
      const check = (): void =>
        void on.beforeCheck().then(async () => {
          const r = await mirror.recheck();
          if (r.tree) await on.canvasesChanged(r.canvases);
        });
      mirror.onContested = check;
      raw.onChanged((paths) => {
        externalFolder.forgetSizes(paths); // (their sizes are looked at again)
        const now = Date.now();
        for (const [p, t] of recent) if (now - t > 5000) recent.delete(p);
        // Library paths the app itself just wrote (or a folder holding one) are not looked through again: that costs a listing of
        // the whole library. Canvas and index files are always compared, by their headers and contents, which is cheap: another
        // device may write the same file a moment after this one did.
        const ownWrite = (p: string): boolean => [...recent.keys()].some((r) => r === p || r.startsWith(`${p}/`));
        // (the library is listed again after any outside change in it: a file put back in its own place changes no item, but it is there again)
        const hiddenTouched = paths.some((p) => p.startsWith(".hidden/") && !isHiddenFile(p) && !ownWrite(p));
        const outside = paths.filter((p) => (p === "library" || p.startsWith("library/")) && !ownWrite(p));
        if (hiddenTouched || outside.length) void mirror.rescan(() => undefined, hiddenTouched, outside).then(() => on.libraryChanged());
        if (paths.some((p) => p === LIBRARY_JSON || /^\.canvast\/library[^/]+\.json$/i.test(p) || p === HIDDEN_JSON || isHiddenCopy(p) || p === LIBRARY_DIR || p.startsWith(`${LIBRARY_DIR}/`))) void mirror.rereadLibrary(() => on.libraryChanged());
        if (paths.some((p) => p === WORKSPACE_FILE || /^\.canvast\/workspace[^/]+\.json$/i.test(p) || p.startsWith(`${BOARDS_DIR}/`))) check();
      });
    },
  };
  // (Changes to some items say which: a big library then writes only their parts. Hiding and showing: the items the library marked
  // as not written yet, with the folders.)
  const some = (hashes: readonly string[]): void => mirror.library(hashes);
  const marked = (): void => mirror.libraryMarked();
  const catalog = watched(desktopCatalog as typeof storage.catalog, {
    setLock: tree,
    renameAssets: (_n, changes) => some(changes.map((c) => c.hash)),
    updateMeta: (_e, hash, change) => (change.hidden === false ? marked() : some([hash])),
    updateMetaEach: (_e, changes) => (changes.some((c) => c.change.hidden === false) ? marked() : some(changes.map((c) => c.hash))),
    renameTag: library,
    deleteTag: library,
    createFolder: () => some([]), // (a new folder holds nothing: the index and its real folder only)
    renameFolder: library,
    deleteFolder: library,
    hideFolder: marked,
    showFolder: marked,
    restoreMeta: library,
    markDeleted: (_r, hash) => some([hash]),
    markDeletedEach: (_r, hashes) => some(hashes),
    collect: (r) => void ((r.swept.length || r.restored.length) && some([...r.swept, ...r.restored])),
    reconcile: (n) => void (n && mirror.library()),
  });
  const desktopOriginals = new DesktopOriginals(storage.db, lib, desktopCatalog);
  desktopOriginals.onNotice = storage.originals.onNotice;
  const originals = watched(desktopOriginals as typeof storage.originals, { put: (_r, record) => some([record.hash]) });
  // Rebuild from the folder: what is not in the folder yet is written first, then only the working copy goes (the settings stay).
  const resetAll = async (onBlocked?: () => void): Promise<void> => {
    await mirror.flush();
    await lib.calls.reset();
    await resetAllData({ db: storage.db, keepSettings: true, ...(onBlocked ? { onBlocked } : {}) });
  };
  // Custom thumbnails as files of `.canvast/thumbnails/`, named by their SHA-256; hidden ones sealed with the hidden items' key in
  // `.hidden/thumbnails/` (a folder of its own: never taken for a hidden item), each named by the SHA-256 of `thumb:` and its hash, so
  // a name says nothing of the picture (ADR 0177).
  const THUMBS = ".canvast/thumbnails", HIDDEN_THUMBS = ".hidden/thumbnails";
  const HEX = /^[0-9a-f]{64}$/;
  const normalPath = (h: string): string => `${THUMBS}/${h}.webp`;
  const hiddenPath = async (h: string): Promise<string> => `${HIDDEN_THUMBS}/${await sha256Hex(new TextEncoder().encode(`thumb:${h}`).buffer as ArrayBuffer)}.bin`;
  const asBlob = (b: Uint8Array): Blob => new Blob([b as Uint8Array<ArrayBuffer>], { type: "image/webp" });
  const putNormal = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
    const hash = await sha256Hex(bytes.buffer);
    await bridge.write(normalPath(hash), bytes);
    return hash;
  };
  const putSealed = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
    if (!hidden.isOpen()) throw new Error("the hidden items are locked");
    const hash = await sha256Hex(bytes.buffer);
    await bridge.write(await hiddenPath(hash), await hidden.seal(bytes, { kind: "thumbnail", hash }));
    return hash;
  };
  const getNormal = async (h: string): Promise<Uint8Array<ArrayBuffer> | null> => (HEX.test(h) ? ((await bridge.read(normalPath(h))) as Uint8Array<ArrayBuffer> | null) : null);
  const getSealed = async (h: string): Promise<Uint8Array<ArrayBuffer> | null> => {
    if (!HEX.test(h) || !hidden.isOpen()) return null;
    const sealed = await bridge.read(await hiddenPath(h));
    return sealed ? hidden.open(sealed as Uint8Array<ArrayBuffer>) : null;
  };
  const customThumbs: CustomThumbStore = {
    put: async (blob) => putNormal(new Uint8Array(await blob.arrayBuffer())),
    get: async (h) => ((b) => (b ? asBlob(b) : null))(await getNormal(h)),
    list: async () => (await bridge.list(THUMBS)).flatMap((n) => (/^[0-9a-f]{64}\.webp$/.test(n) ? [n.slice(0, 64)] : [])),
    remove: (h) => bridge.remove(normalPath(h), "erase"),
    putHidden: async (blob) => putSealed(new Uint8Array(await blob.arrayBuffer())),
    getHidden: async (h) => ((b) => (b ? asBlob(b) : null))(await getSealed(h)),
    async listHidden() {
      if (!hidden.isOpen()) return [];
      const out: string[] = [];
      for (const n of await bridge.list(HIDDEN_THUMBS)) {
        const opened = await hidden.openItem((await bridge.read(`${HIDDEN_THUMBS}/${n}`)) as Uint8Array<ArrayBuffer>).catch(() => null);
        const h = opened?.item?.["hash"];
        if (typeof h === "string" && HEX.test(h)) out.push(h);
      }
      return out;
    },
    removeHidden: async (h) => bridge.remove(await hiddenPath(h), "erase"),
    async toHidden(h) {
      const b = await getNormal(h);
      if (!b) return;
      await putSealed(b);
      await bridge.remove(normalPath(h), "erase");
    },
    async toNormal(h) {
      const b = await getSealed(h);
      if (!b) return;
      await putNormal(b);
      await bridge.remove(await hiddenPath(h), "erase");
    },
  };
  thumbHooks.get = (h) => customThumbs.get(h);
  thumbHooks.put = (b) => customThumbs.put(b);
  return { ...storage, resetAll, workspace, backups, catalog, originals, customThumbs, libraryFolder: null, workspaceFolder: ws.path, hidden, folderSync, folderWriting, flush: () => mirror.flush() };
}

/** This device's id in the workspace folder (`.canvast/devices/<id>.json`), made once and kept. */
function deviceId(): string {
  const key = "canvast.deviceId";
  try {
    const kept = localStorage.getItem(key);
    if (kept && /^[0-9a-f]{32}$/.test(kept)) return kept;
    const made = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(key, made);
    return made;
  } catch {
    return "0".repeat(32);
  }
}
