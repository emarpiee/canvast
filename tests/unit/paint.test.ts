import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { TURN } from "../../src/core/angle";
import { lookAt } from "../../src/core/camera";
import type { PathObject } from "../../src/doc/model";
import { InvalidObjectError, deserializeObject, newObjectId, serializeObject, validateObject } from "../../src/doc/model";
import type { Gradient } from "../../src/doc/paint";
import { angleOf, asKind, colourOfPaintAt, gradientFrom, inkOfPaint, isPaint, linearAt, paintCss, paintFromText, paintToText, rgbaOf, sliceStops, stopsAt } from "../../src/doc/paint";
import { rectSubs } from "../../src/doc/path";
import { boxToLocal, canvasPaint, localToBox, paintAt } from "../../src/render/gradient";
import { classifyCoarse } from "../../src/render/coarse";
import { projectionFor } from "../../src/render/projection";

const RED_BLUE: Gradient = { type: "linear", x0: 0, y0: 0.5, x1: 1, y1: 0.5, stops: [{ o: 0, c: "#ff0000" }, { o: 1, c: "#0000ff" }] };
const path = (fill: PathObject["fill"], extra: Partial<PathObject> = {}): PathObject => ({ id: newObjectId(), kind: "path", anchor: { x: D.ZERO, y: D.ZERO }, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, sub: rectSubs(0, 0, 200, 100), fill, stroke: null, width: 2, ...extra });
const VP = { width: 800, height: 600 };

