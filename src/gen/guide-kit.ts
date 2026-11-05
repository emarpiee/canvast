import type { SubPath } from "./core";
import { curve, ellipse, line, poly, rect, rotated, solid } from "./geom";
import type { P } from "./geom";
import { C, Ch, R, T, reader, steady, when } from "./kit";
import type { Rng } from "./rng";
import type { GenShape, Generator, Section, Setting, Values } from "./types";

/** What every guide shares: its colours, its look, and a pen that draws with them, so that a guide says only where its lines go. */

/**
 * How far a guide's settings go, past their usual span, when typed or dragged: as far as makes a picture (Levels triples with each one;
 * past these a guide is lines too close to see, or more than a path can be drawn fast with).
 */
const SPANS: Readonly<Record<string, readonly [number, number]>> = {
  action: [1, 100], title: [1, 100], bleed: [0, 50], bulge: [-1000, 1000], centreX: [-100, 200], centreY: [-100, 200], circles: [2, 40], crossSize: [1, 100], depth: [1, 8], dot: [1, 50], fib: [2, 60],
  folds: [1, 360], gutter: [0, 200], horizon: [-100, 200], lines: [2, 1000], mark: [1, 50], mods: [2, 60], parts: [1, 100], rays: [1, 400], root: [2, 100], safeIn: [0, 50], spokes: [0, 720],
  squares: [2, 30], wheelRings: [1, 12], partsY: [1, 100], across: [1, 400], down: [1, 400], gutterY: [0, 200], cell: [1, 5000], gapSize: [0, 2000], y1: [-1000, 1000], y2: [-1000, 1000], bulgeY: [-1000, 1000], spokeStart: [0, 360], shiftX: [0, 100], shiftY: [0, 100], row1: [0, 24], row2: [0, 24], row3: [0, 24], row4: [0, 24], row5: [0, 24], row6: [0, 24], gapHex: [0, 90], sides: [3, 64], twist: [-180, 180], silver: [1, 8], paper: [1, 14], count5: [1, 400], balanceX: [0, 100], balanceY: [0, 100], c1: [0, 100], c2: [0, 100], c3: [0, 100], c4: [0, 100], c5: [0, 100], c6: [0, 100], cellW: [1, 5000], cellH: [1, 5000], pad: [0, 500], valueSteps: [2, 256], segments: [3, 360], hue: [0, 360], outer: [3, 200], inner: [1, 199], reachOut: [0, 300], skip: [1, 30], penrose: [1, 8], bentoLevels: [1, 9], startAt: [0, 360], strongAt: [0, 100], tilt: [1, 89], uprightN: [0, 400], x1: [-1000, 1000], x2: [-1000, 1000], x3: [-1000, 1000], y3: [-1000, 1000], angle: [0, 360],
};
/** A setting of a guide, with its whole span. */
export const wide = (s: Setting): Setting => {
  const span = SPANS[s.k];
  return s.t === "range" && span ? { ...s, min: span[0], max: span[1] } : s;
};

export const COLOURS: Section = { title: "Colour", items: [C("line", "Lines", "#5f7a99"), C("major", "Strong lines", "#ff3d81", true)] };
export const WEIGHT = R("weight", "Line width", 1, 20, 3);
export const STRONG_WIDTH: Setting = { ...R("strong", "Strong width", 100, 500, 180, 10), ...{ max: 2000 } };
export const DASH: Setting = { ...steady(R("dash", "Dash length", 0, 100, 0)), ...{ max: 1000 } };
export const MARGIN = steady(R("margin", "Margin", 0, 45, 0));
/** One margin, or one across and another down. */
export const MARGINS: readonly Setting[] = [MARGIN, steady(Ch("marginKind", "Margins", [["same", "Same"], ["apart", "Apart"]], "same")), steady(when("marginKind", ["apart"], R("marginY", "Margin down", 0, 45, 0)))];
export const frameSetting = (on: boolean): Setting => steady(T("frame", "Frame", on));
export const FLIPS: readonly Setting[] = [T("flipX", "Flip across", false), T("flipY", "Flip down", false)];

export interface Pen {
  /** The box inside the margin: its corners, size and middle. */
  readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly w: number; readonly h: number; readonly cx: number; readonly cy: number;
  /** The margins, across and down, and a line's width. */
  readonly mx: number; readonly my: number; readonly wd: number;
  readonly line: (ax: number, ay: number, bx: number, by: number, strong?: boolean) => void;
  /** The whole of the line through a point, in a direction, inside the box. */
  readonly ray: (x: number, y: number, dx: number, dy: number, strong?: boolean) => void;
  readonly poly: (pts: readonly P[], closed?: boolean, strong?: boolean) => void;
  /** A smooth line through the points. */
  readonly curve: (pts: readonly P[], strong?: boolean) => void;
  readonly circle: (x: number, y: number, r: number, strong?: boolean) => void;
  readonly rect: (x: number, y: number, w: number, h: number, strong?: boolean) => void;
  /** A soft area, under the lines (a column, a panel). */
  readonly band: (x: number, y: number, w: number, h: number) => void;
  /** A shape filled with a colour of its own, under the lines (a step of a scale, a wedge of a wheel). */
  readonly fill: (pts: readonly P[], colour: string) => void;
  /** Whether strong lines are drawn apart (their colour may be hidden). */
  readonly hasStrong: boolean;
  readonly done: () => GenShape[];
}

