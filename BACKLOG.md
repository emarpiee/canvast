# Backlog

The work on canvast that is not done yet, and what became of each item. **Priority** is high, medium or low; **Status** is open (still to do, or waiting for a decision), closed (done, in the version named) or removed (dropped, or found done before it was tracked, with the reason). Closed and removed items stay as the record. What has shipped is in [CHANGELOG.md](CHANGELOG.md); how this file is kept is in [CLAUDE.md](CLAUDE.md#backlog-format).

| ID | Item | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| B1 | README pictures for the newest features (the ZIP and comic book viewer, folder *Move to…*, *Pasted picture name* in Settings, maybe the rename and move progress notice), and new ones for the PDF, 3D and sidebar pictures that show an older look | high | open | The ZIP viewer's section and pictures wait for the owner's approval of its look |
| B23 | Better-formatted release notes on GitHub | high | open | Owner request 2026-11-16; the format to be agreed with the owner |
| B2 | The library scrolls smoothly at large thumbnail sizes (measured at 35 frames a second at size 96) | high | open | Benchmark on the `bench-scroll` branch |
| B3 | Faster test runs: each change runs only the tests whose code it touches, found from recorded coverage | medium | open | Approved, not started |
| B4 | A vector network can have a fill for each closed region, not one fill for the whole network | medium | open | A limit listed in the README |
| B5 | Check whether a vector network adds a point where two of its lines cross, so the regions they make are separate | medium | open | The README no longer lists this limit; confirm in the code, then close or keep |
| B6 | The next release (a minor version), with the patches since the last one | medium | open | On the owner's go |
| B7 | PhotoCraft: a brush stroke lands where the pointer is on a display scaled above 100% | medium | open | Seen only with an emulated pixel ratio of 1.5; to check on a real scaled display |
| B8 | Flaky end-to-end tests: fix `tiles.spec.ts:99` (it repeats on the CPU and pixel-ratio-2 set-ups), check `dock.spec.ts:38` (a panel dropped at the right edge left Tags hidden), watch `frames.spec.ts:1850`, `tiles.spec.ts:257`, `tiles.spec.ts:340` | medium | open | A test that fails again is fixed, not re-run |
| B9 | Hiding and showing big hidden items faster (about 30 to 60 MB/s today) | low | open | Waits for a decision: encrypting in the desktop app's main process means the key leaves the page |
| B10 | Speed and memory measured on real devices (an older laptop, a phone), not only on the test machine | low | open | The benchmarks and the qualification matrix exist and were run on the test machine |
| B11 | The Retroma theme | low | open | Parked on the `retroma-v4` branch until the owner resumes it |
| B12 | Math in notes (formulas) | low | open | On hold |
| B13 | Builds for Windows and macOS open for contribution, with terms for them | medium | closed | 0.60.12: [Builds for other systems](CONTRIBUTING.md#builds-for-other-systems) |
| B14 | Choose what goes in a backup (Advanced export) | medium | removed | Found done: 0.55.34 |
| B15 | A font's "Aa" on its card on a canvas | low | removed | Found done: 0.50.40 |
| B16 | Search keywords in the library and on the canvas | medium | removed | Found done: 0.50.40 |
| B17 | A deleted library file goes to the workspace's trash at once | low | removed | Found done: 0.55.13 |
| B18 | Undoing a delete brings the items back selected | low | removed | Found done: 0.50.40 |
| B19 | Start-up and search benchmarks, and the qualification matrix | low | removed | Found done: run and recorded in `docs/testing/` |
| B20 | Open questions kept from the notes editor's first version | low | removed | Dropped by the owner |
| B21 | An `@` shortcut in notes | low | removed | Dropped: notes have the `/` commands |
| B22 | A node editor for vectors and objects | low | removed | Dropped: an idea, not planned |
