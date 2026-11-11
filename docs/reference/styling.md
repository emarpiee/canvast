# Styling: tokens, shared classes and themes

How the interface is styled, for anyone changing a component or adding a theme. Nothing here belongs to one theme: a theme gives the
tokens their values, and the shared classes below read only tokens. The stylesheet is `src/styles.css`; its rules are checked by
`npm run check:tokens` (no literal colours, sizes, radii or spacing in rules) and `npm run check:components` (one implementation per
component).

## Tokens

Every value a rule uses is a custom property on `:root`. A rule never writes a colour, a text size, a radius or a spacing itself.

| Family | Tokens | What they are |
| --- | --- | --- |
| Colour dials | `--hue`, `--vivid` | The hue every tint is built on and how much colour it carries (Settings › Appearance); the lightness of each colour token is fixed, so the dials never change contrast |
| Surfaces | `--theme-bg`, `--hud-bg`, `--paper`, `--hud-hover`, `--view-tint`, `--view-tint-hover`, `--hud-scrim` | The app's background, bars and panels, a sheet of paper, the hover wash, the view buttons' tint, the dim behind a dialog |
| Text and lines | `--hud-fg`, `--hud-muted`, `--hud-border`, `--hud-edge`, `--view-edge` | Text, quiet text, a hairline between parts, the edge of a field (3:1), the view buttons' edge |
| Accent | `--hud-accent`, `--hud-accent-fg`, `--hud-accent-text`, `--hud-accent-hover` | A filled "on" state, the text on it, the accent used as text (4.5:1), a filled button under the pointer |
| States | `--hud-danger`, `--hud-danger-fg`, `--hud-success`, `--hud-warning`, `--hud-star` | Destructive actions, done, careful, favourites |
| Canvas | `--canvas-bg`, `--canvas-grid`, `--canvas-axis`, `--canvas-selection`, `--canvas-lasso`, `--canvas-guide`, `--canvas-handle-fill`, `--canvas-ink`, `--canvas-danger` … | What the canvas draws round your work; read by the renderer too |
| Elevation | `--hud-lift` | The one shadow of everything that floats |
| Shape | `--r-2xs` … `--r-lg`, `--r-pill`, `--r-dot`, `--ctl-r` | Corner radii; `--ctl-r` is a control's corner (Settings › Corners) |
| Spacing | `--s-1` … `--s-15` (by Density), `--sp-*` (fixed), `--edge`, `--near`, `--pad`, `--gap` | Gaps and paddings follow Density; `--sp-*` are for what must not change |
| Sizes | `--ctl`, `--bar-h`, `--field-h`, `--menu-h`, `--list-h`, `--tree-row-h`, `--row-btn`, `--chip-btn`, `--icon-*`, `--dlg-*` | Control, bar, field, menu row, list row and icon sizes; dialog widths |
| Type | `--font-ui`, `--font-mono`, `--text-2xs` … `--text-5xl`, `--weight-*`, `--font-control`, `--font-meta`, `--font-value` | Families, sizes, weights and the three composed fonts of controls, small print and numbers |
| Layers | `--z-item`, `--z-item-bar`, `--z-item-pop`, `--z-edge`, `--z-pop`, `--z-window` | Stacking of floating parts (ADR 0096) |
| Motion | `--dur-fast`, `--dur-base`, `--dur-slow`, `--ease-out`, `--ease-in-out`, `--anim-speed` | Durations and easings (Settings › Animation) |

Light and dark: the light values are on `:root`; dark values are under `@media (prefers-color-scheme: dark)` for `:root:not([data-theme="light"])`
and under `:root[data-theme="dark"]` (Settings › Theme sets `data-theme`, or leaves it off to follow the system).

## Shared classes

