# ADR 0119: Download every file, and every adjustment on video

## Status
Accepted (v0.17.0).

## Decision
**Download** on the selection bar is for every file of the canvas (pictures, video, GIF, audio, any other file), not only cards. One file is saved as it is, under its own name; several are one ZIP (`canvast-files-<date>.zip`, `app/download.ts`), each original once however many times it is on the canvas, same names numbered ("a (2).png"). A still with a crop or adjustments also brings the edited picture, as it looks now, named by Settings > Edited pictures (format, quality, name pattern, so `trip.png` comes with `trip-edited.png`). Video, GIF and audio keep their adjustments on the canvas only (a playing file cannot be baked into the download); the message says so.

**Reset** (the list-restart button) sits beside Adjust on the options bar while the picked pictures have adjustments, and stays in the Adjust panel too.

**Video and GIF adjustments are complete**: the first version used plain CSS filters, which can do exposure, contrast, saturation and blur but not highlights, shadows, tint, sharpen or grain. They now go through an SVG filter built from the numbers (see ADR 0118), shared by the player and the canvas.

## Tests
`tests/e2e/pictures.spec.ts` (download alone and with the edited copy, reset beside adjust, all adjustments offered for a video and a filter with the right steps), `tests/e2e/files.spec.ts` (two files in one ZIP), both browsers.
