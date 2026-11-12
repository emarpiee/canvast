# ADR 0193: More of auto layout: live reflow, masonry, justified rows, tracks, spans, handles, order, styles

- Status: **accepted** (2026-11-13)
- Related: ADR 0186 (auto layout on sheets), ADR 0036 (arrange: its sort keys), ADR 0120 (styles), ADR 0103 (shown results while a gesture goes on)

## Decision

- **Live reflow**: while things are moved or resized, `previewLayout` (doc/auto-layout.ts) runs the same derivation as a drop would (`withAutoLayout`) on the objects as they are shown, and the canvas draws the other items, and a sheet that hugs, at the places it gives (scene-view's shown results, as boolean results and words in shapes are). The dragged things themselves follow the pointer. A thing whose middle leaves its laid-out sheet leaves its place; one whose middle is over another laid-out sheet makes room there (the topmost). Nothing is stored until the drop, which runs the same rule.
- **Masonry** (`flow: "masonry"`): `columns` columns of one width sharing the room (or, hugging the width, as wide as the widest item); each item scaled to the column width in its shape and put in the shortest column.
- **Justified rows** (`flow: "justified"`): items at a row height aimed at (`rowHeight`, in the sheet's units) until a row is as wide as the room, then that row scaled to fill it exactly; the last row keeps the aimed height. The row height is set from the items' usual height when the flow is chosen and kept, so laying out again (after the items were scaled) does not change it. It needs a width: choosing it turns hugging the width off, as a wrap does.
- Both size the items: a group is scaled as one about its corner; a pen stroke and a turned thing as a whole; words only get wider.
- **Grid tracks** (`cols`, `rows`: `{ size: "hug" | "fixed" | "fr", v }`): a hug track is as large as what is in it alone, a fixed one its length, a share takes its part of the room left and is never smaller than what is in it (the room it cannot take goes to the others). A sheet that hugs has no room: a share hugs. Columns past the list, and rows past it, hug; `columns` stays the count when there are no tracks.
- **Spans** (`inLayout.span`): items take the next free place row by row (sparse, as CSS grid's default), as many columns and rows as they span; one that does not fit on a row goes to the next. A spanning item larger than its tracks widens those that hug, in equal shares.
- **Limits** (`inLayout.min`, `max`): a filling item's least and most size on each axis as shares (0–1) of the room inside the sheet, not lengths: they need no unit (the app renames units as things are resized) and stay true as the sheet is resized. The room left is shared among the filling items, each up to its most, again until none takes more.
- **Order rule** (`sort`): name A–Z or Z–A, largest first, by kind, with arrange's `sortUnits`, from what the canvas holds (a picture's name as placed, a text's first words). Library dates and colours are not on the canvas objects, which the derivation sees alone, so they are not offered. With a rule, a dropped item takes its place by the rule and the stacking order is not dealt again.
- **Handles on the canvas** (interaction/layout-handles.ts): a bar inside each edge of the picked laid-out sheet (alone, or with what is on it) for its padding, a bar between the first two items and between the first two lines for the gaps; their places are worked out once for drawing (scene-renderer, from main) and pressing (tools), and a drag goes through the same change as the bar's numbers (`patchAutoLayout`), shown while it moves, stored once on release.
- **Layout styles**: a style kind (`layout`) holding a whole layout with its lengths in px as seen when saved (`layoutTimes`, the one function that scales a layout's lengths, shared with resizing a sheet), given in px as seen now from the bar's Layout styles menu or the Styles panel.
- The bar: two more flows, Columns for a masonry too, Columns and rows (a popover of the shared popover rows), a row height, the order, layout styles, and on a thing a span and its limits. The packing control says why when it is greyed out.

## Consequences

- A hole a large spanning item leaves in a grid is not filled by a later small one (sparse placing, which keeps the order readable).
- A drop is still decided by the middle of what is dragged, as before; the reflow only shows it ahead.
