# ADR 0025 — View bookmarks (saved views)

- Status: accepted (owner request of 2026-10-14; the plan's "bookmarks, named regions, navigation history" §14.21, "recover it with bookmarks" §1150, backups include "camera/bookmark state" §14.35)
- Related: ADR 0006 (storage), ADR 0008 (archives), ADR 0014 (frames)

## Context

On an endless canvas a place is easy to lose: content can be a trillion levels deep or far from anything else. The plan wants bookmarks to recover it. The usual names are bookmarks, saved views or named views.

## Decision

A **bookmark** is a named camera on one canvas: `{ id, name, view, thumb?, at }`.

- **The view is the camera in frame form** (`StoredFrameView`, ADR 0014), exactly as a canvas's saved view, so going to a bookmark is exact at any depth and zoom (`deserializeFrameCamera`, `setFrameCamera`).
- **A small picture** (128 px wide JPEG data URL, at most 24,000 characters) is taken from the canvas when the bookmark is saved, so the list shows where each one goes. If the browser cannot make one, the row has a blank thumbnail.
- **Storage:** IndexedDB schema 5 adds the `bookmarks` store, one record per canvas holding its list (additive; nothing is migrated). Up to 500 bookmarks per canvas.
- **Frames are kept.** A bookmark names a frame; frame collection (ADR 0014) now treats bookmark frames like the saved view's, so a bookmark a trillion levels down still opens after clean-up and a reload.
- **Archives (version 3)** carry each canvas's bookmarks (`bookmarks` in `canvases/<id>.json`). Import checks each one (structure, thumbnail, that its frame and view are valid) and skips damaged ones with a note; their frames are included in what is written. Deleting a canvas deletes its bookmarks.
- **Panel:** a floating, hideable Bookmarks panel above the Layers panel (toolbar button; device setting `ui.bookmarksOpen`): Add saves the current view as "Bookmark n"; clicking a row goes there; double-click a name renames it; the cross deletes.

## Not in this slice

A smooth camera flight (going to a bookmark is a jump), a shortcut key, previous-view history, named regions, and bookmarks shared between canvases. The bookmarks of a canvas that is not open are not editable.

## Consequences

- Phase 7's navigation work (history, minimap, search and reveal) builds on `BookmarkList` and the stored view form.
