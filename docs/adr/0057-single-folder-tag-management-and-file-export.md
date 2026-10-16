# ADR 0057: one folder per asset, tag management, whole-workspace actions and plain ZIP export

Status: accepted (owner request, 2026-10-16)

## Decisions

1. **One folder per asset.** Tags already cover "belongs to several groups", so folders are single filing. `folderIds` keeps its array shape in storage (no migration); `meta()` reads only the first, `updateMeta` with `addFolders` replaces the folder, `clearFolder` empties it. The details panel and the bulk panel use radio buttons ("No folder" plus each folder). Archive import keeps an asset's existing folder, otherwise uses the first folder in the archive.
2. **Tags are managed, not just attached.** `renameTag` (library-wide, case-insensitive; onto an existing tag it merges; saved searches that name the tag follow) and `deleteTag` (taken off every asset; assets stay). Sidebar: Rename and Delete beside each tag.
3. **Picking always shows the properties.** `select()` re-opens the details panel when a card is picked by click or keys; the panel button only hides it until the next pick.
4. **Whole workspace in the workspace menu:** export a backup (`.canvast`), export all files as ZIP, import a file. Per board and per canvas: Export files as ZIP. In the Assets view, the picked assets: Export N files as ZIP.
5. **Plain ZIP of the original files** (`storage/files-zip.ts`): files keep their original names (characters a file system refuses become `-`; collisions are numbered `name (2).ext`, per folder, case-insensitively). Grouping, chosen in a dialog: **By kind** (Images, Videos, Audio, PDFs, Text, Other) or **By my folders** (the in-app folder path; an asset with no folder goes in the folder of its kind). Workspace scope includes every library asset; board and canvas scopes include the images placed there. Stored (uncompressed) ZIP, same writer as `.canvast`, so the 4 GiB limit applies.

## Tests

`tests/unit/files-zip.test.ts` (names, kinds, collisions); `organize.spec.ts`: single folder, tag rename and delete (and smart folder following), details always shown, workspace menu export by kind and by folder and import into a fresh profile; `assets.spec.ts` "picking several" (Move all).

## Amendment: sidebar redesign

The Assets sidebar was a flat list with Rename/Delete text buttons beside every row (cluttered, and unusable on a phone). Now: icon rows for the three fixed views; sections (Folders, Smart folders, Tags) with a folding header (`ui.closed`, kept on this device) and a **+** icon; one **More** button per row opening a fixed-position labelled menu (kept inside the window; Escape closes only it; a press elsewhere removes only the menu so the press's own click is not lost); tags as wrapping chips; at 900 px and narrower the sidebar is a strip showing the current choice that opens on demand and folds after a choice.
