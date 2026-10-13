# Phase 0A test log — endless navigation

## Environment

| Item | Value |
| --- | --- |
| Date | 2026-10-13 |
| CPU | Intel Core i5-4460 @ 3.20 GHz, 4 cores |
| GPU | Intel 4th-gen integrated graphics (Haswell) |
| OS | Fedora Linux, kernel 7.0.13 |
| Browser | Chrome for Testing 156.0.8078.4 (Playwright 1.64.0), headless |
| Node | 26.4.0 |
| Viewport | 1280 × 800 CSS px |

The E2E projects are:

- `chromium`: default flags, DPR 1.
- `chromium-cpu`: `--disable-gpu --disable-gpu-compositing --disable-accelerated-2d-canvas`, DPR 1.
- `chromium-dpr2`: DPR 2, touch enabled. Touch is emulated through CDP
  `Input.dispatchTouchEvent`.

## Thresholds

These were fixed before the runs in `tests/e2e/harness.ts` → `LIMITS`.

| Quantity | Limit |
| --- | --- |
| Anchor drift (pointer / pinch centroid / viewport centre) | < 0.01 CSS px |
| Round-trip landmark displacement | < 0.01 CSS px |
| Visible rendering in any region | > 200 inked pixels |
| Render call p95 | < 8 ms |

## Commands

```sh
npm run typecheck
npm run test:unit                   # 25 tests
npm run build                       # dist/canvast.html
npx playwright test                 # all three projects
npm run check:offline
npm run check:names
```

## Unit results (Vitest, Node)

25 of 25 pass. They cover:

- exact double ↔ dyadic conversion on 2,000+ random doubles, including
  subnormals and `MAX_VALUE`;
- out-of-range values producing `±Infinity`/0 and never `NaN`;
- anchor drift < 1e-9 px over 4,800 random zoom steps spanning ±2,400
  levels;
- exact return after 1,000 levels out then back in with wheel-sized,
  non-dyadic steps (100/240 of a level);
- 10,000 levels each way with a stable anchor;
- documented coarsening beyond the 4,096-level precision budget;
- exact pan reversal at 3·2^200 world units from the origin;
- uniform pan at 2^4000;
- mantissa growth bounded by `pz + 96` bits over 20,000 random operations;
- lossless camera serialization, with corrupt input rejected;
- grid lines placed on exact world multiples at any depth.

## E2E results

Values are copied from `metrics/*.json` (gitignored). A drift or
round-trip of `0` means bit-identical: the landmark's projected position did
not change in the last bit.

Final run on the committed spec: `chromium` and `chromium-cpu` 14 passed
and 2 skipped (14.4 min); `chromium-dpr2` 8 passed (8.4 min). An earlier
full run of the same projects also passed every case except the three
DPR-2 harness assumptions listed under defects 5.

### Wheel zoom: 2,400 trusted notches (1,200 one way, then 1,200 back)

| Project | Per notch (levels) | Depth reached | Max anchor drift | Round trip | Render p50 / p95 / p99 / max (ms) |
| --- | --- | --- | --- | --- | --- |
| chromium, in-first | 0.4167 | 500 | 2.8e-14 px | 0 | 1.9 / 2.5 / 2.8 / 4.8 |
| chromium, out-first | 0.4167 | 500 | 2.8e-14 px | 0 | 0.6 / 1.5 / 2.4 / 4.5 |
| chromium-cpu, in-first | 0.4167 | 500 | 2.8e-14 px | 0 | 1.3 / 2.5 / 2.7 / 5.6 |
| chromium-cpu, out-first | 0.4167 | 500 | 2.8e-14 px | 0 | 1.3 / 1.6 / 2.7 / 4.6 |
| chromium-dpr2, in-first | 0.2083 | 250 | 2.8e-14 px | 0 | 0.8 / 1.8 / 2.4 / 4.5 |
| chromium-dpr2, out-first | 0.2083 | 250 | 2.8e-14 px | 0 | 0.8 / 1.5 / 2.0 / 4.4 |

