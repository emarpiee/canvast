# ADR 0053 — Notices and one spec for the floating elements

- Status: accepted (owner feedback of 2026-10-16: floating elements inconsistent, "importing" and other notifications not easily noticed)
- Related: ADR 0052 (visual system), 0051 (selection bar)

## Decision

**Floating elements.** The rail, dock, options bar, view tabs, workspace menu, HUD controls, selection bar and the Layers and Bookmarks panels follow one spec (`styles.css`, "Floating elements: one spec"): a 36 px control and 4 px of padding on each side (44 px high), a 12 px radius, one border and one shadow, 12 px from the window edge and 8 px from a neighbour. Before: view tabs 29 px buttons with 2 px padding and an 8 px radius, the workspace menu 8 px, panels 10 px, rail buttons 40 px, dock 34 px, options 30 px. The side panels start 8 px below the lowest of the view tabs, the dock and the options bar (`--bar-bottom`, measured; it used to be 0 when the options bar was hidden).

**Notices** (`ui/notices.ts`). A stack at the bottom centre of the window, above every view, replaces the line in the toolbar (5 seconds, small, easy to miss). Each notice has a kind: info, progress, success, warning or error, shown by icon, colour, a bar on the left and a tint; a progress notice has a bar (a moving one when the length is unknown); every notice has a close button. Successes fade after 5 s, information after 6 s, warnings after 9 s, errors after 14 s, and a pause while the pointer is on it; a progress notice stays while it is updated and is closed by the result or by `editor.progressDone.add(channel)`. The same activity replaces its earlier notice (all "Importing n of m" messages are one notice). Errors are `role="alert"`, others `role="status"`; the container is the live region. `editor.message = "..."` stays the way code speaks; the kind, the progress ("3 of 10", "45%") and the channel are worked out from the wording (`classify`), so existing code did not change except:
- **Importing is announced at once**, for one file as for many ("Importing clip.mp4…"), in the canvas and in the Assets view; before, nothing was shown for a single file and the progress for more than three.
- The Assets view keeps the last notice as text in a visually hidden live region (`assets-status`) for screen readers and tests.

## Not built

Notice history, an undo action inside a notice, and per-kind settings (duration, position).
