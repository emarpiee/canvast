# Where the data lives when the file is replaced

canvast is one HTML file opened from `file://`. Everything saved (IndexedDB `canvast`) belongs to the browser's **origin** for that page, not to the file. This page says what is known about replacing the file with a newer build.

## What is tested

`tests/e2e/upgrade.spec.ts` (Chromium and Firefox, from `file://`):

| Step | Result |
| --- | --- |
| Draw two shapes in file A at a path, save | saved |
| Replace file A at the same path with a different file (another content), open it as a new navigation | the same two objects and the same view come back |
| Draw a third shape, reload | three objects: it goes on saving |
| Open a copy of the file at another path in the same browser profile | Chromium and Firefox both showed the same three objects (the origin is shared between `file://` paths in the profile used by the test) |

## What is not promised

- **Another path is the browser's choice.** The test records what each browser does and asserts nothing about it. A browser can give each `file://` path its own origin (Firefox has a setting for it), and then a copy at another path starts empty.
- **Another browser or another profile never sees the data.** Moving the file to another computer does not move what was saved.
- **Clearing site data removes it.**

## What to do

Replace the file at the same path and keep the old file until the new one has opened the canvas. To move to another path, browser or computer, use **Export** (`.canvast` archive) in Settings > Storage first and **Import** after: that is the only copy that travels. Settings > Storage says this too.

See [ADR 0155](../adr/0155-update-safe-origin.md).
