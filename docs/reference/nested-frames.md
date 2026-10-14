# Nested frames: technical reference

- Decision: [ADR 0014](../adr/0014-nested-frames.md) (accepted 2026-10-14)
- Plan and measurements: [plans/nested-frames.md](../plans/nested-frames.md)
- Code: `src/core/frames.ts`; spike page: `src/spike/main.ts`; tests: `tests/unit/frames.test.ts`; browser gate:
  `scripts/spike-measure.mjs`

This document is self-contained. It describes how canvast represents
positions on an unbounded canvas so that **the cost of every per-frame
operation is independent of zoom depth**, while every result stays
**exactly** equal to that of a single absolute coordinate system. It gives
the model, the formulas, the algorithms with their invariants and error
bounds, the known limits, and how each claim is verified.

## 1. Problem

An endless canvas allows unbounded zoom. If every position is one absolute
exact number, a position at magnification 2^d needs about d bits, and every
pan or zoom does arithmetic on the camera position. Frame time then grows
linearly with depth: measured on v0.8.0, one pan takes 14 ms at 2^10,000,
5.9 s at 2^1,000,000, and never finishes at 2^10^12.

Floating point is not a remedy: it loses exactness (zoom about a point
drifts, round trips do not return). The requirement is both:

1. **Exactness**: every operation gives the same exact result as the
   absolute system (bit for bit for the camera and object positions).
2. **Constant cost**: numbers touched per frame stay small at any depth.

## 2. Notation

| Symbol | Meaning | Value |
| --- | --- | --- |
| Dyadic | Exact number `m · 2^e`, `m` a BigInt, `e` an integer; normalised (odd `m`) | `src/core/dyadic.ts` |
| level | One zoom level is a factor of 2 | — |
| `K` | Levels per frame step: a child frame's unit is `2^-K` of its parent's | 32 |
| `H` | Rebase hysteresis, in levels | 8 |
| `n` | Steps between a frame and its parent (n > 1: a compressed dive) | ≥ 1, BigInt |
| `z` | Camera zoom relative to its frame: CSS px per frame unit = `2^z` | double |
| `pz` | Camera precision depth (as `Camera.pz` in `src/core/camera.ts`), in frame-local levels | integer |
| `FAR_LOG2` | Beyond `2^FAR_LOG2` frame units a point is off screen for good at this depth | 80 |
| `DRAW_BITS` | Precision of the drawing path, in bits below the camera frame's unit | `2K + 128` = 192 |
| `GAP` | Minimum bit gap between terms of a term sum (§7.2) | 64 |
| `MAX_FRAME_JUMP` | Largest single jump, in levels | 2^50 |
| `CENTER_GUARD_BITS`, `PRECISION_BUDGET`, `ZOOM_QUANTUM` | Unchanged camera constants from `core/camera.ts` | 96, 4096, 2^-20 |

`log2|a|` means `D.log2Abs(a)`; `a.e` is the exponent of the lowest set
bit of a normalised dyadic.

## 3. Frames

### 3.1 Definition

A **frame** is a coordinate system. Each frame except the root has a parent
and relates to it by

```
parentPoint = o + childPoint · 2^(−K·n)                                  (1)
```

where `o = (ox, oy)` is a small exact offset (in practice a pair of
integers: the child's cell corner in the parent's grid) and `n ≥ 1` is the
number of K-level steps.

A frame is **not a container**: it clips nothing and owns nothing. Geometry
expressed in a frame may extend past its cell. Two frames may describe
overlapping space; both are exact.

### 3.2 Absolute position

For a frame path `root = F0 → F1 → … → Fk` and a point `p` in `Fk`:

```
abs(p) = o1 + 2^(−K·n1) · (o2 + 2^(−K·n2) · ( … (ok + 2^(−K·nk) · p)))  (2)
```

This is the value the old absolute system stores. It is computed only for
migration, export, debugging and tests (`expressExactIn`,
`toAbsoluteCamera`), never on the per-frame path: its size is about the
depth in bits.

