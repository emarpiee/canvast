import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import {
  CENTER_GUARD_BITS,
  HOME,
  PRECISION_BUDGET,
  deserializeCamera,
  lookAt,
  panBy,
  screenToWorld,
  serializeCamera,
  worldToScreen,
  zoomAt,
} from "../../src/core/camera";
import type { Camera, ScreenPoint, WorldPoint } from "../../src/core/camera";
import { firstLineOffset } from "../../src/render/canvas2d-renderer";
import { rng } from "./rng";

const VP = { width: 1280, height: 800 };

function dist(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function samePoint(a: WorldPoint, b: WorldPoint): boolean {
  return D.equals(a.x, b.x) && D.equals(a.y, b.y);
}

describe("world <-> screen", () => {
  it("round-trips screen points at any distance and zoom", () => {
    const r = rng(10);
    for (let i = 0; i < 300; i++) {
      const cam = lookAt(
        { x: D.fromBigInt(BigInt(Math.floor((r() - 0.5) * 1e9)), Math.floor((r() - 0.5) * 4000)), y: D.fromNumber(r()) },
        Math.floor((r() - 0.5) * 4000),
        r(),
      );
      const s = { x: r() * VP.width, y: r() * VP.height };
      const back = worldToScreen(cam, VP, screenToWorld(cam, VP, s));
      expect(dist(back, s)).toBeLessThan(1e-9);
    }
  });

  it("never yields NaN for far-away points", () => {
    const cam = lookAt({ x: D.ZERO, y: D.ZERO }, 3000);
    const far = worldToScreen(cam, VP, { x: D.fromBigInt(1n, 10), y: D.fromBigInt(-1n, 10) });
    expect(far.x).toBe(Infinity);
    expect(far.y).toBe(-Infinity);
  });
});

describe("anchored zoom", () => {
  it("keeps the world point under the pointer fixed across 2400 levels in and out", () => {
    const r = rng(20);
    let cam: Camera = HOME;
    let maxDrift = 0;
    for (let i = 0; i < 4800; i++) {
      const anchor = { x: r() * VP.width, y: r() * VP.height };
      const world = screenToWorld(cam, VP, anchor);
      const dz = (i < 2400 ? 1 : -1) * (0.25 + r() * 0.75);
      cam = zoomAt(cam, VP, anchor, dz);
      maxDrift = Math.max(maxDrift, dist(worldToScreen(cam, VP, world), anchor));
    }
    expect(maxDrift).toBeLessThan(1e-9);
  });

  it("returns landmarks to the same pixels after a deep excursion", () => {
    const r = rng(21);
    const anchors = Array.from({ length: 1500 }, () => ({ x: r() * VP.width, y: r() * VP.height }));
    const landmark: WorldPoint = { x: D.fromNumber(123.25), y: D.fromNumber(-7.5) };
    let cam = lookAt({ x: D.fromNumber(100), y: D.ZERO }, 2, 0.3);
    const before = worldToScreen(cam, VP, landmark);
    for (const a of anchors) cam = zoomAt(cam, VP, a, 0.5);
    for (const a of [...anchors].reverse()) cam = zoomAt(cam, VP, a, -0.5);
    expect(dist(worldToScreen(cam, VP, landmark), before)).toBeLessThan(1e-9);
  });

  it("returns exactly after zooming far out and back in (wheel-sized steps)", () => {
    // 100 px wheel notches are 100/240 of a level: not a dyadic fraction, so
    // without zoom quantization this round trip lands ~2^1000 px away.
    const r = rng(22);
    const anchors = Array.from({ length: 2400 }, () => ({ x: r() * VP.width, y: r() * VP.height }));
    const landmark: WorldPoint = { x: D.fromNumber(123.25), y: D.fromNumber(-7.5) };
    let cam = lookAt({ x: D.fromNumber(0.1), y: D.fromNumber(-0.2) }, 3, 0.25);
    const before = worldToScreen(cam, VP, landmark);
    for (const a of anchors) cam = zoomAt(cam, VP, a, -100 / 240);
    expect(cam.zi).toBeLessThan(-990);
    for (const a of [...anchors].reverse()) cam = zoomAt(cam, VP, a, 100 / 240);
    expect(dist(worldToScreen(cam, VP, landmark), before)).toBeLessThan(1e-9);
    expect([cam.zi, cam.zf]).toEqual([3, 0.25]);
  });

  it("has no zoom limit: 10,000 levels outward and inward keep the anchor", () => {
    let cam: Camera = HOME;
    const anchor = { x: 900.3, y: 120.7 };
    let maxDrift = 0;
    for (let i = 0; i < 5000; i++) {
      const w = screenToWorld(cam, VP, anchor);
      cam = zoomAt(cam, VP, anchor, -2);
      maxDrift = Math.max(maxDrift, dist(worldToScreen(cam, VP, w), anchor));
    }
    expect(cam.zi).toBe(-10000);
    for (let i = 0; i < 10000; i++) {
      const w = screenToWorld(cam, VP, anchor);
      cam = zoomAt(cam, VP, anchor, 2);
      maxDrift = Math.max(maxDrift, dist(worldToScreen(cam, VP, w), anchor));
    }
    expect(cam.zi).toBe(10000);
    expect(maxDrift).toBeLessThan(1e-9);
    expect(Number.isFinite(worldToScreen(cam, VP, cam.center).x)).toBe(true);
  });

  it("forgets sub-pixel position only beyond the precision budget, and only below 2^-96 px", () => {
    const anchor = { x: 1000, y: 100 };
    const start = lookAt({ x: D.fromNumber(5), y: D.fromNumber(5) }, 0);
    const landmark: WorldPoint = { x: D.fromNumber(6), y: D.fromNumber(5.5) };
    let cam = start;
    const steps = (PRECISION_BUDGET + 200) / 2;
    for (let i = 0; i < steps; i++) cam = zoomAt(cam, VP, anchor, -2);
    expect(cam.pz).toBe(cam.zi + PRECISION_BUDGET);
    // Still exact on screen at the coarse scale.
    const coarse = worldToScreen(cam, VP, landmark);
    for (let i = 0; i < steps; i++) cam = zoomAt(cam, VP, anchor, 2);
    // The landmark is lost after returning: honest, documented coarsening.
    expect(dist(worldToScreen(cam, VP, landmark), worldToScreen(start, VP, landmark))).toBeGreaterThan(1);
    expect(Number.isFinite(coarse.x)).toBe(true);
  });
});

describe("pan", () => {
  it("returns exactly after a long pan and its reverse", () => {
    const r = rng(30);
    const moves = Array.from({ length: 2000 }, () => ({ x: (r() - 0.5) * 3000, y: (r() - 0.5) * 3000 }));
    let cam = lookAt({ x: D.fromBigInt(-3n, 200), y: D.fromBigInt(5n, 200) }, -150, 0.7);
    const start = cam;
    for (const m of moves) cam = panBy(cam, m.x, m.y);
    for (const m of [...moves].reverse()) cam = panBy(cam, -m.x, -m.y);
    const err = worldToScreen(cam, VP, start.center);
    expect(dist(err, { x: VP.width / 2, y: VP.height / 2 })).toBeLessThan(1e-12);
  });

  it("is uniform everywhere: the same drag moves content the same pixels near and far", () => {
    for (const center of [
      { x: D.ZERO, y: D.ZERO },
      { x: D.fromBigInt(1n, 4000), y: D.fromBigInt(-1n, 4000) },
      { x: D.add(D.fromNumber(1), D.fromBigInt(1n, -900)), y: D.fromNumber(1) },
    ]) {
      const cam = lookAt(center, 950, 0.4);
      const p = screenToWorld(cam, VP, { x: 300, y: 200 });
      const moved = panBy(cam, 17.25, -3.5);
      expect(dist(worldToScreen(moved, VP, p), { x: 317.25, y: 196.5 })).toBeLessThan(1e-9);
    }
  });

  it("does not drift when crossing the origin and changing sign", () => {
    let cam = lookAt({ x: D.fromNumber(1e-6), y: D.fromNumber(-1e-6) }, 30);
    const p: WorldPoint = { x: D.ZERO, y: D.ZERO };
    const s0 = worldToScreen(cam, VP, p);
    for (let i = 0; i < 400; i++) cam = panBy(cam, 7, -7);
    for (let i = 0; i < 400; i++) cam = panBy(cam, -7, 7);
    expect(dist(worldToScreen(cam, VP, p), s0)).toBeLessThan(1e-12);
  });
});

describe("camera state", () => {
  it("bounds mantissa growth to the zoom depth plus guard bits", () => {
    const r = rng(40);
    let cam: Camera = HOME;
    for (let i = 0; i < 20000; i++) {
      const s = { x: r() * VP.width, y: r() * VP.height };
      cam = r() < 0.5 ? zoomAt(cam, VP, s, (r() - 0.45) * 2) : panBy(cam, (r() - 0.5) * 900, (r() - 0.5) * 900);
      for (const c of [cam.center.x, cam.center.y]) {
        expect(c.e).toBeGreaterThanOrEqual(-(cam.pz + CENTER_GUARD_BITS));
      }
      expect(cam.pz).toBeGreaterThanOrEqual(cam.zi);
      expect(cam.pz).toBeLessThanOrEqual(cam.zi + PRECISION_BUDGET);
      expect(Number.isFinite(cam.zf) && cam.zf >= 0 && cam.zf < 1).toBe(true);
      expect(Number.isSafeInteger(cam.zi)).toBe(true);
    }
  });

  it("serializes losslessly and rejects corrupt state", () => {
    const cam = lookAt({ x: D.fromBigInt(12345n, -3000), y: D.fromBigInt(-9n, 700) }, 2950, 0.125);
    const back = deserializeCamera(JSON.parse(JSON.stringify(serializeCamera(cam))));
    expect(samePoint(back.center, cam.center)).toBe(true);
    expect([back.zi, back.zf, back.pz]).toEqual([cam.zi, cam.zf, cam.pz]);
    expect(() => deserializeCamera({ cx: "0p0", cy: "0p0", zi: 0.5, zf: 0, pz: 0 })).toThrow(RangeError);
    expect(() => deserializeCamera({ cx: "0p0", cy: "0p0", zi: 0, zf: NaN, pz: 0 })).toThrow(RangeError);
    expect(() => deserializeCamera({ cx: "NaN", cy: "0p0", zi: 0, zf: 0, pz: 0 })).toThrow(SyntaxError);
  });

  it("rejects non-finite input instead of corrupting the camera", () => {
    expect(() => zoomAt(HOME, VP, { x: 0, y: 0 }, NaN)).toThrow(RangeError);
    expect(() => panBy(HOME, Infinity, 0)).toThrow(RangeError);
    expect(() => zoomAt(HOME, VP, { x: NaN, y: 0 }, 1)).toThrow(RangeError);
  });
});

describe("grid placement", () => {
  it("puts grid lines exactly on world multiples of the spacing, at any depth and distance", () => {
    const r = rng(50);
    for (let i = 0; i < 200; i++) {
      const zi = Math.floor((r() - 0.5) * 3000);
      const cam = lookAt(
        { x: D.add(D.fromBigInt(BigInt(Math.floor((r() - 0.5) * 1e12)), -zi + 400), D.fromNumber(r())), y: D.ZERO },
        zi,
        r(),
      );
      const g = -zi + 3; // ~8-16 px spacing
      const x = firstLineOffset(cam.center.x, g, VP.width / 2, cam);
      expect(x).toBeLessThanOrEqual(0);
      expect(x).toBeGreaterThan(-(2 ** (g + cam.zi + cam.zf)) - 1e-9);
      // Map back to world and check it is a multiple of 2^g to within 1e-9 px.
      const w = screenToWorld(cam, VP, { x, y: 0 }).x;
      const k = D.floorDivPow2(D.add(w, D.fromBigInt(1n, g - 1)), g);
      const err = D.toNumber(D.shift(D.sub(w, D.fromBigInt(k, g)), cam.zi)) * 2 ** cam.zf;
      expect(Math.abs(err)).toBeLessThan(1e-9);
    }
  });
});

describe("typed zoom levels", () => {
  it("parses plain, power-of-two and power-of-ten forms", async () => {
    const { parseZoomLevel } = await import("../../src/interaction/navigation");
    expect(parseZoomLevel("3000")).toBe(3000);
    expect(parseZoomLevel(" -12.5 ")).toBe(-12.5);
    expect(parseZoomLevel("2^3000")).toBe(3000);
    expect(parseZoomLevel("2^-500")).toBe(-500);
    expect(parseZoomLevel("×2^40")).toBe(40);
    expect(parseZoomLevel("−7")).toBe(-7);
    expect(parseZoomLevel("1e3")).toBe(1000);
    expect(parseZoomLevel("10^300")).toBeCloseTo(300 / Math.log10(2), 9);
    for (const bad of ["", "abc", "2^", "3^5", "1/0", "NaN", "Infinity", "2^1e400"]) expect(parseZoomLevel(bad), bad).toBeNull();
  });
});
