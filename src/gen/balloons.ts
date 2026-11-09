import type { SubPath } from "./core";
import { curve, ellipse, poly } from "./geom";
import type { P } from "./geom";
import { C, Ch, R, reader, steady, when } from "./kit";
import type { Rng } from "./rng";
import { BODIES, BUMPY, bodyOf, dist, evened, inside, lerp, withTail, wobbled, TAU } from "../doc/balloon-geometry";
import type { GenShape, Generator, Section, Values } from "./types";

/**
 * Speech balloons: a body of one of many shapes with its tails in one closed outline (so words can flow inside it), thought bubbles,
 * and balloons linked to each other. Everything is a setting; the tips are shares of the box.
 */

const area = (pts: readonly P[]): number => pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length]![1] - pts[(i + 1) % pts.length]![0] * p[1], 0) / 2;

/** Open pieces along an outline, `on` long and `off` apart: the dashes of a whisper. */
function dashes(pts: readonly P[], on: number, off: number): SubPath[] {
  const out: SubPath[] = [];
  let cur: P[] = [], left = on, drawing = true;
  for (let i = 0; i < pts.length; i++) {
    let a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    let d = dist(a, b);
    while (d > left && d > 0) {
      const p = lerp(a, b, left / d);
      if (drawing) (cur.push(a, p), out.push(poly(cur, false)), (cur = []));
      a = p;
      d = dist(a, b);
      drawing = !drawing;
      left = drawing ? on : off;
      if (out.length > 800) return out;
    }
    if (drawing) cur.push(a);
    left -= d;
  }
  if (drawing && cur.length > 1) out.push(poly(cur, false));
  return out;
}

const SECTIONS: readonly Section[] = [
  {
    title: "Colour",
    items: [C("fill", "Fill", "#ffffff", true), C("ink", "Outline", "#111111", true), C("shadow", "Shadow", "#000000", true)],
  },
  {
    title: "Shape",
    items: [
      steady(Ch("body", "Shape", BODIES, "oval")),
      R("bodyW", "Width", 10, 100, 86),
      R("bodyH", "Height", 10, 100, 66),
      R("bodyX", "Across", 0, 100, 50),
      R("bodyY", "Down", 0, 100, 40),
      when("body", ["round", "octagon"], R("round", "Rounding", 0, 100, 45)),
      when("body", ["polygon"], R("sides", "Sides", 3, 16, 6)),
      when("body", BUMPY, R("bumps", "Bumps", 3, 48, 12)),
      when("body", BUMPY, R("bumpDepth", "Bump depth", 2, 60, 18)),
      R("wobble", "Hand-drawn", 0, 100, 0),
    ],
  },
  {
    title: "Tail",
    items: [
      steady(Ch("tail", "Kind", [["none", "None"], ["point", "Point"], ["curved", "Curved"], ["zigzag", "Zigzag"], ["bubbles", "Thought bubbles"]], "point")),
      R("tipX", "Tip across", 0, 100, 24),
      R("tipY", "Tip down", 0, 100, 96),
      when("tail", ["point", "curved", "zigzag"], R("tailW", "Base width", 1, 40, 12)),
      when("tail", ["curved"], R("bend", "Bend", -80, 80, 28)),
      when("tail", ["point", "curved", "zigzag"], R("tailShift", "Base shift", -60, 60, 0)),
      when("tail", ["bubbles"], R("bubbles", "Bubbles", 1, 8, 3)),
      when("tail", ["bubbles"], R("bubbleSize", "Bubble size", 1, 20, 7)),
      steady(Ch("second", "Second tail", [["off", "Off"], ["on", "On"]], "off")),
      when("second", ["on"], R("tip2X", "Tip 2 across", 0, 100, 78)),
      when("second", ["on"], R("tip2Y", "Tip 2 down", 0, 100, 96)),
    ],
  },
  {
    title: "Links",
    items: [
      steady(R("count", "Balloons", 1, 6, 1)),
      steady(Ch("arrange", "Arranged", [["row", "Row"], ["column", "Column"], ["stairs", "Stairs"], ["zigzag", "Zigzag"]], "stairs")),
      R("shrink", "Next size", 40, 100, 85),
      Ch("link", "Connector", [["neck", "Neck"], ["pinch", "Pinched"], ["line", "Line"], ["dots", "Dots"], ["none", "None"]], "neck"),
      when("link", ["neck", "pinch", "dots"], R("neckW", "Link width", 1, 40, 12)),
      when("link", ["dots"], R("linkDots", "Link dots", 1, 8, 3)),
      steady(Ch("tailOn", "Tail on", [["first", "First"], ["last", "Last"], ["all", "Each"]], "first")),
    ],
  },
  {
    title: "Outline",
    items: [
      R("weight", "Width", 0, 30, 5),
      steady(Ch("style", "Style", [["solid", "Solid"], ["double", "Double"], ["dashed", "Dashed"]], "solid")),
      when("style", ["double"], R("gap", "Gap", 1, 40, 10)),
      when("style", ["dashed"], R("dash", "Dash length", 2, 80, 45)),
      when("style", ["dashed"], R("dashGap", "Dash gap", 2, 80, 30)),
      R("shadowX", "Shadow across", 0, 60, 0),
      R("shadowY", "Shadow down", 0, 60, 0),
    ],
  },
];