### 3.3 Frame level

`level(F)` is a BigInt: the number of K-steps below the frame the world was
originally defined in (negative above it). Absolute zoom level of the
camera = `level(F) · K + floor(z)` (`depthOf`). Because it is a BigInt,
total depth is unbounded.

### 3.4 Growth of the tree

| Event | Effect |
| --- | --- |
| Zoom far in | A child frame for the cell under the view: `child(F, 1, i, j)` |
| Zoom in (or load a point) where a run of levels has empty cells (offset 0) | A **compressed dive**: one child with `n = run + 1` steps instead of that many frames (memory O(1) for any dive into empty space; §5.4) |
| Zoom far out above the root | A new root: one record whose child step `n` is the whole climb |
| Climb `k` steps out of a dive of `n > k` steps | **Split once**: see 3.5 |

### 3.5 Splitting a dive exactly

A frame `f` with step `n` and offset `o` in parent `P` is replaced by
`mid = child(P, n − k, o)` and `f` with step `k`, offset 0, in `mid`.
Substituting:

```
P = o + m · 2^(−K(n−k)),  m = 0 + c · 2^(−K·k)
  ⇒ P = o + c · 2^(−K·n)                                                 (3)
```

identical to (1). **Rule:** a split happens once, with the number of steps
actually needed. Splitting one step at a time costs one loop per step
(3·10^10 loops for a 10^12-level dive): this was a hang found in testing.
**Read-only walks never split** (§7).

## 4. Rounding

`roundTo(a, q)` rounds a dyadic to a multiple of `2^q`, with ties broken
**toward +∞**: `round(a) = floor(a / 2^q + 1/2) · 2^q`.

Why not away from zero: the camera's centre is rounded in the old system
measured from the world origin, and in the new system measured from a frame
corner. For a shift `s` that is a multiple of `2^q` (every frame corner is),
ties toward +∞ satisfy

```
roundTo(a + s, q) = roundTo(a, q) + s                                    (4)
```

Away-from-zero breaks (4) when `a` and `a + s` have different signs, so the
two systems would round the same point differently. (Found by the
side-by-side test at step 544.) Change in the main code: sub-2^-96
differences in rare exact ties; no stored data changes.

## 5. Camera

### 5.1 State

```
FrameCamera { f: Frame, x, y: Dyadic (in f's units), z: number, pz: number }
```

Invariant after every operation (`normalize`):

```
−H ≤ z ≤ K + H        |x|, |y| ≤ 2^(K+1)                                 (5)
```

So the camera's numbers have bounded size at any depth. Pan and zoom run the
**unchanged** formulas of `core/camera.ts` on `{center: (x, y), zi, zf, pz}`,
then `normalize` rebases.

### 5.2 Rebasing (`normalize`)

Repeat until (5) holds:

- **Up** (`z < −H` or `|x|,|y| > 2^(K+1)`): climb `want` steps at once,
  `want = 1` if the position is too large, else `ceil((−H − z) / K)`.
  At the root, create one parent with step `want`. Inside a dive with
  `n > want`, split once (3.5). Then, with the parent step `n`:
  ```
  x' = ox + x · 2^(−K·n),  z' = z + K·n,  pz' = pz + K·n                  (6)
  ```
  A term `x · 2^(−K·n)` below `2^(q−2)` with `q = −(pz + K·n + 96)` is
  dropped: the old system's rounding at `2^q` removes it anyway, and
  keeping it would build a number as long as the climb.
- **Down** (`z > K + H`): descend `s = floor((z − K − H) / K) + 1` steps.
  One step is, with **balanced digits** (`i` = nearest integer, ties
  toward +∞):
  ```
  x' = (x − i) · 2^K,  z' = z − K,  pz' = pz − K,  frame = child(f,1,i,j) (7)
  ```
  so offsets lie in [−2^(K−1), 2^(K−1)) and the remainder in [−½, ½) of
  a cell. All `s` steps are taken at once by `descend` (§5.4).

