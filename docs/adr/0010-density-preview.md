# ADR 0010 — Density preview for content too small to draw

- Status: accepted (Phase 1, slice 5)
- Date: 2026-10-13
- Builds on [ADR 0004](0004-multi-scale-spatial-index.md) (index levels and LOD)

## Context

The spatial index skips every level whose cells are smaller than 1/8 px.
That keeps zoomed-out frames fast at any document size, but content beyond
roughly 3 levels below a pixel vanished completely: a cluster of strokes
seen from 10 levels out, or a drawing made 60 levels deep seen from home,
left no trace. For an endless canvas this breaks discovery. The plan
(§14.5 "clustering, adaptive visibility", §14.21 "distant-cluster
navigation") asks that far-away and very small content stay findable,
without pretending detail that cannot be resolved.

## Decision

### Ink summaries in the index

Every index entry records its **ink**:
- **Strokes:** area = polyline length × width + the round caps.
- **Images:** w × h, with a neutral grey colour, because originals are not
  decoded for this.
- Both are opacity-weighted and kept with the object's colour.

Each cell, each **mid** cell (16 × 16 cells) and each coarse cell
(256 × 256) keeps a running sum of covered area, in its own area units, plus
the colour channels weighted by area. The sums are updated on every insert
and remove, so they always derive from the indexed objects. A sum that
reaches zero is reset exactly, so float residue never accumulates.

### What is drawn individually, and what as density

One rule decides both: an object is **drawn individually exactly when its
index level is drawn** (`2^(level + zoom) ≥ 1/8 px`, `tooSmallToDraw` in
`projection.ts`). Otherwise it is in the density preview. So every object is
in exactly one of the two.

An earlier version used a box-size cutoff in projection. That cannot work:
an object is between half and all of its cell's size, so there is always a
band where the two rules disagree. The existing brute-force index test found
this. Objects that are drawn but smaller than 1/8 px are painted at the
minimum stroke width (0.6 px), as thin strokes always were.

### Drawing

For each skipped level, `SpatialIndex.density` returns squares at the
coarsest summary granularity (cell, mid or coarse) that is at most 2 px on
screen. Each has its covered fraction and mean colour. Positions are exact:
one exact dyadic origin per level, then whole steps.

`render/density.ts` spreads each square's coverage over the CSS pixels it
overlaps, by overlap area. A pixel with total coverage `A` gets opacity
`1 − e^(−A)`, so sparse ink adds up and dense ink saturates smoothly. Its
colour is the coverage-weighted mean.

Squares far below a pixel (under 2^-10 px) are treated as points, because
their edges can be closer together than one double-precision step at their
screen position. The preview is drawn **behind** all individually drawn
objects, as one image per frame. It is recomputed only when the document
revision, camera or viewport changes.

**Presence floor:** the pixel holding the centre of any square with ink is
at least 35% opaque. Content far smaller than a pixel stays a findable dot,
the way thin strokes never get thinner than 0.6 px. Ink anywhere else is not
inflated.

### What it is not

- It is not exact: geometry inside a pixel is not resolved.
- Sub-pixel content does not interleave with visible objects by paint
  order.
- Images use a neutral grey.
- It never affects the document, selection or hit testing. Clicking a mark
  selects nothing; zooming in reveals the real objects.
- It is not cached in tiles. Editing sub-pixel content therefore never
  leaves a stale tile, and tiles stay exact.

## Consequences

Measured while zooming in place (no tiles), frame p50 in ms:

| Scene | Chromium off → on | Firefox off → on |
| --- | --- | --- |
| Dense 10K, 10–20 levels out | 0.9 → 1.2 | 1 → 1 |
| 1M in clusters, 10–20 levels out | 1.5 → 2.7 | 1–2 → 5 |
| 1M mixed, 10–20 levels out | 2.2–3.3 → 2.8–4.1 | 2–4 → 4–6 |
| At home | +0–1 | +0–4 |

- Memory: one ink record per cell, mid cell and coarse cell, plus a
  CSS-pixel accumulation buffer (5 floats per pixel, about 20 MB at
  1280 × 800).
- The extra Firefox cost comes mostly from walking the summaries of every
  skipped level, including cells outside the view. An occupancy filter per
  view (as the visibility query already has) is the optimization lead if
  this grows.

## Deferred

- **The average colour of images**, computed once from the decoded
  original.
- **Interleaving by paint order** with visible objects.
- **Named-cluster markers or a minimap overview** (§14.21). The density
  marks are the visual basis for them.
