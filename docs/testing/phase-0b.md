# Phase 0B test log — editing, precision and recovery

## Environment

The same reference machine and browser as [Phase 0A](phase-0a.md): Intel
i5-4460, Intel HD 4600, Fedora (kernel 7.0.13), Chrome for Testing 156
(Playwright 1.64.0), headless, viewport 1280 × 800.

Projects: `chromium` (default), `chromium-cpu` (GPU and accelerated canvas
disabled), and `chromium-dpr2` (DPR 2 with touch).

The thresholds are those in `tests/e2e/harness.ts` → `LIMITS`, fixed in
Phase 0A and unchanged: anchor and round-trip error must be below 0.01 CSS
px, and render p95 below 8 ms.

## Commands

```sh
npm run typecheck
npm run test:unit
npm run build
npx playwright test        # navigation + editing + deep-zoom + zoom-controls specs, 3 projects
npm run check:offline
npm run check:names
```

## Unit results

52 of 52 pass (Vitest). The tests added in Phase 0B cover:

- **Object model:** lossless serialization, and rejection of `NaN`, bad
  ids, bad hashes, bad opacity, unknown kinds and attachment links.
- **Edit operations:** exact translation by 2^-2000 at 3·2^1000; a fixed
  point that stays put under scaling; exact power-of-two renormalization.
- **Document store:** undo and redo return the identical stored objects;
  invalid transactions change nothing; stale transactions are rejected.
- **Projection:** matches exact world→screen to within 1e-12 relative error
  over 300 random objects at magnifications up to 2^40.
- **Selection policies:**
  - a small lasso over a viewport-filling image selects only the stroke;
  - "All" selects media only when it is fully enclosed;
  - the stroke vertex fraction is honoured;
  - box selection requires full containment;
  - the stroke width is honoured when picking.
- **Exact stroke coverage** against an independent exact classifier
  (squared distances, no square roots):
  - the viewport placed exactly on an edge at 86 depths from 2^0 to 2^5000;
  - 80 random strokes viewed at up to 2^3900×.

  Result: **0 misclassified samples** out of more than 20,000 classified.
- **Exact edge distance** is accurate to 1e-6 px at 2^0, 2^60, 2^200,
  2^400, 2^1100 and 2^5000×.
- **Projection never drops a visible object,** tested at magnifications
  from 2^12 to 2^20000.
- **Portable SHA-256** matches Node's implementation.
- **Typed zoom-level parser.**

## E2E results (scenario ids from the spec's U-series)

**Runs:**
- **Final full run** (all four specs, 3 projects): 61 passed, 2 skipped by
  design (touch outside the touch project), 6 failed (27.6 min). All six
  failures were test-harness defects 3–5 below.
- **Re-run of every failed test plus the related rendering tests, all 3
  projects:** 21 of 21 passed (3.3 min).

The results were identical in every project unless a column says otherwise.

| Id | Scenario | Assertions | Measured (chromium / chromium-cpu / chromium-dpr2) |
| --- | --- | --- | --- |
| U1 | Import an 8×6 image, zoom 10 levels in (1 source px ≈ 1024 px), draw a stroke | Image object unchanged; stroke independent (`attachmentTargetId` null, z above the image); nothing selected; stroke endpoints exactly under the pointer; width = pen width; screen pixels are source colours only | Endpoint error 0 / 0 / 0 px; width 3 px; image 8192 px wide |
| U2 | Move only the image A → B; undo, redo; reload | Image moved by the exact world delta (dyadic equality); stroke unchanged; undo/redo restore the identical objects; reload restores identical objects and camera | pass |
| U4 | Lasso around the stroke while the image fills the viewport, with "Strokes" and with "All" | Selection = the stroke only, in both filters; camera and image unchanged | pass |
| U5 | Click the viewport-filling image, then drag it; drag from the unselected image | Click selects it, drag moves it exactly; dragging from unselected media never moves it | pass |
| U7 | Draw 300 levels deep near 1 + 2^-300; zoom ~125 levels out and back; click, drag, resize | Vertex round trip < 0.01 px; width unchanged; hit, move exact, resize corner and size < 0.01 px | Round trip 0 px; resize corner error 0, size error 5.7e-14 px |
| — | New-scale creation at +1000 levels (near 3·2^-1000) and −1000 levels (at 2^1000) | Draw two strokes, click/shift-click select, multi-move exact, resize exact, undo×2 restores the identical objects | Resize corner and size error ≤ 5.7e-14 px |
| U8 | Draw at home; travel ~2^1013 world units with real keys; draw; return home; reload; revisit | Home stroke exactly where drawn; far stroke not visible from home; both selectable and draggable; reload identical | Distance 2^1013 |
| — | Deep zoom into a curvy stroke with wheel input; rendered pixels vs. exact edge distance | 0 holes and 0 spill at every checked step; exact path exercised | 0 / 0 / 0 errors; exact frames 52 / 52 / 44 of 60; render p95 2.9 / 2.8 / 1.5 ms. DPR 2 reaches 50 levels instead of 100 because a notch is 50 CSS px there |
| — | Camera exactly on a stroke edge at 51 depths from 2^0 to 2^300 | Pixels on each side of the edge match the exact edge distance | 203 classified samples, 0 errors in every project |
| — | 50%-opacity self-crossing stroke, shallow and at +40 and +200 levels | Every inside pixel = background·0.5 + ink·0.5, so the crossing is painted once | Max channel error 0.5 at every depth, in every project |
| — | Stroke and image placed 600 levels deep, then 1,500 more levels of keyboard zoom into them | Centre pixel keeps the item's colour at every 50 levels; a click selects the item at 2^2100 | 0 failures, every project |
| — | Typed zoom levels and the dev panel | Exact level reached; centre world point unchanged; invalid or oversized input rejected without moving; stroke coloured at 2^1000, 2^3000, 2^9000; jumps, auto-zoom, stop on input | pass |
| 0A | Full Phase 0A navigation regression suite (with the Hand tool) | Phase 0A thresholds | Anchor drift ≤ 2.8e-14 px; every round trip 0 px |