(6) and (7) are exact changes of frame: the absolute position (2), the
absolute zoom and the precision depth do not change, so **nothing moves on
screen** when the camera rebases.

### 5.3 Jumps (`fjump`)

A jump by `L` levels about the screen centre (the zoom read-out):

1. `|L| ≤ MAX_FRAME_JUMP` (2^50) or `RangeError`. Zoom counts are doubles;
   beyond 2^50 a jump would be off by whole levels (measured: 32 levels off
   at 10^18). Depth itself has no limit: jump repeatedly.
2. `L` is quantised to `ZOOM_QUANTUM`; `z += L`;
   `pz = clamp(pz, floor(z), floor(z) + PRECISION_BUDGET)` (as
   `core/camera.ts`).
3. `normalize` (creates at most a few frames: dives are compressed).
4. Round the centre to `2^−(pz + CENTER_GUARD_BITS)`, *after* rebasing, so
   no number grows with `L`.

Result: the same camera as the old `zoomAt` about the centre, at a cost of a
few small operations for any `L`.

### 5.4 Descending many steps at once (`descend`)

Used by camera rebasing, jumps, loading a camera, and re-homing objects.

- **Digits, not steps.** Below the first cell, the cell offsets of a point
  are its base-2^K digits. They come from one integer
  `F = round(f · 2^(K·r))` (f the fraction after the first cell, r the
  number of digit levels the point's bits reach), read as balanced digits
  from one hex string: add 2^(K−1) to every digit, read unsigned, subtract.
  Cost is linear in the point's bits. Taking the steps one at a time
  instead redoes arithmetic on the whole number per step: quadratic, about
  half an hour for a point with 10^7 significant bits (a v0.8 position at
  2^10,000,000).
- **Runs of empty cells are compressed dives.** Each non-zero cell takes the
  zero cells after it as one frame `child(g, run + 1, cell)`. Exact by (3).
- **Why balanced digits.** With floor digits, a point just below a corner
  reads 0.FFFF… at every level and nothing compresses (312,500 frames for
  a point 2^-10^7 from a corner). Balanced, it reads 0, 0, …, then its few
  significant digits: 3 frames.
- **No big temporaries.** Rounding `m · 2^−s` uses
  `((m >> (s−1)) + 1) >> 1` (`D.roundShift`), which equals
  `floor(v + ½)` but never builds `2^(s−1)`. Adding ½ first creates an
  s-bit number for a moment: fine in Chrome, but **Firefox caps BigInts at
  about 2^20 bits** and throws, which made Firefox fail to open a
  workspace with v0.8 data from 2^10,000,000.

## 6. Objects

An object keeps its existing form (anchor + `unit` + local geometry); the
anchor is expressed in a frame. **Re-homing** (`rehome`) moves it to the
frame that suits its size and position, exactly (by (6) and (7) without
dropping anything):

```
2^−H ≤ extent in frame units ≤ 2^(K+H)      |anchor| ≤ 2^(K+1)          (8)
```

These are the camera's bounds, so an object drawn at the camera's scale
lands in or next to the camera's frame.

| Situation | Rule |
| --- | --- |
| Placing | Re-home into the frame satisfying (8) |
| Across a cell boundary | Stays whole in one frame; reached from either side through the common parent |
| Drawing while the camera rebases | Points stay in the frame the stroke started in; re-homed on release |
| Moving | Anchor changes in its own frame (exactly as `translate`), then re-homed if (8) fails |
| Resizing by large factors | `unit` changes as today; re-homed up or down |
| Paint order, opacity, selection, undo | Unaffected: no coordinates involved |

## 7. Expressing a point in another frame

To draw an object of frame `g` from a camera in frame `f`, its anchor must
be expressed in `f`. Walk from `g` up to the common ancestor `A`, then down
the camera's path to `f`, applying (1) upward and its inverse downward:

```
up:   x ← o + x · 2^(−K·n)          down: x ← (x − o) · 2^(K·n)          (9)
```

Walks only **read** parent links; they never create or split frames.

### 7.1 Exact form (`expressExactIn`)

Applies (9) with exact dyadics, written as one sum (2): the offsets on the
way up and (negated) on the way down, each scaled to the common ancestor,
plus the point. The sum is **balanced** (neighbours by scale added
pairwise): O(bits · log steps), where adding one by one is quadratic. The
result can be as long as the depth in bits (a point a small distance from
a corner 2^10^12 levels up needs a 10^12-bit number), so it is used only
for debugging, tests and archives of version 1.

**Walks never go above the nearest common ancestor** (`route`, using frame
levels): their cost is the distance between the two frames, not the depth
of either. Building the whole path from the root on every call cost
312,500 steps per view change for a deep position.

### 7.2 Drawing form (`expressIn`): term sums

The position is held as a **term sum**: a list of small dyadics
`t0, t1, …`, coarse to fine, with the invariant

```
log2|t(k+1)| < t(k).e − GAP                                              (10)
```

(each term lies entirely below the lowest bit of the previous one, by at
least GAP bits). Then the sum equals its leading term to a relative error
below `2^(1−GAP)`:

```
|Σ t| ∈ |t0| · (1 ± 2^(1−GAP))                                           (11)
```

Operations, each touching only the coarse end:

| Operation | Implementation |
| --- | --- |
| Add `c` (an offset) | Prepend `c`; while `t1` overlaps `t0` by (10), or `t0 = 0`, merge `t0 ← t0 + t1`. Merged terms have bounded span, so additions stay small |
| Scale by `2^s` | Shift every term's exponent (free) |
| Drop the fine end | Remove trailing terms with `log2|t| < q − 2` |
| Far test | `log2|t0| > FAR_LOG2 + 1` ⇒ by (11), `|x| > 2^FAR_LOG2` |
| Result | Sum the remaining terms (all within ~`FAR_LOG2 + DRAW_BITS` bits) |

The drop quantum at frame `a` is `q(a) = −(DRAW_BITS + levels(a → f))`:
`2^−DRAW_BITS` of the target frame's unit, expressed in `a`'s units.

**Far is permanent.** On the way down, if `|x| > 2^80` while offsets are at
most `2^(K+1)`, then `|x − o| · 2^(K·n)` is larger still: once far, a point
stays far at every deeper frame on the path, so returning `null` is safe.

**Error bound.** Each drop removes less than `2^(q−1)` in that frame's
units, i.e. less than `2^(−DRAW_BITS−1)` in `f`'s units. Over a path of
`L` frames the error is below `L · 2^−193`; for any path shorter than 2^40
frames it is below `2^−150` frame units. At the deepest zoom inside a frame
(`z ≤ K + H = 40`), that is below `2^−110` px. Stored positions and edits
never pass through this path; they stay exact.

**Cost.** One small operation per frame on the path; independent of depth
in bits.

### 7.3 Coarse objects seen from far below

An object much coarser than the camera (e.g. a stroke drawn at home seen
from Δ levels below with the view inside it) is far by its anchor but may
still cover the view. Seen from far below, such an object is in one of
three states: it **covers** the view, it **misses** it, or an **edge is
near** the view. Built (`render/coarse.ts`, `scene/frame-index.ts`):

1. The camera centre is expressed in the object's frame to 2^-256 of that
   frame's unit (`COARSE_ROUND_BITS`; the term walk of §7.2, so the cost is
   the path length, not Δ). The rounding error is below 2^-208 frame units.
