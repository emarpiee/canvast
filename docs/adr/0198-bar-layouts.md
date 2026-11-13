# ADR 0198: Value chips, the Properties panel and chips by the selection

- Status: **accepted** (2026-11-13)
- Related: ADR 0123 (the panel dock), 0128 (the bars), 0129 (the command palette), 0151 (grouped menus), 0197 (named groups)

## Context

The Properties bar at the top was felt as cluttered: one long row, different for every kind, that scrolls on a small window. Section tabs and a Properties panel were tried before (not kept: tabs hid too much, the panel had to be opened from the dock and gave no overview). A mock of six ways was tried by the owner, who chose three to offer beside the bar as it is: value chips, an improved Properties panel, and value chips just above the selection; and value chips for the Actions bar too.

## Decision

- **One set of controls, moved.** The Properties bar is built once (`ui/toolbar.ts`). A way of showing it only moves the bar element: into a chip's popover, into the Properties panel, or out of sight into a parking place in the same root (`ui/properties-layout.ts`). Its controls are found (`q`, `qa`) and its events heard (`listen`) wherever it is, so live numbers, colour pickers, shortcuts and the tests' selectors are the same in every way.
- **Sections.** Every control belongs to one section (`ui/bar-sections.ts`: Kind, Mask, Look, Text, Shape, Picture, Size, Auto layout, In layout, On sheet, Brush, Eraser, Lasso, Options), given once by selectors in `toolbar.ts`, a control's own or its group's. The engine shows only some sections (`data-sec-off`), orders them for the panel, and reads a section's **summary** from its controls (the colours as swatches, then the first numbers with their units, choices and radios): no word is written per kind or tool.
- **Value chips** (`ui/value-chips.ts`): one chip component (name, values, arrow) and one popover for the top chips, the chips by the selection, the panel's short form and the Actions bar's chips. `syncChips` rewrites only the values when the chips are the same, so a chip whose popover is open stays put. A press outside closes the popover, except inside what its controls open (colour picker, menus, adjustments); Escape closes the innermost first.
- **The Properties panel** is a dock panel (`properties`). It shows itself when the bar has something to show and hides when not (`ui.propsPin`: auto); the anchor keeps it open, × keeps it closed until the top's **Properties** button. Headings in the bar's row (seen only in the panel) fold a section, which then shows its summary. Its short form lists the sections as chips. The top keeps the Look chip and the switch. On a phone-width window it shows as chips.
- **Near the selection**: the chips are placed above the selection by `placeBy` (`ui/near-selection.ts`), the rule the Actions bar that follows the selection now uses too (it prefers below), so the two frame the selection. With nothing selected or the selection out of view, the chips are at the top.
- **The Actions bar's groups as chips** (`ui.actionsView`): each group gets a chip (its name and the icons of up to three of its actions); a click lists the group's shown actions in the shared menu (icon, name, what it does), each running as its button; a menu button's own menu opens under the chip. A group of one action is that action.
- **The command palette** offers a control that is out of sight in a parked bar (`data-parked`) and asks the layout to show it before it runs (`setControlRevealer`).
- The hints say where Fill and Outline are for the way chosen (`setPropsWhere`).
- Settings: `ui.properties` (bar, chips, panel, near; bar by default), `ui.propsFolded`, `ui.propsPin`, `ui.propsMini`, `ui.actionsView` (buttons by default). Every other end-to-end spec runs on the defaults; `bar-layouts.spec.ts` covers the other ways.

## Consequences

- A new control of the Properties bar needs a section (its group's is enough) to be in the right chip; it then shows in every way with no further code.
- The bar element can be outside its root: code in `toolbar.ts` must use `q`, `qa` and `listen`, never `root.querySelector`.
- The Actions bar's hover names (ADR 0197) do not apply to its chips, which carry the names.
