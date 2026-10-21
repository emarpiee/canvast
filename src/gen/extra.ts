import { curve, ellipse, line, merged, poly, rotated, solid } from "./geom";
import type { P } from "./geom";
import { C, Ch, LOOSE, R, reader } from "./kit";
import { alpha, makeNoise, mix, quant } from "./rng";
import type { Generator, GenShape } from "./types";
import type { SubPath } from "./core";

export const grain: Generator = {
  id: "grain", label: "Grain", family: "Soft", about: "Fine speckle, like film or paper",
  sections: [
    { title: "Colour", items: [C("fill", "Speckle", "#ffffff"), C("fill2", "Second tone", "#5b7aa6", true)] },
    { title: "Grain", items: [R("count", "Amount", 100, 3000, 1200, 50), R("size", "Size", 1, 20, 4), R("contrast", "Contrast", 0, 100, 60)] },
  ],
  run(v, rng, w, h) {
    const { n, c } = reader(v);
    const a: SubPath[] = [], b: SubPath[] = [], s = Math.min(w, h) * 0.004 * n("size");
    for (let i = 0; i < n("count"); i++) {
      const r = s * (1 - (n("contrast") / 100) * rng() * 0.8) * 0.5, x = rng() * w, y = rng() * h;
      (i % 3 === 0 && c("fill2") ? b : a).push(poly([[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]]));
    }
    return [solid(a, c("fill")!, "Speckle"), ...(b.length ? [solid(b, c("fill2")!, "Second tone")] : [])];
  },
};

export const halftone: Generator = {
  id: "halftone", label: "Halftone", family: "Lines", about: "Dots that grow along a direction, like print",
  sections: [
    { title: "Variants", items: [Ch("shape", "Mark", [["dot", "Dot"], ["square", "Square"], ["diamond", "Diamond"]], "dot")] },
    { title: "Colour", items: [C("fill", "Marks", "#ff5d73")] },
    { title: "Halftone", items: [R("cols", "Across", 4, 60, 22), R("angle", "Direction", 0, 360, 30), R("min", "Smallest", 0, 60, 6), R("max", "Largest", 20, 100, 95), R("turn", "Grid angle", 0, 90, 45), LOOSE] },
  ],
  run(v, rng, w, h) {
    const { n, s, c } = reader(v);
    const cell = w / n("cols"), cx = w / 2, cy = h / 2, d = Math.hypot(w, h), a = (n("angle") * Math.PI) / 180, g = (n("turn") * Math.PI) / 180, m = Math.ceil(d / cell / 2) + 1, out: SubPath[] = [];
    for (let j = -m; j <= m; j++) for (let i = -m; i <= m; i++) {
      const lj = n("jitter") / 100; // (looseness: each mark off its place and its size)
      const [[x0, y0]] = rotated([[cx + i * cell, cy + j * cell]], cx, cy, g) as [P];
      const x = x0 + (lj ? (rng() - 0.5) * cell * 0.5 * lj : 0), y = y0 + (lj ? (rng() - 0.5) * cell * 0.5 * lj : 0), sz = 1 + (lj ? (rng() - 0.5) * 0.8 * lj : 0);
      if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue;
      const t = Math.min(1, Math.max(0, 0.5 + ((x - cx) * Math.cos(a) + (y - cy) * Math.sin(a)) / d));
      const r = (cell / 2) * (n("min") / 100 + (n("max") / 100 - n("min") / 100) * t) * 1.1 * sz;
      if (r < cell * 0.01) continue;
      out.push(s("shape") === "dot" ? ellipse(x, y, r, r) : poly(rotated(s("shape") === "square" ? [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]] : [[x, y - r * 1.2], [x + r * 1.2, y], [x, y + r * 1.2], [x - r * 1.2, y]], x, y, s("shape") === "square" ? g : 0)));
    }
    return [solid(out, c("fill")!, "Marks")];
  },
};

