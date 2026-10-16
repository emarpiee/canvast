# ADR 0074: Space between items in a grid

## Status
Accepted (v0.17.0)

## Decision
- The Arrange menu has a row **Space between items**: None, Tight, Normal (the old fixed 8%), Wide, Wider (0, 2%, 8%, 20%, 50% of the largest item). It is the device setting `arrange.gap`, also a row in Settings > Drawing and selection.
- Arrange in a grid uses it (`arrangeGrid(units, key, gap)`). Choosing another spacing right after a grid, with the same items still selected, lays that grid out again with it (one more undo step); otherwise it only sets the spacing for the next grid.
- The batch-import grid (ADR 0030) keeps its own fixed spacing.

## Consequences
Presets, not a free number: enough for the common cases and nothing to validate. A custom value can be added as another preset later without changing the format.
