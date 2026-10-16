# API

## `createColourPicker(options?) → ColourPicker`

Makes a picker. Append `picker.el` where you want it. The picker is `size` px wide in every layout (default 208).

### Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `value` | string | `"#2563eb"` | The start colour: hex of 3, 4, 6 or 8 digits (the `#` is optional), `rgb()` or `oklch()`. |
| `model` | `"okhsl" \| "okhsv" \| "okhcl"` | `"okhsv"` | The colour model the channels are in. The user can switch it. |
| `view` | `"wheel" \| "plane" \| "sliders" \| "mixer"` | `"wheel"` | The layout (see below). The user can switch it. |
| `views` | `View[]` | all four | The layouts the switch offers. |
| `alpha` | boolean | `false` | Offer transparency. Off: colours are opaque and values are `#rrggbb`. On: a fourth slider, and `#rrggbbaa` when the colour is not opaque. |
| `format` | `"hex" \| "rgb" \| "oklch"` | `"hex"` | How the text field writes the colour. Typing accepts every format whatever this is. |
| `eyedropper` | boolean | `true` | Show a button that picks a colour from the screen, where the browser has `EyeDropper` (Chromium; hidden elsewhere). |
| `contrast` | string | none | A colour to compare against; the picker shows the WCAG 2 ratio and grade (AAA, AA, AA large, Fail). A transparent colour is mixed over it first. |
| `harmony` | `Harmony[]` | none | Show swatches of the colour with its hue turned: `complementary`, `split`, `triad`, `analogous`, `tetrad`. They follow the colour as it moves. |
| `groups` | `{ label, colours[] }[]` | none | Swatch rows under the picker (your recent colours, a palette). Choosing one sets the colour. |
| `size` | number | `208` | Side of the ring in CSS px. |
| `labels` | `Partial<Labels>` | English | Every word the picker shows; see `Labels` in `picker.ts`. |
| `display` | `(value) => css` | identity | The CSS colour to draw a stored value as. For a host that draws one value differently, for example a theme's ink. |
| `onInput` | `(value) => void` | none | Every step of a drag or key press. |
| `onChange` | `(value) => void` | none | Once, when a gesture ends (pointer up, Enter, a swatch). Not called when the value did not change. |
| `onModel`, `onView`, `onFormat` | `(x) => void` | none | The user switched; keep it to reopen the same way. |
| `injectStyles` | boolean | `true` | Add the stylesheet to the document. Pass `false` if you include `PICKER_CSS` yourself. |

### Layouts

| `view` | Shows | For |
| --- | --- | --- |
| `wheel` | A hue ring around a box of the other two channels, and their numbers. | The usual choice: two gestures reach any colour. |
| `plane` | A wide plane of the other two channels, a hue bar, and their numbers. | A bigger target for saturation and value or lightness. |
| `sliders` | One slider and number per channel. | Precision and accessibility. |
| `mixer` | The ring and box, and the sliders under them. | Rough and fine in one view; the tallest. |

### Methods and properties

| Member | Meaning |
| --- | --- |
| `el` | The root element. |
| `value` | The current colour: `"#rrggbb"`, or `"#rrggbbaa"` when `alpha` is on and the colour is not opaque. |
| `setValue(text, asOriginal?)` | Show a colour from outside. Fires nothing. `asOriginal` also makes it the "before" half of the preview. An opaque value (`#rrggbb`) keeps the current opacity when `alpha` is on, as a swatch does. |
| `setModel(m)`, `setView(v)`, `setFormat(f)` | Switch from outside (the `on…` callbacks are for the user's switches only). |
| `setGroups(groups)` | Replace the swatch rows, for example after a colour is added to the recent list. |
| `destroy()` | Remove the picker and cancel what it scheduled. |

### Keyboard

| Where | Keys |
| --- | --- |
| Model switch | Left and Right move between the three. |
| Ring | Arrows turn the hue by 1°, with Shift by 10°, with Alt by 0.1°; Page Up and Down by 15°. |
| Box or plane | Arrows move the two channels by 1%, with Shift by 10%, with Alt by 0.1%. |
| Sliders | The native range keys: arrows, Page Up and Down, Home and End. |
| Text field | Enter applies. A colour that parses is applied as you type. |

## `<colour-picker>`

`defineColourPickerElement(name = "colour-picker")` once. Attributes: `value`, `model`, `view`, `format`, `alpha`, `contrast`, `size`, `eyedropper="false"`. Property `value`. Events `input` and `change`, with `event.detail.value`. The picker is in a shadow root; `--cp-*` properties pass through it.

## The maths (`colour.ts`)

Colours here are `Rgb = [r, g, b]` bytes, and a model's colour is a `Triple = { h, s, x }`: hue in degrees, then two numbers from 0 to 1 (saturation or relative chroma, and value or lightness).

| Function | Does |
| --- | --- |
| `toRgb(model, h, s, x)` | Triple to bytes. About 1 µs. |
| `fromRgb(model, r, g, b, hue?)` | Bytes to triple. A grey has no hue: `hue` is kept, so a slider does not jump. |
| `convert(from, to, triple)` | The same colour in another model. |
| `paintPlane(model, hue, w, h, out)` | Fill RGBA bytes with the plane of a model at one hue, 4 to 5 times faster than converting each pixel (see performance.md). |
| `parseColour(text)`, `formatColour(colour, format)`, `colourToHex(colour)` | Text to `{ rgb, alpha }`, and back. |
| `parseHex`, `rgbToHex`, `tripleToHex`, `hexToTriple` | The hex-only helpers. |
| `rgbToOklch`, `oklchToRgb` | OKLCH, with absolute chroma. |
| `contrastRatio(a, b)` | WCAG 2 contrast of two opaque colours, 1 to 21. |
| `harmonies(rgb, kind, hue?)` | The colours of a harmony, turned in OKHCL so each stays inside sRGB. |
| `prefersDarkText(rgb)` | Whether black text reads better than white on this colour. |
