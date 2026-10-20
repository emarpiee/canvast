# ADR 0159: the library folder: originals kept as files outside the browser's storage

- Status: accepted (2026-10-20, owner's request)
- Related: ADR 0006 to 0008 (storage, catalog, GC), ADR 0155 (update-safe origin)

## Decision

In Chromium the person can pick a **library folder** (storage panel, File System Access API). New originals are written there as files named by their SHA-256 and the browser keeps a **stub** of each. The folder has no quota. Elsewhere (Firefox has no directory picker) nothing changes and the README says so.

Also, for every browser: a full store is reported in plain words (an import is refused, nothing half-stored), the browser is asked once to keep the data (`storage.persist()`), and one notice appears at 80% of the quota (`src/storage/quota.ts`).

## How it works

- A **stub** is the asset's own record in the `assets` store with an empty `blob` and `ext: 1`; `size` is the file's size. Because the key stays, every key-based rule (present, usage, catalog repair, reference-checked GC, the import's "already have it") is unchanged. Schema v10 only adds an index `ext` on that store, to list the stubs. Nothing is converted on upgrade.
- **Write order:** the file is written, read back and its SHA-256 compared with the name; only then is the stub stored. If the folder cannot be written the import is refused with the reason; it never falls back silently, and a file is never in neither place.
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
