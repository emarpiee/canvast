# ADR 0006 — Workspace storage: hierarchy, per-object commits, migration, multi-tab safety

- Status: accepted (Phase 1, slice 1)
- Date: 2026-10-13
- Supersedes the snapshot persistence of ADR 0003

## Context

Phase 0B stored the whole document as one snapshot record, rewritten after
every edit. That cost grows with document size. It had no Workspace → Boards
→ Canvas structure, and nothing prevented two tabs from overwriting each
other. The spec requires:

- the hierarchy;
- incremental, transactional saving with honest save states;
- a migration path for existing data that never touches legacy records
  before verification;
- multi-tab safety that does not depend on any single browser API.

## Decision

### Schema (IndexedDB `canvast`, version 2)

| Store | Key | Contents |
| --- | --- | --- |
| `meta` | string | `"current"` → `{ workspaceId, boardId, canvasId }`; `"migration-v1"` → migration record |
| `workspaces` | `id` | `{ id, displayName, boardIds[], createdAt, schemaVersion }` |
| `boards` | `id` | `{ id, workspaceId, name, canvasIds[], createdAt }` |
| `canvases` | `id` (index `boardId`) | `{ id, boardId, name, revision, objectCount, updatedAt }` |
| `objects` | `[canvasId, id]` | `{ canvasId, id, data: SerializedObject }`, one record per canvas object |
| `canvasViews` | canvasId | serialized camera (per-device view state, not revisioned) |
| `assets` | sha256 | original bytes plus metadata, stored once (unchanged from schema 1) |
| `snapshots` | `"main"`, `"camera"` | **legacy schema 1, read-only, retained** |

Identity rules:
- Every workspace, board, canvas and object has a stable random 128-bit id.
  Names are display-only, so two canvases can contain objects with similar
  names without ambiguity.
- Order lives in the parent's id array.
- Objects are namespaced by canvas id in their key.

The upgrade callback only creates stores and indexes. It blocks
transparently while older tabs still hold a connection: the UI asks the user
to close them, and a connection closes itself on `versionchange`.

### Commits and save states

- `DocumentStore` reports the ids changed by each transaction, including undo
  and redo. `CanvasPersistence` queues them and, 150 ms after the last change,
  writes all queued puts and deletes in **one** readwrite transaction
  (`durability: "strict"`). That transaction:
  1. reads the canvas record and requires `revision === expected`;
  2. writes the object records;
  3. increments `revision`.

  A stale writer therefore gets `RevisionConflictError` and **never**
  overwrites newer data. The revision counts commits, not edits.
- Save states, as the spec requires, with nothing called saved before it is:

```
             edit                    debounce              tx complete            read-back matches
 verified ─────────▶ queued ──────────────────▶ saving ─────────────▶ committed ─────────────────▶ verified
    ▲                  │ lease lost                │ revision mismatch      │ mismatch
    │                  ▼                           ▼                        ▼
    └──── lease ── readonly                     conflict  (saving stops; the user must reload)
          regained                  saving ──── other failure ──▶ error (changes stay queued; retried on the next edit)
```

- "Exported backup" is shown separately as *none* until export exists:
  browser storage is not a backup.
- Previews never enter the document, so they cannot be saved.

### Lazy per-canvas loading

Only the active canvas's objects are in memory. Switching canvases:
1. flushes pending commits and the camera;
2. loads the target canvas's objects with a key-range `getAll`;
3. restores the target's saved camera.

The last active canvas is stored in `meta.current`. Undo history is per
session and per canvas, and is cleared on switch.

### Migration from schema 1

On the first start without `meta.current`, if `snapshots["main"]` holds
objects:

1. Validate every legacy object. Valid ones are re-serialized canonically;
   invalid ones are listed, not copied.
2. In one transaction, create workspace "My workspace" › "Board 1" ›
   "Canvas 1", put the object records, copy the camera into `canvasViews`,
   and write the migration record and `meta.current`.
3. Read everything back and compare each object with its source. The record
   is marked `verified` only if all match.
4. The legacy store is never modified or deleted. Image bytes are not copied:
   the `assets` store is already content-addressed and unchanged.

A second start sees `meta.current` and does not migrate again, so migration
is idempotent. A downgrade to Phase 0B code is unsupported: schema-2 data
would be invisible to it, but its own legacy snapshot is still intact.

### Multi-tab safety (one writer per browser profile)

1. **Web Locks** (`navigator.locks`; available on `file://` in Chromium,
   which is a secure context): an exclusive lock held for the tab's lifetime.
   - A second tab is read-only: navigation and selection only, edits
     blocked with a message.
   - It queues for the lock and is promoted automatically when the writer
     closes.
   - **Take over** steals the lock, and the former writer turns read-only.
2. **localStorage heartbeat** when Web Locks are missing: a lease renewed
   every 1 s that expires after 4 s; take-over and promotion work by polling.
   It is tested by removing `navigator.locks`.
3. **Revision check:** the authoritative guard if both of the above fail or
   misbehave.

Read-only tabs follow the writer: after each verified commit the writer posts
`{canvasId, revision}` on a `BroadcastChannel`, and a read-only tab viewing
that canvas reloads it.

### Storage status UI

The save indicator opens a panel showing:

- the save state and the last verified commit;
- the tab's role and the lease mechanism;
- the `navigator.storage.estimate()` quota (as an estimate);
- persistence permission, with a request button;
- the exported-backup status;
- a plain statement that `file://` storage belongs to this browser profile,
  is not shared with other browsers, profiles or private windows, and is
  deleted with site data.

## Consequences

- Saves cost O(objects changed), not O(document).
- Opening a canvas is O(objects on that canvas).
- A stale tab cannot corrupt data. The worst case is a "conflict" state that
  asks for a reload. Unsaved edits made in that state are lost on reload;
  this is reported, not hidden.

## Deferred, with reasons

- **Asset catalog and reference-checked garbage collection.** `assets` is
  still a plain hash → blob store, and nothing deletes blobs yet, so nothing
  can be lost. This comes with the Assets view.
- **Export/import (portable archive)** and verified backups. Until then, the
  UI says there is no backup.
- **Deleting boards and canvases.** This needs the reference reconciliation
  above to be safe.
- **Persistent undo history.**
- Behaviour on Firefox and Safari under `file://` is unverified. Firefox may
  partition or deny IndexedDB for local files; the app then runs in memory and
  says so.
