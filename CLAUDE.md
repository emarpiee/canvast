# CLAUDE.md

## What this is

canvast: an offline-first endless canvas (unbounded pan and zoom, drawing, images) that ships as **one self-contained HTML file** opened from `file://`. No server, no network, no runtime dependencies. TypeScript + Canvas 2D, bundled by esbuild. `README.md` is the one place for all user and technical documentation (no wiki, no pages): a professional manual of the app as it is now, ordered user-friendly intro → usage → data → limitations → technical → build/test/security; an API section will be added. It holds no history, versions, milestones, ADR numbers or phase names (those live in `CHANGELOG.md`, `docs/status.md`, `docs/adr/`); update it whenever behaviour or limitations change, and keep its Limitations section true; `docs/status.md` is the single source of truth for roadmap/status (each milestone reported as Implemented / Tested / Known failures / Unverified / Committed / Next bounded task). Design decisions live in `docs/adr/`.

This file is for coding agents working in the repo; it applies to this code only.

## README format

The README is the one place for documentation. It is built so that a new feature is one new block in a fixed place, never a rewrite. Keep these rules when adding to it.

**Fixed layout.** The banner and **Notes from the developer** (and `docs/creative-tools.md`) are the owner's words: never rewrite them. Then **Contents** (a two-column table: For users | For developers), then the two parts. *For users*: What you can do, Installation, Getting started, then one `##` area per kind of work (Reference boards, Drawing and vector editing, Comics and storyboards, The Library, Notes, Exporting and sharing, The endless canvas, Your workspace and data, Privacy and hidden items, The interface, settings and keys), then Limitations. *For developers*: How it works, API and file formats, Building from source, Testing, Releasing and project scripts, Contributing and support, Licence. A new area is rare: it needs a row in Contents and in *What you can do*.

| Level | What it holds | Rule |
| --- | --- | --- |
| Area (`##`) | One sentence, then a **Section \| What is in it** table linking each `###` | Add a row when you add a `###` |
| Feature (`###`) | What an artist uses it for (one sentence), its screenshot of that use, then how (a table) | Every feature with an interface has its own `###` (or `####` under a bigger one) |
| Detail (`####`) | Edge cases, rare options, long explanations, as a table | Shown in full, never folded |

**Adding a feature:** find the area it belongs to (one home per feature; elsewhere, link to it), add its `###` with the template above, add its row to the area's table, add a shot (below), add any limit to Limitations, and update *What you can do* only if the area's summary no longer fits.

| Format | Use it for | Rule |
| --- | --- | --- |
| Table | Options, parts, kinds, shortcuts, rules, anything with a name and an explanation | The default. Short cells; a two-column table with an empty header (`\| \| \|`) for name and explanation |
| Paragraph | How or why | At most 3 lines |
| Numbered list | Steps | Only when the order matters |
| Bullets | A plain list with no interface and no explanations (file names, a few facts) | Never for features; never `- **Name:** explanation` (that is a table row) |
| Screenshot | Every feature with an interface, small ones too (flip, corners, one Adjust control, a menu) | As many as the features need, after the sentence they illustrate, `alt` text saying exactly what it shows |

- **Never:** `<details>`, versions, release numbers, ADR numbers, phase names or history (they live in `CHANGELOG.md`, `docs/status.md`, `docs/adr/`), the owner's own files, paths, machine or interests.
- **Screenshots** are part of the documentation, not decoration. The rules:

