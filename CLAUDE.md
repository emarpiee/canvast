# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

canvast: an offline-first endless canvas (unbounded pan and zoom, drawing, images) that ships as **one self-contained HTML file** opened from `file://`. No server, no network, no runtime dependencies. TypeScript + Canvas 2D, bundled by esbuild. `README.md` describes only what exists; `docs/status.md` is the single source of truth for roadmap/status (each milestone reported as Implemented / Tested / Known failures / Unverified / Committed / Next bounded task). Design decisions live in `docs/adr/`.

The repo sits inside an Obsidian vault synced by Syncthing; the parent vault's CLAUDE.md does not apply to this code.

## Commands

```sh
npm run build            # dist/canvast.html (production, minified)
npm run build:debug      # dist/canvast-debug.html (inline source maps)
npm run typecheck
npm run test:unit        # Vitest, ~15 s
npx vitest run tests/unit/camera.test.ts       # one unit file
npm run build && npx playwright test -g "<name>"            # selected E2E tests (quick length)
npx playwright test -c playwright.full.config.ts -g "<name>"  # one test, full length
npm test                 # typecheck + unit + quick E2E (3 Chromium + Firefox) + offline + naming checks, ~16 min
npm run test:full        # same with full stress loops, ~50 min
npm run bench            # scale benchmarks 1K–1M objects (not a gate)
```

Which suite when (see `docs/testing/README.md`):
- `npm test` after ordinary changes and before committing a slice/milestone.
- `npm run test:full` **only** when a whole phase is complete; record results in `docs/testing/phase-*.md`.
- E2E runs against the built `dist/canvast.html`, so rebuild before Playwright. **Never rebuild `dist/` while a suite is running** (each test reloads the file).

## Test rules

- E2E opens `dist/canvast.html#debug` from `file://` and fails on any request other than `file:`/`data:`/`blob:`. Tests drive the app through `window.__canvastDebug` (`src/app/debug-hook.ts`, enabled by `#debug`).
- Projects in `playwright.config.ts`: `chromium`, `chromium-cpu` (GPU off), `chromium-dpr2` (DPR 2 + touch), `firefox` (the owner's main browser; file:// IndexedDB and input differ from Chromium).
- `LIMITS` in `tests/e2e/harness.ts` were fixed before runs and are **never loosened** to make a test pass.
- Write loop counts with `reps(full, quick)` from the harness. Don't assume a fixed zoom depth from wheel notches (DPR-dependent); use keyboard steps or measured values.
- `app.drag` / `app.wheel` assert input starts on the canvas.
- Image fixtures are generated in code (`tests/e2e/png.ts`); no binary fixtures.
- `npm run check:names` (`scripts/check-names.mjs`) fails if certain external reference-product names (base64-encoded in the script) appear in any first-party file. Don't name other canvas/reference apps in code, docs or commits.

## Architecture (big picture)

- **Exact world coordinates** (ADR 0001): positions are `Dyadic` numbers (BigInt mantissa · 2^exponent, `src/core/dyadic.ts`); the camera (`src/core/camera.ts`) is a centre plus an integer-quantized log2 zoom, so zoom/pan are exactly reversible at any depth. Never introduce plain-float world coordinates; convert to doubles only relative to the camera/cell for drawing.
- **Projection is shared** (`src/render/projection.ts`): drawing and hit-testing use the same object→screen projection, so what you see is what you pick. Deep magnification falls back to exact arithmetic (`stroke-coverage.ts`).
- **Spatial index** (`src/scene/spatial-index.ts`, ADR 0004): multi-scale levels × BigInt cells, no world bounds; `scene-view.ts` queries visible objects, skips sub-pixel content (LOD) and batches identical strokes.
- **Edit data flow:** input → transient preview (never stored) → on pointer-up one validated `Transaction` → `DocumentStore` mutates and reports changed ids → spatial index updates → redraw → 150 ms debounce → per-object, revision-checked IndexedDB commit, read back to verify (`storage/canvas-persistence.ts`).
- **Storage** (ADR 0006–0008): IndexedDB `canvast` (schema in `storage/idb.ts`), Workspace → Boards → Canvases (`workspace-repo.ts`), multi-tab writer lease so a stale tab can never overwrite newer data (`writer-lease.ts`), v0.0.x migration (`migrate-v1.ts`). Assets are content-addressed by SHA-256 and stored once; placed images are instances. Originals are erased only by reference-checked GC once undo can no longer need them. `.canvast` archives are uncompressed ZIPs (`zip.ts`, `archive.ts`) verified fully before a single-transaction import.
- **Build** (`scripts/build.mjs`): esbuild IIFE inlined into `src/index.html` with `src/styles.css`; `__CANVAST_DEBUG__` / `__CANVAST_VERSION__` are compile-time defines; Lucide SVG icons are imported as text. The page CSP is `default-src 'none'; connect-src 'none'`, and `check:offline` rejects any external `src`/`href`/`url()`/fetch in the output.
- TS config is strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.

## Workflow

- Work happens in phases/slices (see `docs/status.md`); a finished slice bumps `package.json` version, updates `CHANGELOG.md`, `docs/status.md`, README and its test log, and is committed as `feat(<area>): ... (vX.Y.Z)`.
