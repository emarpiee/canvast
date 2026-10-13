# canvast

canvast is an offline-first **endless canvas**: you can pan in any direction
and zoom in or out without hitting a boundary or a zoom stop. The finished
app ships as **one self-contained HTML file** that works from `file://` with no
server, account or network connection.

> **Status: Phase 0A — endless navigation prototype.** The current build
> proves the navigation foundation: panning, anchored zoom, an exact
> coordinate model, rendering that works on the CPU, and an automated test
> harness. Editing, documents, storage, assets and media are **not implemented
> yet**; see [Roadmap and status](docs/status.md). This README describes only
> what exists.

## What works today

- **Endless zoom in both directions.** There is no minimum or maximum zoom.
  The automated suite covers 1,000 levels of wheel zoom (≈10^301) in each
  direction, and navigation at depths of 2^±9000 (≈10^±2709).
- **Endless pan.** There is no world rectangle or edge, and the camera never
  recenters behind your back. Coordinates are exact at any distance, including
  2^5000 units from the origin.
- **Anchored zoom.** The point under the pointer, or under the pinch centre,
  stays put. On the test machine the measured drift is below 0.01 CSS px; see
  [test results](docs/testing/phase-0a.md).
- **Exact round trips.** If you zoom far out and back in at the same pointer,
  or pan and pan back, you return to the same pixels.
- **Inputs:** mouse wheel; trackpad pinch (ctrl+wheel); shift+wheel to pan;
  drag with the primary or middle button; two-finger touch pinch and pan;
  keyboard; on-screen zoom and Home buttons.
- **Orientation aids:** a hierarchical grid that fades continuously between
  scales, the world axes, nested reference squares at the origin every 8
  binary orders of magnitude, and a few distant landmarks. A live read-out
  shows the zoom level and position.
- **CPU-only rendering** with Canvas 2D. No GPU, WebGL or WebGPU is needed.
- **A single offline file:** `dist/canvast.html` is about 16 KiB. It has a
  strict Content-Security-Policy that blocks all network access.

### Controls

| Action | Input |
| --- | --- |
| Zoom at pointer | Mouse wheel · trackpad pinch · ctrl+wheel |
| Pan | Drag (primary or middle button) · two-finger drag · shift+wheel · arrow keys (shift = larger steps) |
| Zoom at centre | `+` / `=` and `-` (shift = 4× step) · on-screen `+` / `−` |
| Return to origin | `0` · `Home` key · on-screen **Home** |
| Debug panel | open the file with `#debug` at the end of the URL |

## Terminology

**canvas** is the endless creative surface. **World coordinates** are the
authoritative positions of things on the canvas. The **camera** is the current
view: its centre in world coordinates plus a zoom level. A **zoom level** of
`z` means 2^z CSS pixels per world unit; each +1 doubles the magnification.
The planned organization is Workspace → Boards → Canvas, with separate Canvas
and Assets views. None of that is implemented yet.

## Quick start

Prerequisites: Node.js ≥ 22 (developed on 26.4) and npm.

```sh
npm ci                     # install pinned dev dependencies
npm run build              # → dist/canvast.html (production, minified)
npm run build:debug        # → dist/canvast-debug.html (source maps, debug panel)
```

Open `dist/canvast.html` directly in a browser, by double-clicking it or with
`file:///…/dist/canvast.html`. No development server is needed. You can copy
that single file anywhere, and it runs without this repository or a network
connection.

### Verifying offline operation

- `npm run check:offline` statically scans the built file for any external
  `src`, `href`, CSS `url()`/`@import` or code-level fetch, and fails if it
  finds one.
- The end-to-end (E2E) suite opens the built file from `file://` and fails if
  the page makes any request other than `file:`, `data:` or `blob:`.
- At runtime, the page's CSP (`default-src 'none'; connect-src 'none'`) blocks
  network access even if code tried it.
- By hand: disconnect the network, open the file, and pan and zoom.

## Testing

```sh
npm run typecheck          # TypeScript, strict
npm run test:unit          # Vitest: exact arithmetic + camera invariants
npm run test:e2e           # builds, then Playwright against file://dist/canvast.html#debug
npm run check:names       # naming policy: no external product names in first-party text
npm test                   # all of the above + offline check + naming check
```

The E2E suite runs every test in three Chromium configurations: the default,
GPU disabled (`--disable-gpu --disable-accelerated-2d-canvas`), and
devicePixelRatio 2 with touch. Measurements are written to
`metrics/*.json` (gitignored). Thresholds were fixed before the runs in
`tests/e2e/harness.ts` (`LIMITS`) and are never loosened after a run.

