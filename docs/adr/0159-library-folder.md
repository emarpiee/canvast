# ADR 0159: the library folder: originals kept as files outside the browser's storage

- Status: accepted (2026-10-20, owner's request)
- Related: ADR 0006 to 0008 (storage, catalog, GC), ADR 0155 (update-safe origin)

## Decision

In Chromium the person can pick a **library folder** (Settings > Storage, File System Access API). New originals are written there as `<sha256>.<ext>` (the extension from the file's own name, else its type, else `bin`; so other programs and the file manager can open them) and the browser keeps a **stub** of each. The folder has no quota. Elsewhere (Firefox has no directory picker) nothing changes and the README says so.

Also, for every browser: a full store is reported in plain words (an import is refused, nothing half-stored), the browser is asked once to keep the data (`storage.persist()`), and one notice appears at 80% of the quota (`src/storage/quota.ts`).

## How it works

- A **stub** is the asset's own record in the `assets` store with an empty `blob` and `ext: 1`; `size` is the file's size and `file` its name in the folder (absent on a stub made before names had extensions: the bare hash; the card's *Add file extensions* button writes those again, proven, and removes the old file). Because the key stays, every key-based rule (present, usage, catalog repair, reference-checked GC, the import's "already have it") is unchanged. Schema v10 only adds an index `ext` on that store, to list the stubs. Nothing is converted on upgrade.
- **Write order:** the file is written, read back and its SHA-256 compared with the hash in its name (a file that does not match is removed, never left); only then is the stub stored. If the folder cannot be written the import is refused with the reason; it never falls back silently, and a file is never in neither place.
- **Reads:** `AssetLibrary.record` returns the file's bytes when the file exists with the stored size, and `undefined` otherwise, which the app already treats as a missing original (placeholder, flagged in the Library, restored by importing the same file again). The size is checked on every read; the hash on write, on move and by the archive's own verification.
- **Permission:** a saved handle needs one click per browser session (**Reconnect folder**). Until then folder files show as missing and a notice says why.
- **Moves:** *Move browser files into the folder* and *Move files back into the browser* (`folder-move.ts`) work one original at a time and prove the new copy before the other goes. A move that fails leaves the original where it was.
- **Backups** (`.canvast`, plain-files ZIP) read folder files after their last database read (an IndexedDB transaction does not survive a wait on a file). A `.canvast` export stops with a plain message when a file is missing, so a backup never omits an original; the plain-files ZIP counts it as missing, as for a cleared store. Archive import still stores originals in the browser; *Move browser files into the folder* then moves them.
- **GC** removes the file with the original (after the transaction commits). A leftover file is harmless.
- Thumbnails stay in the browser.

## Risks accepted

The folder is outside canvast's control: files moved, renamed or deleted there show as missing (importing the same file restores them). Backups stay the safety net; the README says to export one.

## Tests

`tests/unit/external-folder.test.ts` (write, verify, read, permission), `tests/e2e/library-folder.spec.ts` (Chromium; the native picker cannot be driven, so a stand-in directory with the same interface is attached through the debug hook): import, reload, backup, a file gone, re-import, moves both ways, GC.

## Where it lives in the interface

Settings > Storage is the one place for all of it, in four cards: **Space** (used, available, whether the browser keeps the data), **Library folder**, **Saving** (state, last verified save, this tab's role) and **Backup**. The save indicator opens it; the popover it used to open is gone (it repeated Space and Backup). "Choose another folder" and "Stop using this folder" are off while files are in the folder (they would show as missing); *Move files back into the browser* comes first.

## The library index and starting from scratch

- **Library index (manual):** *Save library index to the folder* writes `.canvast-index` (hidden; `canvast-library.canvast` in the first version, not read any more) in the folder: a workspace archive with every original listed and none carried (`noBytes`, `libraryFile: true` in the manifest; it does not count as a backup). *Choose library folder* offers it at once when the chosen folder holds one; *Open library index from the folder* does the same later. It reads the file and matches each listed original with the file of the folder that has its hash (the size must agree), then imports as any archive does (boards and canvases are added, nothing replaced, tags and folders merged), storing stubs for the matched files. An original whose file is not in the folder is reported and shows as missing. The index is also kept up to date by itself (`storage/auto-index.ts`): about 20 seconds after the last change (a commit, an import, a move of files, a setting), at most once a minute, not by a read-only tab, only when something changed; a checkbox on the card (setting `storage.autoIndex`, on by default) turns it off, and a failure is said once. Two devices writing the file at once is not handled: the last save wins.
- **Start from scratch** (Settings > Storage): a warning dialog that says what goes, offers what to do first (a full backup, the files as a ZIP, the library index when a folder is in use; each button runs in the dialog and ticks off), a plain note that the folder's files are never touched, and a word to type. (A first version had a checkbox to delete the folder's files too; it was removed the day it was made after it deleted a user's originals: nothing outside the browser is deleted in bulk.) Then the database (and any `canvast*` database) is deleted after this tab closes its connection (other tabs are told to close theirs), canvast's own `localStorage` keys are removed (not other pages': a `file://` origin is shared) and the page reloads.
- **A library index is not a backup:** the manifest says `libraryFile: true`. A library index picked through *Import archive* is refused ("a library index, not a backup: choose the library folder and open it there"); a backup is refused by the folder's open. The open dialog says what the file is. The old name is not read: the first version was never released, and a second name would only add clutter.
