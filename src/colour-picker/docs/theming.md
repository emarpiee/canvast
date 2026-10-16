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
| Space | `--cp-gap`, `--cp-gap-sm`, `--cp-pad` | 10 px, 6 px, 0 | Between sections, inside them, around the picker. |
| Size | `--cp-thumb`, `--cp-bar`, `--cp-swatch` | 16 px, 12 px, 20 px | The handles, the slider bars, the swatches. |
| | `--cp-size` | from the `size` option | The ring. Set the option, not this. |

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
