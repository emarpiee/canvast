# ADR 0058: stepping between items (Ctrl+Arrow) and the Alt focus

Status: accepted (owner request, 2026-10-16; the idea comes from the owner's other canvas project, adapted to endless depth)

## Decisions

1. **Ctrl+Arrow steps the selection to a neighbouring item and frames it.** Groups count as one item (at the level the user has entered). With nothing selected the first step picks the item nearest the middle of the window (top-most for "by layer"). Nothing moves: only the selection and the camera change.
2. **Three ways to choose the next item** (Settings > Navigation, `nav.mode`):
   - **Nearest in view** (default): measured in screen pixels, among the items near the selected one. An item counts only if it is legible (4 px up to 16 windows), its size is within a factor of 6 of the selected item's (a much larger or smaller one is another depth), and the gap to the selected item is at most 3 of the selected item's own sizes (so the rule is the same after the view has zoomed to the item). It must lie ahead, within about 56 degrees of the arrow's line, or overlap the selected item across it; of those, ahead + 2 x sideways is the score. Nothing qualifies: the selection stays. *Amended (v0.17.0, ADR 0104): between two items that are both in the window the size rule is 60x and the gap rule a window, so the step reaches what is on the screen however small the selected item is; the 6x and 3-sizes rules apply to what is off the screen.*
   - **Nearest anywhere**: nearest by position alone, exact in any depth and size; offsets are scaled so the nearest is about 1 before scoring (forward + 1.5 × sideways, as in the project this comes from).
   - **By layer**: up and down the paint order, top-most first, wherever the items are.
3. **Alt, pressed and released alone,** brings the selection into view. Any other key or a pointer press while Alt is held cancels it (so Alt+drag and Alt+key keep their meaning); the keyup is prevented so the browser's menu bar does not open.
4. **On arriving at an item** (`nav.arrive`: "Focus on the item", the default, or "Keep the zoom level"): focus fills 60% of the window (`fitRect`, exact at any depth, in the first item's own frame); keep: bring the item to the middle and keep the zoom. The Alt key always focuses.

## Tests

`editing.spec.ts`: stepping right, right, left in view with framing; Alt alone versus Alt with a key; by-layer stepping from nothing selected; a tiny deeper item skipped in view and reached in anywhere.
