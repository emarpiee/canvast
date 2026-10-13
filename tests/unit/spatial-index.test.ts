import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { lookAt, panBy, zoomAt } from "../../src/core/camera";
import type { Camera } from "../../src/core/camera";
import { DocumentStore } from "../../src/doc/document-store";
import type { CanvasObject, StrokeObject } from "../../src/doc/model";
import { newObjectId } from "../../src/doc/model";
import { translate } from "../../src/doc/edit-ops";
import { SpatialIndex, objectLevel, syncIndex } from "../../src/scene/spatial-index";
import { projectObject } from "../../src/render/projection";
import { visibleObjects } from "../../src/render/scene-view";
import { generateBenchScene } from "../../src/app/bench";
import { rng } from "./rng";

const VP = { width: 1280, height: 800 };

function stroke(x: D.Dyadic, y: D.Dyadic, unit: number, pts: number[], width = 2, z = 0): StrokeObject {
  return { id: newObjectId(), kind: "stroke", anchor: { x, y }, unit, z, opacity: 1, attachmentTargetId: null, points: pts, width, color: "#000000" };
}

/** Brute force: every object the exact projection considers visible (≥ 1/8 px). */
function bruteVisible(objs: Iterable<CanvasObject>, cam: Camera): string[] {
  const out: string[] = [];
  for (const o of objs) if (projectObject(o, cam, VP)) out.push(o.id);
  return out.sort();
}

function randomScene(seed: number, n: number): CanvasObject[] {
  const r = rng(seed);
  const out: CanvasObject[] = [];
  for (let i = 0; i < n; i++) {
    const unit = Math.floor((r() - 0.5) * 40);
    const x = D.fromBigInt(BigInt(Math.floor((r() - 0.5) * 2 ** 20)), unit + Math.floor(r() * 12) - 4);
    const y = D.fromBigInt(BigInt(Math.floor((r() - 0.5) * 2 ** 20)), unit + Math.floor(r() * 12) - 4);
    const pts = [0, 0, (r() - 0.5) * 300, (r() - 0.5) * 300, (r() - 0.5) * 300, (r() - 0.5) * 300];
    out.push(stroke(x, y, unit, pts, 1 + r() * 20, i));
  }
  return out;
}

