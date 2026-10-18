# Text tool revamp (v0.18.0): test log

*Implemented:* mentions removed (ADR 0125), names above items (0125), text look in the options bar, click and drag boxes, text styles (0126), fonts from the library (0127).

*Tested (2026-10-18):*

| What | Result |
| --- | --- |
| Unit (`npm run test:unit`) | all green; new: layout alignment and no-wrap width, text look (`withLook`, `lookOf`), WOFF unpacking and refusal reasons, font registry, text style kind |
| Chromium: text, vectors, dock, organize, archive, files, assets, styles specs | all green after each slice; new tests: click and drag boxes with size, alignment and width mode (text), a text style saved and applied (styles), a font imported, used and kept after a reload (text), a card's file name above it (files) |
| Firefox: text spec | green (10 of 10) |
| `check:tokens`, `check:names`, typecheck | green |

*Known failures:* `text.spec.ts` "convert text to path" failed on some runs before and after this work (ink centre moved 2.4 px against a limit of 1.5; it passed in the run with the other affected specs); it fails the same way on the commit before this work.

*Unverified:* the dpr2 and chromium-cpu projects; the full suite (not run since v0.16.0); fonts other than Inter Black and Regular; a font the browser refuses (drawn from outlines, no test).

*Committed:* yes, one commit per slice. *Next bounded task:* underline and strikethrough, or per-range size and colour (backlog section 1).

## Bars revamp (ADR 0128), 2026-10-18

*Tested:* Chromium: vectors, frames, sheets, text, pictures, editing, a11y, files, styles, dock, organize, assets, bookmarks, settings, navigation, screenshot, archive; tests moved from menus to buttons (combine, arrange and align, initial shape, selection tool options, the colours of a selection, attach, fit sheet), the hint-line tests move the pointer off the Actions bar first, the corner-dots test draws its shape clear of the bar along the bottom. The player's bar keeps clear of the Actions bar (`ui/media-player.ts`). Screenshots at 390, 900 and 1280 px wide. *Known flaky:* the convert-text-to-path ink centre test (as before).
