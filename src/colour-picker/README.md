# colour-picker

A colour picker for the web with no dependencies and no link to the app it was made in (canvast). It is small (49 KiB of code minified, 18 KiB gzipped with its licence notices, all of it: maths, picker, gradient editor, styles), fast (a drag does about half a millisecond of work a step), themed by CSS custom properties, and works from `file://`.

* **Three perceptual models:** OKHSL, OKHSV and OKHCL. Every slider stays inside the sRGB gamut, and the same step looks like the same change of colour anywhere.
* **Four layouts:** a hue ring around a box, a plane with a hue bar, sliders, or the ring with sliders under it.
* **Transparency** (optional), with a chequered preview.
* **Text in three formats:** hex, `rgb()`, `oklch()`. Any of them can be typed or pasted, in any format, with or without `#`.
* **Eyedropper** where the browser has one, **WCAG contrast** against a colour you choose, **colour harmonies**, **swatch groups** you supply, and a **before and after** preview.
* **Keyboard and screen reader complete**, **translatable** (every word is an option), **light and dark** by default (it follows the system) or by choice (`theme`, or `data-cp-theme` on it or around it), every colour a `--cp-*` custom property.
* **A gradient editor** (`createGradientEditor`): stops on a bar, linear or radial (and an angular gradient, which the host places), angle or centre and radius, and this picker for the selected stop.
* **Numbers you can drag:** every number field (the channels, the opacity) changes by dragging it left or right, and `Shift` snaps to round steps. **Swatches copy** by a long press, a right click or `Ctrl/⌘+C`, and a `#` in the hex field copies and pastes cleanly.
* **Also a custom element:** `<colour-picker>`.

![the four layouts](docs/layouts.png)

![light and dark](docs/themes.png)

## Use

```ts
import { createColourPicker } from "./colour-picker";

const picker = createColourPicker({
  value: "#2563eb",
  alpha: true,
  onInput: (hex) => preview(hex),   // every step of a drag or key press
  onChange: (hex) => save(hex),     // once, when a gesture ends
});
document.body.append(picker.el);
```

As a tag:

```html
<colour-picker value="#2563eb" view="mixer" alpha contrast="#ffffff"></colour-picker>
<script type="module">
  import { defineColourPickerElement } from "./colour-picker";
  defineColourPickerElement();
  document.querySelector("colour-picker").addEventListener("change", (e) => console.log(e.detail.value));
</script>
```

Without a bundler: `npm run build:picker` (in canvast) writes `dist-picker/colour-picker.js`, a single script that defines a global `ColourPicker`, and `dist-picker/demo.html`, a page with every option on that opens from `file://`.

## Files

| File | What it is |
| --- | --- |
| `colour.ts` | The maths: models, conversions, parsing and formatting, contrast, harmonies, the fast plane painter. Pure functions, no DOM; runs in Node or a worker. |
| `picker.ts` | The component: `createColourPicker`. |
| `gradient.ts` | The gradient editor: `createGradientEditor`. |
| `element.ts` | `<colour-picker>`, in a shadow root. |
| `style.ts` | The stylesheet as a string (`PICKER_CSS`) and `ensureStyles()`. |
| `scrub.ts` | `scrubNumbers`: number fields that change by dragging, with `Shift` snapping to round steps. |
| `press.ts` | `onLongPress`, `copyToClipboard`, `flashCopied`: the long press that copies a swatch. |
| `index.ts` | The exports. |
| `docs/` | [api.md](docs/api.md) options, methods and the maths API · [theming.md](docs/theming.md) · [performance.md](docs/performance.md) · [design.md](docs/design.md) why it is built this way, and what comes next. |

A file in this folder may import only files in this folder (`npm run check:picker` in canvast fails otherwise).

## Credits

**OKHSL and OKHSV follow Björn Ottosson's reference code**, from his post [Two new color spaces for color picking – Okhsv and Okhsl](https://bottosson.github.io/posts/colorpicker/) (MIT): the gamut geometry (the cusp, the maximum saturation, the gamut intersection), the "toe" that corrects OKLab's lightness, and the two conversions. The colour space under them is his [OKLab](https://bottosson.github.io/posts/oklab/). His notice is in [LICENSE](LICENSE) in this folder, with the package's own MIT licence, and must travel with the code; `npm run build:picker` puts both at the top of `colour-picker.js`.

It is checked against his own JavaScript (the files in his repository's `misc/colorpicker`): OKHSL and OKHSV to sRGB give the same bytes for every colour tried (40,000 random ones when this was last compared), and sRGB back to OKHSL and OKHSV gives the same lightness, saturation and hue, with one deliberate difference: the picker keeps saturation and lightness inside 0 to 1, where the reference answers up to about 1.01 for a few saturated blues. canvast keeps that comparison as a test (`tests/unit/colour-reference.test.ts`, from numbers made by `scripts/gen-colour-reference.mjs`), so it cannot drift unnoticed.

**OKHCL is not his:** it is the lightness and hue of OKLab with chroma as a fraction of the sRGB gamut at that lightness and hue (it reuses his gamut geometry).
