import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import type { Camera, Viewport, WorldPoint } from "../../src/core/camera";
import { HOME, panBy, screenToWorld, zoomAt } from "../../src/core/camera";
import type { StrokeObject } from "../../src/doc/model";
import { translate } from "../../src/doc/edit-ops";
import { projectObject } from "../../src/render/projection";
import { objectLevel } from "../../src/scene/spatial-index";
import type { Frame, FrameCamera, Placement } from "../../src/spike/frames";
import {
  FrameSpace,
  K,
  depthOf,
  expressExactIn,
  expressIn,
  fjump,
  fpanBy,
  fzoomAt,
  levelsBetween,
  localCamera,
  rehome,
  toAbsoluteCamera,
} from "../../src/spike/frames";
import { rng } from "./rng";

/**
 * Nested frames must behave exactly like the absolute system they replace
 * (docs/plans/nested-frames.md, ADR 0014). The same operations are applied
 * to both, and every observable result is compared: camera state exactly,
 * object world positions exactly, screen positions to 1e-6 px.
 */

const VP: Viewport = { width: 1280, height: 800 };

function sameCamera(a: Camera, b: Camera, where: string): void {
  expect(D.equals(a.center.x, b.center.x) && D.equals(a.center.y, b.center.y), `${where}: centre`).toBe(true);
  expect([a.zi, a.zf, a.pz], `${where}: zoom`).toEqual([b.zi, b.zf, b.pz]);
}

function stroke(anchor: WorldPoint, unit: number, points: number[]): StrokeObject {
  return { id: "a".repeat(32), kind: "stroke", anchor, unit, z: 0, opacity: 1, attachmentTargetId: null, points, width: 3, color: "#1f2329" };
}

/** A placed object in both systems. */
interface Twin {
  abs: StrokeObject;
  pl: Placement;
  local: StrokeObject; // geometry relative to pl (anchor/unit replaced)
}

function place(space: FrameSpace, old: Camera, fc: FrameCamera, sx: number, sy: number, points: number[]): Twin {
  const abs = stroke(screenToWorld(old, VP, { x: sx, y: sy }), -old.zi, points);
  const lc = localCamera(fc);
  const local = stroke(screenToWorld(lc, VP, { x: sx, y: sy }), -lc.zi, points);
  const b = objectLevel(local) - local.unit; // log2 extent in local units
  const pl = rehome(space, { f: fc.f, anchor: local.anchor, unit: local.unit }, b);
  return { abs, pl, local };
}

/** The object as the camera frame sees it (exact), ready for the ordinary projection. */
function inCameraFrame(space: FrameSpace, t: Twin, f: Frame): StrokeObject {
  return { ...t.local, anchor: expressExactIn(space, t.pl.f, t.pl.anchor, f), unit: t.pl.unit + levelsBetween(t.pl.f, f) };
}

function screenPoints(o: StrokeObject, cam: Camera): number[] | null {
  const po = projectObject(o, cam, VP, { keepTiny: true });
  return po ? [...po.q] : null;
}