describe("spatial index", () => {
  it("files objects at the smallest power-of-two level containing them", () => {
    expect(objectLevel(stroke(D.ZERO, D.ZERO, 0, [0, 0, 6, 0], 2))).toBe(3); // 8 ≥ 8
    expect(objectLevel(stroke(D.ZERO, D.ZERO, -10, [0, 0, 6, 0], 2))).toBe(-7);
    expect(objectLevel(stroke(D.ZERO, D.ZERO, 0, [0, 0, 7, 0], 2))).toBe(4); // 9 > 8
  });

  it("never misses a visible object (no false negatives) across random scenes and cameras", () => {
    const objs = randomScene(1, 3000);
    const index = new SpatialIndex();
    index.rebuild(objs);
    const r = rng(2);
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      // Look at a random object at a random zoom around its scale.
      const target = objs[Math.floor(r() * objs.length)]!;
      const cam = lookAt(target.anchor, -target.unit + Math.floor((r() - 0.5) * 24), r());
      const want = bruteVisible(objs, cam);
      const q = index.query(cam, VP);
      const got = new Set(q.cells.flatMap((c) => c.entries.map((e) => e.obj.id)));
      for (const id of want) expect(got.has(id), `object ${id} missing from candidates`).toBe(true);
      checked += want.length;
    }
    expect(checked).toBeGreaterThan(500);
  }, 60_000);

  it("visibleObjects through the index equals the brute-force exact result, in paint order", () => {
    const doc = new DocumentStore();
    const index = new SpatialIndex();
    syncIndex(doc, index);
    const objs = randomScene(3, 2000);
    doc.load(objs);
    const r = rng(4);
    let maxBoxErr = 0;
    for (let i = 0; i < 150; i++) {
      const target = objs[Math.floor(r() * objs.length)]!;
      const cam = lookAt(target.anchor, -target.unit + Math.floor((r() - 0.5) * 16), r());
      const vis = visibleObjects(doc, index, null, cam, VP);
      expect(vis.map((p) => p.obj.id).sort()).toEqual(bruteVisible(objs, cam));
      for (let k = 1; k < vis.length; k++) expect(vis[k - 1]!.obj.z).toBeLessThanOrEqual(vis[k]!.obj.z);
      for (const p of vis) {
        const exact = projectObject(p.obj, cam, VP)!;
        for (const key of ["minX", "minY", "maxX", "maxY"] as const) {
          maxBoxErr = Math.max(maxBoxErr, Math.abs(p.box[key] - exact.box[key]));
        }
        for (let k = 0; k < p.q.length; k++) maxBoxErr = Math.max(maxBoxErr, Math.abs(p.q[k]! - exact.q[k]!));
      }
    }
    // Cell-relative fast projection agrees with the exact projection.
    expect(maxBoxErr).toBeLessThan(1e-6);
  });

  it("stays consistent through incremental moves, deletes, undo and redo", () => {
    const doc = new DocumentStore();
    const index = new SpatialIndex();
    syncIndex(doc, index);
    const objs = randomScene(5, 500);
    doc.load(objs);
    const r = rng(6);
    for (let i = 0; i < 200; i++) {
      const ids = [...doc.all()].map((o) => o.id);
      const o = doc.get(ids[Math.floor(r() * ids.length)]!)!;
      if (r() < 0.2) doc.commit(doc.transaction("del", [], [o.id]));
      else doc.commit(doc.transaction("move", [translate(o, D.fromBigInt(BigInt(Math.floor((r() - 0.5) * 1e6)), o.unit), D.fromNumber(r()))]));
      if (r() < 0.3) doc.undo();
      if (r() < 0.1) doc.redo();
    }
    const fresh = new SpatialIndex();
    fresh.rebuild(doc.all());
    expect(index.size).toBe(doc.size);
    for (let i = 0; i < 50; i++) {
      const t = [...doc.all()][Math.floor(r() * doc.size)]!;
      const cam = lookAt(t.anchor, -t.unit + Math.floor((r() - 0.5) * 10));
      const a = visibleObjects(doc, index, null, cam, VP).map((p) => p.obj.id);
      const b = visibleObjects(doc, fresh, null, cam, VP).map((p) => p.obj.id);
      expect(a).toEqual(b);
    }
  });

  it("handles objects 2^±3000 apart and 2^±3000 in size", () => {
    const objs = [
      stroke(D.fromBigInt(1n, 3000), D.ZERO, 2990, [0, 0, 100, 50]),
      stroke(D.fromBigInt(-1n, -3000), D.ZERO, -3010, [0, 0, 100, 50]),
      stroke(D.ZERO, D.ZERO, 0, [0, 0, 100, 50]),
    ];
    const index = new SpatialIndex();
    index.rebuild(objs);
    expect(index.levelCount).toBe(3);
    for (const o of objs) {
      let cam = lookAt(o.anchor, -o.unit);
      cam = panBy(cam, -50, -25);
      const q = index.query(cam, VP);
      const ids = q.cells.flatMap((c) => c.entries.map((e) => e.obj.id));
      expect(ids).toContain(o.id);
      expect(q.cellsProbed).toBeLessThan(200);
    }
  });

  it("query work does not grow with off-screen document size", () => {
    const small = generateBenchScene({ kind: "mixed", n: 2_000, visible: 200 });
    const large = generateBenchScene({ kind: "mixed", n: 200_000, visible: 200 });
    const a = new SpatialIndex();
    a.rebuild(small.objects);
    const b = new SpatialIndex();
    b.rebuild(large.objects);
    const cam = zoomAt(small.camera, VP, { x: 640, y: 400 }, 0.3);
    const qa = a.query(cam, VP);
    const qb = b.query(cam, VP);
    // Randomly placed "far" clusters can land in view at another scale, so the
    // large scene may have a few more genuine candidates — not 100× more.
    expect(qb.candidates).toBeLessThan(qa.candidates + 100);
    // Levels whose occupied range misses the view cost O(1): probes stay
    // within a small factor even with 100× the objects and ~10× the levels.
    expect(qb.cellsProbed).toBeLessThan(3 * qa.cellsProbed + 500);
  }, 60_000);
});

