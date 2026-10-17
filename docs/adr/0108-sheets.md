# ADR 0108: Sheets

## Status
Accepted for the first slice (v0.17.0). Real-unit sizes, constraints and auto layout are planned (see Not done).

## Why a new word
"Frame" already means a coordinate space in canvast (ADR 0014). The container that holds and cuts what is on it is called a **sheet**: a fixed area of the endless canvas, like a sheet of paper you can place anywhere and zoom into.

## Decision
**What a sheet is.** A rectangle path with `container: { clip }` (`PathObject`, `src/doc/model.ts`). Fill, outline, corner radius, turning, gradients, dashes, the Layers row, the spatial index, the exact edges at any depth: all of it is the path's own, so a sheet needs no new kind and no new renderer. Objects on a sheet name it as their `parent` (`ObjectBase.parent`). A parent that is gone counts as none. Sheets nest (`MAX_SHEET_DEPTH` 32). It is separate from `groups`: a group is selected as one thing, a sheet's contents are picked one by one.

**Cutting.** With `clip` (the default) what is on a sheet is cut by the sheet's shape: `visibleObjects` hangs the projected sheet bodies on each object (`ProjectedObject.clip`, outermost first; `scene-view.ts withClips`), the renderer clips to the same path it fills the sheet with (`drawObjects`), and picking asks the sheet too (`hit-test.ts insideBody`), so what is cut away cannot be picked. Rounded corners, turned sheets and depth beyond doubles need nothing extra. A sheet that covers the view cuts nothing; one that is off screen takes its contents with it; a hidden sheet hides what is on it. Strokes on a sheet are not batched (a clip per object). Changing a sheet re-renders the tiles of everything on it (`main.ts`).

**Putting things on a sheet.** What is drawn (shape, path, pen stroke, a sheet) takes the innermost sheet under where it starts. What is moved takes the sheet under the pointer where it is let go, or none: the objects not already on another moved object change `parent` and are brought to the front, so they are not under their sheet. Picking a sheet (its fill, its name, its row, a marquee that crosses it) picks what is on it too (`expandToUnits`), so move, delete, copy and duplicate carry it all; copies name the copied sheet (`clipboard.ts`).

**Making and unmaking.** **Sheet tool** (key C, setting `key.sheet`): drag; a white sheet, no outline, named Sheet n. **Ctrl+Alt+G** or the selection bar's *Put on a sheet*: a sheet exactly the size of the picked objects, just behind them, in the sheet around them if they all share one. **Release the sheet** (selection bar): its contents stay where they are, in the sheet around it or on the canvas.

**Layers.** A sheet is a row (icon, name, count) with the objects on it as its children, a **clip toggle** (icon `crop`) and the usual eye and lock, which act on the sheet and everything on it. Renaming works as for any layer.

**The name on the canvas** (`render/sheet-label.ts`): above the top-left corner of every sheet on the canvas, and of a sheet inside another while it is picked. Pressing it picks the sheet; dragging it moves the sheet and what is on it.

## Not done
- **Real-unit sizes** (px, in, mm) and a sheet-relative measure for what is on it (so a 12 px label is 12 px of the sheet at any zoom). Needs a decision on what resizing a sheet means (see the owner's question).
- Constraints for what is on a sheet when it is resized, resize to fit, presets, auto layout, layout grids.
- Masks (left out by decision); clip applies to the sheet's shape only.
- Selection marquee and lasso do not take clipping into account (they can select what is cut away).

## Tests
`tests/e2e/sheets.spec.ts`: drawing on a sheet, the cut (pixels, picking), the Layers clip toggle and undo; moving on and off a sheet; Put on a sheet, Release; the name picks and moves the sheet with its contents. Both browsers.
