# Changelog

## 0.17.0 — Assets, canvas tools and small screens (2026-10-16)

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
- **Resize, Figma style (ADR 0063):** handles on the middle of each side too; pictures resize freely (Shift keeps the proportions), **Alt** resizes about the middle, **Ctrl** turns snapping off, and the dragged edge **snaps** to other items with guide lines. Strokes and text keep their proportions.
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
