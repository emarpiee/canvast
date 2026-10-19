# Qualification 2026-10-19, v0.21.0 at 5ab1374

Suite: **quick**. Made by `npm run qualify` from the snapshot `test-builds/20261019-1346-0bc8cbe3`.

## Machine

linux 7.0.13-200.fc44.x86_64; 4 × Intel(R) Core(TM) i5-4460  CPU @ 3.20GHz; 15.5 GB; node v26.4.0; Playwright 1.64.0.

## Checks

| Check | Result | Seconds |
| --- | --- | --- |
| typecheck | ✅ pass | 2 |
| unit | ✅ pass | 68 |
| tokens | ✅ pass | 1 |
| names | ✅ pass | 0 |
| offline | ✅ pass | 0 |
| picker | ✅ pass | 0 |

## E2E matrix

| Project | Browser | Passed | Failed | Flaky | Skipped | Time |
| --- | --- | --- | --- | --- | --- | --- |
| chromium | 156.0.8078.4 | 353 | 1 | 0 | 2 | 16.0 min |
| chromium-cpu | 156.0.8078.4 | 194 | 1 | 0 | 2 | 10.0 min |
| chromium-dpr2 | 156.0.8078.4 | 195 | 1 | 0 | 1 | 11.7 min |
| firefox | 157.0 | 345 | 2 | 0 | 9 | 26.1 min |

### Failures in chromium

- files.spec.ts:12 any file imports: a 3D model becomes a card on the canvas and in the library, with its extension chip and the buttons that fit it (ADR 0078) ([31mTest timeout of 180000ms exceeded.[39m)

### Failures in chromium-cpu

- files.spec.ts:12 any file imports: a 3D model becomes a card on the canvas and in the library, with its extension chip and the buttons that fit it (ADR 0078) ([31mTest timeout of 180000ms exceeded.[39m)

### Failures in chromium-dpr2

- files.spec.ts:12 any file imports: a 3D model becomes a card on the canvas and in the library, with its extension chip and the buttons that fit it (ADR 0078) ([31mTest timeout of 180000ms exceeded.[39m)

### Failures in firefox

- files.spec.ts:12 any file imports: a 3D model becomes a card on the canvas and in the library, with its extension chip and the buttons that fit it (ADR 0078) ([31mTest timeout of 180000ms exceeded.[39m)
- text.spec.ts:87 a double-click on a text that is already big on screen edits it where it is, and one too small to read is zoomed to a readable size (Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBeGreaterThan[2m([22m[32mexpected[39m[2m))
