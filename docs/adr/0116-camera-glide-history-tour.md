# ADR 0116: Gliding between views, previous and next view, and a tour of the bookmarks

## Status
Accepted (v0.17.0).

## Decision
**Gliding.** `ViewState.flyTo(camera)` goes to another view by a smooth path (about 0.4 s, set by Settings > Appearance > Animation) when both are in the same frame and within one frame step of zoom: the centre and zoom ease in and out, and when the places are further apart than the view is wide the path zooms out in the middle by the levels needed so the way is seen. It runs in exact numbers and any other move of the camera (a pan, a wheel notch) ends it. Reduced motion, and the test session (`#debug`), reach views at once; a jump across frames or depths is at once too (an animation across a million levels has nothing to show). Bookmarks use it.

**Previous view and next view** (`app/camera-history.ts`): the camera is remembered once it has been still for 0.7 s and is a real move from the last one remembered (another frame, a zoom level, or half a window of distance), so a pan or a zoom is one step and a jump is one step. Two buttons beside Fit and **Alt+Left, Alt+Right** go back and forward (gliding); a new move from the middle forgets what was ahead; opening another canvas starts afresh.

**Tour** (`app/tour.ts`): the play button of the Bookmarks panel goes through the bookmarks in order, each by a slow glide. The bars fade (Zen, restored after), a small caption names the stop and has previous, next and end buttons; Right, Space or Page Down go on, Left or Page Up go back, Escape ends it.

## Not done
A minimap or overview map. On a canvas with no bounds and objects at every depth there is no one map to draw; Search, Bookmarks, Layers and Fit everything are the ways round it. Camera paths between different frames or depths.

## Tests
`tests/e2e/navigation.spec.ts` (history with Alt+arrows and the buttons, glide reaches the place, a tour steps and restores the bars), both browsers.
