# ADR 0203: Flip mirrors shapes and paths too, and several selected objects as one

- Status: **accepted** (2026-11-14)
- Related: ADR 0118 (crop and flip of pictures), 0099 (paths), 0100 (paints), 0146 (vector networks), 0198 (the Properties sections)

## Context

Flip horizontally and Flip vertically were only for pictures: a flag (`flipX`, `flipY`) that mirrors the picture in its box. Shapes and
paths had no way to be mirrored, and with several pictures selected each one flipped in its own place.

## Decision

- **What flips**: pictures (not sound), shapes and paths, unlocked; a boolean group's result through its members (it is made again from
  them); not a sheet, a pen stroke or a text (the owner asked for shapes and paths only).
- **One object** is mirrored across the line through its own middle (`mirrored` in `doc/edit-ops.ts`), as the canvas sees it:
  - a picture toggles its flag, as before;
  - a path's local points (its nodes, its sharp base, its shape's box and a balloon's tails, through `stretched` with -1) are mirrored, and
    its anchor moves by twice its middle so the middle stays; gradients are mirrored in their box (`mirroredPaint` in `doc/paint.ts`: an
    angular one also goes round the other way); a network's region fills move to the other half-edge, which now lies beside them;
  - a turn goes the other way (`rot` becomes `-rot`), so a turned object is mirrored about the canvas's axis.
- **Several objects** are mirrored as one (`flipSelection` in `app/actions.ts`): each is mirrored about its own middle, then moved to the
  other side of the middle of the selection's box. The box is taken in the first object's frame, and each move is scaled into its own
  frame, so it works at any depth. One undo step.
- **Where**: the Flip buttons have their own **Flip** section of the Properties bar (a chip of their own), shown for pictures and shapes;
  `Shift+H` and `Shift+V` (keymap `edit.flipH`, `edit.flipV`) and the command palette do the same. *Reset flip* stays for pictures only.
  A button is pressed only when every selected object is a picture flipped that way.

## Consequences

- A rotated picture flipped alone also turns the other way (before, it mirrored along its own axis).
- A texture fill is not mirrored. A text tied to a shape follows the mirrored shape (it is placed again from it); a loose text is not
  flipped.
