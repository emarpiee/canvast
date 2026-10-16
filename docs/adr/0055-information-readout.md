# ADR 0055 — The information readout: Simple, More, Technical, Hidden

- Status: accepted (owner request of 2026-10-16: the button said "frame rate counter"; make it four views, the default readable by anyone)

## Decision

The button at the bottom right (next to zoom out, zoom in and home) cycles four views of the readout at the bottom left; its icon and tooltip name the one shown and the next ("Information shown: Simple. Click for More."). The choice is the device setting `ui.info` (also in Settings > Appearance > Information shown) and is kept over reloads.

| View | Shows |
| --- | --- |
| **Simple** (default) | The zoom as a magnification ("Zoom 1.3×", "Zoom 250×", "Zoom 10^300×"; 0.25× when zoomed out) and whether the work is saved, in words ("Saved", "Saving…", "Not saved: changed in another tab", "View only: another tab is editing"). |
| **More** | The same, plus where you are ("Position 61, 159"), what is on the canvas ("12 objects, 3 in view", "Nothing on the canvas yet") and, only when it is not running well, a word ("A little slow", "Slow", from the frame meter: under 50 and under 30 frames per second); nothing is said while it runs smoothly. |
| **Technical** | What the readout has always shown: `zoom 2^0.41 (≈10^0.1)`, `x y`, frames per second and milliseconds, frame percentiles, object and decoded-image counts, the exact save state. |
| **Hidden** | No readout. A problem with saving (not saved, view only, storage unavailable) still appears once as a notice, so hiding the readout never hides a failure. |

A debug build (the tests, development) starts on Technical; everyone else on Simple. The frame meter runs only for More and Technical. The old setting `ui.fps` is gone.

## Not built

A readout the user composes line by line, and a shortcut key for the button.
