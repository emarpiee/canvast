# ADR 0168: one set of bars, tools and keys for the canvas and the Painting view

- Status: accepted (v0.31.0, 2026-10-22)
- Related: ADR 0167 (vector layers with the canvas's tools), ADR 0165 (the Painting view), ADR 0158 (keymap), ADR 0151 (grouped menus), ADR 0156 (panels)

## Context

After ADR 0167 the Painting view used the canvas's tools on a vector layer, but kept a bar, a rail and an options row of its own, which did not match the canvas. The owner: "they must match, include this along with the [brush engine]'s tools. Overlapping tools must merge without affecting ours too much ... DRY so both canvas view and paint view can use both tools."

## Decision

**One chrome, a switchable target.** The canvas's bars are mounted once (`mountToolbar`: rail, Properties bar, dock; `mountContextBar`: Actions bar; `mountHud`: view controls; the hint line). They work on stand-ins (`app/target.ts`, `Switch`) for the document, editor, view, index and text editor. A stand-in forwards every read, write and call to its current target; a subscription made through it hears only the current target and is called once more when the target changes, so a bar shows the other view's state at once. `setView` switches the targets: the canvas's, or in the Painting view those of the picked vector layer (ADR 0167). Storage, the index sync, the tiles and the canvas's own tools keep the canvas's objects, never the stand-ins. Caches kept by document (`render/scene-view.ts`) key by `real(doc)`, so two targets never share an entry.

**Layout.** In the Painting view `#canvas-host` stays shown above the page (only its bars take the pointer) and the canvas itself is hidden; the page fills the view under the bars. The painting's pill (back to the list, the painting's menu: rename, page size, export, place) sits beside the view tabs where the canvas has its board and canvas menu. Layers floats where the canvas's panels float (one CSS rule), shown by the dock's Layers button; the pages strip floats at the bottom left. The list of paintings has no bars.

**One rail.** `RAIL_TOOLS` (ui/toolbar.ts) is the one list; `only: "canvas" | "paint"` keeps a tool to one view (`data-only`, hidden by one CSS rule). `Tool` gains `brush`. A tool in both views is one tool that acts on its target: Hand, Select, Edit nodes, Pen, Shape and Path, Lasso, Text, and the Eraser, which takes objects on the canvas and on a vector layer, and paint on any other layer (the Painting view decides by the picked layer). The Painting view's own tool state is the hosted editor's tool. Its painting tools (`paint/tools.ts`: Brush and Eraser, schema of options) show their options in a slot of the Properties bar (`[data-paint-options]`); the Brush's colour is the Pen's colour (the Properties bar's colour button). The view controls keep zoom out, zoom in, fit and Zen in the Painting view; zooming through them moves the vector layer's view, which the Painting view's camera follows (ADR 0167).

**One keymap.** A command's scope is `canvas`, `paint`, `both` or `global`; `inView(scope, view)` says where it works, `installKeymap` resolves a press in the view in front, and the first command bound to a key in that view has it. Tools, undo and redo, the editing keys, zoom and Space are `both`; `tool.brush` (`B`) is `paint` and comes before `tool.path` (`B`, canvas), so `B` is the Brush in the Painting view and Path on the canvas without a clash. `toolForKey(key, view)` and `owners` (Settings > Shortcuts conflicts) follow the same rule. The hosted `attachTools` takes the keys whenever a painting is open (`keysActive`), so `Esc`, `Delete`, `Enter`, the Ctrl keys and the tool letters behave as on the canvas while the Brush is chosen; Escape while a stroke is painted only drops the stroke.

**Undo.** The rail's undo and redo, and their enabled state (`canUndo`, `canRedo`), are the painting's history in the Painting view.

## Consequences

- The two views match by construction: a change to a bar, a tool or a key reaches both.
- New painting tools from the brush engine (Pencil, Eyedropper, selections, fill, gradient, retouch) are new `RAIL_TOOLS` entries, `only: "paint"` unless they also mean something on the canvas, in which case they merge into the existing tool.
- The canvas's Adjust, Tags, Styles, Pattern and Bookmarks panels are not mounted on the vector layer yet (hidden in the Painting view); the camera history, the dice, Home, the canvas pattern, background, information and names controls are canvas-only.
