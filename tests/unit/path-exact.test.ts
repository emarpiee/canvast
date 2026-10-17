import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { TURN, cosSin } from "../../src/core/angle";
import { lookAt } from "../../src/core/camera";
import type { PathObject } from "../../src/doc/model";
import { newObjectId, pathSubs } from "../../src/doc/model";
import { ellipseSubs, insideFill, rectSubs, type SubPath } from "../../src/doc/path";
import { projectObject, projectionFor } from "../../src/render/projection";
import { hitsObject } from "../../src/render/hit-test";
import { exactPath } from "../../src/render/path-exact";
import { pointInPolygon } from "../../src/render/geometry2d";

const VP = { width: 800, height: 600 };
const ORIGIN = { x: D.ZERO, y: D.ZERO };
const SIDE = 2 ** 16;
const path = (sub: SubPath[], extra: Partial<PathObject> = {}): PathObject => ({ id: newObjectId(), kind: "path", anchor: ORIGIN, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, sub, fill: "#2563eb", stroke: null, width: 4, ...extra });
const at = (x: number | D.Dyadic, y: number | D.Dyadic, zi: number) => lookAt({ x: typeof x === "number" ? D.fromNumber(x) : x, y: typeof y === "number" ? D.fromNumber(y) : y }, zi, 0);
const view = (o: PathObject, cam: ReturnType<typeof at>) => projectObject(o, cam, VP, { keepTiny: true })!;
const inside = (po: ReturnType<typeof view>, x: number, y: number) => insideFill(po.fillPath ?? po.path!, x, y, false);

describe("exact edges of a path much bigger than the view", () => {
  const square = path(rectSubs(0, 0, SIDE, SIDE));
  for (const zi of [60, 200, 3000]) {
    it(`a straight edge ${zi} levels in is within a pixel of where it is: ${zi} levels, left of it filled, right of it not`, () => {
      const po = view(square, at(SIDE, SIDE / 2, zi)); // the right edge through the middle of the view (400, 300)
      expect(po.fillPath).toBeDefined(); // the exact path, not a dimmed cover
      expect(po.cover).toBeUndefined();
      for (const dx of [-300, -40, -1, -0.25]) expect(inside(po, 400 + dx, 300), `x ${dx}`).toBe(true);
      for (const dx of [0.25, 1, 40, 300]) expect(inside(po, 400 + dx, 300), `x +${dx}`).toBe(false);
      expect(inside(po, 400 - 5, 100)).toBe(true);
      expect(inside(po, 400 + 5, 500)).toBe(false);
      expect(hitsObject(po, 380, 300)).toBe(true);
      expect(hitsObject(po, 420, 300)).toBe(false);
    });
  }
  it("a corner: filled in one quadrant only, at 60 and 3000 levels", () => {
    for (const zi of [60, 3000]) {
      const po = view(square, at(SIDE, SIDE, zi)); // the bottom-right corner at (400, 300)
      expect(inside(po, 380, 280), "up and left, inside").toBe(true);
      expect(inside(po, 420, 280), "right of it").toBe(false);
      expect(inside(po, 380, 320), "below it").toBe(false);
      expect(inside(po, 420, 320), "beyond the corner").toBe(false);
    }
  });
  it("a curve: the top of an ellipse, flat to the view, still has its inside below and its outside above", () => {
    const ellipse = path(ellipseSubs(0, 0, SIDE, SIDE));
    for (const zi of [60, 1000]) {
      const po = view(ellipse, at(SIDE / 2, 0, zi));
      expect(po.fillPath).toBeDefined();
      expect(inside(po, 400, 300 + 3)).toBe(true);
      expect(inside(po, 400, 300 - 3)).toBe(false);
      expect(inside(po, 100, 300 + 3)).toBe(true);
      expect(inside(po, 700, 300 - 3)).toBe(false);
    }
  });
  it("a turned edge: the side of a path turned by an eighth of a turn, from its own turned vertices", () => {
    const turned = { ...square, rot: TURN / 8 } as PathObject;
    const [s] = pathSubs(turned);
    const a = { x: s!.n[0]!, y: s!.n[1]! };
    const b = { x: s!.n[6]!, y: s!.n[7]! };
    const mid = { x: D.shift(D.add(D.fromNumber(a.x), D.fromNumber(b.x)), -1), y: D.shift(D.add(D.fromNumber(a.y), D.fromNumber(b.y)), -1) };
    // the edge's normal pointing into the square: towards its centre (the turn keeps it at SIDE / 2)
    const nx = SIDE / 2 - D.toNumber(mid.x);
    const ny = SIDE / 2 - D.toNumber(mid.y);
    const l = Math.hypot(nx, ny);
    const po = view(turned, at(mid.x, mid.y, 80));
    expect(inside(po, 400 + (6 * nx) / l, 300 + (6 * ny) / l)).toBe(true);
    expect(inside(po, 400 - (6 * nx) / l, 300 - (6 * ny) / l)).toBe(false);
    void cosSin;
  });
  it("a hole (an inner outline of the other direction) is found, with its far outer outline never placed", () => {
    const inner = rectSubs(SIDE / 4, SIDE / 4, SIDE / 2, SIDE / 2)[0]!;
    const rev: number[] = [];
    for (let i = inner.n.length / 6 - 1; i >= 0; i--) rev.push(...inner.n.slice(i * 6, i * 6 + 6));
    const holed = path([...rectSubs(0, 0, SIDE, SIDE), { n: rev, closed: true }]);
    const po = view(holed, at(SIDE / 4, SIDE / 2, 400)); // the hole's left edge: left of it filled, right of it empty
    expect(inside(po, 380, 300)).toBe(true);
    expect(inside(po, 420, 300)).toBe(false);
  });
  it("with no vertex near the view, the outline's turn round it alone decides: inside gives a full ring, outside nothing", () => {
    const o = path(rectSubs(0, 0, SIDE, SIDE));
    const run = (x: number, y: number, zi: number) => {
      const cam = at(x, y, zi);
      return exactPath(o, projectionFor(cam, VP, o.anchor, o.unit), VP, 0);
    };
    const inner = run(SIDE / 2, SIDE / 2, 300);
    expect(inner.fill).toHaveLength(1);
    expect(inner.lines).toHaveLength(0);
    expect(pointInPolygon(400, 300, inner.fill[0]!.pts)).toBe(true);
    expect(run(SIDE * 2, SIDE / 2, 300).fill).toHaveLength(0);
    // the same, with the view's centre exactly on the far side of the rectangle's centre: still one turn
    expect(run(SIDE / 2 + 1, SIDE / 2 - 1, 5000).fill).toHaveLength(1);
  });
});

