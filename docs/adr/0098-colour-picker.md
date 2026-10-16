# ADR 0098: One colour picker, a standalone module (OKHSL, OKHSV, OKHCL)

## Status
Accepted (v0.17.0)

## Decision
Every place that chose a colour (the four fixed pen swatches in the toolbar, the browser's `<input type="color">` in Settings) now opens one picker.

**The picker is a module that does not know the app** (`src/colour-picker/`): `colour.ts` (pure maths, no DOM), `picker.ts` (the component), `style.ts` (its stylesheet), `index.ts`, `README.md`. It imports only files in its own folder (`npm run check:picker` fails otherwise, and is part of `npm test`), takes every word from a `labels` option and every look from `--cp-*` custom properties whose defaults sit in `:where(.cp)` (specificity 0, with a dark scheme), and keeps nothing: the host stores the model, the layout and the recent colours. `npm run build:picker` builds it alone into `dist-picker/` with a demo page that opens from `file://` (21 KiB), which is how it was checked outside the app.

**Models.** OKHSL and OKHSV are Ottosson's (gamut-relative saturation, so no slider leaves sRGB). OKHCL is OKLab hue and lightness with chroma as a fraction of the gamut at that lightness and hue. The three convert through sRGB and keep the hue through greys, so switching the model never changes the colour.

**Layouts.** Sliders (hue, the second and the third channel, each with a number field), or a hue ring around a box (the box is the other two channels). Both have a hex field, a before and after preview (click "before" to go back), the recent colours and a palette made with the picker's own OKHSL (the theme ink first).

**In the app** (`src/ui/colour-popover.ts`): a popover under the button (the toolbar's current-colour dot, the Settings row), closing on Escape and on a press elsewhere, placed under the button, above it, or under it with a scroll when neither fits. The toolbar shows the six colours picked lately in place of the four fixed swatches (the first run still shows the four old ones). Settings: Pen colour, Colour picker model, Colour picker layout. The default ink still follows the theme (`swatchBackground`): the picker shows it as the theme's colour and stores `#1f2329`. Theming: `src/styles.css` maps `--cp-*` to the app's tokens; a new token `--z-pop` is the layer of menus and popovers.

**Stored colours stay `#rrggbb`.** There is no alpha channel and no gradient: no object has either yet. Both belong to the vector objects (shapes, fills) and will reuse this picker.

## Tests
`tests/unit/colour.test.ts` (round trip of every model on edge colours and a 400-colour fuzz, greys keep their hue, hex parsing, conversion between models); `tests/e2e/colour-picker.spec.ts` (ring, box, sliders, hex, models, layouts, recent colours, reload, Settings; Chromium and Firefox).
