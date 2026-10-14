# ADR 0026 — Electron AppImage: tried and shelved

- Status: shelved (tried and removed on 2026-10-14; the single HTML file stays the only shipped form)
- Related: ADR 0002 (single-file build), engineering plan §16 Phase 9 (standalone release)

This records an experiment so it does not look like it appeared and vanished without a reason.

## What was tried

The owner asked to test an Electron wrapper for Linux as an AppImage, to see whether the app could ship as a portable desktop program. Built on a branch (`exp/electron`, since deleted), merged for a short while, then removed:

- `electron/main.cjs`: a window that opens `dist/canvast.html` from disk, with no menu, no preload script, no Node in the page (context isolation and sandbox on), navigation and new windows denied, permission requests denied, and every request that is not `file:`, `data:`, `blob:` or `devtools:` cancelled, the same rule the end-to-end tests enforce in the browser.
- electron-builder (26.15) with an AppImage target, Electron 44.7.2, x86_64 only. Scripts `npm run electron` and `npm run dist:appimage`; the result was a 125 MB `canvast-0.8.0-x86_64.AppImage` (the version at the time).
- Conveniences for a window without a menu: `CANVAST_DEBUG=1` opened the `#debug` panel and DevTools, F12 and Ctrl+Shift+I toggled DevTools, F5 and Ctrl+R reloaded.
- Checks: the packaged app and the AppImage were launched under Playwright's Electron support. The page loaded, drew, zoomed, created its IndexedDB database and made no outside requests.
- Test suite: the Firefox E2E project was dropped (Chromium is Electron's engine) and the suites were made cheaper (kept: Chromium-only specs for logic and storage, smaller loops, one long full-only run). A full run on three Chromium projects took 21 min 44 s.

Commits (all in the history of `main`): `a5d02e7` shell and AppImage build, `4fa41ac` debug switch, `572a2fa` DevTools keys, `ac7effe` reload keys, `36dc487` the full-suite record; merged in `a766218`; removed in `723f71c`.

## Why it was shelved

The owner decided to keep to the original pipeline, a single self-contained HTML file tested in browsers, and not to add OS-specific test cases. What the experiment showed:

- The E2E tests run in Playwright's own Chromium, not in Electron. Passing there does not prove the Electron build passes: its Chromium version and sandbox differ, and **Windows is a different stack again** (Direct3D canvas, fonts, wheel and pixel-ratio behaviour). Real confidence would need the specs run against the packaged app on each OS.
- An AppImage is Linux x86_64 only, needs FUSE 2 (or `--appimage-extract-and-run`), and on some distributions the Chromium sandbox needs user-namespace support.
- It added about 500 MB of build output and a large dependency tree to a project whose point is one small file with no runtime dependencies.

## What was kept

The cheaper test suites and the test-writing rule in `CLAUDE.md`. Firefox came back as a test project (the owner's main browser): `f46bbfa`.

## How to revive it

Check out the commits above (`git show a5d02e7`), restore `electron/main.cjs` and the `package.json` scripts and build section, run the E2E specs against the packaged app with Playwright's `_electron` launcher, and decide the cross-OS test matrix first. Windows and macOS builds were never made.