| Class or selector | What it is | Where |
| --- | --- | --- |
| `.rail`, `.dock`, `.toolbar`, `.view-switch`, `.hud-controls`, `.ctx-bar` | The floating bars (one spec, ADR 0053): same height, radius, border, shadow | `src/styles.css` "Floating elements" |
| `… button[aria-pressed="true"]` in those bars | The one "on" look: filled with the accent | "A pressed button of a bar" |
| `.seg` | Segmented control (one choice of a few) | `src/ui` many; one rule |
| `.pop-menu`, `.more-menu` rows (`MenuItem`: icon, label, hint) | Context and action menus | `src/ui/context-menu.ts`, `src/ui/more-menu.ts` |
| `.modal`, `.confirm`, `.confirm-actions` | Dialogs and their buttons | `src/ui/modal.ts`, `src/ui/confirm.ts` |
| `panelHtml` parts | A floating panel: header, strip, body, footer (ADR 0156) | `src/ui/panel.ts` |
| `.set-row`, `.set-control`, `.set-tabs`, `.set-panels` | Settings rows and tabs | `src/ui/settings-view.ts`, `src/ui/setting-rows.ts` |
| `.toast`, notices | Where the app speaks | `src/ui/notices.ts` |
| `.hud-readout` | The info bar | `src/ui/navigator.ts` |
| `.asset-card`, `.side-item`, `.side-row`, `.assets-bar`, `.assets-btn` | The Library's cards, sidebar rows and bar | `src/ui/assets-view.ts` |
| `.tag-chip` | A tag or token chip | many |
| `input[type="checkbox"]`, `input[type="radio"]` | The one checkbox and radio, sized by Density | "Interface skin" |
| `:where(:focus-visible)` | The one focus ring | top of `src/styles.css` |
| Scrollbars | One rule (`src/ui/scrollbars.ts`) | top of `src/styles.css` |
| `.se-theme-canvast` | Every colour of the notes editor | "Notes" |

## Themes

A theme is a set of values for the tokens above, plus, where its look needs it, rules scoped to it that read further tokens of its own.
The theme in use is `data-look` on `:root` (Settings › Appearance › Theme). A theme never copies a component: it styles the shared class
(ADR 0187).

| Theme | Where | How |
| --- | --- | --- |
| Legacy (`data-look="legacy"`) | `src/styles.css` | The tokens' own values; light and dark as above |
| Retroma (`data-look="retroma"`, the default) | `src/theme/retroma/` (engine, applier, import, fonts), `src/theme/retroma.css` | The engine writes `--rt-*` properties and `data-rt-*` switches on `:root`; the stylesheet maps the shared tokens to them, then styles shared classes, every rule under `:root[data-look="retroma"]` |

Retroma's own properties, by family (all `--rt-*`): surfaces (`frame`, `pane`, `pane-alt`, `paper`, `canvas`, `btn-bg`, `btn-hover`, `btn-on`,
`field-bg`), text (`fg`, `fg-muted`, `fg-on-frame`, `on-accent`, `accent-text`), lines (`outline-c`, `rule`, `ring-o-*`, `ring-i-*`), light
(`raise`, `raise-sm`, `sink`, `well`, `lift`, `press-x/y`, `cx/cy`, `cx-a/cy-a`), shape (`r`, `btn-r`, `corner-*`, `outline`), type (`font`,
`ed-font`, `h1`…`h6` and their `-s`, `-w`, `-ul*`), and the notes', Library's and canvas's own (see `src/theme/retroma.css` sections).

Retroma's surfaces follow its demo (each styled in one place of `src/theme/retroma.css`):

| Surface | What it is | The app's parts |
| --- | --- | --- |
| Key | The face (colour, outline, light) on `::before`; the key carries its contents, so a press moves them, words too | Buttons of bars, panel heads, dialogs, settings rows, the Library, the viewer |
| Bar | A shade off the pane, a dark outline, the keys a little apart inside | `.rail`, `.dock`, `.toolbar`, `.ctx-bar`, `.hud-controls`, `.seg` |
| Pane | The pane colour, the lit outer ring as its border, the inner ring and its soft shadow inside | `.assets-body` (sidebar, items and details side by side), `.set-tabs`, `.set-card`, `.layers-panel`, `dialog.confirm` |
| Header strip | Across the top of a pane, bold, a rule under it | `.panel-head`, a dialog's first `h2` |
| Content | What a pane holds: paper for things, the pane colour for settings | `.assets-main`, `.panel-body`, `.panel-sub` (fields on paper a step darker) |
| Footer strip | The bar colour, a rule over it | `.panel-foot`, a dialog's last `.confirm-actions` |
| Field and dropdown | A field: the field colour, the dark outline; a dropdown: a small raised key | `input`, `textarea`; `select` |
| Properties | Retroma's metadata box: name on a pane-colour strip, value on paper | `.asset-fields`, `.asset-field` |
| Folder | Retroma's rainbow folders | the Folders section's rows |

Classes a theme may style besides the shared ones: notes' callouts (`__se__callout`, `__se__callout-<kind>`, `__se__callout-mark`) and
alternative checkboxes (`__se__acb`, `__se__acb-<name>`, `__se__acb-mark`), marked by `src/notes/note-markdown.ts`.
