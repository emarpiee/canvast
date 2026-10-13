# ADR 0011 — Organizing the asset library: tags, favourites, folders, search

- Status: accepted (Phase 1, slice 6)
- Date: 2026-10-13
- Builds on [ADR 0007](0007-asset-catalog-and-gc.md) and [ADR 0008](0008-portable-archives.md)

## Context

The Assets view (ADR 0007) listed, searched by name and type, and showed
usage, but had no way to organize a library. The plan (§6, §14.17, §14.33)
asks for:
- custom and multiple tags per asset;
- nested folders whose membership never copies the original;
- favourites and search;
- organization that survives export and import.

## Decision

### Data

The organization lives on the existing catalog entry, so it shares the
entry's lifecycle. When garbage collection erases an asset, its tags and
filing go with it.

| Field | Meaning |
| --- | --- |
| `tags: string[]` | Normalized: trimmed, inner spaces collapsed, a leading `#` dropped, duplicates removed case-insensitively (the first spelling is kept). Each tag is at most 64 characters, and an asset has at most 100 tags |
| `favorite: boolean` | Favourite flag |
| `folderIds: string[]` | Folders the asset is filed in. **Any number**: filing is a reference, never a copy |

Entries written before v0.6.0 lack these fields. They are read through
`meta(entry)` with empty defaults, so **there is no schema change and no
migration**.

**Folders** are one small record, `meta["assetFolders"]`, holding a list of
`{ id, name, parentId }`. Ids are stable; names are display only (at most
120 characters). A folder's view includes its subfolders.

### Edits are applied in storage, not copied from the screen

`AssetCatalog.updateMeta(hash, change)` takes **changes**: favourite on or
off, add or remove tags, add or remove folders. It applies them to the
stored entry inside one transaction. An earlier version wrote back the
whole list the screen showed. Two quick checkbox clicks then raced, and the
second write undid the first; edits from another tab could be lost the same
way. The E2E test found this.

Further rules:
- Folder ids must exist at write time.
- Deleting a folder deletes its subfolders and removes them from every
  entry, in one transaction. Assets are never deleted by it.
- All organization writes are writer-only (`Session.organize`), and other
  tabs refresh over the existing `assets` broadcast.

### UI

- A sidebar scopes the grid: All assets, Favourites, Unfiled, each folder
  (as a nested tree, including subfolders, with counts) and each tag.
- Folder create, subfolder, rename and delete controls are faded until
  hover or focus, and stay reachable from the keyboard.
- The inspector has:
  - a favourite toggle;
  - tag chips with remove buttons, and an input where Enter adds tags
    (comma-separated);
  - a checkbox per folder, shown as a path such as "Refs › Hands".
- A half-typed tag survives re-renders, for example when another tab
  edits.
- **Search:** all words must match. A plain word matches the name, type,
  hash prefix or part of a tag; `#tag` matches a whole tag exactly.

### Archives

Each manifest asset carries optional `tags`, `favorite` and `folders`.
Folders travel as **name paths** (`[["Refs","Hands"]]`), because folder ids
are local to a workspace.

On import, organization is **merged, never replaced**:
- tags are unioned;
- a favourite stays a favourite;
- each path is resolved by finding or creating folders by name
  (case-insensitive), level by level.

So re-importing an archive creates no duplicate folders. Invalid
organization data is reported and dropped; it does not block the import.
Archives from v0.3–v0.5 have no such fields and import unchanged. The
archive format version stays 1, because the fields are optional and older
readers ignore them.

## Consequences

- No migration; old data reads with empty organization.
- **Search and scope filtering** are a linear pass over the in-memory
  listing (marked `shortcut:` in the code). That is fine for thousands of
  assets; add an index if libraries reach tens of thousands.

## Deferred, with reasons

- **Smart folders** (saved queries): the search syntax should settle first.
- **Ratings, colour and dimension filters.**
- **Batch editing** of several selected assets: the grid has single
  selection only.
- **Drag-and-drop filing.**
- **Undo for organization edits.** They are small and reversible by hand,
  and folder deletion asks for confirmation and never touches assets.
- **Duplicate review by visual similarity** (ADR 0007).
