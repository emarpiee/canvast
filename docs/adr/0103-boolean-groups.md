# ADR 0103: Boolean groups (non-destructive Booleans)

## Status
Accepted (v0.17.0). Supersedes the destructive behaviour of [ADR 0101](0101-boolean-operations.md); its geometry (`src/doc/boolean.ts`) is unchanged.

## Decision
**Combining shapes no longer consumes them.** Union, Intersect, Subtract and Exclude overlap on the selection bar make a **boolean group**: an ordinary group (ADR 0027) whose members are the shapes, kept in the document as real paths, plus one derived object, the group's **result**, which is what the canvas draws and picks. One undo step.

**Stored as plain data.** Every object in a boolean group carries `boolOps` (group id to operation), so the operation lives with the objects and there is no group record. The result is a path with `result` set to the group's id, its own fill, outline and opacity (a new result starts as the back shape's look; after that it is the group's own, and changing the paint of the group changes only the result). Validation: `boolOps` keys must be in `groups`; a `result` must be in `groups` and in its own `boolOps`.

**The result is derived inside the transaction** (`src/doc/boolean-group.ts`, `withDerived`, called first by `DocumentStore.transaction`). Any change to a member, or to a result's operands, recomputes the results that depend on it, innermost group first, and adds them to the same transaction. Undo and redo replay whole transactions, so a result can never disagree with its members, and nothing else needs to know that results exist. If the operation cannot be done (outlines that graze undecidably, shapes too different in size) the transaction is refused for a new group and leaves the result as it is for an edit.

**Members are hidden, not gone.** They are not drawn, not in the spatial index and not picked, as for hidden objects, unless their group has been **entered** (double-click the group, or choose a member in the Layers list). Inside, members can be picked, moved, stretched, turned, edited node by node, hidden (a hidden member is left out of the result) and deleted; the result follows live while dragging (`previewResults`: the same derivation on the preview objects, never stored). Select all skips hidden members and expands to whole units.

**Nesting.** A boolean group can be combined with a shape or another boolean group; the inner result is an operand of the outer one.

**Actions.** The Combine button on a boolean group shows the four operations with the current one ticked (choosing another changes the operation), **Flatten** (the result becomes one plain path and the shapes go; also Ctrl+E) and **Release shapes** (the shapes come back as they were; the result goes). Copy and paste remap `boolOps` keys and `result` to the new ids. The Layers list shows the group with its operation's icon and hides the result row.

## Consequences
The document grows by one path per boolean group. Boolean precision limits are those of ADR 0101 (crossings to about 1e-14 of the size; features below 1e-6 of an interacting group are dropped). A selection of a group together with a plain shape no longer throws in the selection bar (found while testing nesting: the Group button read `groups[0]` of an ungrouped object).

## Tests
`tests/unit/boolean-group.test.ts` (derivation in the transaction, one undo step, hidden members, remap on paste, nesting), `tests/e2e/vectors.spec.ts` (the four operations and their ticks; entering a group and dragging a member with the result following; the group's own paint; flatten and release; reload; copy and paste; nesting; a shape drawn 30 levels in subtracts as a hole of its own size). Chromium; the rest of the affected specs in Chromium and Firefox.
