# ADR 0145 — Picking several nodes, Divide, the Shape builder

- Status: accepted (v0.19.0)

## Several nodes, several paths

Edit nodes works on **every picked path**, not only one. Shift-click picks nodes together (and takes one out again); a drag from empty ground draws a lasso round nodes (Shift adds; a click on empty ground clears as before); dragging a picked node moves all of them, across paths, as one undo step; Delete takes them all away. The state is `editor.nodeMulti` (path → "sub-path:node" keys); one node on one path is still the old single-node editing, with its handles. Moving nodes of a vector network moves the whole vertex (ADR 0146).

## Divide and the Shape builder (`faces.ts`, `divide.ts`)

The regions overlapping shapes make: for every combination of up to six shapes, the shapes in it intersected and the others taken out (the Boolean tools, so curves stay curves). **Divide** replaces the shapes with their regions, each with the look of the shape on top. The **Shape builder** shows those regions instead of the shapes: a stroke across regions merges them into one shape, an Alt-stroke deletes them, Enter keeps the result (merged ones united, one undo step), Esc cancels. If two outlines graze each other so closely that the Boolean tools cannot tell them apart, it says so and changes nothing.
