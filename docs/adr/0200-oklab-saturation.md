# ADR 0200: Saturation, vibrance and the gradient map keep how light a colour looks (OKLab)

- Status: **accepted** (2026-11-14)
- Related: ADR 0118 (adjustments), 0189 (ranges), the colour picker (Ottosson's OKHSL, OKHSV and OKLCH)

## Context

Colours made by turning only the hue in OKHSL (or OKLCH) are as light as each other: the picker follows Ottosson's reference (its OKHSL keeps
OKLab lightness at every hue; its OKHSV does not, by design: its value is measured from each hue's brightest colour, and the picker keeps
that). But *Saturation* -100 turned them into different greys (92 to 106 for four OKHSL colours of one lightness; 49 to 96 in OKLCH), because
it made its grey by a brightness formula of the RGB values: Rec. 601 luma on gamma-encoded values for stills, the SVG `saturate` matrix in
sRGB for shapes, CSS `saturate()` for a playing video. It looked as if the hue had changed the lightness. The gradient map placed colours by
the same luma.

## Decision

- **Saturation and vibrance work in OKLab**: they multiply the chroma (a, b) and keep L, so -100 is the grey as light as the colour looks
  (`greyOf(L)`: the sRGB value of the grey of that OKLab lightness). Vibrance keeps its rule for how much each colour is lifted.
- **The gradient map** places a colour by the same lightness: a grey keeps its place (for a grey, the new measure is its own value), colours
  of one lightness share one.
- **Speed**: the OKLab step is worked out once for a 33 x 33 x 33 grid of colours when the settings are set, holding linear light before
  it is cut to sRGB (smooth, so read between its points it stays exact: worst 2 levels in 200,000 random colours), and read per pixel
  (trilinear); the cut and the gamma are tables. About twice the time of the RGB formula on a still (12 MP: 0.56 s before, about 1.2 s; at
  most 8 MP is adjusted at once).
- **Shapes** with saturation, vibrance or a gradient map are adjusted on their pixels, the whole stack as a picture's (`needsPixels`), not
  through the SVG filter, so a shape and a picture of one colour give one grey. Without those, shapes keep the filter on the graphics card.
- **SVG and a playing video**, where only a filter can be used: saturation and the gradient map work by luminance in linear light
  (`color-interpolation-filters="linearRGB"`), the closest a filter comes; a limitation in the README.
- The OKHSV of the picker stays as the reference has it.

## Consequences

- Pictures and shapes that use saturation, vibrance or a gradient map look a little different (their greys and map colours now follow how
  light the colours look).
- Tests: the picker's hue (OKHSL and OKLCH keep OKLab lightness at every hue, OKHSV does not; the standalone picker keeps its other two
  fields and the lightness while only the hue is typed, and comes back to the same colour); saturation, vibrance and the map (`adjust.test.ts`).
