# ADR 0163: camera travel to a far bookmark

- Status: accepted (2026-10-21, owner's request: the camera cut straight to a far bookmark)
- Related: ADR 0116 (gliding between views), ADR 0014 (nested frames)

## Problem

`flyTo` glided only between views in the same frame within one frame step (`K`) of zoom; anything else cut. A far bookmark is exactly that case. The glide time was fixed, and the sideways zoom-out arc was capped at 6 levels however far the trip.

## Decision

- **Near** (same frame, zoom within `K`, needing at most `DIVE_ARC` = 8 levels of zoom-out to show the way): one smooth path, as before.
- **Far** (other frame, or more than 8 levels needed): a **dive**. Phase 1 zooms out from here by `DIVE_OUT` = 24 levels (under a frame step, so every number stays small, also in Firefox); phase 2 puts the camera 24 levels out over the target and zooms in. The switch happens where both places are a speck, so no exact interpolation across frames is needed. The first half speeds up and the second slows down (both linear with linear easing).
- **Time:** `glideMs` is the base. Distance-aware time is `base × (1 + levels/6)`, never over `maxGlideMs` (the longest trip, at least the base); fixed time is the base.
- **Settings (device):** `nav.travel` (fly / near / cut), `nav.speed` (distance / fixed), `nav.maxSeconds`, `nav.ease` (smooth / linear / out), `tour.pause`, `tour.speed`, `nav.fade`. Animation None, reduced motion and the test session still set the base to 0 (cut).
- `flyTo(target, done)` calls `done` on arrival (at once when it cuts), never after an interruption; the tour uses it to move on after `tour.pause`.

## Not done

A straight flight across frames.

## Added later (v0.26.1)

`nav.fade` (default on): `ViewState.fade(opacity)` dips the canvas to dark within 8% of the trip either side of the switch and restores it on arrival or interruption. `tour.speed` (slow / normal / fast) scales the tour's glide.
