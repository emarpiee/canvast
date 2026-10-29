# gen (pattern generators)

Vector pattern generators for the web, with no dependencies and no link to the app they were made in (canvast). A generator is a pure function: the same settings and the same seed always give the same shapes. It makes plain vector shapes (Bézier paths with a fill and an outline, gradients included), and `toSvg` writes them as a standalone SVG. It runs anywhere JavaScript runs: a browser, a worker, Node, a server. It is small (about 36 KiB minified for all 39 generators), touches no page, and works from `file://`.

* **39 generators** in six families (below), each with settings of its own that it declares as data: ranges, choices, switches and colours, in titled sections. A form can be built from them without knowing the generator (the demo page does).
* **A seed** for repeatable results (a regular pattern is exact until its *Looseness* is raised, and only then does the seed move things about), and **random settings** (`randomValues`) that stay inside the middle of each range, with colours that go together.
* **Sizes are fractions of the box**, so a result looks the same at any size and ratio.
* **Held to what is valid:** `cleanValues` holds every value to its range, choice or colour, so any stored or typed settings are safe to pass in. A result is at most 600 shapes (`MAX_SHAPES`), and several shapes of one colour are one path.

## Use

```ts
import { GENERATORS, defaultValues, generate, randomValues, makeRng, toSvg } from "./gen";

const tides = GENERATORS.find((g) => g.id === "tides")!;

// the defaults, seed 7, in a box 900 wide and 600 high
const svg = toSvg(generate(tides, defaultValues(tides), 7, 900, 600), 900, 600);
document.body.insertAdjacentHTML("beforeend", svg);

// random settings (the seed is also what makes them): keep what you want, change what you like
const values = { ...randomValues(tides, makeRng(1234)), layers: 8 };
const again = toSvg(generate(tides, values, 1234, 900, 600), 900, 600, { width: "100%" });
```

A form from the settings (what `demo.html` does):

```ts
import { sectionsOf } from "./gen";

for (const section of sectionsOf(tides)) {          // { title, items }, the background colour first in "Colour"
  for (const s of section.items) {
    // s.t is "range" (min, max, step, def), "choice" (opts [value, label][], def), "toggle" (def) or "colour" (def; hide: "" means none)
  }
}
```