| Rule | |
| --- | --- |
| Every feature | Every feature with an interface in any part of the app (the canvas, the Library, notes, hidden mode, settings, the desktop app, the tools) has its picture, small features too. Never choose a "shortlist" |
| A real use case | Each picture shows how an artist really uses that one feature (a mirrored drawing to check proportions, a greyscale copy as a value study, a lettered comic panel), with its own content. No forced storyline across pictures, no placeholder shapes, no repeated filler text |
| Designed content | Made like real work: fitting fonts (the OFL fonts in `scripts/showcase/fonts/`: Comic Neue for lettering, Bangers for shouts and titles, Caveat for handwritten notes, Cormorant Garamond for print labels and book titles, Space Grotesk), real comic balloons (white, black outline, lettering in capitals, sized to the words, tail to the speaker), proper zoom and framing |
| Words match the picture | The section's text and the `alt` text describe exactly what the picture shows; words about an artwork are true to it (its title, artist and date in `art.json`) |
| Small and focused | Cropped to the feature (`scene.around()`), WebP, about 80 KB or less; many small pictures are better than one busy one |
| Content | Public-domain art from `scripts/showcase/art/` (a new work goes into `art.json`, and so into `docs/screenshots/CREDITS.md`) or work drawn by the shot itself; never the owner's work or interests |
| Made only by code | Each picture is a Playwright test in `tests/shots/*.shot.ts`, written like the end-to-end specs: the harness's `app` fixture, its proven helpers (`chooseInMenu`, `alignWith`, `boolWith`, `maskWith`, `pathWith`, `drag`), the debug hook, and `tests/shots/scene.ts` (art, fonts, SVG, text, `fit`, `around`, `shot`). Wait on the app's state (`expect.poll`), never guess a selector: take it from the source or a spec. Each shot is declared in `tests/shots/manifest.ts` (README section, use case, alt text); `npm run check:shots` fails when the README and the manifest disagree |
| Where they run | Only on GitHub: the `Screenshots` workflow (`gh workflow run Screenshots --ref <branch> -f grep=<shot names>`) gives the WebP files and, for a shot that failed, its trace. Never on this PC. Run them from a branch, not `main`, while working on them (a branch push starts no `Tests` run) |
| Kept current | A changed interface means its shots are taken again; a removed feature removes its shots, its manifest entries and its text |

- **Limitations** keeps every limit, in tables grouped by area, one short sentence a row, long explanations under a heading after the table; data loss, passwords and encryption are marked ⚠️.
- **Before committing a README change:** compare before and after so no fact or limit is lost, check that every `#anchor` and every image path resolves, and that nothing is orphaned (a shot no text uses, a section no table links).

## Testing

**Where tests run: GitHub or locally.** Wide test runs and very large benchmarks exhaust a workstation that is also in use, so they run on GitHub.

| Run | Where |
| --- | --- |
| Browser and desktop E2E (`npm run test:snap`, any project), even a few specs: they lag a workstation in use | ☁️ GitHub only (push, then read the `Tests` run) |
| Unit tests, typecheck, `check:*`, benchmarks of at most ~200k items | 💻 local |
| `test:affected` with more than one group, `test:all`, `test:full` | ☁️ GitHub only (the `Tests` workflow; ask before pushing `main`, or push a branch) |
| Library benchmarks of more than ~200k items, SQLite benches, hidden-items stress runs | ☁️ GitHub only (`Bench library`, `Bench SQLite`, `Stress hidden`; `gh workflow run … --ref <branch>`) |

Check free memory before any local run longer than a few minutes, and run only one at a time.

Which tests when (see `docs/testing/README.md` for commands, groups and durations). The E2E specs are in **groups** (`scripts/lib/test-groups.mjs`); run only the groups a change needs:
- While working, run the specs a change touches (`npm run test:snap -- <files or -g>`) or its groups (`npm run test:group -- <group…>`). Before committing a slice, pushing or releasing: `npm run test:affected` (or `npm test`, which runs it with typecheck, unit tests and checks); it picks the groups from what changed since `origin/main`. Start with `-- --dry` to see the groups and the estimate, and say the estimated finish time.
- The whole quick suite (`npm run test:all`) only when `test:affected` picks every group or every few releases. `npm run test:full` **only** when a phase changed zoom, coordinates, projection, rendering, tiles or performance; record its results (suite and per-test times) in `docs/testing/` and in the commit message.
- A new spec goes into a group (`npm run check:groups` fails otherwise); a new source folder gets a rule in the change map.
- **Every test runs from a snapshot, never `dist/` (the development build).** `npm test`, `test:e2e`, `test:full`, `bench` and `qualify` all go through `scripts/test-snap.mjs`; `tests/e2e/build-dir.ts` throws if `CANVAST_BUILD_DIR` is not set, so a bare `playwright test` fails instead of reading `dist/`. The snapshot step also runs `check:offline` and `check:names` on its own build. **`npm run test:snap -- <playwright args>`** for a few specs. It builds a copy into `test-builds/<time>-<source hash>/` (with `build.json`: what it was made from, and `run.json`: the run and its result) and points the tests at it (`CANVAST_BUILD_DIR`, read by `tests/e2e/harness.ts`), so `dist/` can be rebuilt and work can go on while the tests run. Run it in the background. `npm run test:status` lists the snapshots with their result and how far each is behind the source and `dist/` (by source hash and changed files); a result belongs to the source it was built from, so re-run what changed after later edits. `dist/` also has a `build.json`. No test reads `dist/`, so it can be rebuilt at any time.

