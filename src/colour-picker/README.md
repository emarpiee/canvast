# colour-picker

A colour picker with no dependencies and no link to the rest of canvast. Copy this folder into another project, or build it on its own (`npm run build:picker` writes `dist-picker/colour-picker.js` and a `demo.html` that opens from `file://`).

* **Models:** OKHSL, OKHSV and OKHCL. Every slider stays inside the sRGB gamut, and a step looks like the same change of colour anywhere.
* **Layouts:** sliders, or a hue ring around a box (the box shows the other two channels).
* **Value:** `"#rrggbb"`. There is no alpha channel.
* **Files:** `colour.ts` is pure maths (no DOM; runs in Node or a worker), `picker.ts` the component, `style.ts` its stylesheet, `index.ts` the exports.

```ts
import { createColourPicker } from "./colour-picker";

const picker = createColourPicker({
  value: "#2563eb",
  model: "okhsv",          // "okhsl" | "okhsv" | "okhcl"
  view: "wheel",           // "wheel" | "sliders"
  groups: [{ label: "Recent", colours: ["#1f2329", "#dc2626"] }],
  onInput: (hex) => preview(hex),   // every step of a drag or key press
  onChange: (hex) => save(hex),     // once, when a gesture ends
  onModel: (m) => remember(m),      // so the host can reopen in the same model
  onView: (v) => remember(v),
});
container.append(picker.el);
picker.setValue("#ff0000");          // from outside: fires nothing
picker.destroy();
```

## Options

| Option | Meaning |
| --- | --- |
| `value`, `model`, `view` | Start state. |
| `size` | Side of the hue ring in CSS px (default 208). The sliders layout is the same width. |
| `groups` | Swatch rows under the picker, each `{ label, colours }`; change them later with `setGroups`. |
| `labels` | Every word the picker shows (model, layout, channel names, tooltips), to translate or rename. |
| `display(hex)` | The CSS colour to show a stored colour as; for a host that draws one colour differently (a theme's ink). |
| `injectStyles` | `false` when the host adds `PICKER_CSS` itself. |

## Theming

The picker draws only with CSS custom properties. Set them on `.cp` or any ancestor; the module's defaults sit in `:where(.cp)` (specificity 0), so any rule of yours wins, and they follow `prefers-color-scheme`.

| Group | Properties |
| --- | --- |
| Colour | `--cp-bg --cp-fg --cp-muted --cp-border --cp-field --cp-hover --cp-accent --cp-accent-fg --cp-focus` |
| Type | `--cp-text --cp-text-sm --cp-font --cp-mono` |
| Shape and space | `--cp-radius --cp-radius-sm --cp-gap --cp-gap-sm --cp-pad` |
| Sizes | `--cp-thumb --cp-bar --cp-swatch` |

canvast maps them to its own tokens in `src/styles.css` (ADR 0098).

## Keyboard

Tab reaches the model and layout switches (arrows move between them), the ring (arrows turn the hue by 1°, Shift 10°, Alt 0.1°, Page Up and Down 15°), the box (arrows move saturation and value or lightness by 1%, Shift 10%), each slider and number field, the hex field (Enter applies), and every swatch.

## Credits

OKHSL and OKHSV follow Bjorn Ottosson's reference code (MIT; the notice is in `THIRD_PARTY_NOTICES.md`). OKHCL is lightness and hue of OKLab with chroma as a fraction of the sRGB gamut.

## Keeping it standalone

`npm run check:picker` fails when a file in this folder imports anything outside it.
