import { voronoi } from "./fields";
import { regular } from "./geom";
import type { P } from "./geom";
import { ALIGN, AXIS, BY, FLIPS, PHI, RAD, arc, family, fitted, guide, marks } from "./guide-kit";
import { Ch, R, T, when } from "./kit";

/** More guides, in the families of `guides.ts`; each says only where its lines go. */

const SILVER = 1 + Math.SQRT2;
const hex = (v: number): string => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
const hsl = (h: number, s: number, l: number): string => {
  const f = (k: number): number => { const a = (k + h / 30) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(a - 3, 9 - a, 1)); };
  return `#${hex(f(0) * 255)}${hex(f(8) * 255)}${hex(f(4) * 255)}`;
};

// ---- Proportion ----------------------------------------------------------

const silverRatio = guide("silver-ratio", "Silver Ratio", "Proportion", "Lines that split the box by the silver ratio, 1 to 2.414", [AXIS, R("silver", "Levels", 1, 4, 1), ...FLIPS], (p, { n, s }) => {
  const out: [number, boolean][] = [];
  const split = (lo: number, hi: number, d: number): void => {
    const [a, b] = [lo + (hi - lo) / (1 + SILVER), hi - (hi - lo) / (1 + SILVER)];
    out.push([a, d === n("silver")], [b, d === n("silver")]);
    if (d > 1) for (const [l, h] of [[lo, a], [a, b], [b, hi]] as const) split(l, h, d - 1);
  };
  split(0, 1, n("silver"));
  marks(p, s("axis"), out);
});

const PAPERS: Record<string, number> = { iso: Math.SQRT2, letter: 11 / 8.5, legal: 14 / 8.5, tabloid: 17 / 11 };
const paperSizes = guide("paper-sizes", "Paper Sizes", "Proportion", "A sheet halved again and again, as A4 is from A3", [Ch("paperKind", "Paper", [["iso", "A series"], ["letter", "Letter"], ["legal", "Legal"], ["tabloid", "Tabloid"]], "iso"), R("paper", "Halvings", 1, 8, 5), ALIGN, ...FLIPS], (p, { n, s }) => {
  const ratio = PAPERS[s("paperKind")]!, box = fitted(p, p.w >= p.h ? ratio : 1 / ratio, s("align"));
  let [x, y, w, h] = [box.x, box.y, box.w, box.h];
  p.rect(x, y, w, h, true);
  for (let i = 0; i < n("paper"); i++) {
    if (w >= h) { p.line(x + w / 2, y, x + w / 2, y + h, i === 0); w /= 2; }
    else { p.line(x, y + h / 2, x + w, y + h / 2, i === 0); h /= 2; }
  }
}, { frame: false });

const FRAMES: readonly (readonly [string, string, number])[] = [["r16x9", "16:9", 16 / 9], ["r4x3", "4:3", 4 / 3], ["r1x1", "1:1", 1], ["r9x16", "9:16", 9 / 16], ["r3x2", "3:2", 3 / 2], ["r21x9", "21:9", 21 / 9]];
const aspectFrames = guide("aspect-frames", "Aspect Ratio Frames", "Proportion", "The common frame shapes together in one place", [...FRAMES.map(([k, label], i) => T(k, label, i < 4)), ALIGN], (p, { s, b }) => {
  for (const [k, , ratio] of FRAMES) if (b(k)) {
    const f = fitted(p, ratio, s("align"));
    p.rect(f.x, f.y, f.w, f.h, ratio === 16 / 9);
  }
});

// ---- Composition ---------------------------------------------------------

const goldenTriangles = guide("golden-triangles", "Golden Triangles", "Composition", "A diagonal, and a line from each other corner that meets it square", [Ch("way", "Diagonal", [["down", "Falling"], ["up", "Rising"], ["both", "Both"]], "down")], (p, { s }) => {
  const draw = (ax: number, ay: number, cx: number, cy: number, others: readonly P[]): void => {
    p.line(ax, ay, cx, cy, true);
    const [dx, dy] = [cx - ax, cy - ay], len = dx * dx + dy * dy;
    for (const [ox, oy] of others) {
      const t = ((ox - ax) * dx + (oy - ay) * dy) / len;
      p.line(ox, oy, ax + t * dx, ay + t * dy);
    }
  };
  if (s("way") !== "up") draw(p.x0, p.y0, p.x1, p.y1, [[p.x1, p.y0], [p.x0, p.y1]]);
  if (s("way") !== "down") draw(p.x0, p.y1, p.x1, p.y0, [[p.x0, p.y0], [p.x1, p.y1]]);
});

