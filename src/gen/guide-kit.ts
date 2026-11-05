import type { SubPath } from "./core";
import { curve, ellipse, line, poly, rect, rotated, solid } from "./geom";
import type { P } from "./geom";
import { C, R, T, reader, steady } from "./kit";
import type { GenShape, Generator, Section, Setting, Values } from "./types";

/** What every guide shares: its colours, its look, and a pen that draws with them, so that a guide says only where its lines go. */

export const COLOURS: Section = { title: "Colour", items: [C("line", "Lines", "#5f7a99"), C("major", "Strong lines", "#ff3d81", true)] };
export const WEIGHT = R("weight", "Line width", 1, 20, 3);
export const STRONG_WIDTH = R("strong", "Strong width", 100, 500, 180, 10);
export const DASH = steady(R("dash", "Dash length", 0, 100, 0));
export const MARGIN = steady(R("margin", "Margin", 0, 45, 0));
export const frameSetting = (on: boolean): Setting => steady(T("frame", "Frame", on));
export const FLIPS: readonly Setting[] = [T("flipX", "Flip across", false), T("flipY", "Flip down", false)];

export interface Pen {
  /** The box inside the margin: its corners, size and middle. */
  readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly w: number; readonly h: number; readonly cx: number; readonly cy: number;
  /** The margin, and a line's width. */
  readonly m: number; readonly wd: number;
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
  /** Whether strong lines are drawn apart (their colour may be hidden). */
  readonly hasStrong: boolean;
  readonly done: () => GenShape[];
}

export function pen(v: Values, w: number, h: number): Pen {
  const { c } = reader(v);
  const num = (k: string): number => (v[k] as number | undefined) ?? 0;
  const m = (num("margin") / 100) * Math.min(w, h), a = (num("angle") * Math.PI) / 180;
  const [x0, y0, x1, y1] = [m, m, w - m, h - m];
  const unit = w / 16, wd = (num("weight") / 100) * unit * 0.5; // (a 16th of the width, whatever the count: changing a count leaves the line width as it is)
  const minor: SubPath[] = [], major: SubPath[] = [], bands: SubPath[] = [];
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
    x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: w / 2, cy: h / 2, m, wd, hasStrong,
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
    done() {
      if (v["frame"]) {
        const e = m + (m || a ? 0 : wd / 2); // (on the edge of the box it sits just inside: a sheet would cut it in half)
        walk([[e, e], [w - e, e], [w - e, h - e], [e, h - e]], true, minor);
      }
      return [solid(bands, `${c("line")}33`, "Areas"), line(minor, c("line")!, wd, "Lines"), ...(major.length ? [line(major, c("major")!, (wd * num("strong")) / 100, "Strong lines")] : [])];
    },
  };
}

/** A guide: its own settings (Randomize leaves them, so that it stays what it is, and changes its look), then the colours and the look of every guide. */
export function guide(id: string, label: string, family: Generator["family"], about: string, items: readonly Setting[], draw: (p: Pen, v: ReturnType<typeof reader>, rng: () => number) => void, more: { frame?: boolean; readout?: Generator["readout"] } = {}): Generator {
  return {
    id, label, family, about, guide: true,
    sections: [COLOURS, { title: label, items: items.map(steady) }, { title: "Look", items: [WEIGHT, STRONG_WIDTH, DASH, MARGIN, frameSetting(more.frame ?? true)] }],
    run(v, rng, w, h) {
      const p = pen(v, w, h);
      draw(p, reader(v), rng);
      return p.done();
    },
    ...(more.readout ? { readout: more.readout } : {}),
  };
}

