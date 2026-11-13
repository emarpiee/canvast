# ADR 0194: Arrange and auto layout, each with its own job

- Status: **accepted** (2026-11-13)
- Related: ADR 0036 (arrange, align, distribute), ADR 0186 and 0193 (auto layout)

## Context

Arrange in a grid had become a weaker auto layout grid that does not last, and on things a sheet lays out, Align and Distribute were undone at once (the layout ran again) or read as a drop that changed their order.

## Decision

- **Arrange stays the tool for once**: align, distribute and a grid, anywhere, moving things one time.
- **Keep it tidy** (`arrange.keepTidy`, a tick in the Arrange menu and a row in Settings, off at first): Arrange in a grid makes the grid as a sheet with auto layout round the things (`arrangeAsLayout`: the grid Arrange would make, its columns and space from `gridShape`, shared with `gridCells`), its order kept as the sheet's rule. The new-sheet-round-them step is one function with Shift+A (`laidOutAround`).
- **Things a sheet lays out are placed by it** (`laidOutSheetOfSelection`: every picked thing on one laid-out sheet): Align and Distribute are greyed out with a hint, and `layoutSelection` says so for any other way in; an Arrange order sets the sheet's Order rule (`orderLaidOutSheet`), the menu ticking the one it has.
- **A date order for layouts**: a picture keeps when its file came into the library (`ImageObject.added`, from the record as it is placed), so the derivation, which sees only the canvas, can order by it (`sort: "date"`, newest first). A picture placed before this has no date: choosing a date order (in the bar, or by Arrange) gives the pictures of that sheet theirs from the library in the same undo step.

## Consequences

- An order by colour stays Arrange-free and layout-free: colours are in the library, not on the canvas objects.
- A picture copied from a canvas keeps its date; a picture whose file is replaced keeps the one it had.
