import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFont } from "../../src/text/font";
import { setFont } from "../../src/text/layout";
import { boxOf, cameraFor, moved, objectsOf, placeOnPage, scaled, shapeObject, stored, validObjects } from "../../src/paint/objects";
import { worldToScreen } from "../../src/core/camera";
import * as D from "../../src/core/dyadic";

beforeAll(() => setFont(parseFont(new Uint8Array(readFileSync("node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf")))));

const look = { fill: "#ff0000", stroke: null, width: 2, sides: 6, tips: 5 };

describe("the canvas's objects on a page (ADR 0166)", () => {
  it("a page px is a world unit: the camera puts page px where the Painting view's placement says", () => {
    const at = { scale: 2.5, x: 40, y: -10 };
    const cam = cameraFor(at, { width: 800, height: 600 });
    const s = worldToScreen(cam, { width: 800, height: 600 }, { x: D.fromNumber(100), y: D.fromNumber(50) });
    expect(s.x).toBeCloseTo(100 * 2.5 + 40, 3);
    expect(s.y).toBeCloseTo(50 * 2.5 - 10, 3);
  });

  it("a shape drawn on a page has its box in page px, moves and scales, and reads back as the canvas stores it", () => {
    const r = shapeObject("rect", 300, 200, 100, 50, look);
    expect(boxOf([r])).toEqual({ x: 100, y: 50, w: 200, h: 150 });
    expect(boxOf(moved([r], 10, -5))).toEqual({ x: 110, y: 45, w: 200, h: 150 });
    const b = boxOf(scaled([r], 100, 50, 2, 0.5))!;
    expect([b.x, b.y, b.w, b.h].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([100, 50, 400, 75]);
    const list = stored([r, shapeObject("ellipse", 5, 5, 40, 40, look)]);
    expect(validObjects(list)).toBe(true);
    expect(objectsOf(list).map((o) => o.kind)).toEqual(["path", "path"]);
    expect(validObjects([{ kind: "nonsense" }])).toBe(false);
  });

  it("objects from the canvas come at the size they were seen, made smaller to fit the page, centred", () => {
    const r = shapeObject("ellipse", 0, 0, 10, 5, look); // 10 × 5 world units
    const seen = placeOnPage([r], 2, { w: 1000, h: 1000 }); // seen at 4×: 40 × 20 px
    const b = boxOf(seen)!;
    expect([b.w, b.h].map((v) => Math.round(v))).toEqual([40, 20]);
    expect(Math.round(b.x + b.w / 2)).toBe(500);
    const big = boxOf(placeOnPage([r], 10, { w: 1000, h: 1000 }))!; // 10240 px: fitted to 80 %
    expect(Math.round(big.w)).toBe(800);
  });
});