describe("density summaries (ADR 0010)", () => {
  /** Expected ink of a stroke in world units²: length × width + round caps. */
  const inkWorld = (s: StrokeObject): number => {
    let len = 0;
    for (let i = 2; i < s.points.length; i += 2) len += Math.hypot(s.points[i]! - s.points[i - 2]!, s.points[i + 1]! - s.points[i - 1]!);
    return (len * s.width + (Math.PI * s.width * s.width) / 4) * s.opacity * 4 ** s.unit;
  };

  it("conserve ink: the preview's squares carry the objects' covered area, at every zoom-out", () => {
    const index = new SpatialIndex();
    const objs: StrokeObject[] = [];
    const r = rng(7);
    for (let i = 0; i < 400; i++) {
      const s = stroke(D.fromNumber(Math.round((r() - 0.5) * 2000)), D.fromNumber(Math.round((r() - 0.5) * 2000)), 0, [0, 0, 10 * r(), 10 * r(), 20 * r(), 5], 1 + 3 * r());
      objs.push(s);
      index.insert(s);
    }
    const total = objs.reduce((t, s) => t + inkWorld(s), 0);
    for (const out of [12, 16, 24, 40]) {
      const cam = lookAt({ x: D.ZERO, y: D.ZERO }, -out);
      const q = index.density(cam, VP, 0);
      // Sum of (covered fraction × square area) in px², back to world units².
      const px2 = q.cells.reduce((t, c) => t + c.cover * c.size * c.size, 0);
      expect(px2 * 4 ** out).toBeCloseTo(total, 6);
      for (const c of q.cells) expect(c.size).toBeLessThanOrEqual(2);
    }
  });

  it("are exact after removals: removing everything leaves no ink and no summary cells", () => {
    const index = new SpatialIndex();
    const objs = randomScene(3, 2000);
    for (const o of objs) index.insert(o);
    for (const o of objs) index.remove(o.id);
    expect(index.size).toBe(0);
    expect(index.density(lookAt({ x: D.ZERO, y: D.ZERO }, -30), VP, 0).cells).toEqual([]);
  });

  it("report only content too small to draw: nothing from levels that are drawn object by object", () => {
    const index = new SpatialIndex();
    index.insert(stroke(D.ZERO, D.ZERO, 0, [0, 0, 300, 200], 4));
    expect(index.density(lookAt({ x: D.ZERO, y: D.ZERO }, 0), VP, 0).cells).toEqual([]);
    expect(index.density(lookAt({ x: D.ZERO, y: D.ZERO }, -20), VP, 0).cells.length).toBeGreaterThan(0);
  });

  it("place content 2^-80 of a pixel in size at its true screen position, far from the origin", () => {
    const index = new SpatialIndex();
    const at = { x: D.fromBigInt(1234567891n, 0), y: D.fromBigInt(-987654321n, 0) };
    index.insert(stroke(at.x, at.y, -80, [0, 0, 3, 2], 1));
    const cam = lookAt({ x: D.add(at.x, D.fromNumber(300)), y: D.sub(at.y, D.fromNumber(100)) }, 0);
    const q = index.density(cam, VP, 0);
    expect(q.cells.length).toBe(1);
    const c = q.cells[0]!;
    // The square holds the anchor: 300 px left of and 100 px below the centre.
    expect(c.x).toBeLessThanOrEqual(640 - 300 + 1e-6);
    expect(c.x + c.size).toBeGreaterThanOrEqual(640 - 300 - 1e-6);
    expect(c.y).toBeLessThanOrEqual(400 + 100 + 1e-6);
    expect(c.y + c.size).toBeGreaterThanOrEqual(400 + 100 - 1e-6);
  });
});