const ruleOfOdds = guide("rule-of-odds", "Rule of Odds", "Composition", "An odd number of focal points, placed evenly", [Ch("odd", "Points", [["3", "3"], ["5", "5"], ["7", "7"], ["9", "9"]], "3"), Ch("arrange", "Layout", [["row", "Row"], ["arc", "Arc"], ["ring", "Ring"]], "arc"), R("dot", "Point size", 1, 20, 5), T("links", "Lines between", true)], (p, { n, s, b }) => {
  const k = Number(s("odd")), r = (n("dot") / 100) * Math.min(p.w, p.h), kind = s("arrange");
  const pts = Array.from({ length: k }, (_, i): P => {
    if (kind === "row") return [p.x0 + ((i + 1) / (k + 1)) * p.w, p.cy];
    const a = kind === "ring" ? (i / k) * Math.PI * 2 - Math.PI / 2 : Math.PI + ((i + 0.5) / k) * Math.PI;
    return [p.cx + Math.cos(a) * p.w * 0.36, p.cy + (kind === "arc" ? 0.2 * p.h : 0) + Math.sin(a) * p.h * 0.36];
  });
  for (const [x, y] of pts) p.circle(x, y, r, true);
  if (b("links")) p.poly(pts, kind === "ring");
});

const leadingLines = guide("leading-lines", "Leading Lines", "Composition", "Lines that lead the eye to one point of your own", [R("focusX", "Point across", 0, 100, 62), R("focusY", "Point down", 0, 100, 38), R("count5", "Lines", 1, 48, 12), R("startAt", "Start angle", 0, 360, 15), R("dot", "Point size", 0, 20, 3)], (p, { n }) => {
  const [x, y] = [p.x0 + (n("focusX") / 100) * p.w, p.y0 + (n("focusY") / 100) * p.h], k = n("count5");
  for (let i = 0; i < k; i++) {
    const a = (n("startAt") + (i * 360) / k) * RAD, [dx, dy] = [Math.cos(a), Math.sin(a)];
    const t = Math.min(...[dx > 0 ? (p.x1 - x) / dx : dx < 0 ? (p.x0 - x) / dx : Infinity, dy > 0 ? (p.y1 - y) / dy : dy < 0 ? (p.y0 - y) / dy : Infinity]);
    if (t > 0) p.line(x, y, x + dx * t, y + dy * t);
  }
  if (n("dot")) p.circle(x, y, (n("dot") / 100) * Math.min(p.w, p.h), true);
});

const weightQuadrants = guide("weight-quadrants", "Visual Weight Quadrants", "Composition", "Quadrants round a balance point, to weigh a composition", [R("balanceX", "Balance across", 0, 100, 50), R("balanceY", "Balance down", 0, 100, 50), T("diagonals", "Diagonals", false), T("centre", "True centre", true)], (p, { n, b }) => {
  const [x, y] = [p.x0 + (n("balanceX") / 100) * p.w, p.y0 + (n("balanceY") / 100) * p.h];
  p.line(x, p.y0, x, p.y1, true);
  p.line(p.x0, y, p.x1, y, true);
  if (b("centre")) {
    p.line(p.cx, p.y0, p.cx, p.y1);
    p.line(p.x0, p.cy, p.x1, p.cy);
  }
  if (b("diagonals")) {
    p.line(p.x0, p.y0, p.x1, p.y1);
    p.line(p.x1, p.y0, p.x0, p.y1);
  }
});

// ---- Layout --------------------------------------------------------------

