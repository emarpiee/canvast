# ADR 0191: Line art of a 3D model from its own edges

- Status: **accepted** (2026-11-13)
- Related: the 3D view (src/ui/model-view.ts, src/assets/model-engine.ts), Styles (ADR 0120), shared setting rows (src/ui/setting-rows.ts)

## Context

The 3D view drew line art by looking at its picture: a shader marks where depth or the surface's turn changes between neighbouring pixels, and *Place the lines* followed those marks along their middles. That works on any model (scans, millions of triangles) but cannot tell an edge in front from one behind, gives one line width, and its lines are traced from pixels. A technical illustration or a print wants exact lines, the edges behind dashed, and tones from the light.

## Decision

- **Two ways to find lines** (*Find by*): *Model edges* (new, the default) and *The picture* (as before, with its own settings). Both are kept: the picture keeps up with any model, the edges are exact.
- **Model edges** (`src/assets/model-edges.ts`, no three.js, run in the model's worker): corners at one place are joined; each edge knows its two faces. An edge between a face turned towards the camera and one turned away (or an open edge) is the **outline**; one where two faces meet at a sharper turn than the crease angle is a **crease**. The faces are drawn into a buffer of which face is nearest at each pixel; an edge is sampled along its length against it and split where it goes behind something (**hidden edges**, kept only when asked, dashed when painted). By the rim of a round form the faces next to the outline come nearer than it within a pixel and its own faces are slivers: an outline a little behind what covers it counts as seen when, just outside it, nothing nearer covers it; outline and crease pieces whose ends are within a line's width are joined, so a coarse model's rim does not read as dashes.
- **Tones** from the lights of the view: each face's light (its turn to each light, with light all around) gives its darkness, read through the face buffer as hatching, cross-hatching (three passes), halftone dots or stippling. **Hand-drawn**: a wobble along each line, far lines faded, near lines thicker (widths and fades in a few steps, so lines of one look stay one path).
- **One drawing for everything**: the worker returns lines joined end to end in groups (outline, crease, hidden, tone; a width and opacity each), dots and, when asked, the faces in sight as triangles for a fill. `paintInk` paints it on a 2D canvas laid over the view's WebGL picture (a texture on a quad, so cards, pixel reads and the stage's own canvas all have it); `inkSvg` writes the same drawing as SVG for **Place the lines** (paths to edit, mirrored as the view) and **Save the lines as SVG** (with the background, and the model's picture under the lines when they are over it). The picture method's traced lines go through the same writer.
- **Off the page, a view at a time**: the worker keeps the model; it is sent again only when its shape changes (a pose, which way is up). One view is worked out at a time and only the latest asked for waits; while the view turns, it is worked out at half size. What was found last stays on the picture until the new view's lines come, unless the picture's size changed. A card's picture waits for its lines.
- **Show**: off, over the model, **on a fill** (the model drawn in one flat colour under the lines), or lines alone.
- **Line styles**: eight built in (Blueprint, Ink, Architectural, Etching, Patent, Comic dots, Pencil, Toon), each setting every value of the lines and the background (`withLineStyle`). Your own are a style kind (`lines3d`, `LINE_STYLE_KIND`) in the Styles panel: saved from the view's Line styles menu, offered there for any model, and given to the 3D view in front when its card is pressed in the panel (`src/ui/model-front.ts`, apart from the view so the main bundle does not load three.js).
- **The settings in tabs** (View, Lines, Light; the shared `seg pg-tabs`), and a row of the shared setting rows may now depend on a switch (`when: ["key", "true"]`).
- **Narrow views** (a container query on the view, 40 rem): the settings are a sheet under the model; the bar's other buttons (`data-minor`) are in its More menu, made from those buttons. Two pointers pinch to zoom and move together to slide.

## Consequences

- On a model of millions of triangles the lines from its edges come a moment after the view (about 0.2 s a view at 500 000 triangles, the first view of a model a second more); *The picture* keeps up.
- Placed lines and SVG files hold paths only, except the model's picture in an SVG of lines over the model.
- Lines found by the picture keep their former look; a view or card saved before this, with lines on, now finds them from the model's edges (the default), as a new view does.
