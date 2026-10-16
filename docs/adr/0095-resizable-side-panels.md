# ADR 0095: Resizable library and details panels; nothing hidden in the library bar

## Status
Accepted (v0.17.0)

## Decision
On a wide screen (above 900 px) the library panel (left, 180 to 420 px) and the details panel (right, 260 to 560 px) are resized by dragging their inner edge, with the arrow keys on the focused edge (16 px a step), or back to the default by a double-click; the widths are remembered on this device. On a small screen the details are a sheet with its own grip (ADR 0061), unchanged.
The library bar no longer hides anything on a narrow window: the thumbnail size slider is shown at every width (narrower first), and when one row is too narrow (under 1180 px) the controls wrap to a second row. Only the asset count (text, not a control) is dropped on narrower windows. The board pill shows the canvas's name only, with all the room; the board name is in its tooltip and in the menu.
