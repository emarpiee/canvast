# ADR 0003 — Canvas objects, projection, selection policy and snapshot persistence

- Status: accepted (Phase 0B); deep-magnification section revised after a user-reported rendering defect
- Date: 2026-10-13
- Builds on: [ADR 0001](0001-exact-dyadic-world-coordinates.md)

## Object placement

Every canvas object (`src/doc/model.ts`) is independent and owns its own
transform:

```
world(local) = anchor + local · 2^unit
```

- `anchor` is an exact dyadic world point and `unit` is an integer exponent.
  Local geometry is stored as doubles: stroke vertices and width, or image
  `w`/`h`.
- New content is authored at the current scale. `unit = -zi`, so one local
  unit is `2^zf` ∈ [1, 2) CSS px, and local numbers are pixel-sized.
- `normalizeUnit` re-expresses local geometry in another power-of-two unit
  whenever its magnitude leaves [2^0, 2^16]. This is exact and keeps doubles
  well-conditioned after large resizes.
- Translation adds an exact dyadic delta. Scaling about a fixed point is exact
  for the anchor (`f + (a − f)·k`, rounded 96 bits below the local unit). Local
  geometry is rounded once per edit. Undo restores stored objects, so rounding
  never accumulates through undo.
- An object has no implicit parent. `attachmentTargetId` exists in the schema
  and must be `null` until explicit attach/detach is implemented. Drawing over
  an image never links the stroke to it.

## Projection shared by drawing and picking

`src/render/projection.ts` maps local geometry to the screen as

```
screen = viewportCenter + ((x − L.hi) − L.lo) · ppu
L      = (camera.center − anchor) · 2^-unit    (exact, then split into a double-double)
ppu    = 2^(unit + zi + zf)
```

`L` is the viewport centre in the object's local units. Vertices near the
screen subtract nearly equal doubles, which is exact. On-screen geometry is
therefore sub-pixel exact however far away the anchor is, or however deeply
the object is magnified. The unit test
`keeps on-screen vertices sub-pixel exact where a naive anchor+offset projection fails`
covers a vertex 2^40 px from its anchor, landing exactly on the screen centre.

Rendering, hit testing, box/lasso selection and selection handles all
consume the same `ProjectedObject`. What is drawn is exactly what is picked,
and that holds at every scale, because the projection is a similarity
transform.

### Deep magnification: the exact path (revised after a user-reported defect)

The first Phase 0B renderer projected every vertex to a double and built
deep-zoom geometry from those screen coordinates. It documented that this was
accurate only to about 2^40× magnification beyond a stroke's authoring scale.
A user zoomed deep into a stroke and saw holes and flicker. A reproduction
measured holes in 63 of 200 zoom steps from about 2^52× onwards: at a radius
of 2^61 px, a double resolves only 512 px. **That limit was a defect, not a
physical limit,** and it was fixed at the model level
(`src/render/stroke-coverage.ts`):

- A projected stroke is flagged `exact` when its radius exceeds 2^14 px or
  its screen extent exceeds 2^40 px.
- Exact strokes compute, per segment and relative to the exact viewport
  centre `C`:
  - `perp = cross(U, W)` and `dot = U·W`, as exact dyadics;
  - the side offsets `r ∓ d` from the exact numerator `r²|U|² − perp²`;
  - the cap offsets `dot/|U|` and `(|U|² − dot)/|U|`;
  - for discs, `|W| − r = (|W|² − r²)/(|W| + r)`.

  Those numbers are small whenever a boundary is visible, so converting them
  to doubles is accurate. The visible coverage is then the viewport rectangle
  clipped by a few half-planes with small coefficients.
- Hit testing for exact strokes uses the signed distance to the outline from
  the same exact numerators. A ±4 px pick tolerance therefore means 4 px even
  when the radius is 2^61 px.
- Unit tests compare coverage against an independent exact classifier
  (squared distances only, no square roots). They place the viewport on an
  edge at magnifications from 2^0 to 2^5000, and use 80 random strokes viewed
  at up to 2^3900. Browser tests check rendered pixels against the exact edge
  distance.

### No magnification cap (second user-reported defect)

The first exact path still had two flaws.

- **A cap at 2^900.** `projectionFor` returned nothing once an object was
  magnified 2^900× beyond its unit (`MAX_PPU_LOG2`). The cap existed because
  pixels-per-unit was formed as one double, which overflows near 2^1024.
- **An imprecise fast path.** Exact strokes and image pixels still ran
  through the double-double fast path. Its viewport centre is only accurate
  to about 2^-104 of its magnitude, so image colour vanished from about 100
  levels beyond the image's placement scale.

A user saw a stroke disappear at 2^901.5×; the browser regression test
reproduced both flaws. Fix:

