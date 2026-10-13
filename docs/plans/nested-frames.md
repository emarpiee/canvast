# Plan — nested frames: constant cost at any depth

- Status: **approved**; steps 1–2 done, step 3 next (branch `exp/nested-frames`)
- Technical reference: [reference/nested-frames.md](../reference/nested-frames.md)
- Date: 2026-10-14
- Replaces: the storage form of positions decided in
  [ADR 0001](../adr/0001-exact-dyadic-world-coordinates.md). Exactness stays.
- Scope: this plan fixes one design flaw. The engineering plan
  (`endless_canvas-complete_engineering_plan-expanded-claude.md`) is
  unchanged and still governs everything else.

## 1. The flaw

Every position (camera centre, object anchors, index cells) is one absolute
exact number measured from the world origin. A position needs about one bit
per zoom level of depth, and every frame does arithmetic on the camera
centre. So **each frame gets slower the deeper you are**:

| Depth | Camera centre size | One pan (Chromium) |
| --- | --- | --- |
| 2^10,000 | 10K bits | 14 ms |
| 2^100,000 | 100K bits | 60 ms |
| 2^1,000,000 | 1M bits | 5.9 s (owner's hang) |
| 2^1,000,000,000,000, jumped to from the origin | — | never finished |

(Measured 2026-10-14 on v0.8.0, centre at an ordinary point after a pan;
`docs/testing/phase-1h.md` has the origin-jump case.)

The engineering plan rejects this outcome directly (§3): a design that
"appears limitless until a … precision threshold … is reached does not
pass the experience test", and it asks for "justified rebasing,
hierarchical scales, or another validated continuity mechanism". ADR 0001
rejected hierarchical frames as "equivalent expressiveness, more moving
parts". It compared what each design can represent, never what each costs
per frame at depth, and it was never measured beyond 2^5,000.

What was right and stays: positions are exact; zoom about the pointer
does not drift; no clamps, no finite world. What changes is the
**representation**: no number may grow with depth on the per-frame path.

## 2. Goal and acceptance criteria

The canvas must feel the same at every depth. Fixed before any run (the same
rule as `LIMITS`: never loosened to pass):

| # | Criterion | Threshold |
| --- | --- | --- |
| A1 | Frame time is independent of depth | p95 at 2^10, 2^1,000, 2^10^6, 2^10^9 and 2^10^12 within 20% of each other, and within the existing 8 ms render budget for an empty or sparse view |
| A2 | Jumps cost what they contain, not how far they go | Jumping 10^12 levels into empty space: under 100 ms |
| A3 | Rebasing is invisible | Content crossing a frame boundary moves by under 10^-6 px between consecutive frames (no jump, no flicker) |
| A4 | Existing exactness | All current navigation, deep-zoom, text and editing tests pass unchanged (anchor drift 0.01 px, round trip 0.01 px, exact edges) |
| A5 | Work at depth | Draw, select, move, resize, undo and type at 2^10^12, each input step under 100 ms |
| A6 | Lossless migration | Every stored object's absolute position, recomputed from its new form, equals the old one exactly |
| A7 | Memory follows content | A dive of 10^12 levels into empty space adds O(1) memory |

## 3. The model

### Frames

Space is nested squares called **frames**. A frame is a cell of a coarser
frame:

```
Frame { id, parent, step: K levels finer than parent (or a run of n·K, see below),
        cell: (i, j) small integers in the parent's grid }
```

- **K = 32** levels per frame step (to be tuned in the spike): one step is a
  2^32 subdivision, so typical offsets fit in a few hundred bits.
- Panning far at one scale moves to a **sibling** cell (i ± 1, …); the
  integers stay small because the camera rebases long before they grow.
- Zooming far out creates a **parent** on demand. There is no root edge.
- **Empty dives are runs.** A frame may stand for n steps straight down
  (always the same cell corner). Diving 10^12 levels into empty space is one
  frame record with n ≈ 3·10^10, not billions of records (A7).
- The absolute world position of a frame is still a well-defined exact
  number (the sum along its path). It is never computed on the frame path.
  It exists for migration, export of absolute coordinates and tests (A6).

### Camera

```
Camera { frame F, offset (x, y): exact dyadics in F's units, |x|,|y| ≤ 2^K,
         zoom: level relative to F (small double), depth: BigInt (frame level) }
```

- Pan and zoom-at-pointer use today's exact formulas, but on the small
  `offset`. The cost is constant.
- **Rebase down**, when one screen pixel becomes smaller than F's cell
  size: move to the child cell containing the view centre.
  `offset' = (offset − cell · 2^-K) · 2^K` is exact and small.
- **Rebase up / sideways** when the view outgrows F or the offset leaves
  ±2^K: the inverse step.
- **Return paths are kept.** Rebasing up does not forget the child frame,
  so zooming back in lands exactly where it left. This replaces today's
  4,096-level precision budget (`pz`) with a stack that costs nothing per
  frame.
- The zoom read-out shows `depth` as a BigInt, which lifts the
  10,000,000-level jump limit and the 2^53-level limit of a JS number.

### Objects

`anchor` becomes `(frame, offset)` with the same local geometry as today
(`unit` relative to the frame). A new object goes in the camera's frame,
which is where it is drawn anyway. Moving an object across a frame boundary
re-expresses its anchor in the target frame (exact, small).

### Seeing objects from other frames

| Relation to the camera frame | How it is drawn | Cost |
| --- | --- | --- |
| Same frame, siblings, a few steps up or down | Relative offset summed along the short path (small exact numbers), then today's projection | Constant |
| Much finer (deep descendants) | Density preview from ink summaries kept per frame and summed upward (ADR 0010, per frame) | Per frame visited |
| Much coarser (e.g. a stroke drawn at home, seen from 2^10^6) | **Carried with the camera**, below | Per crossing, per nearby edge |

**Carrying coarse geometry.** Seen from far below, a coarse object is in
one of three states relative to the view: it covers it, it misses it, or
one of its edges passes near it. Only edges near the view need numbers,
and an edge near the view, seen from far below, is a straight line to well
under 2^-40 px (the accuracy the renderer already guarantees).

- The camera keeps a small **near-edge set**: each edge as a line
  `n · p = c` in the camera frame's units, with `c` exact and small.
- On rebase down: `c' = (c − n · cell) · 2^K` is exact. If |c'| exceeds a
  bound, the edge has left the view for good at this depth and is dropped;
  the object's covers/misses state (its winding) is recorded instead.
- On rebase up, the set is rebuilt from the coarser frame, where the
  geometry is small again.
- Per-frame drawing uses only this set, so the cost depends on how many
  edges are near the view, never on the depth.

Hit testing uses the same set, as today: drawing and picking share one
projection.

**As built (step 3, slice 2).** Stroke edges are not small exact lines
(the offset side of a segment is `r · |U|`, irrational), so what was built
is a cover/miss test against a rounded camera centre, with the exact path
only for an edge near the view. See the reference, §7.3.

### Jumps

A jump (zoom read-out) descends along the view centre's own bits. Once
those bits are used up, every further step picks the same corner cell.
That is the "run" frame, created in one step. The near-edge set is updated
with the closed form `c · 2^(K·n)`: any edge with c ≠ 0 leaves at once, and
edges through the point stay. **The cost is the information present, not
the distance travelled (A2).**

### Spatial index

Cells are keyed by `(frame, level within frame, small i, j)` instead of
absolute BigInt cells, whose size grows with depth today. A query visits
the camera frame, its neighbours and a bounded number of steps up and down.
Everything coarser comes from the carried near-edge set; everything finer
comes from the per-frame ink summaries.

### What does not change

The dyadic module; exact stroke coverage, exact image pixel edges and exact
glyph outlines (they receive small relative inputs instead of absolute
ones); the tile cache, density preview, zoom preview, editing, text,
assets and history. Projection keeps its contract: one transform shared by
drawing and picking.

## 4. Storage and portability

| Item | Change |
| --- | --- |
| IndexedDB | Schema 3: a `frames` store; objects reference a frame. Migration from schema 2 converts each absolute anchor into frame + offset (deterministic, then verified against the absolute value, A6), with the same keep-old-data-until-verified rule as the v1 migration |
| Archives | `.canvast` version 2 includes frames. Version 1 archives still import (converted on import) |
| Saved views | The camera saves frame + offset + zoom + depth |
| Frame GC | Frames with no objects, no saved view and no children are collected |

## 5. Steps

| Step | Deliverable | Gate |
| --- | --- | --- |
| 1. Spike | Camera in frames with rebasing, grid, landmarks and strokes (no storage), behind a debug flag | A1, A2, A3 measured at all five depths in Chromium and Firefox. **Stop and report if they fail** |
| 2. ADR 0014 | "Nested frames", superseding ADR 0001's representation, with the spike numbers | Owner approval |
| 3. Core | Camera, projection, spatial index, near-edge set, objects (strokes, images, text) | A4 and A5; all existing tests |
| 4. Storage | Schema 3, migration, archive v2, v1 import | A6; storage and archive tests |
| 5. Depth suite | New E2E: depth sweep (A1), giant jumps (A2), rebase continuity (A3), work at 2^10^12 (A5), memory after a dive (A7) | All four projects |
| 6. Merge | Full suite (end of a phase), docs, version bump | Owner decides on merging into `main` |

Work happens on `exp/nested-frames`; `main` keeps v0.8.0 until step 6.

## 6. Risks and open questions

- **Near-edge set at frame boundaries:** curves are not lines until enough
  levels below their scale. Coarse objects only a few steps up are drawn
  through the short path instead of the set, so the set only holds edges
  seen from far below. The cut-over depth needs measuring.
- **Huge objects with many edges near the view** (dense coarse drawings
  seen from just below): the set can be large. It is bounded by what is
  visible, as drawing is today.
- **Text and images seen from far below** reduce to their edges and pixel
  edges in the same way. The exact glyph path already works with relative
  inputs.
- **K choice:** smaller K means more frequent, cheaper rebases. To measure.
- **Moves across many frames** (dragging an object from home into a deep
  frame): re-expressing the anchor costs the path length, once per edit,
  not per frame.
- **Multi-tab and history:** frames are document data, so they go through
  the same transactions and leases as objects.

## 7. Spike results (step 1, 2026-10-14)

Code: `src/spike/` (frames, camera, rebasing, compressed dives, a page that
draws grid, landmarks and strokes through the **unchanged** renderer in the
camera frame's own coordinates). Build: `node scripts/build-spike.mjs` →
`dist-spike/frames.html` (separate from `dist/`). Measure:
`node scripts/spike-measure.mjs`. Each row: pan to an ordinary spot, draw a
stroke at home, jump, draw 3 strokes there; then 240 pan+zoom frames, 400
zoom-in frames (+0.25 levels each, crossing frames), 100 levels of zoom
about a stroke vertex, and 100 pans of 37 px.

| Depth | Jump ms (A2) | Pan+zoom frame p50/p95 ms | Zoom-in p50/p95 ms (crossings) | Drift at the zoom point (A3) | Pan error (A3) |
| --- | --- | --- | --- | --- | --- |
| Chromium 2^10 | 1.7 | 0.4/0.6 | 0.6/0.9 (3) | 0 px | 0 px |
| Chromium 2^1,000 | 2.5 | 0.1/0.2 | 0.1/0.2 (3) | 0 | 0 |
| Chromium 2^1,000,000 | 2.5 | 0.1/0.2 | 0.1/0.2 (2) | 0 | 0 |
| Chromium 2^10^9 | 7 | 0.1/0.2 | 0.1/0.2 (2) | 0 | 0 |
| Chromium 2^10^12 | 3.4 | 0.1/0.2 | 0.1/0.2 (2) | 0 | 0 |
| Firefox 2^10 | 8 | 1/2 | 1/2 (3) | 0 | 0 |
| Firefox 2^1,000 … 2^10^12 | 3–4 | 1/1–2 | 1/1–2 (2–3) | 0 | 0 |

(Firefox times are whole ms on `file://`.) The deep strokes were drawn and
inked at every depth. For comparison, v0.8.0 needs 5.9 s per pan at
2^1,000,000 and never finishes at 2^10^12.

**Gate:**
- **A2 passes:** a 10^12-level jump takes 3–8 ms (limit 100 ms).
- **A3 passes:** zooming about a point across frame crossings and panning
  across rebases move content by exactly 0 px.
- **A1 passes in substance, not to the letter.** All deep rows are equal
  (0.2 ms p95 in Chromium, 1–2 ms in Firefox), far under the 8 ms budget.
  The 2^10 row is slower (0.6 ms) because the home stroke and the home
  landmarks are on screen there: more content, not more depth. The "within
  20%" wording should compare equal content; the criterion stays as
  written, and this is reported rather than adjusted.

**Open risk confirmed: coarse objects seen from far below.** A stroke drawn
at home, with the view inside it, Δ levels below (Chromium, frame p50/p95):

| Δ | 100 | 1,000 | 10,000 | 100,000 | 1,000,000 | 10,000,000 |
| --- | --- | --- | --- | --- | --- | --- |
| ms | 0.9/1.7 | 0.1/0.4 | 0.2/0.3 | 0.4/0.7 | 2.8/4.0 | 26.3/30.2 |

The spike draws such objects by today's exact projection with an anchor of
Δ bits, so the cost is linear in Δ. That is about 2,000× faster than v0.8.0
at 2^1,000,000, but **not constant**: it would be ~260 ms at Δ = 10^8. The
carried near-edge set (§3) is what removes it. Step 3 must implement it
and add Δ = 10^8 and 10^12 to this table.

Not in the spike: storage, the spatial index (the spike scans all strokes),
images, text, selection, density preview of finer frames, return paths
beyond the 4,096-bit budget.
