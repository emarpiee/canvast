# Camera travel and bookmark keys (v0.26.0)

Run (snapshot, `npm run test:snap -- tests/e2e/bookmarks.spec.ts tests/e2e/navigation.spec.ts tests/e2e/settings.spec.ts`, all projects): 89 passed, 7 skipped, 0 failed, 6.2 min.

New tests (`bookmarks.spec.ts`, Chromium 10.4 s for the whole file):
- a far trip dives (passes through the levels between) and *Glide near only* / *Cut* arrive at once;
- a short trip with linear easing and fixed time reaches the same place;
- `Alt+n`, `]`, `[`, reorder from the menu and by drag, a bookmark of the picked things (camera unchanged), a tour that moves on by itself.

Not run: the full suite; a heavy canvas during a dive.

v0.26.1: bookmarks.spec + settings.spec, all projects: 40 passed, 1.6 min (fade dip checked).
