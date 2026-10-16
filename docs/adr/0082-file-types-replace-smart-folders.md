# ADR 0082: File types replace smart folders

## Status
Accepted (v0.17.0). Removes the smart folders of ADR 0035.

## Decision
- **Smart folders are gone** from the app: the sidebar section, the "save the search" button, the catalog (`SmartFolder`, `saveSmart`, `renameSmart`, `deleteSmart`, the `smart` part of the listing) and the rewrite of saved searches when a tag is renamed. The stored list (`meta` key `assetSmartFolders`) is deleted once at start-up. Tags, folders and the search with its recent searches (ADR 0071) cover what they did.
- **File types** take their place in the Assets sidebar: one chip per extension found in the library (`.PNG 322`, `.GLB 1`, `.FILE` for a file with no extension and no known type), most files first, with its count. Pressing a chip shows those files; pressing it again lets go (scope `ext:png`).
- **Search by file type:** a word that starts with a dot is an exact file type: `.png`, `.glb`, `.png OR .jpg`, `.png -#ref`. A lone `.` matches files that have an extension. It works in the library search in every way (All, Name, Tag) and in the canvas search (the item's file name ends with it). The ⓘ help card lists it.

## Consequences
A saved search can no longer be kept as a folder; the recent searches list keeps the last useful ones. Nothing in storage depends on the removed list.
