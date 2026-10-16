# ADR 0080: Screenshots

## Status
Accepted (v0.17.0)

## Decision
- A **Screenshot** button (camera) in the bottom-right controls, in the group of what is shown. It saves what the canvas shows to the library as a picture: no selection outlines, guides or lasso, with the options of Settings > Screenshot.
- **Name:** a template, `{board}-{canvas}-{ddmmyyyy}-{hhmmss}` by default (also `{workspace} {yyyymmdd} {hhmm} {yyyy} {mm} {dd} {hh} {min} {ss}`); name words are lower_case_with_underscores or as written; characters a file system refuses become "-". The extension follows the format.
- **Format:** WebP by default, PNG or JPEG; a quality for WebP and JPEG; WebP falls back to PNG where the browser cannot write it. JPEG is filled white behind transparency.
- **Folder:** the library folder "Screenshots" (a name you can change; empty: no folder), made the first time.
- **Tags:** "screenshot" (on by default), the board's name, the canvas's name, and the in-canvas tags of the items in the picture (each its own switch).
- **Content:** the canvas pattern (on by default), a transparent background, the floating interface (off by default: the bars and panels are copied into an SVG image with the page's own styles and drawn over the canvas picture; if the browser refuses, the screenshot is saved without it and a notice says so), and the area: the whole view or the box around the selection.
- **Also:** copy to the clipboard as PNG.
- Settings are device settings (`shot.*`), shown in their own tab.

## Consequences
A screenshot is an ordinary library asset (one copy per content: identical pictures are stored once). Capturing draws one extra frame without overlays; the screen is redrawn normally right after.
