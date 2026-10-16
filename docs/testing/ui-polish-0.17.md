# v0.17.0 test record (UI, assets and canvas tools)

Run per slice on Chromium (and the new tests on Firefox), as the cadence rule says; **the full suite has not been run since v0.16.0** (Phase 7: 428 passed). Run it once before the next push or before Phase 8 begins.

| Area | Specs that cover it | Last result |
| --- | --- | --- |
| Assets: sidebar, folders (one per asset), tags (rename, delete, in-canvas lists), place menu, viewer (zoom, edges, theme, chequered ground), list columns, phone layout, Ctrl+F | `tests/e2e/assets.spec.ts`, `organize.spec.ts` | pass (Chromium); new tests also on Firefox |
| Export and import: workspace menu, plain ZIP by kind or folder | `organize.spec.ts`, `tests/unit/files-zip.test.ts` | pass |
| Canvas: Ctrl+Arrow (view, anywhere, layer; focus or keep zoom), Alt focus and cycle, fit buttons, search (`/ # @`), in-canvas tags | `editing.spec.ts`, `assets.spec.ts` | pass |
| Canvas: Figma-style resize (sides, Shift, Alt, Ctrl, edge snapping incl. proportional), Alt-drag copy, reset rotation and proportions | `editing.spec.ts`, `frames.spec.ts` | pass |
| Layers panel: sort, guides, expand all, tags row; phone and medium layouts | `text.spec.ts`, `frames.spec.ts` | pass |
| Settings: Navigation tab, shortcuts list, viewer edges | `settings.spec.ts` | pass |
| Unit | `npm run test:unit` | 180+ pass (includes `files-zip`) |

Known flaky under load (passes alone, 6 of 6): the Ctrl+F / Ctrl+Shift+F focus test and the canvas-search test once each in a long run.
