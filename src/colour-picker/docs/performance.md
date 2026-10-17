# Performance

The aim: a drag never drops a frame, on a phone as on a desk, and adding a feature does not change that.

## Where the time goes, and what is done about it

| Part | Naive cost | What the picker does |
| --- | --- | --- |
| The box or plane (the two channels at one hue) | One conversion per pixel: 5 to 7 ms for 96 × 96 | `paintPlane` computes what the pixels share once (the gamut cusp per hue, the chromas per row for OKHSL, the scale per column for OKHSV), so each pixel is a few multiplies and a table lookup for the gamma curve. **1.3 to 1.4 ms**, 4 to 5 times faster. It runs only when the hue (to a quarter degree) or the model changes, in an animation frame, never twice in one frame. |
| The hue ring | A canvas painted per pixel with `atan2` | One CSS `conic-gradient` of 91 stops under a radial mask: nothing to paint when the hue moves, crisp at any pixel ratio, rebuilt only when the model changes. |
| The slider bars | A canvas | CSS `linear-gradient`s of 13 stops, written only when their text changed (the hue bar changes with the model only). |
| The thumbs | `left` and `top` | `transform: translate`, so moving one does not lay anything out. |
| Everything else | | One reused `ImageData` per box; no allocation in a drag. |

## Numbers

Measured with `npm run bench:picker` (Node, one core of a laptop CPU; the browser does the same arithmetic):

| Model | Pixel by pixel with `toRgb` | `paintPlane` | Faster |
| --- | --- | --- | --- |
| OKHSL | 7.3 ms | 1.35 ms | 5.4× |
| OKHSV | 7.0 ms | 1.38 ms | 5.1× |
| OKHCL | 5.2 ms | 1.27 ms | 4.1× |

One `toRgb` or `fromRgb`: about 1 µs. In a browser, a hue step through the real input path (the handler: conversion, text, thumbs, tracks) is **0.47 ms**, and the frame after it (the box) fits one 16.7 ms frame with room to spare.

Size: 42 KiB minified, 15 KiB gzipped, with the gradient editor (the picker alone is 33 KiB and 12.6 KiB).

## Keeping it fast

* Work that depends on **fewer variables than the pixels** belongs outside the pixel loop (per hue, per row, per column). That is where the 5× came from.
* Do not paint what a gradient can draw. The ring and the bars cost nothing to move because they are not painted.
* Paint in `requestAnimationFrame` and only when the inputs changed (`boxKey`).
* Anything new that runs on every input (a new readout, a new swatch group) updates existing elements; it does not rebuild markup. The harmonies are the example: one animation frame, existing buttons restyled.
* The guard: `tests/e2e/colour-picker-package.spec.ts` runs 120 hue steps in the real page and fails if they take longer than 50 ms each (typically one frame, 17 ms). `tests/unit/colour.test.ts` checks that the fast painter is within 2 bytes of the exact conversion at 8 hues in every model. Run `npm run bench:picker` after changing `colour.ts`.

## What was not done, on purpose

* **A WebGL or worker painter.** At 1.4 ms for a box there is nothing to win, and a worker's round trip costs more than the work.
* **A lookup table of the gamut per hue.** The cusp is computed with one Halley step in about a microsecond; a table would cost memory and accuracy for no visible change.
