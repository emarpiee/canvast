# ADR 0155: an update-safe origin for a replaced HTML file

Status: accepted (Phase 8, 2026-10-19)

canvast ships as one HTML file that its owner replaces with a newer build. What was saved in IndexedDB belongs to the browser's origin, so the question is whether a replaced file finds it.

## Decision

- The database name and its schema upgrade path (`storage/idb.ts`, ADR 0006) do not depend on the file's name, path or version string. A newer build at the same path opens the same database and migrates it forward (`migrate-v1.ts` for v0.0.x data).
- The app does not try to keep data alive across a move to another path, browser or computer. The `.canvast` archive (ADR 0006 to 0008, verified before import) is the one way data travels, and the Storage tab says so.
- A test (`tests/e2e/upgrade.spec.ts`, Chromium and Firefox) replaces the file at the same path and checks that the objects and the view come back and that saving goes on. It also opens a copy at another path and **records** what the browser did, without asserting it, because that is the browser's choice.

## Consequences

- Nothing in the app reads its own location.
- The result for another path (shared in both browsers tested) can change with a browser update; the reference page [`storage-origin.md`](../reference/storage-origin.md) says what is known and what is not.
- WebKit is untested until it is installed in the test environment.