- The scale is now carried as an integer exponent `e = unit + zi` plus
  `f = 2^zf`.
- Every exact quantity is scaled by an exponent shift (`toPx`) before it is
  converted to a double. Values near a visible boundary therefore neither
  overflow nor underflow.
- Object screen boxes are always computed exactly, and they drive culling.
- The fast path is used only when its error bound
  (`|L|·2^-104 + |x|·2^-106`, in px) is below 2^-40 px. Otherwise stroke
  vertices are projected exactly, and exact-path culling happens in local
  units, never on screen coordinates that may be ±Infinity.
- Magnified image pixel edges are projected from the exact rational
  `(i·w − L·pixelW)·2^e·f / pixelW`.

There is no magnification at which an object is dropped. Verified:
- strokes and images placed 600 levels deep stay visible, and stay
  selectable, through 1,500 more levels of real keyboard zoom;
- unit tests cover magnifications up to 2^20000.

Exact strokes cost a few `BigInt` multiplications per visible segment and
vertex per frame. Measured frame times are in the test log.

### One paint per object (opacity and future blend modes)

Each object's coverage is painted **once**:

- a single `stroke()` of a pre-clipped polyline (double path);
- or a single nonzero fill of all exact polygons (exact path);
- or one `drawImage`, or non-overlapping device-pixel-snapped rectangles
  for extremely magnified image pixels.

This is applied through one `paint()` wrapper that sets the object's opacity,
and is the single place where blend modes will be set. Self-overlaps never
double-blend, and pieces of the same object never leave holes showing what
is behind.

Measured by mutation testing: every exact polygon is cut from the viewport
rectangle, so all polygons already wind the same way.
`orientPositive` is kept as a guard for future geometry; it was not the
cause of the reported holes.

Canvas coordinates are kept bounded because common rasterizers use single
precision internally:

- the double path pre-clips segments to the viewport grown by the radius
  (≤ 2^14 px);
- exact polygons are clipped to the viewport plus 2 px;
- image pixel rectangles are clamped to the viewport.

## Selection and tool policy

| Situation | Behaviour |
| --- | --- |
| Pen over media | Creates an independent stroke; never selects, moves or alters the media |
| Wheel, middle-drag, Space-drag, Hand tool, two-finger touch | Camera only |
| Select-tool click | Topmost object under the pointer. Images use their bounds (alpha-aware picking is not implemented). Alt+click cycles through overlapping hits |
| Select-tool drag starting on a stroke | Selects it (shift adds) and moves the selection |
| Select-tool drag starting on *unselected* media | Box selection, **not** a move. Media is moved only after an intentional click selects it |
| Select-tool drag starting on selected media | Moves the selection |
| Box selection | Objects whose screen bounds are fully inside the box |
| Lasso, "Strokes" filter (default) | Strokes with at least 50% of their vertices inside; never media |
| Lasso, "All" filter | Same stroke rule, plus media whose 4 corners are all inside |
| Corner handle drag | Uniform scale about the opposite corner. A single image with Shift scales freely. The scale factor is clamped above 1e-6, which prevents flips and is not a size limit |

Gestures produce transient previews (`EditorState.preview`, `draft`, `lasso`,
`marquee`), which are drawn through the same projection. On pointer-up, a
gesture becomes exactly one transaction, so moves and resizes undo in one
step. Escape or `pointercancel` discards the preview.

## Document, history, persistence

- `DocumentStore` applies **transactions**: per-id `before`/`after` states.
  It validates every resulting object before mutating anything, and rejects
  stale transactions built against an older state. Undo/redo re-apply stored
  states (limit 500).
- **Snapshot persistence** (`src/storage/snapshot.ts`) writes the whole
  document to IndexedDB 250 ms after the last committed transaction, never per
  drag event. It uses `durability: "strict"`. The camera is saved separately,
  debounced to 600 ms. The HUD reports *Saved*, *Unsaved changes…*,
  *Saving…*, *Save failed* or *Storage unavailable*. On load, damaged objects
  are skipped and reported; they are never repaired silently.
- **Assets** are content-addressed by SHA-256, using WebCrypto or a portable
  fallback, and their bytes are stored once. A placed image is an instance
  referencing the hash. Missing assets render as a placeholder.
- Undo history is not persisted, by decision (2026-10-14): it is the standard
  in-session editor stack and clears when the app closes. Reopening restores
  the document and camera but not the history.

## Deferred, with reasons

- Spatial index and visibility queries: Phase 0C. Today every object is
  projected each frame.
- Groups, attach/detach, locking, rotation, alpha-aware picking, a Layers
  panel: Phase 1–2 (U3, U6, U9, U10).
- Transactional workspace database, multi-tab coordination, export/import:
  later phases. The snapshot is deliberately minimal.
