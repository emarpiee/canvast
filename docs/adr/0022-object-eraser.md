# ADR 0022 — Object eraser

- Status: accepted (Phase 2, slice 6)
- Related: ADR 0020 (groups), ADR 0021 (hide and lock), engineering plan §14 (Object Eraser), test P

## Context

The plan asks for an Object Eraser, distinct from a stroke or raster eraser: a swipe removes the canvas instances it touches, with accurate geometry (not pointer samples or broad boxes), preview while dragging, each instance at most once, one undo step, explicit policy for locked and hidden objects and for groups, and never any garbage collection of originals.

## Decision

A tool (key E, toolbar) with a brush diameter (4 to 128 px, saved as the device setting `eraser.diameterPx`).

- **Geometry:** the swipe is a sequence of segments between pointer samples (coalesced events included). `sweepHits` (`render/hit-test.ts`) covers each segment with discs at most half a radius apart, so a fast flick between two samples cannot jump over a thin object. A disc touches a stroke by its real distance to the projected polyline (or the exact path at deep magnification), an image or text by its rectangle (turned objects: the point is turned back first, ADR 0018), not by a bounding box for strokes. Coarse covering objects count as touched.
- **Once per swipe:** touched ids go into a set. They are previewed while dragging (red dashed boxes) and removed when the pointer is released, all in one transaction, so one undo brings everything back.
- **Policy:** locked objects are never taken; hidden ones are not in the index, so they cannot be touched; read-only workspaces refuse. A group is taken as one object by default; the "Erase whole groups" toggle (`eraser.wholeGroups`) switches to taking only the members the brush touches. Locked members of a taken group stay.
- **Originals:** the transaction only removes instances. Assets are removed only by the reference-checked garbage collection when the user deletes them from the library (ADR 0007).

## Not in this slice

Text is erased by its box (glyph-accurate erasing is possible with the coarse text outlines but not worth it yet); an eraser that cuts strokes (a different tool, not planned).

## Performance

Dense scene (10,000 objects on screen), a 40-move swipe: 0.67 s wall time in Playwright (its own mouse round trips dominate), frames stay at 1 ms. The sweep tests only the visible, unlocked objects and rejects by bounding box first.
