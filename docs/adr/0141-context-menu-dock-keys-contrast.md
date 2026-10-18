# ADR 0141 — Context menu, title bars by keyboard, a contrast audit

- Status: accepted (v0.18.1)

## Context menu (`src/ui/context-menu.ts`)

A right click on the canvas opens the one menu pattern of the app (`more-menu.ts`) at the pointer. Over an item it picks the item (when it was not picked) and lists the registry's commands that fit it: Copy, Cut, Paste, Duplicate, Group, Ungroup, Bring to front, Send to back, Put the selection on a sheet, Detach, Save as SVG, Delete. Over empty canvas it lists Paste, Select everything, Fit everything in view, Return to the origin. Each item is a command of the registry (`registry.run`), so a command that cannot be done now is not listed and a new command needs no code here but its title in the list. Copy, Cut and Paste were added to the registry for it (they were keyboard-only). It does not open while a text is being edited or in another view.

## Panel title bars by keyboard

Every dock panel's `<header>` is reachable by Tab; Enter or Space folds or unfolds the panel (and an unfolded panel counts as used, as it does with the mouse). The focus outline is the shared one. Cascading overlap of panels was not adopted: the dock stacks with gaps by decision (ADR 0123). The debug text can still sit over the dock's left stack (debug mode only; moving it would cover input in the tests).

## Contrast audit

`a11y.spec.ts` computes the WCAG contrast of every visible text against what it sits on (translucent panels composited over the page colour) in the light and dark themes, in the canvas, Assets and Settings views, and fails under 4.5:1 (3:1 for large text). It found two real misses, fixed with tokens: muted text in the light theme (`--hud-muted` darker) and the save readout and empty-list notes (an opacity instead of the muted colour).

## Scenario tests

`scenarios.spec.ts` (chromium; the logic does not depend on the rasteriser) covers U3 (grouped picture and stroke move together and ungroup in place), U6 (a lasso holding a stroke and a corner of a picture takes the stroke only), U9 (a copy of a picture is another object of the one original and moves alone), U10 (groups, links and order survive a reload with the same ids, and deleting the target frees what followed it) and scenario I (a thousand view switches leave nodes, listeners and heap unchanged, read with the browser's own metrics).
