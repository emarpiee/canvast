import { regular } from "./geom";
import type { P } from "./geom";
import { ALIGN, AXIS, BY, COLOURS, DASH, FLIPS, MARGINS, PHI, RAD, STRONG_WIDTH, WEIGHT, arc, family, fitted, frameSetting, guide, margins, marks, modules, pen, shares, wide } from "./guide-kit";
import type { Pen } from "./guide-kit";
import { MORE_GUIDES } from "./guides-more";
import { Ch, LOOSE, R, T, reader, steady, when } from "./kit";
import type { Generator, Values } from "./types";

/**
 * Guides: patterns for laying out and composing work rather than for looking at. Each is a generator like any other; it says where its lines
 * go, and the pen of `guide-kit.ts` draws them with the colours and the look every guide shares. The sizes are fractions of the box, but for
 * exact sizes (a cell, a column, a line height), which are in the box's own units.
 */

const centreItems = [R("centreX", "Centre across", 0, 100, 50), R("centreY", "Centre down", 0, 100, 50)];
const centreOf = (p: Pen, n: (k: string) => number): P => [p.x0 + (n("centreX") / 100) * p.w, p.y0 + (n("centreY") / 100) * p.h];
const farthest = (p: Pen, x: number, y: number): number => Math.max(...([[p.x0, p.y0], [p.x1, p.y0], [p.x0, p.y1], [p.x1, p.y1]] as const).map(([a, c]) => Math.hypot(a - x, c - y)));

// ---- Proportion ----------------------------------------------------------

export const goldenRatio = guide("golden-ratio", "Golden Ratio", "Proportion", "Lines that split the box by the golden ratio", [AXIS, Ch("from", "From", [["both", "Both"], ["start", "Start"], ["end", "End"]], "both"), R("depth", "Levels", 1, 5, 1), ...FLIPS], (p, { n, s }) => {
  const out: [number, boolean][] = [];
  const split = (lo: number, hi: number, d: number): void => {
    const [a, b] = [lo + (hi - lo) / (PHI * PHI), lo + (hi - lo) / PHI];
    // (From start: the long part first; from end: the long part last.)
    if (s("from") !== "end") out.push([b, d === n("depth")]);
    if (s("from") !== "start") out.push([a, d === n("depth")]);
    if (d > 1) {
      if (s("from") === "both") for (const [l, h] of [[lo, a], [a, b], [b, hi]] as const) split(l, h, d - 1);
      else if (s("from") === "start") { split(lo, b, d - 1); split(b, hi, d - 1); }
      else { split(lo, a, d - 1); split(a, hi, d - 1); }
    }
  };
  split(0, 1, n("depth"));
  marks(p, s("axis"), out);
});

export const goldenSpiral = guide("golden-spiral", "Golden Spiral", "Proportion", "Golden rectangles and the spiral through them", [Ch("fit", "Fit", [["golden", "Golden"], ["fill", "Fill box"]], "golden"), Ch("first", "First square", [["start", "Start"], ["end", "End"]], "start"), Ch("turn", "Turn", [["cw", "Clockwise"], ["ccw", "Counter"]], "cw"), Ch("rotate", "Rotate", [["0", "0°"], ["90", "90°"]], "0"), R("squares", "Squares", 2, 14, 8), T("showSquares", "Squares shown", true), T("showSpiral", "Spiral shown", true)], (p, { n, s, b }) => {
  const up = s("rotate") === "90", ratio = up ? 1 / PHI : PHI;
  const box = s("fit") === "fill" ? { x: p.x0, y: p.y0, w: p.w, h: p.h } : fitted(p, ratio);
  // The same spiral mirrored or laid on its side: which end it starts at and which way it turns. (Laying it on its side turns it the other way, so that is undone.)
  const fromEnd = s("first") === "end", ccw = (s("turn") === "ccw") !== up;
  const at = (x: number, y: number): P => {
    const [u, v] = [fromEnd ? PHI - x : x, ccw !== fromEnd ? 1 - y : y];
    return up ? [box.x + v * box.w, box.y + (u / PHI) * box.h] : [box.x + (u / PHI) * box.w, box.y + v * box.h];
  };
  let [x, y, w, h] = [0, 0, PHI, 1];
  const spiral: P[] = [];
  p.rect(box.x, box.y, box.w, box.h);
  for (let i = 0; i < n("squares"); i++) {
    const side = i % 2 ? w : h;
    // (each square is cut from the next side round; the spiral's quarter turn goes across it)
    const [sx, sy, ax, ay, from] = i % 4 === 0 ? [x, y, x + side, y + side, Math.PI] : i % 4 === 1 ? [x, y, x, y + side, -Math.PI / 2] : i % 4 === 2 ? [x + w - side, y, x + w - side, y, 0] : [x, y + h - side, x + w, y + h - side, Math.PI / 2];
    if (b("showSquares")) p.poly([at(sx, sy), at(sx + side, sy), at(sx + side, sy + side), at(sx, sy + side)]);
    spiral.push(...arc(ax, ay, side, from, from + Math.PI / 2, 8).slice(i ? 1 : 0).map(([u, v]) => at(u, v)));
    if (i % 4 === 0) { x += side; w -= side; }
    else if (i % 4 === 1) { y += side; h -= side; }
    else if (i % 4 === 2) w -= side;
    else h -= side;
  }
  if (b("showSpiral")) p.curve(spiral, true);
});