The shapes themselves, if you draw them yourself: `generate` returns `GenShape[]`, each `{ sub, fill, stroke, width, evenodd?, name? }`. A `sub` is `{ n, closed }` where `n` holds six numbers for each node, `[x, y, inX, inY, outX, outY]` (a handle equal to its point is no handle: a segment between two nodes without handles is a straight line, any other is the cubic Bézier `a.point, a.out, b.in, b.point`). A fill is a colour (`#rrggbb` or `#rrggbbaa`) or a gradient (`linear` or `radial`, positions as fractions of the shape's own box). `pathData(sub)` gives the SVG `d` of one sub-path.

Without a bundler: `npm run build:patterns` (in canvast) writes `dist-patterns/`:

| File | What it is |
| --- | --- |
| `canvast-patterns.js` | One script that defines a global `CanvastPatterns` (the same names as the module) |
| `canvast-patterns.mjs` | The same as an ES module |
| `types/` | TypeScript declarations (`index.d.ts`) |
| `demo.html` | A page with every generator, its settings, a seed, Randomize and Download SVG; opens from `file://` |

```html
<script src="canvast-patterns.js"></script>
<script>
  const P = CanvastPatterns, g = P.GENERATORS.find((x) => x.id === "glow");
  document.body.innerHTML = P.toSvg(P.generate(g, P.defaultValues(g), 3, 900, 600), 900, 600);
</script>
```

## API

| Name | What it does |
| --- | --- |
| `GENERATORS` | Every generator, in the order a picker shows them: `{ id, label, about, family, sections, run }` |
| `generate(g, values, seed, w, h)` | The shapes of a pattern `w` wide and `h` high: the background first (unless its colour is none), then what the generator makes. Values are cleaned first |
| `toSvg(shapes, w, h, options?)` | A standalone SVG: `viewBox`, `xmlns`, paths, gradients. Options: `width`, `height` (SVG lengths), `idPrefix` (for gradient ids, when several SVGs share a page), `fit` (`preserveAspectRatio`) |
| `pathData(sub)` | The `d` of an SVG path for one sub-path |
| `defaultValues(g)` | The default of every setting |
| `randomValues(g, rng)` | Random values for every setting (colours that go together) |
| `cleanValues(g, values)` | Every value held to its setting; anything missing or wrong becomes the default |
| `sectionsOf(g)`, `settingsOf(g)` | The settings in sections, or as one list |
| `generatorById(id)` | One generator, or `undefined` |
| `makeRng(seed)`, `makeNoise(seed)` | The seeded random source (`rng()`, `.range`, `.int`, `.pick`, `.chance`) and 2D value noise, for your own use |
| `MAX_SHAPES` | The most shapes one result holds (600) |

## The generators

| Family | Generators |
| --- | --- |
| Waves | Ripple (`ripple`): One wavy edge; Tides (`tides`): Wavy bands stacked from back to front; Dunes (`dunes`): Soft overlapping hills; Terraces (`terraces`): Stepped layers like stairs; Ridges (`ridges`): Mountain layers with peaks |
| Blobs | Pebble (`pebble`): One organic blob; Drift (`drift`): Many blobs placed at random; Bubbles (`bubbles`): Circles of different sizes; Shards (`shards`): Scattered polygons and triangles |
| Soft | Glow (`glow`): Soft clouds of colour; Blend (`blend`): A smooth blend of several colours; Grain (`grain`): Fine speckle, like film or paper; Aurora (`aurora`): Tall, soft curtains of light |
| Lines | Stripes (`stripes`): Parallel bands, straight or tilted; Chevrons (`chevrons`): Zigzag bands; Dots (`dots`): A grid of dots, regular or loose; Checks (`checks`): A checkerboard, straight or turned; Rings (`rings`): Concentric circles; Rays (`rays`): A sunburst from one point; Spiral (`spiral`): A spiral line; Orbits (`orbits`): Rings with dots travelling on them; Confetti (`confetti`): Small shapes thrown at random; Stars (`stars`): Scattered stars and sparkles; Grid (`grid`): Lines in a lattice with stronger lines now and then; Halftone (`halftone`): Dots that grow along a direction, like print; Strands (`strands`): Many fine wavy lines side by side |
| Tiles | Tiles (`tiles`): Hexagons, triangles or squares; Bricks (`bricks`): Offset rows of bricks; Scales (`scales`): Overlapping fish scales; Weave (`weave`): Bands woven over and under |
| Fields | Contours (`contours`): Map-like lines of equal height; Cells (`cells`): Irregular cells that fit together; Cracks (`cracks`): The seams between irregular cells; Facets (`triangulate`): A low-poly field of triangles; Flow (`flow`): Lines that follow a wind; Branches (`branches`): A tree or a bolt of lightning; Maze (`maze`): A random maze of walls; Ribbons (`ribbons`): Flowing swooshes across the sheet; Marble (`marble`): Flowing veins like polished stone |

## Files

| File | What it is |
| --- | --- |
| `index.ts` | The API above: the registry, `generate`, the value helpers |
| `types.ts` | `Generator`, `Setting`, `Section`, `GenShape`, `Values` |
| `core.ts` | The few shared shapes (sub-path, paint, node helpers, colour parser), written out so nothing is imported from outside this folder |
| `rng.ts`, `geom.ts`, `kit.ts` | Seeded random and noise, colour helpers; shape helpers (rectangle, ellipse, smooth curve, polygon); short builders for the settings |
| `svg.ts` | `toSvg`, `pathData` |
| `waves.ts`, `blobs.ts`, `soft.ts`, `lines.ts`, `tiles.ts`, `fields.ts`, `extra.ts` | The generators, a family each (`extra.ts` holds the later ones of several families) |

No file here may import from outside this folder or touch the page (`document`, `window`, ...): `npm run check:patterns` fails if one does, and it runs with `npm test`.

## Adding a generator

A generator is an object: `id`, `label`, `about`, `family`, `sections` (the settings, built with `R` range, `C` colour, `T` toggle and `Ch` choice from `kit.ts`; a section titled "Colour" gets the Background colour in front) and `run(values, rng, w, h)` returning shapes in a box that starts at (0, 0). Make everything relative to the box (`Math.min(w, h)`), draw random choices only from `rng` in a fixed order, and add it to the list of its file. `tests/unit/pattern.test.ts` then checks it with every other: sound numbers, the same output for the same seed, random and extreme settings in a wide, a tall and a tiny box.

Licence: the GNU GPL v3 or later, like canvast.
