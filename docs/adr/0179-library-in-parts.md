# ADR 0179 — The library index in parts

- Status: **accepted** (2026-10-29, v0.50.44; the owner approved the format change)
- Amends: [ADR 0177](0177-workspace-folder-desktop-app.md) (`library.json`)

## Context

`.canvast/library.json` held every library item, one per line. Each change to one item (a tag, a name) rewrote the whole file: about 29 MB at 100,000 items, measured, and a sync tool then copied all of it to every device.

## Decision

- The library is kept in `.canvast/library/`: `index.json` (`canvast-library`, version 2) holds the library folders and names the parts there are; each part `items-<x>.json` (`canvast-library-items`, version 2) holds the items whose hash starts with `x`, sixteen parts in all, one item per line as before. A change rewrites only the parts whose text changed, then the index (parts first, so the index never names a part not written yet). A part no item is in any more is erased after the index stops naming it.
- Reading: only the parts whose text changed since this device last wrote or read them are parsed; the others' items are known to be there. A part that is missing (a sync tool still bringing it) or damaged makes the read incomplete, so nothing is taken as erased.
- **Older versions keep working:** while the library has up to 10,000 items, `library.json` is still written, with `"copyOf": ".canvast/library"`. An older app reads and writes it as before. A `library.json` without the mark was written by an older app: what it changed is taken (the same per-item rules as any other device's change). The marked copy is never read while the parts exist, since a sync tool may bring it after newer parts. Past 10,000 items it is no longer kept (an older app then sees no library file and works from its own copy).
- A workspace made by an earlier version has only `library.json`: it is read from it, and the parts are written with the next save.

## Consequences

- At 100,000 items a change rewrites about 1/16 of the library (about 2 MB) instead of 29 MB; below 10,000 items the copy for older apps is also written (under 3 MB).
- Still to do for very large libraries: the app reads its whole catalog from its own storage on each save to work out file moves (an in-memory list of changed items would avoid it).
