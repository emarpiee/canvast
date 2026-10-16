# ADR 0078: Any file can go in the app

## Status
Accepted (v0.17.0)

## Context
Only pictures, video and audio could be imported; anything else was refused. The app should take every file and say what it cannot do with it.

## Decision
- **Import takes any file** (the file picker, drag and drop, paste; archives still import as archives). The original is stored once, by content hash, like every asset. `type` is the browser's type or `application/octet-stream`.
- **What the browser can show is shown** (pictures, GIF, video, audio). **Everything else is a card**: a 400 × 300 picture drawn by `makeFileCard` with the extension on a chip, the name, what it is ("3D model", "Document", ...) and the size. A picture, video or sound the browser cannot read is not refused any more: it is kept and shown as a card too (`AssetRecord.card`, `CatalogEntry.card`).
- A card is an ordinary image instance of the stored original: it is placed, moved, grouped and saved like any picture, and the original is never touched. It is made again from the stored bytes after a reload.
- `assets/file-kind.ts` holds the rules: `chipOf` (extension, else the type, else FILE), `describeFile` (category, what to do, whether a tab can show it), `isCard`.
- **What to do:** every asset has **Download original**; a PDF or text file also has **Open in a new tab** (opened as a typed copy: PDF as a PDF, text as plain text, never as a page). A card selected on the canvas has the same two buttons in the selection bar; the library's details say "No preview for this file", what it is and what to do (for a 3D model: open it in a viewer such as Blender). The viewer shows the card large.
- The extension chip is on library cards of pictures, video and audio, and in the details of every asset. A card carries its own chip in its picture.
- Plain ZIP "by file type" now makes a folder per extension (`item.obj` goes in `obj`; no extension: `other`).
- Archives accept any type for assets.

## Consequences
Nothing is refused for its type any more; only a file larger than 256 MiB is. No preview is made for 3D models, documents and the rest yet: they can be added later as viewers behind the same card.