2. `classifyCoarse` hands the rounded centre to the **sampler of the object's
   kind** (`SAMPLERS` in `render/coarse.ts`, typed over every kind: a new kind
   does not compile without one; `bboxSampler` is the one-line default). A
   sampler decides from the distance to the outline, which must exceed the
   rounding error plus the view's size plus double rounding, so that every
   point of the view is on the same side: *covers* (one colour, or image
   pixels) or *misses* (skipped). Stroke: distance to the polyline minus the
   radius. Text: nonzero winding of the glyph outlines (curves flattened)
   with the flattening error added to the margin. Image: inside a source
   pixel (one rectangle), or, when a pixel boundary or the image edge is
   within the view, the boundaries are placed from **exact term sums** of the
   camera centre (`expressTermsIn`, `termsAdd`, …: `j·size − centre·count` is
   computed without ever forming a depth-sized number), giving up to nine
   rectangles that meet where the boundaries cross: a camera exactly on a
   pixel corner keeps its four pixels at any depth (tested to 10^15 levels).
3. Otherwise an edge is near and the sampler cannot place it (a stroke or glyph
   outline within the view; a kind with no summary): the exact centre is built
   (`cameraIn`) and the ordinary exact path draws it. That costs O(Δ) bits,
   so it is limited to `COARSE_EXACT_MAX` (100,000 levels); past it the
   object is not drawn (marked shortcut).

