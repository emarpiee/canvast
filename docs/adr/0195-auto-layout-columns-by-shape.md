# ADR 0195: Auto layout columns by count or by shape

- Status: **accepted** (2026-11-13)
- Related: ADR 0186, 0193, 0194 (auto layout, Arrange)

## Context

A grid or masonry with no columns set had about as many columns as rows (⌈√n⌉) from the number of items alone, whatever their shapes or the sheet's: tall photographs made a tall narrow board, wide ones a long strip, and a sheet sized as a page or a 16:9 board overflowed or stayed half empty.

## Decision

- A layout says how it chooses its columns when none are set (`columnsBy`): **count**, the former rule, or **shape**. A number set, or a grid's tracks, always wins.
- **By shape**, for a block about `ratio` times as wide as tall: 1 (about square) when the sheet hugs on either axis, the room inside the sheet's width over its height when its size is set both ways (the items fill it). A masonry's items are scaled to one width, so the heights they take add up (Σ h/w) and √(Σ h/w × ratio) columns give that shape. A grid's cell is as large as its largest item, so its columns are Arrange's rule (`shapedColumns`, now shared with `gridShape`) with that ratio.
- Absent means count: layouts made before keep their columns, so nothing on a canvas moves. Layouts made from now (`guessLayout`: Shift+A, the Layers badge, the Sheets menu; Keep it tidy) start with shape. The bar shows the choice beside Columns while none are set.

## Consequences

- A grid by shape may change its columns when its largest item is resized (the cell is its size); a masonry's only when items come or go (they are scaled to the column width).
- Wrap and justified rows have no column count: the sheet's width decides, as before.
