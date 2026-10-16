# ADR 0097: On a phone the floating rows are placed from measured heights

## Status
Accepted (v0.17.0)

## Decision
On a small screen (640 px and narrower) the view tabs, the dock and the tool options stack in rows. Their places used to come from one guessed row height, so the gaps differed (a 2 px gap between the dock and the options, 7 px elsewhere). `measureNav` (`src/app/main.ts`) now measures the nav pill's bottom and the dock's height and sets `--nav-bottom`, `--dock-h` and `--rail-right`; the stylesheet puts the dock, the options row and the side panels at those numbers plus one `--near` each, so every gap between rows, and between the last row and the panels, is the same, and the panels start one `--near` to the right of the tool rail (they overlapped it by 2 px). `--bar-bottom` follows the same numbers, so it is right before the rows have moved. With the status strip hidden, the view controls sit `--edge` from the bottom like every other floating element.