const manuscriptGrid = guide("manuscript-grid", "Manuscript Grid", "Layout", "One text block on a page, its margins, a header and a footer", [Ch("pages", "Pages", [["single", "Single"], ["spread", "Spread"]], "single"), R("top", "Top", 0, 40, 12), R("bottom", "Bottom", 0, 40, 16), R("innerM", "Inside", 0, 40, 10), R("outerM", "Outside", 0, 40, 14), T("header", "Header", true), T("footer", "Footer", true), T("bands", "Filled", true)], (p, { n, s, b }) => {
  const spread = s("pages") === "spread", page = spread ? p.w / 2 : p.w;
  const block = (x: number, mirrored: boolean): void => {
    const bx = x + (page * n(mirrored ? "outerM" : "innerM")) / 100, by = p.y0 + (p.h * n("top")) / 100, bw = page * (1 - (n("innerM") + n("outerM")) / 100), bh = p.h * (1 - (n("top") + n("bottom")) / 100);
    if (b("bands")) p.band(bx, by, bw, bh);
    p.rect(bx, by, bw, bh, true);
    if (b("header")) p.line(bx, (p.y0 + by) / 2, bx + bw, (p.y0 + by) / 2);
    if (b("footer")) p.line(bx, (by + bh + p.y1) / 2, bx + bw, (by + bh + p.y1) / 2);
  };
  block(p.x0, spread);
  if (spread) {
    block(p.x0 + page, false);
    p.line(p.x0 + page, p.y0, p.x0 + page, p.y1);
  }
});

const hierarchicalGrid = guide("hierarchical-grid", "Hierarchical Grid", "Layout", "Unequal columns or rows, in sizes of your own", [Ch("axis2", "Parts", [["x", "Columns"], ["y", "Rows"]], "x"), ...[3, 1, 2, 1, 0, 0].map((d, i) => R(`c${i + 1}`, `Part ${i + 1}`, 0, 12, d)), R("gutter", "Gutter", 0, 90, 8), T("bands", "Filled", true)], (p, { n, s, b }) => {
  const across = s("axis2") === "x", size = across ? p.w : p.h, found = [1, 2, 3, 4, 5, 6].map((i) => n(`c${i}`)).filter((x) => x > 0), sizes = found.length ? found : [1];
  const all = sizes.reduce((a, c) => a + c, 0), g = (size / sizes.length) * (n("gutter") / 100), room = size - (sizes.length - 1) * g;
  let at = 0;
  for (const c of sizes) {
    const len = (room * c) / all;
    const [x, y, w, h] = across ? [p.x0 + at, p.y0, len, p.h] : [p.x0, p.y0 + at, p.w, len];
    if (b("bands")) p.band(x, y, w, h);
    p.rect(x, y, w, h);
    at += len + g;
  }
}, { frame: false });

const bentoGrid = guide("bento-grid", "Bento Grid", "Layout", "Blocks of mixed sizes; a new seed gives a new layout", [R("bentoLevels", "Splits", 1, 6, 3), R("gapSize", "Gap", 0, 60, 12), R("even", "Evenness", 0, 100, 50), T("bands", "Filled", true)], (p, { n, b }, rng) => {
  const g = (Math.min(p.w, p.h) / 1000) * n("gapSize"), wobble = (1 - n("even") / 100) * 0.3;
  const place = (x: number, y: number, w: number, h: number, d: number): void => {
    if (d <= 0 || (d < n("bentoLevels") && rng() < 0.2)) {
      if (b("bands")) p.band(x, y, w, h);
      p.rect(x, y, w, h);
      return;
    }
    const f = 0.5 + (rng() - 0.5) * 2 * wobble;
    if (w >= h) { place(x, y, w * f - g / 2, h, d - 1); place(x + w * f + g / 2, y, w * (1 - f) - g / 2, h, d - 1); }
    else { place(x, y, w, h * f - g / 2, d - 1); place(x, y + h * f + g / 2, w, h * (1 - f) - g / 2, d - 1); }
  };
  place(p.x0, p.y0, p.w, p.h, n("bentoLevels"));
}, { frame: false });