## CI on GitHub

- **`CI`** (`.github/workflows/ci.yml`): typecheck, unit tests, the build and every `check:*` on each push to `main` and each pull request.
- **`Tests`** (`.github/workflows/tests.yml`): the whole end-to-end suite on each push and pull request, one job per group × project (`chromium`, `chromium-cpu`, `chromium-dpr2`, `firefox`) plus `desktop` under xvfb, all in parallel (about 10 minutes); the full suite every Sunday and by *Run workflow* with `suite: full`. The groups come from `scripts/lib/test-groups.mjs`, so a new group is picked up by itself. Each job runs from its own snapshot (`test:snap`), as locally.
- **`Pan and zoom`** (`.github/workflows/pan-zoom.yml`): the pan and zoom standard on each push to `main` and each pull request: the *Powers of two* showcase panned and wheel-zoomed with real input (`scripts/bench-pan.mjs --check`), held to `scripts/lib/pan-zoom-budget.mjs` (set at 0.56.40, when both became smooth). A failure means the change made the canvas view slower: fix the change. The budget is never loosened (as `LIMITS`); a time over it once is re-run first, the tile and set counts are not timing. `npm run release` stops unless it passed on the commit.
- **`Release packages`** (`.github/workflows/release-packages.yml`): on each published release, builds the desktop packages for x86_64 and aarch64 on GitHub's runners (after checking the single file matches the released one), checks them with `package-desktop.mjs` and adds them to the release (*Run workflow* with a tag to redo one). `npm run release` uploads only `canvast.html`; never upload packages from a local machine. After a release, check this run too.
- After a push, check the runs (`gh run list`, `gh run view <id> --log-failed`) and fix what fails. The repository is public, so the runners cost nothing; prefer them to a local machine for long suites (the whole quick suite, the full suite) and keep local runs to the specs a change reaches.
- GitHub's machines are shared and vary in speed. A failure in a test that measures time is re-run on the reference machine before it counts, and is never fixed by loosening `LIMITS`. A failure that is a race in the test (reading a pixel before the next frame, a locator matching two elements) is a real test bug: fix the test. `npm run bench` stays on the reference machine.

## Test rules