export const fibonacciGrid = guide("fibonacci-grid", "Fibonacci Grid", "Proportion", "Columns and rows sized 1, 1, 2, 3, 5, 8 and on", [AXIS, R("fib", "Steps", 2, 16, 7), T("mirror", "Mirrored", false), ...FLIPS], (p, { n, s, b }) => {
  const sizes = [1, 1];
  while (sizes.length < n("fib")) sizes.push(sizes[sizes.length - 1]! + sizes[sizes.length - 2]!);
  const all = sizes.slice(0, n("fib"));
  marks(p, s("axis"), shares(b("mirror") ? [...all, ...all.slice().reverse()] : all).map((f) => [f, false]));
});

export const rootRectangles = guide("root-rectangles", "Root Rectangles", "Proportion", "The √2, √3 and following rectangles, built from a square", [R("root", "Root", 2, 8, 2), Ch("along", "Direction", [["across", "Across"], ["down", "Down"]], "across"), ALIGN, T("diagonals", "Diagonals", true), T("arcs", "Arcs", true), ...FLIPS], (p, { n, s, b }) => {
  const root = Math.sqrt(n("root")), across = s("along") === "across", box = fitted(p, across ? root : 1 / root, s("align"));
  const side = across ? box.h : box.w;
  // (u along the rectangle from its square, v across it from the base)
  const at = (u: number, v: number): P => (across ? [box.x + u, box.y + side - v] : [box.x + v, box.y + box.h - u]);
  p.rect(box.x, box.y, box.w, box.h, true);
  for (let k = 1; k <= n("root"); k++) {
    const u = side * Math.sqrt(k);
    if (k < n("root")) p.poly([at(u, 0), at(u, side)], false, k === 1);
    if (b("diagonals")) p.poly([at(0, 0), at(u, side)], false);
    if (b("arcs") && k < n("root")) p.curve(arc(0, 0, side * Math.sqrt(k + 1), Math.atan2(1, Math.sqrt(k)), 0).map(([a, c]) => at(a, c)));
  }
});

export const modularScale = guide("modular-scale", "Modular Scale", "Proportion", "Lines that grow by one ratio from step to step", [AXIS, Ch("step", "Ratio", [["1.2", "1.2"], ["1.25", "1.25"], ["1.333", "1.33"], ["1.5", "1.5"], ["1.618", "1.62"], ["2", "2"]], "1.5"), R("mods", "Steps", 2, 24, 8), ...FLIPS], (p, { n, s }) => {
  marks(p, s("axis"), shares(Array.from({ length: n("mods") }, (_, i) => Number(s("step")) ** i)).map((f) => [f, false]));
});

// ---- Composition ---------------------------------------------------------

export const ruleOfThirds = guide("rule-of-thirds", "Rule of Thirds", "Composition", "Thirds across and down, with the points where they meet", [R("parts", "Parts across", 2, 12, 3), R("partsY", "Parts down", 2, 12, 3), T("points", "Power points", true), R("dot", "Point size", 1, 10, 2)], (p, { n, b }) => {
  const of = (k: number): number[] => Array.from({ length: Math.max(0, k - 1) }, (_, i) => (i + 1) / k);
  const [xs, ys] = [of(n("parts")), of(n("partsY"))];
  marks(p, "x", xs.map((f) => [f, false]));
  marks(p, "y", ys.map((f) => [f, false]));
  if (b("points")) for (const fx of xs) for (const fy of ys) p.circle(p.x0 + fx * p.w, p.y0 + fy * p.h, (n("dot") / 100) * Math.min(p.w, p.h), true);
});

export const dynamicSymmetry = guide("dynamic-symmetry", "Dynamic Symmetry", "Composition", "The diagonals, their reciprocals and the eyes where they meet", [Ch("which", "Diagonals", [["both", "Both"], ["baroque", "Baroque"], ["sinister", "Sinister"]], "both"), T("reciprocals", "Reciprocals", true), T("eyes", "Lines through the eyes", false)], (p, { s, b }) => {
  const diag = (ax: number, ay: number, cx: number, cy: number, others: readonly P[]): void => {
    p.line(ax, ay, cx, cy, true);
    const [dx, dy] = [cx - ax, cy - ay], len = dx * dx + dy * dy;
    for (const [ox, oy] of others) {
      if (b("reciprocals")) p.ray(ox, oy, -dy, dx);
      if (b("eyes")) {
        const t = ((ox - ax) * dx + (oy - ay) * dy) / len, [ex, ey] = [ax + t * dx, ay + t * dy];
        p.line(ex, p.y0, ex, p.y1);
        p.line(p.x0, ey, p.x1, ey);
      }
    }
  };
  if (s("which") !== "sinister") diag(p.x0, p.y1, p.x1, p.y0, [[p.x0, p.y0], [p.x1, p.y1]]);
  if (s("which") !== "baroque") diag(p.x0, p.y0, p.x1, p.y1, [[p.x1, p.y0], [p.x0, p.y1]]);
});

export const harmonicArmature = guide("harmonic-armature", "Harmonic Armature", "Composition", "The 14 lines between a rectangle's corners and the middles of its sides", [T("reciprocals", "Reciprocals", false), T("centre", "Centre lines", false)], (p, { b }) => {
  const [l, t, r, u, cx, cy] = [p.x0, p.y0, p.x1, p.y1, p.cx, p.cy];
  // Two diagonals, eight half-diagonals (a corner to the middle of each side it is not on), four from middle to middle.
  p.line(l, t, r, u, true);
  p.line(r, t, l, u, true);
  for (const [a, c, d, e] of [[l, t, r, cy], [l, t, cx, u], [r, t, l, cy], [r, t, cx, u], [l, u, r, cy], [l, u, cx, t], [r, u, l, cy], [r, u, cx, t]] as const) p.line(a, c, d, e);
  for (const [a, c, d, e] of [[cx, t, r, cy], [r, cy, cx, u], [cx, u, l, cy], [l, cy, cx, t]] as const) p.line(a, c, d, e);
  if (b("reciprocals")) {
    const [w, h] = [r - l, u - t];
    for (const [x, y, dx, dy] of [[r, t, -h, w], [l, u, -h, w], [l, t, h, w], [r, u, h, w]] as const) p.ray(x, y, dx, dy);
  }
  if (b("centre")) {
    p.line(cx, t, cx, u);
    p.line(l, cy, r, cy);
  }
});

