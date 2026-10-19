# Phase 9 — standalone release: slices 1 to 4 (2026-10-20)

Slices 5 (README and licences) and 6 (release artifact) wait for the owner's changes.

| # | Slice | Check | Result |
| --- | --- | --- | --- |
| 1 | Reproducible build | `npm run check:repro` (`scripts/check-repro.mjs`): clones HEAD twice into different folders (one deep), `npm ci`, builds under different time zones and locales, compares the SHA-256 of `canvast.html`. Also fails if a dependency is not an exact version. `.nvmrc` records Node 26.4.0 | **Pass:** identical at `912591b` (`610b250c6578…`), and the same hash as `dist/` built from the working tree. Earlier at `4fb44a4`: `51f097a1…` both |
| 2 | Offline completeness | `scripts/check-offline.mjs` (runs on every snapshot): no external attribute, CSS or code reference; every absolute URL string in the file is on a known list (XML namespaces, licence text, one credit, one placeholder); the page's CSP must keep `default-src`, `connect-src`, `base-uri`, `form-action` at `'none'` and allow no `unsafe-eval`, no `http:` and no `*`. `base-uri` and `form-action` were added to the CSP. Checked to fail on an injected URL and a loosened CSP. The app has no Worker and no WASM, so nothing of that kind needs bundling | **Pass** |
| 3 | Clean-machine test | `tests/e2e/release.spec.ts`: the built file alone in a new folder named with spaces and a symbol, a new profile with the network off; pen, shape, text, picture, deep zoom out and in, reload (same objects), PNG of everything, SVG and PDF of a vector, workspace backup; asserts no request, no CSP violation (`securitypolicyviolation`), no console or page error | **Pass** in Chromium and Firefox. A manual run on the owner's own machine is still theirs to do |
| 4 | Project portability | Same spec: a workspace written by Chromium is imported by Firefox, and the archive Firefox writes is imported by Chromium; every canvas (ids, exact anchors, views, bookmarks) compared equal. The same-browser profile round trip is `archive.spec.ts`; the replaced or moved file is `upgrade.spec.ts` and [storage-origin.md](../reference/storage-origin.md) | **Pass** (Chromium project runs both engines) |

Durations: `release.spec.ts` 23 s for 3 tests plus 1 skipped (Firefox project; the cross-engine test runs once, in the Chromium project). Wide run with archive, files and text specs: 66 passed in 5.7 min (Chromium and Firefox).

Run: `npm run check:repro` (needs the network once, for `npm ci`; commit first, it builds HEAD); the rest runs in every `npm test` / `test:snap`.
