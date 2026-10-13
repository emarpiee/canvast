# Phase 1, slice 1 test log — workspace and storage foundation

## Environment

The reference machine and browser are the same as earlier phases (Intel
i5-4460, Chrome for Testing 156 headless via Playwright 1.64.0, `file://`).

On `file://`, Chromium reports `isSecureContext === true`, and `navigator.locks`
and `BroadcastChannel` are available. The writer lease therefore uses Web
Locks. The localStorage heartbeat fallback is exercised by removing
`navigator.locks` with an init script.

## Commands

```sh
npm run typecheck && npm run test:unit
npm run build
npx playwright test                      # all specs, 3 projects
npx playwright test tests/e2e/storage.spec.ts
npm run check:offline && npm run check:names
```

## Storage tests (`tests/e2e/storage.spec.ts`)

| Test | Assertions |
| --- | --- |
| Fresh start | A workspace with 1 board and 1 canvas is created; the breadcrumb reads "Board 1 › Canvas 1". After drawing, the HUD shows a non-verified state first, then "Saved (verified)". Stored object ids equal the document ids. Moving one object commits exactly `{ puts: 1, deletes: 0 }` with revision +1. Deleting one commits `{ puts: 0, deletes: 1 }`. |
| Boards and canvases | Through the navigator UI: add Canvas 2, which starts empty; draw; zoom to level 5. Switch to Canvas 1 (its own objects, camera at level 0) and back (objects and level 5 restored). Rename to "Sketches"; add Board 2; draw. After a reload the app reopens on Board 2 › Canvas 1 with its objects; the tree is `[Board 1: Canvas 1 (1 object), Sketches (1)], [Board 2]`; Sketches still has its object and zoom 5. |
| v1 migration | A genuine schema-1 database is seeded from a page on the same `file://` origin: 2 valid strokes, 1 invalid (negative width), and a camera. The app reports `migrated`, with `sourceObjects: 3, copied: 2, verified: true` and one skipped object. The 2 objects and the exact camera are restored, and the upgrade message is shown. The legacy `snapshots["main"]` record is **deep-equal to what was seeded**. A reload reports `existing`, with no second migration. |
| Two tabs (Web Locks) | Tab 2 is read-only, with a banner. Drawing there creates nothing and shows the read-only message. Tab 1's committed stroke appears in tab 2 through BroadcastChannel. After **Take over** in tab 2, tab 1 becomes read-only and tab 2's edits appear in tab 1. When tab 2 closes, tab 1 is promoted. |
| Two tabs (heartbeat fallback) | With `navigator.locks` removed, the lease mechanism is `local-heartbeat`: one writer, read-only edits blocked, take-over within 1 heartbeat, promotion when the writer closes. |
| Stale revision | The canvas revision is advanced in storage behind the app's back. The next edit ends in state `conflict`, with "changed in another tab" in the HUD, and the stored objects are **unchanged**. |
| Storage panel | It shows "verified", "editing (writer)", the exported-backup status, "Browser storage is not a backup", and the quota estimate. |

### Mutation check

With the revision comparison in `WorkspaceRepo.commit` removed, the
stale-revision test **fails**: the stale write lands. With the code restored
it passes, and the build digest matches the pre-mutation build.

### Defects found while writing the tests (all in the tests)

1. **Revision counting:** the first version expected one revision per edit.
   Saves are debounced (150 ms), so quick edits share a commit and the
   revision counts commits. The assertions are now relative (+1 per commit).
2. **Race in a switch step:** one step read objects before an asynchronous
   canvas switch had finished. Every switch step now waits for the
   breadcrumb.
3. **Non-canonical fixture:** the seeded legacy camera used `150p0`. The app
   stores canonical dyadics (`75p1`, the same number), so the fixture now
   uses the canonical form.

## Regression

REGRESSION_RESULT

## Not covered (unverified)

- Firefox and Safari `file://` storage, including possible IndexedDB
  partitioning or denial.
- Real quota exhaustion, eviction, and private-mode storage loss. The code
  paths exist (`error` state, changes kept queued), but they are not
  exercised.
- Upgrade while an old v0.0.x tab stays open: the `onblocked` path. It is
  implemented as a message to the user, not automated.