/** Width to height, and what a device's own interface takes at the top and the bottom, in hundredths of its height. These are typical values, not any maker's. */
const DEVICES: Record<string, readonly [number, number, number]> = { phone: [9 / 19.5, 6, 4], tablet: [3 / 4, 3, 2], laptop: [16 / 10, 4, 0], desktop: [16 / 9, 4, 0], story: [9 / 16, 14, 20], post: [1, 0, 0], banner: [3, 0, 0] };
const deviceFrames = guide("device-frames", "Device Frames", "Layout", "A screen or a social format, with typical safe areas", [Ch("device", "Format", [["phone", "Phone"], ["tablet", "Tablet"], ["laptop", "Laptop"], ["desktop", "Desktop"], ["story", "Story"], ["post", "Post"], ["banner", "Banner"]], "phone"), T("landscape", "On its side", false), R("sideSafe", "Side safe", 0, 25, 4), T("safe", "Safe area", true), ALIGN], (p, { n, s, b }) => {
  const [ratio, top, bottom] = DEVICES[s("device")]!, side = b("landscape");
  const f = fitted(p, side ? 1 / ratio : ratio, s("align"));
  p.rect(f.x, f.y, f.w, f.h, true);
  if (!b("safe")) return;
  const [t, u, l, r] = side ? [n("sideSafe"), n("sideSafe"), top, bottom] : [top, bottom, n("sideSafe"), n("sideSafe")];
  p.rect(f.x + (f.w * l) / 100, f.y + (f.h * t) / 100, f.w * (1 - (l + r) / 100), f.h * (1 - (t + u) / 100));
}, { frame: false });

// ---- Perspective ---------------------------------------------------------

const obliqueGrid = guide("oblique-grid", "Cabinet and Cavalier", "Perspective", "Oblique drawing: a front face true to size, depth going back at an angle", [Ch("depthKind", "Kind", [["cabinet", "Cabinet"], ["cavalier", "Cavalier"]], "cabinet"), R("tilt", "Angle", 5, 85, 45), BY, when("by", ["count"], R("cols", "Across", 2, 60, 12)), when("by", ["size"], R("size", "Cell size", 4, 200, 48)), R("every", "Strong every", 0, 12, 0)], (p, { n, s }) => {
  const gap = s("by") === "size" ? Math.max(n("size"), p.w / 1000) : p.w / n("cols");
  // (cavalier keeps depth true to size, cabinet halves it)
  const depth = (s("depthKind") === "cabinet" ? 0.5 : 1) * gap * Math.sin(n("tilt") * RAD);
  family(p, 90, gap, n("every"));
  family(p, 0, depth, n("every"));
  family(p, -n("tilt"), gap * Math.sin(n("tilt") * RAD), n("every"));
});

const curvilinear = guide("curvilinear", "Curvilinear Perspective", "Perspective", "Four or five points: lines curving to the sides, the top and the bottom", [Ch("points", "Points", [["4", "4"], ["5", "5"]], "5"), R("curves", "Curves", 1, 32, 6), when("points", ["5"], R("rays", "Lines to the middle", 1, 96, 16))], (p, { n, s }) => {
  const [hw, hh] = [p.w / 2, p.h / 2], k = n("curves"), STEPS = 48;
  p.line(p.x0, p.cy, p.x1, p.cy, true);
  p.line(p.cx, p.y0, p.cx, p.y1, true);
  for (let i = 1; i <= k; i++) for (const sign of [-1, 1]) {
    const t = (sign * i) / k;
    p.curve(Array.from({ length: STEPS + 1 }, (_, j): P => { const u = -1 + (2 * j) / STEPS; return [p.cx + u * hw, p.cy + t * hh * Math.sqrt(1 - u * u)]; }));
    p.curve(Array.from({ length: STEPS + 1 }, (_, j): P => { const u = -1 + (2 * j) / STEPS; return [p.cx + t * hw * Math.sqrt(1 - u * u), p.cy + u * hh]; }));
  }
  if (s("points") === "5") for (let i = 0; i < n("rays"); i++) { const a = (i / n("rays")) * Math.PI * 2; p.ray(p.cx, p.cy, Math.cos(a), Math.sin(a)); }
}, { frame: false });