export const rabatment = guide("rabatment", "Rabatment", "Composition", "The short side swung onto the long side, making a square at each end", [Ch("side", "Ends", [["both", "Both"], ["start", "First"], ["end", "Last"]], "both"), T("diagonals", "Diagonals", false), T("middle", "Middle", false)], (p, { s, b }) => {
  const wide = p.w >= p.h, side = Math.min(p.w, p.h);
  const square = (at: number): void => {
    if (wide) {
      p.line(at === 0 ? p.x0 + side : p.x1 - side, p.y0, at === 0 ? p.x0 + side : p.x1 - side, p.y1, true);
      if (b("diagonals")) {
        const x = at === 0 ? p.x0 : p.x1 - side;
        p.line(x, p.y0, x + side, p.y1);
        p.line(x + side, p.y0, x, p.y1);
      }
    } else {
      p.line(p.x0, at === 0 ? p.y0 + side : p.y1 - side, p.x1, at === 0 ? p.y0 + side : p.y1 - side, true);
      if (b("diagonals")) {
        const y = at === 0 ? p.y0 : p.y1 - side;
        p.line(p.x0, y, p.x1, y + side);
        p.line(p.x1, y, p.x0, y + side);
      }
    }
  };
  if (s("side") !== "end") square(0);
  if (s("side") !== "start") square(1);
  if (b("middle")) wide ? p.line(p.cx, p.y0, p.cx, p.y1) : p.line(p.x0, p.cy, p.x1, p.cy);
});

export const diagonalGrid = guide("diagonal-grid", "Diagonal Grid", "Composition", "Corner to corner lines of the box and of its parts", [R("across", "Across", 1, 12, 2), R("down", "Down", 1, 12, 2), Ch("way", "Direction", [["both", "Both"], ["one", "One way"], ["other", "Other way"]], "both"), T("cellLines", "Cell lines", false)], (p, { n, s, b }) => {
  const [cw, ch] = [p.w / n("across"), p.h / n("down")], [one, other] = [s("way") !== "other", s("way") !== "one"];
  for (let i = 0; i < n("across"); i++) for (let j = 0; j < n("down"); j++) {
    const [x, y] = [p.x0 + i * cw, p.y0 + j * ch];
    if (one) p.line(x, y, x + cw, y + ch);
    if (other) p.line(x + cw, y, x, y + ch);
    if (b("cellLines")) p.rect(x, y, cw, ch);
  }
  if (one) p.line(p.x0, p.y0, p.x1, p.y1, true);
  if (other) p.line(p.x1, p.y0, p.x0, p.y1, true);
});

export const safeMarks = guide("safe-marks", "Center and Safe Marks", "Composition", "A centre cross and the boxes kept safe on a screen", [R("action", "Action safe", 50, 100, 93), R("title", "Title safe", 50, 100, 90), T("cross", "Centre cross", true), R("crossSize", "Cross size", 1, 50, 8)], (p, { n, b }) => {
  for (const [k, strong] of [["action", false], ["title", true]] as const) {
    const f = n(k) / 100;
    p.rect(p.cx - (p.w * f) / 2, p.cy - (p.h * f) / 2, p.w * f, p.h * f, strong);
  }
  if (b("cross")) {
    const r = (n("crossSize") / 100) * Math.min(p.w, p.h);
    p.line(p.cx - r, p.cy, p.cx + r, p.cy, true);
    p.line(p.cx, p.cy - r, p.cx, p.cy + r, true);
  }
});

// ---- Layout --------------------------------------------------------------

/** Where a grid's lines go: the same reckoning for drawing them and for saying what they come to. */
function gridLayout(v: Values, w: number, h: number): { mx: number; my: number; cols: number; rows: number; cellX: number; cellY: number } {
  const { n, s } = reader(v);
  const { mx, my } = margins(v, w, h), iw = w - 2 * mx, ih = h - 2 * my, kind = s("cells");
  if (kind === "size") {
    const size = Math.max(n("size"), Math.max(iw, ih) / 1000); // (a tiny cell on a huge sheet would be more lines than can be held)
    return { mx, my, cols: Math.max(1, Math.floor(iw / size)), rows: Math.max(1, Math.floor(ih / size)), cellX: size, cellY: size };
  }
  const cols = n("cols"), cellX = iw / cols;
  // Square: the whole rows nearest to square cells, so that the last line is on the edge.
  const rows = kind === "equal" ? cols : kind === "rows" ? n("rows") : Math.max(1, Math.round(ih / cellX));
  return { mx, my, cols, rows, cellX, cellY: ih / rows };
}
const SOME_CELLS = ["square", "equal", "rows"] as const;
/** A grid's lines, and what strong lines count from; a line on the box's edge sits just inside it (a sheet would cut it in half). */
function gridLines(p: Pen, v: Values, w: number, h: number, rng: () => number): void {
  const { n, b } = reader(v);
  const { mx, my, cellX, cellY } = gridLayout(v, w, h), turned = !!(v["angle"] as number | undefined);
  const extra = turned && !mx && !my ? Math.hypot(w, h) : 0; // (turned with no margin: past the box on all sides, for it to stay covered)
  const off = (): number => (rng() - 0.5) * cellX * 0.6 * (((v["jitter"] as number | undefined) ?? 0) / 100); // (looseness: each line off its place)
  const strongAt = (v["strongAt"] as number | undefined) ?? 0;
  const isStrong = (i: number, every: number): boolean => every > 0 && p.hasStrong && (i - strongAt) % every === 0;
  const lines = (m: number, every: number, step: number, size: number, shift: number, draw: (i: number, at: number, strong: boolean) => void): void => {
    for (let i = -Math.ceil(extra / step) - (shift ? 1 : 0); m + i * step + shift * step <= size - m + extra + 1e-6; i++) {
      const at = m + i * step + shift * step, strong = isStrong(i, every), half = (strong ? (p.wd * n("strong")) / 100 : p.wd) / 2;
      if (at < m - extra - 1e-6) continue;
      draw(i, at + (m || turned ? 0 : at <= 1e-6 ? half : at >= size - 1e-6 ? -half : 0), strong);
    }
  };
  const everyDown = v["strongKind"] === "apart" ? n("everyY") : n("every");
  lines(mx, n("every"), cellX, w, ((v["shiftX"] as number | undefined) ?? 0) / 100, (_, x, strong) => { const o = off(); p.line(x + o, my - extra, x + o, h - my + extra, strong); });
  if (b("rowsToo")) lines(my, everyDown, cellY, h, ((v["shiftY"] as number | undefined) ?? 0) / 100, (_, y, strong) => { const o = off(); p.line(mx - extra, y + o, w - mx + extra, y + o, strong); });
}

