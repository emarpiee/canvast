# ADR 0118: Crop and adjustments of pictures

## Status
Accepted (v0.17.0).

## Decision
**Crop** (`ImageObject.crop`, `doc/crop.ts`). A picture shows a window of its source pixels, in whole pixels (`x, y, w, h`); its box (`w`, `h` and the anchor) is the window's size at the picture's scale. Cutting in moves an edge of the window and the box with it, so what stays does not move on the canvas; pulling the edge back out shows the source again, up to all of it. Nothing of the source is removed. **Crop** on the options bar of Select (or Enter on a picked still) makes the handles of the box move the window instead of the size (a hint says so); Enter or Escape finishes; **Show the whole picture** removes the crop. One undo step per drag. Stills only, and not turned ones (a turned picture's box is not along the screen axes). The drawing, the magnified pixel rectangles (exact at any depth) and the colour a picture has from far in all read the window (`crop` offsets the source pixel indices; edges are still projected exactly), and the size at which a reduced copy is chosen counts what the whole source would take.

**Adjustments** (`ImageObject.adjust`, `doc/adjust.ts`): exposure, contrast, highlights, shadows, temperature, tint, saturation, vibrance (all -100 to 100), blur, sharpen, grain (0 to 100), kept with the instance; the original is untouched and the numbers can always be changed again. **Adjust** (sliders) on the options bar of Select opens a popover with a slider and a number for each (drag the name of a number too), **Reset**, **Copy adjustments**, **Paste adjustments** (to the pictures picked, video and GIF too), and for stills **Copy as picture** (a PNG as it looks now, on the clipboard) and **Make a new picture** (the same baked into a new original, placed beside it, kept in the library). Sliders show live and are stored as one undo step.
- *Stills* are adjusted pixel by pixel (`render/adjust-image.ts`): the colour part is `adjustPixel`, the same function used for the magnified pixel rectangles and for the colour seen from far in, so all three agree; blur uses the canvas filter, sharpen is a 3 x 3 unsharp mask, grain is fixed noise (it does not move). The adjusted copy is kept per source and numbers. A source over 8 million pixels is drawn unadjusted at that size (it is only that big when zoomed far in, where pixels are drawn singly, and those are adjusted).
- *Video and GIF* show exposure, contrast, saturation, vibrance, temperature and blur as a CSS filter on both the player and the canvas drawing (so they look the same playing or paused); the popover offers only those for them.

## Not done
Crop of video, GIF and turned pictures; a crop with a fixed proportion; curves and levels; masks (left out by decision). Blur, sharpen and grain are not applied at depth, where pixels are drawn one by one.

## Tests
`tests/unit/crop.test.ts`, `tests/unit/adjust.test.ts`; `tests/e2e/pictures.spec.ts` (crop from both sides, undo, whole again; adjust live, copy and paste, reset), both browsers.