describe("nested frames behave exactly like absolute coordinates", () => {
  it("camera: 3,000 random pans, zooms and jumps give the identical world camera", () => {
    for (const seed of [1, 2, 3]) {
      const r = rng(seed);
      const space = new FrameSpace();
      let old: Camera = HOME;
      let fc: FrameCamera = { f: space.root, x: D.ZERO, y: D.ZERO, z: 0, pz: 0 };
      for (let i = 0; i < 1000; i++) {
        const op = r();
        if (op < 0.4) {
          const dx = (r() - 0.5) * 800;
          const dy = (r() - 0.5) * 800;
          old = panBy(old, dx, dy);
          fc = fpanBy(space, fc, dx, dy);
        } else if (op < 0.85) {
          const at = { x: r() * VP.width, y: r() * VP.height };
          const dz = (r() - 0.45) * (r() < 0.1 ? 60 : 4);
          old = zoomAt(old, VP, at, dz);
          fc = fzoomAt(space, fc, VP, at, dz);
        } else {
          // Jumps about the centre, kept within ±3,000 levels so the old system stays fast.
          const target = Math.round((r() - 0.3) * 6000);
          const dz = target - (old.zi + old.zf);
          old = zoomAt(old, VP, { x: VP.width / 2, y: VP.height / 2 }, dz);
          fc = fjump(space, fc, dz);
        }
        sameCamera(toAbsoluteCamera(space, fc), old, `seed ${seed} step ${i}`);
        expect(fc.z >= -8 && fc.z <= K + 8, "frame-local zoom stays in range").toBe(true);
        expect(D.log2Abs(fc.x) <= K + 1 && D.log2Abs(fc.y) <= K + 1, "frame-local position stays small").toBe(true);
      }
    }
  });

  it("objects: placed anywhere, seen from anywhere, they land on the same pixels (incl. across frame boundaries)", () => {
    const r = rng(9);
    const space = new FrameSpace();
    let old: Camera = HOME;
    let fc: FrameCamera = { f: space.root, x: D.ZERO, y: D.ZERO, z: 0, pz: 0 };
    const twins: Twin[] = [];
    let compared = 0;
    for (let i = 0; i < 600; i++) {
      const op = r();
      if (op < 0.35) {
        const dx = (r() - 0.5) * 600;
        const dy = (r() - 0.5) * 600;
        old = panBy(old, dx, dy);
        fc = fpanBy(space, fc, dx, dy);
      } else if (op < 0.8) {
        const at = { x: r() * VP.width, y: r() * VP.height };
        const dz = (r() - 0.4) * 6;
        old = zoomAt(old, VP, at, dz);
        fc = fzoomAt(space, fc, VP, at, dz);
      } else {
        const sx = r() * VP.width;
        const sy = r() * VP.height;
        const t = place(space, old, fc, sx, sy, [0, 0, 40 + r() * 200, (r() - 0.5) * 100, 300 * r(), 80]);
        // Re-homing never changes the world position, by a single bit.
        const back = expressExactIn(space, t.pl.f, t.pl.anchor, space.world);
        const shift = t.pl.unit - levelsBetween(space.world, t.pl.f);
        expect(shift === t.abs.unit, "unit is preserved").toBe(true);
        expect(D.equals(back.x, t.abs.anchor.x) && D.equals(back.y, t.abs.anchor.y), "anchor is preserved").toBe(true);
        twins.push(t);
      }
      sameCamera(toAbsoluteCamera(space, fc), old, `step ${i}`);
      for (const t of twins) {
        const a = screenPoints(t.abs, old);
        const b = screenPoints(inCameraFrame(space, t, fc.f), localCamera(fc));
        expect(a === null, `visibility of a twin at step ${i}`).toBe(b === null);
        if (!a || !b) continue;
        for (let k = 0; k < a.length; k++) {
          if (Math.abs(a[k]!) > 1e7) continue; // far off screen: both are, and the value is irrelevant
          expect(Math.abs(a[k]! - b[k]!), `step ${i} coord ${k}`).toBeLessThan(1e-6);
        }
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it("an object across a frame boundary: one frame, visible and exact from both sides, moves across it exactly", () => {
    const space = new FrameSpace();
    // Camera just before descending (z = K + 7); the child cell boundary x = 1 is on screen.
    let old: Camera = zoomAt(HOME, VP, { x: 640, y: 400 }, K + 7);
    let fc = fjump(space, { f: space.root, x: D.ZERO, y: D.ZERO, z: 0, pz: 0 }, K + 7);
    old = panBy(old, -(2 ** (K + 7)) + 200, 0); // world x = 1 is now 200 px left of the centre
    fc = fpanBy(space, fc, -(2 ** (K + 7)) + 200, 0);
    sameCamera(toAbsoluteCamera(space, fc), old, "setup");
    const boundary = { x: 440, y: 400 };
    const t = place(space, old, fc, boundary.x - 100, boundary.y, [0, 0, 200, 0]); // 100 px each side
    // Zoom in about each side of the boundary: the camera descends into two different sibling frames.
    for (const side of [-60, 60]) {
      const o2 = zoomAt(old, VP, { x: boundary.x + side, y: boundary.y }, 3);
      const f2 = fzoomAt(space, fc, VP, { x: boundary.x + side, y: boundary.y }, 3);
      expect(f2.f, "descended").not.toBe(fc.f);
      const near = expressIn(space, t.pl.f, t.pl.anchor, f2.f);
      expect(near, "cheap path finds it (small numbers)").not.toBeNull();
      const a = screenPoints(t.abs, o2)!;
      const b = screenPoints(inCameraFrame(space, t, f2.f), localCamera(f2))!;
      for (let k = 0; k < a.length; k++) expect(Math.abs(a[k]! - b[k]!)).toBeLessThan(1e-6);
    }
    // Move it right by 300 px (across the boundary): exact in its own frame, same as the absolute move.
    const dWorld = D.shift(D.fromNumber(300), -old.zi);
    const absMoved = translate(t.abs, dWorld, D.ZERO) as StrokeObject;
    const dLocal = D.shift(D.fromNumber(300), -localCamera(fc).zi);
    const pl2 = rehome(space, { ...t.pl, anchor: { x: D.add(t.pl.anchor.x, D.shift(dLocal, levelsBetween(fc.f, t.pl.f))), y: t.pl.anchor.y } }, 8);
    const back = expressExactIn(space, pl2.f, pl2.anchor, space.world);
    expect(D.equals(back.x, absMoved.anchor.x) && D.equals(back.y, absMoved.anchor.y)).toBe(true);
  });

  it("giant jumps cost nothing and come back exactly", () => {
    const space = new FrameSpace();
    let old: Camera = panBy(HOME, 123.37, -56.71);
    let fc = fpanBy(space, { f: space.root, x: D.ZERO, y: D.ZERO, z: 0, pz: 0 }, 123.37, -56.71);
    const t0 = performance.now();
    fc = fjump(space, fc, 1e12);
    fc = fpanBy(space, fc, 37, 11);
    fc = fjump(space, fc, -1e12);
    fc = fjump(space, fc, -1e12); // a trillion levels above the start
    fc = fjump(space, fc, 1e12);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(50);
    expect(space.count).toBeLessThan(20);
    // Same as the old camera for a jump it can still do quickly.
    old = zoomAt(old, VP, { x: 640, y: 400 }, 3000);
    const f3 = fjump(space, fpanBy(space, { f: space.world, x: D.ZERO, y: D.ZERO, z: 0, pz: 0 }, 123.37, -56.71), 3000);
    sameCamera(toAbsoluteCamera(space, f3), old, "jump 3000");
  });

  it("expressing a point up through a long dive does not split it", () => {
    for (const up of [-1e6, -1e9, -1e12]) {
      const space = new FrameSpace();
      const t0 = performance.now();
      const fc = fjump(space, { f: space.world, x: D.ZERO, y: D.ZERO, z: 0, pz: 0 }, up);
      const p = expressIn(space, space.world, { x: D.fromBigInt(5n), y: D.fromBigInt(-3n) }, fc.f);
      expect(performance.now() - t0).toBeLessThan(50);
      expect(space.count).toBeLessThan(5);
      expect(p && D.log2Abs(p.x) < 0).toBe(true);
    }
  });

  it("a home point seen from 5e12 levels up stays cheap after zooming into a neighbouring cell", () => {
    const space = new FrameSpace();
    let fc: FrameCamera = { f: space.world, x: D.ZERO, y: D.ZERO, z: 0, pz: 0 };
    for (let i = 0; i < 5; i++) fc = fjump(space, fc, -1e12);
    const t0 = performance.now();
    for (let i = 0; i < 120; i++) {
      fc = fzoomAt(space, fc, VP, { x: 300, y: 200 }, 1);
      expressIn(space, space.world, { x: D.fromBigInt(5n), y: D.fromBigInt(-3n) }, fc.f);
    }
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("expressIn matches the exact path to 2^-150 wherever it finds the point", () => {
    const r = rng(41);
    const space = new FrameSpace();
    let fc: FrameCamera = { f: space.world, x: D.ZERO, y: D.ZERO, z: 0, pz: 0 };
    const pts: { f: Frame; p: WorldPoint }[] = [];
    let found = 0;
    for (let i = 0; i < 400; i++) {
      const k = r();
      if (k < 0.1) fc = fjump(space, fc, Math.round((r() - 0.5) * 400));
      else if (k < 0.6) fc = fpanBy(space, fc, (r() - 0.5) * 3000, (r() - 0.5) * 3000);
      else fc = fzoomAt(space, fc, VP, { x: r() * 1280, y: r() * 800 }, (r() - 0.5) * 8);
      pts.push({ f: fc.f, p: { x: D.add(fc.x, D.fromNumber(r() - 0.5)), y: D.sub(fc.y, D.fromNumber(r())) } });
      for (const q of pts.slice(-30)) {
        const cheap = expressIn(space, q.f, q.p, fc.f);
        if (!cheap) continue;
        found++;
        const exact = expressExactIn(space, q.f, q.p, fc.f);
        expect(D.log2Abs(D.sub(cheap.x, exact.x))).toBeLessThan(-150);
        expect(D.log2Abs(D.sub(cheap.y, exact.y))).toBeLessThan(-150);
      }
    }
    expect(found).toBeGreaterThan(1000);
  });

  it("climbing part of a long dive is one step, not one per frame", () => {
    for (const up of [-1e9, -1e6, -1e12 + 1e9]) {
      const space = new FrameSpace();
      const start = fpanBy(space, { f: space.root, x: D.ZERO, y: D.ZERO, z: 0, pz: 0 }, 123.37, -56.71);
      const t0 = performance.now();
      let fc = fjump(space, start, 1e12);
      fc = fjump(space, fpanBy(space, fc, 37, 11), 1000);
      fc = fjump(space, fc, up);
      expect(performance.now() - t0).toBeLessThan(50);
      expect(space.count).toBeLessThan(20);
      const d = depthOf(fc); // not toAbsoluteCamera: that builds a number with ~depth bits
      expect(Number(d.levels) + d.frac).toBeCloseTo(1e12 + 1000 + up, 0);
    }
  });
});
