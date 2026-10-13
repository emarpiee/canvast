# Phase 1, slice 3 test log — portable archives (export and import)

## Environment

Same as earlier phases: Intel i5-4460, Chrome for Testing 156 headless via
Playwright 1.64.0, `file://`, 3 projects. A "fresh profile" in the tests is
a new Playwright browser context, which has its own, empty storage: the same
situation as another computer or browser profile.

## Commands

```sh
npm run typecheck && npm run test:unit
npm run build
npx playwright test tests/e2e/archive.spec.ts
npm test            # quick suite
npm run test:full   # full suite (before the phase commit)
```

## Unit tests

| File | Test | Assertions |
| --- | --- | --- |
| `zip.test.ts` | CRC-32 | Equals Node's zlib CRC for 0 B to 64 KiB, whole, chunked, and streamed from a Blob. |
| | Round trip | UTF-8 names, an empty entry, a 70 KB entry and a 3-byte entry come back byte-identical; every entry verifies. |
| | Flipped byte | Fails the checksum of its own entry only. |
| | Rejections | Not a ZIP; no end record; truncated file; a compressed (deflate) entry; duplicate names; an entry whose size runs past the data. |
| | File names | Letters and digits in any script are kept; path characters (`../`) are replaced; empty names fall back to `canvast`. |
| `doc.test.ts` | Canonical serialization | `unit: -0` serializes as `0`, and the JSON round trip is identical. |

**Portability:** an archive written by `writeZip` passes `unzip -t` and
Python's `zipfile.testzip()`, with UTF-8 names intact.

## End-to-end tests (`tests/e2e/archive.spec.ts`, 4 tests × 3 projects)

| Test | Assertions |
| --- | --- |
| Workspace round trip to another profile (spec scenario F) | The source has 2 boards and 3 canvases; one original used on 2 canvases; an unused library asset; a stroke drawn 1,600 levels deep off-origin; saved views at levels 5.5 and 1600.25. Export from the storage panel downloads `My-workspace-<date>.canvast`, and the panel then shows it under "Last full backup". The file has 6 entries (manifest, 3 canvases, **2 originals for 3 image instances**); the original's bytes equal the fixture. Import into an empty profile: the dialog summarises 3 canvases, 5 objects and 2 originals as 2 new boards. The resulting tree is the profile's own board plus the 2 imported boards. **Every object (ids, exact dyadic anchors, depth) and every saved view equals the source**, stored originals and usage are identical, the first imported canvas opens, and its image renders its true pixel colour. Importing again adds 2 more boards and **no second copy** of either original (usage doubles). |
| Scopes | Canvas export from the menu holds 1 board, 1 canvas and only the original it uses. Board export of a board without images holds no originals. Asset export from the inspector holds 1 original and no canvases. In another profile: the canvas archive becomes "Canvas 2" on the open board with identical objects; the asset archive, **dropped on the page**, adds only a library entry (no new board, usage 0). |
| Damaged and hostile files | Each of these is refused with a specific message, no dialog, and an unchanged tree: plain text; a truncated file; format version 99 ("made by a newer canvast"); a wrong format id; a manifest naming a missing canvas file. An archive whose original was altered (valid ZIP, wrong SHA-256) is reported as "does not match its content hash", skipped, and its instance stays missing ("1 original(s) are still missing"). Cancel writes nothing. A good archive then restores the original. |
| Read-only tab | Import is disabled; export works (the manifest includes the original). Only the writer records the backup time. |

### Mutation checks

Both were done on temporary builds; afterwards the restored build's digest
matched (`1bb267ed…9b46`).

1. **SHA-256 comparison removed from `readArchive`:** the hostile-files test
   **fails**, because the tampered original is accepted.
2. **Version check removed:** the hostile-files test **fails**, because a
   format-99 archive reaches the confirmation dialog.

### Defects found

1. **`unit: -0`** (model). Placing at zoom level 0 computes `unit = -0`.
   IndexedDB keeps `-0`, but JSON writes `0`, so a round trip was not
   byte-for-byte canonical. Fixed in `serializeObject`, with a unit test.
2. **Stale storage-panel assertion** (test). It expected the old "Exported
   backup" label; it was updated to the new backup row.
3. **Hanging export** (found while writing it). Awaiting `done()` on a
   read-only transaction that had already completed never resolves. The
   await was removed.

## Regression

Per the revised rule (docs/testing/README.md), a slice inside a phase is
committed on the quick suite; the full suite runs when Phase 1 is complete.
A full run was started and then stopped deliberately when the rule changed;
it has no result.

- **Quick suite** on the v0.3.0 build `2db91b09…9d9a`: 121 passed, 2 skipped
  by design, **3 failed**, all the same test in the 3 projects. "The storage
  panel reports …" still expected the label "Exported backup", which this
  slice renamed to "Last full backup". This was a stale assertion: the test
  now checks the backup row's content, and it passes in all 3 projects. No
  application defect.
- **Unit tests:** 75/75. The offline and naming checks pass.

## Not covered (unverified)

- Archives over 4 GiB or over 65,535 entries (refused by design; not
  exercised).
- Importing into Firefox or Safari, and a real transfer between two
  machines. The fresh-profile test reproduces empty storage, not a
  different browser engine.
- Export and import throughput and peak memory for large workspaces (for
  example hundreds of 4K images).
- A tab closed during import (one transaction, so it should leave nothing,
  but this is not exercised).
