# Changelog

## 0.56.26 — Firefox pastes on the canvas (2026-11-10)

- **Fixed:** in Firefox, Ctrl+V on the canvas still pasted nothing: Firefox sends the paste to a hidden editable box that holds a selection, whose own handler took it first. The canvas now takes a paste before anything else on the page (unless a field or an editor has the keys).

## 0.56.25 — Firefox copies and pastes on the canvas (2026-11-10)

- **Fixed:** in Firefox, copy and paste on the canvas did nothing: Firefox names a hidden editable box as the target of the copy and paste events, so they were taken for a copy inside a text field. Copy, cut and paste now go by where the keys are (the focused element, or the page).
- **Fixed:** the resize-snap test accepts a pen stroke snapped by its bottom edge (it keeps its proportions, so the nearer edge holds).

## 0.56.24 — Firefox copies the canvas's objects; test fixes (2026-11-10)

- **Fixed:** in Firefox, Ctrl+C after Ctrl+A copied the page's text, not the objects: Ctrl+A on the canvas no longer selects the page's text as well, and while the canvas has the keys a copy or cut is of the objects, whatever the browser names as the event's target.
- **Fixed:** tests: the auto layout test finds its new shape by id (the layout deals the stacking order again, so it is not the last in the list); the balloon test opens the group in Layers only when it is folded; the copy test says what the browser sent when a paste fails (debug hook `clipboard()`).
- **Fixed:** tests: the resize-snap test drags the corner along the box's diagonal (a pen stroke keeps its proportions); the Ctrl list test waits for the rows to be drawn again after a scroll; the balloon test picks the words through the debug hook; the auto layout test draws its new shape in the gap.

## 0.56.23 — Firefox pastes copied things; test fixes (2026-11-10)

- **Fixed:** in Firefox, Ctrl+C and Ctrl+X on the canvas copied nothing (so Ctrl+V pasted nothing): Firefox sends no copy or cut event when no text on the page is selected. The selected objects are now copied or cut all the same when no event comes; and when no paste event follows Ctrl+V within a moment, what was copied here is pasted, once.
- **Fixed:** the auto layout controls used an attribute the Library's view buttons already had; renamed.
- **Fixed:** tests: the resize-snap test puts its picture on a sheet with *Put on a sheet* (one item); the balloon test Ctrl+clicks the words where they are drawn (a plain click picks their group); the resize-snap test drags a corner and allows a balloon's outline its known pixel; the Layers drag test waits for the row after the panel is drawn again.

## 0.56.22 — Auto layout on sheets (2026-11-10)

- **Added:** auto layout on sheets (ADR 0186): `Shift+A`, the Sheets menu or the sheet's badge in Layers lays out what is on a sheet as a row, a column, a wrap or a grid, with a gap, padding on each side, an alignment across the flow and a packing along it (start, centre, end, spread), all in the Properties bar when the sheet is picked. The sheet hugs its width or its height (as large as its contents) or keeps its size. Anything added to, taken off, resized or moved on the sheet lays it out again in the same undo step; a sheet that hugs lays out the sheet it is on in turn. A thing dropped on the sheet takes the place it is dropped at. Turning it on reads the layout from where things are; `Shift+A` on things that are on no sheet puts them on a new sheet that hugs them.
- **Changed:** the sheet `Shift+A` makes round picked things has no fill (give it one with Fill), as in other tools; *Put on a sheet* still makes a white one.
- **Added:** the Sheets menu offers *Auto layout on a new sheet* for picked things that are on no sheet (what `Shift+A` does), so it is reached without a keyboard.
- **Added:** a thing on such a sheet can fill the room along an axis (width, height or both) or be kept out of the layout (Properties bar).
- **Changed:** a sheet with auto layout that is resized by hand stops hugging on that axis; *Fit the sheet to its contents* is not offered for one (it hugs instead).
- **Added:** unit tests of the placing rule, the derivation, dropping and nested hugging; a sheets test of `Shift+A`, joining, deleting, reordering, the Layers badge and the menu.

## 0.56.21 — What a sheet cuts stays cut, blurred or shadowed too (2026-11-10)

- **Fixed:** a blur or a shadow on a shape, text or picture on a clipping sheet spread past the sheet's edge: the sheet cut the object before it was blurred. The cut now goes round the whole of it, adjusted and masked, on the canvas, in tiles and in exported pictures (an SVG already cut it so).
- **Fixed:** a video or GIF playing on a clipping sheet showed whole over the sheet's edge (and its blur with it): it is now cut by the sheet's shape as the canvas cuts it (by the innermost clipping sheet).
- **Changed:** the tests' Adjust panel helper is one (harness `openAdjust`); the sheet test checks that a blur stops at the sheet's edge.

## 0.56.20 — Firefox pastes copied shapes; snap tests fixed (2026-11-10)

- **Fixed:** in Firefox, Ctrl+V after copying shapes, balloons or a mix with pictures pasted nothing: when the browser refuses the newer clipboard, the older way's own copy counted as a new copy from elsewhere and took the focus off the canvas. It no longer does either.
- **Fixed:** the resize and drawing snap tests: a grid step is a power of two (the tests used its exponent as a length), an imported picture is clicked before it is resized (it was the rectangle beside it), and a shape drawn upward ends at its top.

## 0.56.19 — The Ctrl list scrolls past its ends instead of closing (2026-11-10)

- **Fixed:** with *Scroll the Ctrl list at its ends* on, moving the pointer past the list's top or bottom edge closed it; it now stays open there (up to about three rows' height past the edge, over its width) and scrolls that way, faster outside than on its end row.

## 0.56.18 — A taller Ctrl list, and a setting to scroll it at its ends (2026-11-10)

- **Changed:** the list beside the pointer while Ctrl is held is up to 16 rows tall (fewer when the bottom of the view comes first).
- **Added:** Settings › Navigation › *Scroll the Ctrl list at its ends* (off by default): with it on, holding the pointer on the list's top or bottom row scrolls it that way by itself; the wheel still scrolls it either way.
- **Added:** the Ctrl list test checks 16 rows and the scrolling at the bottom row with the setting on.

## 0.56.17 — The small Ctrl list holds every item and scrolls (2026-11-10)

- **Fixed:** holding Ctrl over an empty spot inside the selection opened the big touch menu far from the pointer; it is the small list beside the pointer again, now with every item (no "+ N more"): eight rows high, the wheel scrolls it while Ctrl is held (it does not zoom then), with a thin bar showing where you are; letting go of Ctrl ends it.
- **Changed:** a group's row is its Layers label alone (Group (22)), and its items are indented under it by spacing, not "›".
- **Added:** the Ctrl list test checks that the list holds every row, scrolls with the wheel and leaves the view as it was.

## 0.56.16 — One list to choose from: Ctrl+click and a long press (2026-11-10)

- **Added:** holding Ctrl over an empty spot inside the selection's box lists what the selection holds beside the pointer, the same rows as the list a click opens: a nested group is one row by its name, outlined whole, and a Ctrl+click on it picks the whole group.
- **Added:** Ctrl+click inside the selection's box where nothing can be picked opens a list of what the selection holds: a lone group's items one level in, or each thing of a multi-selection; a row picks it alone (Shift adds or takes it out).
- **Added:** that list, and a long press on touch, are one list (the shared menu, built by one function): what is under the pointer, then what the selection holds. Hidden and locked things under it are rows too: pressed, they are shown or unlocked. A shape's words and a balloon's connector say whose they are.
- **Added:** in both lists a group the selection holds is one row, named by the very labels Layers uses (its name, its operation, or Group (2)), with what is in it (Group (2): Star, Rectangle); every row's name is its Layers label, and its own items are indented under it, each one pickable; the row under the pointer outlines all it stands for.
- **Changed:** while Ctrl is held over an empty spot inside the selection, every item of the selection is listed beside the pointer in the shared menu, a box about eight rows high that scrolls (no "+ N more"); a row outlines only its item and picks it; letting go of Ctrl closes it. A row is ticked when all it stands for is selected.
- **Added:** the first time the list opens, a notice says what it is.
- **Changed:** Ctrl+click on something that can be picked still picks it at once; holding Ctrl still outlines what is under the pointer.
- **Added:** a test of the list for a multi-selection, a group and a hidden thing.

## 0.56.15 — A balloon's words and connectors belong to it (2026-11-10)

- **Fixed:** a speech balloon's words, a connector and its cover piece could end up in another group or sheet than their balloons (dragged apart in Layers, a balloon grouped alone, moved onto a sheet): words were unclipped or behind their balloon, a connector stuck out of a clipping sheet. The document now keeps a shape's words in its group and sheet, just in front of it, and a connector with its cover where both its balloons are (outside a boolean group), whatever moves them: one rule (doc/belongs.ts).
- **Changed:** in Layers a shape's row stands for its words, and a balloon's for its connectors: they are no rows of their own, and the row selects, hides, locks and moves them together. A connector's cover piece is never listed.
- **Changed:** Connect balloons joins balloons on the same sheet only.
- **Fixed:** a balloon's words hidden or locked on their own (picked on the canvas) could not be shown or unlocked again from Layers, even after a reload: a row whose parts are partly hidden or locked shows it, and its eye or lock shows or unlocks all of them.
- **Added:** a test groups a balloon alone and drags another into its group in Layers, and checks where the words, the connector and its cover go.

## 0.56.14 — Drag layers into and out of groups and sheets (2026-11-10)

- **Added:** in the Layers panel a row dropped on the middle of a group, a boolean group or a sheet goes inside it; dropped on the top or bottom edge of a row it goes before or after it, at that row's level (out of a group or a sheet too). Objects, whole groups and sheets with what is on them, as deep as groups and sheets go; it stays where it is on the canvas; one undo step. A line or a highlight shows where it will land.
- **Added:** a shape dropped into a boolean group becomes one of its shapes, and leaves it when dragged out; the result follows.
- **Added:** a group never goes inside itself, nor a sheet onto itself or onto what is on it, nor a locked layer anywhere: a message says why.
- **Added:** unit tests of every move (into, out, deep, boolean, sheets, refused) and a Layers drag test.
- **Changed:** a drop on the middle of a plain row puts it after that row (before it on the top half).

## 0.56.13 — The ratio while drawing (2026-11-10)

- **Added:** while a shape, sheet, speech balloon, text box or note box is drawn, its ratio (width : height) shows beside the pointer, as on a resize: one label for both.
- **Fixed:** the words beside the pointer were drawn only with the Select and Edit nodes tools, so a drawing tool's ratio never showed; they show with every tool.
- **Fixed:** a text or note box being dragged out showed its outline where the pointer was, not where it would snap to.

## 0.56.12 — Each tool's cursor carries its icon (2026-11-10)

- **Fixed:** the tools that draw showed a plain crosshair, the same for every tool. A tool that draws, picks by drawing or erases shows its own icon beside a small crosshair, the icon the rail shows: each kind of shape and of pen its own.
- **Added:** the cursor test checks every kind of shape and pen too, and that no two tools share a cursor.

## 0.56.11 — Each tool its own cursor (2026-11-10)

- **Fixed:** the Shapes, Speech balloon, Path and Sheet tools showed the hand over the canvas, as if it would pan; they show the crosshair. Every tool's cursor is now in one table (the arrow to select, the hand to pan, the text cursor for words, the crosshair to draw, pick by drawing or erase).
- **Added:** a test checks the cursor of every tool of the rail.

## 0.56.10 — Resizing a sheet snaps; drawing snaps (2026-11-10)

