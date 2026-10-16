# ADR 0073: A selection being moved is drawn see-through

## Status
Accepted (v0.17.0)

## Decision
While a selection is moved, turned or stretched, the picture on screen shows it at 60% of its own opacity (`GHOST_OPACITY`), so what is behind it stays readable. It is applied only in `scene-view.ts` to the previewed copy; the committed object, undo and hit-testing never see it.

## Cost
Per frame: one object copy per moved object. A see-through stroke cannot share a batched `stroke()` call (batching needs opacity 1), so above 200 moved objects (`GHOST_MAX`) the selection stays opaque and the drag keeps its frame rate. Images and text are painted with the same single `globalAlpha` they use anyway: no extra cost. Tiles are not involved: moved objects are already drawn live, outside the tile cache.
