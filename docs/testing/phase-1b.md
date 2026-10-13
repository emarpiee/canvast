# Phase 1, slice 2 test log — Assets view, catalog, GC and safe deletion

## Environment

Same as the earlier phases: Intel i5-4460, Chrome for Testing 156 headless
via Playwright 1.64.0, `file://`, three projects (`chromium`,
`chromium-cpu`, `chromium-dpr2`).

## Commands

```sh
npm run typecheck && npm run test:unit
npm run build
npx playwright test tests/e2e/assets.spec.ts     # the new spec, 3 projects
npm test                                          # quick suite (everyday)
npm run test:full                                 # full suite (before the phase commit)
```

## Unit tests (`tests/unit/assets.test.ts`, 10 tests)

| Test | Assertions |
| --- | --- |
| `log2Abs` | Exact exponent at 2^-5000 and 2^7000; correct for non-powers of two and mantissas over 200 bits; −∞ for zero. |
| `fitRect` at unit 0, −60, −1600, −5000, +1600, +5000 | An image whose anchor has bits far below its own scale is framed so that the box is centred to 10^-6 px, fills at most 60% of the viewport in each axis and more than 99.9% of that in the limiting axis, and the level is within 2^-19 of the ideal, rounded down. |
| Union at mixed depths | A level-0 image and a 2^-2000 image frame around the large one (zi 0). |
| Zero-size rectangle | Keeps the fallback level; the point is on the centre to 10^-9 px. |
| GC roots | Current objects plus every state in undo and redo are roots. A deleted object stays a root while undo can restore it. `load` (switching canvas) clears them. |

## End-to-end tests (`tests/e2e/assets.spec.ts`, 8 tests × 3 projects)

| Test | Assertions |
| --- | --- |
| Shared original (spec scenario K) | One import, then placement from Assets view on Board 1 › Canvas 1 (twice), Board 1 › Canvas 2 and Board 2 › Canvas 1: **1 catalog entry, 1 stored original, 4 instances on 3 canvases**. The card reads "4 uses · 3 canvases", and the places list shows 2 / 1 / 1. Delete from library is disabled, with the reason. Deleting one instance gives "3 uses · 2 canvases" and the original is still stored. Re-importing the same bytes adds no copy. |
| Show at depth | One instance placed at level **+1600** (off-origin centre) on Canvas 1, and one at level **−1600** on Canvas 2. From home on Canvas 1, Show for each: the right canvas opens, the selection equals the instance, the level is between placement + 5 and placement + 8, the box is centred within 1 px and is 60% of the viewport height (±2 px), and **source pixel (4, 3) has its true colour on screen**. |
| Library delete and undo roots | An unused library-only import: Cancel keeps it; confirming erases it (the original is gone from storage). An asset whose last instance was just deleted: the delete is accepted but the **original is kept** (root: undo history). **Undo** brings the instance back and the asset returns to the library ("1 use · 1 canvas"). Deleting again and switching canvas (history cleared) erases it; a reload brings nothing back. |
| GC never erases a referenced original | Fault injection marks an in-use asset deleted, bypassing the UI check. With no roots, GC reports `restored: [hash]`, `swept: []`. The original is still stored and the instance still renders (pixel colour, magnified). |
| Delete canvas and board | Board 2's only canvas has Delete disabled. Deleting the open Board 1 › Canvas 2: the dialog states "2 object(s)" and that images stay in the library; Escape cancels and nothing changes; confirming moves the view to Canvas 1 first, after which **no object records remain** for the deleted canvas id, the original is still stored, and usage is 2 on 2 canvases. Deleting Board 2 (dialog: 1 canvas, 1 object) gives usage 1 on 1. The last board and canvas have Delete disabled. After a reload: startup `existing`, tree `[Board 1: Canvas 1]`, 1 object. |
| Missing original | The original's bytes are removed behind the app's back. After a reload the instance keeps its id (placeholder). The card is marked missing and the inspector explains how to restore it (no Place button). Re-importing the same bytes restores it, and the instance renders its true colours. |
| Schema 2 → 3 upgrade | A genuine schema-2 database (as v0.1.0 wrote it, with an image instance and its original) is seeded from a page on the same origin. On open: startup `existing`, the object is intact, and the catalog has 1 entry built from the stored original (name kept), 1 use on 1 canvas, present, active, with no missing entries. The instance renders its true colour. |
| Two tabs | The reader's Assets view has Place and Import disabled. The writer deletes the canvas the reader is viewing; the reader moves to Board 1 › Canvas 1 with its object, and its tree shows the deletion. |

### Mutation checks

Each check was done on a temporary build, then the code was restored. The
restored build's digest matched the pre-mutation build
(`e8ac1b16…14dc`).

1. **The reference check in `collect` removed:** "GC never erases a
   referenced original" **fails**, because the in-use original is reported
   as swept.
2. **Roots ignored in `collect`:** "Library delete and undo roots"
   **fails**, because the original is erased while undo still needs it.

### Defects found while writing the tests

1. **Clicking a selected card deselected it** (UI). A second click on the
   selected asset closed the inspector, so a quick "select then Place" could
   act on nothing. Clicking now always selects; Escape or the close button
   deselects.
2. **Escape could not close a modal dialog** (UI). The canvas's window-level
   shortcut handler handled Escape and called `preventDefault`, which
   cancels the dialog's own Escape. More seriously, Delete would have
   reached the canvas selection behind a dialog. Canvas shortcuts now share
   one scope rule (`interaction/shortcut-scope.ts`): not while typing, not
   in Assets view, not inside a dialog.
3. **Debug hook** (`storedObjectIds` read through `loadCanvas`, which
   requires the canvas record). It now reads raw object keys for the id, so
   "no records remain for a deleted canvas" is checked directly.
4. **DPR-dependent sampling** (test). At 1 source px per CSS px the image is
   drawn smoothed, so a DPR 2 sample hit a blended colour. The pixel checks
   now magnify first (2^6×), where each source pixel covers many device
   pixels.

## Regression

- **Quick suite** (`npm test`; built before the version bump, `e8ac1b16…14dc`):
  112 passed, 2 skipped by design, 0 failed (E2E 9.5 min).
- **Full suite** (`npm run test:full`) on the v0.2.0 build
  `9db358e8…31b7`: **112 passed, 2 skipped by design** (touch outside the
  touch project), **0 failed** (34.5 min). That covers navigation, editing,
  deep-zoom rendering, zoom controls, storage and assets, in 3 projects.
  Every Phase 0A–1a threshold holds after moving the navigator out of the
  canvas host and adding the shortcut scope.
- **Unit tests:** 68/68. The offline and naming checks pass.

## Not covered (unverified)

- Asset libraries with thousands of entries (grid and thumbnail time).
- Firefox and Safari.
- Time to delete a canvas with very many objects (a single key-range
  delete).
- A crash between `markDeleted` and `collect`. That state is safe by design
  (the entry is "deleted" and the bytes remain until the next collection),
  but it is not exercised by a test.