function run(v: Values, rng: Rng, w: number, h: number): GenShape[] {
  const { n, s, c } = reader(v);
  const fill = c("fill"), ink = c("ink"), shadow = c("shadow");
  const weight = n("weight");
  const count = Math.max(1, Math.round(n("count")));
  const arrange = s("arrange");
  const body = s("body");
  // Nothing may reach past the box (a sheet cuts what does): room for the outline's corners and the shadow.
  const unit = Math.min(w, h);
  const room = Math.min(unit / 4, weight * 2 + (Math.max(n("shadowX"), n("shadowY")) / 1000) * unit + 1 * (unit > 8 ? 1 : 0));
  const keep = (x: number, y: number): P => [Math.min(w - room, Math.max(room, x)), Math.min(h - room, Math.max(room, y))];
  const tips: P[] = [keep((n("tipX") / 100) * w, (n("tipY") / 100) * h)];
  if (s("second") === "on") tips.push(keep((n("tip2X") / 100) * w, (n("tip2Y") / 100) * h));
  const tail = s("tail");
  // Each balloon's middle and half-sizes: one where the settings say, more spread over the box and getting smaller.
  const cells: Array<{ c: P; rx: number; ry: number }> = [];
  const rx0 = (n("bodyW") / 100) * w * 0.5, ry0 = (n("bodyH") / 100) * h * 0.5;
  const cx0 = (n("bodyX") / 100) * w, cy0 = (n("bodyY") / 100) * h;
  const shrink = n("shrink") / 100;
  /** A balloon's place, moved and made smaller as far as it takes to stay inside the box (the hand-drawn wobble's reach counted). */
  const fit = (x: number, y: number, rx: number, ry: number): { c: P; rx: number; ry: number } => {
    const reach = 1 + (n("wobble") / 100) * 0.23;
    const fx = Math.max(0.5, Math.min(rx * reach, w / 2 - room)), fy = Math.max(0.5, Math.min(ry * reach, h / 2 - room));
    return { c: [Math.min(w - room - fx, Math.max(room + fx, x)), Math.min(h - room - fy, Math.max(room + fy, y))], rx: fx / reach, ry: fy / reach };
  };
  if (count === 1) cells.push(fit(cx0, cy0, rx0, ry0));
  else {
    for (let i = 0; i < count; i++) {
      const k = shrink ** i;
      const t = (i + 0.5) / count;
      const rowLike = arrange === "row" || arrange === "stairs";
      const x = arrange === "column" ? cx0 : arrange === "zigzag" ? (i % 2 ? 0.68 : 0.32) * w : t * w;
      const y = arrange === "row" ? cy0 : t * h * (tail === "none" || tail === "bubbles" ? 1 : 0.88);
      const rx = (rowLike ? (w / count) * (arrange === "stairs" ? 0.56 : 0.42) : Math.min(rx0, w * 0.3)) * k;
      const ry = (arrange === "row" ? ry0 : (h / count) * (arrange === "stairs" ? 0.56 : 0.36)) * k;
      cells.push(fit(x, y, rx, ry));
    }
  }
  const tailOn = s("tailOn");
  const outlines = cells.map((cell, i) => {
    let pts = wobbled(bodyOf(body, cell.c[0], cell.c[1], cell.rx, cell.ry, n("round"), Math.max(3, Math.round(n("bumps"))), n("bumpDepth"), Math.max(3, Math.round(n("sides"))), rng), cell.c[0], cell.c[1], n("wobble"), rng);
    if (area(pts) < 0) pts = [...pts].reverse();
    if (tail !== "none" && tail !== "bubbles" && (count === 1 || tailOn === "all" || (tailOn === "first" ? i === 0 : i === count - 1))) {
      // (linked: each tail points the way the settings say from its own balloon, so it never runs across the others)
      const own = count === 1 ? tips : tips.map(([x, y]) => keep(cell.c[0] + ((x - cx0) * cell.rx) / rx0, cell.c[1] + ((y - cy0) * cell.ry) / ry0));
      for (const tip of own) pts = withTail(pts, cell.c, tip, tail, (n("tailW") / 100) * Math.min(w, h) * 1.4, n("bend"), (n("tailShift") * Math.PI) / 180);
    }
    return pts;
  });
  // What joins the balloons: under them; a neck or pinch is drawn outlined first and covered, so one outline goes round the whole.
  const link = s("link");
  const links: SubPath[] = [];
  const beads: SubPath[] = [];
  const lines: SubPath[] = [];
  for (let i = 0; i + 1 < cells.length && link !== "none"; i++) {
    const A = cells[i]!, B = cells[i + 1]!;
    const d = dist(A.c, B.c) || 1;
    const nx = -(B.c[1] - A.c[1]) / d, ny = (B.c[0] - A.c[0]) / d;
    const half = (n("neckW") / 200) * unit;
    if (link === "neck") links.push(poly([[A.c[0] + nx * half, A.c[1] + ny * half], [B.c[0] + nx * half, B.c[1] + ny * half], [B.c[0] - nx * half, B.c[1] - ny * half], [A.c[0] - nx * half, A.c[1] - ny * half]]));
    else if (link === "pinch") {
      const side = (sg: number, from: P, to: P): P[] => Array.from({ length: 13 }, (_, k) => {
        const t = k / 12;
        const waist = 1 - 0.65 * Math.sin(t * Math.PI);
        const p = lerp(from, to, t);
        return [p[0] + sg * nx * half * waist, p[1] + sg * ny * half * waist] as P;
      });
      links.push(poly([...side(1, A.c, B.c), ...side(-1, B.c, A.c)]));
    } else if (link === "line") lines.push(curve([A.c, B.c]));
    else if (link === "dots") {
      const many = Math.max(1, Math.round(n("linkDots")));
      for (let k = 0; k < many; k++) {
        // (in the gap between the two balloons, as many as fit there)
        const dx = B.c[0] - A.c[0], dy = B.c[1] - A.c[1];
        const from = 1 / Math.hypot(dx / A.rx, dy / A.ry), to = 1 - 1 / Math.hypot(dx / B.rx, dy / B.ry);
        const r = Math.min(half, Math.max(0, to - from) * d / (2.4 * many));
        if (r > 0.2) {
          const p = lerp(A.c, B.c, from + ((to - from) * (k + 0.5)) / many);
          beads.push(ellipse(p[0], p[1], r, r));
        }
      }
    }
  }
  const stroke = weight > 0 ? ink : null;
  const out: GenShape[] = [];
  const whole = [...outlines.map((p) => poly(p)), ...links];
  if (shadow && (n("shadowX") || n("shadowY"))) {
    const dx = (n("shadowX") / 1000) * unit, dy = (n("shadowY") / 1000) * unit;
    const moved = (o: SubPath): SubPath => ({ ...o, n: o.n.map((x, i) => x + (i % 2 ? dy : dx)) });
    out.push({ sub: [...whole, ...beads].map(moved), fill: shadow, stroke: null, width: 1, name: "Balloon shadow" });
  }
  const dashed = s("style") === "dashed";
  if (lines.length && stroke) out.push({ sub: lines, fill: null, stroke, width: weight, name: "Connector" });
  if (links.length) out.push({ sub: links, fill, stroke, width: weight, name: "Connector" });
  if (beads.length) out.push({ sub: beads, fill, stroke, width: weight, name: "Connector" });
  outlines.forEach((p, i) => out.push({ sub: [poly(p)], fill, stroke: dashed ? null : stroke, width: weight, name: count > 1 ? `Balloon ${i + 1}` : "Balloon" }));
  if (links.length && fill) out.push({ sub: links, fill, stroke: null, width: 1, name: "Connector inside" });
  if (dashed && stroke) out.push({ sub: outlines.flatMap((p) => dashes(p, (n("dash") / 1000) * unit, (n("dashGap") / 1000) * unit)), fill: null, stroke, width: weight, name: "Outline" });
  if (s("style") === "double" && stroke) {
    const gap = (n("gap") / 1000) * unit;
    out.push({ sub: outlines.map((p, i) => {
      const cell = cells[i]!;
      const kx = Math.max(0.1, 1 - gap / cell.rx), ky = Math.max(0.1, 1 - gap / cell.ry);
      return poly(p.map(([x, y]) => [cell.c[0] + (x - cell.c[0]) * kx, cell.c[1] + (y - cell.c[1]) * ky] as P));
    }), fill: null, stroke, width: weight * 0.6, name: "Inner outline" });
  }
  if (tail === "bubbles") {
    const first = tailOn === "last" ? cells[count - 1]! : cells[0]!;
    const many = Math.max(1, Math.round(n("bubbles")));
    const r0 = (n("bubbleSize") / 100) * unit;
    for (const tip of tips) {
      const dx = first.c[0] - tip[0], dy = first.c[1] - tip[1];
      const a = Math.atan2(dy / first.ry, dx / first.rx);
      const edge: P = [first.c[0] - first.rx * Math.cos(a), first.c[1] - first.ry * Math.sin(a)];
      const sub = Array.from({ length: many }, (_, i) => {
        const t = many === 1 ? 0.5 : i / (many - 1);
        const p = lerp(tip, edge, 0.08 + t * 0.78);
        const r = r0 * (0.4 + 0.6 * t);
        return ellipse(p[0], p[1], r, r * 0.85);
      });
      out.push({ sub, fill, stroke, width: weight, name: "Thought bubbles" });
    }
  }
  // (what has neither fill nor outline is nothing to draw; with both turned off, a thin line, so the balloon can still be seen and picked)
  const seen = out.filter((o) => o.fill !== null || o.stroke !== null).map((o) => (o.width > 0 ? o : { ...o, width: 1 }));
  return seen.length ? seen : [{ sub: whole, fill: null, stroke: "#111111", width: 1, name: "Balloon" }];
}

export const BALLOONS: readonly Generator[] = [
  { id: "speech-balloon", label: "Speech Balloon", about: "A balloon of many shapes, with tails, thought bubbles, and balloons linked to each other.", family: "Balloons", guide: true, sections: SECTIONS, run },
];
