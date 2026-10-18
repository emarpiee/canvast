# ADR 0131 — Text on a path

- Status: accepted (v0.18.1)
- Related: ADR 0099 (paths), 0102 (text as outlines), 0130 (text looks)

## Decision

- **A text keeps its own copy of a curve** (`onPath: { n, closed }`: the nodes of a path's first sub-path, six numbers each, in the text's local units). Picking one text and one path and pressing Set the text along the picked path (Actions bar) copies the curve (the path's anchor and unit converted exactly to the text's); the path stays where it is and can be hidden or deleted. It is not a live link: moving the path later does not move the text. Take the text off its path sets it straight again.
- **One map for every glyph** (`src/text/glyph-space.ts`, `glyphMap`): a point of a glyph in font units goes to the text's local units, straight on its line (italic sheared about the baseline) or on the curve: the glyph is centred on the point at the middle of its advance, turned to the tangent there, the baseline on the curve; a second line sits below the first by the distance between the baselines. The curve is a polyline of 24 steps a segment with the distance along it; before its start and after its end it goes on straight, a closed one wraps round. Drawing, the outline command (Ctrl+E), bounds and the deep-zoom test all use it, so what is drawn is what is picked and flattened. The straight case keeps its old inline code (it is the hot one).
- **No wrapping** on a path (the set width is not used), and the text editor shows the words straight while they are edited.
- **Limits.** Underlines and strikethroughs are not drawn on a curve; the letters are placed in doubles and then exactly (like a path's nodes), so at extreme magnification the polyline's corners can show; the deep-zoom colour of a text on a path is the exact path (no coarse test). A range's own colour is lost when the text is flattened (as for any text).