const groundPlane = guide("ground-plane", "Ground Plane", "Perspective", "A floor of squares going back to the horizon", [R("horizon", "Horizon", 0, 95, 35), R("x1", "Point across", -100, 200, 50), R("rays", "Lines across", 2, 64, 16), R("rows", "Rows", 1, 64, 12), R("spread", "Rows bunch", 0, 100, 60)], (p, { n }) => {
  const y = p.y0 + (n("horizon") / 100) * p.h, vx = p.x0 + (n("x1") / 100) * p.w, deep = p.y1 - y, wide = Math.max(p.w, deep) * 3;
  p.line(p.x0, y, p.x1, y, true);
  for (let i = 0; i <= n("rays"); i++) { const tx = p.x0 + p.w / 2 - wide / 2 + (i / n("rays")) * wide; p.line(vx, y, tx, p.y1); } // (from the point down: nothing goes above the horizon)
  // Rows at equal steps of a floor going back: nearer ones farther apart, the more the more they bunch.
  const b = 1 + (n("spread") / 100) * 9;
  for (let i = 1; i <= n("rows"); i++) { const f = (i / n("rows")); p.line(p.x0, y + deep * (f / (1 + (b - 1) * (1 - f))), p.x1, y + deep * (f / (1 + (b - 1) * (1 - f)))); }
}, { frame: false });

const cubeLattice = guide("cube-lattice", "Cube Lattice", "Perspective", "Stacked isometric cubes, for blocking out in 3D", [BY, when("by", ["count"], R("cols", "Across", 2, 60, 10)), when("by", ["size"], R("size", "Cell size", 4, 200, 48)), R("tilt", "Tilt", 5, 60, 30), T("bands", "Tops filled", true)], (p, { n, s, b, c }) => {
  const dx = s("by") === "size" ? Math.max(n("size"), p.w / 150) : p.w / n("cols") / 2, rise = dx * Math.tan(n("tilt") * RAD), edge = 2 * rise;
  const [cols, rows] = [Math.ceil(p.w / (2 * dx)) + 1, Math.ceil(p.h / (edge + rise)) + 1];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const x = p.x0 + i * 2 * dx + (j % 2 ? dx : 0), y = p.y0 + j * (edge + rise);
    // The top's four corners, then the two sides hanging from it.
    const [n0, e0, s0, w0]: readonly P[] = [[x, y - rise], [x + dx, y], [x, y + rise], [x - dx, y]];
    if (b("bands")) p.fill([n0!, e0!, s0!, w0!], `${c("line")}22`);
    p.poly([n0!, e0!, s0!, w0!]);
    p.poly([w0!, [w0![0], w0![1] + edge], [s0![0], s0![1] + edge], [e0![0], e0![1] + edge], e0!], false);
    p.line(s0![0], s0![1], s0![0], s0![1] + edge);
  }
}, { frame: false });

// ---- Geometry ------------------------------------------------------------

const rhombusGrid = guide("rhombus-grid", "Rhombus Grid", "Geometry", "A lattice of diamonds at an angle of your own", [BY, when("by", ["count"], R("cols", "Across", 2, 60, 12)), when("by", ["size"], R("size", "Cell size", 4, 200, 48)), R("tilt", "Tilt", 5, 85, 45), R("every", "Strong every", 0, 12, 0)], (p, { n, s }) => {
  const gap = (s("by") === "size" ? Math.max(n("size"), p.w / 1000) : p.w / n("cols")) * Math.sin(n("tilt") * RAD);
  family(p, n("tilt"), gap, n("every"));
  family(p, -n("tilt"), gap, n("every"));
}, { frame: false });

const islamicStars = guide("islamic-stars", "Islamic Star Grid", "Geometry", "The construction of repeating star patterns, a star in each cell", [BY, when("by", ["count"], R("cols", "Across", 1, 24, 4)), when("by", ["size"], R("size", "Cell size", 8, 400, 120)), R("points", "Points", 4, 16, 8), R("skip", "Skip", 1, 7, 3), T("circles", "Circles", true), T("cells", "Cells", true)], (p, { n, s, b }) => {
  const c = s("by") === "size" ? Math.max(n("size"), p.w / 60) : p.w / n("cols"), k = n("points"), skip = Math.min(n("skip"), Math.max(1, Math.floor((k - 1) / 2)));
  const [cols, rows] = [Math.ceil(p.w / c), Math.ceil(p.h / c)];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const [x, y] = [p.x0 + (i + 0.5) * c, p.y0 + (j + 0.5) * c], pts = regular(x, y, c / 2, k, -Math.PI / 2);
    if (b("cells")) p.rect(x - c / 2, y - c / 2, c, c);
    if (b("circles")) p.circle(x, y, c / 2);
    for (let v = 0; v < k; v++) { const [a, e] = [pts[v]!, pts[(v + skip) % k]!]; p.line(a[0], a[1], e[0], e[1], true); }
  }
}, { frame: false });

