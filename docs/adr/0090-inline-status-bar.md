# ADR 0090: The readout is one inline status bar

## Status
Accepted (v0.17.0)

## Decision
The information shown at the bottom left (Settings > Appearance > Information shown) is one strip along the very bottom of the window, the full width, instead of a small stacked box. The view controls keep floating at the bottom right, just above it. The most important comes first on the left: zoom, then the save state, then the position, the object count, the speed, and in Technical the frame-time and memory lines as further segments. In Simple, More and Technical it is the same bar with more segments; Hidden shows none. A row that is too long wraps to a second line;. The text and the test ids are unchanged.
