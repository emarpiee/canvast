# ADR 0177 — The workspace as a folder on disk, in a desktop app

- Status: **accepted** (2026-10-28): the owner approved the proposal and the on-disk format; steps 1 to 6 are built on branch `workspace-folder`
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
│   ├── devices/<device id>.json   per device: open canvas, cameras, last backup
│   └── boards/                    the boards (app-owned: out of the way, not edited by hand)
│       ├── sketches/              a board = a folder
│       │   ├── characters.cvst    a canvas = one file
│       │   └── backgrounds.cvst
│       └── references/
│           └── anatomy.cvst
├── .hidden/                       app-owned: encrypted hidden library items
├── .trash/                        app-owned: deleted files, when that option is chosen
└── library/                       yours to browse and edit
    ├── anatomy/                   library folders are real (nested) folders
    │   ├── sternocleidomastoid-form-michael_hampton-p93.png
    │   └── hand_study-loomis.jpg
    ├── images/  video/  audio/  fonts/  documents/  other/
    │                              items in no library folder, sorted by kind
    └── exports/  patterns/  shapes/  screenshots/
                                   from the existing folder settings of Export, Pattern, Shape, Screenshot
```

- **A dot in front means app-owned:** `.canvast/` (with the boards and canvases in `.canvast/boards/`), `.hidden/`, `.trash/` are not meant to be edited by hand. `library/` is yours. (The boards were first proposed at the top of the folder; the owner moved them into `.canvast/boards/` on 2026-10-28, before the first release, so a canvas file is not edited or renamed by accident. A workspace written with them at the top is moved in when it is opened.)
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
| Rename a board folder or a `.cvst` file (in `.canvast/boards/`) | Shows the new name |
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
| `.canvast/boards/<board>/<canvas>.cvst` | One canvas: its objects, nested frames and bookmarks | The app, whole file, safe write | Yes |
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
      "canvases": [ { "id": "…", "name": "Characters", "file": ".canvast/boards/sketches/characters.cvst" } ] }
  ],
  "styles": [ "…" ],
  "locks": { "hidden": "pbkdf2$…", "workspace": "pbkdf2$…" }
}
```

- Order of boards and canvases is the order in this file.
- Locks are the salted PBKDF2 form used today (never the password). The hidden lock also unlocks the encrypted hidden items in step 4.

### `library.json`

(Kept in parts in `.canvast/library/` since v0.50.44, with `library.json` as a copy for older versions: see [ADR 0179](0179-library-in-parts.md).)

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

### Hidden items and sync tools (0.50.47)

A sync tool (Mega, Drive, Proton Drive, Syncthing…) keeps one `hidden.json` when two devices wrote it at once, and puts the other beside it under another name, or keeps only the last. Without care, the items of the other copy lose their entries, so their `.hidden/` files can no longer be opened from the app. What the app does:

- **Copies of `hidden.json`** (`.canvast/hidden*.json`): read into the index with each read while the Hidden items are open, and erased once the index holding their items is written. A copy that holds another key (two devices set a first password at the same time) is joined when the password given opens it too: its files are sealed again with this key, read back, and only then is the copy erased. One that does not open is left, and the person is told.
- **A key check** (`check`: a known text sealed with the data key) tells whether a vault holds the key in memory without the password. The index is never written into a `hidden.json` that holds another key: this device's record goes beside it as `hidden (this device …).json`, to be joined as above.
- **An index the key does not open** (another key, damaged) is not whole: no hidden item is taken as erased elsewhere because it is missing from it.
- **Sealed files no entry names** (`<32 hex>*.bin`): a copy of a file an item has is erased (it is sealed, so nothing readable goes); any other comes back as a hidden item `recovered-<hash>.<ext>`, renamed to a hidden file's name first. A file of a hidden file's name waits 30 s with no entry before that (its entry may be on its way). A file the key opens is never sealed again, whatever its name.
- **A first password** is refused while `.hidden/` holds sealed files or a copy of `hidden.json` is there but `hidden.json` is not (it is on its way): a new key would be a second one.
- `scripts/hidden-items.mjs decrypt` reads the copies too, and writes files no entry names as `recovered-<hash>.<ext>`.

### The key in memory, its spare, and an interrupted seal (0.50.51)

- The data key is imported **not extractable**: no code in the page can export it. A new password is wrapped by unwrapping the key again with the current password (so changing it asks for that), never by exporting the key in memory. Keys are compared by sealing with one and opening with the other.
- **A spare of the key**, `.canvast/keys/hidden.json` (format, kdf, wrapped key, check; no index), is written whenever the vault's key or password changes, and at unlock when it is missing. With `hidden.json` lost or damaged, the vault is read from the spare: its index is not known, so nothing missing from it counts as shown or erased, and the index is written again whole from this device. A first password is refused while `hidden.json` is there but damaged and there is no spare (a new key would orphan the files). Removing the password erases both.
- **An interrupted seal** (the move noted, the sealed file there, its readable source still there) is proven at start-up by opening it; unproven, or while the key is locked, the sealed file is erased and the readable one stays, to be sealed again. Before, the sealed file was trusted.
- Sealing reports its own progress (`encrypting`), shown as *Encrypting N of M files* from five files.

