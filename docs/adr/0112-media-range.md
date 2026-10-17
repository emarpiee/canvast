# ADR 0112: Play only a range of audio or video

## Status
Accepted (v0.17.0).

## Decision
`MediaState.range` (seconds, in before out) on an audio or video instance. In the player's settings (the gear): **Start here** and **End here** take the position now, **Whole file** clears it; the range is told there ("0:01 to 0:03"). Playing from outside the range, or from its end, starts at its start. While playing, a check every 50 ms (the element reports its time only a few times a second) takes the position back to the start of the range when it repeats, and stops at the end when it does not (the stop position is saved like any pause). The seek bar still shows the whole file, so positions read the same. GIFs have no range.

## Tests
`tests/e2e/assets.spec.ts` (set the range, play it, stop at its end, clear it), both browsers.
