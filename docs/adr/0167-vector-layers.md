# ADR 0167: vector layers edited with the canvas's own tools

- Status: accepted (v0.30.0, 2026-10-22)
- Related: ADR 0166 (canvas objects on a page), ADR 0165 (the Painting view), ADR 0003 (selection), ADR 0151 (touch gestures), ADR 0158 (keymap)

## Context

ADR 0166 put canvas objects on a page, but its Move, Shape, Text and Edit nodes tools were the Painting view's own (a second, smaller copy of what the canvas does), and every shape made a layer of its own. The owner asked for a vector layer that holds many shapes, paths, pen strokes and texts, as a painting program's vector layer does, edited with **the canvas's own controls, shortcuts and gestures**, written once.

## Decision

**Host the canvas's editor on the picked vector layer** (`paint/vector-host.ts`). A vector layer is the `object` layer of ADR 0166 (now labelled *Vector layer*, allowed to be empty). The host keeps one canvas document (`DocumentStore` with its `FrameIndex`), a `ViewState` and an `EditorState`, and mounts on the Painting view's canvas the canvas's `attachTools` and `mountTextEditor`. So select, move, resize, rotate, the rotate zone, Alt-click cycling and Alt-drag copies, Ctrl-click deep picking, the lasso, Edit nodes, Pen, Shape, Path, Text, their modifier keys, touch keys and taps, and the keys on what is picked (Delete, Ctrl+D, Ctrl+G, Ctrl+[ ], Esc, Enter) are the canvas's code, not a copy. Copy, cut and paste use the canvas's `copySelection`, `cutSelection` and `pasteObjects`.

- **Binding.** The host loads the picked layer when it is a vector layer (none otherwise: nothing to pick). A finished edit of the document (`source: "do"`) is written back as one step of the painting's history (`replaceLayer`); with no vector layer picked, the first edit makes one (*Vector n*) above the picked layer. When the layer changes elsewhere (an undo, a redo, another tab), the host loads it again.
- **History.** The canvas's undo and redo (keys and the two- and three-finger taps) go to the painting's history through a `history` hook of `attachTools`; the document's own history is not used.
- **Camera.** A page px is a world unit at zoom 0, so the canvas camera is `cameraFor(placement)` (ADR 0166). The Painting view gives its camera to the host before each frame; the canvas's own pan and pinch move the host's view, which the Painting view takes back (and keeps within its limits). The canvas camera's zoom steps are 2^-20 of a level, far below a pixel.
- **Scope.** `attachTools` gained three optional hooks: `scope` (whose keys: `shortcutsActive(e, scope)`), `history`, and `active` (false: the pointer and keys belong to the host's other tools, as the Brush). The canvas passes none of them and is unchanged. While a vector tool is chosen, the Painting view leaves the pointer, undo, Space, Delete, Escape, Enter and the Ctrl keys (except Ctrl+0 and Ctrl+1) to the canvas's tools; its tool letters choose its tools.
- **Drawing.** The layer being edited is drawn from the host's document with the gesture going on (`visibleObjects` with the editor: a move or resize shows live), through `Scene.vector` in `compose.ts`; the canvas's `drawOverlays` draws the selection, handles, nodes and drafts over the page. Other vector layers are drawn from their records as before.
- **Tools.** The Painting view's `TOOLS` entries name their canvas tool (`action.canvas`): Select `V`, Edit nodes `N`, Pen `P`, Shape `U` (with *Path (curves)* as one of its kinds, as in the canvas's Shape flyout, so `B` stays the Brush), Lasso `L`, Text `T`. Their options are in page px and are given to the editor before each press (an outline width or a text size times the zoom; the pen through the canvas's width lock, so its width is the same on the page at any zoom). When the canvas's tools change tool (Esc to Select, Enter to Edit nodes), the Painting view follows.
- **Shared, not copied.** The long-press list under a finger moved from `main.ts` to `ui/reveal-list.ts` for both views; the canvas's cursor rules cover the Painting view's canvas (`:is(#canvas, .paint-canvas)`). The hosted text editor's test id is `paint-text-editor`. `paint/vector-tools.ts` and `paint/handles.ts` (ADR 0166's own tools) are removed.

## Consequences

- Every improvement to the canvas's tools reaches vector layers with no change in the Painting view.
- The canvas's Actions bar, its option bars and panels (align, boolean operations, masks, the Adjust panel on a shape) are not mounted in the Painting view yet; what is picked is changed with the tools, their options and the keys (README Limitations). Mounting the Actions bar on the host is the next step if wanted.
- A vector layer that is not picked is drawn from its records, which leave out masks and the members of boolean groups as ADR 0166 did; the picked one is drawn as the canvas draws it.
