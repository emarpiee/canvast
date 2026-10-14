# ADR 0019 — Snapping and guides

- Status: accepted (Phase 2, slice 3)
- Related: ADR 0001/0014 (exact coordinates and frames), ADR 0003 (picking and the shared projection), ADR 0017 (settings), engineering plan §16 Phase 2

## Context

Phase 2 asks for snapping and guides that follow the same camera and scene contract at large distances. A snap that aligns to the nearest pixel would drift apart as soon as the user zooms in: two edges that looked aligned at 1x are a thousand pixels apart at 1e12x.

## Decision

While a selection moves with the Select tool, its box lines (left, middle, right; top, middle, bottom) snap to the same lines of any other visible object.

- **Candidates are found in px, aligned in exact coordinates.** `bestSnap` (`interaction/snap.ts`) picks the closest pair of lines within 6 CSS px, using the projected boxes (what the user sees; the bounding box of a turned object, ADR 0018). The alignment then comes from the exact world coordinates of the two lines: the move is `target line - where the moving line started`, in exact dyadic numbers, expressed in the move's frame. Snapped edges therefore coincide exactly at any depth and zoom, not just on screen.
- **Guides:** a dashed line at the target position (`editor.guides`), drawn in the overlay while the move is snapped; gone when the gesture ends.
- **Toggle:** a magnet button on the Select tool's options, persisted as the device setting `snap.enabled` (default on).
- **Limits:** at most 2,000 candidates are searched, so a dense scene never slows the pointer; covering approximations (coarse objects the view is inside) are not candidates.

## Not in this slice

- Snapping while resizing and rotating (the rotation angle already snaps to 15 degrees with Shift), equal spacing between objects, and user-placed guides. They reuse `bestSnap` and the exact-line computation.

## Consequences

- Any gesture that wants to snap gathers a `SnapContext` once at its start and calls `bestSnap` per pointer move.