const cellsReadout = (v: Values, w: number, h: number): string => {
  const { cols, rows, cellX, cellY } = gridLayout(v, w, h);
  return `${cols} across, ${rows} down · cell ${Math.round(cellX)} × ${Math.round(cellY)}`;
};

export const grid: Generator = {
  id: "grid", label: "Grid", family: "Layout", guide: true, about: "Lines in a lattice with stronger lines now and then",
  sections: [
    COLOURS,
    { title: "Grid", items: [steady(Ch("cells", "Cells", [["square", "Square"], ["equal", "Equal"], ["rows", "Rows"], ["size", "Size"]], "square")), steady(when("cells", SOME_CELLS, R("cols", "Across", 2, 60, 16))), steady(when("cells", ["rows"], R("rows", "Rows", 2, 60, 16))), steady(when("cells", ["size"], R("size", "Cell size", 4, 200, 32))), WEIGHT, R("every", "Strong every", 0, 12, 4), steady(Ch("strongKind", "Strong lines", [["same", "Same"], ["apart", "Apart"]], "same")), steady(when("strongKind", ["apart"], R("everyY", "Strong down", 0, 12, 4))), wide(steady(R("strongAt", "Strong start", 0, 12, 0))), STRONG_WIDTH, steady(T("rowsToo", "Rows too", true)), steady(LOOSE)] },
    { title: "Layout", items: [...MARGINS, frameSetting(false), steady(R("shiftX", "Shift across", 0, 100, 0)), steady(R("shiftY", "Shift down", 0, 100, 0)), DASH, wide(steady(R("angle", "Angle", 0, 90, 0)))] },
  ],
  readout: cellsReadout,
  run(v, rng, w, h) {
    const p = pen(v, w, h);
    gridLines(p, v, w, h, rng);
    return p.done();
  },
};

const moduleItems = [BY, when("by", ["size"], R("cell", "Column width", 4, 400, 48)), when("by", ["size"], R("gapSize", "Gutter size", 0, 100, 12)), when("by", ["count"], R("gutter", "Gutter", 0, 90, 10)), T("bands", "Filled", true)];
/** The parts along an axis: a count with a gutter as a share, or an exact size with an exact gutter, as many as fit. */
const parts = (by: string, count: number, gutter: number, cell: number, gap: number, start: number, size: number): [number, number][] => {
  if (by !== "size") return modules(count, gutter, start, size);
  const c = Math.max(cell, size / 200), k = Math.max(1, Math.floor((size + gap) / (c + gap)));
  return Array.from({ length: k }, (_, i): [number, number] => [start + i * (c + gap), start + i * (c + gap) + c]);
};
export const columnGrid = guide("column-grid", "Column Grid", "Layout", "Columns with gutters, as in print and web layouts", [when("by", ["count"], R("cols", "Columns", 1, 24, 12)), ...moduleItems], (p, { n, s, b }) => {
  for (const [a, e] of parts(s("by"), n("cols"), n("gutter"), n("cell"), n("gapSize"), p.x0, p.w)) {
    if (b("bands")) p.band(a, p.y0, e - a, p.h);
    p.line(a, p.y0, a, p.y1);
    p.line(e, p.y0, e, p.y1);
  }
}, { frame: false, readout: (v, w, h) => { const q = reader(v), all = parts(q.s("by"), q.n("cols"), q.n("gutter"), q.n("cell"), q.n("gapSize"), 0, pen(v, w, h).w); return `${all.length} across · column ${Math.round(all[0]![1])}`; } });

export const modularGrid = guide("modular-grid", "Modular Grid", "Layout", "Columns and rows with gutters: a field for each module", [when("by", ["count"], R("cols", "Columns", 1, 24, 6)), when("by", ["count"], R("rows", "Rows", 1, 24, 4)), ...moduleItems, Ch("gutterKind", "Gutters", [["same", "Same"], ["apart", "Apart"]], "same"), when("gutterKind", ["apart"], R("gutterY", "Gutter down", 0, 90, 10))], (p, { n, s, b }) => {
  const gy = s("gutterKind") === "apart" ? n("gutterY") : n("gutter");
  for (const [a, e] of parts(s("by"), n("cols"), n("gutter"), n("cell"), n("gapSize"), p.x0, p.w)) for (const [t, u] of parts(s("by"), n("rows"), gy, n("cell"), n("gapSize"), p.y0, p.h)) {
    if (b("bands")) p.band(a, t, e - a, u - t);
    p.rect(a, t, e - a, u - t);
  }
}, { frame: false, readout: (v, w, h) => { const q = reader(v), box = pen(v, w, h); return `${parts(q.s("by"), q.n("cols"), q.n("gutter"), q.n("cell"), q.n("gapSize"), 0, box.w).length} across, ${parts(q.s("by"), q.n("rows"), q.n("gutter"), q.n("cell"), q.n("gapSize"), 0, box.h).length} down`; } });