const penrose = guide("penrose", "Penrose Tiling", "Geometry", "A tiling of two rhombi that never repeats", [R("penrose", "Levels", 1, 6, 4), R("scale2", "Size", 50, 400, 100), R("startAt", "Turn", 0, 36, 0)], (p, { n }) => {
  // The rhombi as pairs of triangles, each cut into smaller ones by the golden ratio.
  type Tri = [0 | 1, P, P, P];
  const reach = (Math.hypot(p.w, p.h) / 2) * (n("scale2") / 100), turn = n("startAt") * RAD;
  const on = (a: number): P => [p.cx + reach * Math.cos(a + turn), p.cy + reach * Math.sin(a + turn)];
  const mid = (a: P, c: P): P => [a[0] + (c[0] - a[0]) / PHI, a[1] + (c[1] - a[1]) / PHI];
  let tris: Tri[] = Array.from({ length: 10 }, (_, i): Tri => {
    const [b0, c0] = [on(((2 * i - 1) * Math.PI) / 10), on(((2 * i + 1) * Math.PI) / 10)];
    return i % 2 ? [0, [p.cx, p.cy], b0, c0] : [0, [p.cx, p.cy], c0, b0];
  });
  for (let d = 0; d < n("penrose"); d++) tris = tris.flatMap(([kind, a, b0, c0]): Tri[] => {
    if (kind === 0) {
      const q = mid(a, b0);
      return [[0, c0, q, b0], [1, q, c0, a]];
    }
    const [q, r] = [mid(b0, a), mid(b0, c0)];
    return [[1, r, c0, a], [1, q, r, b0], [0, r, q, a]];
  });
  for (const [, a, b0, c0] of tris) {
    p.line(c0[0], c0[1], a[0], a[1]);
    p.line(a[0], a[1], b0[0], b0[1]);
  }
}, { frame: false });

const voronoiGuide = guide("voronoi-guide", "Voronoi Guide", "Geometry", "Cells round points; a new seed gives new cells", [R("count5", "Cells", 2, 120, 24), R("evenness", "Evenness", 0, 4, 2), T("seeds", "Centres", false)], (p, { n, b }, rng) => {
  for (const c of voronoi(rng, n("count5"), n("evenness"), p.w, p.h)) {
    const pts = c.map(([x, y]): P => [p.x0 + x, p.y0 + y]);
    p.poly(pts);
    if (b("seeds") && pts.length) p.circle(pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length, Math.min(p.w, p.h) / 200, true);
  }
});

const concentricPolygons = guide("concentric-polygons", "Concentric Polygons", "Geometry", "Polygons one inside another, even or shrinking, and turned if you like", [R("sides", "Sides", 3, 16, 6), R("rings", "Polygons", 1, 40, 8), R("twist", "Twist", -60, 60, 0), Ch("spacing", "Spacing", [["even", "Even"], ["shrink", "Shrinking"]], "even"), T("spokes", "Corners joined", false)], (p, { n, s, b }) => {
  const rim = Math.min(p.w, p.h) / 2, k = n("rings"), sides = n("sides");
  for (let i = 1; i <= k; i++) {
    const r = s("spacing") === "even" ? (rim * i) / k : rim * Math.pow(0.8, k - i);
    p.poly(regular(p.cx, p.cy, r, sides, -Math.PI / 2 + (k - i) * n("twist") * RAD), true, i === k);
  }
  if (b("spokes")) for (const [x, y] of regular(p.cx, p.cy, rim, sides, -Math.PI / 2)) p.line(p.cx, p.cy, x, y);
}, { frame: false });