The classification is applied from `COARSE_ROUND_MIN` (4,096 levels) down;
nearer frames use the exact path as before, and the two agree (tested at
5,000 levels against the exact stroke coverage).

**Why not carried lines.** The plan (§3) kept each near edge as a line
`n · p = c` with a small exact `c`, updated by `c' = (c − n · cell) · 2^K`.
That is exact for edges at dyadic positions (image sides), but a stroke's
side line is at distance `r` from the segment, i.e. `perp = r · |U|` with
`|U|` a square root: irrational. Carrying it needs the square root's digits
as deep as the camera has followed the edge, which is O(Δ) bits again, and
more bits than Firefox allows past 2^20. The cover/miss test above needs no
carried state at all: the cost depends on how close the camera is to the
outline, not on Δ. What stays costly is a camera that follows an edge
(within a view-size of it) for more than 100,000 levels.

## 8. In the app (step 3)

| Piece | Where | How |
| --- | --- | --- |
| Camera | `app/view-state.ts` | Holds a `FrameCamera`. `view.camera` is the ordinary camera in the coordinates of `view.frame`, so pan and zoom code is unchanged; `setCamera` rebases. Zoom changes beyond one step (K levels) go through `fjump`. `worldCamera()` / `setWorldCamera()` convert exactly to and from the absolute form |
| Objects | `doc/model.ts` | Optional `frame` (absent = world frame). `homeObject` re-homes exactly (6); `worldForm` gives the absolute form; `expressObjectIn` compares objects of different frames |
| Document | `doc/document-store.ts` | Owns the `FrameSpace`; `load` re-homes every object. Edits re-home before the transaction is built, so undo compares the same object states |
| Index | `scene/frame-index.ts` | One `SpatialIndex` per frame, in that frame's own coordinates, so index cells stay small integers |
| Drawing and picking | `cameraIn(fc, g)` | Instead of converting objects, the **camera** is expressed in each frame with content and that frame's objects go through the unchanged index query, projection, tile cache and density preview. Finer or nearby frames (L ≤ 0 levels coarser): g's origin found in the camera frame with `DRAW_BITS − L` bits, then `centre_g = (centre_f − origin) · 2^(−L)`. Coarser frames (L > 0): the camera centre carried up with `DRAW_BITS + L` bits. Frames more than 4,096 levels coarser use the rounded centre and the cover/miss test of §7.3 instead (`FrameView.coarse`): no limit on the level gap, except for an edge near the view (100,000). Frames more than 100,000 levels finer are dots |
| Far-finer frames | `FrameIndex.dots` | A frame whose whole content is below a pixel (`z + L + K + H + 2 < log2(MIN_CELL_PX) − 8`) is not queried in its own units: there the camera centre would be a number of ~|L| bits (a hang found by the zoom-out tests). It is drawn as **one density dot** at its origin's screen position, with the index's running ink total (`SpatialIndex.total`, area × 4^level). Cost: one cheap walk per frame |
| Gestures | `interaction/tools.ts`, `app/editor-state.ts` | A draft stroke, a move's start point and a resize's fixed point stay in the frame where the gesture began; points arriving after a rebase are converted exactly. Previews convert a displacement by an exact shift, `d_g = d_f · 2^(−levels(g→f))`, and a fixed point by `expressExactIn` |
| Backdrop | `worldBackdrop` | The world axes (each coordinate separately) and landmarks re-expressed in the camera frame once per frame change. The grid needs nothing: its spacing (≤ 2^22 frame units) divides every frame corner (a multiple of 2^32) |
| Storage | `serializeObject`, `CanvasPersistence`, `WorkspaceRepo`, `archive.ts` | Frame form, §8a. No absolute numbers on the save or load path |
| Debug hook | `app/debug-hook.ts` | Same absolute interface for the tests, plus `jump`, `depth` and `objectFrames` |