export const marble: Generator = {
  id: "marble", label: "Marble", family: "Fields", about: "Flowing veins like polished stone",
  sections: [
    { title: "Colour", items: [C("from", "Veins", "#e2e8f0"), C("to", "Deep veins", "#7c3aed")] },
    { title: "Marble", items: [R("veins", "Veins", 3, 60, 32), R("swirl", "Swirl", 0, 100, 55), R("scale", "Scale", 1, 8, 2), R("weight", "Thickness", 1, 30, 12), R("angle", "Angle", 0, 180, 20)] },
  ],
  run(v, rng, w, h) {
    const { n } = reader(v);
    const noise = makeNoise(rng.int(1, 1e9)), s = Math.max(w, h), cx = w / 2, cy = h / 2, a = (n("angle") * Math.PI) / 180, out: GenShape[] = [];
    for (let i = 0; i < n("veins"); i++) {
      const base = ((i + rng()) / n("veins") - 0.5) * s * 1.6 + h / 2, pts: P[] = [];
      for (let k = 0; k <= 28; k++) {
        const x = -s * 0.3 + (s * 1.6 * k) / 28;
        pts.push([x, base + (noise(x / s * n("scale") * 2, base / s * n("scale")) - 0.5) * s * (n("swirl") / 100) * 1.4]);
      }
      const col = mix(v["from"] as string, v["to"] as string, quant(noise(i * 0.37, 3.1), 5));
      out.push(line([{ n: curve(rotated(pts, cx, cy, a)).n, closed: false }], alpha(col, 0.35 + 0.65 * rng()), (n("weight") / 100) * s * 0.03 * (0.3 + rng()) ));
    }
    return merged(out);
  },
};

export const aurora: Generator = {
  id: "aurora", label: "Aurora", family: "Soft", about: "Tall, soft curtains of light",
  sections: [
    { title: "Colour", items: [C("from", "From", "#22d3a0"), C("to", "To", "#8b5cf6")] },
    { title: "Curtains", items: [R("count", "Count", 1, 12, 5), R("width", "Width", 5, 60, 22), R("sway", "Sway", 0, 100, 45), R("glow", "Brightness", 10, 100, 70)] },
  ],
  run(v, rng, w, h) {
    const { n } = reader(v);
    const out: GenShape[] = [];
    for (let i = 0; i < n("count"); i++) {
      const x0 = rng() * w, bw = (n("width") / 100) * w * (0.5 + rng()), col = mix(v["from"] as string, v["to"] as string, rng()), m = 7;
      const mid: P[] = Array.from({ length: m }, (_, k): P => [x0 + Math.sin(k * 1.1 + rng() * 2) * w * (n("sway") / 100) * 0.15, -h * 0.1 + (h * 1.2 * k) / (m - 1)]);
      const left = mid.map(([x, y]): P => [x - bw / 2, y]), right = mid.map(([x, y]): P => [x + bw / 2, y]).reverse();
      out.push({ sub: [{ n: curve([...left, ...right], 1).n, closed: true }], fill: { type: "linear", x0: 0, y0: 0, x1: 0, y1: 1, stops: [{ o: 0, c: alpha(col, 0) }, { o: 0.45, c: alpha(col, n("glow") / 100) }, { o: 1, c: alpha(col, 0) }] }, stroke: null, width: 1, name: `Curtain ${i + 1}` });
    }
    return out;
  },
};

export const strands: Generator = {
  id: "strands", label: "Strands", family: "Lines", about: "Many fine wavy lines side by side",
  sections: [
    { title: "Colour", items: [C("from", "From", "#38bdf8"), C("to", "To", "#f472b6")] },
    { title: "Strands", items: [R("count", "Lines", 3, 80, 28), R("crests", "Waves", 1, 12, 3), R("amp", "Height", 0, 40, 10), R("drift", "Drift", 0, 100, 40), R("weight", "Line width", 1, 20, 4)] },
  ],
  run(v, rng, w, h) {
    const { n } = reader(v);
    const out: GenShape[] = [], m = n("crests") * 4 + 1, ph = rng() * Math.PI * 2;
    for (let i = 0; i < n("count"); i++) {
      const t = n("count") === 1 ? 0 : i / (n("count") - 1), y = (0.06 + 0.88 * t) * h;
      const pts = Array.from({ length: m }, (_, k): P => [(w * k) / (m - 1), y + Math.sin((k / (m - 1)) * n("crests") * Math.PI * 2 + ph + t * (n("drift") / 100) * 6) * (n("amp") / 100) * h * 0.5]);
      out.push(line([curve(pts)], mix(v["from"] as string, v["to"] as string, quant(t, 8)), (n("weight") / 100) * (h / n("count")) * 0.5));
    }
    return merged(out);
  },
};

export const EXTRA = [grain, halftone, marble, aurora, strands];
