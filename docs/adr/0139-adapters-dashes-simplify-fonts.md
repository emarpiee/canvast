# ADR 0139 — Content adapters, dash numbers, Simplify, words in their own font

- Status: accepted (v0.18.1)

## Content adapters for 3D models and PDFs (`src/assets/adapters.ts`)

An STL (binary or ASCII) or OBJ file is read (up to 400,000 triangles; the original is stored whole and unchanged) and its card shows the model itself: a fixed three-quarter view, flat-shaded, far triangles first, with the triangle count. A PDF's card shows its page count (page objects counted in the bytes: a file that hides them in compressed object streams shows the plain card). It is still a card (`card: true`): thumbnails, the library and the stored size (400 × 300) work as before, and any file that cannot be read keeps the plain card. A real PDF rasteriser or 3D viewer is a different, large piece (a renderer to ship offline); it is a future phase, not a gap in this one.

## Dash length, gap and start

Outline options (for a picked dashed path) have Dash, Gap and Start as numbers in widths of the outline. `dashOffset` is a new optional field of a path (validated, kept by boolean groups, written as `stroke-dashoffset` by Export as SVG). A preset (dashed, dotted) starts its pattern at 0; the other style changes keep the numbers. A dash of 0 is a dot and needs round ends, so the end style is reset.

## Simplify and pen stroke to path (`src/doc/fit-curve.ts`)

Schneider's curve fitting (Graphics Gems): a polyline becomes as few cubic segments as keep every point within a tolerance. **Simplify** cuts each sub-path to a polyline and fits it again (tolerance a four-hundredth of the shape's longer side, never finer than an eighth of the outline); it never adds nodes, a closed path stays closed, and a shape made by a tool (rectangle, polygon, rounded corners) loses its parameters. **Pen stroke to path** turns a stroke into an open path of the same colour and width, with round ends (tolerance a quarter of the width), in the same object (id, layer name, tags).

## Words in their own font

A span may carry `font` (a library font's hash), written `<span style="font-family:HASH">` and kept like a colour or a size. Layout sets those words in that font (its bold or italic file when the library has one); the editor draws them with the font's CSS family and reads the family back as the font (the regular file of the family). The format bar has a list of the library's fonts for the selected words, and "Font of the text" takes the font away. The page loads every font a text names.

## Not done, and why

Angular gradient and arrow ends touch the picker package, the exact (deep zoom) fill, SVG export and import; lasso nodes, shape builder, outline stroke, miter angle, variable-width paths and corner smoothing each need geometry that is not in the code yet (stroke offsetting, region finding). They stay on the vector list in `docs/status.md`.
