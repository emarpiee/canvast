# ADR 0197: The Actions bar's groups say their names

- Status: **accepted** (2026-11-13)
- Related: ADR 0051, 0128, 0129, 0151 (the Actions bar, the command palette, grouped menus)

## Context

People said the floating bars were cluttered and hard to navigate. The Actions bar was a row of unnamed icons in groups, so finding an action meant hovering one icon after another. Its one-click buttons were liked for quick changes. (A Properties panel and tabs in the Properties bar were tried on a branch and not kept: the Properties bar is being rethought on its own.)

## Decision

- Each group of the Actions bar shows its name under its buttons: Items, Files, Edit shapes, Arrange, Attach, Selection (`captionedGroup` in `ui/bar.ts`; `syncGroups` reads the controls in its `.tb-row`). The buttons stay one click away, in the same order for every selection.
- Where the names show is a setting (`ui.groupNames`, Settings > Appearance): under the buttons (the default), over them, either only while the pointer is on the bar, or hidden. A hover choice takes no room until the pointer is on the bar: the bar then grows (upward, from its bottom edge, when it sits at the bottom). Keeping the room empty was tried first and dropped: an empty strip on the bar looked like a mistake. The hover choices are not offered where nothing can hover (a touch screen), and there the names always show.
- **Find** at the end of the bar opens the command palette, to find any option or action by its name.

## Consequences

- The bar is a little taller (the names); its width is unchanged. Any bar can name its groups the same way.