- **After fixing a failed test, always re-run it from a freshly built snapshot** (`npm run test:snap` rebuilds each time), especially when the source changed; a result belongs to the source hash it was built from, so never count an older snapshot's result for the fix.
- E2E opens `canvast.html#debug` (from the snapshot in `CANVAST_BUILD_DIR`, never `dist/`) from `file://` and fails on any request other than `file:`/`data:`/`blob:`. Tests drive the app through `window.__canvastDebug` (`src/app/debug-hook.ts`, enabled by `#debug`).
- Firefox is a supported E2E project, not an afterthought (Chromium comes first for now): new features get their tests run in it too. The projects are `chromium`, `chromium-cpu`, `chromium-dpr2`, `firefox` and `desktop` (Electron, `desktop.spec.ts` only, from the snapshot's `desktop/` build; test desktop-shell changes there).
- `LIMITS` in `tests/e2e/harness.ts` were fixed before runs and are **never loosened** to make a test pass.
- Write loop counts with `reps(full, quick)` from the harness. Don't assume a fixed zoom depth from wheel notches (DPR-dependent); use keyboard steps or measured values.
- `app.drag` / `app.wheel` assert input starts on the canvas.
- Image fixtures are generated in code (`tests/e2e/png.ts`); no binary fixtures.
- **Break complex logic on purpose before calling it done.** For coordinate, frame, precision or other tricky logic, list what else could break it and add a small, fast test for each: every input path (wheel, keyboard and button zoom, drag and arrow pan, jumps, Home), both directions (zoom in *and* out, up *and* down), starting from Home and from deep, repeated actions (e.g. −1e12 five times, then zoom), with content on screen, plus a random fuzz with a per-step time limit. One path passing proves nothing about the others: after five −1e12 jumps, panning worked but wheel zoom hung. Reproduce reported bugs with real input in both browsers before claiming a fix.
- **Keep new tests cheap (session time is a budget).** A test says one thing; don't repeat what another spec already proves, extend that one instead. Use `reps(full, quick)` and keep quick loops small (tens, not hundreds); the full count is at most about twice quick, and a single long run (thousands of steps) goes in one test marked full-only and `chromium`-only. Prefer jumps, `setCamera` or keyboard steps over thousands of wheel notches (about 50 ms each). Logic, storage and archive specs belong in the `LOGIC_ONLY` list of `playwright.config.ts` (they run in `chromium` only); only specs that depend on the rasterizer or the pixel ratio run in all three Chromium projects. Before adding a long test, estimate its time (notches × 50 ms × projects) and state it.
- **No redundant, out-of-scope or unnecessary tests.** Before writing a test, check that no existing test already proves the same thing and that it checks the change at hand (not unrelated behaviour). Add a test only for new logic, a reported bug, or a rule that has no test yet; one test per behaviour. A fix or small change is covered by extending the nearest existing test, not by a new file or a copy of an old test. Do not add tests "for completeness" or to cover code that did not change. If a requested change needs no new test, say so and move on.
- `npm run check:names` (`scripts/check-names.mjs`) fails if certain external reference-product names (base64-encoded in the script) appear in the app's source (`src/`, `desktop/`) or in the built file. Don't name other canvas/reference apps in the app's code or interface; the README, docs and commits may name them where it helps.

## UI rules

- **DRY first: one shared component per thing.** Context menus, modals and dialogs, docks, panels, notices, settings rows, cards, trees and rules (names, dates) each have one implementation. Before writing UI, look for the shared component and call it; if it almost fits, extend it with an option; never copy it or restyle a copy. A second copy found while working is folded into the shared one in the same pass. `npm run check:components` guards this.
- **A long list in a card** shows its first rows and `showMoreButton` / `capList` (`src/ui/show-more.ts`). Panels and dialogs that scroll on their own do not need it.
- **A settings page never grows with use.** A list that grows with what people do (devices, logins, activity, errors) is a row with its count and a button that opens it in `listDialog` (`src/ui/confirm.ts`); the page keeps fixed rows. A panel drawn again on updates goes through `redraw()` (`src/ui/redraw.ts`): unchanged markup is left alone, and the scroll and the focused field are kept. Every settings row's controls end at its right edge, on one line, at `--ctl` (`settingsRowProblems` in `tests/e2e/harness.ts` checks every tab).

- **Every menu row has an icon, a name and a very short description** (`MenuItem.icon`, `label`, `hint`), in every context menu and action menu.

- **Button shapes:** a button is a rounded square (`--ctl-r`, or `--r-sm` on a row); `--r-pill` and `--r-dot` are for chips, what is on them, and dots (`check:tokens`).

- **One arrow for what opens or folds:** `ICONS.chevronDown`, or `--chevron-mask` where CSS draws it (selects, summaries); never a character (`check:components`). The corner mark is for a button that opens a group of tools.

- **Checkboxes and radios** are one rule in `src/styles.css`, sized by Density: an element sets only where it sits, never its size or colours.

- **Scrollbars** are one rule at the top of `src/styles.css` (`src/ui/scrollbars.ts`). Do not set `scrollbar-width` or `scrollbar-color` on an element, which turns it off in Chromium; only `none` for a row that scrolls sideways with its cue. A resize grip sits on the side of an edge away from a scrollbar.

- **Spacing follows Density.** Gaps, paddings and margins use only `--s-1`, `2`, `4`, `6`, `8`, `10`, `12`, `13`, `14`, `15`, which have a value for each of Dense, Compact and Comfortable. Control and row sizes use `--ctl`, `--bar-h`, `--field-h`, `--list-h`, `--menu-h`, `--tree-row-h`, `--row-btn`, `--chip-btn`, `--tree-indent`, `--icon-*`, and offsets from an edge use `--edge` and `--near`, which do too. `--sp-*` are fixed lengths, for what must not change. `check:tokens` refuses `--sp-*` in spacing.

- **No hardcoded CSS values.** Every colour, text size, padding, margin, gap, radius and icon size uses a token from `:root` in `src/styles.css`; add a token rather than a literal. `npm run check:tokens` enforces it. Row actions use the shared `src/ui/more-menu.ts` pattern (ADR 0068).

- **One focus ring:** `:where(:focus-visible)` at the top of `src/styles.css`, in the accent; write a focus rule only for what must look different. The notes editor's colours are all set in `.se-theme-canvast` (`check:components`).

- **Colours are `oklch()`, with contrast measured.** Theme colours are `oklch()` tokens; hex only for a colour meant to be fixed (`check:tokens`). Text keeps 4.5:1 and icons 3:1 in both themes: use a colour token rather than opacity to quieten text, `--hud-accent-text` for accent as text, and `--hud-accent-fg` for anything on a selected row, an overlay on it too (`tests/e2e/contrast.spec.ts`).

- **Group tools in menus, do not add a row of icons (ADR 0151).** A family of tools on the Actions bar (`ui/context-bar.ts`) is one button that opens `openMoreMenu(anchor, items, label, { keepOpen: true, refresh })`: an icon, a label and a hint per item, placed off the picked things, closing only on Escape or a press outside. List only what applies to the pick and hide the button when nothing does. The button carries `aria-haspopup="menu"` (it gets the corner mark from CSS). Reuse this menu for any new group; E2E chooses in it with `chooseInMenu` / `alignWith` / `boolWith` / `maskWith` / `pathWith` in `tests/e2e/harness.ts`.
- The dev panel (`.hud-dev`, `#debug` only) must end before x = 370: tests start drags at x 378 to 380.

- **Counts read right for one and many (ADR 0086).** Every number shown with a noun goes through `plural()` / `be()` / `were()` (`src/doc/plural.ts`) or a one-or-many branch: never `${n} items` alone, never "item(s)". This covers titles, buttons, placeholders, notices, status lines and undo labels.

- **Layers.** Floating elements use the `--z-*` tokens in `:root` (ADR 0096), never a number: `--z-item` and `--z-item-bar`/`--z-item-pop` for what belongs to a canvas item (a player's picture and bar, the selection bar), `--z-edge` for the bars and panels on the edges, which are always above anything on the canvas.

- **File views.** A kind of file that opens in a view of its own (notes, PDFs, 3D models) is one row of `src/ui/file-views.ts` (its view, for the library's viewer and the panel on a canvas alike) and one of `PICTURE_KINDS` in `src/assets/adapters.ts` (its picture on a card and thumbnail); what a card shows of it is `ImageObject.preview`, its place and bookmarks `CatalogEntry.viewer` (`src/ui/view-state.ts`). Settings are `mountSettings` of `src/ui/setting-rows.ts` (rows, a double-click to reset one, a group's Reset, draggable numbers). Nothing else needs to know the kind.

- **Panels (ADR 0156).** A floating panel is built with `panelHtml` (`src/ui/panel.ts`): optional header, optional strip under it, a scrolling body, optional footer. Leave out the parts it does not need; do not write layout CSS for them.

- **Icons (`src/ui/icons.ts`, registry in `docs/reference/icons.md`).** Every icon button must use an icon no other *different* function uses, and the icon must make sense for what the button does (not a stand-in picked because it was free). Buttons with the same function (all "close", all "delete", all "More") share one icon. Before adding an icon button, check the registry and `src/ui/icons.ts` for the icon you want, and add a row when you add one. Don't reuse an icon from another function even if it is close (a pencil is the Pen tool, so Rename uses a text cursor).

- **Name patterns.** Anything that names things in a series (the Library's Rename, Export's file names, and whatever comes next) fills its pattern with `fillPattern` of `src/doc/name-pattern.ts` (`#` runs, `{name}`, `{date:FORMAT}`, the caller's own tokens) and shows its token chips and Date row with `src/ui/name-pattern-ui.ts`. Never parse a pattern or format a date for a name anywhere else; a new token is a `values` entry of the caller, a new shared one goes in `PATTERN_TOKENS`.

- **File and folder names (ADR 0180).** Every rule is in `src/doc/file-names.ts`: call it, never write a regex of your own (`npm run check:name-rules`). A newer rule never renames a file already on a disk.

## Standalone tools

Tools that work without the app (decrypting, encrypting, sharing a folder) are **one** program, `scripts/tools/tools-source.mjs` (needs the repository: never run or copy it alone), built into one file (`npm run build:tools`, `dist-tools/canvast-tools.mjs`) and attached to every release. A new tool is a choice in it, not a new script.

- **For regular users first:** run with nothing, it shows a numbered menu in plain words; it asks for folders (dragged into the terminal: `cleanPath`) and passwords (not shown); it says what it will do and asks *Go?* before writing anything.
- **Also one-line commands** for the same actions, with `--help`.
- **It never changes a person's files** unless that is the action (and then only what it says); it never deletes for good (into `.trash`); its own settings live in the user's settings folder, never in a folder it works on.
- **Node.js 20 or later only, nothing to install**, Linux, macOS and Windows. It reuses the app's code (imported, bundled by esbuild) rather than copying it.
- **Errors and progress in plain words**, with what to do next. Each action has a test (`tests/unit/canvast-tools.test.ts`), and the README's *canvast tools* section shows it.

## Architecture (big picture)

- **Exact world coordinates** (ADR 0001): positions are `Dyadic` numbers (BigInt mantissa · 2^exponent, `src/core/dyadic.ts`); the camera (`src/core/camera.ts`) is a centre plus an integer-quantized log2 zoom, so zoom/pan are exactly reversible at any depth. Never introduce plain-float world coordinates; convert to doubles only relative to the camera/cell for drawing.
- **Projection is shared** (`src/render/projection.ts`): drawing and hit-testing use the same object→screen projection, so what you see is what you pick. Deep magnification falls back to exact arithmetic (`stroke-coverage.ts`).
- **Deep zoom into any object** (`src/render/coarse.ts`): every kind of object needs a `SAMPLERS` entry (typed over all kinds, so a new kind fails to compile without one; `bboxSampler` is the default) so its colour never silently disappears when the view is inside it at depth. Never special-case one kind in the renderer.
- **Spatial index** (`src/scene/spatial-index.ts`, ADR 0004): multi-scale levels × BigInt cells, no world bounds; `scene-view.ts` queries visible objects, skips sub-pixel content (LOD) and batches identical strokes.
- **Edit data flow:** input → transient preview (never stored) → on pointer-up one validated `Transaction` → `DocumentStore` mutates and reports changed ids → spatial index updates → redraw → 150 ms debounce → per-object, revision-checked IndexedDB commit, read back to verify (`storage/canvas-persistence.ts`).
- **Storage boundary** (ADR 0177): the app reaches storage only through the interfaces in `src/storage/store.ts` (`WorkspaceStore`, `BackupStore`, `CatalogStore`, `OriginalStore`, `LibraryFolderStore`); IndexedDB is one implementation (`idb-storage.ts`, `openBrowserStorage`), a workspace folder (desktop build) will be the other. Never use IndexedDB outside the files listed in `scripts/check-storage.mjs` (`npm run check:storage` fails); add a method to an interface instead, so a fix lands in both builds.
- **Storage** (ADR 0006–0008): IndexedDB `canvast` (schema in `storage/idb.ts`), Workspace → Boards → Canvases (`workspace-repo.ts`), multi-tab writer lease so a stale tab can never overwrite newer data (`writer-lease.ts`), v0.0.x migration (`migrate-v1.ts`). Assets are content-addressed by SHA-256 and stored once; placed images are instances. Originals are erased only by reference-checked GC once undo can no longer need them. `.canvast` archives are uncompressed ZIPs (`zip.ts`, `archive.ts`) verified fully before a single-transaction import.

## Workflow

- Work on `main`. Ask before pushing. **Rebuild `dist/` (`npm run build`) immediately after every source change**, before running tests: it is tested live. After a slice, build `dist/` too; never `pkill -f` (it kills the shell); `rm` and `cp` are interactive aliases here (use `\rm -f`, `\cp -f`).
- **Keep `README.md` current on every change.** On every fix, added, changed, deprecated or removed feature, check the README and update the affected sections (usage, shortcut table, Limitations, technical notes) in the same commit; remove text for what no longer exists. A change that touches no README text is fine, but check first.
- **Versions: always bump PATCH.** Every batch of fixes or features gets the next patch version (`package.json`, `CHANGELOG.md`), on every branch, feature branches included, so each build tells which fixes it has. Minor or major only for a release, on the owner's go; a release is never a patch number (`0.56.0`, not `0.55.4`).
- Work happens in phases/slices (see `docs/status.md`); a finished slice bumps `package.json` version, updates `CHANGELOG.md`, `docs/status.md`, README and its test log, and is committed as `feat(<area>): ... (vX.Y.Z)`.
- **Releases (ADR 0175).** The latest GitHub release always carries the built single file `dist/canvast.html` (and `canvast.html.sha256`), so `/releases/latest/download/canvast.html` is the newest app. After a finished slice is bumped, committed and pushed, publish it with `npm run release` (`scripts/release.mjs`; `-- --dry-run` first if unsure). It stops unless the tree is clean, `HEAD` is on `origin/main`, `CHANGELOG.md` has `## X.Y.Z — Title (date)` for the `package.json` version, and `dist/` was built from this commit. It creates or updates tag `vX.Y.Z`, marks it **Latest**, and verifies it is Latest and serves the file it built. Never publish an older version as Latest, never release from a stale `dist/`. **Release notes are always split into Features and Fixes**, from the CHANGELOG: start every CHANGELOG bullet with `**Added:**`, `**Changed:**`, `**Removed:**` (features) or `**Fixed:**` (a fix), and keep fixes out of the feature bullets. A release only on the owner's go, always a minor or major version; its CHANGELOG section sums up the patches since the last release, keeping every `issue #N`.
- **GitHub issues close on release, never on commit** (no `Fixes #N` in commit messages). A fix of an issue names it in its CHANGELOG bullet as `issue #N`, and the issue gets the label `fixed: next release` and a short comment that the fix is on `main` and ships in the next release (`gh issue edit N --add-label "fixed: next release"`, `gh issue comment N`). `npm run release` closes every issue its notes name, with the release's link.
- **Task list and handoffs (guard against lost context: power loss, usage limits).** While a plan is running, keep its task list in Claude's memory directory (never in the repo) and update it after every finished step and before any long run: each task as done / in progress / next, the last commit and whether it is pushed, uncommitted files, a test run in progress and its snapshot. At every phase transition write a complete handoff (what shipped, commits and push/release state, test results, open decisions, known failures, the first tasks of the next phase) and point `MEMORY.md` at it. After a reset, read the task list and the latest handoff before doing anything else.
- **Summaries are short, accurate and scannable.** Few words, every fact kept: all changes, limits, failures and any action needed. Shape: a heading with the state, the action needed on one ⚠️ line, small tables with status emojis (change | note; test | result), then a short "not confirmed" list. Short means tight wording, not dropped facts.
- **Use emojis for readability in replies and summaries.** Status: ✅ done and verified (visibly green), ❌ failed, ⚠️ done with a caveat or a risk, ⏳ running or waiting, 🔜 next. Use a few more to mark kinds of content when it helps scanning (🧪 tests, 📝 docs, 🚀 push or release, ⏱️ times, 🐛 bug), one per row or heading, not decoration. Never mark something ✅ that was not verified.
