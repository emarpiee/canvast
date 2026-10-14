# ADR 0023 — Per-canvas cameras and drawing-surface recovery

- Status: accepted (Phase 2, slice 7: the last item of Phase 2)
- Related: ADR 0002 (Canvas 2D, CPU first), ADR 0006 (workspace storage), engineering plan §16 Phase 2 ("per-canvas cameras", "backend recovery")

## Per-canvas cameras

Already true since Phase 1a and checked again here, so nothing was built for it. Each canvas has its own saved view in the `canvasViews` store (frame form since ADR 0014, the absolute camera of older data still opens). Switching canvases saves the current camera, loads the target's, and an archive carries each canvas's view with it. The E2E test "boards and canvases: create, rename, switch; each canvas keeps its own objects and camera across reloads" (`storage.spec.ts`) covers it in all four projects. Navigation history, bookmarks and named regions are Phase 7 (professional UX).

## Render backends

There is one backend: Canvas 2D on the CPU path (ADR 0002), behind the seams the code already has: `projectObject` and `visibleObjects` decide what is drawn, `drawObjects` and the tile cache draw it, `drawOverlays` draws what is never cached. A GPU backend would replace the drawing functions, not the scene, picking or storage; it is not built because nothing needs it yet (the CPU path meets the frame budgets of ADR 0009 to 0012 on dense scenes).

## Drawing-surface recovery

The browser may take a canvas's 2D surface away (a GPU process reset, memory pressure) and give it back (`contextlost`, `contextrestored`). The handlers in `app/main.ts`:

- on loss: `preventDefault()` (so the browser is allowed to restore it) and a short message;
- on restore: drop the tile cache (its tiles are canvases of their own and may have been lost too), clear the message and redraw.

The document, the camera, the selection and every stored object are untouched, because none of them lives in the surface. Tested by firing the two events by hand (a real loss cannot be forced from a test): the picture has the same ink, the camera is unchanged and editing still works, in all four projects. Firefox does not fire these events for 2D canvases today; the handlers cost nothing there.

## Consequences

Phase 2 is complete once the full suite has run (decision of the owner: run it at the end of the phase).
