# ADR 0113: Pen tilt, and text line height and letter spacing

## Status
Accepted (v0.17.0).

## Decision
**Tilt.** Pen input that reports `tiltX` and `tiltY` is kept per point (how far, 0..1 at 70 degrees, and which way) for the pens that use it. The **ink** pen holds its nib at the angle of the lean (so tilting a pen turns the nib, as with a calligraphy pen) and a stronger lean is a broader nib; an upright pen (under 0.12) keeps the fixed nib. The **pencil** lays a broader, softer line the more it leans (the side of the lead). Mouse and touch have no tilt and draw as before. (`interaction/pens.ts`, tested on the generated strokes in `tests/unit/pens.test.ts`; a browser test cannot give a mouse a tilt.)

**Text spacing.** `TextObject.lineHeight` (a multiple of the size, default 1.3) and `tracking` (em added after each letter). Fields **Line** and **Letters** (percent) on the options bar of Select for a picked text; the name of each can be dragged. The layout, the drawn text, the outline, the editor and the object's bounds all use them (they are part of the layout cache key), and they are saved.

## Not done
**Font choice** and several fonts in one text box: the text is drawn from the outlines of one bundled font (so it stays exact at any depth), and each extra font would have to be bundled too. Which fonts, and how many kilobytes of the single file to spend on them, is the owner's call (see plan-gaps).