const leading = (v: Values, h: number): number => { const q = reader(v); return q.s("by") === "size" ? Math.max(q.n("size"), h / 1000) : h / q.n("lines"); };
export const baselineGrid = guide("baseline-grid", "Baseline Grid", "Layout", "Evenly spaced lines for text to sit on", [Ch("by", "Set by", [["lines", "Lines"], ["size", "Height"]], "lines"), when("by", ["lines"], R("lines", "Lines", 2, 120, 32)), when("by", ["size"], R("size", "Line height", 4, 200, 24)), R("every", "Strong every", 0, 12, 4)], (p, { n, s }) => {
  const step = s("by") === "size" ? Math.max(n("size"), p.h / 1000) : p.h / n("lines");
  for (let i = 0; p.y0 + i * step <= p.y1 + 1e-6; i++) p.line(p.x0, p.y0 + i * step, p.x1, p.y0 + i * step, n("every") > 0 && i % n("every") === 0);
}, { frame: false, readout: (v, w, h) => { const ih = pen(v, w, h).h, step = leading(v, ih); return `${Math.floor(ih / step + 1e-6)} down · ${Math.round(step)} apart`; } });

export const vanDeGraaf = guide("van-de-graaf", "Van de Graaf Canon", "Layout", "The classic construction of a book page's text block", [Ch("pages", "Pages", [["spread", "Spread"], ["single", "Single"]], "spread"), T("building", "Construction", true), T("bands", "Filled", true)], (p, { s, b }) => {
  const spread = s("pages") === "spread", page = spread ? p.w / 2 : p.w, [t, u] = [p.y0, p.y1];
  const block = (x: number, left: boolean): void => {
    const bx = x + (page * (left ? 2 : 1)) / 9, by = t + p.h / 9, bw = (page * 6) / 9, bh = (p.h * 6) / 9; // (an inner margin of a ninth, an outer of two, and the same top and bottom)
    if (b("bands")) p.band(bx, by, bw, bh);
    p.rect(bx, by, bw, bh, true);
  };
  if (spread) {
    p.line(p.x0 + page, t, p.x0 + page, u);
    block(p.x0, true);
    block(p.x0 + page, false);
  } else block(p.x0, false);
  if (!b("building")) return;
  if (spread) {
    p.line(p.x0, u, p.x1, t);
    p.line(p.x0, t, p.x1, u);
    p.line(p.x0, u, p.x0 + page, t);
    p.line(p.x0 + page, t, p.x1, u);
  } else {
    p.line(p.x0, t, p.x1, u);
    p.line(p.x0, u, p.x1, t);
  }
});

export const cropMarks = guide("crop-marks", "Bleed and Crop Marks", "Layout", "The trim, the bleed past it, a safe area and the marks at the corners", [R("bleed", "Bleed", 0, 20, 3), R("mark", "Mark length", 1, 20, 5), T("safe", "Safe area", true), R("safeIn", "Safe inset", 0, 25, 5)], (p, { n, b }) => {
  const u = Math.min(p.w, p.h) / 100, bl = n("bleed") * u, mk = n("mark") * u, t = bl + mk + mk * 0.25;
  const [l, o, r, e] = [p.x0 + t, p.y0 + t, p.x1 - t, p.y1 - t];
  p.rect(l, o, r - l, e - o, true);
  if (bl) p.rect(l - bl, o - bl, r - l + 2 * bl, e - o + 2 * bl);
  if (b("safe")) { const i = n("safeIn") * u; if (r - l > 2 * i && e - o > 2 * i) p.rect(l + i, o + i, r - l - 2 * i, e - o - 2 * i); }
  for (const [x, dx] of [[l, -1], [r, 1]] as const) for (const [y, dy] of [[o, -1], [e, 1]] as const) {
    p.line(x + dx * (bl + mk * 0.25), y, x + dx * (bl + mk * 0.25 + mk), y, true);
    p.line(x, y + dy * (bl + mk * 0.25), x, y + dy * (bl + mk * 0.25 + mk), true);
  }
}, { frame: false });

// ---- Perspective ---------------------------------------------------------

const latticeGap = (p: Pen, by: string, cols: number, size: number): number => (by === "size" ? Math.max(size, p.w / 1000) : p.w / cols);
const latticeItems = [BY, when("by", ["count"], R("cols", "Across", 2, 60, 16)), when("by", ["size"], R("size", "Cell size", 4, 200, 32)), R("every", "Strong every", 0, 12, 0), R("shiftX", "Shift across", 0, 100, 0), R("shiftY", "Shift down", 0, 100, 0)];
/** Upright lines and two families at this tilt, which meet at the same points. */
const tiltedLattice = (p: Pen, deg: number, q: ReturnType<typeof reader>): void => {
  const gap = latticeGap(p, q.s("by"), q.n("cols"), q.n("size")), rise = 2 * gap * Math.tan(deg * RAD), along = rise * Math.cos(deg * RAD);
  const [ox, oy] = [(q.n("shiftX") / 100) * gap, (q.n("shiftY") / 100) * rise];
  if (q.b("uprights")) family(p, 90, gap, q.n("every"), ox, oy);
  family(p, deg, along, q.n("every"), ox, oy);
  family(p, -deg, along, q.n("every"), ox, oy);
};
export const isometricGrid = guide("isometric-grid", "Isometric Grid", "Perspective", "Lines at 30, 90 and 150 degrees", [...latticeItems, T("uprights", "Upright lines", true)], (p, q) => tiltedLattice(p, 30, q));
export const dimetricGrid = guide("dimetric-grid", "Dimetric Grid", "Perspective", "Like isometric at an angle of your own; 26.57 is the 2:1 of game art", [R("tilt", "Tilt", 5, 60, 26.57, 0.01), ...latticeItems, T("uprights", "Upright lines", true)], (p, q) => tiltedLattice(p, q.n("tilt"), q));

