# ADR 0198: The Properties bar near the selection, and one rule for the tools that make things

- Status: **accepted** (2026-11-13; revised the same day after the owner tried it)
- Related: ADR 0123 (the panel dock), 0128 (the bars), 0129 (the command palette), 0151 (grouped menus), 0197 (named groups)

## Context

The Properties bar at the top was felt as cluttered: one long row, different for every kind, that scrolls on a small window. A mock of six ways was tried; value chips at the top, an improved Properties panel and value chips near the selection were built (0.58.5), and the Actions bar's groups as chips. After trying them the owner kept only **near the selection**, beside the bar as it was, and asked for: no popover at a corner of the window, Fill and Outline alike, long lists made readable (every field named, no guessing which field is which), floating things never over the selection, the colour picker whole, popovers as wide as their content, rules and an audit for all of this, and one behaviour for every tool that makes things (a shape just drawn was not edited by the bar: the bar edited the tool's next shape).

## Decision

- **Two ways** (`ui.properties`): the bar at the top (the default) or value chips just above the selection (`near`). With nothing selected (a tool's own options) or the selection out of view, the chips stand at the top. Value chips at the top as a way of their own, the Properties panel and the Actions bar's chips were removed.
- **One set of controls, moved.** The Properties bar is built once (`ui/toolbar.ts`); a chip's popover holds the bar itself, the bar of the colours of a selection is one more chip (Colours). Their controls are found (`q`, `qa`) and heard (`listen`) wherever they are.
- **Sections** (`ui/bar-sections.ts`): every control has one, by selectors in `toolbar.ts`; a part that holds several sections is split into its pieces (Auto layout: **Layout**, **Spacing**, **Columns and order**). A chip shows its section's summary, read from its controls (a fill a dot, an outline a ring, the first values).
- **The popover is a form** (`is-form`): one option a row, its name at the left and its control at the right edge, a row of choices under its name, a button with its icon and name; every holder of controls steps aside (`display: contents`). `nameControls` gives every control a visible name from its `aria-label` (hidden in the bar): a field with no words, a button with only an icon, a word too short to say what it is ("T", "W"), the first field of a pair (Gap, Pad), a label over several fields (Pin: a heading and one row each); loose words of a part are its headings. One font and size for every name; width from the content, capped.
- **Placement**: a chip's popover is placed with `placeMenu`, as every menu: inside the window, never over the selection, and now also never over its own bar (scored with the selection). The chips are placed above the selection with `placeBy` (`ui/near-selection.ts`), the rule the following Actions bar uses (below), and follow the selection after every frame. When the chips are drawn again (a kind chosen in a mix changes them), the popover follows its chip (`followChip`) or closes. The colour picker is shown whole: beside its bar when it fits neither under nor over it, on the side away from the selection; it scrolls only in a window shorter than it.
- **Tools that make things**: one rule, `editor.selectMade(ids)`, for the Shape, Balloon (which used to switch to Select), Sheet and Path tools and any to come. The tool stays; while what it made is all that is selected, the options edit it (`editsSelection`), what they set is kept for the next one (`editsMade`), the Actions bar shows, and a press on its own handles (a balloon's tail, a corner's radius dot, a gradient's handles) or a double-click on it works as with the Select tool (a balloon's words). Its box's corners and sides are left to the tool: a new shape drawn from the corner of the last one, to line them up, is drawn. Picking anything else ends it.
- **The command palette** offers a control in a closed chip (`data-parked`) and opens the chip first.
- **Rules and an audit**: CLAUDE.md "Floating bars and popovers" and "Tools that make things"; `floatingProblems(page)` in the harness checks the window, the selection, the chip, names, one font, token spacing, width and swatch sizes, and `bar-layouts.spec.ts` runs it on every chip of a shape, a sheet, a thing on it, several things, a mix and the Pen.

## Consequences

- A new control of the Properties bar needs a section (its group's is enough) and an `aria-label`; it is then named and placed in the form with no further code.
- A new tool that makes things calls `selectMade`; the bar, the chips, the Actions bar and its handles then behave as for the others.
- `toolbar.ts` must use `q`, `qa` and `listen`, never `root.querySelector`.
