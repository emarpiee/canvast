import type { GradientStop, Paint } from "./core";
import { ellipse, rect } from "./geom";
import { C, R, reader } from "./kit";
import { alpha, mix } from "./rng";
import type { Generator, GenShape } from "./types";

const fade = (c: string, soft: number): GradientStop[] => [{ o: 0, c: alpha(c, 1) }, { o: 0.5, c: alpha(c, 0.15 + 0.7 * (1 - soft)) }, { o: 1, c: alpha(c, 0) }];
const radial = (cx: number, cy: number, r: number, c: string, soft: number): Paint => ({ type: "radial", cx, cy, r, stops: fade(c, soft) });

export const glow: Generator = {
  id: "glow", label: "Glow", family: "Soft", about: "Soft clouds of colour",
  sections: [
    { title: "Colour", items: [C("from", "From", "#6a11ff"), C("to", "To", "#00d4a0")] },
    { title: "Clouds", items: [R("count", "Count", 1, 12, 5), R("size", "Size", 20, 160, 80), R("soft", "Softness", 0, 100, 70)] },
  ],
  run(v, rng, w, h) {
    const { n, c } = reader(v);
    const out: GenShape[] = [];
    for (let i = 0; i < n("count"); i++) {
      const r = (n("size") / 100) * Math.max(w, h) * (0.35 + 0.35 * rng()), cx = rng() * w, cy = rng() * h;
      out.push({ sub: [ellipse(cx, cy, r, r)], fill: radial(0.5, 0.5, 0.5, mix(c("from")!, c("to")!, rng()), n("soft") / 100), stroke: null, width: 1, name: `Cloud ${i + 1}` });
    }
    return out;
  },
};

export const blend: Generator = {
  id: "blend", label: "Blend", family: "Soft", about: "A smooth blend of several colours",
  sections: [
    { title: "Colour", items: [C("c1", "Colour 1", "#ff3d81"), C("c2", "Colour 2", "#3d5afe"), C("c3", "Colour 3", "#00e5ff"), C("c4", "Colour 4", "#ffd740")] },
    { title: "Blend", items: [R("angle", "Angle", 0, 360, 45), R("spots", "Spots", 0, 6, 3), R("soft", "Softness", 0, 100, 60)] },
  ],
  run(v, rng, w, h) {
    const { n, c } = reader(v);
    const a = (n("angle") * Math.PI) / 180, dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
    const out: GenShape[] = [{ sub: [rect(0, 0, w, h)], fill: { type: "linear", x0: 0.5 - dx, y0: 0.5 - dy, x1: 0.5 + dx, y1: 0.5 + dy, stops: [{ o: 0, c: c("c1")! }, { o: 1, c: c("c2")! }] }, stroke: null, width: 1, name: "Base" }];
    const spots = [c("c3")!, c("c4")!];
    for (let i = 0; i < n("spots"); i++) out.push({ sub: [rect(0, 0, w, h)], fill: radial(rng(), rng(), rng.range(0.35, 0.8), spots[i % 2]!, n("soft") / 100), stroke: null, width: 1, name: `Spot ${i + 1}` });
    return out;
  },
};

export const SOFT = [glow, blend];
