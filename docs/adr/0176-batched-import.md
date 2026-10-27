# ADR 0176 — Import an archive a batch of originals at a time

- Status: accepted (v0.47.2)
- Amends: [ADR 0008](0008-portable-archives.md) (one transaction writes the import)

## Context

An import read every original of the archive into memory while it made its plan, and kept them there until one transaction had written them with everything else. A backup of several gigabytes needed that much free memory, so the size of a backup that could be restored was set by memory, not by storage.

## Decision

- **The archive stays one `.canvast` file.** Export, the format and the manifest do not change; only the way an import reads and writes it does.
- **The plan holds no bytes.** Each original is read once to check its SHA-256 and let go; the plan keeps a slice of the file, which the browser reads from disk again when it is written.
- **The originals are written first, a batch at a time** (up to 128 MiB of bytes per transaction, a bigger file alone), only those the store does not have. Each batch lists what it wrote under the `meta` key `importStaged`, in the same transaction. Nothing points at them yet: no library entry, no canvas, so they cannot be seen.
- **Everything else is one transaction, as before:** boards, canvases, objects, library entries (with their tags and folders), passwords, styles. It also clears `importStaged`. So the import still shows all at once or not at all.
- **What an unfinished import leaves is erased.** If anything fails after the originals, they are erased at once (`sweepImportStaging`); if the tab closes in between, they are erased when the app next opens (before the catalog is reconciled, which would otherwise give them library entries), and before the next import. A listed original that has a library entry by then (the import finished, or the same file was imported since) is kept.
- Memory during an import is about one batch, whatever the size of the archive. A single file is still at most 256 MiB, and a canvas or manifest JSON part at most 1 GiB.

## Not built

Streaming the canvases' JSON (one canvas is still read whole); resuming an import that stopped.
