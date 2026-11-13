# ADR 0197: The two bars organised: settings in tabs at the top, named groups of actions at the bottom

- Status: **accepted** (2026-11-13)
- Related: ADR 0051, 0128, 0129, 0151, 0152 (the Properties and Actions bars, the command palette, grouped menus, kind chips)

## Context

People said the floating bars were cluttered and hard to navigate: with a selection the Properties bar held every option of it in one row that scrolled sideways (a sheet with auto layout hid its flow buttons behind the scroll arrows), nothing said which part was which, and the Actions bar was a row of unnamed icons. They looked up and down to find a thing, for every tool. The floating bars themselves were liked for quick changes, so they stay.

## Decision

- **One job per bar.** The Properties bar (top) holds settings: how the tool or the selection looks and behaves. The Actions bar (bottom) holds actions.
- **Sections at the top.** Every control of a selection belongs to one section (`data-section`), in a fixed order: Look, Text, Shape, Picture, Size, Layout, Spacing, Columns & order, In layout, On sheet (`SECTIONS` in `ui/toolbar.ts`). With a selection, when more than one section applies, tabs at the start of the bar show one section at a time, so the bar fits without scrolling; Look is always first. The tab last opened is kept for each kind of selection. A tool's own options (nothing selected) are few and show whole, as before. A control that must be seen whatever the tab (Doesn't fit: Fit) says `data-section="*"`.
- **One bar at the top.** The colours of a selection (and the outline width beside them) are in the Look section, no longer a second bar under it. With several kinds selected, the kind is chosen in a dropdown (*Editing*), not chips: chips beside the tabs looked like more tabs.
- **Named groups at the bottom.** Each group of the Actions bar shows its name under its buttons (`captionedGroup` in `ui/bar.ts`, read by `syncGroups`); the buttons stay one click away, in the same order for every selection.
- **Find.** A button at the end of both bars opens the command palette. Controls on a tab that is not open are still commands: running one opens its tab first (`OPEN_SECTION_EVENT`).

## Consequences

- A control added to the Properties bar names its section, or takes its group's.
- The Actions bar is a little taller (the names); its width is unchanged.
- README pictures of the bars are to be taken again.
