# Testing guide — which suite to run, and when

canvast has one set of end-to-end (E2E) tests that runs in two lengths. Every
test runs in both; only the length of the stress loops differs (for example
240 instead of 1,200 wheel notches).

| Command | What it runs | Time (reference machine) | When to run it |
| --- | --- | --- | --- |
| `npm test` | Typecheck, unit tests, **quick** E2E suite (4 browser configs: 3 Chromium, 1 Firefox), offline and naming checks | ~16 min (E2E 15.6 min with Firefox, v0.3.1) | **After every ordinary change, and before committing a finished slice or milestone** (for example v0.2.0, v0.3.0) |
| `npm run test:full` | The same, with the **full** E2E stress loops | ~50 min (estimate with Firefox; 34.5 min for Chromium only at v0.2.0) | **Only when a whole phase is complete** (for example the end of Phase 1); record the result in that phase's test log |
| `npm run test:unit` | Unit tests only (Vitest) | ~15 s | While developing |
| `npx playwright test -g "<name>"` | Selected quick E2E tests | seconds | While developing a specific feature |
| `npm run bench` | Scale benchmarks, 1K–1M objects, plus tile-cache benchmarks (tiles on/off; pan, still, pan+zoom) in Chromium, Chromium CPU-only and Firefox. Not a pass/fail gate | ~15–25 min (not yet timed with Firefox; tile benchmarks alone 2.2 min) | After rendering or performance changes; compare with `metrics/bench-*.json`, `metrics/tiles-*.json`, docs/testing/phase-0c.md and phase-1d.md |

## Rules

1. **Run the full suite only when a whole phase is complete, and never skip
   it then.** A slice or milestone within a phase that can be tested on its
   own (unit tests, its own E2E spec, and the quick suite) does not need it.
   The quick suite runs every test with shorter stress loops. The full one
   is the record that the spec's "hundreds of successive gestures"
   requirements hold. (Decided with the project owner, 2026-10-13. Slices 1a
   and 1b ran it as well; from 1c on they do not.)
2. **Never rebuild `dist/` while any suite is running.** The tests load the
   built `dist/canvast.html` at the start of each test, so a rebuild mid-run
   mixes two versions in one result.
3. **Thresholds are not loosened to pass.** The `LIMITS` in
   `tests/e2e/harness.ts` are the same for both lengths. Only loop counts
   differ, plus a few assertions that depend on how far a loop travelled
   (they scale with the count).
4. **Write per-test loops with `reps(full, quick)`** from
   `tests/e2e/harness.ts`. Input that depends on DPR (wheel notches are 50 CSS
   px at DPR 2) must not assume a fixed depth. Derive it from what was
   measured, or use keyboard steps, which are DPR-independent.
5. **Input helpers must start on the canvas.** `app.drag` and `app.wheel`
   assert this, so an overlay cannot silently swallow input.

## How the switch works

- `playwright.config.ts` runs the quick suite.
- `playwright.full.config.ts` sets `CANVAST_E2E_FULL=1` and reuses the same
  config.
- `tests/e2e/harness.ts` exports `FULL` and `reps()`.

To run the full length of a single test:
`npx playwright test -c playwright.full.config.ts -g "<name>"`.

## Configurations (both suites)

| Project | Purpose |
| --- | --- |
| `chromium` | Default |
| `chromium-cpu` | GPU and accelerated canvas disabled (the CPU-only tier) |
| `chromium-dpr2` | DPR 2, touch enabled. The touch-pinch test runs only here; it is the "skipped by design" count in the other projects |
| `firefox` | Firefox 157 (the project owner's main browser; briefly removed from the tests on 2026-10-14 and restored). Note: `performance.now()` has 1 ms resolution on `file://` in Firefox, so frame times there are whole milliseconds. See [firefox.md](firefox.md) |

## Test logs

Each phase records commands, environment, measured values and defects in
`docs/testing/phase-*.md`. Full-suite results go there. Quick-suite runs are
not logged unless they find something.


## Test projects and loop counts

The browser projects are `chromium`, `chromium-cpu` (CPU rasterizer) and
`chromium-dpr2` (pixel ratio 2, touch), plus `firefox`. Firefox runs every spec, including the logic specs below; only the two extra Chromium projects skip them.

**Specs that run in `chromium` only** (`LOGIC_ONLY` in `playwright.config.ts`).
They are not removed: they test storage, archives and the asset library, which
do not depend on the rasterizer or the pixel ratio. Until now they also ran in
`chromium-cpu` and `chromium-dpr2`.

| Spec | What it covers |
| --- | --- |
| `storage.spec.ts` | Workspace, boards, canvases, saving, two-tab writer lease |
| `archive.spec.ts` | `.canvast` exports and imports, backups |
| `assets.spec.ts` | Asset catalog, sharing, garbage collection, Show |
| `organize.spec.ts` | Tags, favourites, folders in the asset library |

**Loop counts** (`reps(full, quick)`; before → now):

| Loop | Full | Quick |
| --- | --- | --- |
| Wheel zoom notches (`navigation`) | 1200 → 480 | 240 → 120 |
| Pan depth notches | 720 → 240 | 120 (same) |
| Pan drags per leg | 40 → 16 | 8 → 4 |
| Pinch (ctrl+wheel) | 300 → 120 | 60 (same) |
| Curvy stroke zoom steps (`deep-zoom-rendering`) | 240 (same) | 120 → 90 (60 did not reach the exact path at pixel ratio 2) |
| Image key presses | 750 → 300 | 150 (same) |

The 1,200-notch coverage moved into one full-suite test in `chromium` only
("very long wheel zoom": 2,000 notches in and 2,000 out, about 3.5 min).
The old counts are kept here for reference.