## 8a. Storage (step 4)

IndexedDB schema 4 adds a store `frames` (key `[canvasId, id]`). Nothing
else changes: the stores, revisions, leases and the one-transaction commit
are as before.

| Item | Stored form |
| --- | --- |
| Frame | `{ id, parent, n, ox, oy, level }`, numbers as strings; ids are random 96-bit hex, the world frame is `"world"`; the record of a frame carries its link to its parent, so a split dive or a new root rewrites that record |
| Object | The v0.8 record plus `frame` (a frame id). `ax`, `ay`, `unit` are local to that frame. No `frame` means the world frame, which is the v0.8 absolute form: **old data needs no conversion** and is re-homed exactly when loaded |
| Saved view | `{ v: 2, frame, x, y, z, pz }` (small local numbers). A view without `v` is the old absolute camera |
| Commit | Frame records that changed (by signature) go in the same transaction as the objects, with the closure of the objects' frames (their ancestors, and the world frame's chain, so the stored tree always reaches the root) |
| Load | `FrameSpace.restore` builds the tree from the records (checks ids, links, levels, one root, no cycles; nothing is built if any check fails), then objects are read in it. An object naming a frame that is missing is skipped and reported, never placed at the origin |
| Archive v2 | `canvases/<id>.json` = `{ objects, frames, view }`. Version 1 archives (absolute positions, no `frames`) import unchanged and are re-homed on load. A version 1 reader refuses version 2 as newer |
| Clean-up | `saveCamera` drops stored frames that no object, the view or the world chain needs, in the same transaction as the new view |

The cost of a save is the length of the frame path, not the depth in bits,
and no number on this path is longer than a frame-local one, so it works in
Firefox at any depth.

## 8b. Thickness lock

Design decision (owner, 2026-10-14): the lock means *the same width on the canvas*, so a new stroke matches the artwork at any zoom; without it the pen keeps its size on screen. An earlier version that fixed a stroke's width on screen was removed.

A pen mode, not a stroke property: strokes are stored as before and always
scale with the canvas. Without the lock a new stroke gets the chosen pen size
in px at the current zoom (the same screen width at any depth). With the lock
(toolbar lock button) the pen has the size it had when the lock was set,
scaled by the zoom since (`interaction/pen-width.ts`), so a new stroke has
the same width on the canvas as the earlier ones and matches the artwork.
Choosing another pen size while locked makes it the new reference. The
reference is a BigInt zoom level plus a fraction, so it works at any depth.
The size follows the zoom for 1,000 levels either way and then holds (a
double cannot hold more, and a brush that wide or thin looks the same). Pen
sizes: three presets and a slider (0.5–128 px, log scale). The lock is not
saved with the canvas. On the Select tool the same padlock means *keep line
width when resizing*: a resize scales a stroke's shape (`scaleAbout`, `keepWidth`)
but not its width.

