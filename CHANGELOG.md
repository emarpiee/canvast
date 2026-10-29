# Changelog

## 0.50.48 — Canvas copies made by sync tools (2026-10-29)

- **Fixed:** in the desktop app, a canvas file a sync tool kept beside the canvas's own (`heroes (1).cvst`, when two devices saved it at once) was ignored, so the edits in it never showed. That version now becomes a canvas of its own, `<name> (conflict from sync <date>)`, on the same board, and the copy moves to where deleted files go (a copy the same as the canvas's file only moves away).

## 0.50.47 — Hidden items survive sync clashes (2026-10-29)

- **Fixed:** in the desktop app, when a sync tool kept one device's `hidden.json` and put the other's beside it (`hidden (1).json`), the items hidden on the other device were lost from the app (their encrypted files stayed, with no way to open them). The copy is now joined into the hidden items once they are opened, then deleted.
- **Fixed:** an encrypted file in `.hidden/` that no hidden item names comes back as a hidden item named `recovered-<hash>.<ext>`; a sync tool's copy of an encrypted file (`… (1).bin`) is no longer encrypted a second time (a copy of an item's file is deleted).
- **Fixed:** two devices that set a first Hidden password at the same time no longer lose one device's hidden items: the app never writes its index into a `hidden.json` that holds another key, keeps its own beside it, and joins the two when the same password opens both. A first password is refused while encrypted files of another device are there without their `hidden.json`.
- **Fixed:** a hidden index that does not open (another key, or damaged) no longer makes the app take its hidden items as deleted on another device.
- **Changed:** `scripts/hidden-items.mjs decrypt` also reads copies of `hidden.json` and writes encrypted files no entry names as `recovered-<hash>.<ext>`.

## 0.50.46 — Ctrl+click after a Ctrl+drag (2026-10-29)

- **Fixed:** after a Ctrl+drag down and to the right, the list of revealed names stayed where the drag began, under where it ended, so the next Ctrl+click there picked a row of that list instead of the thing on top. A drag no longer counts as heading for the list.

## 0.50.45 — Colour harmonies follow the last colour (2026-10-29)

- **Fixed:** the colour picker's harmony swatches showed the harmonies of an earlier colour when the colour changed twice within one frame (typing a colour right after another); they now follow the last one.

## 0.50.44 — The library index in parts (2026-10-29)

- **Added:** try canvast online at https://emarpiee.github.io/canvast/: the latest release's single file on GitHub Pages, put there by each release (it keeps its own data, apart from a downloaded copy).
- **Changed:** the desktop app keeps the library's names, tags, folders, notes and fields in `.canvast/library/`: an index and sixteen parts, so a change rewrites one small file instead of the whole library, and a sync tool copies only that part. A workspace of an earlier version (with `library.json` only) is read as before and gets the parts with the next save.
- **Changed:** `library.json` is still written as a copy while the library has up to 10,000 items, so an older version of the app keeps working on the workspace; what an older version changes in it is taken.

## 0.50.43 — Delete library files at once (2026-10-29)

- **Added:** *Delete library files at once* in Settings > Storage (desktop app, off by default): a file deleted from the library leaves the folder at once, to where *Deleted files go* sends it, instead of when undo on the open canvas no longer needs it. Undoing then shows the picture as missing until its file is back in `library/`.

## 0.50.42 — Saved searches (2026-10-29)

- **Added:** saved searches in the canvas search and the library search, each with its own list. The save button in the box keeps the search typed (pressed while it is saved; press it again to remove it). With the box empty, the eight used last are listed above the recent ones, with how many more there are; while typing, the saved ones that hold the typed words are offered. Up to 200 per list, kept on this device and carried in a workspace backup with the settings.
- **Changed:** a recent search that is also saved shows only under Saved.

## 0.50.41 — Search keywords (2026-10-29)

- **Added:** library search keywords: `kind:` (picture, video, audio, gif, font, file), `is:` (favourite, used, unused, missing, filed, unfiled, tagged, untagged), `uses>` and `canvases>`, `date:` (a day, month or year, `today`, `yesterday`, `week`, `month`, `year`, and `date>` / `date<`), `on:` (a canvas or board it is placed on), `folder:`, `note:`, `field:key` and `field:key=value`, and `duration>` for videos, sounds and GIFs (`30s`, `2m`, `1:30`).
- **Added:** canvas search keywords: `kind:` (picture, video, gif, audio, text, stroke, shape, sheet), `group:` and `in:` (a group or a sheet by name), `fill:` and `stroke:` (a colour name or a hex colour; a gradient by any of its stops; `colour:` either), and `is:` (locked, masked, offscreen, tagged, named, rotated, grouped).
- **Changed:** the search help card lists the new keywords with an example each, in the library and on the canvas.

## 0.50.40 — Undo brings deleted items back selected; fonts show their letters on the canvas (2026-10-29)

- **Changed:** undoing a delete brings the items back selected, whatever their kind (strokes, shapes, text, pictures, videos, sheets), so they can be moved or deleted again at once.
- **Added:** a font placed on the canvas shows "Aa" in that font on its card, as it does in the library, instead of the plain file card.
- **Changed:** the README no longer lists features left out.
- **Changed:** on GitHub, a failed end-to-end test is also reported as an annotation on its job, so it can be read without the full log.

## 0.50.39 — The version in the title, a tidier repository (2026-10-29)

