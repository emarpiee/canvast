import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { fitRect, screenToWorld, worldToScreen, zoomLevel } from "../../src/core/camera";
import { DocumentStore } from "../../src/doc/document-store";
import type { ImageObject } from "../../src/doc/model";
import { newObjectId } from "../../src/doc/model";
import { unionBounds, worldBounds } from "../../src/doc/edit-ops";
import { folderPath, folderSubtree, meta, normalizeTags } from "../../src/assets/asset-catalog";

/**
 * Pure parts of the asset slice (ADR 0007): exact framing of revealed
 * instances at any depth, and the live roots that protect originals from
 * garbage collection.
 */

const VP = { width: 1280, height: 800 };
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function image(unit: number, ax: D.Dyadic, ay: D.Dyadic, assetId = HASH_A): ImageObject {
  return {
    id: newObjectId(),
    kind: "image",
    anchor: { x: ax, y: ay },
    unit,
    z: 1,
    opacity: 1,
    attachmentTargetId: null,
    assetId,
    w: 400,
    h: 300,
    pixelW: 8,
    pixelH: 6,
  };
}

describe("log2Abs", () => {
  it("is exact in the exponent far beyond the double range", () => {
    expect(D.log2Abs(D.fromBigInt(1n, -5000))).toBe(-5000);
    expect(D.log2Abs(D.fromBigInt(-1n, 7000))).toBe(7000);
    expect(D.log2Abs(D.fromBigInt(3n, 10))).toBeCloseTo(10 + Math.log2(3), 12);
    expect(D.log2Abs(D.fromBigInt((1n << 200n) + 1n, -3000))).toBeCloseTo(-2800, 9);
    expect(D.log2Abs(D.ZERO)).toBe(-Infinity);
  });
});

describe("fitRect frames objects exactly at any depth", () => {
  for (const unit of [0, -60, -1600, -5000, 1600, 5000]) {
    it(`frames a 400×300-unit image placed at unit 2^${unit}`, () => {
      // An off-centre anchor with bits far below the image's own scale.
      const ax = D.add(D.fromBigInt(123456789n, 40), D.fromBigInt(7n, unit - 3));
      const ay = D.sub(D.fromBigInt(-987654321n, 12), D.fromBigInt(5n, unit - 9));
      const o = image(unit, ax, ay);
      const b = worldBounds(o);
      const cam = fitRect(b.min, b.max, VP, 0.6, 0);
      // Level: 400 units must fill at most 60% of the width (and 300 at most 60% of the height).
      const expected = Math.min(Math.log2(0.6 * VP.width / 400), Math.log2(0.6 * VP.height / 300)) - unit;
      expect(zoomLevel(cam)).toBeLessThanOrEqual(expected);
      expect(expected - zoomLevel(cam)).toBeLessThan(2 ** -19);
      // The exact centre is the camera centre, so the box is centred to well under a pixel.
      const tl = worldToScreen(cam, VP, b.min);
      const br = worldToScreen(cam, VP, b.max);
      expect((tl.x + br.x) / 2).toBeCloseTo(VP.width / 2, 6);
      expect((tl.y + br.y) / 2).toBeCloseTo(VP.height / 2, 6);
      const w = br.x - tl.x;
      const h = br.y - tl.y;
      expect(w).toBeLessThanOrEqual(0.6 * VP.width + 1e-6);
      expect(h).toBeLessThanOrEqual(0.6 * VP.height + 1e-6);
      expect(Math.max(w / (0.6 * VP.width), h / (0.6 * VP.height))).toBeGreaterThan(0.999);
      // Screen ↔ world at the centre stays exact.
      const c = screenToWorld(cam, VP, { x: VP.width / 2, y: VP.height / 2 });
      expect(D.equals(c.x, cam.center.x) && D.equals(c.y, cam.center.y)).toBe(true);
    });
  }

  it("frames the union of instances at different depths around the largest", () => {
    const big = image(0, D.fromNumber(0), D.fromNumber(0));
    const tiny = image(-2000, D.fromNumber(100), D.fromNumber(100));
    const u = unionBounds([big, tiny])!;
    expect(D.equals(u.min.x, D.ZERO)).toBe(true);
    expect(D.equals(u.max.x, D.fromNumber(400))).toBe(true);
    const cam = fitRect(u.min, u.max, VP, 0.6, 0);
    expect(cam.zi).toBe(0);
  });

  it("keeps the fallback level for a zero-size rectangle", () => {
    const p = { x: D.fromBigInt(1n, -3000), y: D.ZERO };
    const cam = fitRect(p, p, VP, 0.6, 42.5);
    expect(zoomLevel(cam)).toBe(42.5);
    // The camera keeps its centre to 2^-(level+96); the point is on the centre to far below a pixel.
    expect(worldToScreen(cam, VP, p).x).toBeCloseTo(VP.width / 2, 9);
  });
});

describe("garbage-collection roots", () => {
  it("include current objects and every state in undo and redo history", () => {
    const doc = new DocumentStore();
    const a = image(0, D.ZERO, D.ZERO, HASH_A);
    const b = image(0, D.ZERO, D.ZERO, HASH_B);
    const roots = (): string[] => [...new Set([...doc.retainedObjects()].map((o) => (o as ImageObject).assetId))].sort();
    doc.commit(doc.transaction("add a", [a]));
    doc.commit(doc.transaction("add b", [b]));
    doc.commit(doc.transaction("delete a", [], [a.id]));
    // `a` is gone from the document but the undo history can bring it back.
    expect(doc.get(a.id)).toBeUndefined();
    expect(roots()).toEqual([HASH_A, HASH_B]);
    doc.undo();
    doc.undo(); // b removed again; only the redo stack holds it
    expect(doc.get(b.id)).toBeUndefined();
    expect(roots()).toEqual([HASH_A, HASH_B]);
    // Loading another canvas clears history: only loaded objects remain roots.
    doc.load([]);
    expect(roots()).toEqual([]);
  });
});

describe("library organization (ADR 0011)", () => {
  it("normalizes tags: trims, drops # and empties, dedupes case-insensitively keeping the first spelling", () => {
    expect(normalizeTags(["  Hands ", "#ref", "hands", "", "a  b", "REF"])).toEqual(["Hands", "ref", "a b"]);
    expect(() => normalizeTags(["x".repeat(65)])).toThrow(/at most 64/);
    expect(() => normalizeTags(Array.from({ length: 101 }, (_, i) => `t${i}`))).toThrow(/at most 100/);
  });

  it("finds folder subtrees and name paths", () => {
    const folders = [
      { id: "a", name: "Refs", parentId: null },
      { id: "b", name: "Hands", parentId: "a" },
      { id: "c", name: "Palms", parentId: "b" },
      { id: "d", name: "Other", parentId: null },
    ];
    expect([...folderSubtree(folders, "a")].sort()).toEqual(["a", "b", "c"]);
    expect([...folderSubtree(folders, "d")]).toEqual(["d"]);
    expect(folderPath(folders, "c")).toEqual(["Refs", "Hands", "Palms"]);
  });

  it("reads entries written before organization existed with empty defaults", () => {
    const old = { hash: HASH_A, name: "x", type: "image/png", size: 1, pixelW: 1, pixelH: 1, importedAt: 0, state: "active" as const, deletedAt: null };
    expect(meta(old)).toEqual({ tags: [], favorite: false, folderIds: [] });
  });
});
