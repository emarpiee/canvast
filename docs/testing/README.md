# Testing guide — which suite to run, and when

canvast has one set of end-to-end (E2E) tests, in **groups** (below), that runs in two lengths. Only the length of the stress loops
differs (for example 240 instead of 1,200 wheel notches). Run the groups a change needs, not everything.

| Command | What it runs | Time (reference machine) | When to run it |
| --- | --- | --- | --- |
| `npm run test:affected` | The E2E groups the changes since `origin/main` need (commits not on it and uncommitted edits; `-- --since <ref>` for another base, `-- --dry` to see what and how long first) | from ~1 min (smoke only) to the whole quick suite | **The default.** After a change, before committing a slice, before a push and a release |
| `npm test` | Typecheck, unit tests, `test:affected`, tokens, storage, picker and pattern-generator checks | as `test:affected` + ~2 min | Before committing a finished slice |
| `npm run test:group -- <group…>` | Named groups (`all` for every one), quick lengths | as the groups | To re-run a group after a fix, or to check an area on purpose |
| `npm run test:all` | Every group at quick lengths (the former `npm test`) | ~60 min (1259 tests, v0.28.0) | When the shared heart of the app or the test machinery changed (`test:affected` then picks it by itself), or every few releases to catch drift |
| `npm run test:full` | Every group with the **full** stress loops | ~1.5 h (1318 tests, v0.35.1; see `full-run-0.35.1.md`) | **Only when a phase changed zoom, coordinates, projection, rendering, tiles or performance**, before its release; record the result in that phase's test log |
| `npm run check:groups` | Every spec is in exactly one group | instant | Runs inside `test:affected`; after adding a spec |
| `npm run test:snap -- <args>` | Playwright against a snapshot build of its own in `test-builds/` (the same tests; every suite goes through it, so no test reads `dist/`). `npm run test:status` shows each snapshot against the source and `dist/` | as the tests chosen | **Whenever work goes on while tests run** (the default way to run E2E during a session) |
| `npm run test:unit` | Unit tests only (Vitest) | ~15 s | While developing |
| `npm run test:snap -- -g "<name>"` | Selected quick E2E tests (a bare `npx playwright test` fails on purpose: it has no snapshot) | seconds + build | While developing a specific feature |
| `npm run bench` | Scale benchmarks, 1K–1M objects, plus tile-cache benchmarks (tiles on/off; pan, still, pan+zoom) in Chromium, Chromium CPU-only and Firefox. Not a pass/fail gate | ~15–25 min (not yet timed with Firefox; tile benchmarks alone 2.2 min) | After rendering or performance changes; compare with `metrics/bench-*.json`, `metrics/tiles-*.json`, docs/testing/phase-0c.md and phase-1d.md |

## Groups

`scripts/lib/test-groups.mjs` puts every spec in one group and says which changed files need which groups. `smoke` always runs.

| Group | Specs |
| --- | --- |
| navigation | navigation, zoom-controls, deep-zoom-rendering, depth-suite, extreme-depth, bookmarks, frames |
| drawing | editing, vectors, text, sheets, styles, pattern |
| rendering | tiles, density, lowmem |
| pictures | pictures, files, screenshot |
| library | assets, organize, library-folder |
| storage | storage, archive, upgrade |
| desktop | desktop |
| interface | settings, dock, a11y, icon-audit, scrub-audit |
| packages | colour-picker, colour-picker-package, patterns-package |
| smoke | scenarios, release |

| Changed | Groups |
| --- | --- |
| A spec | its group |
| `src/storage/`, `src/assets/` (catalog, library) | storage, library, desktop (the desktop-only storage files: desktop) |
| `desktop/`, the desktop build and package scripts | desktop |
| `src/core/`, `src/scene/`, `src/render/` | navigation, rendering, drawing, pictures |
| `src/doc/`, `src/interaction/`, `src/text/`, `src/gen/` | drawing (and pictures, packages where they reach) |
| `src/ui/` | interface and drawing; the library's views: library; backups: storage |
| `package.json` | smoke; a change to Playwright, esbuild, TypeScript or the scripts: everything; Electron: desktop |
| `src/app/main.ts`, `session.ts`, `debug-hook.ts`, `editor-state.ts`, `src/doc/model.ts`, `document-store.ts`, `src/styles.css`, the harness, `playwright.config.ts`, the build | **everything** |
| Docs, README, CHANGELOG, unit tests, `.gitignore` | none (unit tests and checks still run) |
| **Any file no rule names** | **everything** (a gap costs time, never coverage) |

A new spec goes into a group in `GROUPS` (`check:groups` fails until it does); a new source folder gets a rule. Every run keeps each
test's time in `test-builds/times.json`, which `test:affected` estimates from.

## Rules

1. **Run what the change needs.** `npm run test:affected` (or `npm test`) after a change and before a commit, push or release; the
   whole quick suite only when it picks every group or every few releases; the full suite only when a phase changed zoom,
   coordinates, projection, rendering, tiles or performance. (Decided with the project owner, 2026-10-28: the quick and full suites at
   every phase end cost hours for code they do not test. Before: full suite at every phase end, decided 2026-10-13.)
2. **Tests never use `dist/`.** Every suite builds a snapshot of its own in
   `test-builds/` (`scripts/test-snap.mjs`) and opens that, so `dist/` (the
   owner's build, in development) can be rebuilt at any time and a rebuild
   cannot mix two versions in one result. `tests/e2e/build-dir.ts` refuses to
   run without a snapshot.
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
| `desktop` | The desktop shell (ADR 0177): `desktop.spec.ts` only, which launches the snapshot's own Electron build (`<snapshot>/desktop/`, made by `test:snap`) on a fresh workspace folder with a hidden window. No other spec runs here, and the browser projects skip it |

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

## WebKit (Safari)

Out of scope, by decision of the project owner (2026-10-19): WebKit is not installed, not planned, and not a Playwright project. Safari and every iPhone browser are unsupported and unverified.
