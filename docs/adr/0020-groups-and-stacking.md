# ADR 0020 — Groups and stacking order

- Status: accepted (Phase 2, slice 4)
- Related: ADR 0018 (rotation), ADR 0019 (snapping), engineering plan §14 (explicit groups, undoable, serializable; no implicit parenting by overlap) and §16 Phase 2

## Context

The plan asks for explicit nested groups with stable ids, undo and redo, transform-preserving ungroup, and says rotation, groups and multiple canvases must not introduce a second coordinate authority. Overlap never groups anything: a stroke drawn over an image stays independent (ADR 0003).

## Decision

**A group is membership, not a transform.** Every object may carry `groups`: the ids of the groups that contain it, from the outermost to the innermost (`doc/groups.ts`). A group exists while an object lists its id; there is no separate group record, so nothing can disagree with the objects.

- **Transforms are the multi-selection's.** Moving, turning or scaling a group is the same exact operation as on a multi-selection (translate, `rotateAbout`, `scaleAbout`), applied to every member. There are no nested transforms to resolve when drawing, picking, indexing or snapping, so groups add no second coordinate authority, and ungrouping needs nothing to preserve (each member already holds its own exact transform).
- **Selection works in units.** At the top level an object's unit is its outermost group (or itself): clicking, box-selecting or lassoing a member selects the whole group. Double-clicking a grouped object goes one group deeper (`editor.entered`); Escape leaves the group entered last; picking something outside the entered group leaves it.
- **Commands** (one undo step each): Group (Ctrl+G) wraps the selected units in a new group at the level being worked at; Ungroup (Ctrl+Shift+G) dissolves that level and members move up one level; the nesting stays a tree because selections are always whole units.
- **Stacking:** Bring to front (Ctrl+]) and Send to back (Ctrl+[) re-stack the selection, keeping its order among itself (`restack`). Overlap order is still `z`; groups do not reorder members.
- **Storage:** `groups` is part of the object record (no schema change; archive version 3 carries it). Validation: 1 to 16 distinct group ids.

## Not in this slice

Layers with names, visibility and locking (next), opacity and blending controls, reusable definitions and instances, attach and detach (`attachmentTargetId` stays unused).

## Consequences

- Anything that selects objects must go through `pick` (tools) so groups are respected.
- A group is only as large as its members' bounds: its selection outline is each member's.
