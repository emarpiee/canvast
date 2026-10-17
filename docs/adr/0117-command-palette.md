# ADR 0117: Command palette

## Status
Accepted (v0.17.0).

## Decision
**Ctrl+K** or **Ctrl+Shift+P** opens a box that finds any command by words (`ui/command-palette.ts`): every word must be in the command's group, title or extra words; a title that starts with a word comes first, then shorter titles. It shows each command's group and key, runs the highlighted one with Enter, moves with the arrow keys or the pointer, and closes with Escape or a press outside. Commands that cannot be done now (nothing is selected, no previous view) are not offered. The app lists them from what it already has (`app/main.ts`): the tools, undo and redo, duplicate, delete, group, put on a sheet, arrange, save as SVG, zoom, fit, previous and next view, Zen, screenshot, the tour, the panels, the three views, new canvas and board, the backup, and every tab and every setting of Settings (each opens its tab). So Settings is reachable from it.

## Tests
`tests/unit/command-palette.test.ts` (matching and order); `tests/e2e/navigation.spec.ts` (open, filter, keys, enabled only, run, a setting opens its tab), both browsers.
