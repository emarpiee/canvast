# ADR 0124: Bookmark pictures

## Status
Accepted (v0.17.0).

## Decision
A bookmark's picture used to be taken only when the bookmark was made or updated, from the view at that moment. Bookmarks made by a script or an import had none, and the panel showed grey boxes. The Bookmarks panel can now **update the pictures**: from its header button (Update all, or Fill in the missing ones), from a bookmark's menu (Update its picture), or from the "N bookmarks have no picture" line (Fill in).

The canvas visits each place in turn (`app/bookmark-thumbs.ts`): it goes to the bookmark's exact view, waits until the pictures that view needs are decoded (the decode queue idle for three frames, at most 2.5 s), draws a clean frame (no selection outlines) and takes a 128 px JPEG, then goes on. At the end the view goes back where it was and all the new pictures are written in one go (`BookmarkList.setThumbs`, keeping each bookmark's place, name and date). A veil covers the page while it runs and says how far it is; Escape (or a press on the veil) stops it, and what is done is kept. The camera history does not remember the visits (`CameraHistory.hold`).

## Why this way
- An off-screen render would need a second copy of the scene pipeline (tiles, assets, frames), and could differ from what the canvas shows. Visiting uses the one pipeline, so the picture is exactly what the place looks like.
- It runs only when asked, one place at a time, a few frames each: about a second for a dozen bookmarks, nothing in the background.

## Not done
- Updating automatically when a canvas with picture-less bookmarks is opened (it would move the view without being asked).
