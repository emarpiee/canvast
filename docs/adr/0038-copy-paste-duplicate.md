# ADR 0038 — Copy, cut, paste and duplicate

- Status: accepted (Phase 5, slice 3; engineering plan: cross-media copy and paste)
- Related: ADR 0001 (exact coordinates), ADR 0014 (frames), ADR 0020 (groups)

## Decision

Ctrl/Cmd+C copies the selection, Ctrl+X copies and deletes it (one undo step), Ctrl+V pastes, Ctrl+D duplicates. They use the browser's own `copy`, `cut` and `paste` events, so no clipboard permission is needed on `file://`, and text fields and the text editor keep their native behaviour.

- **What is copied:** the objects' stored form (strokes, images, text, groups), with their frame, the depth (log2 pixels per unit) of the view they were copied from, and the centre of their box. Locked objects are not copied; hidden and locked states are not carried.
- **Where it lives:** in memory, mirrored to `localStorage` (so another tab of the same profile can paste it), and the system clipboard gets only text: the Markdown of copied texts, otherwise "canvast: N objects". A paste is ours only if the system clipboard's text is still that text, so something copied elsewhere afterwards is never overridden by an old copy (and an image on the clipboard is imported as before).
- **Pasting** puts the objects centred on the middle of the view, at the size they had on screen when copied: the position offsets and the unit move together by an exact power of two (`unit + k`, offsets shifted by `k`), so local geometry is never recomputed and nothing is rounded, at any depth; the result is re-homed into the frame that suits its size. Each repeat of Ctrl+V moves the paste 24 px down and right, so copies do not hide each other. New ids, groups renamed together, stacking order kept above the top. The pasted objects become the selection, in one transaction.
- **Duplicate** (Ctrl+D) does not touch the clipboard: the copy lands 24 px down and right of the original, selected.
- **Frames:** relocation (and the size match) needs the objects to be in the view's frame, as they are in normal work. Otherwise, or when pasting into a canvas that lacks the frame, they come back where they were, with a message; a canvas without the copied frame refuses with a message.
- **Images** keep working across canvases (assets are by content hash, in the same workspace).

## Not done

Pasting across browsers or profiles (the payload is not on the system clipboard), copying to other apps as images, and a choice between paste in view and paste in place.
