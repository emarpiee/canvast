# ADR 0187: Themes, and Retroma as the default

- Status: **accepted** (2026-11-11)
- Related: ADR 0052 (interface skin), ADR 0053 (floating elements), ADR 0068 (design tokens), ADR 0096 (layers)

## Decision

- The interface has **themes** (Settings › Appearance › Theme): **Retroma**, the default, and **Legacy**, the app's look before it. A theme is
  chosen per device (`ui.look`); Light or dark, Density, Zen mode, Animation and the canvas pattern stay the app's own settings for every theme.
- **Legacy** is `src/styles.css` alone, kept as it is: it changes only where a new part of the app needs its tokens.
- **Retroma** is the owner's Retroma theme for Obsidian, adapted: one accent makes the palette (the frame, panes and paper at fixed lightness,
  hues turned by a colour scheme), every pressable thing is a key lit from one angle (raised, pressed, its contents riding on it, or
  Neubrutalism's offset shadow), panes have lit rings. Its engine (`src/theme/retroma/engine.ts`) is a pure function of its settings that gives
  every value as custom properties; it is a port of the reviewed demo, and a golden test (`tests/unit/retroma.test.ts`) holds it to the demo's
  values for every built-in preset in light and dark.
- On the page (`src/theme/retroma/apply.ts`) the values are `--rt-*` properties and `data-rt-*` switches on `:root`, with `data-look="retroma"`.
  `src/theme/retroma.css`, appended after the shared stylesheet, first maps the app's own tokens to them (so every component wears Retroma), then
  styles the shared classes, each rule scoped to `:root[data-look="retroma"]`. It never copies a component.
- Retroma's customisation is one setting (`retroma.look`): only what differs from its defaults, as JSON. **Settings › Retroma** shows a Basics
  card and every other group in a dialog (the shared setting rows, the app's colour picker, an Auto choice for colours the theme works out).
- **Theme presets** are a style kind (`retroma`), kept with the workspace and its backups: eight built-in, saved ones, and those imported from
  Style Manager's `retroma-presets.json`. A schedule can switch presets by the hour.
- Colours stay inside sRGB (chroma lowered, never clipped); texts the theme works out are moved only as far as needed for 4.5:1; a colour the
  person sets is kept as given.
- Retroma's fonts (Atkinson Hyperlegible and eight more, Latin subsets in WOFF2) are embedded and installed as `FontFace` from their bytes.
- Notes gain **callouts** (`> [!kind] Title`) and **alternative checkboxes** (`- [/] task`) for every theme: marked by classes the editor keeps,
  their text, and so their Markdown, unchanged.

## Consequences

- A new component reads the shared tokens; it wears every theme with no theme rule. A theme rule is needed only for a look the tokens cannot give.
- A new theme is a set of values for the tokens (and, if it needs them, rules scoped to it); see `docs/reference/styling.md`.
- The engine keeps the demo's code as it is (not type-checked inside); its API is typed and its numbers are checked by the golden test.
