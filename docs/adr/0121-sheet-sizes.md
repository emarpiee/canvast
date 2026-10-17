# ADR 0121: Sheet sizes in real units

## Status
Accepted (v0.17.0).

## Decision
A picked sheet shows its width and height in a unit the person chooses: px, in (96 px), mm or cm. Typing a size resizes **only the sheet**, its top-left corner fixed: what is on it follows its own pin (`constraint`, ADR 0108), which by default is left and top, so it keeps its place and size; a pin of Scale makes it grow with the sheet. The resize goes through `planSheetScale` (the same code as dragging a handle), so pins, nested sheets and turned shapes behave as when resized by hand, in one undo step.

## Why
- Resizing a page and scaling its contents are different jobs. Making "scale everything" the default would override pins the person set, and positions are exact dyadic numbers (ADR 0001): a ratio such as 1000 to 1500 would round every child, and resizing there and back would drift.
- Export stays predictable: an element that is 100 px stays 100 px when the page is made bigger.
- Units are display only. The sheet is stored in canvas units; mm and in convert at a fixed ratio (96 px per inch, 25.4 mm per inch) and a size typed in mm is rounded to the nearest exact size, shown back as the sheet now has it.

## Not done
- Presets (A4, Letter, screens), a "scale contents" command (pin every child to Scale), and a sheet-relative measure for what is on it.
