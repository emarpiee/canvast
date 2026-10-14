# Pen and deep-zoom algorithms

Technical reference for the algorithms behind the pen options and the
colour of objects seen from far below (ADR 0014, ADR 0015, and
`nested-frames.md` §7.3, §8b). Code: `src/render/coarse.ts`,
`src/core/frames.ts` (term sums), `src/interaction/pen-width.ts`,
`src/interaction/stabilizer.ts`, `src/interaction/tools.ts`.

Notation: `L` = levels by which the camera's frame is finer than the object's
frame `g`; `zTrue` = log2 of CSS px per unit of `g` (the view's true zoom
there, about `L + z`); "local" = the object's own units (`anchor`, `unit`);
`px` = CSS px.

## 1. Which side of an object is the view on? (coarse cover / miss)

### 1.1 The problem

The camera centre `C` in `g`'s units has about `L` significant bits when the
camera sits at a generic place: writing it down costs O(L) bits (1,000,000
bits at 10^6 levels; Firefox's BigInt limit is about 2^20 bits). But the
question "is the view inside this stroke / glyph / image pixel?" has a
yes/no answer that does not need those bits.

### 1.2 Rounding the centre

`coarseCameraIn` expresses `C` in `g` with the term-sum walk (§2) and drops
every term below `2^-256` of `g`'s unit. Each drop is smaller than half the
last kept bit, and the walk crosses fewer than `2^48` frames, so the error is
below `2^-256+48 = 2^-208` units of `g` (`COARSE_ERR_LOG2`). The cost is the
length of the frame path, not `L`.

### 1.3 The margin

Let `ε = 2^-208` (rounding), `R` = the view's half-diagonal plus 8 px
expressed in `g` units, `R = 2^(log2(hypot(w,h)/2 + 8) − zTrue)` (underflows
to 0 at depth), and the double-precision slack `mag · 2^-46` (`ROUND`, a few
ulps with room, `mag` = the largest magnitude involved). In local units

    m = (ε + R) / 2^unit + mag · 2^-46

### 1.4 Why a distance above `m` decides everything

Every sampler computes `s`, the signed distance from the rounded centre to
the object's outline (positive outside). The signed distance function is
1-Lipschitz: moving the point by `δ` changes `s` by at most `δ`. Every point
of the view is within `R + ε` of the true centre's rounded value, so if
`|s| > m` no point of the view crosses the outline: the whole view is inside
(`s < −m`: *covers*) or outside (`s > m`: *misses*), and the dropped bits
cannot change a pixel. Otherwise an outline is within `m` and the answer
needs the exact centre (the "exact" result, §1.7).

### 1.5 Samplers (one per kind; `SAMPLERS` is typed over all kinds)

| Kind | `s` / decision |
| --- | --- |
| Stroke | `s = d − width/2`, `d` = distance to the polyline (point to segment) |
| Text | For each glyph near the point (its advance box grown by 0.3 em): nonzero winding number of the contour polylines (each quadratic curve in 10 pieces; bold = outline and a copy shifted by 1/32 em; italic = shear 13/64), and the minimum distance to those pieces. Margin `m + 0.004 · size · lineScale`: a quadratic with control-point second difference `D` deviates from its chord pieces by at most `\|D\| / (8 n²) ≈ 0.0013 em` for `n = 10`, so 0.004 em covers it with room. Winding ≠ 0 → covers with the text colour; distance ≤ margin → exact; a glyph the bundled font lacks → exact |
| Image | Inside one source pixel (and the image's edges and pixel boundaries farther than `m`): one rectangle with that pixel's colour. Otherwise §2.3 |
| Default (`bboxSampler`) | Inside the bounds, away from their edges: covers with a colour; else exact |

### 1.6 What is drawn

`Cover` is `{ color }` (one fill over the view) or `{ rects }` (image pixels
over rectangles of the view). The cover object's box is the viewport, so
tiles, picking and selection treat it like any object.

### 1.7 The remaining limit

"Exact" needs the exact centre in `g`: `cameraIn` builds it from the term
sum, a number of about `L` bits, so it is limited to `COARSE_EXACT_MAX =
100,000` levels. The exact stroke code squares `perp` (`L` bits → `2L` bits),
so in Firefox the hard ceiling is about `L ≈ 5·10^5`; 100,000 keeps time and
memory sane.

Why this cannot be carried as a small exact line (the plan's near-edge set):
the side of a stroke is at distance `r` from the segment's line, i.e. at
`perp = r·|U|` with `|U| = sqrt(ux² + uy²)` irrational. A camera that stays
within a view of that edge for `L` levels has, by construction, the edge's
first `L` binary digits in its own position, and comparing them needs `|U|`
to `L` digits. Glyph outlines are curves, the same. Straight edges at
rational positions (image pixel boundaries) have no such problem: §2.3.

## 2. Term sums: numbers that cannot be written as one number

### 2.1 Representation

A `TermSum` is a list of dyadics ordered by magnitude, each at least `GAP =
64` bits below the previous term's lowest bit, so the sum equals the first
term to within `2^(1−GAP)` relative (`termsLead`). A camera at the corner of a
pixel a million levels down is `0 + a few small terms`, never a number of
10^6 bits: the mixed-scale sum is never formed (it would be, and Firefox
would throw).

### 2.2 Operations (exact)

`termsAdd(ts, c)`: put `c` in, sort by magnitude, merge any pair closer than
`GAP` by exact addition, repeat until stable (a merge can cancel the leading
digits, which is exactly the case "the camera is on the edge"). `termsScale`
(multiply each term, then normalise), `termsShift` (change exponents). Cost:
the number of terms, not the depth in bits. `expressTermsIn` is the frame
walk (§7.2 of `nested-frames.md`) returning term sums instead of one number.

### 2.3 Image pixel boundaries from term sums

A source pixel boundary on x is at local `j·w/pixelW`; its offset from the
view centre is `(j·w − lx·pixelW) / pixelW` local units. With `lx` as a term
sum (`t`), `num_j = termsLead(termsAdd(termsScale(t, −pixelW), j·w))` is
computed exactly (the product `j·w` of an integer and a double is exact), and
the boundary is at

    dx_j = num_j / pixelW · 2^(unit + zTrue)   px from the view centre.

When the camera is exactly on the boundary, `num_j` cancels to a tiny lead
term and `dx_j` is a normal small number of px. A source pixel is thousands
of times the view at depth, so at most one boundary per axis crosses the view;
candidates `j = floor(u) − 1 … floor(u) + 2` (with `u = lx·pixelW/w` from the
rounded centre) suffice. The runs between consecutive boundaries (plus the
open runs at both ends) are clipped to the view and crossed: up to nine
rectangles, each `(pixel i, pixel j)`; indices outside the image are
transparent. Tested to 10^15 levels at a pixel corner.

## 3. Thickness lock

Let `W = px · 2^(−z)` be the width a pen of `px` CSS px has on the canvas at
zoom `z` (levels, a BigInt plus a fraction). The lock records `(z_ref,
px_ref)` and returns, at zoom `z_now`,

    px_now = px_ref · 2^(clamp(z_now − z_ref, ±1000)),

so `px_now · 2^(−z_now) = W_ref`: the same width on the canvas. The
difference is taken on the BigInt levels first (`Number(levels_now −
levels_ref) + (frac_now − frac_ref)`), so it is exact for any depth, and the
clamp keeps the result inside a double (`2^±1023`; beyond ±1000 levels from
the reference a brush that wide or thin looks the same anyway). A stroke is
created with `unit = −zi` and local width `px_now / 2^zf`, which is why the
width is `px_now` px at the zoom it is drawn.

Without the lock `px_now = px_pen`: the same width on screen at any zoom.

On the Select tool the lock keeps the line width when resizing:
`scaleAbout(…, keepWidth)` scales the points by `k` and leaves `width`
unchanged (`normalizeUnit` then rescales points and width together, which
preserves the geometry exactly).

Size slider: `px = round(0.5 · 256^(v/100), 0.1)` for `v` in 0…100 (0.5 to
128 px, log scale), inverse `round(100 · ln(px/0.5)/ln(256))`.

## 4. Stabilizer (lazy rope)

State: the tip `T` (screen px), a rope length `R` (0.6 to 60 px from the
strength, `R = strength/100 · 60`). For every pointer sample `P`:

    d = |P − T|;   if d > R:  T ← T + (P − T) · (d − R)/d

After a step `|P − T| ≤ R`; a pointer within the rope leaves `T` unchanged,
so wobble of amplitude below `R` never reaches the stroke. The rope is in
screen px, so it is as strong magnified as not. Points are added when the
tip has moved at least `PEN_MIN_STEP_PX`. The stroke ends up to `R` behind
the pointer. (The rule is not exactly invariant to the sampling rate; the end
point of the same drag differs by at most the rope.)

## 5. Pen size follows zoom (pieces)

Each piece has `(depth_piece, px_piece)` (the zoom and screen width when it
started). At every new point, with `px_now = penWidthNow(…)` and `Δz =
(levels_now − levels_piece) + (frac_now − frac_piece)`, the canvas width the
pen should have relative to the piece's is

    drift = log2(px_now / px_piece) − Δz.

If `|drift| ≥ 0.25` (or it is not finite), the piece ends and a new one
starts at the **same point**: the last point of the piece is converted
exactly into the camera's frame (`expressExactIn`), becomes the new anchor
with `unit = −zi` and local width `px_now / 2^zf`, and `(depth_piece,
px_piece)` are reset. Pieces are committed in one transaction with
increasing `z`, so one undo removes the whole stroke. Without the lock,
`px_now = px_piece` and `drift = −Δz`: a split every quarter level of zoom.
With the lock, `px_now = px_piece · 2^Δz` (inside the ±1000 clamp), so
`drift = 0` and the stroke is never split. The width steps by at most
`2^0.25 ≈ 19%` per piece.

## 6. Ignore the object that fills the view

`fillsView(po)` is true for a coarse object classified as covering, and for
any other object that the hit test (tolerance 0) accepts at the view centre
and at all four corners inset by 2 px. A band across the screen fails the
corner tests, so it stays selectable.

## 7. Costs

| Operation | Cost | Depends on depth? |
| --- | --- | --- |
| Rounded centre in an ancestor frame | path length (frames) | No (number of frames) |
| Stroke / text / image-away classification | O(points) / O(nearby glyph segments) / O(1) | No |
| Image boundaries on a pixel boundary | term count (a few) | No |
| Exact centre for an outline edge in view | O(L) bits | Yes (limit 100,000 levels) |
| Thickness lock width | O(1) (BigInt subtraction of two levels) | No |
| Stabilizer step | O(1) | No |
| Follow-zoom split | one exact conversion along the frame path | Path length |
