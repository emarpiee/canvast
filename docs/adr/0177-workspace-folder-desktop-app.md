# ADR 0177 — The workspace as a folder on disk, in a desktop app

- Status: **proposed** (2026-10-28), waiting for the owner's decision; nothing is built yet
- Would supersede: [ADR 0159](0159-library-folder.md) (library folder) in the desktop app; amends [ADR 0006](0006-workspace-storage.md)–[0008](0008-portable-archives.md) (storage, assets, archives) and [ADR 0175](0175-releases.md) (releases)

## Context

canvast keeps everything in the browser's IndexedDB. That has three limits:

- **Your work is not visible outside the app.** Boards, canvases and library files can only be reached through canvas, or through a `.canvast` backup. A sync tool, git or a file manager cannot see them.
- **The browser caps the storage.** The library folder (ADR 0159) lifts the cap for originals, but only in Chromium, needs a click every session, and its files must not be renamed or moved.
- **One browser profile only.** The data stays where the browser keeps it.

A desktop build can use the disk directly. The workspace becomes an ordinary folder, which the app opens.

## Decision

### Two builds, one app

| Build | Where the data lives | Engines |
|---|---|---|
| **Browser** (today's `canvast.html`) | IndexedDB, as now. Nothing changes for it | Chromium, Firefox |
| **Desktop** (Electron) | A **workspace folder** on disk. IndexedDB is only a cache that can be deleted and rebuilt from the folder | Chromium (bundled) |

- The desktop app loads the **same single-file build**. A small Electron main process opens the window. A preload script gives the page a narrow file API (read, write, list, rename, move, delete, watch) through `contextBridge`. It works only inside the open workspace folder, and the page never gets Node.
- The page is served from a custom `app://` protocol, not `file://`, so storage and permissions behave like a normal origin.
- The list of known workspaces (path, last opened) lives in the app's own config folder, not in any workspace.
- The app makes no network requests. `check:offline` still applies to the HTML. Auto-update is not part of this ADR.
- A storage adapter separates the app from where data lives: `IdbStore` (browser) and `FolderStore` (desktop) implement the same interface. Everything above it (document store, library, undo, garbage collection) is shared.

### What the workspace folder looks like

```
my_workspace/                      the workspace (any name, anywhere)
├── .canvast/                      app-owned (see "On-disk format")
│   ├── workspace.json             boards and canvases (order, names, paths), styles, locks
│   ├── library.json               library items and folders: names, tags, notes, fields, hash ↔ file
│   ├── settings.json              workspace settings (synced with the folder)
│   └── devices/<device id>.json   per device: open canvas, cameras, last backup
├── .hidden/                       app-owned: encrypted hidden library items
├── .trash/                        app-owned: deleted files, when that option is chosen
├── sketches/                      a board = a folder
│   ├── characters.cvst            a canvas = one file
│   └── backgrounds.cvst
├── references/
│   └── anatomy.cvst
└── library/                       yours to browse and edit
    ├── anatomy/                   library folders are real (nested) folders
    │   ├── sternocleidomastoid-form-michael_hampton-p93.png
    │   └── hand_study-loomis.jpg
    ├── images/  video/  audio/  fonts/  documents/  other/
    │                              items in no library folder, sorted by kind
    └── exports/  patterns/  shapes/  screenshots/
                                   from the existing folder settings of Export, Pattern, Shape, Screenshot
```

- **A dot in front means app-owned:** `.canvast/`, `.hidden/`, `.trash/` are not meant to be edited by hand. Board folders and `library/` are.
- **A canvas** is one `.cvst` file (JSON, the backup's canvas format with a header; see "On-disk format"). The `.canvas` extension is not used, because another app already uses it.
- **`.canvast`** stays what it is: a zipped backup or export of a whole workspace, a board or a canvas. It is never the live workspace.
- **Painting data** is not part of the layout. It was removed in v0.48.2.

### File and folder names

| Rule | Example |
|---|---|
| A library file is named after its **library name**, in the naming convention: lowercase, `_` joins the words of one part, `-` separates parts | `Hand Study (Loomis).JPG` → `hand_study-loomis.jpg` |
| The real extension is always kept, so other programs open the file | `.png`, `.mp4`, `.woff2` |
| Two **different** files with the same name get a number | `forest-dusk.webp`, `forest-dusk-2.webp` |
| The **same** file imported again makes no new file: it is one item, found by its SHA-256 (kept in the index). The second name is an alias | — |
| **Safe mapping** for library folder, board and canvas names: characters Windows forbids (`<>:"/\|?*`, control characters) are removed, reserved names (`CON`, `NUL`, `COM1`…) get a suffix, trailing dots and spaces are trimmed, length is capped. Clashes are compared case-insensitively | `Refs: Hands?` → `refs-hands` |
| The name you typed stays what the app shows; `workspace.json` / `library.json` keep it | — |
| Renaming or moving in the app renames or moves the file or folder. **Library undo** (50 steps) moves it back | — |
| Tags, notes, fields and the hidden flag are kept in `library.json`, never in names | — |

A library item is in at most one library folder (as today), so every item has exactly one place on disk.

### Hidden items are encrypted

The Hidden password today only stops the app from showing hidden items; nothing is encrypted. In a folder anyone can open, that is not enough, so in the desktop build:

- Hidden files move to `.hidden/` under random names, encrypted with **AES-GCM** (WebCrypto).
- A random **data key** encrypts the files. The password, stretched with PBKDF2 (high iteration count), **wraps the data key**. Changing the password re-wraps one key and does not re-encrypt every file.
- An item's name, hash, tags, note, fields and thumbnail are encrypted too, so nothing readable about a hidden item is left on disk.
- **Lost password = lost files.** The app says so in plain words when the password is set, and offers a backup.
- Hiding encrypts and moves the file; showing it decrypts and moves it back into `library/`.

### Deleting

A setting with three choices, applied only once the reference-checked garbage collection says undo can no longer need the original:

| Choice | What happens |
|---|---|
| **Move to `.trash/`** in the workspace | Recoverable on every device the folder syncs to |
| **Move to the system trash** | Electron `shell.trashItem` |
| **Delete permanently** | Gone |

A file deleted outside the app shows as missing, with its usage (the existing missing-original flow), and importing it again restores it.

### Saving

Today each object is saved as its own record. A canvas file must be written whole:

- Write `characters.cvst.tmp`, read it back and check it, then **rename it over** the old file. A rename cannot half-happen, so a crash or power loss leaves the old file or the new one, never a broken one.
- Writes wait for a pause in editing (the 150 ms debounce stays). If very large canvases turn out to be slow to write, a canvas becomes a folder of chunk files later. Not part of this ADR.
- The save indicator keeps its states (*Unsaved → Saving → Saved → Saved (verified)*).

### Changes from outside the app

The app watches the workspace folder (Node `fs.watch`) and reconciles:

| Outside the app, you… | canvast… |
|---|---|
| Rename or move a library file | Sees one file gone and a new one with the same hash, and relinks it. Canvases are not touched |
| Drop a new file into `library/…` | Imports it into the library folder it was dropped in |
| Delete a library file | Shows it as missing with its usage |
| Rename a board folder or a `.cvst` file | Shows the new name |
| Change a `.cvst` (sync from another device) while it is closed | Loads the new version next time |
| Change a `.cvst` while it is open, with no unsaved edits here | Reloads it, keeping the camera |
| Change a `.cvst` while it is open, **with** unsaved edits here | Keeps both: writes this device's version as `characters (conflict 2026-10-28 1412).cvst` and says so |

Within one device, the writer lease keeps one window as the writer, as it does for tabs today.

### Moving in from the browser

- **Browser storage → workspace folder:** a one-time move that writes every board, canvas and library file into a new folder, then verifies by reading everything back. The browser's copy is kept until you delete it.
- **The old library folder and `.canvast-index`** (ADR 0159): read on the move, then not used by the desktop build. The browser build keeps them.
- **`.canvast` backups** import into a workspace folder the same way they import into the browser.

### Tests and releases

- Storage specs run against both adapters. The desktop build gets a Playwright project (`_electron.launch`).
- Firefox keeps the browser build. The desktop build is Chromium only.
- Releases (ADR 0175) add a desktop package (a Linux AppImage first; other platforms later) next to `canvast.html`, built from the same commit.

## On-disk format (step 3; review points A–F approved by the owner, 2026-10-28)

### Files and what each holds

| File | Holds | Written by | Synced between devices |
|---|---|---|---|
| `<board>/<canvas>.cvst` | One canvas: its objects, nested frames and bookmarks | The app, whole file, safe write | Yes |
| `.canvast/workspace.json` | The workspace: its name and view ground, the boards and canvases in order with their names, ids and paths, the saved styles, the password locks | The app | Yes |
| `.canvast/library.json` | The library: every item (hash, file path, name, type, size, pixels, import date, tags, favourite, library folder, note, fields, deleted or not) and the library folders | The app | Yes |
| `.canvast/devices/<device id>.json` | What belongs to one device: the open board and canvas, each canvas's camera, the last backup made there | Only that device | Synced, but each device writes only its own file, so they never clash |
| `.canvast/settings.json` | Settings of the workspace itself (when ADR 0017's workspace scope gets settings; empty at first) | The app | Yes |
| `library/…` | The originals, as readable files | The app, or you | Yes |
| `.hidden/`, `.trash/` | Step 4 and step 5 | The app | Yes |

The device settings (theme, shortcuts, panels) stay in the app, per device, as today, and travel in backups as today.

### A canvas file (`.cvst`)

The same JSON a `.canvast` backup already writes for a canvas (`canvases/<id>.json`), with a header, so one writer and one reader serve both:

```json
{
  "format": "canvast-canvas",
  "version": 1,
  "id": "3f9a…",
  "revision": 42,
  "savedAt": "2026-10-28T14:12:05Z",
  "savedBy": "d7c1…",
  "objects": [ { "id": "…", "kind": "stroke", "ax": "75p1", "ay": "0p0", "…": "…" } ],
  "frames": [ { "id": "…", "parent": null, "n": "…", "ox": "…", "oy": "…", "level": "…" } ],
  "bookmarks": [ { "…": "…" } ]
}
```

- Exact coordinates are already strings in the stored form (`"75p1"` = 75·2¹), so nothing is lost and JSON needs no BigInt.
- The **name** is not in the file: the file name is the canvas's safe name, and `workspace.json` keeps the name as typed. The **id** is in the file, so a canvas renamed or moved in the file manager is still recognised.
- The **camera** is per device, so it lives in the device file, not here.

### `workspace.json`

```json
{
  "format": "canvast-workspace",
  "version": 1,
  "id": "a1b2…",
  "name": "My workspace",
  "viewGround": "checker",
  "boards": [
    { "id": "…", "name": "Sketches", "folder": "sketches",
      "canvases": [ { "id": "…", "name": "Characters", "file": "sketches/characters.cvst" } ] }
  ],
  "styles": [ "…" ],
  "locks": { "hidden": "pbkdf2$…", "workspace": "pbkdf2$…" }
}
```

- Order of boards and canvases is the order in this file.
- Locks are the salted PBKDF2 form used today (never the password). The hidden lock also unlocks the encrypted hidden items in step 4.

### `library.json`

```json
{
  "format": "canvast-library",
  "version": 1,
  "folders": [ { "id": "…", "name": "Anatomy", "parentId": null } ],
  "items": [
    { "hash": "3f9a…", "file": "library/anatomy/hand_study-loomis.jpg", "name": "Hand Study (Loomis).jpg",
      "type": "image/jpeg", "size": 48213, "pixelW": 1200, "pixelH": 900, "importedAt": 1793142570297,
      "tags": ["hands"], "favorite": false, "folderId": "…", "note": "", "fields": [], "state": "active" }
  ]
}
```

- **Library folders are real folders:** an item's file is under `library/<its folder path>/`, each part a safe name. Filing an item in another folder moves the file; renaming the item renames it; undo moves it back. An item in no folder is under `library/<kind>/`. A library folder whose safe name is the same as a kind folder (`Images` → `images`) shares that folder on disk; the index still knows which item is in which.
- Items are found by **hash**, so a file renamed or moved outside the app is matched again (step 5).

### Names on disk

Board folders, canvas files and library folders use the same safe naming as library files (`workspace-names.ts`: the naming convention, forbidden characters and reserved names removed, `-2` on a clash compared without case). Renaming a board or canvas in the app renames its folder or file. The name as typed is kept in `workspace.json` / `library.json` and is what the app shows.

### Saving and the cache

- Each edit is first committed to **IndexedDB, as today** (the same revision-checked, per-object, read-back-verified commit). There it is safe within a fraction of a second.
- IndexedDB is now the **journal and the cache**: a canvas's file is written from it **about 2 seconds after editing pauses** (and at once when the canvas is closed, the app quits, or a backup is made), as one safe write: temporary file, flushed, renamed over the old one. Rewriting a canvas of 100,000 objects on every stroke would be too slow; this way every stroke is still saved at once, and the file follows shortly.
- At start-up the app compares each canvas's file with the cache: a file newer than the cache (written by another device, through sync) replaces the cache; a cache newer than the file (the app was closed before the file was written) is written to the file. Deleting the cache loses nothing that a file has.
- **Conflicts:** if a canvas's file changed on disk (its `revision`/`savedBy` is not what this device last wrote) while this device has edits not yet in the file, the app writes this device's version beside it as `characters (conflict 2026-10-28 1412).cvst`, adds it as a canvas, and says so. Nothing is overwritten.
- `workspace.json` and `library.json` are written the same way, shortly after each change.

### Moving in from the browser

The move uses the existing backup format: in the browser build, **Export a full backup** (`.canvast`); in the desktop app, **Import backup** into a workspace folder. The import writes the boards, canvases and library into the folder through the same code as any import. No second migration path to maintain. The old library folder's files are read by that import too (it already reads them for a backup made with a library folder).

### Review points (all approved as proposed, 2026-10-28)

| # | Point | Proposed |
|---|---|---|
| A | Bookmarks are stored in the canvas file (they belong to a canvas, like today), not in a separate `bookmarks.json` | In the `.cvst` |
| B | Cameras and the open canvas are per device (`.canvast/devices/<id>.json`), so two devices do not move each other's view | Per device |
| C | The file of a canvas is written about 2 s after editing pauses; every edit is still saved at once in the app's journal | 2 s |
| D | A conflict keeps both versions as two canvases (`… (conflict <date>).cvst`) | Keep both |
| E | Moving in from the browser = export a full backup there, import it in the desktop app | Through a backup |
| F | A library folder named like a kind folder (`Images`) shares `library/images/` | Share |

## Hidden items: the design (step 4; owner's answers 2026-10-28)

The browser build keeps the Hidden password as a gate, as today. In the desktop build hidden means encrypted.

### Owner's answers

| # | Question | Answer |
|---|---|---|
| G | Hiding when no Hidden password is set | **A password is asked for first** (with the "lost password = lost files" warning and the offer of a backup); hidden always means encrypted |
| H | A hidden picture on a canvas while the Hidden items are locked | **A locked placeholder** until the password is given; once given, the key stays in memory until the app closes, or until **Lock hidden items** |
| I | How far encryption reaches | **No readable picture anywhere:** in the workspace folder the bytes, names, tags, notes and fields are encrypted; in the app's own cache on the device the originals and thumbnails of hidden items are never kept readable (they are read from `.hidden/` and decrypted in memory), while their names and tags stay there so search and the Hidden list work as today |

### Keys

- A random 256-bit **data key** (AES-GCM) encrypts the files and the index.
- The password, stretched with **PBKDF2-SHA-256, 600,000 iterations**, 16-byte random salt, gives a **key-encryption key** that wraps the data key (**AES-KW**). A wrong password fails to unwrap, so the unwrap is also the check.
- Changing the password unwraps with the old one and wraps the same data key with the new one: no file is encrypted again.
- Removing the Hidden password is refused while there are hidden items ("show them first"), since hidden means encrypted.
- `locks.hidden` in `workspace.json` stays (the gate's PBKDF2 form, for the browser build and backups).

### Files

| File | Holds |
|---|---|
| `.canvast/hidden.json` | `{"format":"canvast-hidden","version":1,"kdf":{"name":"PBKDF2","hash":"SHA-256","iterations":600000,"salt":"…"},"key":"<wrapped data key>","index":{"iv":"…","data":"…"}}`. The index is the hidden items' `library.json` entries (hash, name, tags, note, fields, folder, which `.hidden/` file), encrypted with the data key |
| `.hidden/<32 random hex>.bin` | One hidden original: a 12-byte IV, then the AES-GCM ciphertext of its bytes (16-byte tag at the end). The name says nothing about the item |

- `library.json` leaves hidden items out entirely; they are only in the encrypted index.
- **Hiding** encrypts the file into `.hidden/`, reads it back and decrypts it to prove it, then **erases** the readable file (never into `.trash/`, which would keep a readable copy). **Showing** decrypts it back to its place in `library/` and erases the `.hidden/` file.
- Thumbnails of hidden items are made in memory only, never stored.
- Another device reads the encrypted index when the password is given there (until then, it does not know the hidden items, and pictures that use them show as missing).
- Erasing deletes the file; it does not overwrite the disk blocks. Limitations say so.

## Order of work

Each step ends in a working app and is committed and released on its own.

| Step | Work | Ends with |
|---|---|---|
| 1 | **Storage adapter:** IndexedDB behind one interface; no change in behaviour | Browser build unchanged; storage specs green in both browsers. **Done:** `src/storage/store.ts` (WorkspaceStore, BackupStore, CatalogStore, OriginalStore, LibraryFolderStore, Storage), `idb-storage.ts`, `check:storage` |
| 2 | **Desktop shell:** Electron main, preload file API, `app://`, workspace picker and list; library files through a `FolderStore` | The desktop app runs the current build; library files land in `library/` with readable names. **Done:** `desktop/` (main, preload), `scripts/build-desktop.mjs`, `src/storage/desktop-storage.ts`, `workspace-names.ts`; `desktop.spec.ts` |
| 3 | **Workspace format:** boards as folders, `.cvst` canvases, `.canvast/workspace.json` and `library.json`, IndexedDB as journal and cache, safe-write saving, the move from browser storage | A whole workspace lives in a folder and survives restart, move and copy. **Done:** `canvas-file.ts` (one canvas codec with backups), `workspace-mirror.ts` (boards, canvases, device files, start-up reconcile and conflict copies), `library-mirror.ts` (library folders as real folders, `library.json`, originals from an imported backup written as files); `desktop.spec.ts` |
| 4 | **Encrypted hidden items** | `.hidden/` files unreadable without the password; password change re-wraps the key |
| 5 | **Delete options and outside changes:** trash setting, file watching, relinking, conflict copies | The table above works with real file-manager actions |
| 6 | **Releases:** the AppImage in the release pipeline; README, Limitations and this ADR accepted | A release carries the HTML and the desktop package |

## Owner's answers (2026-10-28)

| # | Question | Answer |
|---|---|---|
| 1 | Canvas file extension | **`.cvst`** |
| 2 | Default delete choice | **`.trash/`** in the workspace (system trash and delete permanently stay as settings) |
| 3 | The workspace password (asked when the app opens) | **Only locks the app**; it is not encryption, and the app says so. Only hidden items are encrypted |
| 4 | Electron or Tauri | **Electron** |
| 5 | First desktop package | **Linux AppImage**; other platforms later |
| 6 | Should the browser build in Chromium also open a workspace folder? | **No.** The browser build keeps working as it does today (IndexedDB). The two builds share one codebase: everything above the storage adapter is the same code, so a fix lands in both (no copies of logic per build) |
| 7 | Canvas previews in the file manager | **None.** What the app makes for itself (thumbnails, caches, previews) stays only in the dot folders; a `.cvst` holds the canvas and nothing else |

## Consequences

- Your work is plain files: browsable, syncable with any tool, and not capped by the browser.
- Two storage backends to keep working and tested.
- A desktop package of about 100 MB or more per platform, next to the 2 MB HTML file.
- The desktop build has no Firefox; the browser build keeps it.
- Hidden items are protected for real in the desktop build; a lost password cannot be recovered.
