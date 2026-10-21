# Camera travel and bookmark keys (v0.26.0)

Run (snapshot, `npm run test:snap -- tests/e2e/bookmarks.spec.ts tests/e2e/navigation.spec.ts tests/e2e/settings.spec.ts`, all projects): 89 passed, 7 skipped, 0 failed, 6.2 min.

New tests (`bookmarks.spec.ts`, Chromium 10.4 s for the whole file):
- a far trip dives (passes through the levels between) and *Glide near only* / *Cut* arrive at once;
- a short trip with linear easing and fixed time reaches the same place;
- `Alt+n`, `]`, `[`, reorder from the menu and by drag, a bookmark of the picked things (camera unchanged), a tour that moves on by itself.

Not run: the full suite; a heavy canvas during a dive.

v0.26.1: bookmarks.spec + settings.spec, all projects: 40 passed, 1.6 min (fade dip checked).

Dive frame times (a far trip, 5000 levels away, 25 pen strokes on the canvas, 3.5 s, measured once with a throw-away spec, not kept):
- Chromium: 214 frames, p50 16.7 ms, p95 16.8 ms, max 16.8 ms (steady 60 fps).
- Firefox: 169 frames, p50 17.1 ms, p95 33.8 ms, max 72.4 ms (a few dropped frames, one hitch).
Not measured: a canvas with thousands of objects or large pictures.