### The library in SQLite (0.51.0)

IndexedDB could not open a library of a million items: taking it in from the part files put two records per item in the page's storage, about 120 µs each (233 s for a million on a GitHub runner, then a second pass; writing it in chunks of 5,000 per transaction was no faster), and the page never got to the library list in 30 minutes. An experiment (branch `experiment/sqlite-index`) loaded the same parts into SQLite in 15 s.

- **Where.** The desktop app keeps the library's entries and the records of its files (the browser build's `assetCatalog` and `assets` stores, never bytes), a seen mark per item (the fingerprint of its line as last read or written, replacing `libraryMirror`'s per-part state), each part's fingerprint, and the library's own values (folders, blanked names, moves in progress, the copies of a backup to take without waiting) in a SQLite database: `better-sqlite3` (the SQLite C library as a Node module; its ready-made N-API binary loads in Electron with no rebuild) in the main process, one file per workspace under the app's data folder (`library-db/<sha256 of the path>.sqlite`), WAL with `synchronous = NORMAL`.
- **The folder stays the truth.** The part files in `.canvast/library/` are what devices share; the database is this device's working copy, made again from them when it is missing (and emptied by *Rebuild from the folder*).
- **The main process reads and writes the parts.** `sync` reads only the parts whose text changed (by SHA-256), one transaction per part, with the rules of `adopt`: an item changed here since its last write keeps this device's version; an item gone from a part read whole was erased elsewhere. `write` makes each part's text from the database, writes only the ones that changed, then `index.json`, then removes the parts no item is in, and `library.json` up to 10,000 items. Start-up writes only the items changed here since their last write (`pending`), not the whole library.
- **The page** reaches the database through one IPC channel (`canvast:lib`): get, apply (puts and deletes in one transaction), sync, write, the lists as JSON text. What it sends is checked (kinds, hashes, values); it sends no SQL. Changes are made one after another in the page (`DesktopLibrary.serial`), the stand-in for an IndexedDB read-write transaction. `DesktopCatalog` and `DesktopOriginals` are `AssetCatalog` and `IdbOriginals` on it, operation for operation. The page's IndexedDB keeps the canvases, thumbnails, passwords and the bytes an import has not written out yet.
- **Backups.** An export reads the library from the database before its transaction starts (a call to the main process in the middle would end it); an import writes its entries and its files' records to the database after its transaction commits.
- **Moving in.** The first start of 0.51 on a device moves what its IndexedDB held of the library into the database (with its seen marks, so nothing it had not written to the folder is lost), then clears it there.
- **Hidden names off the device.** The database overwrites what it deletes (`secure_delete`) and empties its log once names are blanked.
- **Measured** (GitHub runner): 300,000 items, first open 24 s (55.9 s with IndexedDB), second open 3.1 s (9.2 s); a million, first open 112 s, second open 16 s. The Library view still receives the whole list (about 600 MB at a million); listing it in pages from the database is the next step.

### Versions and old trash (0.50.58)

`workspace.json` names the canvast that wrote it (`app`); a device with an older one says once that it should be updated (it may not keep what a newer one writes). Moving into `.trash/` keeps a file's own date, so the app dates what it puts there (the item and everything in a trashed folder); *Empty .trash after* (30, 90 or 365 days; never by default) erases at start-up what is older than that there, and the folders it empties.

### Start-up, and boards changed on two devices at once (0.50.57)

- **Start-up looks only at what changed**: the main process walks `library/` (folders read and files looked at many at a time, no limit; `canvast:tree` uses the same walk) and compares each file's size and modification time with the look kept for this workspace in the app's own folder (`library-looks/<sha256 of the path>.json`); the page looks only at those paths (`scanPaths`; all of `library/` when there is no look yet, a folder came, or there are many). The look is kept once the page says it has taken them (`libraryLookDone`).
- **Deletions are said, not inferred**: `workspace.json` carries `deleted`, the ids of canvases and boards deleted lately (180 days, at most 2,000). A device reading it deletes only those; a canvas the file lacks that is not in the list, has content and was made on this device is kept, with its board (its writer did not know of it yet: two devices wrote the boards at once). A file without the list (an earlier version) is read as before: what it lacks was deleted. And before writing `workspace.json`, a device whose last read is older than the file takes the other's boards in first.
- Found by the two-device desktop test failing about one run in three; it passed 11 runs in a row after.

### A big library: only what changed (0.50.56)

Measured with `scripts/bench-library.mjs` (100,000 files on a spinning disk): a rename took about 7 s to write, a file put in from outside 29 s to be listed, a first open on a new device 64 s, because each save read the whole library from the app's storage, rebuilt all parts and kept one record of every item, and each outside change listed every file (and the listing stopped at 200,000). Now:

- **256 parts** (`items-00` … `items-ff`, by the first two hex digits of the hash; index version 3, version 2's 16 still read). An older app finds no parts it knows in version 3: it reads `library.json` (kept up to 10,000 items) or nothing, and never takes the library as erased.
- **A save writes only what changed** in a library past `library.json`'s limit: catalog changes say which items (renames, metadata, deletions, an original stored); those items alone are read, placed and written, with their parts, each part read from the app's storage by its range of hashes. Changes that may touch many (folders, tags, showing an item again) write the whole library as before. This device's record of the library is kept per part (meta `libraryPart:<xx>`), and each part is remembered by its SHA-256, not its text.
- **An outside change is looked at alone**: the watcher's paths, each looked up through a new index of the stored originals by file path (IndexedDB version 13). A path with no file that no item names (a folder came or went: the watcher names only the folder) looks through all of `library/` as before; a file taken in where it lies still writes the whole library (needed for now; see status).
- **Sizes of the library's files are remembered** until the watcher says a file changed, so a listing does not ask for every file's size again.
- A first open on a new device reads what it has in two reads, not two per item.

Measured after (100,000): a rename's write 0.14 s, a file put in from outside listed in 4.4 s, a first open 38 s. Start-up still looks through the whole folder; that is next.

### Hidden folders, and hidden names off the device (0.50.55)

- **Hide folder**: a library folder gets `hidden: true`, with its subfolders, and every item in them is hidden. Lists show `visibleFolders` only; showing an item again shows its folder and those above it. The plain library index (and `library.json`) leaves hidden folders out; their list is sealed in `hidden.json` (`folders`, with the data key) and read back when the key is open (while locked, this device keeps its own as they were). Folder lists are compared in one order (by id), so the order two devices wrote them in is not a change. A hidden folder's real folder leaves `library/` (its items are in `.hidden/`).
- **Hidden names off this device** (Settings > Privacy, off by default): when the key is locked (after what waits is written) and at start-up, this device's cache blanks the name, tags, note and fields of each sealed hidden item, and hidden folders' names, and lists them; the sealed index holds them. When the key opens they are filled in again from it before anything else. While any is blank the index is not written and no file is sealed again, so a blank never reaches the folder.

### Hidden items in backups (0.50.54)

A desktop backup that includes hidden items (archive version 7) carries each sealed file as it is (`sealed/<hash>.bin`, listed in the manifest's `sealed` by hash only: its name and the rest are inside it) and the key file (`hidden-key.json`, the spare's form). Nothing readable of a hidden item is in the backup; its hash can only be checked once it is opened. Importing it in the desktop app writes each file into `.hidden/` (unless the library has its item) and the key file: as the vault when there is none, else beside `hidden.json` as a copy, joined when one password opens both (its files sealed again with this key, the "Hidden items and sync tools" path). The files are taken in from what they hold when the Hidden items are opened, without the 30 s wait (a list in the app's storage says no entry is on its way; after *Rebuild from the folder* it is gone and the wait applies). The browser build leaves them out and says so. Older versions refuse a version 7 file (they say to update).

### Hidden files that stand on their own (0.50.53)

A hidden file of version 2 holds its item (name, type, size, folder as a path of names, tags, note, fields) in a sealed header, then its bytes in 1 MiB chunks sealed on their own with STREAM nonces (a 7-byte random prefix from the header, the chunk number, a last-chunk flag): a cut, reordered, swapped or changed chunk fails, and a file is never sealed as one piece (the way to files of any size). With the key file and the password, any one `.hidden/` file is a whole item: a file whose entry is lost comes back with its name, folder and tags; `hidden-items.mjs` names files from it. The index in `hidden.json` stays the fast list (and holds later changes); a change made on this device to a hidden item seals its file again, so the header never says less. Version 1 files are read, and sealed again as version 2 after the password is given (each read back and opened first), shown as encrypting. The header is sealed with the magic as associated data; the prefix only travels inside it, so a header moved onto another file's chunks does not open them.

### scrypt for the Hidden password (0.50.52)

- The vault's password is stretched with **scrypt** (RFC 7914; N = 2^17, r = 8, p = 1: 128 MiB per guess, about 0.7 s), natively in the main process (`canvast:scrypt`, which only accepts the ranges a vault may name). Argon2id was the first choice, but Electron's crypto (BoringSSL) has no Argon2, and one written in JavaScript would be slow enough to force weaker settings than native scrypt. Vault version 2 names `kdf: { name: "scrypt", N, r, p, salt }`; version 1 (PBKDF2) is still read, and wrapped again with scrypt when it is opened (the same key: no file changes). `hidden-items.mjs` needs only Node.js 20 for both.
- The Hidden password's gate (`locks.hidden`, PBKDF2) is no longer written to `workspace.json`: in a synced file it would let the password be guessed far more cheaply than through the vault. The desktop app checks the Hidden password with the vault; this device's own gate stays in its cache.

### A canvas file that does not read (0.50.50)

At start-up and on each look at the folder, a canvas file whose header says it changed is read whole before it is taken. One that does not read (damaged, or a sync tool still writing it) is skipped: this device's copy stays and is shown, the person is told once, and the file is read again when it changes. It is never written over (it may be another device's newer version, still arriving); deleting it lets this device's version be written again. Before 0.50.50 such a file stopped the workspace from opening.

### Library and boards and sync tools (0.50.49)

Copies a sync tool keeps of `workspace.json`, of the library's parts and index, and of `library.json` are joined by id: what is in a copy and this device never knew (a canvas whose file is there, a library item, a library folder) was added on the other device, and is taken; what this device knew and the kept file lacks was deleted there, and stays deleted. The kept `workspace.json` is written with the added canvases before the copy goes (a look at the folder in between would otherwise find them gone and delete them); library items go into the app's storage first. Copies then go where deleted files go. Field-level edits in a copy (a name or a tag changed on both devices) are not joined: the kept file's stay.

### Canvas files and sync tools (0.50.48)

A sync tool's copy of a canvas file (`<name> (1).cvst` and the like) has the id of a canvas whose own file is still there, so it is neither a rename nor a new canvas. Its version (another device's edits that the canvas's file lost) becomes a canvas of its own, `<name> (conflict from sync <date>)`, with new object ids as a duplicate has, and the copy goes where deleted files go. Only the device named in its `savedBy` takes it at once; another waits 10 minutes (that device may be gone), so two running devices do not both take it. A copy with the same revision and `savedBy` as the canvas's file only goes; one that does not read whole (still arriving) waits.

## Order of work

Each step ends in a working app and is committed and released on its own.

| Step | Work | Ends with |
|---|---|---|
| 1 | **Storage adapter:** IndexedDB behind one interface; no change in behaviour | Browser build unchanged; storage specs green in both browsers. **Done:** `src/storage/store.ts` (WorkspaceStore, BackupStore, CatalogStore, OriginalStore, LibraryFolderStore, Storage), `idb-storage.ts`, `check:storage` |
| 2 | **Desktop shell:** Electron main, preload file API, `app://`, workspace picker and list; library files through a `FolderStore` | The desktop app runs the current build; library files land in `library/` with readable names. **Done:** `desktop/` (main, preload), `scripts/build-desktop.mjs`, `src/storage/desktop-storage.ts`, `workspace-names.ts`; `desktop.spec.ts` |
| 3 | **Workspace format:** boards as folders, `.cvst` canvases, `.canvast/workspace.json` and `library.json`, IndexedDB as journal and cache, safe-write saving, the move from browser storage | A whole workspace lives in a folder and survives restart, move and copy. **Done:** `canvas-file.ts` (one canvas codec with backups), `workspace-mirror.ts` (boards, canvases, device files, start-up reconcile and conflict copies), `library-mirror.ts` (library folders as real folders, `library.json`, originals from an imported backup written as files); `desktop.spec.ts` |
| 4 | **Encrypted hidden items** | `.hidden/` files unreadable without the password; password change re-wraps the key. **Done:** `hidden-vault.ts` (keys, sealing), `hidden-store.ts` (`Storage.hidden`), sealing and opening in `library-mirror.ts`, padlock and *Lock hidden items*; `desktop.spec.ts` |
| 5 | **Delete options and outside changes:** trash setting, file watching, relinking, conflict copies | The table above works with real file-manager actions. **Done:** `storage.deleteTo` and `bridge.remove(path, how)`; `LibraryMirror.scan` (relink by hash, import in place); `fs.watch` in the main process, `WorkspaceMirror.recheck` and `followMoved`, a canvas never written over another device's version; `desktop.spec.ts`. Not done: a `.cvst` dropped in from elsewhere (an id the workspace does not have) is left alone |
| 6 | **Releases:** the AppImage in the release pipeline; README, Limitations and this ADR accepted | A release carries the HTML and the desktop package. **Done:** `scripts/package-desktop.mjs` (electron-builder 26.17.0, pinned; the tested Electron; the AppImage must start and write a workspace folder), `release.mjs` uploads it with its SHA-256 and names it in the notes; README "The desktop app (Linux)" |

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
