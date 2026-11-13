# ADR 0197: A Properties panel, and named groups in the Actions bar

- Status: **accepted** (2026-11-13)
- Related: ADR 0051, 0123, 0128, 0129, 0152, 0156 (the Properties and Actions bars, the panel dock, the command palette, kind chips, panels)

## Context

People said the floating bars were cluttered and hard to navigate. With a selection, the Properties bar held every option in one row that scrolled sideways (a sheet with auto layout hid its flow buttons behind the scroll arrows), nothing said which part was which, a second bar of colours appeared under it, and the Actions bar was a row of unnamed icons. They looked up and down to find a thing, for every tool. Tabs in the bar (tried first) were still confusing. The Actions bar was liked for quick changes.

## Decision

- **A Properties panel.** The options of the tool or of what is selected can be in a panel of the dock (Settings > Appearance > Properties: *In a panel*, the default, or *In the bar at the top*, as before). The panel holds the Properties bar itself, the same elements, so everything the bar does (live numbers, popovers, the command palette, shortcuts) works in both places; `mountToolbar` finds its controls and hears their events wherever the bar is (`q`, `qa`, `listen`) and gives the panel a call after each update (`PropertiesBar`).
- **Sections down the panel.** Every control names its section (`data-section`): Look, Text, Shape, Picture, Size, Layout, Spacing, Columns and order, In layout, On sheet, Options (`SECTIONS` in `ui/properties-panel.ts`). In the panel the bar's groups give way (`display: contents`) and each control takes its section's place, under a heading that folds; the folds are kept (`ui.propsFolded`). A field at the top finds a property by its name. In the bar the sections change nothing.
- **Named groups in the Actions bar.** Each group shows its name under its buttons (`captionedGroup` in `ui/bar.ts`, read by `syncGroups`); the buttons stay one click away, in the same order for every selection. **Find** at its end opens the command palette.
- The end-to-end tests open the page with `#debug`, where the bar is the default: they were written for it.

## Consequences

- A control added to the Properties bar names its section (or takes its group's).
- The colours of several selected things are in the panel's Look section; in the bar they stay a second bar under it.
- README pictures of the panel are to be made.
