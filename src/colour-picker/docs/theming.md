# Theming

The picker draws with CSS custom properties only. Set them on `.cp`, on any ancestor, or (for `<colour-picker>`) on the element: custom properties pass through a shadow root.

The defaults sit in `:where(.cp)`, which has no specificity, so **any rule of yours wins** and the order of stylesheets does not matter. They follow `prefers-color-scheme`. If you set your own colours, set both themes, or none.

| Group | Property | Default (light) | Used for |
| --- | --- | --- | --- |
| Colour | `--cp-bg` | `#fff` | Where the picker sits (swatch rings are cut from it). |
| | `--cp-fg` | `#1f2329` | Text, thumb outlines. |
| | `--cp-muted` | `#5f6b76` | Labels, the contrast line. |
| | `--cp-border` | 18% of the text colour | Outlines of boxes and swatches. |
| | `--cp-field` | `#f1f3f5` | The switches, number fields and the text field. |
| | `--cp-hover` | 8% of the text colour | A hovered switch. |
| | `--cp-accent`, `--cp-accent-fg` | `#2563eb`, white | The chosen model, the selected swatch's ring, the thumbs' outline. |
| | `--cp-focus` | `#2563eb` | Focus rings. |
| | `--cp-check-a`, `--cp-check-b` | grey and white | The chequer behind transparency. |
| Type | `--cp-text`, `--cp-text-sm` | 13 px, 11 px | Body and small text. |
| | `--cp-font`, `--cp-mono` | system UI, system mono | Text and numbers. |
| Shape | `--cp-radius`, `--cp-radius-sm` | 8 px, 5 px | Boxes and bars; fields and buttons. |
| | `--cp-dot` | `50%` | The corner radius of the round handles and swatches (a host with sharp corners sets `0`). |
| Space | `--cp-gap`, `--cp-gap-sm`, `--cp-pad` | 10 px, 6 px, 0 | Between sections, inside them, around the picker. |
| Size | `--cp-thumb`, `--cp-bar`, `--cp-swatch` | 16 px, 12 px, 20 px | The handles, the slider bars, the swatches. |
| | `--cp-field-h` | 0 | The least height of the number fields, the text field and the switches (a host with a density setting sets it). |
| | `--cp-size` | from the `size` option | The ring. Set the option, not this. |

## Light and dark

Out of the box the picker follows the system: the defaults above are the light ones, and `@media (prefers-color-scheme: dark)` swaps the colour properties (`--cp-bg`, `--cp-fg`, `--cp-muted`, `--cp-border`, `--cp-field`, `--cp-hover`, `--cp-check-a`, `--cp-check-b`) for the dark ones. To choose one whatever the system says, for a page with its own light and dark switch:

```html
<div data-cp-theme="dark"> … any picker, gradient editor or <colour-picker> inside … </div>
```

```ts
createColourPicker({ theme: "dark" });     // or "light"; "auto" (the default) follows the system
createGradientEditor({ theme: "dark" });
```

```html
<colour-picker theme="dark"></colour-picker>   <!-- the attribute can change: light, dark, or removed for auto -->
```

`data-cp-theme="light"` or `"dark"` can be on the picker, on any ancestor (the page, a panel) or on the `<colour-picker>` tag, and it also sets `color-scheme`, so the browser's own controls (the layout list, scroll bars) match. Like the defaults it has no specificity: any rule of yours (`.cp { --cp-bg: … }`) still wins, so a host with its own palette sets its own properties and may ignore all of this. The tokens that do not change with the theme (the accent, sizes, type, shape) are set once.

## Examples

A popover that matches a host's theme (canvast does this):

```css
.cp {
  --cp-bg: var(--panel-bg); --cp-fg: var(--panel-fg); --cp-accent: var(--brand);
  --cp-radius: var(--radius-md); --cp-text: var(--text-md);
}
```

A dark picker on a light page: set `--cp-bg`, `--cp-fg`, `--cp-muted`, `--cp-border`, `--cp-field`, `--cp-hover`, `--cp-check-a` and `--cp-check-b` together.

If your page has a strict Content-Security-Policy, the stylesheet needs `style-src 'unsafe-inline'`, or include `PICKER_CSS` in your own stylesheet and pass `injectStyles: false`. The picker sets a few inline styles (positions, gradients) from script, which `style-src` also covers.
