# ADR 0186: Auto layout on sheets

- Status: **accepted** (2026-11-10)
- Related: ADR 0108 (sheets), ADR 0133 (Scale contents), ADR 0185 (derivations in a transaction: balloons, text in shapes), ADR 0036 (align, distribute, arrange)

## Decision

- A sheet can have an **auto layout** (`container.layout`, `doc/model.ts` `SheetLayout`): a flow (row, column, wrap, grid), a gap along and across the flow, padding on four sides, an alignment across the flow, a packing along it, whether it hugs its width and its height, and the columns of a grid. The lengths are in the sheet's own units, so they scale with it (`edit-ops.ts` scales them with the sheet's geometry).
- A thing on such a sheet can **fill** the room along an axis, or stay **free** of the layout (`inLayout`).
- The layout is a **derivation** (`doc/auto-layout.ts` `withAutoLayout`), run first in `DocumentStore.transaction`: whatever a change does to a sheet with auto layout, or to what is on it, lays the sheet out again in the same transaction, then the sheet it is on when it hugs and changed size, up the chain. Inner sheets go first. So undo is one step, and no stored object is ever out of step with the rules.
- An **item** is a thing directly on the sheet or a group of them (its outermost group), at its own size; what belongs to a shape (words, connectors) follows it by the belongs rule and is no item. Hidden and free things are left where they are. The items' order is the stacking order, front first, as the Layers panel reads. A thing **dropped** on the sheet (new on it, moved on it, shown again, back from free) takes the place it is dropped at: the items' z values are dealt again in the new order.
- A sheet **resized by hand** stops hugging on that axis and keeps the size given. *Fit to contents* is not offered for such a sheet (it hugs).
- Turning the layout on **reads it from where things are** (`guessLayout`): one line across is a row, one line down a column, lines of equal counts a grid, else a wrap; the gap is the usual one between neighbours, the padding the room to the edge. The sheet keeps its size. `Shift+A` on things that are on no sheet puts them on a new sheet that hugs them with that layout, as other tools do.
- The pure placing rule is `placeItems` (sizes in, boxes and the hugged size out), tested on its own.

## Consequences

- A long row of items on a sheet that does not hug runs past its edge (it is cut when the sheet clips), as in other tools; a wrap needs a width, so choosing it turns hugging the width off.
- A pen stroke and a turned thing never fill (they keep their shape); words fill the width only (they wrap again).
- A video playing on a nested sheet that fills follows the sheet's pins, like any resize of a sheet.
- While an item is dragged, the others do not step aside yet: the item takes its place when it is released. (Since ADR 0193 they do, ahead of the drop.)
