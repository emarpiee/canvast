# ADR 0085: Rename assets, one or many, with a reusable rename module

## Status
Accepted (v0.17.0)

## Decision
- **Assets can be renamed**, extension included (`robot.glb` to `droid.obj`): the details panel's **Rename…**, the bulk bar's **Rename N…**, or **F2**. The name belongs to the catalog entry (`AssetCatalog.renameAssets`); the stored original is never rewritten, and every reader (download, ZIP, archive, cards) takes the entry's name. A file shown as a card has its thumbnail dropped and drawn again, and the canvas redraws its cards.
- **The rename module** is two pieces that know nothing about assets, so layers, bookmarks or boards can use them later:
  - `doc/rename-rules.ts`: pure rules over a list of names: **Enumerate** (`#` becomes ascending numbers from a start; a run of `#` is zero-padded; `{name}` is the old name), **Replace text** (plain or regular expression, with or without case), **Add text** (before or after the name), **Change the extension**. Extensions stay unless the person turns "Keep the file extension" off. Names are cleaned for every file system; a rule that would empty a name keeps it.
  - `ui/batch-rename.ts`: `openBatchRename(items, { noun, extensions })` is a dialog in the manner of a file manager's batch rename: *How to rename*, the fields of that way, and a **Preview** of every name, whole, old then new, in a list that scrolls. One item is just a name to edit. It returns the items whose name changed.
- Numbers follow the order the items are listed in the library.
