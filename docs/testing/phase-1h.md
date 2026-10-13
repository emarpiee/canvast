# Phase 1, slice 8 test log — text objects (and the extreme-depth fix)

## Environment

Same as earlier phases: four E2E projects (`chromium`, `chromium-cpu`,
`chromium-dpr2`, `firefox`).

## Unit tests (`tests/unit/text.test.ts`, 10 new; `dyadic.test.ts`, 2 new)

| Area | Assertions |
| --- | --- |
| Font | Inter metrics (2048 units per em); character map (CJK is absent); every outline piece starts where the previous ends and every contour closes; coordinates are exact dyadics; composite glyphs (é) |
| Markdown | Fixed document → exact canonical text and back; whitespace kept outside emphasis; empty blocks dropped; hand-written Markdown → canonical; **300 random documents** (all escapable characters, styles, block types): canonical form is a fixed point and the text survives |
| Layout | Greedy wrap within the width, no leading spaces, long words broken; heading scale, list marker and indent; cache |
| Model | Validate, serialize, canonicalize on load, reject empty text and zero size; bounds from layout; uniform scaling only |
| `diffToNumber` | Equals the exact computation across 10,000-level gaps and for near-equal numbers (where it stays exact); 20 calls across a 10,000,000-level gap in under 50 ms |

## End-to-end tests

`tests/e2e/text.spec.ts` (4 tests × 4 projects, 16/16):

| Test | Assertions |
| --- | --- |
| Type, format, save, reload, copy | Text tool; heading, bold and italic (keyboard), literal `*` escaped; stored Markdown exact; undo/redo; Copy Markdown from the toolbar; saved and reloaded unchanged and drawn; no console errors, no requests |
| Edit, lists, paste, delete | Double-click edits the same object; bulleted list; formatted content pasted with a real copy and paste arrives as plain text; emptying deletes (undoable) |
| Read-only tab | Cannot create or open the editor |
| **Deep** | Text written 3,000 levels deep. Edge of the "I" stem at the browser/outline switch (1,878 px and 2,048 px per em): within 1.5 px of the exact edge in both modes. At +40, +400 and +4,000 levels: background 3 px left of the exact edge, text colour 2 px right, at three heights. Inside the stem at +400: 0 holes on a 40 px grid. A CJK character at depth stays visible (raster) |

`tests/e2e/extreme-depth.spec.ts` (1 test × 4 projects, 4/4): at
2^10,000,000, pan, draw, select, move, undo and type text; each input step
under 500 ms (worst measured: 270 ms in Firefox; 145–224 ms in Chromium).

### Mutation checks

1. Far outline pieces dropped instead of replaced by arcs: the deep test
   **fails** (no fill right of the edge at +40 levels). Restored.
2. `worldToScreen` back to the exact subtraction: the extreme-depth test
   **fails** (steps of 1.6–18.6 s). Restored.

### Defects found while building

- A new text was committed twice (hiding the focused editor fires `focusout`
  synchronously, before the editor state was cleared). Undo needed two
  steps. Fixed: state cleared first.
- Firefox: bold, italic and lists did nothing. The caret was placed after
  the block instead of inside it, and Firefox does not bind `Ctrl+B`/`Ctrl+I`
  in editable content. Fixed: caret inside the last text; the shortcuts are
  handled by canvast.
- Firefox ignores `clipboardData` on constructed paste events, so the paste
  test uses a real copy and paste.

## Extreme depth (reported by the owner)

The owner reported the PC hanging at 2^10,000,000. Measured with a scripted
jump, 5 arrow-key pans and one 10-point stroke (Chromium):

| Build | Jump | 5 pans | Stroke | One frame |
| --- | --- | --- | --- | --- |
| Phase 0A (`1ce2c05`) | 16 ms | 11.2 s | 27.9 s | 1,795 ms |
| v0.7.0 (`a63518d`) | 16 ms | 13.1 s | 23.4 s | 1,757 ms |
| v0.8.0 before the fix | 10 ms | 11.5 s | 23.9 s | 1,875 ms |
| v0.8.0 | 10 ms | 0.15 s | 0.20 s | 15 ms |

Firefox after the fix: 15 ms / 0.22 s / 0.25 s / 13 ms. A CPU profile put all
of the frame in landmark placement (`worldToScreen`): the exact difference
between a landmark near the origin and the camera centre needs a
10-million-bit mantissa. Not a regression: present since Phase 0A, never
tested that deep.

## Regression

`npm test` (quick suite, 4 projects) on the v0.8.0 build `457ea053…6fb2`:
**253 passed, 3 skipped by design, 0 failed** (E2E 17.2 min). Unit tests
94/94; the offline and naming checks pass.

An earlier run (before the depth fix) had 2 Firefox failures in the
dense-scene zoom-preview tests (`tiles.spec.ts`). They also failed on the
v0.7.0 build at that moment and passed in the final run; the machine was
loaded then (load average 4.2). Timing-sensitive, to watch.

## Not covered (unverified)

- IME composition (CJK input methods), screen readers inside the editor.
- Real displays (headless only); font hinting differences on other systems.
- Very long texts (tens of thousands of characters) for editing and
  drawing speed.
