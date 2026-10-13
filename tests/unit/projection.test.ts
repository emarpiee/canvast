import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { lookAt, worldToScreen } from "../../src/core/camera";
import type { ImageObject, StrokeObject } from "../../src/doc/model";
import { newObjectId } from "../../src/doc/model";
import { localToWorld } from "../../src/doc/edit-ops";
import { projectObject } from "../../src/render/projection";
import { boxSelect, hitsObject, lassoSelect } from "../../src/render/hit-test";
import { clipPolygon, clipSegment, pointInPolygon } from "../../src/render/geometry2d";
import { rng } from "./rng";

const VP = { width: 1280, height: 800 };

function stroke(anchor: { x: D.Dyadic; y: D.Dyadic }, unit: number, points: number[], width = 2): StrokeObject {
  return { id: newObjectId(), kind: "stroke", anchor, unit, z: 1, opacity: 1, attachmentTargetId: null, points, width, color: "#000000" };
}

describe("object projection", () => {
  it("matches the exact world→screen mapping for every vertex, at any distance and magnification", () => {
    const r = rng(60);
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      const unit = Math.floor((r() - 0.5) * 4000);
      const anchor = { x: D.fromBigInt(BigInt(Math.floor((r() - 0.5) * 1e9)), unit + Math.floor((r() - 0.5) * 60)), y: D.fromBigInt(7n, unit) };
      const pts = Array.from({ length: 20 }, () => (r() - 0.5) * 2000);
      const o = stroke(anchor, unit, pts);
      // Camera looks at vertex 3, magnified up to 2^40 beyond the authoring scale.
      const focus = localToWorld(o, pts[6]!, pts[7]!);
      const cam = lookAt(focus, -unit + Math.floor(r() * 40), r());
      const po = projectObject(o, cam, VP, { keepTiny: true });
      expect(po).not.toBeNull();
      for (let k = 0; k < pts.length; k += 2) {
        const exact = worldToScreen(cam, VP, localToWorld(o, pts[k]!, pts[k + 1]!));
        const err = Math.hypot(po!.q[k]! - exact.x, po!.q[k + 1]! - exact.y);
        // Relative to how far the vertex is from the screen (doubles near the screen are exact).
        const scale = Math.max(1, Math.abs(exact.x), Math.abs(exact.y));
        worst = Math.max(worst, err / scale);
      }
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it("keeps on-screen vertices sub-pixel exact where a naive anchor+offset projection fails", () => {
    // Anchor far from the view; the stroke reaches across 2^40 px to the screen centre.
    const o = stroke({ x: D.ZERO, y: D.ZERO }, 0, [0, 0, 2 ** 40 + 0.25, 0.5]);
    const focus = localToWorld(o, 2 ** 40 + 0.25, 0.5);
    const cam = lookAt(focus, 0);
    const po = projectObject(o, cam, VP)!;
    expect(po.q[2]).toBe(640);
    expect(po.q[3]).toBe(400);
  });

  it("culls offscreen and sub-pixel objects", () => {
    const o = stroke({ x: D.ZERO, y: D.ZERO }, 0, [0, 0, 10, 10]);
    expect(projectObject(o, lookAt({ x: D.fromNumber(1e6), y: D.ZERO }, 0), VP)).toBeNull();
    expect(projectObject(o, lookAt({ x: D.ZERO, y: D.ZERO }, -20), VP)).toBeNull();
    expect(projectObject(o, lookAt({ x: D.ZERO, y: D.ZERO }, -20), VP, { keepTiny: true })).not.toBeNull();
  });
});

describe("selection policies", () => {
  const cam = lookAt({ x: D.ZERO, y: D.ZERO }, 0);
  const big: ImageObject = {
    id: newObjectId(),
    kind: "image",
    anchor: { x: D.fromNumber(-5000), y: D.fromNumber(-5000) },
    unit: 0,
    z: 0,
    opacity: 1,
    attachmentTargetId: null,
    assetId: "b".repeat(64),
    w: 10000,
    h: 10000,
    pixelW: 10,
    pixelH: 10,
  };
  const s = stroke({ x: D.ZERO, y: D.ZERO }, 0, [-50, 0, 0, 20, 50, 0], 3);
  const vis = [big, s].map((o) => projectObject(o, cam, VP)!);
  const square = (cx: number, cy: number, h: number) => [cx - h, cy - h, cx + h, cy - h, cx + h, cy + h, cx - h, cy + h];

  it("a small lasso over a viewport-filling image selects only the stroke, in both filters", () => {
    expect(lassoSelect(vis, square(640, 410, 80), "strokes")).toEqual([s.id]);
    expect(lassoSelect(vis, square(640, 410, 80), "all")).toEqual([s.id]);
  });

  it("the 'all' filter selects media only when fully enclosed", () => {
    const small: ImageObject = { ...big, id: newObjectId(), anchor: { x: D.fromNumber(100), y: D.fromNumber(100) }, w: 50, h: 40 };
    const v = [projectObject(small, cam, VP)!, ...vis];
    expect(lassoSelect(v, square(765, 520, 60), "all")).toEqual([small.id]);
    expect(lassoSelect(v, square(765, 520, 60), "strokes")).toEqual([]);
    expect(lassoSelect(v, square(740, 500, 20), "all")).toEqual([]); // partial
  });

  it("strokes need at least half their vertices inside the lasso", () => {
    expect(lassoSelect(vis, square(590, 400, 30), "strokes")).toEqual([]); // 1 of 3
    expect(lassoSelect(vis, [560, 380, 660, 380, 660, 440, 560, 440], "strokes")).toEqual([s.id]); // 2 of 3
  });

  it("box select requires full containment; hit testing honours stroke width", () => {
    expect(boxSelect(vis, { minX: 0, minY: 0, maxX: 1280, maxY: 800 })).toEqual([s.id]);
    const ps = vis[1]!;
    expect(hitsObject(ps, 640, 420)).toBe(true); // on the middle vertex
    expect(hitsObject(ps, 640, 420 + 1.5 + 4)).toBe(true); // radius + tolerance
    expect(hitsObject(ps, 640, 420 + 1.5 + 4.5)).toBe(false);
    expect(hitsObject(vis[0]!, 10, 10)).toBe(true);
  });
});

describe("2D clipping", () => {
  const r = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
  it("clips segments", () => {
    expect(clipSegment(-50, 25, 150, 25, r)).toEqual([0, 25, 100, 25]);
    expect(clipSegment(-50, -10, 150, -10, r)).toBeNull();
    expect(clipSegment(10, 10, 20, 20, r)).toEqual([10, 10, 20, 20]);
  });
  it("clips polygons, including ones with huge coordinates", () => {
    const tri = [-1e12, -1e12, 1e12, -1e12, 0, 1e12];
    const c = clipPolygon(tri, r);
    expect(c.length).toBeGreaterThanOrEqual(8);
    for (let i = 0; i < c.length; i += 2) {
      expect(c[i]!).toBeGreaterThanOrEqual(-1e-9);
      expect(c[i]!).toBeLessThanOrEqual(100 + 1e-9);
    }
    expect(clipPolygon([200, 200, 300, 200, 250, 300], r)).toEqual([]);
    expect(pointInPolygon(50, 25, c)).toBe(true);
  });
});
