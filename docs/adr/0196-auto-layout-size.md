# ADR 0196: A sheet's size in auto layout, in plain words, and nothing cut off by a resize

- Status: **accepted** (2026-11-13)
- Related: ADR 0186, 0193 (auto layout)

## Context

A laid-out sheet hugged its contents on each axis, set by two icon toggles (Hug the width, Hug the height). Resizing the sheet by hand turned hugging off on the axis it changed, silently. A sheet resized that way and laid out as a masonry or a grid kept a short height while its pictures were made as wide as the columns: they ran past the bottom edge and the sheet, which clips, cut them off. Outlines and names were still drawn, so the pictures looked cut or empty, and nothing said why. "Hug" was hard to understand, and the Columns and Row fields both showed whatever the flow (a CSS rule overrode `hidden` on the bar's labels).

## Decision

- One **Size** choice replaces the two toggles: **Fits contents** (both axes), **Set width** (the height fits), **Set height** (the width fits; offered for a column, or when it is the sheet's), **Set size** (neither fits). The stored form stays `hug: [x, y]`.
- **A hand resize sets only the flow's axis**: the width (a column: the height). The other axis keeps fitting, so a resize never leaves contents cut off. A sheet set to Set size keeps both.
- **Overflow is said:** when something laid out runs past the edge of a sheet whose size is set (`layoutOverflow`), the bar shows **Doesn't fit: Fit**, which makes the sheet fit on the sides that overflow.
- **A picture keeps its shape when it fills**: it is made as large as the room the layout gives it allows (contained, in the middle of that room), never stretched. Its Fill choice offers Own size and Fill the room. Shapes, words and sheets still stretch.
- **An emptied Columns field** means automatic columns again (a number field can now say that empty is a value).
- **Pack start** is hidden, not greyed, when there is no room to pack in (a masonry, or a sheet that fits its contents along the flow), as other choices that do not apply.

## Consequences

- Dragging the fitted side of a sheet does nothing lasting: the layout fits it again. Set size first to give a sheet a fixed height.
- Sheets saved before keep their `hug` values; the Size choice shows them.
- Turning auto layout on for an existing sheet still keeps its size (a page keeps its shape); if its contents do not fit, the bar says so.