describe("a wide outline on a straight-edged shape, drawn exactly at any width", () => {
  it("its band ends where it should: the view on the outer edge of a 2^10 wide line, 60 levels in", () => {
    const h = 2 ** 9; // half the width, in local units
    const o = path(rectSubs(0, 0, SIDE, SIDE), { fill: null, stroke: "#aa0000", width: 2 * h });
    const po = view(o, at(SIDE + h, SIDE / 2, 60)); // on the outer edge of the right-hand line
    expect(po.strokePolys?.length).toBeGreaterThan(0);
    expect(po.cover).toBeUndefined();
    const covered = (x: number, y: number) => po.strokePolys!.some((poly) => pointInPolygon(x, y, poly));
    expect(covered(400 - 30, 300)).toBe(true);
    expect(covered(400 + 30, 300)).toBe(false);
    expect(hitsObject(po, 400 - 20, 300)).toBe(true);
    expect(hitsObject(po, 400 + 20, 300)).toBe(false);
  });
});

describe("what stays as before", () => {
  it("a view wholly inside is the exact colour, one that misses draws nothing", () => {
    const o = path(rectSubs(0, 0, SIDE, SIDE), { fill: "#ff0000" });
    expect(view(o, at(SIDE / 2, SIDE / 2, 60)).cover).toEqual({ color: "#ff0000" });
    expect(projectObject(o, at(SIDE * 3, SIDE / 2, 60), VP, { keepTiny: true })).toBeNull();
  });
  it("a curve with a wide outline, which has no exact capsules, is still the dimmed stand-in with the edge in view", () => {
    const o = path(ellipseSubs(0, 0, SIDE, SIDE), { fill: "#00aa00", stroke: "#000000", width: 1024 });
    const po = view(o, at(SIDE / 2, -512, 60)); // on the outer edge of the line
    expect(po.cover?.dim).toBe(true);
  });
});

describe("fuzz: exact edges against exact comparisons", () => {
  it("random rectangles, random cameras near their edges and corners, 40 to 3000 levels in: every sampled point is on the right side", () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    let checked = 0;
    for (let n = 0; n < 150; n++) {
      const x0 = Math.floor(rnd() * 2 ** 14);
      const y0 = Math.floor(rnd() * 2 ** 14);
      const w = 2 ** 15 + Math.floor(rnd() * 2 ** 15);
      const h = 2 ** 15 + Math.floor(rnd() * 2 ** 15);
      const o = path(rectSubs(x0, y0, w, h));
      const zi = 40 + Math.floor(rnd() * 2960);
      // a camera on an edge or a corner (or a little off it), at an exact point
      const cxs = [x0, x0 + w, x0 + Math.floor(rnd() * w)];
      const cys = [y0, y0 + h, y0 + Math.floor(rnd() * h)];
      const px = cxs[Math.floor(rnd() * 3)]!;
      const py = cys[Math.floor(rnd() * 3)]!;
      const off = (rnd() - 0.5) * 300; // px of shift along x and y
      const cam = lookAt({ x: D.add(D.fromNumber(px), D.shift(D.fromNumber(off), -zi)), y: D.fromNumber(py) }, zi, 0);
      const po = projectObject(o, cam, VP, { keepTiny: true });
      const p = projectionFor(cam, VP, o.anchor, o.unit);
      for (let k = 0; k < 24; k++) {
        const sx = rnd() * VP.width;
        const sy = rnd() * VP.height;
        // the truth: the point's exact local position against the rectangle's sides
        const lx = D.add(p.lx, D.shift(D.fromNumber((sx - p.cx) / p.f), -p.e));
        const ly = D.add(p.ly, D.shift(D.fromNumber((sy - p.cy) / p.f), -p.e));
        const side = (v: D.Dyadic, a: number, b: number) => (D.cmp(v, D.fromNumber(a)) > 0 && D.cmp(v, D.fromNumber(b)) < 0 ? 1 : 0);
        const truth = side(lx, x0, x0 + w) && side(ly, y0, y0 + h) ? true : false;
        // skip points within 0.01 px of a side (the picture there is anti-aliased and the comparison is about pixels)
        const near = (v: D.Dyadic, a: number) => Math.abs(D.toNumber(D.shift(D.sub(v, D.fromNumber(a)), p.e)) * p.f) < 0.01;
        if (near(lx, x0) || near(lx, x0 + w) || near(ly, y0) || near(ly, y0 + h)) continue;
        const got = !po ? false : po.cover ? po.cover.color !== undefined : inside(po, sx, sy);
        expect(got, `zi ${zi}, camera (${px}, ${py}) + ${off.toFixed(1)} px, point (${sx.toFixed(2)}, ${sy.toFixed(2)})`).toBe(truth);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(2500);
  });
});