The render times cover the last 2,048 frames (the size of the
`FrameStats` window). They measure CPU time inside `renderFrame` with
`performance.now()`, which Chromium coarsens to 0.1 ms when the page is not
cross-origin isolated. They do **not** include compositing or
input-to-photon latency, which were not measured in this phase.

### Other navigation cases

| Case | chromium | chromium-cpu | chromium-dpr2 |
| --- | --- | --- | --- |
| Offline load: no non-`file:` request, no console error | pass | pass | pass |
| ctrl+wheel pinch, 600 steps of ±3.7 px: anchor drift / round trip | 0 / 0 | 0 / 0 | 0 / 0 |
| Keyboard (40×) and buttons (20×) to +40 levels and back: centre drift / round trip | 0 / 0 | 0 / 0 | 0 / 0 |
| Directional pan, 4 × 40 drags of 600/350 px at levels 0, +300 and −300, plus 4 × 25 arrow-key presses: return error | 0 at every depth | 0 at every depth | 0 at every depth |
| Drag follows the pointer at home, at 2^5000 and at 3·2^-3000 depth 3005 (< 0.01 px), with grid visible | pass | pass | pass |
| Extreme states: depth ±1,100, 3·2^200 at depth −190, 1 + 2^-300 at depth 305, depth 9,000 at ~2^9074 → renders, responds to wheel, landmarks exact (< 1e-9 px) | pass | pass | pass |
| Touch pinch, 12 gestures (8× out/in) around fractional centroid (700.35, 380.6): max anchor drift / round trip | n/a | n/a | 1.9e-4 px / 5.0e-4 px |

The touch round trip is small but not bit-exact. Pinch zoom per move is
`log2(spread / previousSpread)`, and `log2(a/b)` is not always the exact
negation of `log2(b/a)` in doubles, so after 12 gestures the camera ends
1.1e-5 levels from where it started. That is far inside the threshold.
Making pinch exactly reversible would require integrating zoom from the
gesture's starting spread rather than from per-move ratios. That is noted
for later and not needed by the contract.

## Defects found and fixed during Phase 0A

1. **Non-reversible zoom (model defect, fixed at the root).** A unit test
   zoomed out 5,000 × 2 levels and back in at the same pointer and landed at
   `Infinity` px. There were two causes:
   - the camera centre was rounded to the current, coarse level's precision,
     discarding fine bits;
   - non-dyadic zoom steps (100/240) made `zf` differ in the last bit after
     `+dz − dz`, an error that the return trip magnified by 2^k.

   The fix, in `src/core/camera.ts` (ADR 0001 §6–7):
   - quantize zoom deltas to 2^-20 levels and screen offsets to 2^-32 px;
   - add a precision depth `pz` that keeps fine bits for up to 4,096 levels.

   Regression tests: `returns exactly after zooming far out and back in` and
   `forgets sub-pixel position only beyond the precision budget`.
2. **Non-existent `Math.LOG10_2`.** The strict typecheck caught it before it
   ran; it would have shown `NaN` in the zoom read-out. It is now a defined
   constant.
3. **Test harness: ink metric.** It sampled every 4th pixel, against the
   top-left pixel's colour. That missed 1 px grid lines and misread
   backgrounds. It now checks every pixel, against the most common colour.
4. **Test harness: fractional mouse coordinates.** Chromium truncates
   `MouseEvent`/`WheelEvent` `clientX` to integers, but not `PointerEvent`.
   The fractional anchor test was moved to touch, which goes through Pointer
   Events.
5. **Test harness: DPR-dependent wheel delta.** At DPR 2, Chromium reports a
   100 device-px notch as 50 CSS px. The test now derives the expected depth
   from the measured per-notch zoom and asserts it is constant (no clamp or
   ramp-down). The anchor and round-trip thresholds are unchanged.

## Not covered (unverified)

- Firefox and Safari; Windows and macOS; real trackpads and touchscreens.
- Real hardware GPU rasterization: headless Chromium on this machine may
  rasterize Canvas 2D in software in both GPU projects.
- Input-to-photon latency, high-refresh displays, and long-session memory
  growth.
- Content creation and editing at reached scales: no editable content
  exists yet (Phase 0B).
