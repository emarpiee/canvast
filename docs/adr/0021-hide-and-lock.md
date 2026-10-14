# ADR 0021 — Hiding and locking objects

- Status: accepted (Phase 2, slice 5)
- Related: ADR 0020 (groups), ADR 0003 (picking), engineering plan §14 (layers: visibility and locking)

## Context

The plan lists layers with visibility and locking. Stacking order is already `z` (ADR 0020) and groups can play the role of a layer (a group is a named-by-membership set that moves, hides and locks together because a selection always takes whole groups). What was missing is hiding something without deleting it, and protecting something from stray clicks.

## Decision

Two flags on every object, stored with it (`hidden`, `locked`; true or absent):

- **Hidden** objects are not in the spatial index (`syncIndex` skips them). Everything that reads the index therefore ignores them: drawing, picking, the tile cache, the density preview and the zoom preview. No per-consumer filter, nothing to forget. Un-hiding re-inserts the object like any change.
- **Locked** objects stay in the index, so they are drawn, shown in the density preview and still serve as snap targets (ADR 0019), but a click, a lasso, a box or select-all never takes them, and a double-click does not edit them.
- Hide and Lock act on the selection and then clear it (a hidden object cannot be seen, a locked one cannot be picked). **Show all hidden** and **Unlock all** clear the flag everywhere and say how many objects changed. Each is one undo step.
- Archives carry the flags (version 3), so a hidden or locked object stays so after an export and import.

## Not in this slice

A list of objects or layers to hide, lock or rename one by one (the two "all" buttons are the way back for now), per-group visibility toggles on the canvas, blending and opacity controls.

## Consequences

- A hidden object that is still wanted must be found by Show all hidden; there is no way to see which objects are hidden until then. That is the reason for the follow-up list.
