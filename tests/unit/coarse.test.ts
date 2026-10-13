import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { DocumentStore } from "../../src/doc/document-store";
import type { ImageObject, StrokeObject } from "../../src/doc/model";
import { newObjectId } from "../../src/doc/model";
import { COARSE_ROUND_MIN, FrameIndex, cameraIn } from "../../src/scene/frame-index";
import { syncIndex } from "../../src/scene/spatial-index";
import { depthOf, fjump, fpanBy } from "../../src/core/frames";
import type { FrameCamera } from "../../src/core/frames";
import { classifyCoarse } from "../../src/render/coarse";
import { visibleObjects } from "../../src/render/scene-view";
import { projectObject } from "../../src/render/projection";
import { exactStrokeCoverage } from "../../src/render/stroke-coverage";
import { pointInPolygon } from "../../src/render/geometry2d";
import { rng } from "./rng";

const VP = { width: 1280, height: 800 };
const INFO = { errLog2: -208, zTrue: 5000 };

function stroke(points: number[], width: number, z = 0, anchor = { x: D.ZERO, y: D.ZERO }): StrokeObject {
  return { id: newObjectId(), kind: "stroke", anchor, unit: 0, z, opacity: 1, attachmentTargetId: null, points, width, color: "#112233" };
}

function image(w: number, h: number, pixelW: number, pixelH: number): ImageObject {
  return { id: newObjectId(), kind: "image", anchor: { x: D.ZERO, y: D.ZERO }, unit: 0, z: 0, opacity: 1, attachmentTargetId: null, assetId: "a".repeat(64), w, h, pixelW, pixelH };
}

const at = (x: number | D.Dyadic, y: number | D.Dyadic) => ({ x: typeof x === "number" ? D.fromNumber(x) : x, y: typeof y === "number" ? D.fromNumber(y) : y });

describe("classifyCoarse (objects far coarser than the camera)", () => {
  // A vertical bar, x in [-1, 1], y in [0, 100] (capsule ends reach -1 and 101).
  const bar = stroke([0, 0, 0, 100], 2);

  it("a view deep inside covers, far outside misses, and the cases between are never decided wrongly", () => {
    expect(classifyCoarse(bar, at(0.25, 50), INFO, VP)).toEqual({});
    expect(classifyCoarse(bar, at(3, 50), INFO, VP)).toBe("miss");
    expect(classifyCoarse(bar, at(0, 200), INFO, VP)).toBe("miss");
    // Camera a hair from the edge x = 1, from 2^-10 down to below the rounding (2^-256): inside or outside by that hair.
    for (let k = 10; k <= 400; k += 5) {
      for (const side of [-1, 1]) {
        const x = D.add(D.fromNumber(1), D.fromBigInt(BigInt(side), -k)); // truth: inside iff x < 1
        const r = classifyCoarse(bar, { x, y: D.fromNumber(50) }, INFO, VP);
        if (r === "miss") expect(side, `k=${k}`).toBe(1);
        else if (r !== "exact") expect(side, `k=${k}`).toBe(-1);
        // Below the double's reach (2^-46 of the stroke's size) nothing may be decided.
        if (k > 60) expect(r, `k=${k} is below what the rounded centre knows`).toBe("exact");
      }
    }
  });

  it("round caps: the end of a stroke and a lone dot", () => {
    expect(classifyCoarse(bar, at(0, 100.5), INFO, VP)).toEqual({});
    expect(classifyCoarse(bar, at(0, 102), INFO, VP)).toBe("miss");
    expect(classifyCoarse(bar, at(0.9, 100.9), INFO, VP)).toBe("miss"); // the corner of the bounding box is outside the cap
    const dot = stroke([5, 5], 4);
    expect(classifyCoarse(dot, at(5.5, 5), INFO, VP)).toEqual({});
    expect(classifyCoarse(dot, at(8, 5), INFO, VP)).toBe("miss");
  });

  it("an image shows the source pixel under the view; its edges and pixel edges ask for the exact centre", () => {
    const img = image(100, 50, 10, 5); // 10 × 10 units per source pixel
    expect(classifyCoarse(img, at(35, 12), INFO, VP)).toEqual({ pixel: [3, 1] });
    expect(classifyCoarse(img, at(100.5, 12), INFO, VP)).toBe("miss");
    expect(classifyCoarse(img, at(100, 12), INFO, VP)).toBe("exact");
    expect(classifyCoarse(img, at(30, 12), INFO, VP)).toBe("exact");
    expect(classifyCoarse(img, at(D.add(D.fromNumber(30), D.fromBigInt(1n, -100)), D.fromNumber(12)), INFO, VP)).toBe("exact");
  });

  it("the view's own size counts: a nearer, shallower frame is not decided from a point", () => {
    // 3 levels below the stroke, the view (1280 px = 160 units) spans the edge x = 1 although the centre is inside.
    const shallow = { errLog2: -208, zTrue: 3 };
    expect(classifyCoarse(bar, at(0.9, 50), shallow, VP)).toBe("exact");
  });
});