export const triangleGrid = guide("triangle-grid", "Triangle Grid", "Perspective", "Equilateral triangles, the base for low-poly work", [...latticeItems, Ch("base", "Sides", [["level", "Level"], ["upright", "Upright"]], "level")], (p, { n, s }) => {
  const size = latticeGap(p, s("by"), n("cols"), n("size")), gap = size * (Math.sqrt(3) / 2), t = s("base") === "level" ? 0 : 90;
  const [ox, oy] = [(n("shiftX") / 100) * size, (n("shiftY") / 100) * gap];
  for (const deg of [t, t + 60, t - 60]) family(p, deg, gap, n("every"), ox, oy);
});

export const perspective = guide("perspective", "Perspective", "Perspective", "A horizon and lines to one, two or three vanishing points", [Ch("points", "Points", [["1", "1"], ["2", "2"], ["3", "3"]], "2"), R("horizon", "Horizon", 0, 100, 50), R("x1", "First point", -200, 300, 12), when("points", ["2", "3"], R("x2", "Second point", -200, 300, 88)), when("points", ["3"], R("x3", "Third across", -200, 300, 50)), when("points", ["3"], R("y3", "Third down", -200, 300, 130)), Ch("level", "On the horizon", [["yes", "Yes"], ["no", "No"]], "yes"), when("level", ["no"], R("y1", "First point down", -200, 300, 50)), when("level", ["no"], R("y2", "Second point down", -200, 300, 50)), R("rays", "Lines per side", 1, 40, 6), when("points", ["1", "2"], R("uprightN", "Upright lines", 0, 40, 8))], (p, { n, s }) => {
  const y = p.y0 + (n("horizon") / 100) * p.h, count = Number(s("points")), level = s("level") === "yes";
  const at = (k: string): number => p.x0 + (n(k) / 100) * p.w, down = (k: string): number => (level ? y : p.y0 + (n(k) / 100) * p.h);
  p.line(p.x0, y, p.x1, y, true);
  const vps: P[] = [[at("x1"), down("y1")]];
  if (count > 1) vps.push([at("x2"), down("y2")]);
  if (count > 2) vps.push([at("x3"), p.y0 + (n("y3") / 100) * p.h]);
  const k = n("rays");
  for (const [vx, vy] of vps) for (let i = 0; i <= k; i++) {
    const f = i / k;
    for (const [tx, ty] of [[p.x0 + f * p.w, p.y0], [p.x0 + f * p.w, p.y1], [p.x0, p.y0 + f * p.h], [p.x1, p.y0 + f * p.h]] as const) if (Math.hypot(tx - vx, ty - vy) > 1e-9) p.ray(vx, vy, tx - vx, ty - vy);
  }
  if (count < 3) for (let i = 1; i <= n("uprightN"); i++) { const x = p.x0 + (i / (n("uprightN") + 1)) * p.w; p.line(x, p.y0, x, p.y1); }
});

export const fisheyeGrid = guide("fisheye-grid", "Fisheye Grid", "Perspective", "Grid lines curved as through a wide-angle lens", [R("cols", "Across", 2, 40, 12), R("rows", "Rows", 2, 40, 8), R("bulge", "Strength", -100, 100, 60), Ch("bulgeKind", "Strengths", [["same", "Same"], ["apart", "Apart"]], "same"), when("bulgeKind", ["apart"], R("bulgeY", "Strength down", -100, 100, 60)), ...centreItems], (p, { n, s }) => {
  const [cx, cy] = centreOf(p, n), half = farthest(p, cx, cy);
  // (the farthest corner stays where it is at any strength; below zero is the exact opposite, a pinch)
  const bend = (bulge: number, r: number): number => {
    const k = (Math.abs(bulge) / 100) * 1.17;
    return !k || !r ? 1 : (bulge > 0 ? Math.atan(r * k) / Math.atan(k) : Math.tan(r * Math.atan(k)) / k) / r;
  };
  const bulgeY = s("bulgeKind") === "apart" ? n("bulgeY") : n("bulge");
  const bent = (x: number, y: number): P => {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) / half;
    return [cx + dx * bend(n("bulge"), r), cy + dy * bend(bulgeY, r)];
  };
  const STEPS = 64;
  for (let i = 0; i <= n("cols"); i++) { const x = p.x0 + (i / n("cols")) * p.w; p.curve(Array.from({ length: STEPS + 1 }, (_, j) => bent(x, p.y0 + (j / STEPS) * p.h)), i * 2 === n("cols")); }
  for (let i = 0; i <= n("rows"); i++) { const y = p.y0 + (i / n("rows")) * p.h; p.curve(Array.from({ length: STEPS + 1 }, (_, j) => bent(p.x0 + (j / STEPS) * p.w, y)), i * 2 === n("rows")); }
}, { frame: false });

// ---- Geometry ------------------------------------------------------------

