# Testing guide — which suite to run, and when

canvast has one set of end-to-end (E2E) tests that runs in two lengths. Every
test runs in both; only the length of the stress loops differs (for example
240 instead of 1,200 wheel notches).

| Command | What it runs | Time (reference machine) | When to run it |
| --- | --- | --- | --- |
| `npm test` | Typecheck, unit tests, **quick** E2E suite (3 browser configs), offline and naming checks | ~8 min (E2E 7.7 min) | **After every ordinary change**, before pushing a branch |
| `npm run test:full` | The same, with the **full** E2E stress loops | ~35 min (E2E ~29 min) | **Before committing the end of a phase or milestone**; record the result in that phase's test log |
| `npm run test:unit` | Unit tests only (Vitest) | ~15 s | While developing |
| `npx playwright test -g "<name>"` | Selected quick E2E tests | seconds | While developing a specific feature |
| `npm run bench` | Scale benchmarks, 1K–1M objects (not a pass/fail gate) | ~10 min | After rendering or performance changes; compare with `metrics/bench-*.json` and docs/testing/phase-0c.md |

## Rules

1. **Never skip the full suite before a phase commit.** The quick suite
   catches almost every defect, but the full one is the record that the spec's
   "hundreds of successive gestures" requirements hold.
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
| `chromium-dpr2` | DPR 2, touch enabled. The touch-pinch test runs only here; it is the 2 "skipped by design" in the other projects |

## Test logs

Each phase records commands, environment, measured values and defects in
`docs/testing/phase-*.md`. Full-suite results go there. Quick-suite runs are
not logged unless they find something.