/** The margins of a box of this size. */
export function margins(v: Values, w: number, h: number): { mx: number; my: number } {
  const of = (k: string): number => (((v[k] as number | undefined) ?? 0) / 100) * Math.min(w, h);
  return { mx: of("margin"), my: of(v["marginKind"] === "apart" ? "marginY" : "margin") };
}

export function pen(v: Values, w: number, h: number): Pen {
  const { c } = reader(v);
  const num = (k: string): number => (v[k] as number | undefined) ?? 0;
  const { mx, my } = margins(v, w, h), a = (num("angle") * Math.PI) / 180;
  const [x0, y0, x1, y1] = [mx, my, w - mx, h - my];
  const unit = w / 16, wd = (num("weight") / 100) * unit * 0.5; // (a 16th of the width, whatever the count: changing a count leaves the line width as it is)
  const minor: SubPath[] = [], major: SubPath[] = [], bands: SubPath[] = [], fills: GenShape[] = [];
  const xf = (pts: readonly P[]): P[] => {
    const f = pts.map(([x, y]): P => [v["flipX"] ? w - x : x, v["flipY"] ? h - y : y]);
    return a ? rotated(f, w / 2, h / 2, a) : f;
  };
  const hasStrong = !!c("major");
  const to = (strong?: boolean): SubPath[] => (strong && hasStrong ? major : minor);
  const dash = (num("dash") / 100) * unit;
  /** The points as they are, or cut into dashes along their length (a dash is never shorter than it can be seen; its gap is as long). */
  const walk = (pts: readonly P[], closed: boolean, out: SubPath[]): void => {
    const ring = closed ? [...pts, pts[0]!] : pts;
    if (!dash) return void out.push(poly(xf(pts), closed));
    const lens = ring.slice(1).map((p, i) => Math.hypot(p[0] - ring[i]![0], p[1] - ring[i]![1]));
    const all = lens.reduce((s, l) => s + l, 0);
    const step = Math.max(2 * Math.max(dash, wd * 1.5), all / 400);
    let seg = 0, done = 0;
    const at = (d: number): P => {
      while (seg < lens.length - 1 && done + lens[seg]! < d) { done += lens[seg]!; seg++; }
      const t = lens[seg]! > 0 ? (d - done) / lens[seg]! : 0, p = ring[seg]!, q = ring[seg + 1]!;
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    };
    for (let d = 0; d < all; d += step) {
      const piece: P[] = [at(d)], end = Math.min(all, d + step / 2);
      for (let i = seg, sum = done; i < lens.length - 1 && sum + lens[i]! < end; i++) { sum += lens[i]!; piece.push(ring[i + 1]!); }
      piece.push(at(end));
      out.push(poly(xf(piece), false));
    }
  };
  const circlePts = (x: number, y: number, r: number): P[] => Array.from({ length: 72 }, (_, i): P => [x + r * Math.cos((i * Math.PI) / 36), y + r * Math.sin((i * Math.PI) / 36)]);
  return {
    x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: w / 2, cy: h / 2, mx, my, wd, hasStrong,
    line: (ax, ay, bx, by, strong) => walk([[ax, ay], [bx, by]], false, to(strong)),
    ray(x, y, dx, dy, strong) {
      let [t0, t1] = [-Infinity, Infinity];
      for (const [d, lo, hi, o] of [[dx, x0, x1, x], [dy, y0, y1, y]] as const) {
        if (d === 0) {
          if (o < lo - 1e-9 || o > hi + 1e-9) return;
        } else {
          const [p, q] = [(lo - o) / d, (hi - o) / d];
          t0 = Math.max(t0, Math.min(p, q));
          t1 = Math.min(t1, Math.max(p, q));
        }
      }
      if (t0 < t1) walk([[x + dx * t0, y + dy * t0], [x + dx * t1, y + dy * t1]], false, to(strong));
    },
    poly: (pts, closed = true, strong) => walk(pts, closed, to(strong)),
    curve: (pts, strong) => (dash ? walk(pts, false, to(strong)) : void to(strong).push(curve(xf(pts)))),
    circle(x, y, r, strong) {
      if (dash || a) return walk(circlePts(x, y, r), true, to(strong));
      const [[px, py]] = xf([[x, y]]) as [P];
      to(strong).push(ellipse(px, py, r, r));
    },
    rect: (x, y, rw, rh, strong) => walk([[x, y], [x + rw, y], [x + rw, y + rh], [x, y + rh]], true, to(strong)),
    band(x, y, rw, rh) {
      const pts = xf([[x, y], [x + rw, y], [x + rw, y + rh], [x, y + rh]]);
      bands.push(a ? poly(pts) : rect(Math.min(pts[0]![0], pts[2]![0]), Math.min(pts[0]![1], pts[2]![1]), rw, rh));
    },
    fill: (pts, colour) => void fills.push(solid([poly(xf(pts))], colour)),
    done() {
      if (v["frame"]) {
        const [ex, ey] = [mx + (mx || a ? 0 : wd / 2), my + (my || a ? 0 : wd / 2)]; // (on the edge of the box it sits just inside: a sheet would cut it in half)
        walk([[ex, ey], [w - ex, ey], [w - ex, h - ey], [ex, h - ey]], true, minor);
      }
      return [...fills, solid(bands, `${c("line")}33`, "Areas"), line(minor, c("line")!, wd, "Lines"), ...(major.length ? [line(major, c("major")!, (wd * num("strong")) / 100, "Strong lines")] : [])];
    },
  };
}

