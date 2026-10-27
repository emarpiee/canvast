# ADR 0098: One colour picker, a standalone module (OKHSL, OKHSV, OKLCH)

## Status
Accepted (v0.17.0)

## Decision
Every place that chose a colour (the four fixed pen swatches in the toolbar, the browser's `<input type="color">` in Settings) now opens one picker.

**The picker is a module that does not know the app** (`src/colour-picker/`): `colour.ts` (pure maths, no DOM), `picker.ts` (the component), `element.ts` (`<colour-picker>`), `style.ts` (its stylesheet), `index.ts`, and its own documentation (`README.md`, `docs/api.md`, `theming.md`, `performance.md`, `design.md`).

**Speed.** The box is painted by `paintPlane`, which computes what the pixels share once (4 to 5 times faster than converting each pixel: 1.3 ms for 96 x 96); the ring and the slider bars are CSS gradients, so a hue drag paints only the box. A hue step is 0.47 ms in the handler. `npm run bench:picker` measures it and the package E2E spec guards it. It imports only files in its own folder (`npm run check:picker` fails otherwise, and is part of `npm test`), takes every word from a `labels` option and every look from `--cp-*` custom properties whose defaults sit in `:where(.cp)` (specificity 0, with a dark scheme), and keeps nothing: the host stores the model, the layout and the recent colours. `npm run build:picker` builds it alone into `dist-picker/` with a demo page that opens from `file://` (21 KiB), which is how it was checked outside the app.

**Models.** OKHSL and OKHSV are Ottosson's (gamut-relative saturation, so no slider leaves sRGB). OKLCH is OKLab in polar form (CSS `oklch()`), with chroma clipped to the sRGB gamut at that lightness and hue. The three convert through sRGB and keep the hue through greys, so switching the model never changes the colour.

**Layouts** (four, chosen in the picker and in Settings): a hue ring around a box; a plane with a hue bar; sliders; the ring with sliders under it. All have a text field (hex, `rgb()` or `oklch()`, any of them typed or pasted), a before and after preview (click "before" to go back), the recent colours and a palette made with the picker's own OKHSL (the theme ink first). The package also has transparency, an eyedropper, a contrast readout, harmonies and a `<colour-picker>` element; the app uses the eyedropper (where the browser has one) and leaves the rest off until an object needs them (transparency and gradients come with the vector fills).

**In the app** (`src/ui/colour-popover.ts`): a popover under the button (the toolbar's current-colour dot, the Settings row), closing on Escape and on a press elsewhere, placed under the button, above it, or under it with a scroll when neither fits. The toolbar shows the six colours picked lately in place of the four fixed swatches (the first run still shows the four old ones). Settings: Pen colour, Colour picker model, Colour picker layout. The default ink still follows the theme (`swatchBackground`): the picker shows it as the theme's colour and stores `#1f2329`. Theming: `src/styles.css` maps `--cp-*` to the app's tokens; a new token `--z-pop` is the layer of menus and popovers.

**Stored colours stay `#rrggbb`.** There is no alpha channel and no gradient: no object has either yet. Both belong to the vector objects (shapes, fills) and will reuse this picker.

## Tests
`tests/unit/colour.test.ts` (round trip of every model on edge colours and a 400-colour fuzz, greys keep their hue, hex parsing, conversion between models, the fast painter within 2 bytes of the exact conversion, text formats, contrast, harmonies); `tests/e2e/colour-picker.spec.ts` (in the app: ring, box, sliders, hex, models, layouts, recent colours, reload, Settings) and `tests/e2e/colour-picker-package.spec.ts` (the package's demo page alone: four layouts, plane, transparency, text formats, contrast, harmonies, the custom element, 120 hue steps within budget). Chromium and Firefox.

## Amendment (v0.47.0): OKHCL replaced by OKLCH

The third model was first called OKHCL: OKLab hue and lightness with chroma as a fraction of the gamut. It was this project's own construction (the maths was sound, and it was checked to be OKLCH with chroma rescaled), but it is not a published model, and its name looked like Ottosson's family. It is replaced by **OKLCH**, the standard OKLab polar form that CSS `oklch()` uses: lightness is OKLab's own, chroma is absolute (the slider runs 0 to 0.4, the range CSS gives percentages), and chroma that sRGB cannot show is reduced at the same lightness and hue. The triple keeps the chroma asked for (so it returns when the lightness or hue moves back); sliders, thumbs and numbers show the clipped value; the plane leaves what sRGB cannot show transparent. Harmonies still turn the hue at the same lightness and share of the gamut (`turned`), which is no longer a model of the picker. A stored `colour.model` of `okhcl` reads as `oklch`.
