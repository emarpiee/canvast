# API

## `createColourPicker(options?) → ColourPicker`

Makes a picker. Append `picker.el` where you want it. The picker is `size` px wide in every layout (default 232).

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
| `theme` | `"auto" \| "light" \| "dark"` | `"auto"` | `"auto"` follows `prefers-color-scheme`; the others choose whatever the system says (the same as `data-cp-theme` on the picker or on anything around it; see [theming.md](theming.md)). |
| `size` | number | `232` | Side of the ring in CSS px. |
| `labels` | `Partial<Labels>` | English | Every word the picker shows; see `Labels` in `picker.ts`. |
| `display` | `(value) => css` | identity | The CSS colour to draw a stored value as. For a host that draws one value differently, for example a theme's ink. |
| `onInput` | `(value) => void` | none | Every step of a drag or key press. |
| `onChange` | `(value) => void` | none | Once, when a gesture ends (pointer up, Enter, a swatch). Not called when the value did not change. |
| `onModel`, `onView`, `onFormat` | `(x) => void` | none | The user switched; keep it to reopen the same way. |
| `onCopy` | `(text) => void` | none | A swatch was copied (long press, right click, or Ctrl/Cmd+C on it): `text` is `#RRGGBB`. The colour is not chosen. |
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

## `createGradientEditor(options?) → GradientEditor`

A bar showing the gradient with a handle per stop: drag a handle to move the stop, click the bar to add one (in the colour the gradient has there), Delete or the − button removes (never below `minStops`, default 2; at most `maxStops`, default 16), arrows move the focused stop by 1% (Shift 10%), Home and End to 0 and 100%. Below it: Linear or Radial, the position of the selected stop, a reverse button, the angle (linear) or the centre and radius (radial), and this package's picker, with transparency, for the selected stop.

| Option | Meaning |
| --- | --- |
| `value` | `{ type: "linear" \| "radial" \| "angular", angle, cx, cy, r, stops: [{ offset, colour }] }`. `angle` in degrees (0 runs left to right, 90 top to bottom); `cx`, `cy`, `r` as fractions of the box the gradient is on; offsets 0 to 1; colours `#rrggbb` or `#rrggbbaa`. What angle and centre mean on a shape is the host's business. `"angular"` goes round the centre, the first stop at `angle`; the editor's own Linear and Radial switch offers only the other two, so the host chooses it. |
| `picker` | Options for the stop's picker (`model`, `view`, `format`, `groups`, `labels`, `size`, `display`, `onModel`, …). Transparency is always on. |
| `theme` | `"auto"` (follows the system), `"light"` or `"dark"`: as for the picker; the picker of the selected stop follows. |
| `labels` | Every word of the editor (`GradientLabels`). |
| `minStops`, `maxStops` | The limits on the number of stops. |
| `onInput`, `onChange` | The value on every step, and once when a gesture ends or a field is committed. |

Members: `el`, `value` (a copy), `setValue(value)` (fires nothing), `destroy()`. The editor is themed by the same `--cp-*` properties.

## `<colour-picker>`

`defineColourPickerElement(name = "colour-picker")` once. Attributes: `value`, `model`, `view`, `format`, `alpha`, `contrast`, `size`, `theme` (`light`, `dark`; none follows the system), `eyedropper="false"`. Property `value`. Events `input` and `change`, with `event.detail.value`. The picker is in a shadow root; `--cp-*` properties pass through it.

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

## Dragging numbers

The number fields of the picker (the channels and the opacity) change by dragging them left or right; `Shift` snaps to round steps worked out from the field's range. A press that does not move goes into the field. `scrubNumbers(root, hint?)` does the same for any number fields under `root` (a host's own fields), and `hint` is their tooltip.

## Copying and pasting

- The hex field keeps its `#` outside the field: copying or cutting the whole value puts `#RRGGBB` on the clipboard, and pasting `#RRGGBB` puts the digits in the field (no `##`).
- A swatch (recent, saved or harmony) is copied, not chosen, by a long press (500 ms), a right click, or Ctrl/Cmd+C while it has the focus. The swatch gets the class `is-copied` for a moment (style it with `.cp-swatch.is-copied`).
- `onLongPress(root, selector, action, { ms, except })`, `copyToClipboard(text)` and `flashCopied(el)` are exported for a host's own swatches (the click that ends a long press is swallowed).
