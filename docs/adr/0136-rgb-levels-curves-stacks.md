# ADR 0136 — Red, green and blue, levels, curves, and stacks of adjustments

- Status: accepted (v0.18.1)
- Related: ADR 0118 (adjustments), 0122 (gradient maps)

- **Red, green and blue** (−100 to 100): a stop of that primary light either way, applied with temperature and tint.
- **Levels** (`levels`, for all channels together and for each of red, green and blue): the input from a black point to a white point is stretched to the whole range, and a gamma bends the middle. **Curves** (`curves`, the same channels): up to 16 points a smooth monotone curve (Fritsch–Carlson tangents: no overshoot) passes through. Both are applied last, as one 256-entry table per channel: the master's, then the channel's own. A curve is edited on a small canvas: click to add a point, drag it, double-click to remove; with the keyboard `[` and `]` choose a point, the arrows move it (Shift: ten steps) and Delete removes it.
- **Stacks** (`next`): an adjustment may have another after it, applied to its result, up to 8 layers; each layer has its own numbers, edited by choosing its tab in the panel (+ adds one after the last, × removes the one being edited). A layer that changes nothing is dropped when stored. Stills are made layer by layer (the next layer draws from the result of the one before, so a blur of a later layer blurs the earlier work); a picture that plays uses one filter with the primitives of every layer in order (the blur of the first layer only).
- **A gradient map's transparency** is used: where the brightness reaches a clear stop the picture becomes clear, as far as the amount goes (stills; not for a picture that plays, nor magnified past its pixels).
- Checked: `tests/unit/adjust.test.ts`; `tests/e2e/pictures.spec.ts` (both browsers).
