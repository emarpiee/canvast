# ADR 0204: PhotoCraft, ArtCraft's photo editor, carried as its own release and wired in by helpers

- Status: **accepted** (2026-11-15)
- Related: ADR 0154 (the library chooser), 0118 (edited pictures), 0175 (releases), 0177 (the storage boundary)

## Context

An earlier Painting view rebuilt a photo editor's tools one by one inside canvast (removed in 0.37.0). PhotoCraft
(https://github.com/storytold/photocraft, MIT OR Apache-2.0) is a complete open-source photo editor that ships, with every release, a web
build: its WebAssembly, its wasm-bindgen code and a small page. The owner wants that exact tool inside canvast, wired to the library and
the canvas, treated as a dependency: only its released package is used, never built here, and only canvast's helpers are maintained.

## Decision

- **Its release, as it is.** `scripts/artcraft/photocraft/release.json` names the release zip and its SHA-256. The build
  (`package.mjs`) downloads it once (node_modules/.cache), checks it, and puts in the single file an inert JSON block: its page's style
  and body, its code made into one inline module (the three functions it imports from `snippets/` placed in front; its exports become
  `globalThis.__photocraftInit`), and its WebAssembly as shipped (gzip, base64, about 20 MB). Anything it does not recognise stops the build.
- **A frame of its own** (`src/artcraft/photocraft/frame.ts`): an `<iframe>` with no address (same origin, so this page's security
  policy, `connect-src 'none'` included, holds in it), written with its page; its WebAssembly is unpacked in the frame and its code started
  there. Its keys stay in it; closing removes the frame and its memory.
- **Helpers stand in where its page would use the browser:** its file picker (rfd's card with a file input) is answered by the library
  chooser; its downloads (`<a download>` of a blob) come back to canvast; `fonts/manifest.txt` and the fonts it lists are served from the
  library's fonts; links and `window.open` do nothing; its "Reload" starts it again; files are opened in it by dropping them on it. Whether
  a document has unsaved work is asked as its page asks before closing (a `beforeunload` event).
- **Switches** (`src/artcraft/photocraft/features.ts`): `true`/`false` per entry point, per helper, per menu item (its command ids) and per
  tool (its names). Menu items and tools are hidden through its own preferences (`menus.hidden`, `toolbar.hidden`), written before every
  start, so the switches always win; unlisted ids stay as the person left them; the recent files list is emptied.
- **What comes back:** a file it saves becomes a new library item, filed and tagged as Edited pictures are; a picture from a canvas then
  replaces the picture there (one step of undo) or goes beside it, asked with Don't ask again, kept in Settings > ArtCraft > PhotoCraft.
  The original file is never written over. Hidden items do not open in it.
- **Updates:** `npm run photocraft:check -- --latest` checks a release against the helpers (sums, the packager, its web shell's hooks, the
  switches' ids) and lists what is new; the `PhotoCraft release` workflow runs it daily and opens an issue for a new release;
  `--write` moves `release.json`. Code lives under `artcraft/` (`src/artcraft/photocraft/`, `scripts/artcraft/photocraft/`), where
  another ArtCraft tool would go beside it; Settings has an ArtCraft group with a tab per tool.

## Amendment (0.59.4)

- **A view of its own:** PhotoCraft is one of the app's views (`AppView` "photocraft"), with a tab beside Library; switching away keeps
  its frame and documents; its Close stops it and returns to the view it came from.
- **Layered projects:** several pictures (as layers) and a sheet are written as an OpenRaster file (`layers.ts`): each object drawn alone
  by the Export renderer at the chosen size (Export's size rules, `size-dialog.ts`), the layer order canvast's, groups and sheets on the
  sheet as layer groups; masks and adjustment shapes are in the merged picture only. A saved project is placed beside its box.
- **Every kind it opens:** `PHOTOCRAFT_OPENS` (its `OPEN_EXTS` less preset files); the checker says when they differ.
- **Its keys:** every Ctrl/Cmd, F-key and Alt+arrow key it sees has its default prevented after PhotoCraft read it (copy, cut, paste
  excepted), so the page and the app window do not act on them too.
- **Its state with the workspace:** its preferences JSON is the workspace setting `photocraft.prefs` (caught from the `storage` event its
  frame's writes raise, and on stop); its preset database is packed (`photocraft-presets.zip`, fixed dates, so the same presets make the
  same item) into the library's concealed PhotoCraft folder, `photocraft.presets` naming it; both are put back before each start. No new
  storage format: the setting and the library item already go to the folder, sync and backups.

## Amendment (0.59.12): Save writes the file it opened

PhotoCraft's web build opens every file without a path (`open_bytes(name, bytes)`: File › Open and a drop alike), so its Save suggests
PSD for every document and cannot write back. canvast keeps where each document came from and does what Save does on a desktop: a save
of a document opened from a file goes into that file (`session.saveVersion`), in its own kind (the same kind as it is, or a PNG, JPEG or
WebP from the PSD's merged picture); a later save is a new version of what it saved; another name (Save a Copy, Save As) is a new item
beside it; the type is asked only for a new document. The question "Replace the picture / Add it beside" and its setting are gone.

## Consequences

- The single file grows by about 20 MB (28 MB in all); the block is read only when PhotoCraft first opens, after the app has started.
- Things it does on its own disk in a desktop app (folders, batch, plug-ins, printing) are switched off: its page cannot have them.
- A few items it never lets be hidden (Save, Save As, Exit, Edit > Menus, Edit > Keyboard Shortcuts, its Preferences pages) stay; the
  person can show hidden items again in its Edit > Menus until the next start.
- A release that changes one of the hooks fails the check (and the build, for the packager's part) before it can ship.
