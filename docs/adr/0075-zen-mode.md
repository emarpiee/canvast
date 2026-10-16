# ADR 0075: Zen mode

## Status
Accepted (v0.17.0)

## Decision
- A device setting `ui.zen` (also a toggle in Settings > Appearance), a leaf button beside Home in the bottom-right controls, and a rebindable key (`key.zen`, Z at first; Settings > Shortcuts, group View). The key works on the canvas and not while typing.
- On: the view switch and workspace bar, the tool rail, the dock, the tool options, the readout, the bottom-right controls, the Layers and Bookmarks panels and the selection bar fade to nothing (`:root[data-zen="on"]` in the stylesheet, a 200 ms fade that follows the motion setting). Each comes back while the pointer is over it or the focus is inside it, so everything stays reachable, by pointer or keyboard.
- Not faded: notices, dialogs, menus, the canvas search, and a saving problem (the readout stays when the state is an error, unavailable, a conflict or read-only).

## Consequences
CSS only plus one attribute: no layout moves, no cost per frame. A faded bar still takes clicks, so a click where a hidden bar sits hits the bar, as it would if shown.
