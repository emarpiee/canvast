# ADR 0133 — Incremental backups, saved styles in archives, Adobe palettes

- Status: accepted (v0.18.1)
- Related: ADR 0008 (archives), 0120 (saved styles), 0122 (palettes)

## Archives, format 4

- **Saved styles travel with a workspace backup** (`styles` in the manifest, checked by `cleanStyles` on the way back). On import the styles the library does not have yet are added (by id); none is replaced or changed. Board, canvas and assets exports do not carry them (a style belongs to the workspace).
- **Incremental backups** (`{ kind: "workspace", since }`): a backup that goes on from the last one made at `since` (the `at` of the backup record). It lists every board and canvas (the structure, so a canvas deleted since is not brought back) but holds the content only of the canvases whose `updatedAt` is later, and the bytes only of the originals imported later (the others are listed without a `file`). The manifest says `incremental: { since }`. A canvas whose camera or bookmarks alone changed is not counted as changed (neither moves `updatedAt`).
- **A chain restores as one** (`readArchiveChain`): the files are sorted by the time they were made; the first must be a full backup, and each next one must go on from the one before (`since` = its `exportedAt`), else the import is refused with a sentence that names what is missing. A canvas is read from the newest file that holds it, an original from the newest file that has its bytes, the list of originals and the styles from the newest manifest. A single incremental file can be opened too: the dialog says it holds only what changed and lists what is not imported. As before, an import adds new boards, nothing is replaced.
- Formats 1 to 3 still import. A format-4 file is refused by an older canvast with the existing "newer canvast" message.

## Where

The Storage tab of Settings has the backup: the last one (full or incremental), Export a backup, Export the changes since the last backup (disabled until there is one to go on from), Export all files as ZIP, and Import backup files (several at once). The storage popover and the workspace menu have the same actions; every import input takes several files.

## Adobe palettes

`.ase` (Adobe Swatch Exchange) and `.aco` (Adobe colour swatches) are read and written next to `.gpl` in the Styles panel: RGB, CMYK (the plain conversion), Lab (D50 to sRGB), Gray and, for `.aco`, HSB. An `.ase` file with groups makes one palette per group (colours outside a group make one named after the file); an `.aco` takes the names from its version 2 list. A palette is written as RGB in both.

## Sheets: presets, scale contents, and measures on a sheet (ADR 0121 left them out)

- **Size presets** on the sheet's size field: paper (A5 to A2, Letter, Legal, Tabloid, some landscape), screens (720p, Full HD, 4K, phone, tablet, desktop) and social sizes, in px at 96 to the inch. Choosing one resizes the picked sheet (its top-left corner stays); what is on it follows its pins as for any resize.
- **Scale contents** (a toggle beside the size): while it is on, resizing the sheet scales everything on it with it, whatever the pins say (`planSheetScale(..., scaleContents)` treats every child as pinned to "Scale"). It is an editor state, not stored on the sheet.
- **On sheet** (Properties bar, for one picked object that sits on a sheet): its X and Y in px from the sheet's top-left corner, and for shapes and pictures its W and H. A change is one undo step, shown live while typed; strokes and text have no W and H (they only scale as a whole).

## Checked

Unit: `tests/unit/ase-aco.test.ts`. End to end (both browsers): the incremental chain, the alone-and-wrong-chain refusals and the styles in `tests/e2e/archive.spec.ts`; the Settings > Storage tab there; palette files in `styles.spec.ts`; presets, scale contents and the measures in `sheets.spec.ts`.

## Sheets and frames (v0.19.1)

Deep in a zoom, near objects can be filed in different frames (the frame suits the size and position of each object). A sheet and what is on it are therefore not always in one frame, and every sheet function must not assume it. The rule: **express in the sheet's frame (`expressObjectIn`, exact) to measure or scale, leave each object filed where it is, and home it again if it was moved** (`planSheetScale`, `boxOnSheet`, `fitSheet`, putting objects on a sheet, brush masks). Before this, a resize left such objects behind, the On sheet fields were missing, and "needs objects that are in one space" refused. The fields are in px of the home zoom, shown in six significant digits (a sheet 0.0035 px wide is not "0"), and dragging a name moves a value by one screen pixel's worth (`data-scrub-step`), so a drag never sends an object tens of thousands of screen pixels away.
