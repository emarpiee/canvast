# ADR 0190: Advanced controls of adjustments

- Status: **accepted** (2026-11-12)
- Related: ADR 0118 and 0123 (the Adjust panel), ADR 0189 (blur types, pixelate, ranges)

## Decision

- An adjustment that has more to set than its amount shows an arrow before its name; it folds out its **advanced controls** under its row, indented. Which are open is remembered on this device (`canvast.adjust.open`), not in the document.
- **Blur**: its *Type* (moved under the fold); for Motion the *Angle* and *Offset* (`blurOffset`, -100 to 100: the streak behind or ahead of the picture instead of on both sides); for Zoom and Spin the *Centre across* and *down* (`blurCenterX`, `blurCenterY`: a share of half the object from its middle); for the three, *Quality* (`blurQuality`: from a quarter to four times the usual copies).
- **Sharpen**: *Radius* (`sharpenRadius`, one to ten pixels): past one pixel, an unsharp mask against a blurred copy (an SVG filter on the graphics card, a running box blur in the pixels).
- **Grain**: *Size* (`grainSize`, one to eight pixels) and *Colour* (`grainColour`: grey to a noise of its own in each channel).
- **Pixelate**: *Shape* (`pixelShape`): squares or round dots (the squares cut by a dot pattern stretched to the cells: one draw however many cells).
- Every new number is 0 for the behaviour before, so nothing already made changes. Each is kept only where it means something (`cleanAdjust`): the motion settings with a motion blur, the centre with a zoom or spin, quality with a blur of another type, the radius with sharpening, the grain settings with grain, the shape with pixelate.
- The colour filter is one function (`layerPrimitives`) for the canvas, an exported SVG and a playing video, so the sharpen radius and the grain settings reach all three.

## Consequences

- Picking the middle of a zoom or spin blur is by numbers (dragged like any number); a handle on the canvas may come later.
- A saturation mix by colour (per hue) is not part of this and may come later.