const gcd = (a: number, c: number): number => (c ? gcd(c, a % c) : a);
const spirograph = guide("spirograph", "Spirograph Construction", "Geometry", "A wheel rolling inside a ring, its path and how it was made", [R("outer", "Ring", 3, 120, 72), R("inner", "Wheel", 1, 100, 45), R("reachOut", "Pen on the wheel", 0, 150, 80), T("wheels", "Ring and wheel shown", true)], (p, { n, b }) => {
  const R0 = n("outer"), r0 = Math.max(1, Math.min(n("inner"), R0 - 1)), d0 = (n("reachOut") / 100) * r0;
  const scale = (Math.min(p.w, p.h) / 2) / Math.max(R0, R0 - r0 + d0);
  const turns = r0 / gcd(R0, r0), STEPS = Math.min(20_000, Math.ceil(turns * 96));
  p.curve(Array.from({ length: STEPS + 1 }, (_, i): P => {
    const t = (i / STEPS) * turns * Math.PI * 2;
    return [p.cx + scale * ((R0 - r0) * Math.cos(t) + d0 * Math.cos(((R0 - r0) / r0) * t)), p.cy + scale * ((R0 - r0) * Math.sin(t) - d0 * Math.sin(((R0 - r0) / r0) * t))];
  }), true);
  if (b("wheels")) {
    p.circle(p.cx, p.cy, R0 * scale);
    p.circle(p.cx + (R0 - r0) * scale, p.cy, r0 * scale);
  }
}, { frame: false });

// ---- Art study -----------------------------------------------------------

const isoPixelGrid = guide("iso-pixel-grid", "Isometric Pixel Grid", "Art study", "The 2:1 lattice of isometric pixel art, by an exact tile", [R("size", "Tile width", 4, 200, 32), R("every", "Strong every", 0, 64, 4), T("uprights", "Upright lines", false)], (p, { n, b }) => {
  const dx = Math.max(n("size"), p.w / 400) / 2, along = 2 * dx * Math.sin(Math.atan2(1, 2)); // (the gap between lines of slope 1:2, a tile apart)
  family(p, Math.atan2(1, 2) / RAD, along, n("every"));
  family(p, -Math.atan2(1, 2) / RAD, along, n("every"));
  if (b("uprights")) family(p, 90, dx, n("every"));
}, { frame: false, readout: (v) => { const size = v["size"] as number; return `tile ${size} × ${size / 2}`; } });

const tileSheet = guide("tile-sheet", "Tile and Sprite Sheet", "Art study", "Fixed cells with padding between them, for game art", [R("cellW", "Cell width", 4, 400, 64), R("cellH", "Cell height", 4, 400, 64), R("pad", "Padding", 0, 64, 4), T("bands", "Filled", true), T("cross", "Cell centres", false)], (p, { n, b }) => {
  const pad = n("pad"), [cw, ch] = [Math.min(p.w, Math.max(n("cellW"), p.w / 200)), Math.min(p.h, Math.max(n("cellH"), p.h / 200))];
  const [cols, rows] = [Math.max(1, Math.floor((p.w + pad) / (cw + pad))), Math.max(1, Math.floor((p.h + pad) / (ch + pad)))];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const [x, y] = [p.x0 + i * (cw + pad), p.y0 + j * (ch + pad)];
    if (b("bands")) p.band(x, y, cw, ch);
    p.rect(x, y, cw, ch);
    if (b("cross")) {
      p.line(x + cw / 2 - cw / 8, y + ch / 2, x + cw / 2 + cw / 8, y + ch / 2, true);
      p.line(x + cw / 2, y + ch / 2 - ch / 8, x + cw / 2, y + ch / 2 + ch / 8, true);
    }
  }
}, { frame: false, readout: (v, w, h) => { const q = (k: string): number => v[k] as number; return `${Math.max(1, Math.floor((w + q("pad")) / (q("cellW") + q("pad"))))} across, ${Math.max(1, Math.floor((h + q("pad")) / (q("cellH") + q("pad"))))} down`; } });

const storyboard = guide("storyboard", "Storyboard Frames", "Art study", "Rows of frames with lines for notes under each", [R("cols", "Across", 1, 12, 3), R("rows", "Rows", 1, 12, 2), Ch("ratio", "Frame", [["1.778", "16:9"], ["2.39", "2.39"], ["1.333", "4:3"], ["1", "1:1"], ["0.5625", "9:16"]], "1.778"), R("notes", "Note lines", 0, 8, 2), R("gutter", "Gutter", 0, 60, 16), T("bands", "Filled", true)], (p, { n, s, b }) => {
  const g = (Math.min(p.w, p.h) / 1000) * n("gutter"), [cols, rows] = [n("cols"), n("rows")], ratio = Number(s("ratio"));
  const [cw, ch] = [(p.w - (cols - 1) * g) / cols, (p.h - (rows - 1) * g) / rows];
  const room = 1 + 0.14 * n("notes"), fw = Math.min(cw, (ch * ratio) / room), fh = fw / ratio;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const [x, y] = [p.x0 + i * (cw + g) + (cw - fw) / 2, p.y0 + j * (ch + g)];
    if (b("bands")) p.band(x, y, fw, fh);
    p.rect(x, y, fw, fh, true);
    for (let l = 1; l <= n("notes"); l++) p.line(x, y + fh + l * 0.14 * fh, x + fw, y + fh + l * 0.14 * fh);
  }
}, { frame: false });