## Defects found and fixed during Phase 0B

1. **Deep-zoom stroke holes and flicker (reported by the user).**
   - *Reproduction:* a curvy stroke zoomed at a segment showed holes in 63 of
     200 zoom steps, from about 2^52× onwards (up to 11,731 of 20,862
     inside-samples missing).
   - *Root cause:* deep-zoom geometry was built from double-precision screen
     coordinates of vertices about 2^60 px away, where a double resolves only
     512 px. "Radius − distance" cancelled catastrophically.
   - *Fix:* the exact coverage path (ADR 0003): signed edge offsets from exact
     numerators, and the viewport clipped by half-planes.
   - *Regression tests:* the deep-zoom-rendering spec, plus unit tests against
     an exact classifier.
   - *Mutation check:* with the exact path disabled, the edge and opacity
     tests fail. Orientation normalization was **not** the cause; disabling
     it changes nothing, because every polygon is cut from the viewport
     rectangle.
2. **Items vanished beyond 2^900× (reported by the user).**
   - *Root cause:* an artificial `MAX_PPU_LOG2 = 900` cap, plus a fast path
     whose double-double centre is accurate only to about 2^-104.
   - *Effect:* the regression test showed image colour missing from 100
     levels beyond the image's placement scale.
   - *Fix:* the scale is carried as an exponent and fraction, every exact
     quantity is scaled by an exponent shift, boxes are always exact, the fast
     path is used only under a 2^-40 px error bound, and image pixel edges come
     from an exact rational.
   - *Regression:* a stroke and an image placed 600 levels deep stay coloured
     and selectable through 1,500 more levels of real keyboard zoom. Unit
     tests run to 2^20000.
3. **Test harness: an overlay intercepted input** (3 failures, one per
   project). The `#debug` dev panel covered the start point (200, 200) of a
   Phase 0A drag test, so the drag never reached the canvas. The test now
   starts elsewhere. The shared `drag` and `wheel` helpers also assert that
   their start point is the canvas element, so an overlay can no longer
   silently invalidate an input test.
4. **Test harness: DPR-dependent wheel delta** (U1, DPR 2). Two 0B tests
   repeated a mistake already documented in Phase 0A: assuming a wheel notch
   is 100 CSS px. U1 now zooms with the keyboard (0.5 levels per press). The
   curvy-stroke test only records the shallower depth reached at DPR 2.
5. **Test harness: sampling** (DPR 2).
   - The deep-image test sampled its reference colour exactly on a
     source-pixel boundary. At 1.4 CSS px per source pixel the image is
     smoothed, so the sample was a blend. The test now centres on source pixel
     (3, 2) and expects its known colour, which passes in every project to
     2^2100.
   - The curvy-stroke test counted the orange world axis as ink. Ink is now
     classified by distance to the stroke colour.
6. **Test harness: hidden options.** The pen colour buttons are hidden until
   the pen tool is active; the test now selects the pen first.

## Not covered (unverified)

- Firefox and Safari (including IndexedDB behaviour under `file://`), real
  touch and pen hardware, and multi-tab editing.
- Very large documents: every object is still projected each frame
  (Phase 0C).
- Alpha-aware image picking, groups and attachment (U3, U6, U9 and U10 belong
  to later phases).
