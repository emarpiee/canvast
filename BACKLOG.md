# Backlog

The work on canvast that is not done yet, and what became of each item. **Priority** is high, medium or low; **Status** is open (still to do, or waiting for a decision), closed (done, in the version named) or removed (dropped, or found done before it was tracked, with the reason). Closed and removed items stay as the record. What has shipped is in [CHANGELOG.md](CHANGELOG.md); how this file is kept is in [CLAUDE.md](CLAUDE.md#backlog-format).

| ID | Item | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| B31 | The Linux AppImage starts on systems without libfuse2: it carries the newer AppImage runtime, which needs no FUSE library of the system (the AppImage catalog's test flagged the old one) | high | open | Before the other rows, the owner's order (2026-11-22): next after the Pins pass. Swap the runtime in `scripts/package-desktop.mjs`, which already writes the update address into it; [catalog PR](https://github.com/AppImage/appimage.github.io/pull/12345) |
| B2 | The library scrolls smoothly at small thumbnail sizes (size 96: about 40 frames a second since 0.60.13, was under 30; 60 at size 240 and in the list) | high | open | `--scroll` in the *Bench library* workflow; what is left is mostly painting the pictures |
| B24 | A setting changed just before a reload sometimes comes back as it was (the canvas pattern, the canvas background colour) | high | open | Found by `frames.spec.ts:1487` and `:2453` failing on reload on GitHub (three times); cause not found yet; also `frames.spec.ts:1236` (bookmarks gone after a reload, chromium-dpr2, 0.60.24; passed on re-run) |
| B29 | canvast works without a window, as other command-first apps do: the canvast tools render and export a canvas, run a script of commands and list the commands from the command line, and an AI agent can use canvast headless as well as attached to the open app | high | open | Proposed: a hidden desktop window runs the same commands (`canvast-tools render \| export \| run \| commands`, `mcp` headless); compared with FigCraft's CLI and MCP 2026-11-17 |
| B3 | Faster test runs: each change runs only the tests whose code it touches, found from recorded coverage | medium | open | Approved, not started |
| B4 | A vector network can have a fill for each closed region, not one fill for the whole network | medium | open | A limit listed in the README |
| B5 | Check whether a vector network adds a point where two of its lines cross, so the regions they make are separate | medium | open | The README no longer lists this limit; confirm in the code, then close or keep |
| B6 | The next release (a minor version), with the patches since the last one | medium | open | On the owner's go |
| B7 | PhotoCraft: a brush stroke lands where the pointer is on a display scaled above 100% | medium | open | Seen only with an emulated pixel ratio of 1.5; to check on a real scaled display |
| B8 | Flaky end-to-end tests: check `dock.spec.ts:38` (a panel dropped at the right edge left Tags hidden), watch `frames.spec.ts:1850` and `photocraft.spec.ts:153` (an older version of a saved picture still listed when checked) | medium | open | 0.60.13 fixed the `tiles.spec.ts` ones (the text font arriving mid-test); a test that fails again is fixed, not re-run; `photocraft.spec.ts:153` was two PhotoCraft saves overlapping (fixed in 0.61.1: saves run one after another), watch it; failed once on 0.61.1 and passed on re-run: `tiles.spec.ts:99` (no tile frame yet, chromium-cpu), `storage.spec.ts:370` (3 `canvast` keys left after Start from scratch, perhaps a save after the clear), Pan and zoom `wheel-zoom-slow` p95 33 ms |
| B27 | No lags or hangs in a large workspace (about 20,000 items: half hidden, half not) when locking and unlocking hidden mode or going in and out of it | medium | open | Benchmark first (on GitHub), then investigate and report before any fix |
| B28 | AI agents work with fewer, clearer commands: change any item by its id (fill, outline, text colour, position, size) without selecting it, a text's colour on `item.create`, a batch answer that counts what it made instead of listing every id, and every command saying when it did nothing | medium | open | Found while an agent drew pixel art (0.60.19–0.60.23) |
| B30 | Panning and zooming stay smooth with adjustments on the canvas (blur, pixelate and the other adjustment shapes): today they make the view lag | medium | open | Reported by the owner 2026-11-17: investigate first (which adjustments, how many, at what zoom), then fix |
| B9 | Hiding and showing big hidden items faster (about 30 to 60 MB/s today) | low | open | Waits for a decision: encrypting in the desktop app's main process means the key leaves the page |
| B10 | Speed and memory measured on real devices (an older laptop, a phone), not only on the test machine | low | open | The benchmarks and the qualification matrix exist and were run on the test machine |
| B11 | The Retroma theme | low | open | Parked on the `retroma-v4` branch until the owner resumes it |
| B12 | Math in notes (formulas) | low | open | On hold |
| B26 | The Layers panel's row buttons show which state they are in: today some icons (such as the clipping and the frame toggles) look the same whether on or off | low | open | Icon audit of every Layers panel toggle first |
| B1 | README pictures for the newest features: the ZIP and comic book viewer, maybe the rename and move progress notice | high | closed | 0.60.16: the ZIP and comic book view's section and picture (a progress notice is too brief to picture) |
| B13 | Builds for Windows and macOS open for contribution, with terms for them | medium | closed | 0.60.12: [Builds for other systems](CONTRIBUTING.md#builds-for-other-systems) |
| B23 | Better-formatted release notes on GitHub: a summary first, then a part for users and one for developers | high | closed | 0.60.13 |
| B25 | Every action in the app can be run as a command (by name, with its options), ready for an MCP server: first a check of the whole app, then a report of which actions are commands already and what moving the rest takes | high | closed | 0.60.15: every action is a command (none left outside the rule), with the link to AI agents |
| B14 | Choose what goes in a backup (Advanced export) | medium | removed | Found done: 0.55.34 |
| B15 | A font's "Aa" on its card on a canvas | low | removed | Found done: 0.50.40 |
| B16 | Search keywords in the library and on the canvas | medium | removed | Found done: 0.50.40 |
| B17 | A deleted library file goes to the workspace's trash at once | low | removed | Found done: 0.55.13 |
| B18 | Undoing a delete brings the items back selected | low | removed | Found done: 0.50.40 |
| B19 | Start-up and search benchmarks, and the qualification matrix | low | removed | Found done: run and recorded in `docs/testing/` |
| B20 | Open questions kept from the notes editor's first version | low | removed | Dropped by the owner |
| B21 | An `@` shortcut in notes | low | removed | Dropped: notes have the `/` commands |
| B22 | A node editor for vectors and objects | low | removed | Dropped: an idea, not planned |
