# ADR 0062: in-canvas tags

Status: accepted (owner request, 2026-10-16)

- **What:** a tag on an item on a canvas (`CanvasObject.tags`), separate from the library tags of an asset. Every kind of item can carry them. Same tidying as library tags (spaces collapsed, a leading `#` dropped, case-insensitive duplicates merged; at most 50 per item, 64 characters each). Stored in the object record; archives keep them (`serializeObject` / `deserializeObject`). Database version 8 adds a multi-entry index `tags` on `data.tags`; older records simply have none.
- **Editing:** the Layers panel has a Tags row for the selection (chips with ×, a box with suggestions from the tags already on the canvas; Enter adds, comma separates); the selection bar has a Tag button that opens it. One undo step each way (`tagObjects`).
- **Search:** `#` finds an item by its in-canvas tags and, for a picture, the tags of its original.
- **Assets view:** a "Canvas tags" list in the left panel lists every in-canvas tag in the workspace (read from the `tags` index), separate from the library's Tags list; choosing one shows the assets that have instances with it. In the properties of one asset, "Tags used on canvases" lists the in-canvas tags carried by its instances (anywhere in the workspace) that the asset does not have, each a button that adds it to the asset's library tags.
- **Placing:** when a picture with library tags is placed (single, several, or on another canvas), a dialog asks whether the placed items carry those tags as in-canvas tags ("Place with their tags" / "Place without tags"; cancel places nothing).
- **Not yet:** rename or delete an in-canvas tag across every canvas.

Tests: `assets.spec.ts` "in-canvas tags" (tagging, removing and undoing, search, the Assets lists, adopting a tag, the placing dialog in three answers).