export const hexGrid = guide("hex-grid", "Hex Grid", "Geometry", "Hexagon outlines to lay work out on", [BY, when("by", ["count"], R("cols", "Across", 2, 60, 12)), when("by", ["size"], R("size", "Cell size", 4, 200, 48)), R("gapHex", "Gap", 0, 50, 0), Ch("top", "Tops", [["flat", "Flat"], ["pointy", "Pointy"]], "flat")], (p, { n, s }) => {
  const flat = s("top") === "flat", across = s("by") === "size" ? Math.max(n("size"), p.w / 200) : p.w / n("cols");
  const r = flat ? across / 1.5 : across / Math.sqrt(3), [stepX, stepY] = flat ? [1.5 * r, Math.sqrt(3) * r] : [Math.sqrt(3) * r, 1.5 * r];
  const [cols, rows] = [Math.ceil(p.w / stepX) + 1, Math.ceil(p.h / stepY) + 1];
  for (let i = 0; i <= cols; i++) for (let j = 0; j <= rows; j++) {
    const x = p.x0 + i * stepX + (!flat && j % 2 ? stepX / 2 : 0), y = p.y0 + j * stepY + (flat && i % 2 ? stepY / 2 : 0);
    p.poly(regular(x, y, r * (1 - n("gapHex") / 100), 6, flat ? 0 : Math.PI / 6));
  }
}, { frame: false });

export const polarGrid = guide("polar-grid", "Polar Grid", "Geometry", "Circles round a centre, crossed by spokes", [R("rings", "Rings", 1, 40, 8), R("spokes", "Spokes", 0, 72, 12), R("spokeStart", "Spoke start", 0, 180, 0), R("every", "Strong every", 0, 12, 4), Ch("reach", "Fit", [["in", "Inside"], ["past", "Past the edges"]], "in"), ...centreItems], (p, { n, s }) => {
  const [x, y] = centreOf(p, n), rim = s("reach") === "past" ? farthest(p, x, y) : Math.min(p.w, p.h) / 2, r = rim / n("rings");
  for (let i = 1; i <= n("rings"); i++) p.circle(x, y, r * i, n("every") > 0 && i % n("every") === 0);
  for (let i = 0; i < n("spokes"); i++) { const a = n("spokeStart") * RAD + (i / n("spokes")) * Math.PI * 2; p.line(x, y, x + Math.cos(a) * rim, y + Math.sin(a) * rim, n("every") > 0 && i % n("every") === 0); }
}, { frame: false });

export const radialSymmetry = guide("radial-symmetry", "Radial Symmetry", "Geometry", "Mirror axes through a centre, for mandalas and rotations", [R("folds", "Axes", 1, 36, 6), T("between", "Lines between", true), R("startAt", "Start angle", 0, 180, 0), R("rings", "Rings", 0, 20, 3), Ch("reach", "Fit", [["in", "Inside"], ["past", "Past the edges"]], "in"), ...centreItems], (p, { n, s, b }) => {
  const [x, y] = centreOf(p, n), reach = farthest(p, x, y);
  for (let i = 0; i < n("folds"); i++) {
    const a = (n("startAt") + (i * 180) / n("folds")) * RAD;
    // (a centre off the box: the axes run on regardless, for the sheet to cut, or a turn of the setting would leave nothing)
    const axis = (t: number, strong: boolean): void => { const [dx, dy] = [Math.cos(t) * reach, Math.sin(t) * reach]; if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1) p.line(x - dx, y - dy, x + dx, y + dy, strong); else p.ray(x, y, dx, dy, strong); };
    axis(a, true);
    if (b("between")) axis(a + (Math.PI / 2) / n("folds"), false);
  }
  const rim = s("reach") === "past" ? reach : Math.min(p.w, p.h) / 2;
  for (let i = 1; i <= n("rings"); i++) p.circle(x, y, rim * (i / n("rings")));
}, { frame: false });

export const logoCircles = guide("logo-circles", "Logo Construction Circles", "Geometry", "Circles growing by one ratio, to build a logo from", [Ch("arrange", "Layout", [["row", "Row"], ["nested", "Nested"], ["ring", "Ring"]], "nested"), R("circles", "Circles", 2, 12, 6), Ch("step", "Ratio", [["1.414", "√2"], ["1.5", "1.5"], ["1.618", "Golden"]], "1.618"), T("cross", "Centre lines", true)], (p, { n, s, b }) => {
  const k = n("circles"), q = Number(s("step")), radii = Array.from({ length: k }, (_, i) => q ** i);
  const biggest = radii[k - 1]!, kind = s("arrange");
  if (kind === "row") {
    const all = 2 * radii.reduce((a, r) => a + r, 0), f = Math.min(p.w / all, p.h / (2 * biggest));
    let x = p.cx - (all * f) / 2;
    const base = p.cy + biggest * f;
    for (const r of radii) { p.circle(x + r * f, base - r * f, r * f); x += 2 * r * f; }
  } else if (kind === "ring") {
    const f = Math.min(p.w, p.h) / 2 / (2 * biggest), rr = biggest * f;
    for (let i = 0; i < k; i++) { const a = (i / k) * Math.PI * 2 - Math.PI / 2; p.circle(p.cx + Math.cos(a) * rr, p.cy + Math.sin(a) * rr, radii[i]! * f); }
  } else {
    const f = Math.min(p.w, p.h) / 2 / biggest, bottom = p.cy + biggest * f;
    for (const r of radii) p.circle(p.cx, bottom - r * f, r * f);
  }
  if (b("cross")) {
    p.line(p.cx, p.y0, p.cx, p.y1, true);
    p.line(p.x0, p.cy, p.x1, p.cy, true);
  }
}, { frame: false });

