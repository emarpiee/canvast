# ADR 0008 — Portable archives: export, verification and import

- Status: accepted (Phase 1, slice 3)
- Date: 2026-10-13
- Builds on [ADR 0006](0006-workspace-storage.md) and [ADR 0007](0007-asset-catalog-and-gc.md)

## Context

Browser storage is not a backup. It belongs to one browser profile, and
clearing site data deletes it. Until now the storage panel could only say
"Exported backup: none". The spec requires:

- four export scopes: selected assets, one canvas, one board, the whole
  workspace;
- each narrower export closes over what it references, with every original
  stored once;
- versioned manifests, checksums and verification after writing;
- import that treats the file as untrusted, deduplicates, resolves
  collisions deliberately, and is transactional;
- honest limits for very large archives.

## Decision

### Container: ZIP, store method only

A `.canvast` file is an ordinary ZIP archive, so any unzip tool can open it.
Both `unzip -t` and Python's `zipfile` validate archives written by
`src/storage/zip.ts`.

Entries are **stored, not compressed**:
- originals are already-compressed media;
- storing lets export compose the archive from the original Blobs without
  copying them into memory;
- import reads each entry as a slice of the file.

Every entry carries a CRC-32.

| Path | Contents |
| --- | --- |
| `manifest.json` | `format: "canvast-archive"`, `version: 1`, app version, `exportedAt`, `scope`, workspace name, boards → canvases (name, object count, file), assets (hash, name, type, size, pixel size, import time, file), `missingAssets` |
| `canvases/<id>.json` | `{ objects: SerializedObject[], view: SerializedCamera \| null }`: the same canonical object serialization the database stores |
| `assets/<sha256>` | the original bytes, exactly once per hash |

### Export

1. Flush pending saves and the camera.
2. Read one consistent snapshot in **one read-only transaction**.
3. Close over references:

   | Scope | Includes |
   | --- | --- |
   | Workspace | Every board and canvas, plus every active library asset (unused ones too) |
   | Board | That board's canvases and the originals their images use |
   | Canvas | That canvas (inside its board's name) and the originals it uses |
   | Assets | The chosen originals; no canvases |

   Originals referenced but not stored are listed in `missingAssets`, and
   the user is told.
4. Write the ZIP, then **verify it before download**: re-read the
   directory, check every entry's CRC, and compare the manifest.
5. Hand it to the browser as a download.
6. A full (workspace) export from the writer tab records `meta["backup"]`:
   time, file name, size and counts. The storage panel shows this as **Last
   full backup** and says plainly that the browser does not report whether
   the download finished.

### Import

Import has two phases. Nothing is written until the user confirms.

**1. `readArchive` validates the whole file**, writing nothing:
- The ZIP structure is bounds-checked. Only stored, unencrypted entries are
  accepted, names must be valid UTF-8, and duplicate names are rejected.
- `format` and `version` are checked. A newer version is refused with "update
  canvast".
- Canvas JSON must pass its CRC and be at most 1 GiB. Every object is
  validated with the normal deserializer: damaged or duplicate objects are
  skipped and listed. An invalid saved view is dropped and listed.
- Each original must have a valid hash, an `image/*` type, at most 256 MiB,
  and positive pixel sizes. **Its SHA-256 must equal its hash**; otherwise it
  is skipped and listed, and its instances become missing placeholders.
- Instances whose original is in neither the archive nor the library are
  reported.

Fatal problems (not an archive, wrong format, newer version, a manifest
naming a file that is absent) refuse the import outright.

**2. Confirmation** shows when and where the archive was made, what it
contains, where it will go, and every problem found. This also serves as a
way to check a saved backup file: open it, read the summary, and cancel.

**3. `applyImport` writes everything in one readwrite transaction**: all or
nothing.

| Scope | Lands as |
| --- | --- |
| Workspace / board | New boards appended to the workspace |
| Canvas | A new canvas on the open board |
| Assets | Library entries only |

Collision rules:
- Boards and canvases always get **new ids**, so importing the same archive
  twice adds a second copy and never overwrites.
- Object ids are kept; they are namespaced per canvas.
- Originals are deduplicated by hash. Bytes already stored are not
  rewritten, and a deleted catalog entry is reactivated.

The app then opens the first imported canvas.

Import is available from the storage panel and by dropping a `.canvast`
file on the page. Read-only tabs can export but not import.

### Canonical numbers

A placement at zoom level 0 produced `unit: -0`. IndexedDB keeps `-0`, but
JSON writes `0`. `serializeObject` now writes `unit + 0`, so the stored and
archived forms are identical; the round-trip test found this.

## Consequences

- There is a real backup path, and the storage panel reports it honestly.
- **Export memory:** the archive Blob is composed from stored Blobs and
  small headers; CRCs are computed by streaming. Only canvas JSON is built
  as strings.
- **Import memory:** one original at a time (at most 256 MiB, to hash it)
  plus one canvas's JSON.

## Limits and deferred work

- **Size: no ZIP64**, so an archive holds at most 4 GiB and 65,535 entries.
  Export refuses beyond that with a clear message.
- **Chunked or multi-part archives** for workspaces of tens or hundreds of
  gigabytes are not supported. Browsers cannot always stream to a
  user-chosen file, and this version builds the archive as a Blob.
- **Incremental backups** are not supported; every archive is
  self-contained.
- **Import is not cancellable** once confirmed. It is one transaction, so an
  interrupted import (a closed tab or a quota error) leaves nothing behind.
- **Archives compressed by other tools** are refused. Re-zipping a
  `.canvast` with compression makes it unreadable here; unzip it and use the
  original file.
- **Not included yet:** undo history, settings, tags and folders. These
  will be added to the format when they exist; `version` will then increase,
  with a migration for version-1 archives.
