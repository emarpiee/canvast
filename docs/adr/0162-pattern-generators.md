# ADR 0162: pattern generators

- Status: accepted (2026-10-21, owner's request: patterns such as waves, blobs and scatters, each with settings of its own and a random button, chosen for a sheet or shape)
- Related: ADR 0099 (vector paths), ADR 0108 (sheets), ADR 0144 (clipping masks), ADR 0156 (panels)

## Decision

A **generator** (`src/gen/`) is a pure function from its settings, a seed and a box size to a list of vector shapes in a box that starts at (0, 0): `run(values, rng, w, h) → GenShape[]`. The same settings and seed always give the same shapes. Nothing new is stored in the document: the result is ordinary path objects in a group, so exact coordinates, hit-testing, export and deep zoom work as for anything drawn by hand.

Each generator **declares its settings** (range, choice, toggle, colour, in titled sections); the Pattern panel (`ui/pattern-panel.ts`) is built from that list, so every pattern has its own controls and a new generator needs no interface code. The registry adds the Background colour (with an eye to hide it) to every Colour section, holds each value to its range (`cleanValues`), and makes random values (`randomValues`: ranges favour the middle, colours come from one palette). Sizes are fractions of the box, so a result looks the same on any sheet. Shapes of one colour that cannot hide each other are one path of many sub-paths (`merged`), so a dot grid is one object; a result is held to 600 shapes.

**Where it goes** (`app/pattern.ts`): a picked sheet holds it; a picked closed shape stays as it is and a copy of it (without fill or outline) becomes a clipping mask sheet that holds the result, cutting it to the outline; with nothing picked a new sheet (3:2, about 60% of the view) is made in the middle of the view. The box is the bounds of the target's geometry in its own units; a rotated target is refused with a message.

**Live without a new preview mechanism:** the panel keeps the last step it made (`DocumentStore.lastTransaction`). While that is still the last step of the document, a change undoes it and commits the new result, so what is on the canvas is real, saved and drawn by the ordinary renderer, and the whole session is one undo step. If anything else was done meanwhile (or the person undid), the next result is a new one. *Done* (or hiding the panel) ends the session.

**The result remembers how it was made:** the first shape of the group carries `gen` ({ generator id, group id, seed, values }; `model.ts`, validated, saved, copied and duplicated with the group id renamed). Picking any shape of the group finds it (`foundPattern`), the panel loads the values, and a change replaces the group's shapes on their sheet, keeping the group id, its place among the groups that hold it and its place in the stack (the new shapes are spread over the z range the old ones had). The same undo-and-recommit step as a new result is used, so one session is one step.

**Picker and freezing:** the generators are a grid of small pictures (`ui/pattern-thumb.ts` runs each generator with its defaults into an inline SVG, one at a time after the panel is first shown). A snowflake on a setting keeps it when Randomize runs (per generator, for the session).

**As a package:** like the colour picker, `src/gen` is meant to be used outside canvast. It imports nothing from the app (the few shared shapes, a sub-path, a paint and the node helpers, are written out in `gen/core.ts`; the app's own types accept them as they are) and touches no page; `scripts/check-patterns.mjs` fails otherwise. `toSvg` writes the shapes as a standalone SVG (the thumbnails of the panel use it too). `scripts/build-patterns.mjs` writes `dist-patterns/`: a script (`CanvastPatterns`), an ES module, declarations and a demo page. Not published to npm yet: the files are here, to be published with the colour picker; `package.json` stays `private`.

**Saving:** what is saved to the library from the canvas has a folder and tags of its own for each kind, all settings (`export.*`, `pattern.*`, `svg.*`; screenshots, extracted frames and edited pictures already had theirs). A save whose target holds an object that carries `gen` (a pattern made here) is a *pattern* (*Patterns*, `#pattern`), whether it is Export… or Save as SVG; other Export… pictures are *Exports* (`#export`); picked shapes saved as SVG are *Shapes* (`#shape`, filed nowhere before).

## Not done

Resizing the sheet does not remake the pattern (it scales like any content); no presets; no blending of several patterns beyond the ordinary blend modes of objects; a rotated target is refused.

## Tests

`tests/unit/pattern.test.ts` (every generator: sound shapes, determinism, random and extreme values in three box sizes, other seed other shapes, hidden background, bad values), `tests/e2e/pattern.spec.ts` (new sheet, live replacement, hiding the background, one undo step; picked sheet; picked shape; Randomize and Done).