**Stabilizer** (`interaction/stabilizer.ts`): a lazy rope of 0.6–60 screen px; the
brush tip follows the pointer on it, so wobble inside the rope never reaches
the stroke, at any zoom. **Pen size follows zoom**: while drawing, once the
width the pen should have differs by a quarter level from the current piece's,
the piece ends and the line continues as a new stroke from its last point
(committed together: one undo step).

## 8c. Select option and debug tools

**Ignore the object that fills the view** (Select tool bar, `EditorState.ignoreFilling`):
clicking, lasso and box select skip an object the view is inside of: a coarse
object classified as covering the view (`cover`), or one whose body is under
the view centre and all four corners (`fillsView` in `interaction/tools.ts`).
A stroke that is only a band across the screen stays selectable. Off by default.

**Debug (`#debug` or `canvast-debug.html`).** The dev panel has jump buttons
(±10 to ±10^12), auto-zoom (keeps running while drawing; stops with its
button, the wheel or Escape) and **Clear** (one undoable transaction). The
debug hook (`window.__canvastDebug`, `app/debug-hook.ts`) adds, for tests:
`coarseState(id)` (cover, miss, exact or near), `storedObjects()` (frame
form, works at any depth; `objects()` is the absolute form and throws beyond
2^24 levels), `storedFrameCount()` and `collectFrames()`.

## 9. Complexity

| Operation | Cost | Independent of depth |
| --- | --- | --- |
| Pan, zoom about a point | Constant-size arithmetic + at most a few rebases | Yes |
| Jump of any size ≤ 2^50 | A few rebases; O(1) frames created | Yes |
| Express a point (drawing) | O(path length) small operations | Yes |
| Scene rebuild | On frame change only, O(objects considered) | Yes |
| Coarse object covering or missing the view, Δ levels below | O(path length) small operations (256-bit centre) | Yes |
| Coarse object with an edge near the view | O(Δ) bits, limited to 100,000 levels | No (shortcut) |
| Exact absolute conversion | O(depth) bits | No, by design; never per frame |

## 10. Limits

| Limit | Value | Reason |
| --- | --- | --- |
| Total depth | Unbounded | Frame levels are BigInt |
| One jump | 2^50 levels | Double zoom counts |
| Long wheel zooms | One frame per 32 levels on the path (0.6 ms walk at 10^5 levels) | If it matters: merge chains of empty frames into a dive |
| Frame memory | Frames are not yet freed (≈1,300 after 2,500 random steps) | Step 3 frees unreferenced frames |
| Coarse object whose edge stays near the view, from > 100,000 levels below | Not drawn (the camera followed its edge that far) | §7.3 |
| Coarse text with the centre within 0.4% of an em of a glyph outline, from > 100,000 levels below | Not drawn (the camera followed the outline that far) | §7.3 |
| Landmarks much coarser than the camera, edge crossing the view | Not drawn | Landmark edges are not summarised |
| Content far finer than a pixel | One dot per frame (position and mean colour; no per-cell detail) | Per-frame ink summaries if finer detail is wanted |
| Unreferenced frame records | Collected with the saved view after 200 frames were written (and when idle) | Frames nothing refers to stay stored until then |
| Firefox BigInt limit | About 2^20 bits per number; every per-frame path stays far below it | Keep it that way: no temporaries of ~depth bits |
| Frames with content | Every one is visited per view change (cheap walks) | Cull by the frame tree when documents hold thousands of frames |

## 11. Verification

