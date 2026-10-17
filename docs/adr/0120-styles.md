# ADR 0120: Styles

## Status
Accepted (v0.17.0): adjustments and colours. Colour palettes and other kinds come next on the same system.

## Decision
**Styles** are the looks the user saves to use again, kept together in the library: one list of named items (`assets/styles.ts`), each `{ id, kind, name, at, data }`. What an item *is* is its **kind**, one object of `STYLE_KINDS` that says how to check its data (`validate`), how to say it in a line (`summary`) and, when it has one, a colour dot (`dot`). Today: **adjustment** (the numbers of ADR 0118) and **colour**.

**To add a kind** (a colour palette, a stroke style, a text style): add one object to `STYLE_KINDS`, and give the place where it is made a "save" and the place where it is used an "apply" (the Adjust panel and the colour picker are the two examples). Nothing else changes: the storage, the card, rename and delete, the checks on what is read back, and the keeping of kinds this version does not know (a newer version's items are kept untouched and not shown) are the same for every kind.

**Storage.** One list in the `meta` store of the database (`WorkspaceRepo.styles` and `saveStyles`), so it belongs to the library, not to a canvas, and it needs no schema change. `StyleLibrary` (in `Session.styles`) keeps it in memory, writes it after every change, undoes the change on screen if the write fails (a read-only tab), and other tabs reload it when told (`styles` message). At most 500; names up to 60 letters; a name left empty becomes "Adjustment 3".

**Where it shows.** The Assets view's sidebar has a **Styles** card (below Canvas tags) with a list for each kind: the name, a line saying what it is ("Contrast +30", "#2563EB"), a dot for colours, and a More menu with Rename and Delete. The **Adjust panel** has *Saved* chips (a press applies that adjustment to the picked pictures, one undo step) and a *Name to save these as* box with **Save adjustment**; **Reset** stays there too. The colour picker has **Save colour** and, once there are some, a *Saved* row of swatches.

## Not done
Colour palettes (the next kind), saved styles travelling in `.canvast` archives, applying a style from the Assets card itself, folders or tags for styles.

## Tests
`tests/unit/styles.test.ts` (the registry, saving, naming, renaming, removing, a failed write, reading back); `tests/e2e/pictures.spec.ts` (save from the Adjust panel, the card, rename, reload, apply to another picture, delete; save a colour), both browsers.
