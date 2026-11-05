# ADR 0183: Guides are pattern generators, on a tab of their own

**Status:** accepted

**Context:** tools for laying out and composing work (a grid, the golden ratio, perspective) were wanted beside the decorative patterns, and the picker was already long. The generators are a standalone package (`src/gen`, ADR 0162).

**Decision:** a guide is an ordinary generator: a pure function, its settings as data, usable outside the app. `guide: true` and its family (Proportion, Composition, Layout, Perspective, Geometry, Art study) are all the package knows of them. `guide-kit.ts` holds what they share: the colours, the look and a pen that draws dashes, margins, flips and the frame, so that a guide says only where its lines go. Its own settings are `steady`: Randomize changes its look and leaves what it is. A guide starts with no background (it keeps the setting), and in the app a new sheet for one has no fill, so that it sits over the work under it.

The tabs *Patterns* and *Guides* are the app's alone, in the Pattern panel, with the Styles panel's look and keys through `ui/tabs.ts`. Going to the other tab leaves what is on the canvas.

**Consequences:** sizes are fractions of the box, except an exact cell size or line height (Grid, Pixel Grid, Baseline Grid), which are in the box's own units. Geometry that has a right answer is checked in `tests/unit/pattern.test.ts`. Guides are real objects: they can be selected, and can be locked to keep them from catching clicks.
