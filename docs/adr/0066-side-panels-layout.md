# ADR 0066: side panels layout and the Layers panel for many layers

Status: accepted (owner request, 2026-10-17)

With a big canvas (1,479 layers) the Layers panel took the whole height, squeezed the Bookmarks panel to its header and ran under the bottom controls. Now: the stack is bounded (clear of the top bars and of the bottom controls); the Bookmarks panel keeps up to 36% of the height and never less than a card; the Layers panel takes the rest (at least 180 px) and its list scrolls. A **filter** box appears once there are more than 12 layers (it lists the matching items flat, front first; Escape clears it); rows past the first 500 are reached with **Show 500 more rows** instead of a dead-end note; the eye and lock are quiet until a row is pointed at or selected (always shown for hidden or locked items and on touch); the Tags, Blend and Opacity settings appear under the list only when something is selected, so an empty selection no longer costs a block of disabled controls.
