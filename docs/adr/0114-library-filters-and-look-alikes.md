# ADR 0114: Filter the library by what a picture is, and list look-alikes

## Status
Accepted (v0.17.0).

## Decision
**Filter words** in the library search, beside `#tag` and `.png` and combinable with AND, OR, XOR, NOT and brackets: `width>1000`, `height<=1080` (`w`, `h`), `pixels>2mp`, `size<500kb` (file size), `ratio>1.5` or `ratio:16x9` (within 3 %), `orientation:portrait|landscape|square`, and `colour:red` or `colour:#2563eb` (`assets/filters.ts`). The help card (?) lists them.

**Colour and look-alikes read the thumbnail**, not the original: each picture's stored thumbnail is drawn into a 32 x 32 grid a few at a time, only when a colour word or the Similar images list needs it, and kept in memory (`assets/look.ts`). The colour is the busiest cell of a 4 x 4 x 4 colour grid, named as one of twelve words (red, orange, yellow, green, cyan, blue, purple, pink, brown, black, white, grey) or matched against a hex colour within a distance; see-through counts as white. A 64-bit difference hash (brightness of 9 x 8 cells compared with their right neighbour) is kept beside it. A picture whose look is not yet known does not match a colour word until it is (the list fills in a moment later).

**Similar images** is an entry of the library's sidebar: pictures within 6 bits of each other (or joined through a chain) are listed together, the biggest group first (the hash is cut into 7 pieces so only pictures that share a piece are compared). Exact copies are already one asset (import merges them); this shows the ones that only look the same: resized, recompressed, lightly edited.

## Not done
Colours from the original (a thumbnail's dominant colour can differ from a photo's mood); a threshold slider for look-alikes; merging or deleting from the groups in one step; filters for the canvas search.

## Tests
`tests/unit/look-filters.test.ts` (colour naming, hash distances, groups, filter words); `tests/e2e/assets.spec.ts` (size, ratio, orientation and colour words, the Similar images list), both browsers.
