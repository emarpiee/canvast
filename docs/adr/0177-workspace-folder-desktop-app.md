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
├── .canvast/                      app-owned: settings and index
│   ├── settings.json              workspace settings (synced with the folder)
│   ├── index.json                 library catalog: names, tags, folders, notes, fields, hash ↔ file,
│   │                              order of boards and canvases, display names
│   ├── bookmarks.json
│   ├── device/                    per device, not meant to sync: open canvas, cameras, panels
│   └── cache/                     thumbnails and other derived data; safe to delete
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
- **A canvas** is one `.cvst` file (JSON). The `.canvas` extension is not used, because another app already uses it. Exact coordinates (BigInt) are written as strings, as the archive already does.
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
| The name you typed stays what the app shows; the index keeps it | — |
| Renaming or moving in the app renames or moves the file or folder. **Library undo** (50 steps) moves it back | — |
| Tags, notes, fields and the hidden flag are kept in the index, never in names | — |

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

## Order of work

Each step ends in a working app and is committed and released on its own.

| Step | Work | Ends with |
|---|---|---|
| 1 | **Storage adapter:** IndexedDB behind one interface; no change in behaviour | Browser build unchanged; storage specs green in both browsers |
| 2 | **Desktop shell:** Electron main, preload file API, `app://`, workspace picker and list; library files through a `FolderStore` | The desktop app runs the current build; library files land in `library/` with readable names |
| 3 | **Workspace format:** boards as folders, `.cvst` canvases, `.canvast/index.json`, safe-write saving, the move from browser storage | A whole workspace lives in a folder and survives restart, move and copy |
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
| 6 | Should the browser build in Chromium also open a workspace folder? | Open: explained to the owner, waiting for the answer. Does not block steps 1 to 5 |
| 7 | Canvas previews in the file manager | **None.** What the app makes for itself (thumbnails, caches, previews) stays only in the dot folders; a `.cvst` holds the canvas and nothing else |

## Consequences

- Your work is plain files: browsable, syncable with any tool, and not capped by the browser.
- Two storage backends to keep working and tested.
- A desktop package of about 100 MB or more per platform, next to the 2 MB HTML file.
- The desktop build has no Firefox; the browser build keeps it.
- Hidden items are protected for real in the desktop build; a lost password cannot be recovered.