describe("paints", () => {
  it("accepts colours and well-formed gradients, and refuses the rest", () => {
    expect(isPaint("#112233")).toBe(true);
    expect(isPaint("#11223344")).toBe(true);
    expect(isPaint(RED_BLUE)).toBe(true);
    expect(isPaint({ type: "radial", cx: 0.5, cy: 0.5, r: 0.5, stops: RED_BLUE.stops })).toBe(true);
    for (const bad of [
      "red", null, 3, {}, { ...RED_BLUE, stops: [RED_BLUE.stops[0]] },
      { ...RED_BLUE, stops: [{ o: 0.6, c: "#000000" }, { o: 0.4, c: "#ffffff" }] }, // out of order
      { ...RED_BLUE, stops: [{ o: -0.1, c: "#000000" }, { o: 1, c: "#ffffff" }] },
      { ...RED_BLUE, stops: [{ o: 0, c: "#00" }, { o: 1, c: "#ffffff" }] },
      { ...RED_BLUE, x1: 0, y1: 0.5 }, // no length
      { type: "radial", cx: 0, cy: 0, r: 0, stops: RED_BLUE.stops },
      { ...RED_BLUE, x0: Infinity },
      { ...RED_BLUE, stops: Array.from({ length: 33 }, (_, i) => ({ o: i / 32, c: "#000000" })) },
    ]) expect(isPaint(bad), JSON.stringify(bad)).toBe(false);
  });
  it("blends stops as a browser does (premultiplied), holds the end colours, and slices without moving a colour", () => {
    const mid = stopsAt(RED_BLUE.stops, 0.5);
    expect(mid.map(Math.round)).toEqual([128, 0, 128, 1]);
    expect(stopsAt(RED_BLUE.stops, -3)).toEqual(rgbaOf("#ff0000"));
    expect(stopsAt(RED_BLUE.stops, 9)).toEqual(rgbaOf("#0000ff"));
    // a fade to nothing keeps its colour, not a grey: red at half alpha, not half red
    const fade = stopsAt([{ o: 0, c: "#ff0000" }, { o: 1, c: "#ff000000" }], 0.5);
    expect(fade.slice(0, 3)).toEqual([255, 0, 0]);
    expect(fade[3]).toBeCloseTo(0.5, 6);
    const three = [{ o: 0, c: "#000000" }, { o: 0.5, c: "#ff0000" }, { o: 1, c: "#ffffff" }];
    const cut = sliceStops(three, 0.25, 0.75);
    expect(cut).toHaveLength(3);
    expect(cut[0]!.c).toBe(colourOfPaintAt({ ...RED_BLUE, stops: three }, 0.25));
    expect(cut[1]).toEqual({ o: 0.5, c: "#ff0000" });
    expect(cut[2]!.c).toBe(colourOfPaintAt({ ...RED_BLUE, stops: three }, 0.75));
    expect(sliceStops(three, 0.3, 0.3)[0]!.c).toBe(sliceStops(three, 0.3, 0.3)[1]!.c); // a span of nothing is one colour
  });
  it("angles, kinds, text and CSS", () => {
    for (const deg of [0, 30, 90, 135, 270, 359]) expect(angleOf(linearAt(deg, RED_BLUE.stops))).toBeCloseTo(deg, 6);
    const fade = gradientFrom("#2563eb", "linear");
    expect(fade.stops.map((s) => s.c)).toEqual(["#2563eb", "#2563eb00"]);
    expect(asKind(fade, "radial").type).toBe("radial");
    expect(asKind(fade, "radial").stops).toBe(fade.stops);
    expect(paintFromText(paintToText(RED_BLUE))).toEqual(RED_BLUE);
    expect(paintFromText("none")).toBeNull();
    expect(paintFromText("#abc")).toBeUndefined();
    expect(paintFromText("{nope")).toBeUndefined();
    expect(paintCss(RED_BLUE)).toMatch(/^linear-gradient\(90deg, #ff0000 0%, #0000ff 100%\)$/);
    expect(paintCss(asKind(RED_BLUE, "radial"))).toMatch(/^radial-gradient\(circle at 50% 50%/);
    const avg = inkOfPaint(RED_BLUE);
    expect(avg.alpha).toBe(1);
    expect(avg.rgb).toBe("#800080");
    expect(inkOfPaint(fade).alpha).toBeCloseTo(0.5, 6);
  });
});

describe("gradients on paths", () => {
  it("validate, serialize and come back, as part of the path", () => {
    const o = path(RED_BLUE, { stroke: asKind(RED_BLUE, "radial") });
    expect(validateObject(o)).toBe(o);
    expect(deserializeObject(JSON.parse(JSON.stringify(serializeObject(o))))).toEqual(o);
    expect(() => validateObject(path({ ...RED_BLUE, stops: [] } as unknown as Gradient))).toThrow(InvalidObjectError);
  });
  it("box units are the geometry box, turned with the path, and back", () => {
    const o = path(RED_BLUE, { rot: TURN / 8 });
    for (const [u, v] of [[0, 0], [1, 1], [0.3, 0.8], [-0.5, 1.5]] as const) {
      const [x, y] = boxToLocal(o, u, v);
      const [a, b] = localToBox(o, x, y);
      expect(a).toBeCloseTo(u, 9);
      expect(b).toBeCloseTo(v, 9);
    }
    const plain = path(RED_BLUE);
    expect(boxToLocal(plain, 1, 0.5)).toEqual([200, 50]);
    // a quarter turn: the left-to-right gradient runs top to bottom
    const quarter = path(RED_BLUE, { rot: TURN / 4 });
    const start = boxToLocal(quarter, 0, 0.5);
    const end = boxToLocal(quarter, 1, 0.5);
    expect(Math.abs(end[0] - start[0])).toBeLessThan(1e-9);
    expect(Math.abs(end[1] - start[1])).toBeCloseTo(200, 6);
  });
  it("paintAt: the colour of a local point", () => {
    const o = path(RED_BLUE);
    expect(paintAt(o, o.fill!, 0, 50)).toBe("#ff0000");
    expect(paintAt(o, o.fill!, 200, 50)).toBe("#0000ff");
    expect(paintAt(o, o.fill!, 100, 0)).toBe("#800080");
    expect(paintAt(o, "#123456", 5, 5)).toBe("#123456");
  });
});

/** A context that records the gradients asked of it. */
function recorder() {
  const calls: Array<{ kind: "linear" | "radial"; args: number[]; stops: Array<[number, string]> }> = [];
  const ctx = {
    createLinearGradient: (...args: number[]) => {
      const c = { kind: "linear" as const, args, stops: [] as Array<[number, string]> };
      calls.push(c);
      return { addColorStop: (o: number, col: string) => c.stops.push([o, col]) };
    },
    createRadialGradient: (...args: number[]) => {
      const c = { kind: "radial" as const, args, stops: [] as Array<[number, string]> };
      calls.push(c);
      return { addColorStop: (o: number, col: string) => c.stops.push([o, col]) };
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}
const view = (o: PathObject, x: number, y: number, zi: number) => projectionFor(lookAt({ x: D.fromNumber(x), y: D.fromNumber(y) }, zi, 0), VP, o.anchor, o.unit);

describe("what the canvas is given", () => {
  it("a linear gradient becomes the part the view can show: ends a view's half diagonal either side of the centre, stops cut to match", () => {
    const o = path(RED_BLUE);
    const { ctx, calls } = recorder();
    canvasPaint(ctx, o, o.fill!, view(o, 100, 50, 0), VP); // the view centred on the middle of the shape, 1 px a unit
    const [c] = calls;
    const hv = Math.hypot(VP.width, VP.height) / 2 + 8;
    expect(c!.args[0]).toBeCloseTo(400 - hv, 6); // along x: the axis runs left to right
    expect(c!.args[2]).toBeCloseTo(400 + hv, 6);
    expect(c!.args[1]).toBeCloseTo(300, 6);
    // the colour at the left end is the colour of the gradient hv px left of the middle: offset 0.5 - hv / 200, clamped by the end stop
    expect(c!.stops[0]![1]).toBe(colourOfPaintAt(RED_BLUE, 0.5 - hv / 200));
    expect(c!.stops.at(-1)![1]).toBe(colourOfPaintAt(RED_BLUE, 0.5 + hv / 200));
  });
  it("at depth the span is nothing: one colour, the gradient's colour at the centre, at any zoom", () => {
    const o = path(RED_BLUE);
    for (const zi of [60, 1000, 100_000]) {
      const { ctx, calls } = recorder();
      canvasPaint(ctx, o, o.fill!, view(o, 50, 50, zi), VP); // a quarter of the way along
      const cols = new Set(calls[0]!.stops.map((s) => s[1]));
      expect(cols.size, `zi ${zi}`).toBe(1);
      expect([...cols][0]).toBe(colourOfPaintAt(RED_BLUE, 0.25));
    }
  });
  it("a radial gradient near the view is true rings with radii in px of the distance; far away it is linear along the way to it", () => {
    const g: Gradient = { type: "radial", cx: 0.5, cy: 0.5, r: 0.5, stops: RED_BLUE.stops };
    const o = path(g);
    let r = recorder();
    canvasPaint(r.ctx, o, g, view(o, 150, 50, 0), VP); // 50 units right of the centre (100, 50), 1 px a unit
    expect(r.calls[0]!.kind).toBe("radial");
    const hv = Math.hypot(VP.width, VP.height) / 2 + 8;
    expect(r.calls[0]!.args[0]).toBeCloseTo(400 - 50, 6); // the centre is 50 px left of the view's middle
    expect(r.calls[0]!.args[2]).toBeCloseTo(0, 6); // r0: the view reaches the centre (hv > 50)
    expect(r.calls[0]!.args[5]).toBeCloseTo(50 + hv, 6);
    r = recorder();
    canvasPaint(r.ctx, o, g, view(o, 100 + 2 ** 30, 50, 0), VP); // a billion units away: straight across the view
    expect(r.calls[0]!.kind).toBe("linear");
    expect(r.calls[0]!.args[0]).toBeLessThan(400); // along +x, the way from the centre
    expect(r.calls[0]!.args[2]).toBeGreaterThan(400);
    expect(new Set(r.calls[0]!.stops.map((s) => s[1])).size).toBe(1); // 10^9 units out, past the radius: the end colour
  });
  it("no length is the first stop; a solid colour is itself", () => {
    const o = path("#abcdef");
    const { ctx, calls } = recorder();
    expect(canvasPaint(ctx, o, "#abcdef", view(o, 0, 0, 0), VP)).toBe("#abcdef");
    expect(calls).toHaveLength(0);
  });
});

describe("a gradient seen from far below (render/coarse.ts)", () => {
  it("a view inside the fill takes the gradient's colour at its centre", () => {
    const o = path(RED_BLUE);
    const at = (x: number) => classifyCoarse(o, { x: D.fromNumber(x), y: D.fromNumber(50) }, { errLog2: -208, zTrue: 5000 }, VP);
    expect(at(0.001)).toEqual({ color: colourOfPaintAt(RED_BLUE, 0.001 / 200) });
    expect(at(100)).toEqual({ color: "#800080" });
    expect(at(199.5)).toEqual({ color: colourOfPaintAt(RED_BLUE, 199.5 / 200) });
  });
});