/** A guide: its own settings (Randomize leaves them, so that it stays what it is, and changes its look), then the colours and the look of every guide. */
export function guide(id: string, label: string, family: Generator["family"], about: string, items: readonly Setting[], draw: (p: Pen, v: ReturnType<typeof reader>, rng: Rng) => void, more: { frame?: boolean; readout?: Generator["readout"] } = {}): Generator {
  return {
    id, label, family, about, guide: true,
    sections: [COLOURS, { title: label, items: items.map((i) => wide(steady(i))) }, { title: "Look", items: [WEIGHT, STRONG_WIDTH, DASH, ...MARGINS, frameSetting(more.frame ?? true)] }],
    run(v, rng, w, h) {
      const p = pen(v, w, h);
      draw(p, reader(v), rng);
      return p.done();
    },
    ...(more.readout ? { readout: more.readout } : {}),
  };
}

export const PHI = (1 + Math.sqrt(5)) / 2;
export const RAD = Math.PI / 180;
export const AXIS = Ch("axis", "Lines", [["both", "Both"], ["x", "Across"], ["y", "Down"]], "both");

/** Lines at these fractions of the box, along what the Lines setting says. */
export const marks = (p: Pen, axis: string, at: readonly (readonly [number, boolean])[]): void => {
  for (const [f, strong] of at) {
    if (axis !== "y") p.line(p.x0 + f * p.w, p.y0, p.x0 + f * p.w, p.y1, strong);
    if (axis !== "x") p.line(p.x0, p.y0 + f * p.h, p.x1, p.y0 + f * p.h, strong);
  }
};
/** Where parts of these sizes end, as fractions of their sum. */
export const shares = (sizes: readonly number[]): number[] => {
  const all = sizes.reduce((s, x) => s + x, 0);
  let sum = 0;
  return sizes.slice(0, -1).map((x) => (sum += x) / all);
};
export const arc = (x: number, y: number, r: number, from: number, to: number, n = 16): P[] => Array.from({ length: n + 1 }, (_, i): P => [x + r * Math.cos(from + ((to - from) * i) / n), y + r * Math.sin(from + ((to - from) * i) / n)]);
/** `n` parts of `size` from `start`, with a gutter (a share of a part's room) between them: where each begins and ends. */
export const modules = (n: number, gutter: number, start: number, size: number): [number, number][] => {
  const g = (size / n) * (gutter / 100), part = (size - (n - 1) * g) / n;
  return Array.from({ length: n }, (_, i): [number, number] => [start + i * (part + g), start + i * (part + g) + part]);
};
/** Lines in a direction (degrees from level), `gap` apart, one through the middle of the box. */
export const family = (p: Pen, deg: number, gap: number, every = 0, ox = 0, oy = 0): void => {
  const [dx, dy] = [Math.cos(deg * RAD), Math.sin(deg * RAD)], reach = Math.ceil(Math.hypot(p.w, p.h) / gap) + 1;
  for (let k = -reach; k <= reach; k++) p.ray(p.cx + ox - dy * k * gap, p.cy + oy + dx * k * gap, dx, dy, every > 0 && k % every === 0);
};
/** The largest box of this width to height that fits, in the middle. */
export const fitted = (p: Pen, ratio: number, align = "middle"): { x: number; y: number; w: number; h: number } => {
  const w = Math.min(p.w, p.h * ratio), h = w / ratio, room = align === "start" ? 0 : align === "end" ? 1 : 0.5;
  return { x: p.x0 + (p.w - w) * room, y: p.y0 + (p.h - h) * room, w, h };
};
/** Set by a count or by an exact size. */
export const BY = Ch("by", "Set by", [["count", "Count"], ["size", "Size"]], "count");
export const ALIGN = Ch("align", "Align", [["start", "Start"], ["middle", "Middle"], ["end", "End"]], "middle");