Measured results, the reference hardware and known caveats are in
[docs/testing/phase-0a.md](docs/testing/phase-0a.md). In summary: 25/25 unit
tests and 22 of 22 applicable E2E cases pass. The touch case is skipped by
design in the 2 projects without touch. In the wheel tests, anchor drift was
≤ 2.8e-14 px and the round-trip error was 0. Render p95 was 1.5–2.5 ms in every configuration, including with
the GPU disabled, on an Intel i5-4460 with integrated graphics. These are
measurements, not targets.

## Browser support and requirements

- Requires a browser with `BigInt`, Pointer Events, `ResizeObserver` and
  Canvas 2D. Roughly: Chromium ≥ 67, Firefox ≥ 68, Safari ≥ 14.
- **Tested** only in Chromium 156 (Playwright) on Linux. Firefox and Safari
  are **unverified** so far.
- No GPU features are used. Rendering is Canvas 2D only.
- Chromium delivers mouse and wheel events at whole CSS pixels, while touch
  and pen input keeps fractional positions. Both are anchored exactly.

## Architecture (Phase 0A)

```
src/
  core/dyadic.ts        exact m·2^e numbers (BigInt mantissa), conversion, serialization
  core/camera.ts        camera model, world↔screen, anchored zoom, pan, serialization
  scene/landmarks.ts    read-only reference squares used for orientation and tests
  render/canvas2d-renderer.ts   grid, axes, landmarks; CPU-compatible Canvas 2D
  interaction/navigation.ts     wheel/pointer/touch/keyboard → zoomAt/panBy
  app/view-state.ts     owner of the live camera + viewport (immutable snapshots)
  app/hud.ts            zoom/position read-out, zoom & home buttons, debug panel
  app/debug-hook.ts     inspection API for tests (debug builds or #debug only)
  app/main.ts           bootstrap, render scheduling, resize/DPR handling
  index.html, styles.css  template + design tokens (light/dark)
scripts/build.mjs       single-file build (esbuild bundle inlined into HTML)
scripts/check-offline.mjs  static scan for external references
tests/unit/             Vitest
tests/e2e/              Playwright navigation regression harness
docs/adr/               architecture decision records
docs/testing/           test logs with measured results
docs/status.md          roadmap and current status (single source of truth)
```

**The authoritative spatial model:** world coordinates are exact dyadic
rationals, and the camera is a dyadic centre plus a zoom level of the form
log2 (integer part + fraction). Rendering projects positions relative to the
camera centre, so no floating origin, rebasing step or renderer offset
exists to leak into saved data. Inputs are quantized, which makes every zoom
and pan operation exactly reversible. Why, and the limits:
[ADR 0001](docs/adr/0001-exact-dyadic-world-coordinates.md).
Renderer, language and build choices:
[ADR 0002](docs/adr/0002-cpu-first-canvas2d-and-single-file-build.md).

## Known limitations (honest list)

- **Precision budget.** After zooming out more than 4,096 binary levels
  (≈10^1233) beyond the deepest level you visited, zooming back in at the
  same pointer no longer returns to the exact sub-pixel spot. The position is
  still exact to 2^-96 px at the coarse scale. This tradeoff bounds memory
  and is tested.
- **Cost at depth.** Each camera operation costs a few `BigInt` operations on
  numbers with roughly |zoom level| + 96 bits. This is negligible at
  thousands of levels. Millions of levels would be slow and memory-hungry.
- **No content yet.** There is nothing to create, select, edit, save or
  import: that is Phase 0B and later. Landmarks are fixed test fixtures.
- **No persistence.** Reloading resets the camera.
- **Testing scope:** Chromium only, and one reference machine.

## Storage, backups, import/export

Not implemented yet. The camera already serializes losslessly
(`serializeCamera`), but nothing is stored.

## Security

- CSP: `default-src 'none'`. Only inline script and style are allowed. No
  `connect-src`, and `worker-src` is limited to `blob:`.
- The app makes no network requests and has no runtime dependencies.
- Camera input is validated: non-finite values are rejected and never stored.

## Licenses

canvast's own code has no published license yet (`UNLICENSED`). The shipped
HTML contains only first-party code. Development-only dependencies, which are
not shipped: TypeScript (Apache-2.0), esbuild (MIT), Vitest (MIT),
Playwright (Apache-2.0). Lucide icons are planned and will be bundled locally
with their ISC license notice.

## Contributing and workflow

Every change follows the same loop: pick one bounded slice, implement it,
run `npm test`, update this README and the docs with measured results, then
commit. A milestone isn't done until its tests pass and it is committed.
Releases record the SHA-256 of `dist/canvast.html`, which `npm run build`
prints.

## Milestone log

| Milestone | Result | Commit |
| --- | --- | --- |
| Phase 0A — endless navigation prototype | 25/25 unit, 22/22 E2E (2 by-design skips), offline + naming checks pass; `dist/canvast.html` v0.0.1 sha256 `1411e6d0…a92` | see `git log` |
