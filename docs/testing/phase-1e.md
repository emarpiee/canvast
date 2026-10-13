# Phase 1, slice 5 test log — density preview

## Environment

Same as earlier phases: four E2E projects (`chromium`, `chromium-cpu`,
`chromium-dpr2`, `firefox`).

## Unit tests (`tests/unit/spatial-index.test.ts`, 4 new)

| Test | Assertions |
| --- | --- |
| Ink conservation | 400 random strokes. At 12, 16, 24 and 40 levels out, the preview's squares carry the strokes' total covered area (Σ cover × size² × 4^levels = Σ ink, to 6 decimals). Every square is at most 2 px. |
| Exact removal | Insert 2,000 random objects at mixed scales, then remove all: no ink and no squares remain. |
| Only sub-pixel content | A stroke drawn individually at home gives no squares; 20 levels out it does. |
| Far and tiny | A stroke at scale 2^-80, about 10^9 units from the origin, gives one square at its true screen position (±1e-6 px). |

The existing brute-force index tests ("no false negatives" and "index equals
the exact projection, in paint order") caught a design error; see Defects.

## End-to-end tests (`tests/e2e/density.spec.ts`, 3 tests × 4 projects)

The clusters are placed far from the origin, at coordinates that are not
grid-aligned, so neither the axes, landmarks nor grid lines share their
pixels.

| Test | Assertions |
| --- | --- |
| Stays visible | 15 red strokes, viewed from 6, 10, 14, 20 and 200 levels out (the 200 case uses a second cluster placed proportionally far away). From 10 levels out, **without the preview the cluster's pixel looks like the background beside it (≤ 12 levels apart)**; with it, the pixel differs by **at least 30 levels** and every channel moves towards the strokes' colour. |
| 60 levels deep | Strokes drawn at level 60 are invisible from home without the preview, and a mark (≥ 30 levels) with it. Zooming back to level 60 finds all 5 strokes drawn individually. |
| Edits, never selectable | Clicking the mark selects nothing. After deleting everything the mark is gone (0 squares, pixel unchanged), and undo brings it back. |

## Benchmarks

Zooming in place (new `zoom` bench mode: ±0.05 levels about the centre every
frame, no pan, no tiles), frame p50/p95 ms, preview off → on:

| Scene | Out | Chromium | Firefox |
| --- | --- | --- | --- |
| dense 10K | 0 | 103.6/138 → 107.7/141.4 | 135/173 → 132/180 |
| dense 10K | 10 / 14 / 20 | 0.9/1.1 → 1.2/2.0 · 0.9/1.4 → 0.9/1.2 · 0.8/1.0 → 0.9/1.2 | 1/2 → 1/2 (all) |
| clusters 1M | 0 | 12.7/14.1 → 13.5/16.4 | 15/28 → 19/28 |
| clusters 1M | 10 / 14 / 20 | 1.5/2.0 → 2.8/4.1 · 1.5/1.6 → 2.7/3.4 · 1.6/2.4 → 2.5/3.3 | 1/2 → 5/7 · 1/2 → 5/5 · 2/2 → 5/5 |
| mixed 1M | 0 | 12.2/15.6 → 13.2/16.8 | 16/20 → 17/24 |
| mixed 1M | 10 / 14 / 20 | 2.1/2.4 → 3.0/3.5 · 2.2/2.7 → 2.8/3.5 · 3.3/5.9 → 4.1/6.6 | 3/4 → 4/5 · 2/3 → 4/5 · 4/6 → 6/10 |

(The first attempt used the pan+zoom trajectory: at 12 levels out the tiny
scene drifted off-screen within a few frames, so it measured empty space and
reported no squares. It was discarded.)

## Defects found

1. **A band of objects that were neither drawn nor previewed** (design).
   Lowering projection's size cutoff to 1/16 px, so it would draw everything
   in drawn levels, made projection keep objects the index skips. The
   brute-force tests failed. No size cutoff can agree with a level rule,
   because objects are between half and all of their cell. Fixed by deciding
   by level in both places (`tooSmallToDraw`). All 79 unit tests then pass.
2. **Squares smaller than a double step vanished** (application). At a
   screen x of about 900, a square of 2^-55 px has a computed right edge
   equal to its left edge, so it was skipped as empty: a drawing 60 levels
   deep left no mark. Squares under 2^-10 px are now points. Their colour
   weight is separate from their coverage, so a coverage that underflows to
   0 still has a colour for its presence mark.
3. **Per-frame overhead with nothing to preview** (application, found by
   the quick suite). The Firefox wheel-zoom tests measured render p95 of
   exactly 8 ms against the limit of under 8 ms, on an empty canvas.
   Firefox's 1 ms timer puts this at the edge, and v0.4.0 passed. The
   density layer built a cache key from the camera's BigInt coordinates
   (string conversion) and computed the world viewport every frame, even
   with no sub-pixel content. The key now compares the camera and viewport
   objects (they are replaced, never mutated), and an index with no
   sub-pixel level returns at once (`hasSubPixelLevels`). Both Firefox
   wheel-zoom tests pass again; the limit was not changed.
4. **Test setup** (test). Grid-aligned and origin-adjacent sample points
   (`2^40`, multiples of 1024) sat on grid-line crossings and landmarks. A
   swatch click by guessed name waited for the full test timeout. Fixed with
   non-aligned points and the exact swatch label.

## Regression

- **First quick suite** (build `db16cef4…3fa`): 199 passed, 3 skipped by
  design, **2 failed**: the Firefox wheel-zoom render p95 (defect 3).
- **After the fix**, the quick suite (4 projects) on the v0.5.0 build
  `5d1504dc…0ede0`: **201 passed, 3 skipped by design** (the touch test
  outside the touch project), **0 failed** (E2E 16.4 min). Unit tests
  79/79; the offline and naming checks pass.

## Not covered (unverified)

- Images in the preview use neutral grey (by design, for now).
- Very large numbers of summary cells in view (millions): cost grows with
  the occupied summary cells of skipped levels.
- Hardware-GPU canvases.