| Claim | Evidence | Where |
| --- | --- | --- |
| Storage | Objects at 10^12 levels and above the world, a camera-made object 4·10^12 levels out, and a view saved at 5·10^12 levels: records round-trip through JSON to the same tree (identity of every object's frame path); damaged records (missing parent, cycle, duplicate, bad level, bad number, two roots) are rejected with nothing built; E2E: work at 2^10^12 and 5·10^14 saves, reloads at the same view and travels in an archive to another profile; a version 1 archive imports | `frame-storage.test.ts`, `frames.spec.ts`, `archive.spec.ts` |
| Camera identical to the absolute system | 3,000 random pan/zoom/jump steps, 3 seeds, up to ±3,000 levels: centre, `zi`, `zf`, `pz` bit-identical after every step | `frames.test.ts` |
| Drawing identical | > 1,000 stroke screen points from random viewpoints within 10^-6 px; same visibility | `frames.test.ts` |
| Drawing form matches exact form | > 1,000 random comparisons within 2^-150 frame units | `frames.test.ts` |
| Boundary rules | Object across a cell boundary from both sides; move across it bit-identical to the absolute move | `frames.test.ts` |
| Depth stress | 10^18 levels by 1,000 jumps of 10^15, exact both ways; 2^51 jump rejected; wheel zoom through 10^5 levels in and out | `frames.test.ts` |
| Regressions found by testing | Climbing part of a dive; walks splitting dives; mixed-scale numbers after zooming into a neighbouring cell from 5·10^12 levels up | `frames.test.ts` (one test each) |
| Constant frame time | p95 0.2 ms (Chromium), 1–3 ms (Firefox) from 2^10 to 2^10^12; jump 10^12 levels in 3–10 ms; 0 px drift and pan error | `spike-measure.mjs` |
| Coarse objects | 5,000 levels down at 150 random places vs the exact stroke coverage (covers and misses agree on 5 view points); a camera a hair from an edge (2^-10 to 2^-400) is never decided wrongly and is "exact" below 2^-60; random zooms of 1e3–1e12 levels both ways with pans, 250 ms a step; E2E: a stroke covers the view at 5e3, 1e5, 1e6, 1e9, 1e12 levels through wheel, keys, drag, picking and back, and one level at a time across the 4,096 cut-over, in 4 projects | `coarse.test.ts`, `frames.spec.ts` |
| No hangs | Fuzz: 3 seeds × 2,500 random jumps, Home, pans, zooms, strokes, both browsers; no step over 250 ms | `spike-measure.mjs` |

Run: `npx vitest run tests/unit/frames.test.ts`;
`node scripts/build-spike.mjs && node scripts/spike-measure.mjs`.

## 12. Lessons (pitfalls to avoid in any implementation)

1. **Never materialise a mixed-scale sum.** `offset + tiny` where the two
   are 10^9 levels apart is a 10^9-bit number. Keep term sums (§7.2), or
   drop what cannot matter, with a stated bound.
2. **Reads must not restructure.** A walk that splits a dive on the way
   costs one loop per step of the dive.
3. **Split by the amount needed, once.**
4. **Test zooming out as hard as zooming in**, starting from Home and from
   deep, and with content on screen; fuzz random sequences with a per-step
   time limit. The first gate only zoomed in and missed three hangs.
5. **Rounding must commute with grid-aligned shifts** (4), or two exact
   systems disagree on ties.
6. **Never step one level at a time through a long number.** Read all the
   digits at once (§5.4); sum many offsets in a balanced tree (§7.1).
7. **Use balanced digits** so runs of empty levels compress whichever side
   of a corner a point is on.
8. **Firefox caps BigInts at ~2^20 bits.** Code that works in Chrome can
   throw in Firefox; never build a temporary as long as the depth, even
   briefly. Test deep data in Firefox, including reloads.

## 13. Glossary

| Term | Meaning |
| --- | --- |
| Frame | A coordinate system nested in a parent by (1) |
| Compressed dive | One frame standing for many K-steps into a cell corner |
| Rebase | Re-expressing the camera in another frame, exactly |
| Re-home | Re-expressing an object in the frame that suits it, exactly |
| Term sum | A number kept as separated small terms (§7.2) |
| Far | Farther than 2^80 frame units: off screen for good at this depth |
| Cover / miss | A coarse object whose outline is farther from the rounded centre than the error and the view: the whole view is inside it or outside it (§7.3) |