export const sacredCircles = guide("sacred-circles", "Sacred Circles", "Geometry", "The vesica piscis or the flower of life", [Ch("figure", "Figure", [["vesica", "Vesica"], ["flower", "Flower"]], "flower"), R("rings", "Rings", 1, 8, 2), T("axes", "Axes", true)], (p, { n, s, b }) => {
  const side = Math.min(p.w, p.h);
  if (s("figure") === "vesica") {
    const r = Math.min(side / 2, p.w / 3);
    p.circle(p.cx - r / 2, p.cy, r);
    p.circle(p.cx + r / 2, p.cy, r);
    if (b("axes")) {
      const tip = r * (Math.sqrt(3) / 2);
      p.line(p.cx - r * 1.5, p.cy, p.cx + r * 1.5, p.cy, true);
      p.line(p.cx, p.cy - tip, p.cx, p.cy + tip, true);
    }
    return;
  }
  const k = n("rings"), r = side / 2 / (k + 1);
  // (the circles' centres on a triangular lattice, as far out as the rings: 1, 7, 19, 37)
  for (let i = -k; i <= k; i++) for (let j = Math.max(-k, -i - k); j <= Math.min(k, -i + k); j++) p.circle(p.cx + r * (i + j / 2), p.cy + r * j * (Math.sqrt(3) / 2), r);
  if (b("axes")) for (let i = 0; i < 3; i++) { const a = (i * Math.PI) / 3; p.ray(p.cx, p.cy, Math.cos(a), Math.sin(a), true); }
}, { frame: false });

// ---- Art study -----------------------------------------------------------

export const pixelGrid: Generator = {
  id: "pixel-grid", label: "Pixel Grid", family: "Art study", guide: true, about: "Exact square cells, with strong lines every so many, for pixel art",
  sections: [COLOURS, { title: "Pixel Grid", items: [steady(R("size", "Cell size", 4, 200, 16)), R("every", "Strong every", 0, 64, 8), steady(Ch("strongKind", "Strong lines", [["same", "Same"], ["apart", "Apart"]], "same")), steady(when("strongKind", ["apart"], R("everyY", "Strong down", 0, 64, 8))), steady(T("checker", "Checker", false))] }, { title: "Look", items: [WEIGHT, STRONG_WIDTH, ...MARGINS, frameSetting(true)] }],
  readout: (v, w, h) => cellsReadout({ ...v, cells: "size" }, w, h),
  run(v, rng, w, h) {
    const q = reader(v), all = { ...v, cells: "size", rowsToo: true };
    const p = pen(v, w, h);
    if (q.b("checker")) {
      const { mx, my, cols, rows, cellX: c } = gridLayout(all, w, h);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if ((i + j) % 2 === 0) p.band(mx + i * c, my + j * c, c, c);
    }
    gridLines(p, all, w, h, rng);
    return p.done();
  },
};

const COMIC: Record<string, readonly (readonly number[])[]> = {
  six: [[1, 1], [1, 1], [1, 1]], four: [[1, 1], [1, 1]], nine: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], splash: [[1], [1, 1, 1]], strip: [[1, 1, 1, 1]], stagger: [[2, 1], [1, 2], [1, 1, 1]],
};
export const comicPanels = guide("comic-panels", "Comic Panels", "Art study", "Panels and gutters for a page of comics; Random follows the seed", [Ch("layout", "Layout", [["six", "Six"], ["four", "Four"], ["nine", "Nine"], ["splash", "Splash"], ["strip", "Strip"], ["stagger", "Stagger"], ["random", "Random"], ["own", "Your own"]], "six"), ...[1, 2, 3, 4, 5, 6].map((i) => when("layout", ["own"], R(`row${i}`, `Panels in row ${i}`, 0, 6, i < 4 ? 2 : 0))), R("gutter", "Gutter across", 0, 60, 12), R("gutterY", "Gutter down", 0, 60, 12), T("bands", "Filled", true)], (p, { n, s, b }, rng) => {
  const rows: readonly (readonly number[])[] = s("layout") === "random"
    ? Array.from({ length: 2 + Math.floor(rng() * 3) }, () => Array.from({ length: 1 + Math.floor(rng() * 3) }, () => 1 + Math.floor(rng() * 2)))
    : s("layout") === "own" ? [1, 2, 3, 4, 5, 6].map((i) => Array.from({ length: n(`row${i}`) }, () => 1)).filter((r) => r.length)
    : COMIC[s("layout")]!;
  const u = Math.min(p.w, p.h) / 1000, gx = n("gutter") * u, gy = n("gutterY") * u, rowH = (p.h - (rows.length - 1) * gy) / Math.max(1, rows.length);
  rows.forEach((row, j) => {
    const y = p.y0 + j * (rowH + gy), room = p.w - (row.length - 1) * gx, all = row.reduce((a, c) => a + c, 0);
    let x = p.x0;
    for (const c of row) {
      const pw = (room * c) / all;
      if (b("bands")) p.band(x, y, pw, rowH);
      p.rect(x, y, pw, rowH, true);
      x += pw + gx;
    }
  });
}, { frame: false });

export const GUIDES: readonly Generator[] = [
  goldenRatio, goldenSpiral, fibonacciGrid, rootRectangles, modularScale, ...MORE_GUIDES.proportion,
  ruleOfThirds, dynamicSymmetry, harmonicArmature, rabatment, diagonalGrid, safeMarks, ...MORE_GUIDES.composition,
  grid, columnGrid, modularGrid, baselineGrid, vanDeGraaf, cropMarks, ...MORE_GUIDES.layout,
  isometricGrid, dimetricGrid, triangleGrid, perspective, fisheyeGrid, ...MORE_GUIDES.perspective,
  hexGrid, polarGrid, radialSymmetry, logoCircles, sacredCircles, ...MORE_GUIDES.geometry,
  pixelGrid, comicPanels, ...MORE_GUIDES.art,
];