- **Added:** the version after the name in the browser tab (`canvast 0.50.39`) and in the desktop app's window title (`<workspace> — canvast 0.50.39`).
- **Changed:** the library viewer's player fades after *Hide the player* whether the video or GIF is playing or paused.
- **Removed:** the two Claude Code workflows (they would have run on anyone's `@claude` in this public repository), the nested-frames spike and its scripts, the finished plans in `docs/plans/`, and two reference notes that were out of date (the plan-gaps list and the vector tools audit). Links to them now say they were removed.
- **Changed:** `docs/status.md`'s overview is up to date (nested frames, Phases 2, 5, 8 and 9 done; the desktop app and its packages). The README links the pen and deep-zoom algorithms and the nested-frames reference. The showcase motion piece's GSAP is listed as a development-only tool.
- **Fixed:** the text-to-path test no longer depends on how a machine's system snaps small text to pixels: its exact check is now made zoomed in, where text and path are drawn from the same font outlines.

## 0.50.38 — The viewer's controls button at the top (2026-10-29)

- **Changed:** the library viewer's button that hides and shows the controls (`F`) is at the top, beside the details button, and behaves like it (with the controls hidden it fades until the pointer is near the top). It no longer sits over the bottom of the picture, and the strip kept for it is gone: the picture uses the whole stage, and grows when the controls are hidden.
- **Added:** *Hide the player* in Settings > Media and playback: how long the viewer's video and GIF player stays after the pointer stops while it plays (1.5 s by default, it was 2.5 s).
- **Fixed:** the viewer's player floats over the picture instead of leaving an empty strip under it when the controls are hidden.

## 0.50.37 — Show in file manager (2026-10-29)

- **Added:** *Show in file manager* (desktop app) in the details of one library item and in its right-click menu: the item's folder opens in the system's file manager with its file selected. Hidden items do not have it.
- **Added:** the README has a Contributing and support section: reporting bugs, asking for features, sending pull requests, and supporting the developer.

## 0.50.36 — The viewer's player floats (2026-10-29)

- **Changed:** in the library's viewer, the player of a video or GIF floats over the bottom of the picture instead of taking a strip of its own, so the picture keeps its size. While it plays and the pointer rests, the player fades away; any move, touch or key brings it back, and it stays while paused.
- **Fixed:** with the viewer's controls hidden, the player covered the button that shows them again, so they could not be brought back.
- **Added:** README screenshots of the desktop app on its workspace folder (and the folder's files), the board and canvas menu, a video with its player, the Adjust panel, the Styles panel and the library's list with a font's sample.

## 0.50.35 — Packages on a fresh machine (2026-10-29)

- **Fixed:** packaging the desktop app on a fresh machine (GitHub's) fetches Electron first: Electron no longer fetches its binary when it is installed, so the packages of 0.50.33 and 0.50.34 were not built there.

## 0.50.34 — Packages built on GitHub, tests on GitHub (2026-10-29)

- **Changed:** the desktop packages of a release are built, checked and added on GitHub's machines (x86_64 and aarch64) a few minutes after it is published; a release no longer uploads them from the developer's machine. The release notes list them by format.
- **Added:** the whole end-to-end suite runs on GitHub on every push and pull request, split by test group and browser, and the full suite every Sunday.
- **Added:** the README has notes from the developer.
- **Fixed:** three tests that the first run on GitHub showed to be wrong: two looked for the canvas's view controls by a class the library's bar now shares, and one read a pixel before the next frame was drawn.

## 0.50.33 — Linux packages, a new README, GPL v3 (2026-10-29)

- **Added:** the desktop app is packaged as `.deb`, `.rpm` and `.tar.gz` besides the AppImage, for x86_64 and aarch64 (ARM64, built and start-checked on an ARM machine by a release workflow). Each package is checked before it is released and has its SHA-256 beside it.
- **Added:** `scripts/hidden-items.mjs` decrypts a desktop workspace's hidden items without the app, and encrypts files into them; the README documents the encrypted format.
- **Changed:** the README is reorganized: what users look for first (features at a glance, installation for every package, updating, uninstalling), then the guide, your data, privacy and security, and limitations split into both versions, the browser version and the desktop app; then a developer part (how it works, API and file formats, building from source, testing, releasing).
- **Changed:** canvast is licensed under the GNU General Public License, version 3 or later (it was MIT). The colour picker module keeps its own MIT licence.

## 0.50.32 — AppImage updates (2026-10-29)

- **Added:** the AppImage carries its update address and each release has its `.zsync`, so an AppImage updater (Gear Lever, AppImageUpdate) finds the newest version and downloads only what changed. The app itself still never goes online.
- **Changed:** the README says canvast is Linux-first: the AppImage is its only desktop package, other platforms stay possible later. The README screenshots use the app's default theme colour, Viridian.

## 0.50.31 — Font samples, and no second password after an import (2026-10-29)

- **Added:** a font in the library shows a sample in its own letters: the details show "Aa" and "The quick brown fox jumps over the lazy dog", and the viewer shows the sentence at four sizes with the alphabet and the digits, in place of "No preview for this kind of file". A font the browser cannot read says so.
- **Fixed:** after importing a backup in the desktop app, the app starts again without asking for the workspace password: it was given before the import, in the same window. The next time the app is opened it asks as usual.
- **Added:** the desktop app has a short description in the system's app list ("Endless canvas for drawing and references").
- **Fixed:** the CI smoke tests: the Zen mode test (and two others) looked for the canvas's status bar by a class the library's status bar now shares.

## 0.50.30 — The logo as chosen (2026-10-29)

- **Fixed:** the logo is the one the owner chose: on the Viridian tile, a Paper frame with a window cut from it a little low and to the right, and the orange dot in the window's middle. 0.50.29 had drawn a solid square instead, and 0.50.28 a frame with different proportions. One drawing serves every size, the favicon too; there is no line version. The favicon, the app's own mark, the logo files, the guidelines, the README cover and the social preview are made again from it.

## 0.50.29 — The logo, filled (2026-10-29)

- **Changed:** the logo is the filled mark: a solid canvas half the size of the tile, with the orange dot at its centre (a quarter of the canvas); the frame and window of 0.50.28 are gone. One drawing serves every size, the favicon too, so there is no separate small master any more, and the line version is removed. In one colour (the app's own mark, in the theme's text colour) the dot is cut out. The guidelines, the logo files, the README cover and the social preview are made again.

## 0.50.28 — A new logo (2026-10-29)

- **Changed:** a new logo: a frame, a window cut from its middle and a dot in the window, each half the size of the one around it (the way canvast zooms, by powers of two), in the default theme's colours (a Viridian tile, an orange dot). It is the favicon, the app icon of the desktop build, and the mark on the lock screen, the opening screen and Settings > About. The brand guidelines, the logo files (now with a line version for use beside the app's icons) and the README cover are made again; the cover is drawn as a canvas in the default theme, with the dot on the origin.

## 0.50.27 — A faster big library (2026-10-29)

- **Fixed:** a big library was slow to open, to search and to save. Records of files kept in a folder no longer carry an empty stored file (reading thousands of them was most of the cost; existing ones are converted once, in the background); each save reads the library once, not twice, and keeps a short fingerprint of each item instead of its whole line; a search filters the library sorted once, instead of sorting again on every keystroke. Measured with 20,000 items: opening 6.0 s → 3.0 s, listing 1.8–2.6 s → 0.9 s, a save after one change 6.5 s → 2.1 s.

## 0.50.26 — A file put in .hidden/ asks for the password (2026-10-29)

- **Changed:** in the desktop app, a readable file put in `.hidden/` while the Hidden items are locked makes the app ask for their password at once (it names the file); once given, the file is encrypted within a moment, so the folder shows its `.bin` in its place. A file that could not be taken in is now written in the developer tools' console instead of being skipped silently.

## 0.50.25 — Told each time a file is put in .hidden/ (2026-10-29)

- **Fixed:** in the desktop app, a readable file put in `.hidden/` while the Hidden items were locked was mentioned only once, at start-up, so moving one in later seemed to do nothing. The app now says so each time a file is put there (it can only be encrypted with the password), and encrypts it as soon as the Hidden items are opened.

## 0.50.24 — One search panel (2026-10-29)

- **Changed:** the library's search panel is built from the same parts as the canvas search: the ways to search as tabs (All selected at first), a line saying what to type, and the keys at the bottom; the library's own look-alike styles are gone. Esc now closes it, as it closes the canvas search. The canvas search's All tab is also shown selected when it opens.

## 0.50.23 — Back to top (2026-10-29)

- **Added:** a **Back to top** button (an arrow up to a line) in the library's status bar, in the grid and the list alike; it shows once the library is scrolled a screen down. Home does the same from the keyboard.

## 0.50.22 — Resizable list columns, a remembered thumbnail size (2026-10-29)

- **Added:** in the library's list, a column is resized by dragging its header's right edge (a double-click gives back its usual width); the widths are kept with the layout, as the columns' choice and order are.
- **Fixed:** the grid's thumbnail size was forgotten on a reload: it is now kept with the layout.

## 0.50.21 — Fonts show their letters (2026-10-29)

- **Added:** a font in the library (TTF, OTF, WOFF, WOFF2) shows "Aa" written in that font as its thumbnail, in the theme's text colour, instead of the file tile; read and drawn by the app itself, with no extra package.

## 0.50.20 — A folder for each kind of file (2026-10-29)

- **Changed:** in the desktop app, library files that are in no library folder are sorted into more kind folders of `library/`: `vectors` (svg, eps), `icons` (ico, icns), `art_sources` (psd, kra, xcf, clip, procreate, sai, ai, afphoto, …), `presets` (brushes and swatches), `3d`, `archives`, besides `images`, `video`, `audio`, `fonts`, `documents` and `other`. The extension decides first, so an art file is never filed with the pictures. Files already in the folder move to their new place on the next save.

## 0.50.19 — The player no longer covers the video (2026-10-29)

- **Fixed:** in the library's viewer, the player of a video or GIF covered the bottom of the picture, and the button that hides the controls sat on the player. The picture now fits above the player, and the button sits above both; the viewer itself keeps its size.

## 0.50.18 — The library keeps its filters (2026-10-29)

- **Added:** the library's filters (Show, Sort by, its direction, and the list chosen in the sidebar: a folder, tag, file type…) are kept over a reload and a restart, with the layout. A reset button (a funnel with a cross) beside them, shown only when a filter is not its default, puts them all back at once. The search is not kept: it has its own clear button.

## 0.50.17 — Files put back show at once (2026-10-29)

- **Fixed:** in the desktop app, a library file put back in its own place from outside the app (from a trash, by hand) still showed as missing until the app was restarted: any change made in `library/` outside the app now lists the library again.

## 0.50.16 — A moved workspace keeps its password (2026-10-29)

- **Fixed:** in the desktop app, a workspace with a password opened from a new place (moved or renamed, or on a device that had no copy of it yet) opened without asking for the password: it was read from the app's own copy before the folder was. The passwords in the folder's `workspace.json` are now taken first, before the app asks.
- **Added:** in the desktop app, a readable file put in `.hidden/` from outside the app (a file manager) becomes a hidden item and is encrypted, with nothing readable left; while the Hidden items are locked, the app says so once and encrypts it when they are opened.
- **Changed:** a frame extracted in the library's viewer goes to the library only; *Place extracted frames on the canvas* (Settings > Media and playback) is now off by default.
- **Added:** Enter opens the one selected library item in the viewer.

## 0.50.15 — Put the library's sections in your order (2026-10-28)

- **Added:** the library sidebar's sections (Folders, File types, Tags, Canvas tags) can be put in any order: drag a section by its head onto another (the places it can go are marked like every drop place), or press Alt+Up or Alt+Down on its name. The order is kept (in the desktop app, for each workspace).

## 0.50.14 — One look for lists of boards and drop places (2026-10-28)

- **Changed:** **Place on…** is the board and canvas switcher's list: the same board cards, rows and counts, the open canvas highlighted the same way.
- **Changed:** while items are dragged in the library, every place that takes them shows it with one look: the strip at the top and the sidebar's folders, tags, Unfiled and Favourites, dashed while dragging and filled while the items are over one.

## 0.50.13 — The filmstrip finds the open item (2026-10-28)

- **Fixed:** opening an item far down a big library in the viewer left the filmstrip near its start, so the item was not in it: the strip was centred before it had its whole length. It now takes its length first, then centres the open item.

## 0.50.12 — Many boards, thumbnails ready (2026-10-28)

- **Added:** the board and canvas switcher and **Place on…** have a search field (*Find a board or canvas*) that keeps only the boards and canvases whose names hold what is typed; with more than four boards, each is folded to its name but the one holding the open canvas (a click unfolds it). One behaviour for both lists.
- **Fixed:** in a big library imported at once, cards scrolled into view stayed blank for seconds while their thumbnails were made one by one. Every missing thumbnail is now made in the background after the library is first listed (the cards on screen first), six at a time, and kept: the next scroll, and the next start, show them at once.

## 0.50.11 — Narrow panels never cut (2026-10-28)

- **Fixed:** the library's details panel, made narrow, was wider than itself and cut on both sides (the *Show* buttons of *Used on*, the text). The sidebar's rule that nothing in a panel is wider than the panel, and text shortens with an ellipsis, is now one rule for both panels.

## 0.50.10 — Drag from the library to place (2026-10-28)

- **Added:** dragging items in the library shows them: up to five of their thumbnails stacked and fanned a little, with how many there are.
- **Added:** while items are dragged, a strip across the top of the library says *Drop here to place … on* the open canvas; dropping them there places them on it, and the library stays open.
- **Fixed:** in the library's viewer, the left edge of the details panel was hidden under the picture (since 0.50.9).

## 0.50.9 — Smooth panel edges, one scrollbar style (2026-10-28)

- **Fixed:** dragging a library panel's edge still lagged in a big library: every pixel moved the grid and repainted every thumbnail. While dragging, the panel now grows over the grid (or away from it) and the grid keeps its place, as its own layer; it takes its new place once, when the edge is let go.
- **Fixed:** the library's panels had a double gap around each edge handle; the handle now sits in a single gap.
- **Changed:** every scroll area has the same thin scrollbar in the theme's colours (the library grid had the system's own, with arrows).

## 0.50.8 — The library lists at once (2026-10-28)

- **Fixed:** in the desktop app, listing the library read every file in it from the disk to check it was still there: with a library of 2,500 files on a spinning disk the library stayed empty for about 11 seconds after opening, and again on each refresh. Each file's size is now asked for, all of them in one call, and nothing is read.
- **Changed:** the library's view controls (layout, columns, thumbnail size) are inside its status bar, at the right, instead of floating above it.

## 0.50.7 — A start screen, one word for each thing (2026-10-28)

- **Added:** a start screen while a workspace opens: the logo, *Opening the workspace* and what is being done (reading the workspace and its folder, loading the canvas, checking the library), in front of the whole app until everything is ready, so nothing shows empty or half-loaded. It steps aside for the lock screen. Each step is also said in the developer tools' console with its time (*canvast start: …*), to find what makes a start slow.
- **Fixed:** dragging a library panel's edge no longer lays the cards out while dragging (that moved and reloaded the thumbnails, so it still lagged): only the panel follows the pointer, and the cards are laid out once when the edge is let go.
- **Fixed:** in a big library, scrolling a little and back showed blank, shimmering cards for a moment while their thumbnails loaded again: cards are kept three screens beyond the view (one before), and a thumbnail already loaded is shown at once.
- **Added:** in the desktop app, **Open in default app** (the library's details and right-click menu, and the canvas's Actions bar for a file card) opens the item's file from the workspace folder in the app your system uses for that kind of file: a video or file canvast cannot play or show, or a picture to edit elsewhere. Not offered for hidden items.
- **Changed:** the library's status bar is the canvas's: the same full-width strip along the bottom, the view controls just above it at the right (one set of styles for both).
- **Changed:** the app says the same common word for the same thing everywhere: **selected** (not "picked": the details said "36 selected" while the status bar said "36 picked"), **files** for the library's files (not "originals"), and **info bar** for the line at the bottom left (not "readout"). The colour picker keeps "pick a colour". The README follows.

## 0.50.6 — Smooth panel resizing in the library (2026-10-28)

- **Fixed:** dragging the edge of the library's side panel or details panel crawled in a big library: every pixel laid out every card again. The panel now follows the pointer every frame, and the cards are laid out again a few times a second while dragging and once when the edge is let go.

## 0.50.5 — An import writes its files straight into the workspace folder (2026-10-28)

- **Fixed:** in the desktop app, an import first stored every file of the backup (pictures, fonts, videos and the rest) in the app's own storage and then copied it into the workspace folder; after the app started again, the storage spent minutes clearing those copies on a spinning disk, which slowed the start, the lock screen and closing. The files now go straight into the folder (the app keeps only where each one is), so nothing is left to clear and the disk does about half the work. Hidden items are never written as readable files: they stay in the app until the Hidden items are opened, then are encrypted into `.hidden/` as before.

## 0.50.4 — The lock screen answers at once, one window per workspace (2026-10-28)

- **Fixed:** the workspace lock screen could seem to do nothing on Enter right after a big import: the password was read again from the app's storage, which was still busy with the import's clean-up. It is checked against the password already read, so it answers at once, and **Open** says *Checking…* while it works.
- **Fixed:** in the desktop app, closing the window at the lock screen waited (up to 15 s) for a save that cannot be needed while locked; it now closes at once.
- **Fixed:** in the desktop app, starting the app again while it was still closing (its window gone, the process still finishing its writes) opened a window with *Storage unavailable* and an empty library. A workspace is now open in one process only: a new start waits for the closing one, and asks when it is still open in another window.

## 0.50.3 — Import and export questions you can read at a glance (2026-10-28)

- **Changed:** the dialog before an import reads at a glance: a summary in two columns (From, Exported, Contains, Checked, Goes to), an *Also in this file* list (the workspace and Hidden items passwords, your settings, a library index) with one line each on what happens, and warnings (an incremental backup on its own, missing originals, problems) in a box of their own. Counts are written with thousands separators.
- **Changed:** before a workspace backup, the passwords and privacy question lists what this device has (the workspace password, the Hidden items password, your privacy settings) instead of one long sentence.

## 0.50.2 — Faster import into a workspace folder (2026-10-28)

- **Fixed:** in the desktop app, writing an import's files into the workspace folder waited for the disk to confirm every file, which on a spinning disk took minutes for a big backup. The files are now written in batches of 100 and the disk is asked once per batch; the app keeps its own copy of each file until its batch is confirmed, so stopping half-way still loses nothing. Measured on a spinning disk: about 112 files a second (1,168 files in 10 s).

## 0.50.1 — A new folder is a new workspace, a calmer library wait (2026-10-28)

- **Fixed:** in the desktop app on Linux, watching the workspace folder for outside changes put a watch on every file and read a whole folder again, holding the app's main process, on every file written into it, so a big import slowed the app more the more files it wrote. Each folder is now watched once, and nothing waits on it.
- **Fixed:** in the desktop app, a new workspace folder made where a deleted one was (the same name and place) opened the deleted one's copy kept on this device: its boards, library and passwords. Each folder now has its own id (`.canvast/folder.json`); a new folder is a new, empty workspace, and the deleted one's copy is cleared.
- **Changed:** the thumbnail of a library item still loading shows one soft light passing across the whole view (every waiting thumbnail in the same wave) instead of a stripe on each; still with reduced motion.
- **Changed:** Settings > Storage in the desktop app is tidier: the workspace folder's path as in the Library folder card, one short line on what the folder is, **Switch workspace…** as the app's other buttons, and where deleted files go as an ordinary setting row (with its reset).

## 0.50.0 — Hidden means hidden, an eye on passwords, fields in your order (2026-10-28)

- **Added:** every password field (the lock screen, setting or giving a password) has an eye button at its end that shows what was typed and hides it again; the field keeps the focus.
- **Added:** the fields of a library item's note can be put in any order: drag a row by its grip, or press the Up and Down arrows on the grip. The order is stored with the item.
- **Changed:** the details of a library item say where it is used once: the section is headed with the count (*Used on 3 canvases (4 times)*), each canvas has its own count (*×2*) beside **Show**, and an item used on many canvases lists the first five with **Show all** for the rest.
- **Changed:** one **Delete…** button in the details: an item in use is deleted everywhere after a confirmation that says where (the first three canvases and how many others), so the greyed-out *Delete from library* and its explanation are gone.
- **Changed:** long lists in the library's sidebar (folders, file types, tags, canvas tags) show their first rows and a full-width **Show N more** button (**Show fewer** folds them again, remembered on this device); the list you have open always stays visible.
- **Added:** a **status bar** along the bottom of the library, in the canvas's style (the same parts): how many items are listed, how many are picked and their size, and the size of the whole library. The layout (thumbnails or list), the list's columns and the thumbnail size moved into it from the top bar, which keeps search, filters, sort, Import, Slideshow and Details; the item count no longer hides on narrower windows.
- **Added:** in the desktop app, **Switch workspace…** (the Board › Canvas menu, Settings > Storage, the command palette): the open and recent workspaces, *Open a folder…*, *New workspace…* and *Clear the recent list* (the latest five whose folders are there are listed). File > New workspace… too.
- **Added:** in the desktop app, when the last workspace folder is gone (moved or deleted), the app says so at start-up and offers the recent workspaces, a folder or a new one, instead of opening another one without a word.
- **Added:** an import keeps the app waiting behind one screen from start to end (reading the file, saving it, and in the desktop app writing its files into the workspace folder, with how many are written), so nothing can be changed half-way; in the desktop app the app then starts again on them and says what was imported. Closing the window while many files are still being written asks first; *Close anyway* writes the rest at the next start.
- **Fixed:** in the desktop app, writing an import's files into the workspace folder was slow on a spinning disk (one file at a time, each waiting for the disk twice) and showed nothing on the screen, so a big import looked finished, and stopped, long before it was. Files are now written several at a time and their records kept without waiting for the disk each time (a file already in its place is recognized by its content, so nothing is ever written twice): about 1.7 times faster on a spinning disk.
- **Fixed:** in the desktop app, File > Open workspace folder… started the app again at once, without writing the last edits into the folder.
- **Changed:** a hidden library item's pictures on every canvas show a padlock at once, in the browser and in the desktop app, whether or not the Hidden password was given, until the item is shown again. A hidden video or sound on a canvas does not play.
- **Fixed:** scrolling fast through a big library showed the browser's broken-picture mark on cards whose thumbnails were still loading. A thumbnail's place (cards, list rows, the details picture, the viewer's filmstrip) now shimmers until its picture has loaded, and one that cannot be shown leaves the place plain.
- **Fixed:** in the desktop app, a hidden item's card and details picture could stay blank (until the app was restarted) after the app was reopened, even once the Hidden list was opened or the item shown again: Similar images read the hidden item's picture while it was still locked, and the library kept that failure. Hidden items are no longer read for Similar images, and a picture that could not be read is tried again when the library is read again or the hidden items are opened.

## 0.49.0 — The desktop app: your workspace as a folder of files (2026-10-28)

- **Added:** a **desktop app for Linux** (`canvast-0.49.0-x86_64.AppImage`, attached to the release): the same app, whose workspace is a folder of ordinary files you choose (File > Open workspace folder…), so a sync tool, a backup tool or a file manager can see it. The library's files are under `library/`, named after their names in the library, in folders that are its library folders; the boards and canvases (one `.cvst` file each) and the names, order, tags and folders are in the app's own `.canvast/` folder, out of the way (ADR 0177).
- **Added:** library folders are real folders in the desktop app: filing or renaming an item moves its file, and the library's undo moves it back.
- **Added:** several devices on one folder (through any sync tool): each device keeps its own cameras and open canvas; a canvas another device changed is read in, the open one loaded again; when both changed the same canvas, both versions are kept (`<name> (conflict <date>)`), and a file is never written over another device's newer version.
- **Added:** changes made in a file manager are followed: a library file renamed or moved is found again by its content, a new file dropped into `library/` is imported where it lies, and a deleted file shows as missing.
- **Added:** in the desktop app, **hidden items are encrypted** (AES-GCM, a key wrapped by the Hidden password): hiding asks for a password first, the readable file is deleted, nothing about the item is readable in the folder, a hidden picture on a canvas shows a padlock while locked, and **Lock hidden items** locks them again.
- **Added:** Settings > Storage in the desktop app chooses where deleted files go: `.trash/` in the workspace folder (the default), the system trash, or for good.
- **Added:** moving in from the browser: export a full backup there and import it in the desktop app; its boards, canvases and files are written into the folder.
- **Changed:** the app reaches storage only through one set of interfaces, so the browser build (unchanged, IndexedDB) and the desktop app share all their code; `npm run check:storage` keeps it so.
- **Changed:** releases carry the AppImage and its SHA-256 beside `canvast.html`; the release checks that the AppImage starts before publishing it.

## 0.48.2 — Old painting data removed (2026-10-28)

- **Removed:** the browser storage kept three stores of the removed Painting view (paintings, their layers and tiles) that nothing read. The storage upgrade (schema 12) deletes them and what they hold. Backups made by older versions still import, and say the paintings in them are left out (ADR 0170).

## 0.48.1 — Zooming out is never cut off (2026-10-28)

- **Fixed:** zooming out of a busy canvas could show only the middle of the view, with the edges empty for about half a second, until the exact picture was drawn: the scaled image of the last frame did not reach them. What it does not reach is now drawn exactly in the same frame (ADR 0012).
- **Fixed:** the level one out, which zooming out swaps to with no gap and no pause, is now prepared before the level one in, and both are ready sooner after the view rests (about 425 ms instead of 580 ms in the showcase) because each is looked up once instead of once per slice (ADR 0033).

## 0.48.0 — Notes and fields on library items (2026-10-28)

- **Added:** a **Note** box (plain text) in the details panel of a library item, and under it **Add a field**: rows of a name you choose and a value (a link, an author, a source…), with the library's field names suggested and **×** to remove one. They are stored when left (or on `Enter` in a field), undone with the library's undo, found by the library search, and carried in backups and the library index (an import keeps an item's own note and adds the fields it lacks).

## 0.47.2 — Import a backup of any size (2026-10-28)

- **Fixed:** importing a backup read all its files into memory and kept them there until it was written, so a backup of several gigabytes needed that much free memory. The files are now checked one by one and written a batch at a time (up to 128 MiB), then the canvases, boards and library entries in one transaction, so the import still shows all at once or not at all; files written by an import that did not finish are erased at once, or when the app next opens (ADR 0176). A backup is still one `.canvast` file.
- **Fixed:** the README said Firefox gives a local file about 790 MiB; that is before the browser agrees to keep the data, after which it allows up to half the disk.

## 0.47.1 — A fast library with thousands of items (2026-10-27)

- **Fixed:** the library grew slower the deeper you scrolled: every card stayed in the page with its picture. Only the cards near the view are in the page now (their places worked out in code), and the filmstrip of the viewer does the same; with 20,000 items the library opens in about a second instead of 11 and scrolls at 60 frames a second instead of about 2.
- **Fixed:** typing in the library search stalled on every letter with a large library (15 s for six letters with 20,000 items): the results are redrawn once typing pauses, the list is filtered and sorted once per change, and the sidebar's counts are made once per change of the library.
- **Fixed:** thumbnails missing from storage were all made at once as cards scrolled past (each reads and decodes a whole original); now three at a time, the ones on screen first, and none for a card that scrolled away.
- **Fixed:** tagging, starring, filing or renaming one item read the whole library again, with every placed object; it now reads only the library's organization. With a library folder its files are checked fifty at a time instead of one by one.
- **Fixed:** Ctrl+A, the details of many picked items, stepping through the viewer and keyboard moves in the grid went over the whole library each time.
- **Added:** a GitHub Actions workflow that checks every push to `main` and every pull request: typecheck, unit tests, build, offline, naming, token, picker and pattern checks, the reproducible-build check and a short Chromium end-to-end run; the built file is kept as an artifact of the run.
- **Fixed:** a unit test for old library entries did not know the `hidden` flag added in 0.46.0.

## 0.47.0 — The logo, and OKLCH in the colour picker (2026-10-27)

- **Added:** the canvast logo, a canvas open on its right side and the dot you zoom into: the full-colour logo is the favicon (a version drawn on the 16 px grid); inside the app the one-colour mark, in the theme's text colour (light, dark and the theme colour), stands over the lock screen and beside the name in Settings > About and diagnostics. Its guidelines and files are made by `scripts/brand/`.
- **Changed:** the lock screen is a centred card with the mark and the name over the question, and a full-width field and button; the field of every prompt (a password, a name) is drawn like a field in Settings instead of the browser's plain one.
- **Changed:** the colour picker's third model, OKHCL (this project's own, not a published model), is replaced by **OKLCH**, the standard OKLab polar form that CSS `oklch()` uses: chroma is absolute (0 to 0.4), and what sRGB cannot show is reduced at the same lightness and hue. A saved model of OKHCL becomes OKLCH. The picker's package: a `theme` option and `data-cp-theme` (light, dark, auto), the packaged page has an Auto, Light and Dark switch, its licence travels in the built file, and its README is complete with the limitations.
- **Fixed:** in a dark picker the layout list opened as a white native popup; the picker now sets `color-scheme` with its dark colours.

## 0.46.0 — Hidden library items and passwords (2026-10-27)

- **Added:** *Rename* in the canvas context menu on a picture: it renames the file in the library (with the library's own dialog) and a layer that has a name of its own.
- **Added:** **Hide** an item from the library (details panel, bulk bar, context menu). A hidden item is left out of All, folders, tags, counts, searches, Similar images and the texture-fill and font pickers; pictures already placed on a canvas still show. The Hidden list is not in the sidebar: type its opening word in the library search (`hidden:` by default, changeable in Settings > Privacy).
- **Added:** an optional **password for the Hidden items** and an optional **password for the whole workspace** (asked when the app opens, before anything is read). Both are gates, not encryption: the data is stored as it is, and a forgotten password cannot be recovered. *Keep the Hidden items open until the tab closes* is an option.
- **Added:** an export that would carry hidden items asks whether to include them (the password first) or leave them out; a workspace backup asks whether to include the passwords and privacy settings. The automatic library index never carries hidden items or passwords.
- **Removed:** the Collaboration tab of Settings, for now (there is no collaboration; the tab only said so).
- **Fixed:** the pressed Hide button used the star yellow; it uses the theme accent.
- **Fixed:** the library's Details fold could reopen on the next item after you closed it, when you picked the next item quickly.

## 0.45.0 to 0.45.3 — One context menu, and copying out (2026-10-26)

- **Added:** one context menu for every view (canvas, library, Settings): a right click, the menu key or a long touch opens the commands that fit; the library has *Copy*, *Copy file name* and *Paste* with the system clipboard.
- **Fixed:** *Copy* puts the picture alone on the clipboard (a name beside it was pasted instead by many programs); *Copy file name* puts the name; one writer serves every copy out; `Ctrl`+`C` copies the picture in Firefox too (the picture is made before it is written); the SVG text of a shape is its own command.

## 0.44.0 to 0.44.7 — Reveal, renaming and small polish (2026-10-26)

- **Added:** `Ctrl`+drag from inside a picked thing moves it, whatever covers it; the names beside the pointer are a list to pick from (it stays put while you reach it).
- **Changed:** renaming one library item edits the name without its extension; the Details fold stays as you left it; every text field shows its caret and selection in the accent; interface text is not selectable by accident (fields, code and file facts are); a notice stays as long as its words need.

## 0.43.2 to 0.43.4 — Library details and import (2026-10-26)

- **Changed:** the details panel reads in one flow (one Details block, tags and folder in one card); one Import button with a menu for files or a folder.

## 0.43.1 — Varied fills deep in, without the stall (2026-10-26)

- **Fixed:** zooming into a shape with a varied fill, where its copies are drawn one by one, took seconds a step on a high-density screen (about 6 s at twice the pixels): every tile of the view drew all the copies in view again. They are now drawn once a frame and shared by the tiles (about 0.4 s a step in the same test).

## 0.43.0 — The library: picking, undo, drag to folders and tags (2026-10-25)

- **Changed:** a click on an item no longer opens the closed details panel (which narrowed the grid and moved the item away from under the pointer); the panel is opened and closed with its button or `I`, and stays in place, saying so, with nothing picked. When the grid is laid out again (panel toggled, window or thumbnails resized), the picked item keeps its place on the screen. On a narrow window the details are a sheet that opens on a tap, as before.
- **Undo in the library** (`Ctrl+Z`, `Ctrl+Shift+Z` or `Ctrl+Y`): tags, favourites, folders and names, 50 steps.
- **Drag items onto the sidebar:** a folder, *Unfiled*, a tag or *Favourites*.
- **Fixed:** after `Ctrl+A`, a plain click took that item out of the pick instead of picking it alone (a tap still adds or removes on a touch screen).
- Picked items that a search or filter hides are counted in the panel, with *keep the shown*.
- **Fixed:** after adding a tag the focus went back to the tag field even when you had moved on (so `Ctrl+A` then selected the field's text).
- Placing many items on a canvas shows its progress.
- **Delete everywhere…** for an item (or several) in use: its instances are removed from every canvas, then it is deleted from the library, after a confirmation that says how often and where; Undo on the open canvas brings them back.

## 0.42.0 — Tags and folders for many items at once (2026-10-25)

- **Tags of several picked items:** every tag any of them has, with how many have it; **×** removes it from all of them (before, a tag could not be taken off several at once), **+** adds it to the rest. The tag field suggests the library's tags.
- **Folder of several picked items:** how many of them each folder holds, nothing ticked for a mixed pick (it used to look like none was in a folder), and *New folder for these…*. One item gets the same panel, with *New folder…*.
- **Fixed:** a tag, favourite, folder or deletion for many items wrote each item in a transaction of its own, each waiting for the disk: hundreds of items could take minutes on a real disk. They are now one write. Filing a folder import into folders too.

## 0.41.6 — Resizing a sheet by its handles carries what is on it (2026-10-25)

- **Fixed:** resizing a sheet or a clipping mask by its handles, with it picked alone, left what was on it out of the resize: its pins (right, centre, scale) did nothing, and a pattern on it was neither stretched nor made again (0.41.5 only worked with the pattern picked too). What is on it now follows, as with the ratio and size fields.

## 0.41.5 — A pattern follows its sheet's size (2026-10-25)

- **Fixed:** resizing a sheet that holds a generated pattern left the pattern at its old size in the top-left corner (the rest of the sheet empty, or the pattern cut off), though it was meant to follow. It now stretches with the sheet while you drag, and on release is made again at the new size from its settings and seed, in one undo step (the resize handles, the ratio field and the size on a sheet).

## 0.41.4 — A pattern on a shape uses that shape (2026-10-25)

- **Changed:** making a pattern on a picked shape turned a copy of it into a new mask over it, leaving the shape under it. The shape itself now becomes the clipping mask that holds the pattern: its place, layer, groups and name stay, and its fill and outline come back with *Release*.

## 0.41.3 — Objects fills sharp and steady deep in (2026-10-25)

- **Fixed:** zooming into an Objects fill (varied or plain), a copy shown larger than its tile picture became big blocks of that picture's pixels, then vanished for a few levels, then came back. A copy shown large is now drawn again from its objects, as vectors, only the part in view, so its edges stay sharp and in place at every depth. The maths that places it is done in doubles: a copy a billion times enlarged has offsets near 10^11 px, which the canvas's own transforms did not keep.

## 0.41.2 — Varied fills deep in and far out (2026-10-25)

- **Fixed:** zoomed very far into a varied fill (past where it is drawn as a pattern), the colour shown was the one the plain layout has there, often another copy's (yellow inside a red copy); it is now the colour of the copy that is on top at that point.
- **Fixed:** zoomed out, a varied fill turned into one flat average colour as soon as a single copy was under 2 px; it now stays a pattern while the block of copies is a few px.

## 0.41.1 — Varied fills in SVG (2026-10-25)

- **Fixed:** an SVG of a shape with a varied Objects fill (Export, Save as SVG, Copy as SVG) stretched the source shapes over the whole block of cells, so it showed a few giant shapes. Each copy is now written as vectors, a `<use>` of its object turned, sized, moved and mirrored as on the canvas; with very many copies the block is a picture tile.

## 0.41.0 — Vary each copy of a repeated fill (2026-10-25)

- **Vary each copy** ([ADR 0173](docs/adr/0173-vary-texture-copies.md)): a repeated picture or Objects fill can turn its copies (± an angle, or in steps), size them, move them in their cells, mirror some and leave some cells out; Objects can copy each object on its own, in turn or shuffled, or the whole arrangement. A seed gives the same copies every time, at every zoom and in exports; *New seed* gives others, and *Randomize* now rolls these too. With nothing varied the fill is exactly as before.

## 0.40.1 — Objects fills follow their sources live (2026-10-25)

- **Fixed:** a shape filled with objects showed a change to those objects (moving, turning, resizing, recolouring them) only on release; it now follows at every step of the gesture, and shows them as they will be, not see-through like the selection being dragged.

## 0.40.0 — Gaps with small openings; W A S D by name and in view (2026-10-25)

- **Fill gaps** closes small openings: a place left open by a slit narrower than 4 px on the screen (Settings > Drawing, *Fill gaps: close openings up to*, 0 to 24) is filled up to the slit.
- **Fixed:** shapes that touch only at a corner (snapped hexagons, say) now close in the place between them, so Fill gaps finds it. Where outlines meet at one point, a boolean result's loop goes round the outside of the shapes.
- **W A S D:** six ways to the next item: nearest in view, nearest anywhere, by layer in view or anywhere, by name A to Z in view or anywhere (the names the Layers list shows).
- **Fixed:** *Nearest in view* found nothing when you were zoomed in on an item and its neighbours were off the screen several of its sizes away; it now goes to the nearest item of its size that way, however far, when nothing nearer qualifies.

## 0.39.0 — Fill the gaps between shapes (2026-10-25)

- **Fill gaps** (Path tools menu, command palette, [ADR 0172](docs/adr/0172-fill-gaps.md)): fills every empty place the picked shapes close in, with the Shape tool's fill and no outline, under the shapes round it; a shape sitting in a gap is left out of its fill. One undo step.
- **Fill a gap…**: the gaps show as dashed outlines, the one under the pointer as it would be filled; a click fills it, one undo step each; Enter or Esc ends it.

## 0.38.0 — Snapping to the shapes themselves; shapes start without an outline (2026-10-25)

- **Snapping to the shapes** ([ADR 0171](docs/adr/0171-snap-to-shapes.md)): moving, resizing, turning and dragging a node now also snap to corners and sides, not only to boxes. A corner goes exactly onto another corner or the middle of a side (a ring marks it), onto any side, curves included, and a straight side lies flush along a nearly parallel one (the side is drawn). Turning brings a corner round to another or a side parallel to a nearby one. One rule for every gesture.
- **Changed:** a new shape has a fill and no outline. Lines and open paths still get the ink, or they would not show. The outline is no longer remembered between sessions.
- **Fixed:** the outline width (Outline options and the bar's slider) read the width kept for later even when a shape had no outline; it now reads 0, or *None* on the slider, whose far left is no outline.
- **Fixed:** an open path drawn with a fill and no outline was invisible.

## 0.37.3 — Make vector copy works in place (2026-10-25)

- **Fixed:** *Make vector copy* of an SVG picture put the shapes under the pointer (the Actions bar button) at half the view's size, so they came out smaller and elsewhere. They now take the picture's place exactly: its size, crop, turn, layer, sheet and group.
- **Changed:** the shapes replace the picture on the canvas, in one undo step; the file stays in the library.

## 0.37.2 — No more stutter from the library index on a big workspace (2026-10-25)

- **Fixed:** with a library folder in use, the library index (saved about 20 s after the last change, at most once a minute) froze the canvas for up to about 0.2 s on a big workspace, so the frame rate dropped now and then. Each canvas is now read, written out and checked in small slices with frames drawn in between: on a 60,000-object workspace no step takes longer than a frame, where the longest used to block for 196 ms.
- Backups and other ZIP exports use the same sliced writing and checking.

## 0.37.1 — Big library imports without the lag and flicker (2026-10-25)

- **Fixed:** importing many files into the library no longer keeps every decoded picture in memory, so a big import stays responsive.
- **Fixed:** after a folder import, filing the files into their folders is saved once instead of once per file, so the library is redrawn once and no longer flickers for a while.
- **Fixed:** when the library is redrawn, thumbnails already loaded stay visible instead of blanking and loading again.

## 0.37.0 — The Painting view is removed (2026-10-25)

- **Removed:** the Paint view and everything in it (paintings, pages, layers, the painting tools, brush presets and brush files, reference pictures, OpenRaster) and its brush engine; the build no longer needs Rust ([ADR 0170](docs/adr/0170-painting-view-removed.md)).
- **Removed** too: the Eyedropper tool of the rail (`I`); the colour picker keeps its own screen pick.
- **Kept:** a plain wheel scrolling a bar sideways, a sheet's ratio typed as a px size.
- Paintings already stored stay in the browser's storage, unread. A workspace backup no longer holds paintings or brush presets; importing an older backup that has them imports the rest and says they are left out.

## 0.36.0 — Smudge, Clone stamp, OpenRaster: P4 begins (2026-10-22)

- **Smudge** (`R`, in the Brush flyout): drags the paint under it along, live; strength and finger painting.
- **Clone stamp** (`S`): Alt-click a source, then paint its pixels elsewhere; Aligned keeps the distance.
- **OpenRaster (`.ora`)**: export a page with its layers for other painting programs; import an `.ora` (compressed or not) as a new painting.

## 0.35.2 — A sheet's ratio from a size (2026-10-22)

- The sheet's **Ratio** field shows a size typed in px as its ratio: `2000 x 1920` (or `2000x1920`, `2000x1920px`, `2000 px x 1920 px`) becomes `25 : 24`, `1920 x 1080` becomes `16 : 9` (it was shown as a decimal when the ratio needed more than 20 on its smaller side).

## 0.35.1 — Brushes panel and backups (2026-10-22)

- A right-click (or a long press) on a brush preset opens its actions, in the Thumbnails view too.
- Layer masks are checked to travel in workspace backups.

## 0.35.0 — Reference pictures, crop to the selection: P3 done (2026-10-22)

- **Reference pictures** in the Paint view: library pictures floating over the view to paint from (not part of the page), moved, sized, faded, kept per painting.
- **Crop to the selection** (the Selection menu): the page becomes the selection's box.

## 0.34.4 — Pattern files (2026-10-22)

- **Import `.pat` patterns** in the Brushes panel: each becomes a preset with it as its texture (a group named after the file), and can be chosen as the texture of any brush.

## 0.34.3 — Symmetry (2026-10-22)

- **Symmetry** for the painting tools: left and right, top and bottom, four ways or diagonal, about the page's middle; the mirrors are one stroke with it.

## 0.34.2 — A brush from the selection (2026-10-22)

- **New brush from the selection** (the Selection menu): the selected pixels become a sampled tip, kept as a preset in Saved with its bitmap, and given to the Brush.

## 0.34.1 — Free transform of pixels (2026-10-22)

- **Free transform** in the Paint view: the Select tool on a paint layer (or a mask) lifts its pixels, or the selected ones, into a box to move (by whole pixels), scale, turn, and with Ctrl on a corner distort in perspective; Enter applies, Escape puts back; the selection goes with them.

## 0.34.0 — Selections, fill bucket, gradient, canvas and image size (2026-10-22)

- **Selections** in the Paint view: Rectangle and Ellipse marquee (`M`, `Shift+M`, in the Select button's flyout), the Lasso on a paint layer, the Polygonal lasso (`Shift+L`) and the Magic wand (`W`) in the Lasso's flyout; new, add (Shift), take away (Alt), intersect (Shift+Alt); feather; the Selection menu (select all, deselect, invert, grow, shrink, feather) and `Ctrl+A`, `Ctrl+D`, `Ctrl+Shift+I`. Painting, filling and the gradient stay inside the selection; `Delete` clears it.
- **Fill bucket** (`G`) and **Gradient** (`Shift+G`): fill a region of about one colour; a linear, radial or angle gradient from the paint colour to clear.
- **Canvas size and image size:** a page's new size keeps the pixels (placed by an anchor, the middle at first) or scales the whole picture.
- Mirroring the view is in the View rotation menu only (`M` is the Rectangle marquee now).

## 0.33.2 — Rotate and mirror the view, layer masks (2026-10-22)

- **Layer masks** in the Paint view, on any kind of layer: *Add a mask* in its ⋯ menu; press the mask's picture in the row to paint it (dark paint hides, light paint or the Eraser shows), the name to paint the layer again; turn it off and on, or delete it. Kept in the painting, in undo and in archives.

- **Rotate and mirror the Paint view:** `4` and `6` turn it 15°, `M` mirrors it, `5` resets; the angle button among the view controls opens the same choices. Every tool works on the turned view (the Brush, the Pencil, the Eyedropper and the canvas's tools on vector layers); Fit fits the turned page. Only the view turns, not the pixels.

## 0.33.1 — The Eyedropper (2026-10-22)

- **Eyedropper** (`I`), one tool for the canvas and the Paint view: a click makes the colour under it the pen (or paint) colour, one pixel or the mean of a square up to 101 px. In the Paint view it reads the page as it looks (**All layers**, without the checkerboard) or the picked layer alone (**Layer**); Alt-click with a painting tool makes the same pick.
- The colour button is in the Properties bar for the Eyedropper too.

## 0.33.0 — The Pencil (2026-10-22)

- **Pencil** in the Paint view (`Shift+B`, or the Brush button's flyout on the rail): whole pixels, no smoothing, one pixel wide at first. **Auto erase**: a stroke that starts on the paint colour erases.
- Picking a layer in the Layers panel now takes the canvas's tools to it at once (Select sometimes picked a vector layer's shapes on a paint layer, or nothing on the vector layer).

## 0.32.3 — Paint panels match the app (2026-10-22)

- The **Actions bar** works in the Paint view again (its buttons did not take the pointer over the page).
- **A plain mouse wheel scrolls a bar sideways** when it is wider than the window (the Properties bar, the Actions bar, the dock, the view controls, the text format bar, the Settings tabs), in both views; Shift+wheel still works.
- The Paint view's **Layers** and **Adjustment** panels are the dock's panels, like the canvas's Layers panel (title bar, fold, move, close).
- **Brushes panel:** tips drawn in the theme's ink (some showed green); a **Thumbnails** view (the tips in a grid, with their sizes) beside the list. The Brushes button shows the tool's tip; the picked preset and the open button have a ring, not the accent fill.
- **Brush settings** laid out as the other panels: padding, wider labels, menus for long choices (controls), switches two to a line, a curve only under a controlled jitter.

## 0.32.2 — Brush presets in backups (2026-10-22)

- **Workspace backups carry the brush presets** with their tips (archive format 6); importing adds the presets the library does not have yet.
- The Canvas button (∞) stays beside the painting's name in the Paint view, the way back to the canvas.

## 0.32.1 — Brush mode, pinned sections, response curves, choose a tip (2026-10-22)

- **Brush settings:** the brush's blend **mode**; a **curve** for each controlled jitter (pressure, tilt, wheel, …), with the Curves control of the adjustments; a **pin** per section keeps it when another preset is picked; **Choose a tip** (round or a preset's picture) and **Choose a pattern** for the texture (procedural or a preset's picture).

## 0.32.0 — Brush presets, brush files and Brush settings (2026-10-22)

- **Brushes panel** in the Paint view: brush presets in groups and folders with a picture of each tip; a press gives one to the Brush or Eraser. 36 presets to start with. **Save** the tool's brush as a preset; rename, delete, find by name.
- **Brush files:** import Photoshop `.abr` files (tips and settings) and canvast brush files (`.json`); export a group or all presets as either.
- **Brush settings panel:** the tool's whole brush, section by section (Tip, Shape dynamics, Scattering, Texture, Dual brush, Colour dynamics, Transfer, Pose, Noise, Wet edges, Build-up, Smoothing), with pen pressure, tilt, wheel, rotation, fade and direction as controls.
- Spacing goes up to 1000 %.

## 0.31.0 — One set of bars and tools for the canvas and the Paint view (2026-10-22)

- **The Paint view has the canvas's bars:** the same tool rail, Properties bar, Actions bar, dock and view controls, in the same places. Picked shapes on a vector layer get the canvas's fill, outline, corners, align, boolean operations, masks, groups and export.
- **One rail of tools for both views.** A tool in both views is one tool: Hand, Select, Edit nodes, Pen, Shape and Path, Lasso, Text, and the Eraser, which takes shapes on the canvas and on a vector layer, and paint on a paint layer. The Paint view adds the **Brush**; the canvas keeps Sheet, Note, Import, Screenshot and Search.
- **One keymap for both views.** Tool keys can be changed once for both; a key can mean one thing in each view (`B`: the Brush in the Paint view, Path on the canvas).
- The Brush's options and colour are in the Properties bar (the colour is the Pen's). The painting's name, page size and menu (rename, page size, export, place on the canvas) are beside the view tabs; Layers floats at the right (the dock's Layers button) and the pages at the bottom left.

## 0.30.0 — Vector layers with the canvas's tools (2026-10-22)

- **Vector layers** in the Paint view: one layer holds any number of shapes, paths, pen strokes, texts and pictures (**+** > *Vector layer*, or just draw: with a paint layer picked, the first shape makes a vector layer).
- **The canvas's own tools on them:** Select (`V`), Edit nodes (`N`), Pen (`P`), Shape (`U`, Path among its kinds), Lasso (`L`) and Text (`T`) are the canvas's, with its handles, rotate zone, node editing, text editor, modifier keys, touch gestures and keys (Delete, Ctrl+D, Ctrl+G, Ctrl+[ ], Esc, Enter); sizes are in page pixels. Every change is one step of the painting's undo.
- **Copy, cut and paste** of shapes with a vector tool, as on the canvas (also between the canvas and the Paint view).
- The Paint view's own Move tool is gone (Select does it); the canvas's cursors show on the page.

## 0.29.0 — Shape, text, picture, fill and adjustment layers in the Paint view (2026-10-22)

- **New layer kinds** (the **+** of the Layers panel): a **fill layer** (the page in a colour, gradient or texture), an **adjustment layer** (the canvas's adjustments on everything below it; its numbers can be saved as a style), a **pattern** (any of the pattern generators over the page; *New seed* makes it again) and **a picture** imported from a file.
- **Shape** (`U`: rectangle, ellipse, polygon, star, line, with fill, outline and width), **Text** (`T`), **Move** (`V`, with resize handles) and **Edit nodes** (`N`) tools, each on a layer of its own, measured in page pixels and drawn exactly as on the canvas.
- **Rasterize** (a layer's ⋯ menu) turns any of them into a paint layer of the same look; the Brush says so when the picked layer is not a paint layer.
- **Paste** objects copied on the canvas as a shape layer, a picture as a picture layer.
- Pictures, fonts and textures used by paint layers are kept by the library's clean-up.

## 0.28.0 — The Paint view (2026-10-21)

- **Paint view** (beside Library): paintings of the workspace, each with pages of a real size (px, or in, cm, mm at a DPI; presets for screens, A4 and Letter at 300 DPI), a background (white, transparent or a colour) and raster layers. Its own rules: no endless zoom (a sixteenth of the fitted page to 6400 %), square pixels from 200 %.
- **Brush and Eraser** on a new brush engine (WebAssembly, in a worker): size, hardness, opacity, flow, spacing, pen pressure on size or opacity; `[` `]` size, Alt-click picks a colour, Shift-click a straight line.
- **Layers:** new, delete, rename, move, hide, lock, **clip to the layer below** and **alpha lock**, blend mode and opacity. **Pages:** new, rename, resize, move, delete. Undo and redo of their own.
- **Export** a page as PNG, or **place it on the canvas** (it goes in the library as a picture).
- **Backups** carry the paintings (archive format 5); imported paintings get new ids, and every tile is checked.
- Storage schema 11; the page's security policy allows WebAssembly to be compiled (`'wasm-unsafe-eval'`, not `eval`). Building needs the Rust toolchain with the WebAssembly target.

## 0.27.0 — Adjustments on shapes, shadows, pattern styles (2026-10-21)

- **Adjustments on shapes, pen strokes and texts:** the Adjust panel now works on them, as they look once drawn (fill, outline, gradient and texture together). Colour adjustments go through the SVG filter on the graphics card (no pixel readback); blur is a share of the object's own size, so it does not change with zoom, and keeps a width of at most about 330 px far inside an object.
- **Drop shadow and inner shadow** (opacity, across, down, blur, spread, colour) for pictures, shapes, strokes and texts. A shadow turned on starts soft and a little below. A group's **Reset** button puts back that group of adjustments.
- **Export** of a selection leaves room for a blur or a drop shadow (the picture is no longer cut at the shape's box); SVG export writes the adjustments as a filter with room for them, and importing that SVG brings the adjustments back.
- **Fixed:** a view with a blurred shape is drawn directly, not from tiles (grid seams); zooming out from depth no longer shows a bare border while the exact view builds (a prebuilt set is swapped in).
- **Scrubbing:** the adjustment numbers and the colour picker's opacity and channel numbers can be dragged; with **Shift** a dragged number snaps to round steps worked out from its range (100: 5, 255: 10).
- **Pattern generator:** the seed works in all 39 generators (the regular ones got a *Looseness* setting; 0 stays exact), *New seed* says when it changes nothing, Scales no longer lose their lower rows past 600 shapes (Across up to 12), the actions are icons.
- **Pattern styles** (Styles panel, Patterns tab): save a generator with its settings and seed from the Pattern panel, press a card to put it back and make it on what is picked (on each of several picked shapes), update it from the panel.

## 0.26.4 — A zoom in is just a zoom in (2026-10-21)

- **Fixed:** going to a bookmark that was in view (or nearly: its centre within one view width of where you are, or the other way round) first zoomed out and then in (showcase bookmarks 8 to 12). Now it is one zoom about the point that maps one view to the other, like the wheel, in any direction. This holds at any depth, a million levels included (the numbers are kept in the deeper frame, so nothing grows with the depth).
- **Fixed:** the zoom-out of a flight between far places was about ten levels too deep (the width of the window was left out).
- **Flights over 20,000 levels** now only dive (dip to dark) when the two places are also more than a view apart.

## 0.26.3 — One continuous flight between views (2026-10-21)

- **Fixed:** going to a bookmark in another frame or depth jumped out of one view and into the other. The camera now flies one continuous path (van Wijk and Nuij's "smooth and efficient zooming and panning"): it zooms out through every level until the two places are about a view apart, crosses at constant speed and zooms in to the other, exactly, up to 20,000 levels apart; beyond that it still dives with a dip to dark. Near trips use the same path.

## 0.26.2 — Why a trip cut (2026-10-21)

- **Found:** with Animation on System and the operating system asking for reduced motion, every trip cut. Now the view says so once ("The view jumped because your system asks for reduced motion"), and *Follow the system's reduced motion* (Settings → Navigation) can be turned off to glide anyway. Animation set to None still cuts.
- **Travel time (base)** is its own setting (0.1 to 3 s, 0.5 s at first) and no longer follows *Animation speed*.

## 0.26.1 — Fade at the switch, tour speed (2026-10-21)

- **Fade at the switch** (Settings → Navigation, on): a far trip dips the canvas dark for a moment where it switches from the zoom-out to the zoom-in, so it is not seen as a cut.
- **Tour: travel speed** (Slow / Normal / Fast) for the glides between tour stops.

## 0.26.0 — Camera travel and bookmark keys (2026-10-21)

- **Camera travel** (Settings → Navigation): a far bookmark (another depth or frame, or too far to show the way) no longer cuts; the view zooms out from here and in to there. *Travel to a bookmark*: Fly / Glide near only / Cut. *Travel time*: grows with the distance or fixed, up to *Longest trip*. *Travel easing*: smooth, linear, ease-out.
- **Tour:** *wait at each stop* (0 to 10 s) makes the tour move on by itself once the view has arrived; moving the camera yourself stops it.
- **Bookmarks:** drag a card to reorder (or *Move up* / *Move down* in the ⋯ menu); `Alt+1`…`Alt+9`, `]` and `[` go to a bookmark (Shortcuts); a button and a palette command bookmark the picked things.

## 0.25.11 — Colour names, palettes copy too (2026-10-21)

- **Pasting a colour name** (`red`, `rebeccapurple`) makes it the fill, or a colour style in the Styles panel; a word that is not a colour name changes nothing.
- **Palettes:** a right click or long press on a palette card copies it as CSS variables; on a colour of an opened palette, as hex (it is not applied).

## 0.25.10 — Copy: pictures alone, edited stills, GIF frames (2026-10-21)

- **A copied picture goes alone** (no "N objects" text next to it, which made some apps paste text): one still as a PNG at full size with its crop and adjustments baked in; a GIF or video as the frame it shows.
- **A shape with a picture or objects fill** is copied as a PNG, not as SVG text (the embedded images would be megabytes); an SVG over 1 MB is never put on the clipboard as text.
- A paste in canvast knows its own picture while the window kept the focus and nothing else was copied from the app (a browser may re-encode the picture, so the bytes cannot say).

## 0.25.9 — Ctrl+C reaches other apps (2026-10-21)

- **Copy** puts the shapes' SVG as text and a PNG picture of a copied sheet, picture or shapes on the system clipboard, next to the objects canvast keeps for pasting back. A paste in canvast checks for its own objects first, so a copy comes back as the objects themselves, not as an SVG import or a picture; anything copied elsewhere still imports as before. Cut stays text only.

## 0.25.8 — Picker: copy swatches, # in the hex field (2026-10-21)

- **Colour picker package:** copying the whole hex field puts `#RRGGBB` on the clipboard and pasting `#RRGGBB` drops the `#`; a swatch is copied (not chosen) by a long press, a right click or Ctrl/Cmd+C, with `onCopy`, `onLongPress`, `copyToClipboard` and `flashCopied` exported.
- **App:** the same on a saved gradient in the fill picker (copies its CSS) and, by a long press, on the colour and gradient cards in Styles.

## 0.25.7 — Styles: right-click copy and paste (2026-10-21)

- **Styles panel:** a right click on a colour or gradient card copies it (hex or CSS); *Copy hex* and *Copy as CSS* stay in the More menu (touch, keyboard). CSS pasted with the pointer over the panel, or with nothing picked, is saved as a new colour or gradient style.
- **One place for the CSS text:** `app/css-paint.ts` holds both halves (`parseCssPaint` for paste, `cssOfPaint` for copy), used by the canvas paste and the Styles panel.
- **Fixed:** an angular gradient's Styles card said "Radial".

## 0.25.6 — Paste a colour, copy a gradient as CSS (2026-10-21)

- **Pasting a solid colour** while shapes are picked makes it their fill: `#rgb`, `#rrggbbaa`, `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()` and `color()`, with or without `color:`, `background:` or `fill:`. A colour outside sRGB is clipped to it. A colour word alone (`red`) is not taken, as it is more likely text.
- **Styles panel:** a gradient has **Copy as CSS** in its More menu (a colour already had **Copy hex**); the text pastes back onto a fill.

## 0.25.5 — Paste a CSS gradient onto a fill (2026-10-21)

- **Pasting CSS gradient text** (`linear-gradient(...)`, `radial-gradient(...)` or `conic-gradient(...)`, with or without `background:`) while shapes are picked makes it their fill. Angles, `to <side>`, `at` positions and stop positions in percent (degrees for a conic) are read; a repeating gradient, positions in lengths and anything unreadable are left alone (nothing changes). The box is taken as a square, so a linear angle on a wide shape differs slightly from a browser.

## 0.25.4 — A pen stroke picked alone can be recoloured (2026-10-21)

- **Fixed:** with one pen stroke picked there was no colour control (the pen colour button is for new strokes, and the Fill and Outline buttons are for shapes), so its colour could not be changed. Its colour now shows as a chip in the Properties bar, like the colours of a larger selection; it offers a flat colour only (a stroke has no gradient).

## 0.25.3 — What you export is what you see: no colour changes by theme (2026-10-21)

- **Removed the theme mapping of the default ink.** The default pen and outline colour (near-black, `#1f2329`) used to be drawn as a light ink on a dark canvas while the document kept the near-black, so the canvas and an exported SVG or PDF could disagree (v0.25.2 patched the files; this removes the cause). Now nothing is mapped when drawing or exporting: the canvas, picture exports, SVG and PDF all use the stored colours as they are. The default ink is chosen once, when a shape, line, pen stroke or text is made: on a dark canvas it gets the theme's readable ink as a real colour (stored with it), on a light canvas the near-black; a colour you picked is always kept. The chips of the tools show the colour the next object will have. Changing the theme later does not change what is already drawn.
- **Gradients written by other design tools are read better.** A radial gradient whose size is in its own transform (`r="1"` with `gradientTransform="... scale(143.5)"`, how design tools write it) came in with a tiny radius, so the shape was one flat colour; the transform's scale now counts. An angular gradient written as an HTML box with a CSS `conic-gradient(from 90deg, colour 0deg, ...)` inside a clipped group (SVG has no angular gradient, and many SVG viewers show such a box empty) was not read at all ("not an SVG drawing this app can read"); it now becomes the clip's shape with a real, editable angular gradient (centre, start angle with the box's turn, stops; a mirrored box runs the colours the other way round). A diamond gradient (four mirrored rectangles with a linear gradient, cut by the shape) is read as what it is, a clipped group; there is no diamond gradient here.
- **Which gradient are the handles on?** When a shape has a gradient as both its fill and its outline, the handles on the canvas belong to one of them and nothing said which. They now say so: the hint line under the tool options names whose gradient the handles are and of what kind ("Drag the round handles on the shape to move its outline's radial gradient · Press Fill in the bar above to edit its linear gradient instead"), and a handle names itself under the pointer and while it is dragged ("Fill · linear gradient · start", "Outline · angular gradient · start angle 135°"; the angular handle was called "radius" before). A new pick starts with the fill's gradient again (the focus set by pressing Fill or Outline is no longer kept for the next shape).
- **Older drawings:** objects that were made with the default ink keep the near-black, so on a dark canvas they now show as stored (dark). The command **Change the old default ink to the canvas ink** (command palette, on a dark canvas) gives every such colour (outlines, fills, pen strokes, text and its outline) the canvas's ink in one undo step; locked objects are left.
- **SVG now keeps an outline inside or outside its edge** (it was drawn centred): the line is twice as wide, cut to the inside by a clip path or to the outside by a mask, as the canvas does, and the export box now holds the whole outline (an outside outline, and the tips of mitered corners, were cut off at the edge).
- **Audit:** the canvas, a PNG and an SVG of a mixed scene (gradients with transparent stops, dashes and round caps, rounded corners, fill opacity, object opacity, even-odd fill, miter, bevel and round joins, butt caps) were compared and match. What an SVG cannot say is an angular gradient: it is now written as a picture of the gradient (a PNG of up to 384 px a side) inside the SVG, cut to the shape (fill) or to the line (outline), and a warning says so in the Export dialog (when SVG is chosen), in Save to library as SVG and in Copy as SVG. The real gradient also rides on the element (`data-canvast-fill`, `data-canvast-stroke`), so a file saved by canvast can be made editable again: *Make vector copy* of the saved SVG picture, or pasting its text, brings back the shape with its real, editable angular gradient (other programs show the picture). Without a page to draw on (the unit tests) a linear stand-in is written. The PDF of it is made as a picture.

## 0.25.2 — The default outline keeps its look in an SVG or a PDF (2026-10-21)

- **Fix:** the default outline colour (the near-black default ink) is drawn light on a dark canvas, and a picture export (PNG, WebP, JPEG, a screenshot) drew it that way too, but Save as SVG, Copy as SVG, Save to library as SVG and the PDF wrote the stored near-black. So shapes with the default outline looked light on the canvas and dark in the saved SVG. The SVG and the PDF now write the default ink as the canvas draws it (light on a dark canvas, the stored colour on a light one). Only the default ink is mapped; every other colour, and gradient stops, are written as they are, and what is stored in the document does not change.

## 0.25.1 — Exports are cut to the sheet (2026-10-21)

- **Fix:** a pattern (or any shape) that runs past the sheet it is on was exported inconsistently. The picture (PNG, WebP, JPEG) was cut to the sheet but sized from the whole pattern, so a pattern picked by itself came out as a big picture with the visible part small inside and the rest empty; the SVG and the PDF did not cut it at all, so the pattern showed in full, past the frame, and a sheet's SVG was as big as the pattern, not as the sheet. Now every format agrees with the canvas: what is on a sheet that clips (a sheet, or a clipping mask) is cut to it, and the frame of the export is the part that shows (the sheet's, when a pattern fills it and runs past it), whether the sheet or only what is on it is picked, in Export…, *Save as SVG*, *Copy as SVG* and *Save to library as SVG*. In the SVG the sheet's shape is a `<clipPath>` and the shapes on it are inside a group that uses it; in the PDF it is the clip of each shape's drawing; a shape wholly outside its sheet is left out.

## 0.25.0 — Pattern generators; the Pattern fill is now Objects (2026-10-21)

- **Renamed:** the paint chooser's **Pattern** fill (objects of the canvas repeated over a shape) is now **Objects**, in the interface, the code and the docs, so that **Pattern** names the new pattern generator panel. Stored documents are unchanged (the source kind was always `objects`). Older entries below keep the name they had at the time.
- **Each kind of saved thing has its own folder and tags** (Settings > Media and playback; each is a pair of settings, comma-separated tags, empty for none): pictures from Export… go to **Exports** with `#export` (as before); a saved **pattern** (Export… or Save as SVG on a sheet or pick that holds one made by the Pattern panel) goes to **Patterns** with `#pattern`; picked shapes saved as an SVG go to **Shapes** with `#shape` (they were filed nowhere before). Screenshots, extracted frames and edited pictures keep theirs.
- **The generators ship on their own** (not published yet): `src/gen` imports nothing from the app and touches no page, and `npm run build:patterns` writes `dist-patterns/` (a script with the global `CanvastPatterns`, an ES module, TypeScript declarations and a demo page with every generator, its settings, a seed, Randomize and Download SVG). `toSvg(shapes, w, h)` writes a standalone SVG. [src/gen/README.md](src/gen/README.md) has the API, the generator list and how to add one. `npm run check:patterns` (part of `npm test`) keeps the folder self-contained; `tests/e2e/patterns-package.spec.ts` opens the built demo.
- **Pattern panel** ([ADR 0162](docs/adr/0162-pattern-generators.md)): a new panel (the mountain button in the dock, or *Pattern* in the command palette) with 39 generators of vector patterns, each with the settings of its own. Choose one, change the settings, and press *Generate*; from then on every change replaces the result live, and the whole session is one undo step. *Randomize* picks random settings and a new seed, *New seed* keeps the settings and tries another arrangement, and the seed can be typed, so a result can be made again.
- **Where it goes:** on the picked sheet, on a picked closed shape (a copy of the shape becomes a clipping mask that cuts the pattern to its outline; the shape itself is untouched), or on a new sheet in the middle of the view when nothing is picked. The result is a group of ordinary editable vector shapes (several shapes of one colour are one path), with a background shape that the eye button can hide.
- **The generators:** Waves (Ripple, Tides, Dunes, Terraces, Ridges), Blobs (Pebble, Drift, Bubbles, Shards), Soft (Glow, Blend, with gradient fills), Lines (Stripes, Chevrons, Dots, Checks, Rings, Rays, Spiral, Orbits, Confetti, Stars, Grid, Halftone, Strands), Tiles (Tiles, Bricks, Scales, Weave) and Fields (Contours, Cells, Cracks, Facets, Flow, Branches, Maze, Ribbons, Marble); Grain and Aurora are in Soft.
- **A pattern remembers how it was made:** the generator, seed and settings are kept on the first shape of its group (`gen`, saved, copied, duplicated and exported with it). Picking the pattern loads them into the panel, and every change replaces its shapes where they are (same sheet, same group, same place in the stack).
- **Picker with pictures:** the generator list is a grid of small pictures of what each makes, by family.
- **Freeze (snowflake) on every setting:** *Randomize* leaves frozen settings as they are, so a colour scheme can be kept while the shapes change.
- **Tests:** `tests/unit/pattern.test.ts` (every generator: sound shapes, same seed same shapes, random and extreme settings in wide, tall and tiny boxes), `tests/e2e/pattern.spec.ts` (new sheet, live replace, hide background, one undo step; picked sheet; picked shape; Randomize).

## 0.24.5 — A sheet drawn over objects takes them (2026-10-21)

- **Sheet tool:** a sheet drawn over objects now puts the ones wholly inside it on the sheet (above it, so they stay in sight), in the same undo step. It takes objects at its own level only (not ones on another sheet, unless it is drawn on that sheet), with what is in their group or on them; locked and hidden ones are left, and an object it only crosses stays out. A notice says how many it holds.

## 0.24.4 — A group is one thing for Align and Arrange (2026-10-21)

- **Fix:** Align, Distribute and Arrange split a boolean group picked as a whole into its shapes and moved them separately. A group, and a boolean group, picked as a whole is now one unit: it is lined up with what else is picked (its shapes keep their places among themselves), and picked alone there is nothing to line up. To line the shapes of a boolean group up with each other, pick them one by one (in Layers, or enter the group first).
 — The ends of a gradient snap (2026-10-20)

- **Fix:** dragging a gradient's handle on the canvas ignored the Snap toggle. With it on, the handle (the ends of a linear gradient, the centre and radius of a radial one, the angle handle) now lines up its x or y with the edges and middle of anything in view, the shape it paints included, or with a node of a path, within 6 px, and the guide line shows; with it off it moves freely, as before.

## 0.24.2 — A thing picked through Reveal can be moved (2026-10-20)

- **Fix:** after Ctrl+click picked a thing under a filled shape, a drag from its outline drew a selection box instead of moving it, because the press landed on the covering shape, which was not picked. A press within 8 px of the outline of a picked thing now takes that thing, so the drag moves it; a click that does not move still picks the thing on top.

## 0.24.1 — Ctrl+click on a revealed outline picks what the outline belongs to (2026-10-20)

- **Fix (Reveal):** the outlines of things under a filled shape were shown, but Ctrl+click on one picked the filled shape on top, because it also covered the spot. A click within 8 px of an outline now picks the thing that outline belongs to (the nearest one); away from every outline it still picks the top thing, and Ctrl+Alt+click still goes down the stack.

## 0.24.0 — Progress you can see; the library index follows by itself; Settings tidied (2026-10-20)

- **Progress notices** ([ADR 0161](docs/adr/0161-progress-notices.md)): exporting (backup, changes, library index, files ZIP), reading and importing an archive, opening a library, importing files, moving files into or out of the library folder, adding extensions and Start from scratch show a notice with a bar and the stage ("Exporting the backup: reading the library (12 of 30) 40%") that stays until the work ends and then says the result. Before, "Preparing the export…" faded after a few seconds while the work went on.
- **The library index is kept up to date by itself** while a library folder is in use: about 20 seconds after the last change (a commit, an import, a move of files, a setting), at most once a minute, not while another tab is the writer, only when something changed. A checkbox on the card turns it off; *Save index* writes it at once. A failure is said once and tried again after the next change.
- **Settings > Storage:** each action is a row (a short button and what it does beside it) in the Library folder and Backup cards, and the buttons look like the app's others.
- **Settings tabs** have an icon each and are indented under their group; the Reset of every setting is an icon (undo with a dot) instead of the word.

## 0.23.1 — The library index is its own kind of file (2026-10-20)

- The file that carries the canvases beside the library folder's files is now the hidden **`.canvast-index`** (it was `canvast-library.canvast`, which looked like a backup; the old name is not read any more), called the *library index* in the app. It is told apart from a backup by its content: a library index picked through *Import archive* is refused with where to go instead, a backup is refused by *Open library index from the folder*, and the open dialog says "This is a library index: ... without the files". The card says plainly that it is not a backup and not a cache to delete.

## 0.23.0 — Library file for a second device; start from scratch (2026-10-20)

- **Library file:** on the Library folder card, *Save library to the folder* writes `canvast-library.canvast` beside the files (the whole workspace without the files; not a backup) and choosing a folder that holds one offers to open it at once, and *Open library from the folder* adds its canvases and matches every file by its name, so a folder synced to another device opens there with its canvases, names, tags and folders. Manual for now.
- **Start from scratch:** Settings > Storage has *Delete all data…*: a warning that says what goes, offers a backup, the files as a ZIP and the library file first (each ticks off when done), says that the library folder's files are never touched (canvast does not delete files from your disk in bulk), and needs `DELETE` typed. It then deletes canvast's database and its own `localStorage` keys (not other pages') and reloads.

## 0.22.3 — Library folder files keep their extension (2026-10-20)

- Files in the library folder are named `<sha256>.<ext>` (from the file's own name, else its type), so other programs and the file manager can open and preview them. Files made before this keep their bare-hash name and still work; **Add file extensions to N files** on the Library folder card writes them again with one (each proven before the old one goes).
- A file written to the folder that does not read back the same is removed, not left behind.

## 0.22.2 — One Storage page (2026-10-20)

- **Settings > Storage** holds everything about storage in four cards: Space, Library folder, Saving and Backup. The save indicator opens it. The popover it used to open is removed (it repeated the space and backup lines). The library folder card shows how many files are in the folder and in the browser, and turns off *Choose another folder* and *Stop using this folder* while files are in the folder.

## 0.22.1 — Library folder: SVG files show (2026-10-20)

- **Fix:** an SVG kept in the library folder showed as a broken picture: the folder's files have no extension, so the browser gave them no type, and an SVG needs `image/svg+xml`. A file read from the folder now gets the original's type back (also in backups and when moved back). Nothing stored needs repair: the type was always kept.

## 0.22.0 — Library folder (2026-10-20)

- **Library folder** (Chromium, ADR 0159): pick a folder in the storage panel (Settings > Storage since 0.22.2) and new originals are kept there as plain files named by their SHA-256, outside the browser's storage limit. Each file is written, read back and compared before the browser keeps a stub of it. *Move browser files into the folder* and *Move files back into the browser* move what exists; *Reconnect folder* after a restart; files missing from the folder are flagged like missing originals; backups read the folder's files and refuse to leave one out; erasing an original removes its file.
- Schema 10: an index on the stubs. Nothing is converted.

## 0.21.1 — Full storage is reported, not silent (2026-10-20)

- An import that does not fit the browser's storage is refused in plain words (export a backup, delete unused files) and stores nothing half-way; it was the browser's raw error.
- The browser is asked once to keep the data under storage pressure (first import), and a notice appears once when 80% of its quota is used.

## 0.21.0 — Settings for corners, density and theme; panels in one shape; linked styles; Phase 8 groundwork (2026-10-19)

- **Settings (Appearance):** Corners (Round or Sharp, every radius and the handles on the canvas), a third density (Dense), Actions bar (at the bottom or following the selection), and an Adaptive theme colour that takes the hue of the canvas background.
- **Panels** are built by one helper (ADR 0156): optional header, strip, scrolling body and footer. The Adjust panel keeps its layer row and its save row in place, with Reset beside the close button.
- **Linked styles** (ADR 0157): an object painted with a saved colour or gradient (and a picture with a saved adjustment) follows it when it changes; a change by hand unlinks it.
- **Media player** always sits right under its item; the Actions bar steps above the item or under the player.
- **Phones and small screens:** scroll cues (fade and arrow) on every bar that scrolls, the library bar wraps with a thumbnail slider, the Settings tabs scroll, the tool options share the top row on medium screens, panel spacing follows density.
- **Colour picker:** no preset colours (only recent and saved), a real eyedropper icon, a wider ring, and the gradient editor's numbers in one column.
- **Menus** keep one gap from their bar and no longer start a few pixels off while they open.
- **Fills and the colour picker:** an image fill takes its picture from the library first (a panel with search and thumbnails), then from the canvas, then from a file; a picture or pattern fill keeps showing its own colour where it is too deep to be drawn as a pattern (it showed the flat average); the last pattern stays on screen while the next one is being made; Grid, Align and Mode end at the right edge; every number field has the drag-by-name scrub (the texture editor and the export dialog had none); saved gradients, recent and saved colours wrap and scroll instead of widening the picker, with a "Show all" button that opens the Gradients of the Styles panel; the gradient editor has a randomize button, and a stop's colour can be saved.
- **Randomize:** a shuffle button in the gradient editor (any opaque colours, positions, angle, centre, radius) and a Randomize button for pattern and image fills (one undo step). Saved gradients refresh at once after a save, in the picker and in the Adjust panel's gradient map, which also gets Show all and Save colour of this stop. Levels shows one label and one number per row.
- **Save to library:** the Export menu and the command palette save the picked shapes to the library as an SVG picture (the file the Export dialog writes as SVG; the separate "Save as SVG" item is gone), with a View button in the notice.
- **SVG export of a picture fill** is the picture itself (one embedded PNG, cut to the shape by a clip path, repeated for Tile), not its average colour. design tools drop `<pattern>` on import and keep `clip-path`, so it is written like a pattern of objects.
- **Settings:** Corners now sits in the Size and comfort card under Density; the Interface size and Contrast options are removed (the interface keeps one size and the default contrast; Motion stays).
- **Shape handles and boxes:** a path's box is the shape as drawn (a rounded star no longer keeps the empty space of its sharp tips; ADR 0105 changed); the radius handle shows a rounded corner, each corner's own dot too, the ratio handle a small star; the point-count handle shows the arc it slides along, as the radius and ratio handles show their line; the gradient handles are hidden while the nodes or the corners one by one are edited; with the corners opened out, a lasso from empty ground picks several corners and dragging one moves them all (one undo step).
- **Shortcuts (ADR 0158):** every shortcut can be changed in Settings > Shortcuts, to one key or a chord (`F`, `Alt+Q`, `Ctrl+Shift+F`), with several keys for a command; warnings for a key another command has, for one the browser or the system may take, and for one that cannot be used; one button resets them all. Copy, cut, paste, Escape and Enter stay as they are.
- **Focus and fit** is F (again: fit everything), not an Alt tap; Alt is left to its editing jobs. Radius and node editing end by themselves when the shape is let go.
- **Edit nodes:** a "+" cursor where a click adds a node, and a label beside the pointer that names what the keys do over a node, a handle or an edge (the same kind of label the radius, ratio and count handles have).
- **Actions bar:** Apply rotation (beside Reset rotation) makes the turn of a shape its own, the new zero; the selection options (corner-radius lock, snap, axis box) are a bar of their own beside it (one shared parent, so they line up); the screenshot button is in the tool rail above Search; the gallery viewer has the whole page (view tabs and gear hidden) and its slideshow button, icon only, sits between Previous and Next.
- **Initial state menu:** Set, Update and Reset to initial state are one grouped menu on the Actions bar, before Bring to front, with matching map-pin icons (they were three loose buttons with unrelated icons).
- **Initial shape and paint:** a new setting (Drawing, Shapes) makes Set/Update initial shape save the fill and outline too, and Reset puts them back (on by default); the pin buttons are now named Set, Update and Reset to initial state.
- **Fix:** a fill's option menu no longer blinks at every value change.
- **Licence:** canvast is MIT-licensed, copyright 2026 emarpiee: a `LICENSE` file, `package.json`, the README, and the licence text embedded at the top of the built file beside the third-party notices.
- **Fix:** notices stack above the Actions bar when it is at the bottom; one could cover it and take its clicks.
- **Pattern fills:** a pattern of a pattern shows the inner pattern (up to three levels; a cycle or itself shows the average colour) and follows a change of the innermost source; the average colour of a sparse pattern is the colour of its shapes, no longer pale or white; an SVG export of a pattern keeps the shapes as vectors, one copy for each tile, cut to the shape (no `<pattern>`, which some viewers show empty, and no pictures), no longer one flat colour.
- **SVG import:** a `clip-path` becomes a clipping mask holding what it cuts (a pattern exported as SVG and made editable again stays inside its shape).
- **Phase 8 groundwork:** startup marks, a cheaper search, a low-memory tier, an upgrade test for a replaced HTML file, a qualification script.

## 0.20.0 — Texture fills: a picture or a pattern as the fill of a shape (2026-10-19)

- **Image fill**: Fill, Fit, Crop or Tile a picture of the library in a shape, with Scale, free Rotation, Offset, and for a repeat Grid (rows, brick rows or columns), Align and Space; the picture is picked on the canvas or chosen as a file.
- **Pattern fill**: any objects of the canvas repeat over a shape on the same grids; the pattern follows when the objects change (ADR 0154).
- The picture of a fill is kept by the library while a shape uses it, and travels in archives.

## 0.19.2 — Picture, reveal and export gaps (2026-10-19)

- **Pictures**: the outline can be a gradient (with handles on the canvas); a picked picture has the radius dots on the canvas (also turned); a click in a cut corner does not pick it (ADR 0153).
- **Reveal** also shows locked things, hidden things and the parts of a mask, dotted, with the reason in the words; Edit nodes and Lasso reveal too; a screen reader hears the words through the hint line.
- **Export**: PDF of plain shapes is vector (paths, gradients, dashes, transparency), a page that needs a picture stays a picture; WebP carries its resolution (EXIF).

## 0.19.1 — Gaps closed and the bars moved (2026-10-18)

- **Grouped Actions-bar menus** (ADR 0151): Align (+Distribute), Arrange, Shapes (boolean ops), Masks and Path tools are one button each that opens a menu which stays open until Escape or a press outside; kind chips (All, Pictures, Media, Shapes, Strokes, Texts) at the start of the bar for a mixed pick.
- **Touch** (ADR 0151, 0152): a long press on Select lists what is under the finger; a two-finger tap is undo, three is redo; a finger resting while one drags is Shift, two is Alt; live degrees while rotating and a ratio while resizing.
- **Test snapshots**: `npm run test:snap` runs the E2E suite against its own build in `test-builds/`, so `dist/` can be rebuilt meanwhile; `npm run test:status` compares them with the source.
- **Masks** now cut what you can pick (an object is picked only where its mask shape is, or is not when inverted) and **Export as SVG** writes them as `<mask>` (ADR 0144).
- **Outline stroke inside or outside** the edge of a closed shape (ADR 0143), instead of always centred.
- **Vector networks** are cut where two edges cross when they are made (ADR 0146).
- **Screenshot**: it takes the selection, or the whole view when nothing is picked (the Area setting is gone); the notice has a View button that opens the picture in Assets; the button's tooltip says so.
- **Bars**: Undo, Redo, Search and Import are at the foot of the tool rail after a separator; the Settings button is the last button of the bottom-right bar on the canvas (it stays at the top right in the Assets and Settings views); the tool rail has the same gap under the Assets bar as the panels have under the top right bar.
- The dev panel is at most 20 rem wide (it covered the start of drags the tests make).
- **Docked panels**: each side has its own width, so resizing the left stack no longer resizes the right one (older saved layouts give both sides their saved width). In the tool rail, Undo and Redo are now the last two buttons.
- **Dice** (bottom bar, between Previous and Next view; also in the command palette): goes to a random place and zoom level with nothing of the canvas within two windows of it (`interaction/random-view.ts`); Previous view comes back.
- **Scale contents** now also works when a sheet is resized with its handles (it only worked with the Size fields).
- **Sheets deep in a zoom**: objects on a sheet that were filed in another frame than the sheet (near objects can be, once the zoom is deep) were left behind when the sheet was resized; they are now taken along, whatever the pins or Scale contents say (`planSheetScale`).
- **Scrub**: the X, Y, W and H of "On sheet" and the sheet Size fields can be changed by dragging their names, like the other numbers.
- **Sheets, made solid** (ADR 0133): resizing, the On sheet fields, Fit to contents, Put on a sheet and brush masks work when the objects are filed in different frames (deep in a zoom); sheet sizes and places are shown in six significant digits (not 0), and dragging a name changes a value by a screen pixel at a time.
- **Shapes, not sizes** (ADR 0147). A sheet has a **ratio** (type `16:9`, `A4 portrait`, `1.5`, pick a shape, or Turn it on its side; the area is kept) and no size in px. On sheet X, Y, W and H are per cent of the sheet. **Scale contents is kept with each sheet** (saved, undoable, shown for the picked sheet).
- **Export…** (Actions bar, sheet bar, command palette) for a sheet, a picture or shapes: the size comes from the shape. Type a width or a height (the other follows the ratio) in px, in, cm or mm at 72 to 600 ppi, or take a size the shape is made for (A4, Full HD, a story, the picture's own pixels …); PNG, WebP, JPEG or SVG; download, copy or keep in the library.
- **Docs**: [Shapes, sheets and masks](docs/reference/shapes-sheets-masks.md) says what each is, how they relate and when to use which.
- **Clipping masks are one unit**: a click on the output picks the whole mask (drag moves the output; the box is the mask's, not the picture's); a double click goes in to pick what it cuts, Escape comes out.
- **Alt+drag copies a thing even when something lies under it** (a picture on a sheet, a shape over another): Alt on a picked thing starts a drag of a copy; only an Alt click that does not move goes on to the thing underneath.
- **The empty body of a sheet with things on it is ground**: a click clears and a drag draws the selection box, so the sheet is not moved by accident; pick it by its name, its Layers row, a box, or Shift+Enter from what is on it (Enter goes in). **Release the mask** gives the shape back with the fill and outline it had.
- **Reveal**: hold Ctrl and move over the canvas to see the outline of everything under the pointer (the shape, not a box; the top one strong, the ones below dashed, their names beside the pointer); Ctrl+click picks the very thing, deep in a group, a mask or a sheet.
- **Align one thing to what holds it**: a single thing on a sheet (or in a group) is aligned with its sheet by the align buttons.
- **Pictures get rounded corners and an outline, with the shape controls** (ADR 0148): the shape's Radius field (one value or four corners) and its Outline swatch and Outline options (width, inside/centre/outside, corners, dashes); a picture has no fill.
- **Reveal is a module** (ADR 0149): Ctrl+Shift+click adds the very thing under the pointer to what is picked (or takes it away), Ctrl+Alt+click goes down the stack, pointing at a Layers row shows the outline of what it stands for; hidden and locked things are left out.
- **PDF and ZIP page order**: the sheets of a multi-sheet export are numbered in the dialog (all of them, in a scrolling list, each with a small preview drawn when it scrolls into view and kept while you reorder) and can be dragged to a new place, or moved earlier or later with the arrows under each picture. The dialog takes the height of the window and the pictures fill the left half, in a grid that scrolls.
- **Ctrl+click picks exactly the thing** under the pointer, including a sheet alone (without what is on it); moving a sheet always carries what is on it.
- **Export extras**: several picked sheets export together (a ZIP, or one PDF with a page for each at the physical size); a PNG or JPEG carries its resolution (pHYs, JFIF), and PDF is a format of the Export dialog.
- **Paste lands under the pointer** (Ctrl+V, the menu, pasted SVG): the middle of the view only when the pointer is not on the canvas.

## 0.19.0 — Vectors II, masks and vector networks (2026-10-18)

**Vectors** (ADR 0143, 0145, 0146)
- **Outline stroke** makes the line a shape of its own (width, corners, ends, dashes and arrow heads in it); **Taper** (and taper start, taper end, swell in the palette) makes it thin where you want: variable width as a shape. A path with a fill keeps it and gets the outline above.
- **Corner smoothing** (Smooth, in the Properties bar of a rounded shape): the corners start farther out and blend into the line.
- **Angular gradient** (a sweep round a centre) in the paint chooser, with its centre and first edge as handles on the canvas.
- **Edit nodes on several paths**: Shift-click or a lasso from empty ground picks nodes together; dragging one moves all, Delete takes them all away, across paths, one undo step.
- **Divide** cuts overlapping shapes into their regions; the **Shape builder** shows the regions and merges the ones you drag across (Alt deletes them).
- **Vector networks**: join paths where they meet into one network whose edges can meet any number at a vertex, with the enclosed regions filled; a vertex moves with all its edges, Alt joins two ends by an edge, Alt on an edge removes it; Release goes back to a path.

**Masks** (ADR 0144)
- **Clipping mask**: the top shape cuts what else is picked to its outline (any shape; a sheet of any shape).
- **Mask by opacity** or **by brightness** (soft edges stay soft), invert it, pick it to move it, release it; copies follow.
- **Brush mask**: paint a mask with the Pen in white (shows) or black (hides) over a mask that starts shown or hidden; the mask is vector, so it stays sharp at any zoom.

## 0.18.1 — The backlog run (2026-10-18)

**Text** (ADR 0130 to 0132, 0139, 0140)
- **Ranges:** underline (`<u>`), strikethrough (`~~`), a colour, a size (bigger and smaller), a link (safe addresses only; Ctrl+click opens it) and a **font of its own** for the selected words, in the format bar and stored as Markdown with `<span style>`.
- **Look:** a gradient fill and an outline, paragraph space, first-line indent, case (upper, lower, title, small caps), most lines (with "…"), a set height with where the words sit, nested lists (`Tab`), and **text on a path** (a copy of a path's curve; take it off again). Colour styles apply to text and pen strokes.
- **Font engine** (ADR 0132): TrueType, OpenType with **CFF and CFF2**, **WOFF2** (an own Brotli decoder, no network), **variable fonts** (axes in Font options), kerning, OpenType features, the bold and italic files of a family used for bold and italic words, bidirectional text (UAX 9) with Arabic joining, and an input method (IME) that composes in the editor.
- **Note tool** (`M`, ADR 0140): a text on a coloured card (colour, space, rounding), one click to make; the card is part of the text's box and of the editor.

**Vectors** (ADR 0139, 0142)
- Dash **length, gap and start** as numbers; **arrow heads** (solid, open, dot) at the ends of open lines; the **angle below which a sharp corner is cut**; **Simplify** a path (curve fitting); **pen stroke to path**; SVG import follows `<use>` and symbols; **Copy the selection as SVG**.
- Not done: variable-width paths, corner smoothing, an angular gradient, outline stroke, a shape builder, and node selection across paths (Vectors II in `docs/status.md`).

**Pictures and media** (ADR 0136 to 0138)
- Red, green, blue, **levels and curves**, and **stacks of adjustment layers** (add, reorder, hide, remove); the gradient map honours transparency.
- **Crop** and **playback speed** for video and GIF.
- **What a file says about itself** in the details panel (EXIF with the place a photo was taken, colour profile, PNG text, codec); an EXIF orientation is applied.
- **3D models** (STL, OBJ) and **PDFs** get a preview card (the model, shaded; the page count).

**Library, backups and settings** (ADR 0133 to 0135)
- **Incremental backups** that restore as one chain, saved styles in archives, backup in Settings > Storage; **Adobe `.ase` and `.aco`** palettes import and export.
- **Folder import** (the files filed in library folders of the same names) and picture paste from the clipboard.
- Settings: **Performance** (the quality held when adaptive quality is off, memory for pictures) and **About and diagnostics** (what the browser can do, the errors of the session, licences, a report to save).
- Sheets: **size presets** (A4, Letter, screens) and **Scale contents** with the sheet.

**Commands and interface** (ADR 0129, 0141)
- The command palette lists **recents first**, takes **values** (`Rename this canvas`), lists canvases and the shortcuts, and **records macros** that replay. A **right click** on the canvas opens a menu of what fits (Copy, Cut, Paste added as commands). Panel title bars are reachable and fold by **keyboard**. Handles name themselves on hover; on a phone the hint line and the rail fit.
- Muted text and the save readout are darker in the light theme: an **automated contrast audit** (4.5:1) now covers both themes.

**Tests**
- Unit tests for the font engine, Brotli, curve fitting, adapters, metadata, archives and ASE/ACO; E2E for each feature above in Chromium and Firefox (the logic specs in Chromium); the spec's U3, U6, U9, U10 and scenario I (1,000 view switches leave nothing behind) in `scenarios.spec.ts`.

## 0.18.0 — The text tool revamp (2026-10-18)

- **Bars revamped** (ADR 0128): the **Properties bar** (top, one row: what a tool or the selection looks like) and the **Actions bar** (bottom centre, one row, at a fixed place: what you can do to the selection) replace the options bar that wrapped into rows and the floating bar under the picked item. Nothing is in a "⋯" menu any more: align, distribute, grid and its spacing, the four shape operations, initial shape, the selection tool options and every colour of a selection are buttons. When the picked items are of different kinds, chips (Sheet, Text, Shape…) choose which kind's properties the row shows. A row wider than its room scrolls sideways with faded ends (phones too). One separator rule for every bar (no leading line), one meaning for "on" (a filled button), one drop-down look.
- **Command palette from one registry** (ADR 0129): every button, switch and field of the bars that shows now is a command (so "View in the library" is found), the settings are commands too (toggle a switch, pick a choice), and `@kind` narrows the list (`@settings theme`, `@toolbar lock`; `@` lists the kinds). Commands come from providers in `src/commands`, ready for macros.
- **Top left simplified**: the infinity button is the Canvas view; the board and canvas name float beside it, with their arrow, as one control that opens the switcher; Settings is an icon at the end of the right-hand bar.
- **Live numbers and hover labels** (ADR 0128): every numeric field now shows its result on the canvas while it is typed or scrubbed and stores one undo step when it settles (outline width, stroke thickness, sheet size, text size, line and letters, sides, points, ratio, radius, layer opacity); a number scrubs by its field as well as its name; the colours of a selection are a second bar under the Properties bar; handles (radius, ratio, count, gradient ends) name their value on hover.
- **Mentions removed** (ADR 0125): the `@` picker, mention spans, the Layers panel's Mentions and Mentioned in lists, relink, and the database indexes behind them are gone (database version 9 drops them). A separate note item is planned for them.
- **Item names button** (bottom right, and Settings): shown on every item, shown on picked items, or hidden.
- **Names above pictures and file cards** (ADR 0125), like a sheet's: a picture shows its file name, any other item its layer name while it is picked; the same list is drawn and pressed to pick; one shared file-name cache.
- **Text look in the options bar** (ADR 0126): Colour (with transparency, in the shape colour chooser), Size (px at this zoom), Line, Letters, alignment (left, centre, right, justify) and Auto width / Fixed width, for the Text tool, the text being edited and picked texts. A click with the Text tool makes an auto-width text, a dragged box a text of that width.
- **Text styles** (ADR 0126): a Styles kind; save the look of a text and press it to apply it to other texts.
- **Fonts from the library** (ADR 0127): import a TrueType `.ttf` or a `.woff` from the Font menu, set a text in it; the font is a library asset that follows the canvas into archives and is never cleaned up while a text uses it.

## 0.17.0 — Assets, canvas tools and small screens (2026-10-16)

- **Panel dock** (ADR 0123): the floating panels (Layers, Bookmarks, Styles, Tags, and Adjust, now a panel instead of a popover) stack on the left or right of the view in the order they were last used (the last used on top), fold to their title bar when it is pressed, float anywhere when it is dragged, dock again at a side edge, and take any width from 240 to 480 px; the layout is remembered and the same moves are in the command palette. Settings > Panels can minimize the inactive panels (all of them, or all but the latest few). A new panel is one `dock.add` call.

- **Styles grow** (ADR 0122): **gradients** (Save gradient in the fill and outline picker), **colours** and **palettes** (made from the selection, a picture or a colour with a harmony; open one to use or edit its colours: change, name, add, remove, sort, copy as CSS), all applied from the Styles panel (asking fill, outline or both when several shapes are picked); **GIMP `.ggr` gradients and `.gpl` palettes** import (several at once) and export (a ZIP for several); a **gradient map** adjustment for pictures and video.
- **Sheets in real units** (ADR 0121): a picked sheet shows its size in px, in, mm or cm; typing a size changes only the sheet.
- **Crop** looks unlike resizing: the canvas outside the window dims with the cut-away picture faintly showing, brackets instead of squares, a Crop tag, and the floating bars step aside; a dot on the Crop and Adjust buttons says a picture has them. Bookmarks, Styles and Tags moved to a stack on the left.

- **Styles panel** (toolbar, top right): the saved adjustments in a floating panel with a search box and a folding section per kind; select pictures and press one to apply it (one undo step). **/** now opens the command palette (it used to search; Ctrl+F searches). The Adjust panel is wider with no clipped number fields, and sliders no longer lag (a reduced picture is adjusted while dragging).

- **Styles** (ADR 0120): the looks you save, kept in one list made to take more kinds (colour palettes next) and shown in the Styles panel of the canvas (no card in the Assets view). **Save adjustment** in the Adjust panel, with the saved ones as chips to apply; **Save colour** in the colour picker, with a Saved row of swatches.

- **Download** on the selection bar for every file of the canvas (several in one ZIP; an edited still comes with its original, named as edited pictures are), **Reset** beside Adjust, and **every adjustment on video and GIF** (highlights, shadows, tint, sharpen and grain were missing) through an SVG filter (ADR 0119).

- **Crop** a picture (its handles move its window of the source; pull back out to restore) and **adjust** it without changing the original: exposure, contrast, highlights, shadows, temperature, tint, saturation, vibrance, blur, sharpen, grain; copy and paste adjustments, copy or make a new picture as it looks (ADR 0118).

- **Command palette** (Ctrl+K, ADR 0117); **previous and next view** (Alt+Shift+Left and Alt+Shift+Right and two buttons), **gliding** between views, and a **tour of the bookmarks** (ADR 0116).

- **ZIP64** (ADR 0115): archives with more than 65,535 entries or 4 GiB or more are written and read; smaller ones are unchanged.

- **Library filters** by size, ratio, orientation and colour (`width>1000`, `ratio:16x9`, `orientation:portrait`, `colour:red`), and a **Similar images** list that puts look-alikes side by side (ADR 0114).

- **Erase parts of strokes** (ADR 0111, scissors button on the eraser); **play only a range** of audio or video (ADR 0112, in the player's settings); **pen tilt** turns the ink nib and broadens the pencil, and **line height and letter spacing** for text (ADR 0113).

- **Attach and Detach** (ADR 0109): objects follow the object they are attached to when it moves. **Duplicate, move up and down** for canvases and boards, and **move a canvas to another board** (ADR 0110), from the More menu of the navigator.

- Sheets (ADR 0108): a **Sheet tool** (C) draws a fixed area that holds what you draw or move onto it and cuts it at its edge; **Ctrl+Alt+G** puts the picked objects on a new sheet and **Release the sheet** takes it away; the Layers panel shows each sheet with what is on it and a **clip toggle**; the name above a sheet picks it and moves it with its contents. (Real-unit sizes, constraints and auto layout come next.)

- Vectors (ADR 0107): **SVG out and in** (Save as SVG on the selection bar; paste SVG text on the canvas; Make vector copy of an SVG picture), **dashes** (Solid, Dashed, Dotted in Outline options), **node snapping** (a dragged node lines up with other nodes), **drag a number's name** to change it in every number field that has no slider (Outline width, Sides and Points before drawing, gradient stops, centre and radius, colour strips, media steps, rename start), and **only a picked shape moves** (a slide on one that is not picked draws the selection box, as for pictures). The hint says what the pin does.

- Fixes: menus and pickers (colour, outline options, Arrange) stay off the selected shapes; align and distribute work on the shapes of a boolean group, one shape in a group aligns with the group, and items in different spaces no longer refuse to align; Shift-turning a turned group snaps its whole angle (it can get back to 0); the side handles of a turned box are drawn; a boolean group's radius updates live.
- Fixes: the hint is plain floating text on the row of the view controls; a turned shape keeps its side handles and can be stretched along its own sides; W A S D reaches an item that is in view however small the selected one is; **Add to the group** and **Take out of the group** for boolean groups; corner radius rounds every corner of a boolean result (corners are taken from whole edges, not only the segment next to them).
- Initial shape (ADR 0106), for a boolean group too (its shapes, where each is in it, its operation and radius): a pin button on Select and Edit nodes with **Set initial shape**, **Update initial shape** and **Reset to initial shape**. The shape (geometry, points, ratio, radius, turn) is kept on the object, so it survives a closed browser; reset puts the shape back about where its middle is, leaving paint and layer alone. One undo step each.
- Interface around the vector tools (ADR 0104): the hint floats at the bottom of the canvas (not in a bar) and names any toolbar button the pointer is on (Settings > Appearance > Hints and tooltips: all, line only, none); seldom-used Select options are in one menu (its button was invisible: fixed); the options bar's groups are named and its numbers share one font token; dividers in the selection bar; selection colours show six then "+n" and light up their shapes on hover; each handle looks different (radius dot, corner ring, ratio diamond) and a polygon or star has a triangle handle for how many corners, with a label beside what is dragged.
- A rounded shape's box is its sharp box: changing a star's radius, points or ratio no longer shrinks its selection box (rounding cut the tips back, and the box followed).
- Resizing a rounded shape keeps its look: the corner radius scales with it. **Lock corner radius** (a button beside the thickness lock, when a picked shape has corners) keeps the radius its size instead. An outline width of 0 in Outline options is no outline.
- Selection colours (ADR 0104): with several shapes picked, one chip per colour or gradient they use (outline-only ones as a ring); changing a chip changes it everywhere in the selection, as one undo step. The largest corner radius is now where more would change nothing (corners share a segment in proportion to what they ask), so a star can be rounded much further.
- Corner radius, finished (ADR 0105): rounds corners between curves as well as lines, so it works on every shape and on a boolean group's result whatever its operation; **one radius per corner** on any shape (the field takes several values; double-click or hold the big main dot on the shape and each corner gets its own dot, the main one moves to the middle and sets them all); the main dot is larger and ringed; a radius is never kept above what its corner can use, which fixes the dot and field that could not be pulled back after being pushed to the limit. Boolean groups now turn with their shapes (their box stays turned instead of snapping upright after each turn).
- Gradient handles work on a boolean group picked whole (they were shown but could not be dragged; only entering the group let you move them), the hint line says where they are, and with both a gradient fill and a gradient outline the handles belong to the chip opened last.
- Shapes stay editable (ADR 0105): after drawing, a polygon's **Sides**, a star's **Points** and **Ratio** are in the options bar when it is picked, and **Radius** rounds the corners of any picked path that has them: a rectangle (one value or four), polygon, star, any path with sharp corners, and a boolean group (its result, the shapes keep theirs). Stretching keeps the radius; Edit nodes shows the sharp corners and keeps the rounding (one undo each, saved). No typing needed: drag the name of Radius, Sides, Points or Ratio to change it live, drag the dot in a corner for the radius, or a star's inner handle for the ratio. A shape now fills the box it was dragged (polygons and stars used to sit inside it). Moving a node by hand makes it an ordinary path.
- Vector UX first pass and stroke position (ADR 0104, audit in `docs/reference/vector-ux-audit.md`): **Outline options** beside the now-named Fill and Outline chips (width, position **inside, centre or outside** the edge, corners, ends; for the picked shapes or the next one), a hint line under the tool options saying what each vector tool does and what to press next (Shape, Path, Edit nodes, a picked shape, a boolean group, inside one), Enter edits the nodes of a picked shape and finishes node editing, and the pen-size slider is no longer offered on Select when only shapes are picked. Also: corners, ends and position are remembered; a Flatten button on a boolean group; Shape and Path share one rail button.
- Boolean groups (ADR 0103): Combine no longer consumes the shapes. They stay inside a group as real paths (double-click to enter and move, stretch, turn or edit them node by node), and the group's result, derived in the same transaction so undo always matches, is what is drawn. The Combine button on a group changes its operation (current one ticked), **Flatten** (Ctrl+E) makes it one path, **Release shapes** gives the shapes back. Groups nest, copy and paste, and the Layers list shows them with the operation's icon. A selection of a group and a plain shape no longer breaks the selection bar.
- Text converts to a path (ADR 0102): select text and press **Convert text to path** on the selection bar (or Ctrl+E): the letters' own outlines as a compound path, in place, one undo step; the same object, so mentions of it still work.
- Boolean operations (ADR 0101): select two or more shapes and **Combine shapes** on the selection bar gives Union, Intersect, Subtract (the shapes in front taken from the one at the back) and Exclude overlap, as one compound path with the look of the back shape and one undo step. Curves stay curves (the outlines are cut where they cross, exactly, and the pieces chosen by what is on each side of them), shapes of any scale and made at any zoom combine (a hole 10^-10 the size of the shape round it is still a hole).
- Gradients (ADR 0100): Fill and Outline open a paint chooser (None, Colour, Linear, Radial) with a gradient editor (stops on a bar: drag, click to add, Delete; angle, centre, radius; transparency per stop), handles on the canvas to drag a gradient's ends, centre and radius, one undo step each, exact colour at any depth. The editor is part of the colour picker package (`createGradientEditor`, documented there). Closing the chooser now keeps a number typed in a field.
- Vector shapes and paths (ADR 0099): the **Shape** tool (U: rectangle, ellipse, line, polygon, star), the **Path** tool (B: corners, smooth nodes dragged out, close on the first node) and **Edit nodes** (N, or a double-click on a path: move nodes and handles, add a node on a line, corner or smooth, delete). Fills and outlines with transparency (the Fill and Outline chips, live in the colour picker, one undo step), turned, stretched, grouped, duplicated, pasted, erased and saved like any object, exact at any depth (an edge at 2^34 magnification is within a pixel). A new kind of object, `path`, in the same files; no format change. Edges stay exact at any depth (a shape's edge 3000 levels in is where it is, checked by a fuzz against exact comparisons). Gradients, Booleans and SVG come next.

- The colour picker grew into a package with its own documentation (`src/colour-picker/README.md`, `docs/`): four layouts (ring and box, plane and bar, sliders, ring and sliders), optional transparency, text in hex, rgb() or oklch() (typed or pasted), an eyedropper, a WCAG contrast readout, colour harmonies, a `<colour-picker>` element, and a faster painter (4 to 5 times; the ring and bars are CSS gradients). Settings > Colour picker layout and text.
- Colour picker (ADR 0098): one picker for every colour choice, in OKHSL, OKHSV or OKHCL, as sliders or as a hue ring around a box, with hex, a before and after preview, the colours picked lately and a palette. It replaces the four fixed pen swatches (the toolbar now shows the colours you picked lately) and the browser's colour input in Settings (Pen colour, Colour picker model, Colour picker layout). It is a standalone module in `src/colour-picker/` that imports nothing from the app, is themed by `--cp-*` properties and builds on its own (`npm run build:picker`).

- Rename assets (the details panel, the bulk bar, F2), one or many, with a file-manager-style dialog: enumerate, replace text, add text, change the extension, and a preview of every name in full. The rules and the dialog are a reusable module (ADR 0085).
- Counts in the interface read right for one and for many ("1 original is still missing"), and the wording is general ("Select the items with this tag") (ADR 0086).
- The asset details panel is redesigned: a summary, cards, full-width actions, technical details last (ADR 0087).
- The library sidebar is redesigned to match the details panel: a framed panel, the fixed views as a group, each section a card, one row height, quiet counts (ADR 0088).
- Files with no preview show a fixed grey tile (file icon, extension, one general message) instead of a generated thumbnail; renaming no longer remakes anything (ADR 0089).
- The information readout is one inline status bar along the very bottom of the window, full width, most important first, with the view controls floating just above it at the right (ADR 0090).
- The library list: Type and Size are a column each; Width, Height and Canvases can be added; every header sorts, and a second click reverses it (ADR 0091).
- Settings match the library and the details: framed tabs and panel, the shared button and field look, and the same columns on every tab, Shortcuts included (ADR 0092).
- Animation: duration and curve tokens, menus/panels/dialogs/views ease in, buttons change colour smoothly, and Settings > Performance has Animation (System, Full, Subtle, None) and Animation speed (ADR 0093). The old Motion row moved there.
- Settings: the tabs are in groups (Working, Media, Interface, App) and a search finds any setting across all of them, with a count on each tab (ADR 0094). "Running smoothly" is no longer shown in the readout; only "A little slow" or "Slow" appear.
- The library and details panels resize by their edges on a wide screen (ADR 0095); the library bar keeps every control on a narrow window (the size slider included) by wrapping; the board pill shows the canvas name only.

- **View in the library** (was "Show"): the selection bar puts the names of the selected originals in the library search, so everything else is filtered out and these are listed, still picked (ADR 0077).
- A narrow library panel cuts nothing at its edge: long names and tags shorten with an ellipsis and keep their count, with the full name in the tooltip.
- The Technical readout spreads its segments over the whole width in one row (they wrap on a narrow window).

- Phones: the floating rows (tabs, dock, tool options, side panels) are placed from measured heights, so every gap between them is the same and the panels no longer touch the tool rail (ADR 0097).
- Settings > Develop shows the version (it was blank: the version was set after Settings was built). `docs/reference/plan-gaps.md` is re-checked against the whole plan, item by item.
- Layers (ADR 0096): the bars and panels floating on the edges are above everything on the canvas, selected, moving or placed (a GIF's picture no longer covers the status bar and the view controls); layer tokens `--z-item`, `--z-item-bar`, `--z-item-pop`, `--z-edge`. The selection bar finds a place clear of a player's bar, above or below it.

- Tags follow Obsidian's rules: letters, numbers, _ - and / (nested), no spaces, not all digits; whatever is typed is formatted to fit (with a notice), `#project` finds `project/design` too, renaming a parent renames its children, and tags stored in an older form are formatted once at start-up (ADR 0084).
- File types: the count no longer disappears while a chip is pointed at.

- Search suggestions: chips under both search boxes complete the word being typed (file types after a dot, tags after a hash, operators after a word; Tab takes the first); the placeholders no longer repeat the tabs (ADR 0083).
- Canvas tags say which canvas they are on (the picture's details and the sidebar tooltip). The board pill is shorter (board 6 em, canvas 10 em).

- Smart folders are removed. The Assets sidebar has **File types** instead: a chip per extension in the library with its count (press one to show those files). A word starting with a dot searches by file type (`.png`, `.png OR .glb`) in the library and canvas searches (ADR 0082).

- Screenshot button and Settings > Screenshot: WebP (or PNG, JPEG) saved to the library's Screenshots folder, named board-canvas-date-time, with options for the pattern, a transparent background, the interface, the area, tags, folder, name template and the clipboard (ADR 0080).
- The extension chip on library cards shows only while a card is pointed at, focused or picked, at the top right. An SVG shows its real picture again (a stored thumbnail made by the previous build is dropped once). Opening the Assets view no longer puts the focus in the search box; only Ctrl+Shift+F does.

- The workspace can be renamed: the pencil beside "Whole workspace" in the board menu.

- The top bar starts with the board pill (∞ Board › Canvas ▾), which is also the Canvas view's tab, then Assets and Settings; long names are cut with an ellipsis (ADR 0079).

- Any file can be imported (ADR 0078): what the browser cannot show (a 3D model, a document, an unreadable picture) is kept as a card with its extension chip, name and kind, placed on the canvas like a picture, with Download original and (PDF, text) Open in a new tab in the library and the selection bar.
- The plain ZIP "by file type" makes a folder per extension (item.obj in obj).

- Closing the canvas search with a press on the canvas no longer clears the items just selected there (ADR 0071).

- Show in the library: a selection-bar button takes the selected pictures to the Assets view, picked, with the search and filters cleared (ADR 0077).

- Icon audit: buttons with different functions no longer share an icon (Rename, Import and Export, Fit everything, New folder, Slideshow, Copy Markdown, Extract frame, board, list layout, and more); registry in docs/reference/icons.md and a rule in CLAUDE.md.

- Developer tools: a bell button shows sample notices (Shift: four) of every kind (info, success, warning, error, progress).

- Notices redesigned to match the app's panels: a compact card, a small tinted icon badge, the same text size, a round close button (no more tinted gradient and thick side bar).

- A dedicated Tags panel (dock button beside Layers): tags of the selection, suggestions, every tag on the canvas with counts, select by tag, rename and delete; the Layers panel no longer has tags (ADR 0076).

- Zen mode: a leaf button beside Home (or Z) fades the floating bars and panels out; each shows while the pointer is over it (ADR 0075).

- The Arrange menu has Space between items (None, Tight, Normal, Wide, Wider) for grids; choosing one right after a grid lays it out again (ADR 0074).

- A selection being moved, turned or stretched is drawn see-through (up to 200 objects; ADR 0073).

- Stepping between items uses W A S D instead of Ctrl+Arrow; the four keys are rebindable in Settings > Shortcuts (ADR 0072).

- The library search matches the canvas search: help, clear button, All/Name/Tag ways, recent searches; smart folders save the way (ADR 0071).
- Fix: the workspace menu's ⋯ menu opened far from its button (a blurred panel changed where fixed positions start).

- The canvas search stays open until Escape or a press outside, keeps its text and way until you clear it, has checkboxes (the checked results are the selection) and remembers recent searches that found something, with remove and clear (ADR 0071).

- In-canvas tags can be renamed or deleted on every canvas, from a Layers tag chip or the Assets sidebar's Canvas tags (ADR 0070).
- Fix: a `#` typed first in the canvas search stays in the box (`#tag` is a search word); only `/` and `@` switch the way.

- The canvas search opens on All (names, groups, tags and bookmarks together, with AND, OR, XOR, NOT); `/ # @` narrow it; a ? button explains the syntax.

- Search takes AND, OR, XOR, NOT, `-`, brackets and "phrases" in the library, smart folders and the canvas search (ADR 0069).

- Shared ⋯ More menu for bookmarks, navigator and sidebar; Layers Rename/Hide/Lock moved to the selection settings with elbow guide lines (ADR 0068).
- Design tokens for all CSS colour, text, spacing and radius, enforced by `npm run check:tokens` (ADR 0068).
- Fix: Ctrl+Shift+F could miss when the canvas search had just closed.

Built after v0.16.0 from owner feedback (ADRs 0052 to 0064). Tested spec by spec; the full suite has not been re-run since v0.16.0 ([record](docs/testing/ui-polish-0.17.md)).

- **Fixed:** resize snapping with **Shift** (proportions kept) now snaps the edge the proportional size produces, not the pointer position; the pointer can be far past the line while the edge lands on it.
- **Fixed:** resize snaps by the dragged **edge** (not the cursor), so grabbing a handle off-centre still lines the edge up exactly. The second **Alt** tap (and Fit everything) no longer zooms out to an empty canvas: it fits the selected items plus the legible items of the same depth that are near them, not every item that happens to be a legible size however far away.
- **Reset rotation and Reset proportions:** two buttons in the selection bar (shown only when they apply): take the turn off the selection, each item about its own middle, and give a stretched picture its own shape back (same width and middle). One undo step each.
- **One HTML file (ADR 0067):** the separate debug build is gone; Settings > Develop > Developer tools turns the developer panel, diagnostics and test hook on (after a reload), or end the address with #debug.
- **Layers panel selection:** Ctrl or Cmd toggles a row, Shift takes the range from the last row clicked, Ctrl+Shift adds a range; names are cut in the middle so `frame_0003.png` and `frame_0004.png` can be told apart.
- **Alt cycle:** after selecting another item, Alt focuses that item (the cycle to "everything" continues only for the same selection); the "everything" fit now takes as much as stays legible (nearest first, nothing under 4 px, the selection at least 14 px) instead of a fixed distance.
- **Side panels (ADR 0066):** the Layers and Bookmarks panels stack without squeezing each other or covering the bottom controls; the Layers list scrolls, has a name filter (with many layers) and **Show 500 more rows**, quiet eye and lock icons, and its selection settings only appear with a selection.
- **Bookmarks panel redesigned (ADR 0065):** cards with picture, name and saved time; **Rename** and **Update** (points the bookmark at the current view and makes its picture again) beside Delete; one-row header; large touch buttons on small screens.
- **Viewer media (ADR 0064):** video, audio and animated GIFs open with the on-canvas player's engines and control bar (position, step, play, repeat, volume; the same step and volume settings) instead of the browser's own controls. The viewer's player has **Extract frame to the open canvas**, a video pans and zooms like a picture, and hiding the controls (F) hides the player too; a click in the viewer brings the player back alone.
- **Resize with side handles (ADR 0063):** handles on the middle of each side too; pictures resize freely (Shift keeps the proportions), **Alt** resizes about the middle, **Ctrl** turns snapping off, and the dragged edge **snaps** to other items with guide lines. Strokes and text keep their proportions.
- **Alt+drag** the selection drags a copy. **Alt** tapped alone brings the selection into view; tapped again it fits everything visible at this zoom. Two new buttons beside zoom out and in: **Fit the selection** and **Fit everything**.
- **Navigation "nearest in view" fixed:** an item now counts only if it is near the selected one (a gap of at most 3 of its sizes), of a similar size (within 6 times), legible, and ahead within about 56 degrees of the arrow's line; far or very differently sized items are not neighbours. "Nearest anywhere" also keeps to the arrow's direction.
- **Assets:** choosing the chosen tag, folder or smart folder again lets go of it. The **list** has more columns (Type, Size, Folder, Favourite), columns can be dragged by their headers to reorder, and the list scrolls sideways instead of clipping. In the viewer **F** hides and shows the controls (was B; **1** is 100%).
- **Shortcuts:** **Ctrl+F** searches the canvas (the library in the Assets view); **Ctrl+Shift+F** goes to the Assets view and its search. Both are in the shortcut list.
- **Small and medium screens:** on 641 to 1180 px the tool options get their own row under the tabs and the dock instead of being squeezed between them; on phones the options are one row that scrolls sideways. In the viewer the picture is centred (equal room on every side) and the zoom control sits in the bar instead of over the picture. On small screens the details panel has a grip to resize it (drag, arrow keys, double-click to reset; remembered).
- **Viewer edges:** click the invisible left or right side of the viewer to go to the previous or next asset; the width is Settings > Media and playback > Viewer edges (0 turns it off; off while zoomed in). The file name no longer floats over the picture (it is in the details; a note still shows for a missing original or a file with no preview).
- **Assets view on phones (ADR 0061):** the gallery is two columns, the details open as a bottom sheet, and the viewer takes the whole screen under the tabs with its controls wrapped in two rows.
- **In-canvas tags (ADR 0062):** tag items on the canvas (Layers panel or the selection bar's Tag button); searchable with `#`. The Assets view lists **Canvas tags** across the workspace in the left panel (separate from library Tags), the properties of an asset offer the in-canvas tags used on its instances to add to the asset, and placing pictures that have tags asks whether to carry them as in-canvas tags.
- **Navigation:** Settings > Navigation now has **On arriving at an item**: *Focus on the item* (zoom so it fills the window, the default) or *Keep the zoom level* (only move the view). It replaces the "Zoom to the item" switch; the Alt key always focuses.
- **Phone layout (ADR 0061):** on screens 640 px wide or less the view tabs and workspace menu, the dock and the tool options stack in three rows instead of overlapping; the tools sit below them and the Layers and Bookmarks panels beside the tools.
- **Search the canvas (ADR 0060):** `/` by file or layer name, `#` by tag, `@` by bookmark (or the search button in the dock); Enter goes there, Shift+Enter selects every match.
- **Arrange moved to the selection bar:** the Arrange and align button (grid, align, distribute) is now in the action bar beside the selection (with two or more items selected) instead of the options bar.
- **Viewer follows the theme** (light ground and bars in a light theme, dark in a dark one). Pictures with see-through pixels (PNG, WebP, GIF, SVG) sit on a **chequered ground** in the viewer, the filmstrip, the details picture and the gallery cards, so they read as transparent.
- **Fixed:** the canvas showed a "Select (V)" tooltip wherever the pointer rested (the tool tooltips were set on the canvas, which also carries the current tool).
- **Layers panel (ADR 0059):** **Sort** by name (A to Z, Z to A; a group by its name, then what is inside it; only the stacking order changes), indentation guide lines for nested groups, count chips on groups, a path tooltip, expand or collapse all, and groups open for what you select.
- **Place on…:** every Place button has an arrow: another existing canvas, a new canvas in a board, or a new board.
- **Workspace menu redesigned** (boards as cards, canvases under a guide line, "+ New board" apart from "+ New canvas"); **tags are chips** on cards and in the sidebar; a single click no longer shows every card's checkbox.
- **Navigation (ADR 0058):** **Ctrl+Arrow** steps the selection to the next item and frames it; Settings > Navigation chooses **Nearest in view** (skips items too small or too large to see at this zoom), **Nearest anywhere** (by position at any depth) or **By layer** (top-most first), and whether to zoom to the item. **Alt** (pressed and released alone) brings the selection into view. Both are in the shortcut list.
- **Assets sidebar redesigned (ADR 0057):** icon rows for All assets, Favourites and Unfiled; Folders, Smart folders and Tags are sections that fold (remembered); the row buttons are replaced by one **More** menu per row (Rename, Delete, New subfolder) that floats over the page; tags are wrapping chips; a **+** icon adds a folder or saves a search; on a small screen the sidebar is a strip ("Library: All assets") that opens on demand and folds after a choice. Fixed: Escape with a menu open cleared the selection instead of closing the menu.
- **Export and import (ADR 0057):** the workspace menu now has the whole workspace: Export a backup (.canvast), **Export all files as ZIP** and **Import a file**. Boards, canvases and picked assets also have **Export files as ZIP**. The ZIP holds the original files under their own names, grouped **by kind** (Images, Videos, Audio, PDFs, Text, Other) or **by your folders** (files with no folder go in the folder of their kind).
- **Assets:** an asset is in **one folder** at a time (radio buttons; Move all for a selection); **tags can be renamed and deleted** for the whole library (saved searches follow a rename); picking an item always shows its properties, even if the panel button had hidden them.
- **Fixed:** the mention picker listed images as "Image 1920×1080"; it now shows the file name (as the Layers panel does).
- **Fixed:** the text box showed the near-black default ink on the dark canvas (unreadable while editing); it now follows the theme like the drawn text. The plain Grid and Dots patterns no longer draw the red axis line and the origin square (they belong to the multi-scale grid). A picked card in the gallery had no visible ring (it was painted under the picture); the ring is now above it.
- **Assets (ADR 0054 follow-up):** a click only picks a card and shows its details; the viewer opens from a double-click or from the picture in the details (any file kind). The arrow keys, Home, End (Shift extends) and Ctrl+A work in the gallery and the list, and Down from the search box steps into the items. List columns can be hidden, reordered and reset (kept on this device; "Added" is new). The viewer has a real zoom: wheel or pinch at the pointer, drag to pan, double-click for Fit/100%, keys + - 0 1 f and a zoom control. With the controls hidden the viewer is immersive (tabs fade until the pointer nears the top; Pause beside the handle during a slideshow).
- **Fixed:** in Settings > Shortcuts, "press a letter" could stay stuck (Escape and closing did nothing when the focus had left the button); it now ends on Escape, a click elsewhere, another tab or closing, and takes the letter wherever the focus is.
- **Canvas pattern (ADR 0056):** a button beside the information button cycles Grid (default), Dots, Multi-scale grid and None.
- **Workspace menu:** boards and canvases with plain-word counts and a More button per row (Rename, Export to a file, Delete).
- **Assets:** a List layout; every sort can be reversed and says which order it is; one click opens the viewer; Esc clears the selection; compact density is the default; the slideshow time is a setting; the Arrange menu and the player's scrubber were fixed.
- **Fixed:** dragging a picture out of the library and dropping it in the window imported its thumbnail as a new asset; a picked card's checkbox could be hidden; a quick Esc after opening the viewer left the wrong asset shown.
- **Assets view (ADR 0054):** decluttered and merged: a justified gallery with details on hover, a properties panel that puts actions first, and one viewer (large preview, details beside it, previous/next, filmstrip and controls below; details and controls hideable). The viewer stays open when you come back from placing an asset. **Pick several** with Ctrl, Shift, Ctrl+A or a checkbox on every card (always shown on touch screens), and act on all of them (favourite, place in a grid, tag, folder, export, delete). **Slideshow** from the library, a selection or the viewer, with a timer bar, 2 to 20 seconds, Space to pause, video and audio played to their end.
- **Compact density** (Settings > Appearance): one switch tightens every control and the spacing.
- **Information readout (ADR 0055):** the "frame rate" button now cycles Simple (the default: zoom as a magnification and "Saved" in words), More (adds position, objects and how smoothly it runs), Technical (the numbers it showed before) and Hidden (a save problem still appears as a notice). Also in Settings > Appearance.
- **Notices (ADR 0053):** messages appear as a visible stack at the bottom centre over every view, with an icon and colour by kind, a progress bar for importing and indexing, a dismiss button, and a live region; importing is announced at once, for one file too. Errors stay longer.
- **One spec for the floating elements (ADR 0053):** the rail, dock, options bar, view tabs, workspace menu, HUD controls, selection bar and the Layers and Bookmarks panels share one height, radius, border, shadow and spacing; panels start below whichever of them is lowest.
- **Visual system (ADR 0052):** every interface colour is oklch; **Settings > Appearance > Theme colour** changes the hue of the whole interface and **Colourfulness** its saturation, with brightness and contrast unchanged. Default black ink is drawn light on the dark canvas (it was invisible). Tools moved to a left rail, history, panels and import to a top-right dock, and the top bar shows only the active tool's options; the bar's copies of Group, order, Hide, Lock and Delete are in the selection bar only.
## 0.16.0 — Phase 7: professional UX (2026-10-16)

Phase 7. Full suite: unit 176/176, E2E 428 passed, 6 skipped, 0 failed, 39 min 43 s ([testing/full-run-phase-7.md](docs/testing/full-run-phase-7.md)).

- **Collaboration tab (Settings)** states that collaboration is off; the arrow keys stay on the view tab list when a view opens.

- **Selection action bar (ADR 0051):** next to the selection: duplicate, group, ungroup, front, back, lock, hide, delete. The resize cursor no longer sticks when the pointer leaves the canvas onto a bar or panel.

- **Accessibility and appearance (ADR 0050):** an automated audit of accessible names, landmarks and focus outlines in every view; the view tabs come first in tab order; the tools no longer slide under the view tabs in a narrow window; Settings > Appearance has interface size (90 to 150 %), high contrast and reduced motion.

- **Shortcuts (ADR 0049):** Settings > Shortcuts lists every shortcut; the six tool keys can be changed (one letter, taken letters are refused) and the tool tooltips follow; `?` opens the list.

- **Settings view (ADR 0048):** a third top-level view with tabs (Drawing and selection, Media and playback, Performance, Appearance, Storage, Privacy); each row shows its scope and has a Reset, and changes reach the toolbars and the drawing at once. New **theme** setting: system, light or dark.
- **Zoom preview no longer shows bare background (Firefox):** while zooming in a slow-to-draw scene, the prebuilt neighbour tile set that takes over is now only used if it covers the whole view (the deeper one was scaled down and left a strip of grid at the edge), and preview tiles are drawn on whole pixels so no hairline seams show between them. This was the intermittent "curvy stroke" hole failure.
## 0.15.0 — Phase 6: media (2026-10-16)

Phase 6. Full suite: 411 passed, 6 skipped, 1 failed (an intermittent Firefox deep-zoom hole check that also fails before this phase), [testing/full-run-phase-6.md](docs/testing/full-run-phase-6.md).

- **Extract Frame** tries again a few times when the picture is not ready yet instead of doing nothing; renaming a layer works in Firefox after the rows redraw; unit tests wait up to 30 s.
- **Gaps closed (ADR 0047):** blend modes (11, from the Layers panel); layer and group names (double-click a row); relinking a missing mention to another item; audio keeps playing after it leaves the view; the mention picker names images by file name.

- **Paused video reopens on the frame it was paused on (Firefox):** the player loads in the page, transparent, so the sought frame is presented, and a pause seeks to the clock's time. Pictures of a video are taken by drawing the element, `createImageBitmap`, `VideoFrame`, then an MP4 frame decoded with WebCodecs; a flat picture is never stored; a card says why it is a card (ADR 0046). Known limit: Firefox on Android with H.265 phone videos still shows the card.
- **Playing pauses while you move, scale or turn the instance and plays on when you let go; paused pictures are now taken by drawing the element (as Extract Frame does); the card text fits its card.**
- **Player:** a video whose picture the browser cannot decode (it loads length and sound only) now shows the card and "Can't play in this browser" instead of a black box; seeks wait for a presented picture of the right time, and a stale one is reported in the console.
- **Videos this browser cannot decode** (H.265 in Chrome on Linux, say) are still imported as a card of their real proportions; the player offers Save original file to open it in your system player (ADR 0045). The paused-picture fix now also redraws tiles that already showed the file decode.
- **Paused picture matches the player (second attempt):** the picture a player showed when it paused or sought is kept as the canvas picture, and the decoder works in the page and waits for a presented frame; an undecodable video says why (codec) instead of a bare error.
- **Paused picture matches the player:** the saved position is now where the picture is, not the element's clock (Firefox can report a spurious end after a seek near the end, which saved the end).
- **Playback continues when you deselect:** a playing video, audio or GIF keeps playing until it ends, you pause it, or it leaves the view (up to 4 at once) (ADR 0044).
- **Fixes from testing:** the Layers panel shows file names (not "Image W×H"); the player has a real 0 to 100 volume slider and a roomier layout (scrubber on its own row); the Assets slide view plays videos and audio; the video overlay no longer lags while its instance is moved, scaled or turned.
- **Extract Frame** from a video or GIF: the shown frame becomes a PNG original and a plain image beside it; a gear in the player sets the video, audio and GIF steps (ADR 0043).
- **Animated GIFs** play and step by frame with their own decoder (disposal, transparency, interlacing, per-frame delays); the paused frame is saved and drawn (ADR 0042).
- **Audio:** import an audio file; it is placed as its waveform with the same player (1 s steps) (ADR 0041).
- **Videos:** import a video file; it is placed paused, drawn as its picture at the paused time, and the selected video has an on-canvas player (play, pause, step 3 s back or forward, scrubber, repeat, mute). The paused position is saved when you pause, step or seek, never while playing (ADR 0041).

## 0.14.0 — Phase 5: creative editing (2026-10-15)

- **Backlinks:** the Layers panel lists the texts that mention the selected object and what a selected text mentions (reveal across the board's canvases; missing targets are flagged); the `@` picker also offers texts and images of the board's other canvases. Storage schema 7 adds the mention and kind indexes (ADR 0040).
- **Mentions in text:** type `@` in a text to pick an object of the canvas; stored as `[[item:<id>|label]]` (stable id, atomic in the editor and the layout). Fixed: a heading ending in ` #` lost it on reading (ADR 0039).
- **Opacity slider** in the Layers panel sets the opacity of the selection, one undo step per release (ADR 0024).
- **Copy, cut, paste and duplicate** the selection with Ctrl/Cmd+C, X, V and D: pasted centred in the view at the size it had on screen when copied (at any depth, exactly), as one undo step; Ctrl+D duplicates in place a little offset without touching the clipboard; it works across canvases and tabs of the same browser profile (ADR 0038).
- **Esc returns to the Select tool** from any other tool (after cancelling a stroke or gesture in progress).
- **Four pens:** fine (as before), pencil (three soft, wandering translucent passes), ink (a broad nib: thick across, thin along, thickened by pressure or a slow stroke) and marker (wide, translucent). A pencil or ink stroke is a group of ordinary strokes, one undo step; the pen is remembered (ADR 0037).
- **Arrange, align and distribute:** a menu on the Select toolbar arranges the selection in a grid (by name A to Z or Z to A, by date added, by size, by type or in stacking order), aligns it (left, centre, right, top, middle, bottom) and distributes it (three or more); groups move as one unit, every item moves by an exact translation, and each command is one undo step (ADR 0036).

## 0.13.0 — Phase 4: assets and storage (2026-10-15)

Full suite: 380 passed, 6 skipped, 0 failed in 36 min 24 s ([record](docs/testing/full-run-phase-4.md)).

- **Smart folders:** save the Assets search (words, `#tags` and the usage filter) under a name; the sidebar shows how many assets match it now, and clicking it applies the search (ADR 0035).
- **Asset thumbnails are kept, and a slide view opens the original.** A small WebP thumbnail is made for every new import in the background (and for older assets the first time they are shown) and read afterwards, so the original is never decoded to draw a card; a card whose original was lost keeps its picture, marked "Original missing"; clicking the preview in the details opens the original full window with arrow keys to step and Esc to close (ADR 0034).
- **Zooming into a dense scene no longer hitches at the preview bound.** While the view rests, the tile sets one zoom level in and out are built in idle time, so crossing the bound swaps to a ready set instead of rendering a whole exact frame (about 70 ms at 10,000 visible objects); the 2x preview bound is unchanged (ADR 0033).

## 0.12.0 — Phase 3: performance infrastructure (2026-10-15)

Full suite: 380 passed, 6 skipped, 0 failed in 36 min 36 s ([record](docs/testing/full-run-phase-3.md)); tier benchmark in [docs/testing/phase-3-bench.md](docs/testing/phase-3-bench.md). Known failure against the ADR 0028 targets: one 70 ms frame when a zoom in a dense scene crosses the preview bound (ADR 0012).

- **Fixes:** Shift-rotating to a 15 degree step no longer snaps back to the starting angle (a step is not a whole number of angle units, and the document refused it); corner handles show a resize cursor along the diagonal they point along; a change the document refuses no longer leaves a preview on screen.
- **The selection box is always drawn** (also in the axis-aligned mode), and the cursor turns into a rotate arrow where a press would turn the selection.
- **Selection:** each selected item is outlined by its own turned rectangle and a group box turns with items that share a rotation (a button switches to the axis-aligned box); a selection can be turned from just outside a corner as well as from the handle (which stays in view); a marquee or lasso takes what it touches, except a shape drawn entirely inside an image; undo, redo and the tool keys work after using a slider (ADR 0031).
- **Frame rate counter:** a button in the navigation controls shows a continuous FPS readout with the frame gap and the draw time (ADR 0030), and under it the draw-time percentiles (p50, p95, p99), the object count, decoded-image memory against its budget and the decode queue.
- **Batch import lays images out in a grid** (columns from the number of files so the grid is about square, scaled to fit the view, in the order given) as one undo step, with an "Importing x of n" message; big images drawn small use reduced copies decoded at 512 px, so hundreds of HD images no longer cost gigabytes (ADR 0030).
- **Importing a file that is already in the library says so:** no second copy is stored, a notice names it, and it is still placed on the canvas (a file deleted from the library comes back, with its own message).
- **Big documents open without freezing.** Past 20,000 objects the index is built in 8 ms slices while the page keeps drawing and taking input, with an "Indexing" message (ADR 0029).
- **Adaptive quality.** When frames run slow (95th percentile over 24 ms for two windows of 60 frames) the canvas is drawn at a lower resolution and zoom previews start sooner; it comes back by itself when frames are comfortable. The setting `quality.auto` turns it off (ADR 0028).
- **Decoded images have a budget.** Decoded pixels of placed images are a cache of at most 384 MiB: the ones no frame has asked for lately are released when over it and decoded again when drawn, so memory no longer grows with every image ever shown (ADR 0027).

## 0.11.0 — Phase 2: rotation, snapping, groups, hide and lock, object eraser, recovery (2026-10-14)

- **Rotate strokes, images and text** with a handle above the selection (Shift snaps to 15 degree steps). Rotation is a stored angle, so turning and turning back is exact, and it works at any depth and zoom. Several objects turn about their common centre. One undo step. A turned image resizes uniformly, and a turned text is edited turned (ADR 0018).
- **Snapping:** moving a selection snaps its edges and centres to other objects within 6 px, exactly aligned at any depth, with a dashed guide line; a magnet button turns it off (ADR 0019).
- **Groups and stacking:** Ctrl+G groups the selected objects (nestable), Ctrl+Shift+G ungroups one level; clicking a member selects the group, double-click goes inside it, Escape comes back out. Bring to front (Ctrl+]) and Send to back (Ctrl+[). A group is membership only, so it moves, turns and scales exactly like a multi-selection (ADR 0020).
- **Hide and lock:** Hide takes the selection out of drawing, picking and the index until Show all hidden; Lock keeps it drawn but unpickable until Unlock all. Both undo and are saved with the objects (ADR 0021).
- **Object eraser** (key E): swipe across objects to remove them; a fast flick cannot skip a thin object, locked objects are never taken, groups go whole (or member by member with a toggle), and the whole swipe is one undo step. Originals stay in the library (ADR 0022).
- **Drawing-surface recovery:** if the browser resets the 2D surface, canvast keeps the document and camera, drops its cached rasters and redraws (ADR 0023). Each canvas already kept its own camera.
- **Toolbar:** tools and actions on the first row, the current tool's options on a second row, so a long set of options no longer runs under the Canvas and Assets switcher.
- **Layers panel:** a floating, hideable panel (Layers button) listing objects front to back with groups, an eye and a lock on every row, click to select and drag to reorder (ADR 0024).
- **Bookmarks:** a floating, hideable Bookmarks panel saves the current place and zoom of a canvas (with a small picture), goes back to it exactly at any depth, renames and deletes. Saved with the canvas and carried in archives (storage schema 5, ADR 0025).
- **Archives are version 3** (strokes may carry a rotation); earlier builds refuse them instead of dropping it.

## 0.10.0 — Phase 1 slice 9: settings scopes (2026-10-14)

- **Settings (ADR 0017).** Pen colour and size, stabilizer, pen size follows zoom, the select option and the lasso filter now come back after a reload, as do the last view. Settings are declared once with a scope, a validated default and an effect; damaged stored values fall back to the default. Workspace and board scopes are declared; their storage comes with their first setting.

## 0.9.0 — Nested frames (2026-10-14)

Nested frames redesign (ADR 0014, 0015, 0016).

- **Endless depth, constant cost.** The camera and objects live in nested
  frames, so pan, zoom and drawing cost the same at 2^10 and 2^10^12, and
  a jump can be 10^15 levels. Work a trillion levels down saves, reloads
  and travels in an archive (storage schema 4, archive version 2; version 1
  archives and old saved canvases open unchanged).
- **Deep zoom keeps what you zoomed into.** Zoomed far inside a stroke, a
  letter or an image the view keeps its colour (image pixels included, also
  on a pixel corner) at any depth. An outline edge that stays in the view
  past 100,000 levels is drawn as a dimmed approximate fill (ADR 0016).
- **Pen options.** Size slider (0.5–128 px) with the three presets;
  thickness lock (new strokes keep the same width on the canvas at any zoom;
  on the Select tool it keeps a stroke's line width when you resize);
  stabilizer with a strength slider; pen size follows zoom while drawing.
- **Size slider on Select:** sets the thickness of the selected strokes
  (on release, one undo step).
- **Select option:** ignore the object that fills the view, so it cannot be
  picked or deleted by accident.
- **Tests:** a depth suite (frame time from 2^10 to 2^10^12, 10^12 jumps under
  100 ms, rebase continuity under 10^-6 px, work at 2^10^12, memory after
  dives). The E2E suites are cheaper: logic specs run in `chromium` only,
  loops are smaller, and one full-only run does 2,000 wheel notches.
- **Debug (#debug) panel:** jumps of ±10, 100, 1000, 10^6, 10^9, 10^12
  levels, a Clear button for the canvas (undoable), and auto-zoom keeps
  running while you draw (stops with its button, the wheel or Escape).

## 0.8.0 — Phase 1 slice 8: text objects (2026-10-13)

- **Text on the canvas.** Text tool (`T`): click and type. Double-click a
  text with the Select tool to edit it.
  - Bold, italic, three heading sizes, bulleted and numbered lists, from
    the format bar or `Ctrl/⌘+B`, `Ctrl/⌘+I`.
  - Edited in place: what you type is laid out like the final text.
  - Pasted text arrives as plain text.
- **Stored as Markdown.** Each text is a Markdown entry, not editor HTML.
  **Copy Markdown** in the format bar, or in the toolbar for selected text.
- **No zoom limit for text.** Up to 2,000 px per letter the browser draws
  it; beyond that canvast draws the font's real outlines, exactly, at any
  depth. Tested 4,000 levels beyond where the text was written: edges stay
  sharp and exact, letters stay solid. Characters the bundled font lacks
  (CJK, emoji) use a system font and pixelate at extreme depth.
- **Fix: working extremely deep no longer freezes the computer.** At
  2^10,000,000, every frame took about 1.8 s (since Phase 0A): placing the
  origin's landmarks on screen built 10-million-bit numbers. Now about
  15 ms per frame; drawing a stroke there takes 0.2 s instead of 24 s.
- **Bundled font:** Inter Regular (SIL Open Font License 1.1), embedded in
  the single file, which grows by about 460 KB (to ~649 KB).

## 0.7.0 — Phase 1 slice 7: zoom preview for dense scenes (2026-10-13)

- **Smooth zooming over dense scenes.** While you zoom, a scene with many
  objects shows the last exact picture scaled (by at most 2×), then snaps
  to the exact picture 150 ms after you stop, or as you pass each zoom
  level.
- Dense 10K scene: about 5 ms per frame while zooming, down from 87–125 ms.
- **Exactness is unchanged where it matters.** Scenes with few objects,
  including deep-zoom work, are drawn exactly on every frame, and an edit
  is never hidden behind a preview.
- **Bench:** a `zoomin` trajectory (a steady zoom gesture).

## 0.6.0 — Phase 1 slice 6: organizing the asset library (2026-10-13)

- **Tags, favourites and folders** in the Assets view.
  - Add tags in an asset's details (comma-separated); star favourites.
  - File an image in any number of folders, nested as deep as you like,
    without copying it.
- **A sidebar** shows All, Favourites, Unfiled, your folder tree and your
  tags, with counts. Folders can be created, renamed and deleted; deleting
  a folder never deletes images.
- **Search** matches names, types and tags; `#tag` matches one tag exactly.
- **Backups keep the organization.** Importing merges tags, favourites and
  folders without creating duplicate folders.
- **Safe edits:** organization changes are applied in storage as changes,
  so quick successive edits and edits from another tab never undo each
  other.

## 0.5.0 — Phase 1 slice 5: density preview (2026-10-13)

- **Nothing vanishes when you zoom out.** Content too small to draw stroke
  by stroke now appears as a soft mark in its own colour, darker where there
  is more ink. Anything there keeps at least a faint dot, so a drawing made
  60 levels deep is findable from home.
- **Never selectable, and not part of the document:** zoom in to edit.
- **Cost:** at most about 1 ms per frame in Chromium and 4 ms in Firefox,
  even with 1 million objects.
- **Fix:** whether an object is drawn individually is now decided by the
  same rule as the spatial index, so no object can fall between "drawn" and
  "previewed".

## 0.4.0 — Phase 1 slice 4: raster tile cache (2026-10-13)

- **Fast panning and drawing over dense scenes.**
  - Committed objects are cached in 256 px tiles and reused while panning,
    drawing, selecting and lassoing.
  - Dense 10K scene: panning from 89 to 2.2 ms per frame, a still camera
    from 152 to 3.3 ms (Chromium p50). Firefox: 98 → 2 ms and 172 → 2 ms.
- **No visual compromise at depth.**
  - Tiles are never scaled or resampled, and they are not used while the
    zoom is changing.
  - They match direct rendering, including 1,600 levels deep.
  - Only tiles touched by an edit are redrawn.
- **Fix:** re-importing a missing original now refreshes everything that
  showed its placeholder.
- **Benchmarks:** `tests/bench/tiles.bench.ts` (pan, still and pan+zoom,
  tiles on and off); `npm run bench` now also runs in Firefox.

## 0.3.1 — Firefox support (2026-10-13)

- **Firefox is now tested on every run** (Firefox 157, a 4th E2E
  configuration).
  - Storage, multi-tab safety, assets, archives and deep-zoom rendering all
    pass.
  - Details, including Firefox's smaller `file://` storage quota (about
    790 MiB), are in `docs/testing/firefox.md`.
- **Faster grid drawing:** the background grid is drawn with filled
  rectangles instead of stroked lines. It is 7.8× faster in Firefox (14.9 →
  1.9 ms per frame) and slightly faster in Chromium.

## 0.3.0 — Phase 1 slice 3: portable archives (2026-10-13)

- **Export** a `.canvast` archive (a standard ZIP) for the whole workspace
  (storage panel), one board or canvas (breadcrumb menu), or one asset
  (Assets view). Each original is included once. Every archive is checked
  (directory, checksums, manifest) before it is saved.
- **Last full backup** is shown in the storage panel.
- **Import** from the storage panel or by dropping a file.
  - Everything is validated first (structure, version, checksums, objects,
    and the SHA-256 of every original), and a summary lists any problems
    before you confirm.
  - The import is applied in one transaction; it adds boards and canvases
    and never replaces anything.
  - Originals you already have are not stored twice.
- **Fix:** objects placed at zoom level 0 stored `unit` as `-0`; it is now
  written canonically as `0`.

## 0.2.0 — Phase 1 slice 2: Assets view, catalog and safe deletion (2026-10-13)

- **Assets view:** a top-level Canvas | Assets switch and a full-window
  library. It has search, filter, sort, thumbnail size, a library-only
  import, and an inspector showing where each asset is used.
- **Show** opens a canvas, selects the instances and frames them exactly, at
  any depth. **Place on** adds an instance to the open canvas.
- **One original per file, derived usage:**
  - IndexedDB schema 3 adds a metadata-only `assetCatalog` and an index from
    image instances to their asset;
  - usage counts come from stored instances;
  - existing originals get catalog entries automatically.
- **Reference-checked garbage collection:**
  - "Delete from library" is refused while an asset is used;
  - the original is erased only when no stored instance and no undo or redo
    state needs it, in one transaction;
  - undo after deleting returns the asset to the library.
- **Missing originals** are listed with their usage; re-importing the same
  file restores them.
- **Delete canvases and boards** from the breadcrumb menu, with
  confirmation. Each deletion is one revision-checked transaction; originals
  stay in the library, and other tabs follow.
- **Fix:** canvas shortcuts (Delete, Escape, tools) no longer act while a
  modal dialog or Assets view has focus.
- Test tooling: a quick E2E suite (`npm test`, about 8 min) for everyday
  changes and the full stress suite (`npm run test:full`, about 35 min) for
  milestone commits. See [docs/testing/README.md](docs/testing/README.md).

## 0.1.0 — Phase 1 slice 1: workspace and storage foundation (2026-10-13)

- **Workspace → Boards → Canvas.** A navigator switches, creates and renames
  boards and canvases. Each canvas has its own objects and camera, and the
  app reopens on the last canvas.
- **IndexedDB schema 2** with per-object records. Each save is one atomic,
  revision-checked transaction containing only the changed objects, and is
  read back to verify it.
- **Honest save states:** queued, saving, committed, verified, read-only,
  conflict, error and unavailable. A storage panel shows quota, persistence
  and backup status.
- **Upgrades:** v0.0.x snapshots are migrated automatically and verified
  object by object; legacy data is kept unchanged.
- **Multi-tab safety:** one writer (Web Locks, with a localStorage heartbeat
  fallback); other tabs are read-only, follow live and can take over. A stale
  commit is rejected, never applied.

## 0.0.3 — Phase 0C: scale and backend proof (2026-10-13)

- **Spatial index:** multi-scale (levels × `BigInt` cells, with coarse
  summaries), no world bounds or depth limit, incremental sync from
  transaction change sets.
- **Fast projection:** cell-relative, with no per-object `BigInt` work in the
  frame and exact fallback beyond the error bound.
- **Level of detail and batching:** sub-pixel content is skipped; opaque
  strokes with the same paint are drawn in one call.
- **Benchmark harness:** `npm run bench`.
  - 1M objects with about 500 visible: 6.4 s → 7.7 ms per frame (p50),
    CPU-only tier.
  - 100K objects: 608 → 2.2 ms.
- **Decision records:** ADR 0004 (index) and ADR 0005 (dense-scene
  acceleration: raster tile cache next, WebGL deferred, no WASM).

## 0.0.2 — Phase 0B: editing, precision and recovery (2026-10-13)

- **Objects:** freehand strokes and image instances. Each is independent,
  with an exact anchor, a scale exponent and an opacity.
- **Tools:** pen, select (click, shift, alt-cycle, move, corner resize), box
  selection, lasso (Strokes / All), and hand (`H`, Space, middle button).
- **Undo/redo:** exact, one step per gesture.
- **Images:** import via button, drag-drop or paste. Assets are
  content-addressed by SHA-256 and stored once.
- **Saving:** IndexedDB snapshot persistence with HUD save state, and camera
  restore.
- **Deep-zoom rendering:** exact stroke coverage and hit-testing at any
  magnification, with no magnification cap. Each object is painted once,
  which keeps opacity correct and is where future blend modes will apply.
  These fix two user-reported defects: holes and flicker beyond about 2^52×,
  and items disappearing beyond 2^900×.
- **Zoom controls:** click the zoom read-out to type a level. The `#debug`
  dev panel adds jump buttons and auto-zoom.
- **Icons:** Lucide icons (ISC), inlined, with the licence notice embedded.

## 0.0.1 — Phase 0A: endless navigation prototype (2026-10-13)

- Exact dyadic world coordinates (`src/core/dyadic.ts`) and a log2 camera with
  no zoom or pan bounds (`src/core/camera.ts`).
- Exactly reversible anchored zoom and pan, achieved by quantizing zoom steps
  (2^-20 level) and screen offsets (2^-32 px), with a 4,096-level precision
  budget.
- Canvas 2D renderer that works on the CPU: hierarchical grid, axes,
  landmarks.
- Input: wheel, ctrl+wheel pinch, shift+wheel pan, drag, touch pinch/pan,
  keyboard, HUD buttons.
- Single-file build (`npm run build` → `dist/canvast.html`) with a strict CSP
  and a static offline check.
- Unit tests (Vitest) and a Playwright navigation regression harness running
  in default, GPU-disabled, and DPR-2/touch Chromium configurations.
