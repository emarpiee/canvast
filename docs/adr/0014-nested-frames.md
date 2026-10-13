# ADR 0014 — Nested frames (proposed)

- Status: **proposed**, on branch `exp/nested-frames`; needs owner approval
- Date: 2026-10-14
- Supersedes, once accepted: the *representation* in
  [ADR 0001](0001-exact-dyadic-world-coordinates.md). Its exactness rules stay.
- Plan and measurements: [docs/plans/nested-frames.md](../plans/nested-frames.md)

## Decision

Positions are stored relative to **nested frames** instead of as one
absolute number. A frame relates to its parent by
`parentPoint = o + childPoint · 2^(−32·n)` (small exact `o`, n ≥ 1 steps of
32 levels; n > 1 is a compressed dive). The camera and every object hold a
small exact position in a frame. A frame is a **coordinate system, not a
container**: it clips nothing, parents nothing, and geometry may extend
past its cell.

The absolute position is still defined: the sum along the frame path. It
is never computed on the per-frame path, only for migration, export,
debugging and tests.

## 1. Items behave exactly as before

The rule: **every operation gives the same exact world result as the
absolute system.** Frames only change how the result is written down. This
is tested by running both systems side by side (`tests/unit/frames.test.ts`):

| Behaviour | How it stays identical | Evidence |
| --- | --- | --- |
| Camera pan, zoom at pointer, jumps, precision memory (`pz`) | The same formulas from `core/camera.ts` run on the frame-local camera. `pz` is carried in frame-local levels. Rebasing is an exact change of frame | 3,000 random steps (3 seeds, up to ±3,000 levels, zooms of up to 60 levels at once): world centre, `zi`, `zf` and `pz` are bit-identical after every step |
| Rounding | `roundTo` now breaks ties **toward +∞** (it was away from zero). Away-from-zero depends on where zero is, so the same point measured from the origin and from a frame corner rounded differently: found by the side-by-side test at step 544 | `dyadic.test.ts`: rounding commutes with grid-aligned shifts |
| Object position, scale, local geometry | An object keeps today's anchor + `unit` + local geometry, only expressed in a frame; re-homing is exact | Re-homed anchors convert back to the absolute anchor bit for bit; `unit` identical |
| What is drawn and picked | Objects are re-expressed exactly into the camera frame and go through the unchanged projection, drawing and hit testing | Over 1,000 comparisons of stroke screen points from random viewpoints: within 10^-6 px; same visibility |
| Paint order, opacity, selection rules, undo | Unaffected: `z`, ids and transactions do not involve coordinates | — |
| Density preview, tiles, LOD | Same rules, evaluated in camera-frame coordinates (step 3) | To be tested in step 3 |

## 2. Items near a frame boundary

| Situation | Behaviour |
| --- | --- |
| **Placing** an object | It goes into the frame that suits its position and scale (`rehome`): extent between 2^-8 and 2^40 frame units, anchor within 2^33 units of the frame origin. These are the camera's bounds, so an object drawn at the camera's scale lands in or next to the camera's frame. Exact |
| An object **across a cell boundary** | It stays whole in one frame. Seen from the frame on either side, it is reached through their common parent with small numbers (one step up, one down), and drawn on the same pixels as before. Tested from both sides |
| The camera **rebasing while it is visible** | Nothing moves: re-expression is exact. Tested: 0 px drift zooming about a point across frame changes, 0 px error panning across them; a stroke point stays at exactly (500, 300) while zooming into it across a rebase |
| **Drawing** while the camera rebases (zoom or pan mid-stroke) | The stroke stays in the frame it started in; each new point is expressed into that frame. On release, it is re-homed |
| **Moving** an object across the boundary | Its anchor changes inside its own frame (exactly as `translate` does today), then it is re-homed if it left the bounds. Tested: same world position as the absolute move, bit for bit |
| **Resizing** by large factors | `unit` changes as today; a much larger object moves up to a coarser frame, a much smaller one down. Exact |
| Two **overlapping frames** for the same space (e.g. a compressed dive and a later step-by-step descent) | Allowed: both are exact coordinate systems; objects in either are re-expressed through their common ancestor. Canonical merging is optional storage tidiness, not correctness |

## Consequences

- Frame time no longer depends on depth (spike: 0.2 ms p95 from 2^1,000
  to 2^10^12; a 10^12-level jump in 3–8 ms).
- `roundTo` ties change in the main code too (sub-2^-96 differences in
  rare exact ties); no stored data changes.
- Open: coarse objects seen from far below still cost O(Δ); the carried
  near-edge set (plan §3) removes it in step 3.

## Debug tools (spike page, carried into the app in step 3)

| Tool | What it shows or does |
| --- | --- |
| HUD | Absolute zoom (BigInt), frame id and level, dive length, frame-local zoom and `pz`, rebase count, frames held, scene rebuild time |
| Frame overlay (`F`) | The camera frame's own cell (orange) and its child cells (blue) |
| Jump panel | ±1 frame, ±10^3, ±10^6, ±10^9, ±10^12 levels, Home |
| Hook `__spike` | `camera()` (frame-local), `absoluteCamera()` / `setAbsoluteCamera()` (old form, exact), `worldToScreen` (cheap path), `screenToWorld` (exact absolute), `objects()` with frames, `rebases()`, `bench()`, `strokePoint()` |