const valueScale = guide("value-scale", "Value Scale", "Art study", "Steps from dark to light, to study values against", [R("valueSteps", "Steps", 2, 32, 9), Ch("along", "Direction", [["across", "Across"], ["down", "Down"]], "across"), T("reversed", "Light first", false), T("separators", "Lines between", true)], (p, { n, s, b }) => {
  const k = n("valueSteps"), across = s("along") === "across";
  for (let i = 0; i < k; i++) {
    const v = hex(((b("reversed") ? k - 1 - i : i) / (k - 1)) * 255), [fa, fb] = [i / k, (i + 1) / k];
    const [x0, y0, x1, y1] = across ? [p.x0 + fa * p.w, p.y0, p.x0 + fb * p.w, p.y1] : [p.x0, p.y0 + fa * p.h, p.x1, p.y0 + fb * p.h];
    p.fill([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], `#${v}${v}${v}`);
    if (b("separators") && i) across ? p.line(x0, p.y0, x0, p.y1) : p.line(p.x0, y0, p.x1, y0);
  }
});

const HARMONY: Record<string, readonly number[]> = { none: [], complement: [0, 180], split: [0, 150, 210], triad: [0, 120, 240], square: [0, 90, 180, 270], analogous: [-30, 0, 30] };
const colourWheel = guide("colour-wheel", "Color Wheel", "Art study", "Hues round a wheel, with the lines of a colour harmony", [R("segments", "Hues", 3, 72, 12), R("wheelRings", "Rings", 1, 6, 3), Ch("harmony", "Harmony", [["none", "None"], ["complement", "Complement"], ["split", "Split"], ["triad", "Triad"], ["square", "Square"], ["analogous", "Analogous"]], "triad"), R("hue", "Start hue", 0, 360, 0), T("wheel", "Colours shown", true)], (p, { n, s, b }) => {
  const k = n("segments"), rim = Math.min(p.w, p.h) / 2, rings = n("wheelRings");
  if (b("wheel")) for (let i = 0; i < k; i++) for (let j = 0; j < rings; j++) {
    const [a0, a1] = [(i / k) * Math.PI * 2 - Math.PI / 2, ((i + 1) / k) * Math.PI * 2 - Math.PI / 2], [r0, r1] = [(j / rings) * rim, ((j + 1) / rings) * rim];
    p.fill([...arc(p.cx, p.cy, r1, a0, a1, 6), ...arc(p.cx, p.cy, r0, a1, a0, 6)], hsl((i / k) * 360, 0.85, 0.3 + (0.5 * (rings - j)) / (rings + 1)));
  }
  const at = HARMONY[s("harmony")]!, pts = at.map((d): P => { const a = ((n("hue") + d) * Math.PI) / 180 - Math.PI / 2; return [p.cx + Math.cos(a) * rim, p.cy + Math.sin(a) * rim]; });
  if (pts.length > 1) p.poly(pts, pts.length > 2 && s("harmony") !== "analogous", true);
  p.circle(p.cx, p.cy, rim);
}, { frame: false });


export const MORE_GUIDES = {
  proportion: [silverRatio, paperSizes, aspectFrames],
  composition: [goldenTriangles, ruleOfOdds, leadingLines, weightQuadrants],
  layout: [manuscriptGrid, hierarchicalGrid, bentoGrid, deviceFrames],
  perspective: [obliqueGrid, curvilinear, groundPlane, cubeLattice],
  geometry: [rhombusGrid, islamicStars, penrose, voronoiGuide, concentricPolygons, spirograph],
  art: [isoPixelGrid, tileSheet, storyboard, valueScale, colourWheel],
};
