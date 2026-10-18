# ADR 0153 — Picture gaps, reveal gaps, vector PDF and WebP resolution

- Status: accepted (v0.19.2)

Closes the gaps ADR 0148, 0149 and 0147 listed as "not done".

## Pictures (ADR 0148)

- **Outline gradient.** A picture's `stroke` is a `Paint`: a colour or a gradient, placed on the picture's box like a shape's (`pictureBox` in `render/gradient.ts` makes the rectangle path the gradient is placed on; a turned picture is drawn turned by the canvas, so the gradient turns with it). The Outline swatch's chooser, the gradient's handles on the canvas (`gradientHandles` takes a picture) and undo work as for a shape.
- **Radius dots on the canvas.** A single picked, unlocked picture has the shape's radius dots (`cornerHandles`: the four corners of its box, seen through its turn): the main dot sets all four, a double click or a long press opens them out to one each (`commitCornerAt` takes a picture). Radius is never above half the shorter side.
- **Picking by the rounded outline.** A click in a corner the radius cuts away does not pick the picture (`insideRoundedBox` in `render/hit-test.ts`, within the usual few px of the curve).
- **Arrow heads** do not apply: a picture's outline is closed, and arrow heads are for open paths.

## Reveal (ADR 0149)

- **What cannot be picked is shown, dotted**, after what can be, with the reason in its words: locked things, the parts of a mask that cuts something there (`maskPos`), and hidden things (`hiddenInView`: projected on their own, listed once for each state of the document, at most 400). `dimHits` in `interaction/reveal.ts`; a click still picks only what `revealHits` finds.
- **Screen reader.** The words ("Under the pointer: Rectangle, Photo (locked)") are also put in the hint line (`editor.revealText`), which is a polite live region, once for each change. They show when Settings > Hints and tooltips is not "none".
- **Edit nodes and Lasso** show the reveal as well (the outline and the words); their clicks are unchanged.

## Export (ADR 0147)

- **Vector PDF.** A page whose target is all plain paths is drawn by the paths themselves (`app/pdf-vector.ts`, framed like the SVG export through `layoutPaths`): fill and outline colour with transparency, linear and radial gradients (as shadings), width, corners, ends, dashes, the fill rule, opacity and blend modes. A page with anything else (masks, networks, live width profiles, arrow heads, an outline inside or outside, a gradient outline or one with transparent stops, a sweep gradient, opacity with both fill and outline) is made as a picture, as before; pages of one PDF can mix both. Pictures, text and sheets are always pictures.
- **WebP resolution.** The print resolution is written into the WebP as an EXIF chunk (`webpWithDpi`; a plain WebP gets a VP8X header first), as PNG and JPEG already had.

## Not done

A marquee does not reveal what it would take; no on-canvas gradient handles for a picture's outline when the picture is cropped in the crop mode; vector PDF of text and pictures.
