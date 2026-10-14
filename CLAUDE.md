# CLAUDE.md

## What this is

canvast: an offline-first endless canvas (unbounded pan and zoom, drawing, images) that ships as **one self-contained HTML file** opened from `file://`, and as a Linux **AppImage** (Electron shell in `electron/main.cjs`; `npm run electron`, `npm run dist:appimage`, output in `release/`; `CANVAST_DEBUG=1` opens the debug panel and DevTools; F12 / Ctrl+Shift+I toggle DevTools, F5 / Ctrl+R reload). No server, no network, no runtime dependencies. TypeScript + Canvas 2D, bundled by esbuild. `README.md` describes only what exists; `docs/status.md` is the single source of truth for roadmap/status (each milestone reported as Implemented / Tested / Known failures / Unverified / Committed / Next bounded task). Design decisions live in `docs/adr/`.

The repo sits inside an Obsidian vault synced by Syncthing; the parent vault's CLAUDE.md does not apply to this code.

## Testing

Which suite when (see `docs/testing/README.md` for commands and durations):
- `npm test` after ordinary changes and before committing a slice/milestone.
- `npm run test:full` **only** when a whole phase is complete; record results in `docs/testing/phase-*.md`.
- E2E runs against the built `dist/canvast.html`, so rebuild before Playwright. **Never rebuild `dist/` while a suite is running** (each test reloads the file).

## Test rules

- E2E opens `dist/canvast.html#debug` from `file://` and fails on any request other than `file:`/`data:`/`blob:`. Tests drive the app through `window.__canvastDebug` (`src/app/debug-hook.ts`, enabled by `#debug`).
- The app ships as an Electron AppImage (Chromium), so the E2E projects are the three Chromium configurations (`chromium`, `chromium-cpu`, `chromium-dpr2`). Firefox was dropped from the tests on 2026-10-14; the single HTML file still opens in Firefox from `file://`, but it is no longer tested there (history: `docs/testing/firefox.md`).
- `LIMITS` in `tests/e2e/harness.ts` were fixed before runs and are **never loosened** to make a test pass.
- Write loop counts with `reps(full, quick)` from the harness. Don't assume a fixed zoom depth from wheel notches (DPR-dependent); use keyboard steps or measured values.
- `app.drag` / `app.wheel` assert input starts on the canvas.
- Image fixtures are generated in code (`tests/e2e/png.ts`); no binary fixtures.
- **Break complex logic on purpose before calling it done.** For coordinate, frame, precision or other tricky logic, list what else could break it and add a small, fast test for each: every input path (wheel, keyboard and button zoom, drag and arrow pan, jumps, Home), both directions (zoom in *and* out, up *and* down), starting from Home and from deep, repeated actions (e.g. −1e12 five times, then zoom), with content on screen, plus a random fuzz with a per-step time limit. One path passing proves nothing about the others: after five −1e12 jumps, panning worked but wheel zoom hung. Reproduce reported bugs with real input in both browsers before claiming a fix.
- **Keep new tests cheap (session time is a budget).** A test says one thing; don't repeat what another spec already proves, extend that one instead. Use `reps(full, quick)` and keep quick loops small (tens, not hundreds); the full count is at most about twice quick, and a single long run (thousands of steps) goes in one test marked full-only and `chromium`-only. Prefer jumps, `setCamera` or keyboard steps over thousands of wheel notches (about 50 ms each). Logic, storage and archive specs belong in the `LOGIC_ONLY` list of `playwright.config.ts` (they run in `chromium` only); only specs that depend on the rasterizer or the pixel ratio run in all three Chromium projects. Before adding a long test, estimate its time (notches × 50 ms × projects) and state it.
- `npm run check:names` (`scripts/check-names.mjs`) fails if certain external reference-product names (base64-encoded in the script) appear in any first-party file. Don't name other canvas/reference apps in code, docs or commits.

## Architecture (big picture)

- **Exact world coordinates** (ADR 0001): positions are `Dyadic` numbers (BigInt mantissa · 2^exponent, `src/core/dyadic.ts`); the camera (`src/core/camera.ts`) is a centre plus an integer-quantized log2 zoom, so zoom/pan are exactly reversible at any depth. Never introduce plain-float world coordinates; convert to doubles only relative to the camera/cell for drawing.
- **Projection is shared** (`src/render/projection.ts`): drawing and hit-testing use the same object→screen projection, so what you see is what you pick. Deep magnification falls back to exact arithmetic (`stroke-coverage.ts`).
- **Deep zoom into any object** (`src/render/coarse.ts`): every kind of object needs a `SAMPLERS` entry (typed over all kinds, so a new kind fails to compile without one; `bboxSampler` is the default) so its colour never silently disappears when the view is inside it at depth. Never special-case one kind in the renderer.
- **Spatial index** (`src/scene/spatial-index.ts`, ADR 0004): multi-scale levels × BigInt cells, no world bounds; `scene-view.ts` queries visible objects, skips sub-pixel content (LOD) and batches identical strokes.
- **Edit data flow:** input → transient preview (never stored) → on pointer-up one validated `Transaction` → `DocumentStore` mutates and reports changed ids → spatial index updates → redraw → 150 ms debounce → per-object, revision-checked IndexedDB commit, read back to verify (`storage/canvas-persistence.ts`).
- **Storage** (ADR 0006–0008): IndexedDB `canvast` (schema in `storage/idb.ts`), Workspace → Boards → Canvases (`workspace-repo.ts`), multi-tab writer lease so a stale tab can never overwrite newer data (`writer-lease.ts`), v0.0.x migration (`migrate-v1.ts`). Assets are content-addressed by SHA-256 and stored once; placed images are instances. Originals are erased only by reference-checked GC once undo can no longer need them. `.canvast` archives are uncompressed ZIPs (`zip.ts`, `archive.ts`) verified fully before a single-transaction import.

## Workflow

- Work happens in phases/slices (see `docs/status.md`); a finished slice bumps `package.json` version, updates `CHANGELOG.md`, `docs/status.md`, README and its test log, and is committed as `feat(<area>): ... (vX.Y.Z)`.
