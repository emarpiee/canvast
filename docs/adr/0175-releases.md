# ADR 0175 — Releases: the built file as the latest GitHub release

- Status: accepted (v0.46.0)

## Decision

- **A release is the built single file.** `npm run release` (`scripts/release.mjs`) publishes `dist/canvast.html` (and `canvast.html.sha256`) as release `vX.Y.Z` of the GitHub repository, and marks it **Latest**. So `https://github.com/emarpiee/canvast/releases/latest/download/canvast.html` is always the newest app.
- **It is run by hand, after a push.** The script never pushes. It refuses unless the tree is clean, the branch is `main`, `HEAD` is what `origin/main` has, and `CHANGELOG.md` has a `## X.Y.Z — Title (date)` section for the version in `package.json`.
- **The file is built and checked first** (typecheck, build, `check:offline`, `check:names`, `check:tokens`), and `dist/build.json` must say it was made from this commit and version. A release is never made from a stale or dirty `dist/`.
- **Always the latest.** It never makes an older version the latest by itself: if a newer release is already the latest it stops (`--force` overrides). After publishing it reads the release back, requires `isLatest`, downloads the asset and compares its SHA-256 with the file built here. Running it again for the same commit replaces the file and notes (`--clobber`); for a tag that points elsewhere it stops (bump the version).
- **The notes are always split into Features and Fixes** (`scripts/lib/release-notes.mjs`, tested in `tests/unit/release-notes.test.ts`), read from the CHANGELOG: a bullet that starts with `**Fixed:**` is a fix; every other one (`**Added:**`, `**Changed:**`, `**Removed:**`, or none) is a feature. Both headings are always there (an empty one says so). They end with the SHA-256 and a link to the changelog between the two tags.
- `--dry-run` does everything but publish and prints the notes.

## Not built

A GitHub Actions workflow that publishes on a tag (a CI workflow, `.github/workflows/ci.yml`, checks every push and pull request, but does not release) (the build is reproducible, `npm run check:repro`, so it could be added); release candidates and pre-releases; signing.
