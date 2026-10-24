# ADR 0170: the Painting view is removed

- Status: accepted (v0.37.0, 2026-10-25)
- Supersedes: ADR 0164 (brush engine as WebAssembly), 0165 (Painting view), 0166 (layer kinds), 0167 (vector layers), 0168 (one chrome), 0169 (brush presets)

## Context

The owner discontinued the Painting view. Its code (`src/paint/`, the Paint view's UI, the Rust/WebAssembly brush engine and its build step) is taken out. Some changes made while it was built are not about painting and stay.

## Decision

**Gone:** the Paint tab and view, its tools (Brush, Pencil, Smudge, Clone stamp, the Eyedropper (also on the canvas’s rail, `I`), marquees, polygonal lasso, magic wand, fill, gradient), brush presets and brush files, layers and pages, reference pictures, OpenRaster, the brush engine (`engine/`, `scripts/build-engine.mjs`, its notice and CSP `'wasm-unsafe-eval'`), the `paint.*` settings, and the parts of the canvas's code that existed only to host it: the switchable targets (`app/target.ts`), the tool handler's host hooks, the `paint` and `both` key scopes, `data-only` on the bars, and helpers split out only to share with it (`doc/node-edit.ts`, `ui/reveal-list.ts`, `ui/curve-editor.ts`, `ui/setting-rows.ts`, which are back inline).

**Kept:** a plain wheel scrolling a bar sideways (`ui/bar.ts`), a sheet's ratio typed as a px size, and the test fixes made on the way.

**Stored data stays.** The IndexedDB stores `paintings`, `paintLayers` and `paintTiles` (schema 11) are not deleted and nothing reads or writes them, so paintings already stored are not lost. The schema version stays 11. The asset GC no longer counts pictures used by those layers.

**Backups.** The archive format stays version 6. A workspace backup no longer writes paintings or brush presets. An import of an older backup that has them imports everything else and says in its summary that they are left out.

## Consequences

The built file is smaller and the build needs no Rust toolchain. Paintings made in v0.28 to v0.36 cannot be opened in this version; they remain in the browser's storage and in the backups made then.
