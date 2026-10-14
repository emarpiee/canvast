# ADR 0035 — Smart folders (saved searches)

- Status: accepted (Phase 4)
- Related: ADR 0011 (asset organization; it said the search syntax should settle first)

## Decision

The Assets search box already has a small, settled syntax: space-separated words that match an asset's name, type, the start of its hash or a tag (all words must match), and `#tag` for an exact tag. A **smart folder** is that query saved with the usage filter (all, used, unused): `{ id, name, search, usage }`, kept in the workspace's `meta` store (`assetSmartFolders`), next to the folders.

- The sidebar lists them under "Smart folders" with the number of assets that match now (always computed, never stored, so it cannot drift). "+ Save search" is available when the search box or the usage filter is not empty and asks for a name; the result is selected.
- Clicking one fills the search box and the usage filter with its query (the grid shows what they select); editing either afterwards leaves the smart folder (back to "All assets"), so what is shown is always what the boxes say.
- Rename and Delete work like folders'. Deleting a smart folder deletes only the saved query.
- Writes go through the same writer-only path as folders; a read-only tab lists them and cannot change them.

## Not done

Smart folders are not carried in `.canvast` archives (folders, tags and favourites are, because they belong to assets; a saved query belongs to the library view). Sorting is not part of the saved query. No combination with a folder or tag scope.