- **Fixed:** a sheet resized by a handle (a picture's own sheet too) did not snap: what is on it, which moves with it, counted as lines to snap to and held its side where it began. What moves along (on a sheet, attached) is never a line to snap to, for every gesture.
- **Added:** drawing snaps: a shape, a line, a sheet, a speech balloon, a text or a note box starts on the corner, edge, middle or grid line it is pressed near, and its dragged corner snaps as a resized one does (Ctrl held: no snap; Shift and Alt keep their corner). One rule with resizing.
- **Fixed:** in Firefox, objects copied with Ctrl+C did not paste back with Ctrl+V: Firefox writes the clipboard its own way, so its text no longer matched what was copied. What was copied here counts as the clipboard until the window loses the focus or something else is copied, as a copied picture already did.
- **Added:** a test draws shapes and sheets starting near a corner, an edge and a grid line, and ending near a corner, and checks where they land.
- **Added:** a test resizes every kind (shape, picture, a picture on its own sheet, pen stroke, speech balloon, group, sheet) toward another object and toward the grid, and checks its side lands exactly on the line.

## 0.56.9 — Pressed buttons under the pointer; Library and Canvas joined (2026-11-10)

- **Fixed:** a pressed or selected button under the pointer lost its fill and showed a light icon on a light ground (the Actions bar, the bars of tools); it stays filled, a step deeper.
- **Fixed:** the Library and Canvas buttons had a gap between them and round inner corners; they are one joined set again (a later rule of the top left row put the gap back).
- **Changed:** one rule fills a pressed button of any bar with the accent, and one keeps it filled under the pointer, instead of one for each bar.
- **Added:** a test hovers every button of the bars and of the segmented controls, pressed or not, in the light and the dark theme, and measures the contrast of its icon and its words.

## 0.56.8 — A wider Export dialog (2026-11-10)

- **Changed:** the Export dialog is wider by default (as wide as for several items, within the window).
- **Fixed:** in Export, *Preset* stood centred above the size, and the *Colour* background button put its swatch under its name.

## 0.56.7 — The desktop build checks again (2026-11-10)

- **Fixed:** the desktop app's type check failed since 0.56.5: the saved styles reached the Export dialog's page code for export presets. The presets' data now lives on its own (`app/export-prefs.ts`).

## 0.56.6 — One list of kinds in Styles; Pattern tabs by Density (2026-11-10)

- **Changed:** the Styles panel shows its kinds in one list (the shared menu), each with its icon, its name and how many there are, opened from a button at its top, instead of a row of tabs.
- **Changed:** the Patterns and Guides tabs of the Pattern panel are the shared segmented control, sized by Density.
- **Added:** a menu row can show a count at its end.
- **Fixed:** the Export dialog had the browser's plain square black border: a stray brace in the style sheet dropped its whole look. It now has the shared dialog's look (its border, corners and shadow).
- **Fixed:** a colour or a menu opened from a dialog (Export's background *Colour*) could not be used: the page around a dialog does not answer. Menus and colour popovers now open inside the dialog.
- **Changed:** every dialog's width is a token and keeps an edge from the window, the same for all; each has the shared shadow.

## 0.56.5 — Export: on-screen sizes, padding, presets, Export again (2026-11-10)

- **Added:** in Export…, sizes of 1× to 4× what is shown on screen; padding round what is exported (px or %), in every format; any background colour, or the canvas colour.
- **Added:** export presets, saved styles of their own (format, quality, background, padding, resolution, size): saved, chosen and updated in Export…, managed in the Styles panel.
- **Added:** Export… opens as that sheet or selection was last exported on this device, and *Export again* in the Export menu does it with no dialog; `Enter` exports as last time, `Ctrl+C` copies.
- **Changed:** a selection is named after what it is: a group's name, a balloon's or a text's first words, or "… and 2 more", not "selection".
- **Changed:** the resolution is marked as recorded only when the size is in px; the size in in, cm or mm is shown only when one is chosen, or for a PDF.
- **Changed:** one segmented control for the export dialog, the colour picker's modes and options, and the Styles panel's Apply to; the dialog's close and footer buttons are the shared ones; a quieted line uses the muted colour, not opacity.

## 0.56.4 — Custom ratios (2026-11-10)

- **Added:** custom ratios for sheets and shapes: *Save this ratio…* in the *Shapes…* list takes a ratio or a size in px (made a ratio) and a name, listed under *Custom* and given as saved. A *Ratios* tab of the Styles panel renames, changes, updates and deletes them.
- **Added:** custom ratios are kept in the workspace and go with every backup and Advanced export, also when *Saved styles* is left out.

## 0.56.3 — Ratio for shapes (2026-11-10)

- **Added:** the *Ratio* field, its presets and *Turn* work on one selected shape (rectangle, ellipse, polygon, star, speech balloon) as on a sheet, keeping its area.
- **Removed:** the small picture of the shape beside *Ratio*.

## 0.56.2 — Cut, copy and paste fixed (2026-11-10)

- **Fixed:** in the desktop app, a cut left the clipboard as it was, so a paste took what was copied before (text or files of another program) instead of the cut objects.
- **Fixed:** *Cut* in the command palette did not put the objects on the system clipboard, so a paste with the keys found nothing.
- **Fixed:** a speech balloon or any shape with words was copied, cut or duplicated without its words; a cut left them behind as plain text.
- **Fixed:** a connector copied with only one of its balloons stayed tied to the original; it now goes only with both, and copying both takes it along.
- **Added:** words copied in another program and pasted on the canvas become a new text under the pointer, selected (a long one wrapped); they did nothing.
- **Changed:** a cut says *Cut*, not *Copied*, and is undone as *Cut*.

## 0.56.1 — Opening and new files say how far they are (2026-11-10)

- **Added:** the start screen says what opening a workspace is doing: the library's parts and the canvases, each with its count.
- **Added:** a progress notice while ten or more files put in the workspace folder from outside are looked at and added to the library.

## 0.56.0 — Speech balloons, sharing on the network, safer hidden items (2026-11-10)

Everything since 0.55.0, in one release (0.55.1 to 0.55.44).

- **Added:** a Speech balloon tool (`K`): twelve bodies, any number of tails with handles for tip, base, width, middle width and bend, rounded tips, thought bubbles, a double line, presets, *Save as style* and *Convert to path*; the next balloon takes the last look.
- **Added:** words in a balloon by double-click; *Connect balloons* joins two or more with a neck, pinch, line or dots that follow them and have their own handles.
- **Added:** text inside any closed shape, boolean shape or group, each line as wide as the shape is there, with per-side padding, *Across* and *Down* alignment, justified text, words that go round holes and *Fit to shape*.
- **Added:** sharing on the local network (desktop app): read-only guests in a browser or the app, a folder for file managers (WebDAV) with a login per device, its rights and an activity list.
- **Added:** canvast tools, one file for Node.js 20 or later attached to every release: a menu in plain words or one-line commands to open hidden items, hide files into a workspace and share a folder. `hidden-items.mjs` with no arguments decrypts what sits beside it.
- **Added:** **Lock** on the hidden mode chip and **Lock now** in Settings > Privacy; **New key** encrypts every hidden file and name again under a new random key.
- **Added:** Advanced export in Settings > Storage: search and choose what goes in a backup, or Everything, with or without the canvases, with *Saved styles* on by default.
- **Added:** *Each on its own* in Export, one PDF page or one file per selected item, and *Put each on its own sheet* in the Sheets menu.
- **Added:** previews in the Trash for every kind the library draws one for.
- **Added:** sort buttons for Saved searches and File types.
- **Added:** the technical info bar shows the memory of tiles, the undo history and the JS heap, beside the decoded pictures.
- **Added:** `Stress hidden` with `--big`, up to about 15 GB of files from 50 KB to 2 GB.
- **Changed:** in the desktop app a deleted library item goes to the workspace's `.trash` at once.
- **Changed:** hiding and showing keeps memory flat: past 16 MiB a file is sealed and opened a part at a time, and read fewer times. The tools do the same for files of any size.
- **Changed:** undo keeps its 500 steps only while they hold about 256 MiB or less; big pictures being decoded at once wait their turn.
- **Changed:** a tool's options come first in its bar; a panel setting of more than four choices is a dropdown.
- **Changed:** words in a shape are typed in a box in the middle of the shape, on the shape's colour; each side handle sets the padding of its own side, the left and right handles of a text change only the width of its box.
- **Changed:** deleting a speech balloon or any shape leaves its words as plain text, in the same undo step.
- **Changed:** Settings > Sharing keeps fixed rows, with long lists in a dialog; Saved searches are rows like the folders'.
- **Changed:** the hidden mode chip, Settings > Privacy and the README say what Exit and Lock each do.
- **Changed:** the README starts with notes from the developer.
- **Removed:** the limit of 500 saved styles.
- **Removed:** the Balloons tab of the Pattern panel, replaced by the tool.

- **Fixed:** *Lock now*, *New key* and other Settings buttons stayed on screen when they should hide; *Lock now* now says when locking is done, and its status shows only the latest answer.
- **Fixed:** New key left the encrypted names of hidden files and folders under the old key.
- **Fixed:** a hidden item kept its file name as a layer name on a canvas; hiding it takes that name off, and a hidden item's name is not stored.
- **Fixed:** a guest's Hidden password said yes while hidden items were not shared.
- **Fixed:** library items deleted in the desktop app could come back after a restart; a file changed since it came in stayed where it was.
- **Fixed:** the start-up sweep could delete a file of yours named like the app's temporary ones; a board or canvas left half moved by a crash now goes back or into `.trash`.
- **Fixed:** a resize handle dragged past the far side collapsed an item; a sheet's handles threw it far from the pointer at some zooms.
- **Fixed:** styles restored from a backup appeared only after a restart, and saving one before that lost them.
- **Fixed:** a saved balloon style kept only the body's numbers.
- **Fixed:** connectors painted over a balloon's words, and one deleted alone left a piece behind.
- **Fixed:** the words of a balloon were fitted to its outline with the tail, and used the unturned body of a turned balloon.
- **Fixed:** text in a shape lost its options, left its outline behind and updated late; text along a path lagged, could vanish, did not follow its path, and *Along the path* and *Side* did nothing.
- **Fixed:** a number field in a bar lost the focus or jumped back to its old value.
- **Fixed:** a placed item took an old name after a rename in another program.
- **Fixed:** in Export, a balloon and its words counted as separate items and a connector as one.
- **Fixed:** the grab cursor and Space panning could stay on after Space was let go in another window.
- **Fixed:** after a delete in the library the search box took the focus.
- **Fixed:** Settings jumped to the top while sharing was on, and a press could open a dialog once per visit to the Sharing tab.
- **Fixed:** canvast tools: the password question could show what was typed on newer Node.js.
- **Fixed:** a pattern made on a sheet left part of the old picture in view.

## 0.55.44 — Memory: measured, and two limits (2026-11-10)

- **Added:** the technical info bar shows the memory of tiles, the undo history and the JS heap, beside the decoded pictures.
- **Changed:** big pictures being decoded at once are limited by their pixels, so several huge ones wait their turn.
- **Changed:** the undo history keeps its 500 steps only while they hold about 256 MiB or less; past that the oldest go.

## 0.55.43 — Each selected item as its own page (2026-11-09)

- **Added:** *Each on its own* in Export: several selected items, sheets or not, become one page of a PDF each, or one file each in a ZIP. With PDF chosen it is the way it opens. Pictures keep their own pixels until a width is set.
- **Added:** *Put each on its own sheet* in the Sheets menu. A picture's sheet is exactly its size and has no fill.

## 0.55.42 — A hidden item keeps no name on a canvas (2026-11-09)

- **Fixed:** an item placed while shown and hidden later kept its file name as its layer name, in the canvas file too; hiding it takes that name off on every canvas. A name typed by hand stays.

## 0.55.41 — A placed item takes the file's name of that moment (2026-11-09)

- **Fixed:** an item placed after its file was renamed in another program had the old name as its layer name. A newly placed item now keeps the file's name at that moment; a hidden item's name is not stored.

## 0.55.40 — Names follow a rename outside the app (2026-11-09)

- **Fixed:** a file renamed in another program kept its old name as the layer name of the items placed from it.

## 0.55.39 — Resizing a sheet zoomed far out or in (2026-11-09)

- **Fixed:** at a zoom where a sheet is kept in another coordinate frame than the view, its resize handles threw it far from the pointer.

## 0.55.38 — A resize never collapses (2026-11-09)

- **Fixed:** a handle dragged past the far side of a sheet or any item shrank it to almost nothing, and it seemed to be gone; a box now stops at a small size on the screen.

## 0.55.37 — Restored styles appear at once (2026-11-09)

- **Fixed:** styles restored from a backup appeared only after a restart, and saving a style before that restart lost them.

## 0.55.36 — Saved styles: no limit, in Advanced export (2026-11-09)

- **Added:** *Saved styles* in Advanced export, on by default, with the fonts and pictures they use.
- **Removed:** the limit of 500 saved styles.

## 0.55.35 — A balloon style keeps the whole balloon (2026-11-09)

- **Fixed:** a saved balloon style kept only the body's numbers; it now keeps the size and ratio, every tail, the fill, outline, opacity, blend and adjustments, and the look of the words. Applying it adds its words only to a balloon that has none. Saved earlier, a style still gives only its body.

## 0.55.34 — Advanced export (2026-11-09)

- **Added:** Advanced export in Settings > Storage: search for items and folders and choose what goes in a backup, or Everything, with or without the canvases; hidden items are asked about first.

## 0.55.33 — Connectors and the Styles tabs (2026-11-09)

- **Fixed:** the neck of a connector painted over the words of a balloon; what hides the outlines now stops just inside each balloon's edge, and the two outlines meet.
- **Fixed:** a connector deleted by itself left a thin piece behind; such pieces are removed.
- **Fixed:** the pattern package and `check:patterns`: the random source stays in the generators' folder.
- **Added:** handles for where each end of a connector stands on its balloon.
- **Changed:** the Speech balloon tab of the Styles panel has its icon, and the row of tabs scrolls.
- **Removed:** the name label of a connector.

## 0.55.32 — Bars in order, editing in the shape, path options (2026-11-09)

- **Fixed:** *Along the path* and *Side* of a text along a path did nothing.
- **Fixed:** a number dragged or typed in a bar jumped back to its old value until it was settled.
- **Fixed:** the pattern package was built without its declarations.
- **Changed:** words in a shape are typed in a box in the middle of the shape, on the shape's colour.
- **Changed:** a tool's options come first in its bar: the Speech balloon button and *Paragraph and box* are at the start, and *Adjust* before the numbers of a shape or a picture.


## 0.55.31 — Shared random source (2026-11-09)

- **Changed:** the seeded random source moved to the core, shared by balloons and patterns; nothing changes on screen.

## 0.55.30 — Balloons and text in shapes: fixes and the rest of the list (2026-11-09)

- **Fixed:** a number field in a bar lost the focus as it was typed in: a typed value counted as a drag and hid the field for a moment.
- **Fixed:** text along a path did not follow its path; it now does, in the same undo step, and is plain text again when the path is deleted. Paths set before this version need setting again.
- **Fixed:** words of a turned balloon, and connectors of turned balloons, used the unturned body.
- **Fixed:** a long first word in a shape was split when lower down it fits whole.
- **Fixed:** the words of a shape now move with it during a drag, not only when it ends.
- **Changed:** a balloon's handles still show when its words are selected; a text in a shape has a box as tall as the shape, so its handles sit at the shape's edges.
- **Changed:** each side handle of a text in a shape sets the padding of its own side; the options of a text in a shape are in one place, the balloon panel.
- **Added:** per-side padding, justified text, words that go round holes, and a note when words do not fit.
- **Added:** for balloons: a size handle for the body alone, *Save as style*, the next balloon taking the last look, a double line, round tail tips, double-click on the outline to add a tail, snapping of the handles.
- **Added:** connector handles for width and bend, and connecting more than two balloons.

## 0.55.29 — Side handles set padding in a shape (2026-11-09)

- **Changed:** the side handles of a text in a shape change its padding: left and right the sides, top and bottom the top and bottom. Its corners still change the letter size.

## 0.55.28 — Balloon words kept (2026-11-09)

- **Changed:** deleting a speech balloon keeps its words as plain text, as for any shape.

## 0.55.27 — Text outlives its shape (2026-11-09)

- **Fixed:** a text whose shape was deleted kept the shape's outline; it is plain text again, in the same undo step.

## 0.55.26 — Speech balloons complete (2026-11-09)

- **Fixed:** padding, and other options of a text in a shape, were dropped when changed.
- **Fixed:** a text in a shape resized or moved on its own left its outline behind, so its words spilled and were cut off; the shape now always sets where the words go.
- **Fixed:** the words of a balloon were fitted to its outline with the tail; they now fit its body.
- **Fixed:** a copied shape's words stayed tied to the original.
- **Added:** words in a balloon by double-click, and the alignment, padding, overflow and Fit to shape in its panel, opened from the Actions bar for any text in a shape.
- **Added:** any number of tails, thought bubbles, presets, a handle that moves the body while the tail tip stays; a tip let go inside the body removes its tail.
- **Added:** connectors between two balloons (neck, pinched, line, dots) that follow them.
- **Added:** Convert to path, with a warning.
- **Fixed:** editing text in shapes and balloons did needless work at every pointer move and layout.
- **Removed:** the Balloons tab of the Pattern panel; the Speech balloon tool replaces it.

## 0.55.25 — Speech balloon tail controls, text box width (2026-11-09)

- **Changed:** a speech balloon's tail base stays where it is when the tip moves; *Base: Follows tip* in its panel brings the old way back.
- **Added:** a *Middle width* for the tail, with its own handle.
- **Changed:** each balloon handle has a mark of its own (tip, base, width, bend, rounding) instead of a plain dot.
- **Fixed:** a curved tail's bend changed its width half way along.
- **Changed:** the left and right handles of a text change only the width of its box, and the words wrap again at the same size; the other handles still scale it.

## 0.55.24 — Text in a shape updates at once; its own alignment (2026-11-09)

- **Fixed:** a text in a shape showed its new place only at the next interaction; it now changes with the shape, in the same undo step.
- **Fixed:** a text in a shape set to the left or the top went back to the middle when the shape changed.
- **Added:** *Across* and *Down* alignment beside the padding in the options of a text in a shape.

## 0.55.23 — Speech balloon panel layout (2026-11-09)

- **Fixed:** the Speech balloon panel had no spacing of its own and its tail kinds wrapped; it now has the same layout as the Pattern panel, with the kind as a dropdown.

## 0.55.22 — Speech balloon tool (2026-11-09)

- **Added:** a Speech balloon tool next to Shapes (`K`): twelve body shapes, a tail set by handles (tip, base, width, bend), a handle for rounding or bump depth, and a panel opened from the Actions bar. A balloon stays editable, and resizes, undoes and saves like any shape.

## 0.55.21 — Text in boolean shapes and groups (2026-11-09)

- **Fixed:** *Text inside the shape* and *Text along a path* were not offered for a boolean shape or a group; the words go in its biggest piece.

## 0.55.20 — Text follows its shape (2026-11-09)

- **Fixed:** a text inside a shape kept the outline the shape had when the text was put in; it now follows the shape when it is moved, resized or changed.
- **Fixed:** a pattern made or changed on a sheet redraws the whole view, so no part of the old picture is left.

## 0.55.19 — Balloons audited (2026-11-09)

- **Fixed:** a balloon's tail took whole sides of a box; a balloon moved in its settings could be cut by its sheet; the heart was out of its box; the zigzag tail folded over itself; a linked balloon's tail crossed the others; linked balloons overlapped, and dots hid under them; dashes were too short to see.

## 0.55.18 — Long choices are dropdowns (2026-11-09)

- **Changed:** a panel setting of more than four choices is a dropdown, in every panel. The Balloons settings follow the others: Colour first, short names, rows shown only when they apply.

## 0.55.17 — Speech balloons (2026-11-09)

- **Added:** a Balloons tab in the Pattern panel: 12 body shapes; point, curved and zigzag tails, thought bubbles and a second tail, each with its tip; up to 6 linked balloons with a neck, pinched, line or dots connector; solid, double or dashed outlines, a shadow and a hand-drawn wobble.

## 0.55.16 — Text in shapes; text on a path repaired (2026-11-09)

- **Added:** text inside a closed shape (*Path tools > Text inside the shape*): each line as wide as the shape is there.
- **Added:** options in *Paragraph and box*: on a path, start, alignment, side and distance; in a shape, padding, where the words sit, whether words that do not fit are shown, and Fit to shape.
- **Fixed:** text on a path could lag badly (each letter looked its whole text up again, every frame; big letters took exact arithmetic) and could vanish when its straight position was out of view.

## 0.55.15 — Lock now hides; New key moves the names too (2026-11-09)

- **Fixed:** *Lock now*, *New key* and the other buttons of the Settings cards that should be hidden stayed on screen (a style overrode `hidden`).
- **Fixed:** New key left the encrypted names of hidden files and folders under the old key; every name is now encrypted again before the old key's record goes.
- **Changed:** hiding a file reads it fewer times: one check of the original once it is sealed, and the sealed copy read back once.

## 0.55.14 — Hidden items faster, New key, previews in the trash (2026-11-09)

- **Changed:** hiding and showing hidden items keeps memory flat: every file past 16 MiB is sealed and opened a part at a time, and each copy is proven chunk by chunk with the platform's own SHA-256 (it was a SHA-256 written in JavaScript, about ten times slower), with the file itself checked by the main process before and after.
- **Added:** **New key** (Settings > Privacy): a new random key under the same password, every hidden file encrypted again with it in the background (each checked, their encrypted names too; stopped half-way, it goes on at the next opening), so old copies of `hidden.json` and the old password open nothing.
- **Added:** changing the Hidden password says that copies of `hidden.json` from before still open with the old password, and points to New key.
- **Added:** the Trash shows each file with the picture the library gives its kind (a note's page, a PDF's, a video's frame, an art file's picture), not only pictures.
- **Changed:** the canvast tools and `scripts/hidden-items.mjs` encrypt files of any size a part at a time (they read a file whole, up to 2 GiB).

## 0.55.13 — Delete goes to the trash, at once (2026-11-09)

- **Changed:** in the desktop app, a library item you delete has its file moved into the workspace's `.trash` at once, with no other step: it is no longer kept in the library folder while undo could need it (`.trash` is the way back). *Delete library files at once* is gone from Settings > Storage: that is what it always does now.
- **Fixed:** deleting a library item whose file had changed since it came in (a note edited in the app or in another program, a picture rewritten by one) left its file where it was and took it in again at the next start, as a new item; it goes into the workspace's `.trash` now. A file another item names stays.

## 0.55.12 — A delete leaves the keyboard in the list (2026-11-09)

- **Fixed:** after deleting items in the library, the search box took the focus and opened its menu; the first card in view (or the list) has it now.
- **Fixed:** the desktop app said a deleted item's file was erased from the browser's storage; it says it goes to the workspace's `.trash`.

## 0.55.11 — Deleted stays deleted (2026-11-09)

- **Fixed:** library items deleted in the desktop app could come back after a restart, as new items. Erasing one dropped what the device remembered of it before the library's files in the folder were written without it (a restart in between took it for an item added elsewhere), and dropped its records before its file was moved to the trash, ignoring a move that failed (the file left behind was taken in again). Now its file goes to the trash first, its records only then, and the device remembers it until the folder no longer lists it; a file that cannot be moved keeps its item deleted, says so and is tried again.
- **Added:** a test deletes an unused and a placed item, restarts the app twice and checks that neither comes back and both files are in `.trash`.

## 0.55.10 — The password card shows the latest answer (2026-11-09)

- **Fixed:** in Settings > Privacy, the status asked when the tab opened could answer after *Lock now* and show the hidden items unlocked again; only the latest answer is drawn now.

## 0.55.9 — Locking shows itself at once (2026-11-09)

- **Fixed:** *Lock now* goes away when pressed and says *Locking: writing what waits first…* until the key is gone; it says locked only once it is.

## 0.55.8 — Lock now says it is done (2026-11-09)

- **Fixed:** *Lock now* stayed on in Settings > Privacy after it was pressed: locking writes what waits first, and the card is now drawn once the key is gone.
- **Fixed:** canvast tools: the password question was drawn over and could show what was typed on newer Node.js; Enter picks the tool's own folder; only the file to run is named `canvast-tools.mjs`.

## 0.55.7 — canvast tools: share, decrypt and encrypt without the app (2026-11-09)

- **Added:** `canvast-tools.mjs`, one file for Node.js 20 or later, attached to every release: a menu in plain words (or one-line commands) to open your hidden items, hide files into a workspace, and share any folder with other devices on your network as a folder for file managers (WebDAV over HTTPS: a workspace's Library, and its Hidden items decrypted only as they are read; or any other folder), read only unless you allow changes, with one login per run or saved devices with their own rights.
- **Changed:** the README starts with notes from the developer.

## 0.55.6 — Clean after a crash, never a file of yours (2026-11-09)

- **Fixed:** the start-up sweep of half-written files took any file whose name ended in `.tmp-` and letters (`notes.tmp-2`) for one of the app's and deleted it after ten minutes; only the app's own names (`.tmp-` and an id) are swept now.
- **Fixed:** a board or canvas left half moved by a crash (`.canvast/moving/`) goes back where `workspace.json` says at the next start, or into `.trash` when that place is taken; it was left there.
- **Added:** a test plants what a crash leaves (a hidden item's readable copy, a cut-off write, a half move) beside the person's own files and checks the next start clears the first and keeps every one of the others as it was.
- **Added:** `Stress hidden` with `--big`: about 15 GB of files from 50 KB to 2 GB beside thousands of small ones, hidden, opened, read back, shown and decrypted, timed per size.

## 0.55.5 — Lock the hidden items from where you are (2026-11-09)

- **Added:** **Lock** on the hidden mode chip and **Lock now** in Settings > Privacy (desktop app), beside *Lock hidden items* in the command palette.
- **Changed:** the hidden mode chip, Settings > Privacy and the README say what Exit and Lock each do: Exit takes the hidden items off this screen and keeps them unlocked (shared devices can still open them); Lock removes the key.

## 0.55.4 — Why the folder refused a sign-in (2026-11-09)

- **Changed:** a refused sign-in to the folder for file managers is in the activity with the user name tried (never the password) and why: a device login's wrong password, or a user name that is no login with a password that is not the shared one.

## 0.55.3 — Sharing on the local network, its settings tidied (2026-11-09)

- **Added:** sharing on the local network (desktop app, branch `lan-sharing`): read-only guests in a browser or the app, the folder for file managers (WebDAV) with a login per device and its rights, the activity, starting with the app.
- **Changed:** Settings > Sharing keeps fixed rows: devices, logins, apps and activity open in a dialog; About shows the latest error and *Show all*.
- **Changed:** the folder's *Hidden*, while the hidden items are locked on the host, holds a note saying so; the activity tells when it was listed, locked, or not answered.
- **Fixed:** in Settings, one press opened a dialog once per visit to the Sharing tab; a list dialog now opens once.
- **Fixed:** Settings jumped to the top while sharing was on (every status redrew the page).
- **Fixed:** the Sharing tab's buttons and the shortcut rows are at the standard height, on one line, ending at the right edge (checked on every tab).
- **Fixed:** a guest's Hidden password opened nothing but said yes while hidden items were not shared.

## 0.55.2 — Decrypt the hidden items the simple way (2026-11-09)

- **Added:** `node hidden-items.mjs` with no arguments decrypts the `.hidden` folder and `hidden.json` that sit in the script's own folder into `output/` beside them; `hidden.json` may be loose beside `.hidden`. A missing file is named in plain words.

## 0.55.1 — One look for every sidebar list; Space let go elsewhere (2026-11-08)

- **Changed:** Saved searches in the library's sidebar are rows like the folders': an icon, the name, a count chip and a ⋯ shown under the pointer (always on touch screens); *Update* moved into the ⋯.
- **Added:** sort buttons for Saved searches (your order, A to Z, Z to A, the most found first) and File types (the most first, A to Z, Z to A), as Folders and Tags have; a test checks that every sidebar list follows the folders' look.
- **Fixed:** the grab cursor and Space panning could stay on after Space was let go in another window; Space is now let go when the window loses or gains focus, or once its key repeats stop.

## 0.55.0 — Backups that travel, hidden items encrypted everywhere (2026-11-08)

Everything since 0.54.48, in one release (0.54.49 to 0.54.63).

- **Added:** importing a workspace backup can **update this workspace** (boards and canvases by id, changes made elsewhere taken, this workspace's own change kept as a conflict copy, what the backup lacks set aside) or add new boards: work elsewhere in the browser or the desktop app, come back with the backup.
- **Added:** a browser's backup encrypts its hidden items with the Hidden password, as the desktop app's; the browser opens a desktop backup's hidden items with their password; their dates, tags and notes travel in both directions.
- **Added:** settings that shape the workspace's files are kept in the workspace and shared by every device; the rest stay on the device.
- **Added:** copies of a file put in other folders of the library are items of their own (desktop); `is:copy`, `is:samename`; a **Missing** row in the library's sidebar; saved searches with counts, names of their own and a ⋯ menu.
- **Added:** with Window frame off, the window moves by its row's title (drag area), on Wayland too; minimize and maximize show the common icons.
- **Changed:** every library folder goes in a backup, empty and hidden ones too; an item's date added is its own in a backup.
- **Fixed:** library folders deleted outside the app came back.
- **Fixed:** a file whose ending the app did not know was renamed with a made-up one (`.octetstr`).
- **Fixed:** hidden items lost their details, or were encrypted only later, when imported into the desktop app; a write of a hidden file with a long name failed (ENAMETOOLONG).
- **Fixed:** a new device could write its default settings over the workspace's; a quick change of a setting could be undone by an older copy.

## 0.54.63 — An import finishes its encryption; dates kept (2026-11-08)

- **Changed:** a backup made in the browser encrypts its hidden items with the Hidden password, as the desktop app's do (sealed files, encrypted names and folders, a key file with their sealed index): nothing of them is readable in it, and either app opens them with that password. The desktop app then has nothing to encrypt at the import. With no Hidden password set in the browser, they go in readable, as before, and the export says so.
- **Fixed:** a backup said when each item came from its stored file's record, not from the item itself (what Newest sorts by), so the order could differ where it was imported.

- **Fixed:** a desktop import of a browser's backup with many hidden items could start the app again before they were all encrypted, and the rest was encrypted after the start, on a screen of its own. The import writes again until every one is (it says if any could not be), all on its own screen.
- **Fixed:** into a desktop workspace with no Hidden password yet (an empty one), a backup's readable hidden items were encrypted only when the hidden list was first opened, while it was browsed. The import now asks for the backup's own Hidden password when it brings one (once, checked against it; it becomes this workspace's, as the browser's import offers), else to set one (typed twice), and encrypts them on its own screen.
- **Fixed:** when an item came into the library only ever goes earlier: an item taken in or recovered here a moment before its backup's or index's date arrived (dated now) takes that date, so Newest is the same as where the backup was made.

## 0.54.62 — Hidden items keep their details through every import (2026-11-08)

- **Fixed:** hidden items from a browser's backup lost their names, notes and tags on the desktop when *Keep hidden items' names off this device while locked* was on: they were encrypted a while after the import, and a lock before the sealed index was written blanked them with nothing to fill them in from. Only what the sealed index holds is blanked now.
- **Fixed:** the desktop app encrypts a backup's readable hidden items in the import itself, on its screen (their password asked first), not when the Hidden items are opened next.
- **Fixed:** "ENAMETOOLONG" writing hidden files: a write's temporary file was named after the file, and a long encrypted name with `.tmp-…` went past 255 bytes. It has a short name of its own now.
- **Fixed:** an update from an incremental backup set aside the canvases it lists as unchanged, and could delete items it does not list; it keeps them.
- **Fixed:** importing hidden items into hidden folders made a second hidden folder of the same name at each import.
- **Fixed:** an incremental backup with no canvas changed (only names, notes or files of the library) was refused as "containing no canvases"; it imports, and updates.

## 0.54.61 — A backup updates a workspace: work elsewhere, come back (2026-11-08)

- **Added:** importing a workspace backup asks how: **Update this workspace** (as the backup is: boards and canvases matched by id and replaced, item details, saved styles and the workspace's settings from the backup; a canvas changed here since the last backup kept beside as a conflict copy; a canvas the backup does not have set aside on a board "Not in the backup", an item it does not have deleted) or **Add as new boards** (as before). Update comes first when the backup holds this workspace's canvases or the workspace is empty, so a backup taken elsewhere and brought back updates home, in the browser and the desktop app alike.
- **Added:** a backup lists every library folder, empty ones too, a hidden one marked hidden (before, a folder went only with an item in it, and a hidden folder came back shown).
- **Changed:** tests take a backup away and back, in the browser and in the desktop app.

## 0.54.60 — Hidden items' details come back from a new backup (2026-11-08)

- **Fixed:** a backup made with 0.54.57 or later, with hidden items, said "N hidden items came without their key file and were skipped", in the browser and in the desktop app: the import read a key file of up to 4 KiB, and since it carries the hidden items' sealed index (their dates, tags and notes), it is as big as they are. It is read up to 256 MiB.
- **Changed:** tests take hidden items through backups in all four ways: browser to browser, desktop to browser, browser to desktop, desktop to desktop, each with a note past the old 4 KiB and the date they came.

## 0.54.59 — The frameless window moves by its row, on Wayland too (2026-11-08)

- **Changed:** with Window frame off, the row's title is a drag area, as an app's own title bar: the desktop moves the window, on X11 and on Wayland, with nothing to set up. The row is the page's own element while no dialog is open (in the top layer, a drag area once took the mouse from the whole app); in a dialog it has none. The title drag of 0.54.57, made by the app, is gone.

## 0.54.58 — The desktop app starts again on Wayland (2026-11-08)

- **Fixed:** with Window frame off, the desktop app did not start on a Wayland desktop (a fatal error): 0.54.57 ran it through XWayland so its row could move the window. It stays native now; the row's title moves the window on X11, and on Wayland the desktop's own way does (Meta and drag on KDE).

## 0.54.57 — The frameless window moves by its row (2026-11-08)

- **Added:** with Window frame off, dragging the row's title moves the window, and a double-click maximises or restores it. The app moves the window as the pointer goes (no drag area, which took the mouse from the app on KDE Wayland). On a Wayland desktop it then runs through XWayland, as only there can an app move its own window; with the System frame it stays native Wayland.
- **Added:** a backup keeps its hidden items' date added, tags, note, properties and favourite (their index, sealed with their key), and an import brings them back, in the desktop app and in the browser. Before, a hidden item came back with only its file, name and folders, dated at the import. Export a backup again to have them.
- **Fixed:** Firefox could not open a desktop backup's hidden items ("the operation failed"): its PBKDF2 refused what scrypt asks of it; the one round scrypt needs is now made from HMAC, the same result everywhere.
- **Fixed:** opening a desktop backup's hidden items in the browser was slow: each file was hidden in a write of its own; now 25 at a time, and the screen says how far it is.

## 0.54.56 — Window buttons; a hidden items' check that says why (2026-11-08)

- **Changed:** the window row's minimize and maximize buttons use the common icons: a line and a square.
- **Fixed:** importing a desktop backup in the browser said "not their password" also when their password could not be checked at all; it now says why.

## 0.54.55 — The browser opens a desktop backup's hidden items (2026-11-08)

- **Added:** importing a desktop backup in the browser asks the Hidden password of its hidden items, then brings them in as hidden items, in hidden folders of their names. Before, they were always left out. The password is stretched as the desktop app does (scrypt), in the page: a few seconds and about 128 MB of memory. If the browser has no Hidden password yet, it offers to use the same one.
- **Changed:** in the browser, hidden items are kept as the browser keeps its own: not encrypted. The import says so.

## 0.54.54 — Copies stored on desktop (2026-11-08)

- **Fixed:** a copy found in `library/` was not stored on desktop: the app's main process refused its key, so 0.54.53 listed no copies there.

## 0.54.53 — Copies are items of their own (2026-11-08)

- **Added:** on desktop, a copy of a file the library has, put in `library/` from outside (another folder, any name), is an item of its own: its own card, name, folder, tags and notes, never removed for being a copy. Before, it was left on disk with no item. Its details list the other items with the same file, and `is:copy` finds them.
- **Changed:** placing a copy on a canvas places its content, as the first item of it; a backup keeps each content once, with the first item's details.

## 0.54.52 — Missing, copies and namesakes, saved searches in the sidebar (2026-11-08)

- **Added:** **Missing** in the library's sidebar: the items whose file is gone, with their count, as `is:missing`; shown while there are some.
- **Added:** search keywords `is:copy` (its file's content is also elsewhere in the library, under any name) and `is:samename` (another item has its name, whatever its content).
- **Added:** saved searches in the sidebar show how many items each finds, open with an icon of their layout, and have a ⋯: Rename (a name of their own), Update, Move up, Move down, Delete.
- **Changed:** the sidebar keeps saved searches in your order: a new one goes last and using one does not move it (the search box still lists them newest first).

## 0.54.51 — No made-up file endings (2026-11-08)

- **Fixed:** with Keep file names off, a file whose ending the app does not know (a program's backup `art.kra~`, `x.sketchbook`) was renamed with an ending made up from its type, such as `art.kra.octetstr`, one more file at every save in Krita. A tidied name now keeps the file's own ending as it is on disk; a file with none gets none.

## 0.54.50 — Folders deleted outside, at last (2026-11-07)

- **Fixed:** a library folder deleted outside the app came back, every time: the check for it asked whether the folder was there as a file, so it always concluded the library itself was not there, and did nothing. It now asks for a folder.
- **Fixed:** a new device opening a workspace folder could write its own default settings over the workspace's: the folder's settings are now always read first at start-up.

## 0.54.49 — Workspace settings keep the newest (2026-11-06)

- **Fixed:** a workspace setting changed just before the app closed or reloaded could be replaced by the older copy kept in the workspace; changes now carry their time, and only newer settings replace this device's.
- **Fixed:** on desktop, two settings changed in quick succession could undo the second, and a style saved just then could be lost: nothing is read back from the folder while this device still has to write it.

## 0.54.48 — Where settings are kept, in the manual (2026-11-06)

- **Changed:** the README says which settings are kept on the device (in the app's data folder) and their limits in the workspace.

## 0.54.47 — Settings of the workspace (2026-11-06)

- **Added:** settings that shape the workspace's files are kept in the workspace (`.canvast/workspace.json` on desktop) and shared by every device that opens it: how notes are written, named and shown on cards; file names and placement of saved edits, frames, screenshots, exports, patterns and SVGs; where deleted files go; property types; saved searches; pinned folders. The rest stays on the device. A workspace without them takes the opening device's, so nothing changes.
- **Changed:** saved searches made with the Hidden items open are kept in a list of their own, on the device only, and out of a backup unless privacy settings are included.
- **Fixed:** a library folder deleted outside the app came back: every save of the library forgot which folders it had seen on disk, so a deletion was never noticed, while running or after a restart.
- **Fixed:** styles changed on another device were read only when boards or canvases changed too.
- **Fixed:** Ctrl+S on the first page of a PDF (and Place from it) failed: a card on its first page now stores no page, as a new card.

## 0.54.46 — Place takes the page or view in sight (2026-11-06)

- **Changed:** Place in the details, while a PDF or a 3D model is open in the viewer, puts the page or view in sight on the card, not the first.
- **Fixed:** a note's thumbnail was drawn again every time the library opened, which took many seconds for many notes; it is now kept, and drawn again only when the note, its labels or the Preview look change.
- **Fixed:** a library folder deleted outside the app at the moment the app wrote in the library was still missed; which library folders are there is now looked at on every change in it.

## 0.54.45 — A PDF's words can be selected (2026-11-06)

- **Fixed:** a PDF's words can be selected and copied: the app's rule that its own words are not selectable reached them too.
- **Fixed:** a row's ⋯ in a menu opens its own small menu beside the list, which stays open, instead of replacing it.
- **Fixed:** what Find marks in a PDF, and a selection there, is see-through, so the words show under it; it hid them.

## 0.54.44 — Bookmarks can be renamed; Ctrl+S on a card (2026-11-06)

- **Added:** a bookmark of a PDF or a 3D view has a ⋯ to rename or delete it, in the view's list and in the details.
- **Added:** Ctrl+S in the panel on a canvas shows the page or view in it on that card.
- **Fixed:** a library folder deleted just after a save was missed: every save made all the library's folders again, and a deletion right after counted as the app's own change. Folders are now made only once.
- **Fixed:** a PDF's keys (Page Up and Down, Home, End, Ctrl+F) work in the panel on a canvas too, and the view has the focus when it opens there.

## 0.54.43 — Move one closed path, or split them (2026-11-06)

- **Added:** in Edit nodes, a double-click on a node or a line selects that whole closed path with its holes, to move as one. On a hole, only the hole.
- **Added:** Split into pieces in the path menu: each outline of a path, with its holes, its own object in the same place and look. One step of undo.

## 0.54.42 — The lag monitor is gone (2026-11-06)

- **Removed:** the temporary lag monitor. A log it wrote stays in `lag-monitor/` beside the app's settings until it is deleted.

## 0.54.41 — Placed lines are the lines shown (2026-11-06)

- **Added:** Reach in a 3D view's Lines: how far it looks for a change, apart from how wide lines are drawn, so thin lines keep their inner detail.
- **Fixed:** a library folder deleted outside the app leaves the library at once while the app runs (it waited for the next save).
- **Fixed:** thumbnails made in the background wait for the library to be open and the page to be quiet, one at a time, and notes' are made only when shown. They took a quarter of a processor for a minute after opening a large library, even on a canvas.
- **Fixed:** Place the lines now follows the very lines the view shows, not the model's edges, which showed lines behind the surface and differed from the view.
- **Changed:** a PDF or a 3D model opened from a card on a canvas starts at what that card shows. In the library it opens where it was left.

## 0.54.40 — Line art of 3D models (2026-11-06)

- **Added:** a temporary lag monitor in the desktop app: a small log, outside the workspace, of each process's use of the processor and memory and of what the app did; no file names, nothing sent.
- **Fixed:** a note no longer warns "Changed in another app" when the app itself rewrote its links.
- **Fixed:** line art's shader compiles, so Lines shows. Zooming a PDF keeps the page in view at its size, when its pages differ.
- **Added:** Lines in a 3D view: line art of the outer outline and inner forms, over the model or alone, with width, colour, outline and inner detail, also on cards.
- **Added:** Place the lines: the line art this view shows, followed along its middles, on the canvas as editable paths, worked out in the background, which copy and export as vectors.

## 0.54.39 — Deleted folders stay deleted, large 3D models open (2026-11-06)

- **Fixed:** a PDF zoomed wider than its view could not be scrolled to its left edge.
- **Fixed:** a library folder deleted outside the app came back at every save and start. It now leaves the library; its items stay, shown as missing if their files went with it.
- **Fixed:** a large 3D model opens and has a picture: up to 1 GB to open and 512 MB for a picture (they were 256 and 64 MB), and a file too large is no longer read into memory just to find that out.
- **Fixed:** STL, PLY and OBJ files are read in a worker, so the page keeps working. Shadows are drawn only when the lights, the pose or the surface change, not at each frame of a drag; a model of over 2 million triangles draws one pixel to a pixel; light targets and animation data are let go.

## 0.54.38 — File views follow the theme (2026-11-06)

- **Fixed:** a 3D view's settings have the same spacing as the Pattern panel, from the Density setting, and the bars of PDF and 3D views have controls of the usual size, in one shared button.
- **Fixed:** the folders of several selected items are rows with their counts, the long list folded, not one long paragraph.
- **Added:** Ctrl+wheel zooms a PDF about the pointer, in the viewer and in the panel on a canvas.
- **Changed:** those bars' icons say what they do, each its own: pages, fit, bookmarks, contents, placing, the card, the first view, the settings.

## 0.54.37 — PDF pictures no longer lost at random (2026-11-06)

- **Fixed:** a PDF's picture could fail and leave its plain card, and closing one PDF could stop another that was open, because they shared one worker. Each open PDF now has its own, gone when it closes, and a thumbnail that could not be drawn is not kept.
- **Fixed:** a middle-button pan is recognised from its press too, so a paste the system sends with it never lands, however late.

## 0.54.36 — PDF and 3D tools, less work when idle (2026-11-05)

- **Added:** in a PDF, Ctrl+F finds in it, links inside it are followed, a password is asked for, and **Place pages** puts a card for each page on the canvas; the library's search finds a PDF's words.
- **Added:** for 3D study, **Tones** shows light in 2 to 5 flat steps of value, **Mirror** flips the picture, a pose can be chosen from a file's animations, and **Place a turnaround** puts eight cards from all around on the canvas.
- **Fixed:** a card's chosen page or view was lost by its copies (Alt+drag, Duplicate, paste) and when the canvas was opened again, and such a copy kept the view drawing without end, using the processor while nothing was happening. Any picture asked for smaller than it is now ends that wait.
- **Fixed:** a PDF imported earlier takes its first page's shape in the library and on its cards.
- **Fixed:** the view no longer works when nothing is happening: background thumbnails skip PDFs and 3D models until their cards show, pictures of them are drawn one at a time from a file kept open a moment, a 3D drag no longer makes its lights and canvas again each frame, a PDF redraws only when its size settles, and PDFs are read for the search when the page is quiet.
- **Changed:** settings rows, a double-click to reset one, a group's Reset and draggable numbers are one shared piece for the Pattern panel and the 3D view; the Adjust panel has the same group header. A 3D view, a texture fill and a font's axes gain resets; a PDF's page and a 3D view's numbers can be dragged.

## 0.54.35 — PDFs and 3D models open in views of their own (2026-11-05)

- **Added:** PDFs show their first page in the library and the details, and their card on a canvas takes the page's shape. They open in a reader, in the viewer and in the panel on a canvas: pages, zoom, selectable words, the page it was left at, bookmarks (also in the details) and the PDF's own contents.
- **Added:** 3D models (GLB, glTF, STL, OBJ, PLY) show a picture in the library and open in a view: turn, slide and zoom; camera lens and focal length; surface (own, clay, one colour, wireframe); shadows; background or none; three lights, each sun, point, spot or off with its colour, strength and direction; classic lighting setups; the view it was left at; bookmarks.
- **Added:** a card on a canvas can show another page or view, that copy only, with **Show this on the card** in the panel. One step of undo, nothing new stored.
- **Changed:** notes, PDFs and 3D models open through one table of file views, and a card's picture through one table of kinds, so a new kind of file plugs in as a row of each. The viewer's other kinds (fonts, art files, video, GIF, pictures) are a table too. The Note panel is now the File panel, and *Note editor on a canvas* is *Files on a canvas*.
- **Changed:** the page's security rules allow WebAssembly to compile, for the decoders of scanned PDFs inside the file. The file grew from about 3.8 MB to about 6.8 MB.
- **Removed:** the old drawing of STL and OBJ cards and the PDF page count on a card.

## 0.54.34 — Two signs make bold again in Firefox (2026-11-05)

- **Fixed:** in Firefox, a second `*` typed over selected words of a note made them plain instead of bold, since 0.54.32. The words of a selection are now read from the note, not from what is laid out, also when checking that a whole note is selected.

## 0.54.33 — Arrows go to the next note again (2026-11-05)

- **Fixed:** in the library's viewer, with the cursor out of a note's words, the arrow keys and the viewer's other keys work again; a note took them all since 0.53.3. With a picture or other item in the note selected, its keys are still the note's.
- **Fixed:** a note on full screen covers the panel beside it: the date icons of its properties showed through.

## 0.54.32 — Long notes open faster (2026-11-05)

- **Fixed:** a note's blocks off the page are laid out when they come near, so a long note does not wait for all of it on opening.
- **Fixed:** the code colours' lists grew by copying at each word, which was slow in a note with much code.

## 0.54.31 — Density reaches everything on an edge (2026-11-05)

- **Fixed:** Dense, Compact and Comfortable now reach the viewer's top bar and the room under it, the bars and panels placed against an edge, the canvas's small controls and the layer rows' buttons, which kept fixed sizes.

## 0.54.30 — Colours in notes' code (2026-11-05)

- **Added:** code blocks with a language are coloured, in all 21 languages the code block offers. It is painted over the words, so the note, the cursor, undo and what is saved do not change. **Colour code in notes** in Settings > Notes turns it off.
- **Fixed:** inline code in a note follows the theme: it was one fixed grey.

## 0.54.29 — Code comes off again (2026-11-05)

- **Fixed:** in a note, **Code** and the signs for formats did not take a format off when a whole line was selected; they go by all the words selected.

## 0.54.28 — A shorter setting (2026-11-05)

- **Changed:** **Signs wrap selected words** says what it does on one line, with the signs under its More.

## 0.54.27 — Format the word under the cursor (2026-11-05)

- **Added:** in a note, `Ctrl+B`, `Ctrl+I`, `Ctrl+U` and **Code** with the cursor inside a word and nothing selected format the whole word, and inside text already in that format remove it from all of it; the cursor stays where it was. At the edge of a word they do what they did.
- **Fixed:** on Linux, panning with the middle button could paste what was on the clipboard, when the system's paste of that click came late on a busy machine.

## 0.54.26 — Code in the notes bar, signs round selected words (2026-11-05)

- **Added:** the notes editor's floating bar has **Code**, the editor's own Code text style with one press.
- **Added:** a sign typed over selected words in a note goes round them instead of replacing them, and they stay selected: `"` `'` `(` `[` `{` `<` `=` `%` and curly quotes. In a note with formats, `` ` `` is code, `*` and `_` are italic (twice: bold), `~` is strikethrough; in a plain text note they are signs too. **Signs wrap selected words** in Settings > Notes turns it off.

## 0.54.25 — Copied hidden items leave the clipboard (2026-11-05)

- **Added:** a copied hidden item leaves the clipboard after a time you set: Settings > Privacy, **Clear copied hidden items after**, 30 seconds at first, 0 to keep it. Its readable copy is deleted then too. Locking the hidden items or closing the app clears it at once, and something copied since is left alone. In a browser it clears only while the page has the focus.

## 0.54.24 — A file for each copied shape (2026-11-05)

- **Changed:** in the desktop app, several shapes copied go as a file for each, and a group as one file, named by the shape or numbered, not merged into one `selection.svg`. Past 500 they go as one file, and it says so.

## 0.54.23 — One question before a hidden item is copied (2026-11-05)

- **Changed:** a question about copying a hidden item that is still on its way out answers a copy pressed in that moment, rather than a second one opening over it.

## 0.54.22 — Copied files on every system (2026-11-05)

- **Fixed:** in the desktop app, Copy and Copy file wrote real files under Linux's name for them, so on Windows and macOS they would not have pasted as files. They now use Electron's own name, which it maps to each system's; this is checked in unit tests, and not yet on Windows or macOS themselves.

## 0.54.21 — Copy fixes: stretched shapes, Copy as picture of a padlock (2026-11-05)

- **Fixed:** shapes copied with other things went into their SVG file stretched to the proportions of everything selected.
- **Fixed:** **Copy as picture** of a locked hidden item failed; it copies as a padlock, as any copy of it does. In reach, it asks first, as any copy of a hidden item does.
- **Fixed:** among several things copied on the canvas, a cropped, flipped or adjusted picture was left out; it goes as a new file as it looks now, named `…-edited.png`. A video's or a GIF's edits are still left out.
- **Fixed:** in the desktop app a copy no longer fails if you leave the window before it is ready, and a padlock no longer waits about three seconds for a picture that will not come.

## 0.54.20 — The desktop app type-checks again (2026-11-05)

- **Fixed:** a type error in the desktop app's clipboard code, which stopped the CI check; nothing changes for use.

## 0.54.19 — Copy of several files, and hidden items on the canvas (2026-11-05)

- **Fixed:** in the desktop app, Ctrl+C of several files gives them all, as **Copy file** does: no picture of the first beside them, which a program could take in their place. One press copies once.
- **Fixed:** a hidden video on the canvas could paste as a line of text. A copy no longer starts from that line in the desktop app, a picture that cannot be made is drawn instead, and a copy that fails says so; one that takes a moment says when it is ready.
- **Fixed:** outside hidden mode, a hidden picture on the canvas copies as a padlock, and says so: its picture could reach the clipboard.

## 0.54.18 — Ctrl+C copies real files in the desktop app (2026-11-05)

- **Changed:** in the desktop app, Copy puts the real files on the clipboard, of any kind and any number, from the library and the canvas, beside what it already gives (a PNG, an SVG, a note's words); a program takes what it can use. A picture cropped, flipped or adjusted goes as its PNG only, as its file does not show that; shapes among other things go as one SVG file too.
- **Fixed:** a paste on the canvas after copying several things there brings the objects back, with nothing imported; after a Copy in the library it no longer brings back an earlier canvas copy.

## 0.54.17 — Copied vectors are a real file too (2026-11-05)

- **Fixed:** in the desktop app, copied vectors go on the clipboard as a real `.svg` file as well as SVG and PNG, so a program takes whichever it can use. A hidden item's readable copy is deleted when the hidden items are locked, as with **Copy file**.

## 0.54.16 — Ctrl+C keeps vectors (2026-11-05)

- **Fixed:** Copy of vector shapes on the canvas, of an SVG picture placed as it was imported, and of an SVG in the library puts the SVG on the clipboard beside its PNG, so a program that can keep vectors gets them; it had gone out as an image alone since 0.45.2. A browser that cannot put an SVG there gives the PNG.
- **Changed:** Paste in the library keeps an SVG as vectors, and a hidden SVG asks first as any hidden item does.

## 0.54.15 — A setting changed right after Generate stays (2026-11-05)

- **Fixed:** in the Pattern panel, a setting changed within half a second of Generate could go back to its last value.

## 0.54.14 — 26 more guides, and easier settings (2026-11-05)

- **Added:** 26 guides: Silver Ratio, Paper Sizes, Aspect Ratio Frames; Golden Triangles, Rule of Odds, Leading Lines, Visual Weight Quadrants; Manuscript Grid, Hierarchical Grid, Bento Grid, Device Frames; Cabinet and Cavalier, Curvilinear Perspective, Ground Plane, Cube Lattice; Rhombus Grid, Islamic Star Grid, Penrose Tiling, Voronoi Guide, Concentric Polygons, Spirograph Construction; Isometric Pixel Grid, Tile and Sprite Sheet, Storyboard Frames, Value Scale, Color Wheel.
- **Changed:** every guide can have one margin or one across and another down. Grid and Pixel Grid can count strong lines apart across and down.
- **Changed:** Golden Ratio has **From**; Golden Spiral has **First square**, **Turn** and **Rotate** in place of flips; Root Rectangles has **Direction** and **Align**; Rule of Thirds and Diagonal Grid have parts across and down, and Diagonal Grid a **Direction**.
- **Changed:** Column and Modular Grid, Isometric, Dimetric, Triangle and Hex Grid can be set by count or by an exact size; Modular Grid can have a gutter down of its own; the lattices can shift; Hex Grid has **Gap**.
- **Changed:** Perspective's points can leave the horizon; Polar Grid and Radial Symmetry can fit inside or go past the edges; Polar Grid has **Spoke start**; Comic Panels has a layout of your own and gutters across and down; Fisheye Grid has a centre and a strength down of their own.

## 0.54.13 — A typed pattern setting stays (2026-11-05)

- **Fixed:** in the Pattern panel, a setting not yet made could go back to its last value; only undo and redo now bring stored settings back.

## 0.54.12 — Wider limits on guides (2026-11-05)

- **Changed:** the guides' settings go far further when typed or dragged: parts, spokes, axes, lines, steps, angles, a centre or vanishing point well outside the sheet, dash length and strong width. Fisheye Grid's **Strength** goes from -1000 to 1000, and below zero it pinches instead of bulging.

## 0.54.11 — Fewer guides (2026-11-05)

- **Removed:** the **Figure Proportion** and **Face Proportion** guides.

## 0.54.10 — Guides (2026-11-05)

- **Added:** the Pattern panel has two tabs, **Patterns** and **Guides**. Each keeps its last choice, and the panel remembers the tab.
- **Added:** 30 new guides: Golden Ratio, Golden Spiral, Fibonacci Grid, Root Rectangles, Modular Scale; Rule of Thirds, Dynamic Symmetry, Harmonic Armature, Rabatment, Diagonal Grid, Center and Safe Marks; Column Grid, Modular Grid, Baseline Grid, Van de Graaf Canon, Bleed and Crop Marks; Isometric Grid, Dimetric Grid, Triangle Grid, Perspective, Fisheye Grid; Hex Grid, Polar Grid, Radial Symmetry, Logo Construction Circles, Sacred Circles; Pixel Grid, Comic Panels, Figure Proportion, Face Proportion.
- **Changed:** **Grid** moves to Guides. A new guide has no background, with the setting still there, on a sheet with no fill; Randomize changes its look and keeps what it is.

## 0.54.9 — The Grid pattern is predictable (2026-11-05)

- **Changed:** in the **Grid** pattern, changing **Across** or the cells leaves **Line width** and **Dash length** as they are.
- **Changed:** square cells are as near square as whole rows allow, so the last line is on the edge.
- **Changed:** lines and a frame on the sheet's edge sit just inside it, as thick as the others.
- **Changed:** **Rows** shows only for its own choice of **Cells**, and **Across** and **Cell size** likewise.
- **Changed:** **Randomize** keeps the grid's layout: cells, counts, margin, shifts, dashes, angle, frame, looseness and strong start.
- **Added:** **Cells: Size**, an exact **Cell size**.
- **Added:** a line saying what the settings come to, such as `16 across, 11 down · cell 56 × 55`.
- **Added:** **Strong start**: which line the strong lines count from.

## 0.54.8 — Reset one pattern setting (2026-11-05)

- **Added:** in the Pattern panel, double-clicking a setting's name, or its slider, resets that setting alone.

## 0.54.7 — Undo and redo in the Pattern panel (2026-11-05)

- **Changed:** in the Pattern panel, a change after a pause is its own undo step, instead of the whole session being one; a slider's drag stays one step.
- **Fixed:** after undo or redo the panel shows that version's settings, and changing them still works.
- **Fixed:** `Ctrl+Z` and `Ctrl+Y` with a slider or number field of the panel focused undo the pattern.

## 0.54.6 — A pattern no longer vanishes at high counts (2026-11-05)

- **Fixed:** a pattern with more pieces than one path can hold no longer vanishes: it goes into several paths of the same look, in every generator. Short dashes in the **Grid** pattern were the way to see it.
- **Changed:** the Grid pattern's **Dashes** is now **Dash length**: a share of a cell, never too short to see, with a gap as long.

## 0.54.5 — More for the Grid pattern (2026-11-05)

- **Added:** the **Grid** pattern's **Strong width**, and a **Layout** section: **Margin**, **Frame**, **Shift across**, **Shift down**, **Dashes** and **Angle**. All leave the default grid as it was, and Randomize leaves margin, shifts, dashes and angle off.

## 0.54.4 — The Grid pattern is simple again, with rows (2026-11-05)

- **Removed:** the Grid pattern's lattice, strong width, angle, shift, dashes, margin and frame, which never reached a release.
- **Added:** the **Grid** pattern's **Cells**: Square (as before, the default), Equal (as many rows as columns) or By rows (the **Rows** setting).

## 0.54.3 — Moving snaps on both axes (2026-11-05)

- **Fixed:** an object moved onto a level or upright line, a side of a shape or a pattern's, now snaps on the other axis too: one edge landing no longer stopped the other from snapping. For one object, a group and several selected.
- **Fixed:** lines on both axes that are nearer than a corner now hold instead of that corner.
- **Changed:** snapping looks at up to 20,000 things in view, not 2,000, and a square's sides no longer count twice, so a picture built of many squares keeps snapping.
- **Fixed:** tests: starting with grid snapping off no longer disturbs settings kept over a reload.

## 0.54.2 — Snap to the grid and to groups, grid settings; long notes open faster (2026-11-05)

- **Added:** a corner snaps onto the crossing of a pattern's lines, not to one line at a time.
- **Added:** the canvas's own grid: Settings > Appearance: **Grid size**, **Stronger line every** and **Grid strength**.
- **Added:** moving, resizing and dragging a node snap to the grid's lines (**Snap to the grid**, on by default; off with no pattern), and to a group's box and middle as a whole. A lone object snaps too. **Snap distance** sets how near it catches.
- **Changed:** the Pattern panel's limits are far wider in all 38 patterns: counts up to ten times, grids four times, sizes and line widths five times, shares from end to end. Randomize keeps to the usual span, and one result holds up to 5,000 shapes.
- **Fixed:** a group or several selected move from anywhere in their box: a press in a gap between their parts no longer starts a selection box.
- **Fixed:** **Add a property** pressed right after selecting an item could do nothing.
- **Fixed:** long notes open and save faster: writing a note out took far longer than its length.
- **Fixed:** a note opened before a picture it links to has arrived (from a sync tool) shows it when it does, with nothing to reopen.
- **Fixed:** the details panel looks up a note's links once per change, not once per drawing.

## 0.54.1 — A Size menu, links both ways in notes, text files as notes, a better font preview (2026-11-05)

- **Changed:** with Window frame off, the window's name and buttons are a row that floats over the app, from the very top edge when the pointer reaches it. It takes no room, it comes also when the pointer leaves over the top of the window, and clicks at the top of a window no longer go astray.
- **Fixed:** with Window frame off, the row is there from the first moment and stays in front of the opening, lock and busy screens, with the workspace's name and the window's buttons. Before, it came only after unlocking, and no dialog let it through.
- **Fixed:** with Window frame off, the row no longer stays after one of its buttons was clicked: it went only once the focus moved elsewhere.
- **Fixed:** with Window frame off, the app no longer stops taking clicks while the row shows, and the row no longer stays: its drag area took the mouse, so on the lock screen nothing could be clicked. **Removed:** moving the window by dragging the row; use the desktop's own way or the System frame.
- **Fixed:** one arrow across the app for what opens or folds: every select box, the note toolbar's Text, Paragraph, Insert, File and View menus, and what folds in Settings use the same chevron as the buttons.
- **Fixed:** one checkbox and one radio across the app, in the theme, with the same size in each place and following Density. Before, they were the browser's, in three sizes, and most ignored Density.
- **Fixed:** a panel's resize handle no longer covers a scrollbar: in the viewer and the notes editor beside the details, and on panels docked on the left of the canvas.
- **Fixed:** in the notes editor, the room above and below the Back and Details buttons is the same in every density.
- **Fixed:** the highlight in a select box's list no longer gets a focus ring.
- **Added:** text files open in the notes editor as plain text: `.json`, `.csv`, `.tsv`, `.xml`, `.yaml`, `.toml`, `.ini`, `.log`, `.tex` and code files, up to 5 MiB and in UTF-8. Spaces, tabs and line ends are kept, also in `.txt`; the app never adds to or rewrites them by itself.
- **Added:** the viewer's zoom control works on a note too, with the same keys (+, -, 0 outside the words; Ctrl with them while typing, Ctrl and the wheel): its text is drawn bigger, its pictures keep their size and the file does not change.
- **Fixed:** nothing is yellow against the theme any more: the notes editor's buttons on pictures and tables, what is dragged over a note, and the focus ring on the lock screen and in dialogs use the accent. The editor's table, success and error colours follow the theme too.
- **Added:** a note's details have a **Links** card, with what it links to (notes, pictures, any file, each with its folder), links that find nothing greyed; **Linked from** is always there on a note, and both show a count. They follow the saved file.
- **Added:** **Go to link** on the card of a link in a note; the link's text on it goes there too.
- **Fixed:** a linked item opens from another folder or from a part of a long library not read yet, and says so when it is gone. Linked from no longer goes away on moving between notes.
- **Fixed:** in the notes editor, the strip with the Back and Details buttons has the note's own colour.
- **Fixed:** a picture or other component dragged to another place in a note is one step of Undo and Redo.
- **Fixed:** in the library's list, the rows hold every column however wide they were made, with no column cut and no empty room after the rows The file type chip no longer covers a row's last column. Each column header shows its resize handle.
- **Fixed:** Ctrl+F in an open note always finds in that note, in the library's viewer and beside a canvas, wherever the focus is; before, with the focus off its words, it went to the library's search.
- **Fixed:** a font's "Aa" sits in the middle of its library card: its picture hung past the card's bottom and was cut. It is also centred on its letters, whatever the font's own spacing; fonts' thumbnails are made again once.
- **Added:** `kind:typeface` finds fonts, as `kind:font` does.
- **Fixed:** files imported into the library, dropped from a file manager or by Import or paste, go into the folder, tag or favourites open in the sidebar. A file the library already had stays where it is.
- **Added:** a font in the viewer has the background button of see-through pictures, kept the same way, and a button that changes its sample sentence, kept too, in the details as well. It has more room around it. A font's preview in the details and its card on a canvas show that same sentence, background and letter colour.
- **Added:** a box under a font's samples in the viewer to type in and see it in that font; what is typed stays.
- **Added:** a fifth background for see-through pictures and fonts, the theme's own colour, which follows a change of theme. The background button shows the one in use, and the viewer's floating buttons stay visible under the pointer on any background.
- **Fixed:** Reset size works at any zoom: past a certain zoom it offered nothing for what was placed before. Several reset together keep their layout: they move apart only as far as it takes to keep the gaps they had.
- **Added:** a **Size** menu on the Actions bar, with Reset size and the width or height of the smallest, medium or largest of the selected, pictures, notes, shapes, strokes and text alike. Their layout is kept.
- **Changed:** Reset size, in that menu, is there for any picture or note; when it would change nothing it is greyed out and says why.
- **Changed:** the README is in two parts, for users and for developers, with a section for each big feature, tables and pictures first and the full wording after them; new pictures of the sidebar, several items selected, art files and the Trash.
- **Changed:** the library's list has the same thumbnail slider as the grid, in the same place, with its own size: its rows and thumbnails grow with it. The slider is longer, and the list's columns button moved to the left of the grid and list buttons so that nothing shifts.
- **Added:** Details in the details panel show the file's type, size, pixels, time of import, place on disk and whole hash, a JPEG's channels and colour sampling, all lined up. They open from the file's line, with an info icon at its right end, in one card.
- **Added:** the lock screen of the desktop app has **Open another folder…** and **New workspace…**; the locked workspace stays locked.
- **Added:** a greyscale button in the viewer, beside the background button: it changes only how the picture is seen, and goes with the next item or on closing.
- **Added:** long lists in the details panel show their first rows and **Show more** / **Show fewer**: tags, properties and notes linking to an item. Every such button in the app is now one component.
- **Changed:** the view buttons have a look of their own: Library and Canvas are joined as one set, Settings matches them, and the one in use is filled.
- **Changed:** one scrollbar across the app, in the accent: out of sight until the pointer is over its area or it scrolls, thin, and it grows when the pointer is on it. Its room is kept, so nothing moves.
- **Changed:** spacing across the app is on one grid, and Dense, Compact and Comfortable now set every gap, padding, margin, field, list row, small button, tree indent and icon, not only the bars' sizes.
- **Fixed:** a drag of a library item could leave the app stuck (it scrolled, but took no click or key): the card dragged now stays in the page while the grid scrolls, and the drop places go away whichever way a drag ends. A drag out of the app is always a copy, so a file manager cannot move a file out of the library.
- **Fixed:** dragging an item to place it on the canvas: the strip covers the whole top row, and a drop anywhere on the row counts. It sat half over the row, under its buttons.
- **Fixed:** the viewer's back, details, hide and background buttons, its bars, filmstrip and zoom control follow the theme; they stayed dark in the light theme.
- **Changed:** *Where it is used* reads more easily: the canvas's name in full, its board quieter, a count, and an icon to go there.
- **Changed:** buttons are rounded squares everywhere, following density and the Corners setting; round is kept for chips and dots.
- **Fixed:** the viewer's filmstrip was empty after moving to another item with the controls hidden and bringing them back.
- **Fixed:** a tag's ⋯ in a row of tags is the same plain dots as on a folder's row, with no white circle.
- **Fixed:** the Library button is one button, as tall as the ∞ beside it, with no white bar around it.
- **Fixed:** on a small window the ∞ button stretched across the top row and the Settings button covered the canvas's name; the name takes the room now, clear of the buttons. 
- **Fixed:** the status bars of the canvas and the library have one height with room around their buttons, which are square.
- **Fixed:** the action buttons in the details panel were cut off (`Rename …`, `Export 4 …`); they now take the panel's whole width, one to a row.

## 0.54.0 — Drag items out of the app; a window with no frame (2026-11-05)

- **Added:** drag library items out of the desktop app onto a file manager or another program; hold `Alt` to start a real file drag if a program refuses the plain one. Hidden items stay in: use Copy file.
- **Added:** Settings > Appearance > Window frame: System, or Off with no title bar, its buttons at the top right. It applies at the next start.
- **Added:** a `File managers` workflow that pastes a Copy file in five Linux file managers on a virtual screen.

## 0.53.66 — No menu bar in the desktop app (2026-11-05)

- **Removed:** the File, Edit and View bar of the desktop app's window. Its keys still work (`Ctrl+Shift+O` opens a workspace folder), and the workspace switcher has its commands.

## 0.53.65 — Sections scroll as they are dragged; the README brought up to date (2026-11-05)

- **Changed:** the README says the desktop app is built for Linux and other systems are out of scope for now, gives the browsers the app really needs, and its pictures are taken again, with a new one of Organize.
- **Changed:** in the light theme, the logo on the lock screen, the start-up screen and About takes the accent colour.
- **Fixed:** dragging a section of the library's sidebar or details panel could not reach the far end of a long list: the list now scrolls when the pointer nears its top or bottom, or passes it. The section under the pointer also keeps its counts and headings readable.
- **Fixed:** the words and the button in the library's "Showing…" pill and the Hidden mode bar were two text sizes and did not line up. They are one size now; the button is bold with an outline.

## 0.53.64 — Notices keep their contrast (2026-11-04)

- **Fixed:** the tick and warning icons on notices were too pale in the light theme; they now have a colour for each theme.

## 0.53.63 — A library write that fails is tried again (2026-11-04)

- **Fixed:** when writing the library's files failed, nothing tried again until the next change, so an item hidden while locked could keep its readable file. It now retries by itself, less often each time.

## 0.53.62 — Contrast in both themes (2026-11-04)

- **Fixed:** the pin and ⋯ could hardly be seen on a selected folder or tag row.
- **Fixed:** low contrast of the favourite star and of accent text in the light theme, of the count on a selected row, and of danger text on a hovered row in the dark theme.
- **Changed:** text that was quietened with opacity uses the muted colour, field edges are stronger, and the Shape builder's overlays follow the theme colour.
- **Changed:** the colour picker's defaults, hover colours and scroll cues are `oklch()`, and the desktop window opens in the light or dark background that the system uses.

## 0.53.61 — No row pin on small screens (2026-11-04)

- **Changed:** on small and touch screens a folder's row has no pin button; pinning is in its ⋯ menu.

## 0.53.60 — A pin button on each folder (2026-11-04)

- **Added:** a pin button on a folder's row in the library sidebar, shown on hover beside ⋯: outlined to pin, filled on a pinned folder.
- **Changed:** "Stay in hidden mode" now has an anchor icon, as the pin now means pinning a folder.

## 0.53.59 — Pin folders to the top (2026-11-04)

- **Added:** **Pin to top** in a folder's menu in the library sidebar puts it first in the Folders list, a subfolder too; remembered on this device.

## 0.53.58 — Sort folders and tags in the sidebar (2026-11-04)

- **Added:** a sort button on the library sidebar's Folders (A to Z, Z to A, newest, oldest), Tags and Canvas tags (A to Z, Z to A) headers, remembered on this device.

## 0.53.57 — Search folders and tags in the sidebar (2026-11-04)

- **Added:** a search box in the library sidebar's Folders, Tags and Canvas tags sections. It finds by name or path, opens what leads to a match, and `Esc` empties it.

## 0.53.56 — Library keys leave a note's words alone (2026-11-04)

- **Fixed:** typing in the notes editor could reach the library's keys: an `o` opened Organize, an `i` showed or hid the details.

## 0.53.55 — No 256 MiB limit in the desktop app (2026-11-04)

- **Added:** files past 256 MiB can be imported by the button or by dropping them: copied into `library/` a part at a time, and each comes in as a card. An import of content the library has adds nothing.
- **Added:** files past 256 MiB can be hidden and shown again. They are encrypted a part at a time, in the same format as every hidden file, and the readable file is erased only after the encrypted one has been opened back from the disk and its hash proven. `scripts/hidden-items.mjs` opens them.
- **Added:** backups and ZIP exports hold files past 256 MiB, written where you choose in a save dialog, and such a backup can be imported.
- **Added:** a hidden art file past 256 MiB shows its picture once the Hidden items are open.
- **Fixed:** saving a copy of a file past 256 MiB, opening a hidden one in another app, or copying a hidden one wrote an empty file.

## 0.53.54 — Organize key, canvas tags as a tree, the preview left alone (2026-11-04)

- **Added:** `O` opens Organize for what is selected in the library.
- **Added:** canvas tags are a tree on `/`, as library tags are; a parent lists what is nested under it, and renaming it renames those too.
- **Changed:** the layers panel keeps room for the arrow on every row, so its rows line up.
- **Fixed:** in Organize, choosing *No folder* did nothing.
- **Fixed:** in the library's list view, a thin gap above the column names let scrolled thumbnails show through.
- **Removed:** the note under an art file's preview, a backup copy's and a custom thumbnail's in the viewer, which took room from the picture. What it said is in the details. The "no preview" note and the notes about a failure stay.

## 0.53.53 — Previews and a label for automatic backups (2026-11-04)

- **Added:** an art file's backup copy (`.kra~`, also `.psd~` and the other art kinds) shows the picture it keeps. An item imported earlier keeps its 4:3 card, its picture cropped to fit.
- **Added:** a file ending in `~` or named `-autosave` says it is an automatic backup: on its card, in its details and in the viewer. `~` files are their own entry under File types (`.KRA~`).

## 0.53.52 — The folder tree lines up (2026-11-04)

- **Removed:** the folder list and *New folder…* from the details panel. It says which folder the items are in, and **Organize…** moves them and makes a new folder.
- **Changed:** every row of a tree keeps room for the arrow, so icons and names line up with or without one. A count ends at the row's edge, and the row's ⋯ takes its place under the pointer.
- **Changed:** a folder showing its subfolders has an open folder icon.
- **Fixed:** the Collapse all button on a sidebar header is beside the other buttons, not in the middle.

## 0.53.51 — Art files past 256 MiB show their picture; tags as a tree (2026-11-04)

- **Added:** an art file past 256 MiB that lies in the desktop app's `library/` shows the picture it keeps, on its card, in the viewer and on a canvas. It is read a part at a time, never whole.
- **Added:** art files past 4 GiB in a ZIP-based format are read (ZIP64).
- **Added:** the sidebar's tags are a tree on `/`, as the folders are: arrows that fold, Collapse or Expand all, remembered on this device. A button on the Tags header shows them in a row instead.
- **Changed:** a Photoshop merged picture past 64 megapixels is no longer given up on: the viewer shows it reduced to fit, read a window at a time. Before, it fell back to the small thumbnail.
- **Changed:** a tag's count is how many items it finds: with it or a tag nested under it, each item once.
- **Fixed:** in a `.kra` or `.ora`, a merged picture too big to unpack no longer leaves the card with no picture when the file has a smaller one.
## 0.53.50 — Menu descriptions kept very short (2026-11-04)

- **Changed:** every menu description is at most 44 characters, and `check:components` holds it there.

## 0.53.49 — Folders as a tree, Organize, and one shared component per thing (2026-11-04)

- **Added:** folders fold: an arrow on a folder with subfolders, Collapse or Expand all on the Folders header, and it is remembered on this device.
- **Added:** Organize… on a library item (right click, or Details): one dialog to move it to a folder and set its tags, with a search, as a tree or in a row. A tag such as `art/ink` shows as `ink` under `art`. Nothing changes until Apply.
- **Added:** a right click on a folder or tag in the sidebar opens its menu.
- **Changed:** the folder list has the look of the layers: guide lines, arrows and count pills, from one shared tree.
- **Changed:** every menu row has an icon, a name and a very short description, across the app.
- **Changed:** the sidebar's and the workspace's row menus are now the app's one menu; all dialogs come from one shell. `npm run check:components` and a browser test hold this.

## 0.53.48 — Previews for .figcraft (2026-11-04)

- **Added:** `.figcraft` files show the picture they keep (`thumbnail.png` in the file). One without it keeps its card.

## 0.53.47 — The viewer's note leaves the picture clear (2026-11-04)

- **Fixed:** a note in the viewer (an art file's preview, a custom thumbnail, a file with no preview) no longer covers the bottom of the picture: the picture ends above it.

## 0.53.46 — Previews for art files (2026-11-04)

- **Added:** `.kra`, `.ora`, `.psd`, `.psb`, `.procreate`, `.sketch`, `.fig` and `.clip` show the picture they keep: on their library card and details, in the viewer and on a canvas. A preview, as the file was last saved; the file is only read, and one with no picture keeps its tile. A newly imported one has the picture's shape on a canvas; one imported earlier keeps its 4:3 card, the picture cropped to fit.

## 0.53.45 — The Trash, rebuilt into the library (2026-11-04)

- **Changed:** the Trash is a state of the library view: the library's own cards in place of its grid (it still showed behind), only Trash lit in the sidebar, and what is picked in the details panel. Ctrl and Shift pick several, Ctrl+A all, a right click offers the same actions.
- **Changed:** Restore and Delete for good are in the details panel and the right-click menu, for one file or many, instead of buttons on each row.

## 0.53.44 — Trash shows, and the sidebar leaves it (2026-11-04)

- **Fixed:** the Trash's list showed under the grid, out of sight, and its search word stayed, so All items, Unfiled and the rest seemed to do nothing. The grid now gives way to it, and anything else in the sidebar, or the filter and sort menus, goes back to the library.

## 0.53.43 — A Trash in the library (2026-11-04)

- **Added:** **Trash** in the library's sidebar (desktop app): it puts `is:trash` in the search box and lists the files in this workspace's `.trash` folder, not your system's trash. In hidden mode, with the Hidden items open, it lists the hidden ones instead; outside it, nothing of them shows or counts.
- **Added:** **Restore** puts a file back where it was, with its item when the library still has it, and **Delete for good** erases it after asking.
- **Fixed:** temporary files of a write the app was stopped in are swept at the next start, in `library/` too: the sweep looked for an older spelling and never found them.

## 0.53.42 — An item whose file is there is never taken as erased (2026-11-04)

- **Fixed:** the app stopped at the wrong moment (a crash, a kill, power lost) could leave hidden items out of the sealed index for a moment; on the next start they were taken as erased on another device and their files moved to `.trash`. An item whose file is still there is now never taken as erased, for hidden and shown items alike, and the lists are written again.
- **Fixed:** in a big library, the first write after a start could have written only some hidden items into the sealed index. The first write is now always whole.

## 0.53.41 — Delete everywhere on a canvas; merging folders; hidden items out of reach (2026-11-04)

- **Added:** **Delete everywhere** in a canvas's right-click menu and the command palette, with the library's question. Text and shapes selected with it stay.
- **Added:** two folders a disk would take for one (`Refs`, `refs`): when naming, renaming or unhiding, choose **Merge** (a file with the same name gets `-2`, nothing is overwritten, one undo step) or **Keep separate** (a numbered name).
- **Fixed:** outside hidden mode, a hidden item on a canvas is out of reach of Ctrl+C on a note card and of Copy file: they could read it while the Hidden items were open. Delete everywhere is not offered for it either.
- **Fixed:** selecting a text with a library font no longer offers that font for Copy file.
- **Fixed:** the Delete everywhere question says the workspace folder in the desktop app, not this browser's storage.

## 0.53.40 — Repair removed (2026-11-04)

- **Removed:** Repair library file names: new names are right as they are made, and older files keep working as they are.

## 0.53.39 — Opening a folder moves nothing, however its folders are spelled (2026-11-04)

- **Fixed:** two folders on disk read as one library folder (`A- B`, `a-b`) could have one's files moved into the other when a workspace was opened. A file in either now stays where it is.

## 0.53.38 — One dialog for every tag; fewer Settings tabs (2026-11-04)

- **Changed:** Canvas tags in the library's sidebar and the Tags panel rename in the same dialog as the library's tags, in place of a box in the list.
- **Changed:** Settings has two tabs fewer: the library viewer's options are in Media and playback, Panels is a card in Appearance. Their settings and values are the same; search and the command palette find them.

## 0.53.37 — Panels kept open in one line (2026-11-04)

- **Changed:** Panels kept open (Settings > Panels) says what it is on one line, the rest under More.

## 0.53.36 — Settings rows no longer overlap (2026-11-04)

- **Fixed:** rows in Settings had a fixed height from 0.53.34, so their words were cut and ran into the next row.

## 0.53.35 — Settings say it in one line, all of them (2026-11-04)

- **Changed:** Library files (Settings > Storage) says what it is on one line too.

## 0.53.34 — Settings say it in one line (2026-11-04)

- **Changed:** every setting says what it is on one short line; the whole explanation is under its **More**, and search still finds it.
- **Changed:** Settings > Notes is in cards: Editor, New notes, Cards and previews, Properties, File names. Saving to the library and Navigation gain cards too.

## 0.53.33 — Copy, for every kind of file (2026-11-04)

- **Added:** Copy in the library: a plain text note gives its words, a rich text note markdown with its properties, several notes their words joined. A video or sound gives its library picture. Where only the name can go, or a picture stands for more (a GIF, an SVG), or only the first of several pictures fits, the message says so.
- **Added:** **Copy file** (desktop app; the library's menu and a right click on a canvas): the real files, of any kind, to paste in a file manager. A hidden item goes as a readable temporary copy, asked first, deleted on lock and on closing.
- **Changed:** Ctrl+C on one note card on a canvas gives the note's words with its properties; pasted back here it is still the card.
- **Fixed:** Copy in a canvas's right-click menu now reaches the system clipboard, as Ctrl+C does.
- **Fixed:** an SVG with no size of its own is copied at a size that can be seen, not one pixel.
- **Changed:** text on the clipboard, reading pictures from it and what each kind of file becomes are each written once.

## 0.53.32 — Hidden items stay out of suggestions (2026-11-04)

- **Fixed:** outside hidden mode, the names and values of hidden items' properties are no longer offered in the suggestions, the list columns or the Sort menu.
- **Changed:** the first copy of a hidden item to the system's clipboard in a session asks first, as it can be seen and kept by other programs.

## 0.53.31 — No extension made up (2026-11-04)

- **Fixed:** with Keep file names, a file of an unknown type keeps its name as written (`README`, `x.7z.001`): no `.bin` is added, on import or by Repair library file names.

## 0.53.30 — One set of rules for file and folder names (2026-11-04)

- **Changed:** every rule for file and folder names is in one place, and `npm run check:name-rules` fails on a rule written elsewhere; nine cleaners became one. Names taken in a ZIP, export or style file are numbered `-2`, as on disk (they were ` (2)`, `_2`), and rich text notes too.
- **Added:** names that work but can bite elsewhere (a leading `-` or `~`, `% & ; $`, an ending the library skips when it reads its folder) get a word when chosen; nothing is refused for them.
- **Added:** **Repair library file names** (command palette): files an earlier version named less well get today's names, when asked. Opening a folder never renames anything.
- **Changed:** two library folders side by side that a disk would take for one are refused when named.
- **Changed:** a note's name holds none of `# ^ [ ]`, which a link cannot; unseen characters go from new names.
- **Fixed:** a dot in a name no longer costs the file its extension (`Scan v2.1` on a picture is `Scan v2.1.png`).
- **Fixed:** a very long name stays whole after a clash on disk; a full pass over a big library no longer asks the library about each item for its name.
- **Fixed:** a heading such as `Chapter` renames `Chapter-2024.md` with Rename notes on save; a year is no clash.
- **Fixed:** a `[[link]]` finds a note by one rule everywhere, so a backlink to a plain text or rich text note is found; a saved name ending in a dot or a device name no longer differs from its file.
- **Changed:** dates in file name templates and in notes come from one engine, and every template writes what it did; link parts are percent-encoded by one rule.

## 0.53.29 — Rename notes on save; automatic changes off by default (2026-11-04)

- **Added:** **Rename notes on save** (Settings > Notes, off by default): each save names the note's file from its first heading or its title property, in its own **File name style**: Keep as written or Clean. Links to it in other notes follow.
- **Changed:** **Title** is Off or First heading: a title is no longer filled in from the file's name.
- **Changed:** **Automatic created and modified** is off by default, and on its own switch: a save changes a note only as asked.

## 0.53.28 — Automatic note properties; Ctrl+C in the library (2026-11-04)

- **Added:** a note's **title**, **created** and **modified** properties are automatic: every save writes the modified time, the created time when there is none, and the title. In the details panel they cannot be removed, and the two times cannot be edited.
- **Added:** Settings > Notes: **Automatic properties** (on by default), the three properties' names, a **Date and time format**, and **Title comes from**: the file's name (a title written by hand stays) or the first heading.
- **Added:** a note pasted with its own title or created keeps them; its modified becomes the time of the save.
- **Fixed:** Ctrl+C copies the picked items in the library's grid, and the item shown in its viewer. Words selected or being typed are copied as before.

## 0.53.27 — A dialog to rename a tag (2026-11-04)

- **Added:** a double-click on a tag in the details panel renames it.
- **Changed:** the sidebar's Tags section renames in the same dialog, in place of a box in its list. A rename still applies to every item, and a name another tag has still joins the two.

## 0.53.26 — Properties: moving, layout and date boxes (2026-11-04)

- **Fixed:** dragging a property by its grip stopped after its first step and left the row marked as moving; it now follows the pointer to the end, and a long list scrolls near its edges.
- **Fixed:** date and date-and-time boxes look like the other value boxes, in every theme.
- **Changed:** a narrow details panel gives a property's value the whole width under its name; the name and its × are quieter, and properties are further apart.
- **Fixed:** a type error in 0.53.25.

## 0.53.25 — A name taken from a file shows at once (2026-11-04)

- **Fixed:** an item that took its file's name (`image-2.png`) showed the old name until the library was drawn again; the lists now follow at once.

## 0.53.24 — Whole notes copied with their properties; lists as lists (2026-11-04)

- **Added:** copying a whole note (select all and copy in the editor, or Copy on one markdown note in the library) copies its markdown file with its properties as YAML at the top, to paste into a note in Obsidian or elsewhere.
- **Changed:** a **List** property is a row of items, each kept whole: a comma is part of an item, Enter adds, × or Backspace removes, dragging moves. A list in a note's YAML is shown so, and is written as a list.
- **Fixed:** with Keep file names, two items of one name in one place (two pasted `image.png`) kept that name in the app though the later file on disk is `image-2.png`: the item now takes its file's name, in a library that already has such items too.
- **Fixed:** a list item with a comma in it (`Smith, John`) became two items when the list was edited.

## 0.53.23 — Property types (2026-11-04)

- **Added:** **property types**, as in Obsidian: *Text*, *List*, *Number*, *Checkbox*, *Date*, *Date & time*, chosen from a button before a property's name and kept for that name in the whole library. A name without one takes its type from its value. A checkbox is a box to tick, a date a picker.
- **Added:** a value that does not fit its type shows a warning with what the type expects, while typed and when stored; the value itself is never changed.
- **Added:** a saved search's **update button** in the sidebar gives it the layout, columns and sort shown now.
- **Changed:** a saved search's look is kept with it in the settings, so it travels with the workspace backup instead of staying in this browser or device.
- **Changed:** in a narrow details panel a property's value has its own line under its name, and a long value wraps in a box that grows; both were cut.
- **Changed:** a list column shows a value of several lines on one line, all of it that fits.
- **Fixed:** a card's labels (Note cards show properties) show a property that only the library has, and change as soon as it does.
- **Fixed:** undoing or deleting what was pasted from Obsidian leaves its properties out of the next save.
- **Fixed:** a value typed while the details panel was drawn again could be lost when leaving the box.
- **Fixed:** a list property or a checkbox written into a note's file is a real YAML list or a bare `true`/`false`, not a quoted text.
- **Fixed:** a property's value suggestions could be emptied by the panel being drawn again.

## 0.53.22 — Properties (2026-11-04)

- **Changed:** the details panel's Note and fields are **Properties**: **Description** and **Add a property**, in Obsidian's word, as they are a markdown note's YAML. `description:` and `property:` search as `note:` and `field:` do, which still work.
- **Added:** a property as a **column** of the library's list (List columns), and as a **sort** (its head, or the Sort menu's Properties): dates by date, numbers by number, and items without it last either way.
- **Added:** search by what a property says: `property:created>2025-01`, `property:rating>=4`; any item of a list counts.
- **Added:** a property's value suggests what others of that name say.
- **Added:** a saved search in the Library keeps the look it was saved with (grid or list, columns, sort), and is listed under **Saved searches** in the sidebar: one click brings both back, so it works as a view.
- **Added:** **Note cards show properties** (Settings > Notes): chosen properties as labels at the top of a note's card and library picture.
- **Added:** a `|` or `>` block in a note's YAML is read as text, with its lines; it stays a block in the file while unchanged.
- **Changed:** properties pasted with a note from Obsidian join the note's own at the next save (tags are added, a missing key is added, what the note says stays) instead of coming in as a code block.

## 0.53.21 — Notes copied from Obsidian (2026-11-04)

- **Fixed:** a note copied from Obsidian and pasted into a note shows its pictures, also in tables, when their files are in the library: it showed only their names. Its `![[embeds]]`, `[[links]]` and footnotes are saved as Obsidian writes them.
- **Fixed:** its properties, pasted with it, keep their lines (a `yaml` code block in the note): they ran together on one line.

## 0.53.20 — Names and sorting are two settings; edge panning has a switch (2026-11-04)

- **Added:** **Pan at the edge while dragging** (Settings > Navigation) is now a switch, on by default; off, the view stays where it is and objects can be dragged past its edge. **Edge panning speed** beside it sets how fast (it was one slider, with 0% for off).
- **Changed:** **Keep files as they are** is now two settings (Settings > Saving to the library): **Keep file names** (on by default) only decides names, and **Sort files by kind** (new, off by default) only decides whether a file in no library folder moves into its kind's folder, keeping its name.
- **Changed:** a change of either setting applies to the files at once, instead of at the next change in the library.

## 0.53.19 — Notes, files and paste (2026-11-04)

- **Changed:** the README's Settings table, paste, saving and file place sections describe the 0.53.x settings and behaviour.

## 0.53.18 — Paste: the middle button, and under the pointer (2026-11-04)

- **Fixed:** on Linux, ending a pan with the middle button also pasted what was cut or copied (a middle click is a system paste there). Only your own paste places objects now.
- **Fixed:** what is pasted lands under the pointer also when something floats over the canvas there, or the pointer has left the window: it went to the middle of the view, often where the object came from, until the next click.

## 0.53.17 — Files stay as they are (2026-11-04)

- **Changed:** **Keep files as they are** (it was Keep file names as written) is on by default, and also covers where a file is: it stays where you put it, its folders keep their names and no extension is added. Off, files are tidied and sorted as before.
- **Added:** **Write tags and properties into note files** (Settings > Notes, off by default): a tag or property changed in the library no longer changes the note's file unless this is on. Saving a note then leaves its YAML as the file has it.

## 0.53.16 — Library details panel: rename, movable sections (2026-11-04)

- **Added:** a double-click on the name at the top of the library's details panel renames the item.
- **Added:** the details panel's sections can be moved as the sidebar's are: drag a section's name, or Alt+Up and Alt+Down on it. The order is kept.

## 0.53.15 — Dragging goes to the view's edge (2026-11-04)

- **Fixed:** dragged objects go up to the edge of the view, under the panels: a docked panel no longer stops them where it ends.

## 0.53.14 — Notes: the / menu in every style (2026-11-04)

- **Added:** the notes editor's `/` command menu in every editor style (it was only in Notion-like).
- **Fixed:** the editor style's help in Settings no longer says an open note waits to be opened again.

## 0.53.13 — Notes: Classic's own toolbar (2026-11-04)

- **Changed:** the notes editor's Classic and Bottom styles have one short toolbar row, as SunEditor's own Classic: undo, formats, bold, italic, underline, lists, link, picture, table; everything else behind its **+**. Document keeps the full toolbar.

## 0.53.12 — Dragged objects stay in view; note styles apply at once (2026-11-04)

- **Changed:** objects dragged to an edge of the view stay in view, also beside docked panels; the view pans once the objects themselves near the edge, and only toward where they are moving.
- **Fixed:** changing the notes editor's style shows at once in the notes open in that style (it waited until the note was opened again).

## 0.53.11 — Notes: a save pressed during a save (2026-11-04)

- **Fixed:** Ctrl+S pressed while a note's save was still running, with changes made since, no longer does nothing: one more save follows it.

## 0.53.10 — Paste under the pointer, edge panning (2026-11-04)

- **Fixed:** what is pasted always lands under the pointer. Objects in another frame than the view (made at another depth), or copied on another canvas, came back where they were.
- **Added:** dragging objects near an edge of the view pans it that way, faster the nearer the edge; **Pan at the edge while dragging** in Settings > Navigation sets the speed, or turns it off.

## 0.53.9 — Notes: save on close, save as (2026-11-04)

- **Added:** **Save notes on close** (Settings > Notes, off by default): leaving a note with changes saves them without asking.
- **Added:** **When a note's formatting does not fit its file** (Settings > Notes): Ask (the default), Keep its file (`.md`, `.txt`, dropping that formatting), or Rich text (`.note.html`).

## 0.53.8 — Keep file names (2026-11-04)

- **Added:** **Keep file names as written** (desktop app, Settings > Saving to the library, off by default): a file in the workspace folder keeps its item's name, capitals, spaces and brackets, and only characters a system forbids are replaced. Turning it on moves no file already there; turning it off tidies them. Folder names stay tidy.
- **Fixed:** the links in notes follow a file the app renames in its own folder.

## 0.53.7 — Notes follow files renamed outside (2026-11-04)

- **Fixed:** a file renamed or moved outside the app keeps its place in notes: the links to it are written again, whether the app was running or closed at the time. A file whose content also changed in the same step is a new file, and its links are not followed.

## 0.53.6 — Notes: pictures in tables (2026-11-04)

- **Fixed:** a picture in a markdown table cell stays in its cell: the editor took it out of the table when the note opened, and an edit of that table saved it outside.

## 0.53.5 — Notes: pasted pictures (2026-11-04)

- **Fixed:** a note's content pasted into another note keeps its pictures and files. They carried the first note's temporary address, which stops working when that note closes; each now gets the new note's own, and its real link in the file. A note already saved with such an address finds its picture by the name it carries, and has its real link written at the next save.

## 0.53.4 — Notes: a save changes only what was edited (2026-11-04)

- **Changed:** saving a markdown note changes only the blocks that were edited: the rest stays as the file wrote it (`*` lists, `__bold__`, spacing, an underlined heading).
- **Added:** an Obsidian `![[embed]]` of a picture shows that picture in the notes editor; the file keeps the `![[…]]`.
- **Changed:** the video and sound dialogs show the file's link instead of a temporary `blob:` address, as the picture dialog does.
- **Fixed:** a paragraph indented under a list item stays in that item.
- **Fixed:** a false "rich text?" question on a table of one column with an alignment, and on a code block ending in an empty line.

## 0.53.3 — Notes fixes: pictures, saving, keys (2026-11-03)

- **Fixed:** a note's pictures no longer break when it is closed. A link is now found by the file it names on disk (`my cat.png` is the file `my_cat.png`, the second `image.png` is `image-2.png`, which the old search by the item's name missed), also on the note's card; a copy of an item's file shows that item, and `<with space.png>` and names with brackets are read.
- **Changed:** a note writes its links from the root of the library (`images/cat.png`), with brackets encoded; links written relative to the note, or with `library/` in front, are still found.
- **Changed:** the picture dialog shows a picture's link instead of its temporary `blob:` address, and a path typed there is found in the library.
- **Fixed:** saving a markdown note no longer damages it: lines inside a paragraph or quote stay lines (they joined without a space), the lines of a code block too, as do `==highlight==`, `<kbd>`, a fence's words (` ```c++ x `), a code block holding a fence, tables with short separators or extra cells, the space between marked words in a cell, `[[Foo (bar)]]`, and links to other programs (`obsidian://`).
- **Fixed:** a save keeps the properties as the file writes them while their values stay the same: comments, quotes, `[a, b]`, empty keys, a list item with a comma, and a tag listed both in the YAML and in the words.
- **Fixed:** a note starting with a rule (`---`) and no YAML keeps its first words; `[[#Heading]]` and `[words](#part)` make no tag; a `$&` in a rich text note's properties stays as written.
- **Fixed:** Undo, Redo, Delete and the other keys stay with the note while you are at it: with the focus off its words (its panel's header, its Undo button, a picture selected), they went on to the canvas, and Delete with a picture selected also deleted the note's card. Ctrl+S works there too.
- **Fixed:** an image pasted or dropped into a note is stored once and goes in once (it was also stored and linked as a file), and no longer brings up the rich text question.
- **Fixed:** text typed in the Markdown or Code view counts as a change (closing asks), and so does text typed while a save is running.
- **Fixed:** a note closed with unsaved rich formatting (hidden items locked) keeps its text; it came back empty.
- **Fixed:** a note made rich text in the Note panel is one from then on (a second save made `plan.note.html.note.html`), its panel says its new name, and closing the panel with that save no longer opens it again. On desktop its file is `plan.note.html` (it was `plan.note.md`). The name is a free one when another note has it; a failed save leaves the note as it was; changes made in another app are asked about here too.
- **Fixed:** two notes with the same words stay two notes, on import and on save (in the browser, one replaced the other).
- **Fixed:** a note's card is laid out no narrower than a short column (a thin one made a card thousands of px tall) and no larger than the app can draw, and Reset size takes its page back to the width it was placed with.
- **Fixed:** previews show a rich text note's videos and sounds, and leave `[[x]]` in code as it is; a template's `{{time}}` is the time it goes in.

## 0.53.2 — Note cards (2026-11-03)

- **Changed:** a note's card on a canvas lays its page out at its own size: a side handle flows the words to the new width (or shows more or less of the page) instead of stretching them; dragging a corner evenly zooms the card.
- **Changed:** **Note cards show** (Settings > Notes: Whole note by default, or Part) replaces Preview length and Preview width, and applies to existing cards at once.
- **Fixed:** a short note's card could be cut while a longer one was not, and could keep an old height after a save or a setting change; a card's own height is now measured from its own page.
- **Fixed:** a note's card could change size on the screen while zooming, with its selection box left as it was (a smaller copy was made at another shape).

## 0.53.1 — Notes fixes (2026-11-03)

- **Fixed:** saving a markdown note wrote Obsidian's footnotes and embeds escaped (`[^1\]`, `![[cat.png\]\]`), which broke them in Obsidian, and dropped table column alignment: they are written as Obsidian writes them.
- **Fixed:** saving a markdown note asked about formatting markdown cannot keep when it had none (a footnote, a table, an empty line or spaces at a line's start were taken for formatting).
- **Changed:** **Save as a rich text note** turns the note into `name.note.html` in its place (its folder, tags, links and cards on canvases follow it) instead of leaving the markdown file beside a new one; its cards on canvases show the rich note at once.
- **Added:** Remove format in the toolbar over selected words (it takes a size, font or colour back off words, a heading's too).

## 0.53.0 — Notes (2026-11-03)

- **Fixed:** in the Note panel, a note's `##` headings were as small as the panel's own title (the dock panels' heading style reached into the note).
- **Fixed:** a note's preview showed its links between notes as `[[Plan]]`; it shows their words, as the editor does.

## 0.52.10 — Closed note fix (2026-11-03)

- **Fixed:** a note closed while its last typing was still being handled (a hidden note closing as hidden items lock) no longer throws an error from the editor's slash and autocomplete menus.

## 0.52.9 — Reset size (2026-11-03)

- **Added:** **Reset size** in the Actions bar: the selected pictures, videos, GIFs, sounds and note cards go back to the size they are placed at, at the current zoom (one pixel of the file for one of the screen; a note card at its Note card size), about their middle, in one undo step. It shows when it would change something.
- **Fixed:** the canvas list kept the number of objects a canvas had when the list was last read (deleting most of a canvas still showed hundreds until a reload); it follows every save now.

## 0.52.8 — Notes test fix (2026-11-03)

- **Fixed:** the hidden note test opened the old version's card while the library was still swapping it for the saved one (a race in the test, not in the app); a test now records the stack of a page error, to find where an error seen only on GitHub's runners comes from.

## 0.52.7 — Notes editor (2026-11-03)

- **Added:** markdown (`.md`, `.markdown`), plain text (`.txt`) and rich text notes (`.note.html`) open in the library's viewer in a notes editor (SunEditor), in the style chosen in Settings > Notes (Document by default; Classic, Bottom, Balloon, Notion-like). `Ctrl+S` saves the note's own file in place (the same file in the desktop app's `library/`), keeping its name, folder, tags, note and fields; unsaved changes are asked about before the note is left.
- **Added:** when a markdown or text note holds formatting its file cannot keep, saving asks whether to save it as a rich text note beside it (`name.note.html`, nothing lost; the markdown file stays as it was) or as plain markdown.
- **Added:** a note's pictures, video, sound and files come from the library: the editor's gallery buttons open the library chooser, and a file uploaded, dropped or pasted into a note goes into the library first. Links are written relative to the note (`../Pictures/cat.png`); `canvast:<hash>` links are read and kept too. The font list is the library's fonts.
- **Added:** templates (Insert ▸ Template): four built in, and any note tagged `template` (an existing note or one written for it); layouts (Insert ▸ Layout: two or three columns, sidebar and main). Task list boxes can be ticked (`- [x]`). Saving is manual (`Ctrl+S`).
- **Added:** the notes editor wears the app's look (its font, colours, corners, light or dark theme), and the library chooser opened from one of its dialogs (Insert image's gallery button) shows above that dialog.
- **Changed:** Settings are regrouped: new tabs **Notes** (the editor's style), **Library** (the viewer's edges, player and slideshow) and **Saving to the library** (extracted frames, edited pictures, exports, patterns, shapes), leaving **Media and playback** with the players; the colour picker has its own card in Drawing and selection, *Fill gaps* moved to Shapes, and *Memory for pictures* has its own card in Performance.
- **Added:** previews of notes: a note's library card and its card on a canvas show the top of its page instead of the plain file tile.
- **Fixed:** a picture inserted into a note through the Insert image dialog did not show (the viewer's own picture styles hid it); the dialogs' Submit button had white text on the dark theme's light accent.
- **Fixed:** in notes, a task showed a bullet beside its box; a table did not show; a font of the library did not apply (it is now listed and set by its family name, which the app also gives the font).
- **Added:** closing the desktop app's window with a note's changes unsaved asks first (Save them, Don't save, Cancel).
- **Changed:** a note's toolbar has no New document (it emptied the note), Print or page buttons; the font list says Default when words have no font of their own.
- **Changed:** while hidden mode stays on outside the library (*Stay in hidden mode*), hidden items placed on canvases show their pictures on the screen, as with *Remember the Hidden password*; Exit, locking or closing puts the padlock back.
- **Changed:** the custom thumbnail button sits with ★ and Hide in the details panel (it took a row of its own in the viewer); a note's details show its page too.
- **Fixed:** a long note's card on a canvas was cut to 4:3 and blurry when zoomed in: a note's card is now its whole page (up to a limit), at twice its size.
- **Added:** a note's properties: its YAML block (as Obsidian writes it) is its item's tags, note (`description`) and fields, read in on import and from saves elsewhere, and written back when they change in the library; rich text notes keep them as `<meta>`. Saving a note whose words were changed in another app since it was opened asks first.
- **Added:** links between notes as Obsidian writes them (`[[Plan]]`, `[[Plan|text]]`, `[[Folder/Plan]]`): `[[` offers the library's notes and files, Ctrl+click opens what a link points at.
- **Added:** `#tags` written in a markdown note's words are its item's tags (as Obsidian reads them); `#` offers the library's tags.
- **Added:** Linked from in an item's details (the notes linking to it), and links in notes that follow an item renamed or moved in the library.
- **Added:** the library search finds notes by the words in them.
- **Added:** `[[canvas:Name]]` links that open a canvas; a preview of what a link points at while the pointer rests on it; `{{date}}`, `{{time}}` and `{{title}}` in templates; files in dot-folders of `library/` (another app's own, as `.obsidian/`) are never taken in.
- **Fixed:** the `[[` and `#` lists (and the editor's other floating panels) could open outside the window, cut off at its edge; an empty Linked from showed its heading.
- **Added:** a note's preview (its card on a canvas, its thumbnail) shows the pictures, videos (▶), sounds (♪) and GIFs it links to, and Obsidian's `![[picture]]` embeds.
- **Fixed:** a long note's card shown small on a canvas was drawn from its full-size picture (up to 1200 × 3600) on every frame: it now has a small copy like a picture's, drawn at that size.
- **Fixed:** panning slowed down with a few big pictures (long notes' pages, big photos) shown at a middle size, a few hundred pixels: they were drawn from all their pixels. A 1024 px copy now serves them (8× less to draw; the 512 px copy still serves small ones).
- **Fixed:** the `[[` and `#` lists were as wide as the page in full screen and cut in a small window: they are as wide as their names, never wider than the window, and show each name once.
- **Fixed:** a file card's picture (a note's page) is made in the computer's memory like a decoded picture's, not on the GPU, which made panning over a few notes slow.
- **Removed:** Space no longer starts or pauses the library's slideshow (its button does; Space is the player's).
- **Changed:** library cards have no checkbox any more (a selected card shows its border). **Select several** in a card's menu (a long touch on a touch screen) makes each tap or click add or remove an item.
- **Added:** Settings > Notes, **Preview length**: how much of a long note its card on a canvas shows (Short, Medium, Long by default, Whole note).
- **Fixed:** the note panel on a canvas was a modal dialog, so the editor's own dialogs and menus (Insert image, the link dialog, the library chooser) could not be clicked: it is a panel of the dock now (floats, docks, resizes; the canvas stays usable). Saving twice in a row (Ctrl+S held) asked about another app; closing right after a save asked about unsaved changes.
- **Added:** the note panel on a canvas: double-click a note's card (or Edit note in its Actions bar) to edit it there, with the same editor and saving as the library (one shared `OpenNote`).
- **Added:** pasting a web address or a `[[link]]` over selected words in a note makes them the link; the selection toolbar has the link button.
- **Fixed:** switching a note to Markdown view (or Code view) and back without a change there lost its picture sizes and spacing.
- **Fixed:** a row of the `[[` list could run past the list's edge.
- **Added:** **New note** in the library's Import menu: a markdown note in the open folder, opened to write in.
- **Changed:** the library chooser (texture fill pictures, custom thumbnails) is one shared panel that can also open in the middle of the page, list any kind of item, import files from this device, and shows the first 300 matches of a big library (search narrows it).
- **Added:** rename a note from the Note panel's header (or F2), with the library's rename dialog; a save after a rename keeps the new name.
- **Fixed:** renaming a rich text note offered `name.note` as its name with `.html` as the extension, so `.note` could be dropped by accident: `.note.html` is one extension in the rename dialog and batch rename.
- **Fixed:** after a note was saved (or a library file changed outside the app), undo on the canvas brought back the old version, or an earlier step could no longer be undone: the new version now replaces the old one in the undo history too.
- **Changed:** the Note tool (M) makes a note file: a markdown note in the library's Notes folder, its card placed where the canvas is clicked (as wide as a box dragged), opened in the Note panel. It no longer makes a text on a card.
- **Added:** Make note files (Actions bar): texts on a card become notes in the library, their cards in the same place, as wide, at the same stacking.
- **Added:** Settings > Notes > Notes folder: where new notes are filed (the Note tool, and New note in the library when no folder is open).
- **Changed:** in the desktop app's workspace folder, notes in no library folder (md, markdown, txt, note.html) are kept in `library/notes/` instead of `library/documents/` (they move there by themselves).
- **Added:** Settings > Notes > Preview look: notes' previews (their cards on canvases and in the library, the hover preview of a link) on light or dark paper; Auto, the default, follows the app's theme.
- **Fixed:** pasting into a text field or a dialog (a name, a link, a search) while the clipboard held a file also imported that file into the library and placed it on the canvas.
- **Added:** in the notes editor, the font size and the width and height of a picture or video change by dragging the field left or right, as every number field of the app.
- **Fixed:** a context menu could open far from the pointer: a narrow one opened to its right, and in the library one kept off the canvas's selected items, which are not on the screen there. It now opens at the pointer.
- **Added:** `kind:note` in the library and canvas searches, and in the library `kind:vector`, `kind:document`, `kind:archive`, `kind:3d`, `kind:preset`, `kind:icon` and `kind:art`.
- **Added:** while a search or a filter hides items in the library, a chip over the grid says what and how many are shown, with Show all items (a filter left on looked like lost files).
- **Fixed:** desktop app: several saves of one file at the same moment (moving hidden items, which rewrites their list) could fail with a "could not write" notice: two of them used the same temporary file. Nothing was damaged: a file is only replaced once its new copy is complete.
- **Fixed:** desktop app started from a terminal that was closed since: a crash dialog "write EPIPE" (its log went to a broken pipe).
- **Added:** Settings > Notes > New note name (a pattern with {board}, {canvas}, {yyyy}, {hhmmss}… as for screenshots) and Note card width (how wide a click of the Note tool makes a card).
- **Added:** Settings > Notes > Editor style on a canvas: the Note panel's editor has a style of its own (Document at first, as in the library).
- **Fixed:** a long note's preview faded out to white on the dark look.
- **Fixed:** the Note panel was not as wide as its place in the dock (an empty strip beside the editor when it was made narrow) and its header was unlike the other panels': it is now a panel like the others. A long name is cut with "…" (the whole name on hover).
- **Changed:** the library's reset-filters button is coloured while a filter is on.
- **Fixed:** a hidden note open in the Note panel stayed open, readable and editable, after hidden mode ended (Stay in hidden mode, then Exit): it now closes with its changes saved as soon as hidden items are no longer shown.
- **Added:** Settings > Notes > Note editor on a canvas: Panel (the dock's) or Window (centred over the canvas).
- **Added:** Settings > Notes > Preview width on canvases: Narrow, Medium or Wide pages on notes' cards.
- **Fixed:** in the notes editor, a click in the font size field lost the chosen words, so a typed size changed nothing.
- **Fixed:** a note saved with its words made big and then small again kept the tall card of the big version (two versions alike in length and start shared one measured page).
- **Fixed:** the Note panel's toolbar showed scrollbars everywhere (the panels' list style reached it); a press on its header folded it away (an editor never folds now); it was blurring the canvas behind it on every frame (it is an opaque page again).

## 0.52.6 — Library files worked on elsewhere, Flip (2026-11-02)

- **Fixed:** a library file saved again by the program it is worked on in (a painting, a scene, any kind of file) showed as missing or damaged although it was there, and deleting its item removed that newer file for good. The item now follows the file: the new version takes its place with the item's name, folder, tags, note, fields and favourite, and its pictures and cards on every canvas show it, whether it was saved while the app ran or while it was closed. A file that no longer holds an item's content is never removed with the item.
- **Fixed:** an animated GIF brought in by a backup was placed as a still picture, with no player; backups now keep a GIF's frame count and a video's length, and a GIF without its count is counted when it is placed.
- **Added:** **Flip horizontally** and **Flip vertically** beside Crop, with **Reset flip**, for pictures, video and GIFs: mirrored in the same box. On a flipped picture crop cuts the side you drag; Make a new picture, Copy as picture and Download include the flip.

## 0.52.5 — Thumbnails let go safely (2026-11-01)

- **Fixed:** a thumbnail's picture could be let go while the Library still showed it (after hidden mode ended, or a custom thumbnail changed), which failed to load it and logged an error; it is now let go only once nothing shows it.

## 0.52.4 — Hidden files stand on their own, long names, library files (2026-11-01)

- **Added:** Settings > Privacy says what the desktop app keeps on this computer (working copies, recent workspaces, readable copies of hidden items opened elsewhere) and lists what to do for full privacy; the README too, with what removing the app leaves.
- **Added:** working copies of workspaces this computer no longer opens (the folder deleted, renamed or moved) are removed at start-up once a month old.
- **Added:** the Library's context menu in the viewer: a right click (or a long touch) on the picture, or on a picture of the filmstrip, offers that item's actions.
- **Changed:** shorter button words where they were cut off or long: the details panel's **Place** (its tooltip says where), **Save stop colour** in the gradient editor, **Protect it** in Settings > Storage.
- **Changed:** a video or sound the app cannot play (HEVC / H.265 video, for one) is no longer called *missing or damaged* in the viewer: it says its format cannot be played here and how to open it elsewhere.
- **Fixed:** a hidden picture drawn as a padlock on a canvas showed its real name in its label and in the Layers panel; it is named *Hidden item* there until its picture is shown.
- **Fixed:** after giving the Hidden password, the Library showed "Hidden folder" and blank names for a few seconds (until the hidden files were checked and put in place); it now lists the real names at once. Files hidden before this version are renamed into their encrypted folders and names with a progress screen (*Updating hidden items*), once; later openings check only what changed.
- **Added:** **Library files** (Settings > Storage): split the library's files into 16, 256 (the default) or 4,096, for the whole workspace, with about how big one file is for this library. More files are smaller, so a sync tool uploads less for each edit. Changing it writes them all again once; update the app on every device first.
- **Changed:** the library's part files (`.canvast/library/items-xx.json`) leave out values that only say nothing (no tags, not a favourite, no folder, no note, no fields, not deleted): about a quarter smaller, read back the same by every version. Each part is written in the shorter form the next time it is saved.
- **Fixed:** with `.canvast/library/` deleted (all of it or some parts), the app wrote back its index but not the missing parts until an item in each changed, so other devices or a new computer read a library without tags and notes. Any part missing on disk is now written back from this device's copy at the next save.
- **Changed:** hidden files stand on their own, as with rclone's crypt: each is named by its own name, encrypted, in its encrypted folders, and holds only its content. Tags, notes, fields and favourites are only in the encrypted index, so changing them, renaming, moving or filing an item never encrypts or uploads its file again; only new content does. A hidden file renamed or moved outside the app is found again by its content and takes its new name and folder. Files hidden before are renamed into place (not encrypted again) when the Hidden items are opened; backups keep each file's place. The decrypt tool gives every name and folder back from `.hidden/` and the key alone.
- **Changed:** hidden items' files are kept in folders inside `.hidden/` that follow their library folders, each folder's name encrypted, instead of all in one folder. Renaming or moving a folder, or filing an item elsewhere, renames on disk and never encrypts again (a sync tool sees a rename); files hidden before are moved into their folders the next time the Hidden items are opened. The outside tool (`scripts/hidden-items.mjs decrypt`) writes the tree the folders say.
- **Added:** with *Remember the Hidden password* on and the password given, hidden pictures placed on canvases show on the screen instead of a padlock. Exports, copies, pattern fills, baked pictures, screenshots and bookmark pictures still draw the padlock.
- **Added:** search keywords `is:thumbed` (items with a custom thumbnail) and `is:unthumbed`.
- **Fixed:** counts that read wrong for one: the library picker said *Search 1 pictures* (now *Search the picture*; none: *No pictures in the library*), and the same for a saved ZIP of pictures, a palette's colours, the layers filter, a bookmark's Update, an adjustment's layers and the workspace folder's file counts.
- **Added:** backups carry hidden items' custom thumbnails, still encrypted as they are in `.hidden/thumbnails/` (nothing readable of them, not even their hash); importing in the desktop app puts them back.
- **Added:** a custom thumbnail can be pasted: **Paste a picture** in the thumbnail dialog, or `Ctrl`+`V` while it is open (kept small like an upload, never imported into the library).
- **Changed:** the thumbnail dialog says what each choice does in plain words (*Choose a thumbnail*: Uploaded thumbnails, From the library, Upload a picture, Paste a picture, Original).
- **Changed:** the viewer's video and GIF player fades away also while the pointer rests on it, and keys (step, play and pause) no longer bring it back: only a move of the mouse, a click or a touch does.
- **Fixed:** in the viewer's details panel the custom thumbnail button sat over the Place on canvas button (the preview it belongs to is not shown there): it now has its own place at the right.
- **Fixed:** in a narrow window (the phone layout) the gallery viewer kept an empty band at the top, room for the tabs it hides: the picture now uses it.
- **Fixed:** a workspace folder renamed onto the path of another opened before on this device (one since deleted) showed that one's library: this device's copy of the library and its start-up look were kept by path. They are now kept per folder (by its id), like the rest of the app's copy; the one of the old folder at that path is removed.
- **Fixed:** a custom thumbnail chosen for an item showed in the viewer and the details at once, but its card in the grid or list kept the old picture until the app was started again.
- **Fixed:** after giving the Hidden password (and after a start or a Rebuild), the Library kept showing "Hidden item" names, or no hidden items, until it was closed and opened: it is now listed again once the hidden items have been read.
- **Fixed:** a readable folder put in `.hidden/` from a file manager was left readable: its files are now encrypted like a file put there, its folders become hidden library folders of their names, and the emptied readable folders are removed.
- **Added:** importing into the Library a file it already has under another name offers to rename it to the imported name, with the old and new names listed first (in hidden mode for hidden items only); importing the originals again brings back names that were cut short. Undo puts the old names back.
- **Fixed:** long file names: an item's name can be up to 1,000 characters (it was cut at 200), and its file in the workspace folder keeps up to about 230 letters of it (it was cut at 100); exported files (Files ZIP, Export folder) keep their extension when a long name is cut (it was cut at 120 letters, extension and all).
- **Fixed:** pasting a long list of tags with commas into a tag box kept only the first 64 letters of it.
- **Fixed:** with hidden items' names off this device while locked (Settings > Privacy), every start and unlock encrypted all hidden files again (new bytes, so a sync tool uploaded them all again): the names blanked while locked were taken as a change. Hidden files are now written again only when their item really changed.

## 0.52.3 — Custom thumbnails, quick filters, player focus (2026-10-30)

- **Added:** custom thumbnails: any library item (also a file with no preview) can show another picture in the Library and on its file card on a canvas: one uploaded before (their own category, *Thumbnails*, never library items), a picture of the library, a new upload (kept small), or its own again. In the desktop app uploaded ones are files of `.canvast/thumbnails/`. Backups carry them.
- **Added:** hidden custom thumbnails: one uploaded in hidden mode is seen only there (sealed with the hidden items' key in `.hidden/thumbnails/` in the desktop app); hiding an item takes its uploaded thumbnail with it, showing it again makes it normal; `hidden-items.mjs decrypt` writes them to `thumbnails/`.
- **Added:** `Ctrl`+click (`⌘` on a Mac) on a file type or a tag in the Library's sidebar adds it to the filter, or takes it out: several types, several tags, or both (any of the types, and any of the tags).
- **Changed:** the hidden mode chip in the status bar is a little taller, and the word no longer shows in the search box (the chip says it).
- **Fixed:** a click on the viewer player's empty space now puts the focus in the player, so `Left`, `Right` and `Space` are the player's; the player fades away while one of its buttons has the focus, too.
- **Fixed:** the search help's examples ran out of its card.
- **Fixed:** buttons in the Library's details panel with no tooltip (New folder, Export, the bulk actions, a canvas tag to add, Show all canvases).

## 0.52.2 — Hidden mode in the status bar, player keys, GIF player (2026-10-30)

- **Changed:** hidden mode is shown by a compact chip at the start of the Library's status bar (with a pin and *Exit*; on a phone, the eye and *Exit*) instead of a strip across the top.
- **Added:** *Stay in hidden mode when leaving the library* (the chip's pin, and Settings > Privacy): hidden mode then ends only with Exit, the word deleted, locking, or closing the app.
- **Added:** in the desktop app, *Open in default app* for a hidden item (in hidden mode): after asking once per session, a readable copy in the app's own temporary folder (readable by your user only) is opened, and deleted when the hidden items are locked, when the app closes, or at the next start.
- **Changed:** in the viewer, while the focus is in the video, audio or GIF player (also once it has faded), `Left` and `Right` step the file and `Space` plays or pauses it, instead of going to another file or pressing the focused button.
- **Fixed:** a GIF whose frames were never counted (imported before they were, or taken from a workspace folder) had no player in the viewer.

## 0.52.1 — Export folder; hidden thumbnails encrypted (2026-10-30)

- **Added:** *Export folder…* (a library folder's ⋯ menu): its files and its subfolders', as a ZIP or, in the desktop app, as a folder where you choose outside the workspace, keeping its folders or all together; each file written to a folder is read back and checked. In hidden mode it exports the hidden items, readable, after asking.
- **Changed:** `scripts/hidden-items.mjs decrypt` writes the hidden items into their library folders, from each file's own encrypted header (`--flat`: all at the top, as before), with `hidden-items.json` at the top saying where each went; `encrypt` finds that list from a file in a subfolder.
- **Changed:** in the desktop app, a hidden item's thumbnail is stored encrypted with the hidden items' key (in the app's own cache), so hidden mode no longer opens and decodes each whole file again to draw its card or compare its look.

## 0.52.0 — Hidden mode (2026-10-30)

- **Added:** hidden mode of the Library: the opening word (`hidden:`) and the password turn the whole Library into a list of the hidden items only, with every function of the normal view (folders, *Unfiled*, *Favourites*, tags, file types, *Similar images*, search, sorts, layouts, viewer, slideshow, rename, notes and fields, filing, bulk actions). Its folders are the hidden ones and those holding hidden items, with counts of hidden items. A bar across the library says it is on; it ends with *Exit hidden mode*, by deleting the word, by locking, or by leaving the library, and the library is then as it was before, with the hidden items' pictures dropped from memory. Replaces the Hidden list.
- **Added:** *Unhide folder* (a folder's ⋯ menu in hidden mode): the folder, its subfolders and every item in them shown again, also the items in it hidden one by one.
- **Changed:** an item filed into a hidden folder is hidden with it, and a folder made inside a hidden folder or in hidden mode is hidden.
- **Changed:** *Keep the Hidden items open until the tab closes* is now *Remember the Hidden password until the tab closes*: hidden mode always ends when you leave the library, and begins again without the password while the tab remembers it.
- **Changed:** in the desktop app, hiding or showing an item writes only the items it changed, not the whole library.
- **Added:** a stress run of the hidden items (`scripts/stress-hidden.mjs`, the `Stress hidden` workflow on GitHub): 10,000 hidden items with times, CPU and memory, and the app killed at random moments during hiding, showing, moving and locking, each round checked for lost or damaged files.
- **Fixed:** outside hidden mode, the library's item count, total size and search suggestions no longer include hidden items.
- **Fixed:** in the desktop app, a folder hidden while the hidden items were locked is no longer dropped from the folder list when they are opened.
- **Fixed:** in the desktop app, a temporary file left by a write that a crash cut off is removed at the next start.
- **Fixed:** two tests that raced on GitHub (the canvas search's Shift+Enter, the video player's Pause in Firefox).

## 0.51.1 — A million items in the Library (2026-10-30)

- **Changed:** in the desktop app, the Library view of a library of 20,000 items or more lists a page at a time: only the cards near the view are read, and the search, sort and counts are worked out in the app's main process. Measured with a million files on a GitHub runner: the Library shows them all about 10 s after the app opens (before: about a minute, and 1.9 GB of memory; now about 500 MB). *Similar images* is not offered for a library that big.
- **Changed:** in the desktop app, a library of a million files is no longer read whole for an edit, a check or a file added from outside: undo keeps only what an edit changed, which files are missing is looked at for the cards drawn, and an import writes only what is new. A file put into `library/` from outside is listed in about 3 s at a million files (before: about a minute).
- **Fixed:** a Firefox test of *Extract frame* clicked Pause while the player was still fading in.

## 0.51.0 — The desktop library in SQLite (2026-10-30)

- **Changed:** the desktop app keeps the library on each device in a SQLite database (in the app's own data folder) instead of the page's storage. It reads and writes the library's files itself, only the parts that changed. Measured on a GitHub runner: a library of 300,000 files opens in about 24 s the first time on a device (56 s before) and 3 s after (9 s before); one of a million files now opens (about 2 minutes the first time, 16 s after), where before it did not open in 30 minutes. The workspace folder's files are unchanged; the first start moves what this device held of the library into the database.
- **Changed:** in the desktop app, start-up writes only the library items changed on this device since their last write, not the whole library.

## 0.50.60 — Quick check of library files (2026-10-30)

- **Added:** *Check library files (quick)* (command palette, desktop app): looks only at each library file's presence and size, without reading it, and names those gone or of another size than the library knows. It takes seconds on a big library; the full check still finds same-size changes.

## 0.50.59 — Big files and Check library files (2026-10-30)

- **Added:** in the desktop app, a file larger than 256 MiB put into `library/` is taken in where it lies as a card (name, kind, size), from its SHA-256 read in the background; it opens in the system's app. It is never read into the app, so it is left out of backups and ZIP exports, and cannot be hidden.
- **Added:** *Check library files* (command palette, desktop app): reads every library file and names those changed, damaged or gone.

## 0.50.58 — Newer versions, old trash, sync tools (2026-10-30)

- **Added:** in the desktop app, a device whose canvast is older than the one that last wrote the workspace folder says so once, and asks to be updated (`workspace.json` now names the version that wrote it).
- **Added:** *Empty .trash after* in Settings > Storage (desktop app, *Never* by default): 30 days, 90 days or a year after something went into `.trash/`, it is deleted for good when the app starts. Things put in `.trash/` are now dated when they went there.
- **Changed:** the README says which files a sync tool can ignore (`*.tmp-*`, the app's half-written files).

## 0.50.57 — Start-up looks only at what changed (2026-10-30)

- **Changed:** in the desktop app, start-up looks only at the library files that changed since the last time this device looked (the look is kept in the app's own folder), instead of every file; the first open on a device still looks at all. At 100,000 files, the second open lists the library in under 10 s.
- **Fixed:** past 200,000 files in `library/`, start-up and a new folder put there no longer stop looking (the folder is read many files at a time, with no limit).
- **Fixed:** two devices that changed the boards at the same moment could lose a canvas one of them had just added (the other's `workspace.json` came last, without it, and the canvas was taken as deleted). `workspace.json` now lists what was deleted, and only that is deleted on another device; and a device takes the other's boards in before it writes the file.

## 0.50.56 — A big library writes only what changed (2026-10-30)

- **Changed:** in the desktop app, a big library writes only what changed: the library's index is in 256 parts, and a rename, a tag or a deletion rewrites only its item's part (at 100,000 items, a rename's write went from about 7 s to 0.14 s).
- **Changed:** a file changed in `library/` outside the app is looked at alone instead of the whole folder being listed again (at 100,000 items, a file put in from outside is listed in about 4 s instead of 29 s); the app also remembers its files' sizes between looks.
- **Changed:** the first open of a big workspace on a new device takes the library in about 40% less time.
- **Fixed:** past 200,000 files in `library/`, a new file put there from outside while the app ran was never found.
- **Added:** `scripts/bench-library.mjs`, a benchmark of the desktop app on a workspace folder of N library files.

## 0.50.55 — Hide folder; hidden names off the device (2026-10-29)

- **Added:** *Hide folder* in a library folder's menu: the folder, its subfolders and every item in them are hidden, and the folders leave every list. Showing an item again shows its folder again. In the desktop app the folder's name is kept only encrypted, and its real folder leaves `library/`.
- **Added:** *Keep hidden items' names off this device while locked* (Settings > Privacy, desktop app): when the Hidden items are locked, and when the app starts, this device's own copy of their names, tags and notes is cleared; opening them brings it back from the encrypted files.

## 0.50.54 — Hidden items stay encrypted in backups (2026-10-29)

- **Changed:** in the desktop app, a backup that includes hidden items carries them still encrypted, with their key file, instead of readable: nothing of them can be read from the backup. Importing it in the desktop app brings them back once the Hidden items are opened with their password; the browser leaves them out and says so. Backups are now version 7 (older versions of the app ask to be updated to import one).

## 0.50.53 — Hidden files that stand on their own (2026-10-29)

- **Changed:** in the desktop app, each encrypted hidden file holds its own name, library folder, tags, note and fields (encrypted too), and is sealed in 1 MiB chunks, each checked on its own: a file whose entry is lost comes back whole, and a file cut off or changed anywhere is refused. Files encrypted before are encrypted again this way once the Hidden password is given; a change to a hidden item here seals its file again.
- **Changed:** `hidden-items.mjs` reads and writes files that stand on their own, and names a file with no entry from what it holds.

## 0.50.52 — scrypt for the Hidden password (2026-10-29)

- **Changed:** in the desktop app, the Hidden password is stretched with scrypt (128 MiB of memory for each guess) instead of PBKDF2, so guessing it is far more costly. A workspace's vault is upgraded the next time the password is given; no file is encrypted again. `hidden-items.mjs` reads both.
- **Fixed:** `workspace.json` carried a PBKDF2 form of the Hidden password (the browser's gate), which let it be guessed more cheaply than through the vault; the desktop app no longer writes it there.

## 0.50.51 — The hidden items' key, safer (2026-10-29)

- **Changed:** in the desktop app, the hidden items' key is held so that no code in the page can read it out of memory; changing the Hidden password asks for the current one.
- **Added:** a spare of the hidden items' key, `.canvast/keys/hidden.json`: if `hidden.json` is lost or damaged, the same password still opens every hidden file, and the app writes `hidden.json` again. `hidden-items.mjs` uses it too.
- **Added:** hiding five files or more at once shows *Encrypting N of M files*.
- **Fixed:** if the app stopped while encrypting a file, the next start deleted the readable file without checking that the encrypted one opens; it now checks first, and keeps the readable one otherwise.

## 0.50.50 — A damaged canvas file no longer stops the workspace (2026-10-29)

- **Fixed:** in the desktop app, a canvas file that changed but did not read whole (damaged, or a sync tool still writing it) stopped the workspace from opening. It is now skipped: this device's copy of the canvas is shown and kept, the app says so once, and the file is read again when it changes (it is never written over).
- **Changed:** the README's Limitations list what sync tools can still do to a workspace folder.

## 0.50.49 — Library and boards joined after sync clashes (2026-10-29)

- **Fixed:** in the desktop app, when two devices changed the boards or the library at once and the sync tool kept a copy beside the file (`workspace (1).json`, `items-3 (1).json`, `index (1).json`, `library (1).json`), what the other device added (canvases, library items, library folders) was lost from the app. It is now taken from the copy, and the copy moves to where deleted files go.

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