describe("coarse frames in the index", () => {
  function scene(): { doc: DocumentStore; index: FrameIndex; covering: StrokeObject; off: StrokeObject; far: StrokeObject } {
    const doc = new DocumentStore();
    const index = new FrameIndex(() => doc.space);
    syncIndex(doc, index);
    const covering = stroke([-300, 0, 300, 0], 40, 1);
    const off = stroke([-300, 500, 300, 500], 4, 2);
    const far = stroke([0, 0, 10, 10], 4, 3, at(D.fromBigInt(1n, 100), D.ZERO));
    doc.load([covering, off, far]);
    return { doc, index, covering, off, far };
  }
  const home = (doc: DocumentStore): FrameCamera => ({ f: doc.space.world, x: D.ZERO, y: D.ZERO, z: 0, pz: 0 });

  it("from any depth, the stroke under the view covers it and the others are not drawn: fast, and the same coming back", () => {
    const { doc, index, covering } = scene();
    const before = visibleObjects(doc, index, null, home(doc), VP).map((p) => p.obj.id);
    expect(before).toContain(covering.id);
    for (const depth of [5e3, 1e5, 1e6, 1e9, 1e12, 1e15]) {
      let fc = home(doc);
      for (let left = depth; left > 0; left -= Math.min(left, 1e12)) fc = fjump(doc.space, fc, Math.min(left, 1e12));
      for (const [dx, dy] of [[0, 0], [37, 5], [-12, -9]] as const) {
        const moved = fpanBy(doc.space, fc, dx, dy);
        const t0 = performance.now();
        const vis = visibleObjects(doc, index, null, moved, VP);
        expect(performance.now() - t0, `${depth}`).toBeLessThan(200);
        expect(vis.map((p) => p.obj.id), `${depth}`).toEqual([covering.id]);
        expect(vis[0]!.cover).toBeDefined();
      }
      // And back out, exactly.
      for (let left = depth; left > 0; left -= Math.min(left, 1e12)) fc = fjump(doc.space, fc, -Math.min(left, 1e12));
      expect(visibleObjects(doc, index, null, fc, VP).map((p) => p.obj.id)).toEqual(before);
    }
  });

  it("random zooms (1e3 to 1e12 levels, in and out) and pans: the covering stroke always covers, the others never show, every step is fast", () => {
    const { doc, index, covering } = scene();
    const r = rng(5);
    let fc = home(doc);
    let coarseSteps = 0;
    for (let i = 0; i < 120; i++) {
      const levels = Math.round(10 ** (3 + r() * 9));
      const depth = Number(depthOf(fc).levels);
      const down = depth < levels || r() < 0.55;
      const t0 = performance.now();
      fc = fpanBy(doc.space, fjump(doc.space, fc, down ? levels : -levels), (r() - 0.5) * 300, (r() - 0.5) * 300);
      const vis = visibleObjects(doc, index, null, fc, VP);
      expect(performance.now() - t0, `step ${i}`).toBeLessThan(250);
      if (Number(depthOf(fc).levels) > 5000) {
        coarseSteps++;
        expect(vis.map((p) => p.obj.id), `step ${i} at ${depthOf(fc).levels}`).toEqual([covering.id]);
      }
    }
    expect(coarseSteps, "the walk spent its time deep").toBeGreaterThan(60);
  });

  it("agrees with the exact projection where both can be computed (5,000 levels down, random places)", () => {
    const r = rng(77);
    const doc = new DocumentStore();
    const index = new FrameIndex(() => doc.space);
    syncIndex(doc, index);
    const objs: StrokeObject[] = [];
    for (let i = 0; i < 12; i++) {
      objs.push(stroke([(r() - 0.5) * 600, (r() - 0.5) * 600, (r() - 0.5) * 600, (r() - 0.5) * 600], 4 + r() * 60, i));
    }
    doc.load(objs);
    let covered = 0;
    let missed = 0;
    for (let i = 0; i < 150; i++) {
      // A camera 5,000 levels down at a random place, with a random offset from home.
      let fc = fpanBy(doc.space, home(doc), (r() - 0.5) * 1400, (r() - 0.5) * 1400);
      fc = fjump(doc.space, fc, 5000);
      expect(fc.f.level, "far below home").toBeGreaterThan(100n);
      const views = index.views(fc);
      const coarse = views.filter((v) => v.coarse);
      expect(coarse.length).toBeGreaterThan(0);
      for (const o of doc.all()) {
        const v = views.find((x) => x.frame === (o.frame ?? doc.space.world))!;
        const c = classifyCoarse(o, v.coarse!.center, v.coarse!.info, VP);
        const exactCam = cameraIn(fc, o.frame ?? doc.space.world)!;
        const po = projectObject(o, exactCam, VP, { keepTiny: true });
        const polys = po ? exactStrokeCoverage(po, VP) : [];
        const inside = (x: number, y: number): boolean => polys.some((p) => pointInPolygon(x, y, p));
        const samples = [[1, 1], [640, 400], [1279, 799], [1, 799], [1279, 1]] as const;
        if (c === "miss") {
          missed++;
          for (const [x, y] of samples) expect(inside(x, y)).toBe(false);
        } else if (c !== "exact") {
          covered++;
          for (const [x, y] of samples) expect(inside(x, y)).toBe(true);
        }
      }
    }
    expect(covered, "the test saw covers").toBeGreaterThan(5);
    expect(missed, "the test saw misses").toBeGreaterThan(100);
  });

  it("the coarse limit applies to an edge near the view only: the camera on an edge past COARSE_EXACT_MAX gets no exact camera", () => {
    const { doc, index } = scene();
    // Exactly on the covering stroke's edge (y = -20) at a deep level.
    let fc = fpanBy(doc.space, home(doc), 0, 20);
    fc = fjump(doc.space, fc, COARSE_ROUND_MIN * 40);
    const v = index.views(fc).find((x) => x.coarse && x.frame === doc.space.world)!;
    expect(v.coarse!.exactCam(), "past the exact limit").toBeNull();
    // The view is beyond the stroke edge at the pixel scale only if we are tracking it: here the centre is on it exactly.
    expect(visibleObjects(doc, index, null, fc, VP)).toEqual([]);
  });
});
