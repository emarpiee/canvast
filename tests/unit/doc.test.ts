import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import * as D from "../../src/core/dyadic";
import { DocumentStore } from "../../src/doc/document-store";
import type { CanvasObject, ImageObject, StrokeObject } from "../../src/doc/model";
import { InvalidObjectError, deserializeObject, localBounds, newObjectId, serializeObject, validateObject } from "../../src/doc/model";
import { localToWorld, normalizeUnit, scaleAbout, translate } from "../../src/doc/edit-ops";
import { sha256Portable } from "../../src/assets/sha256";
import { rng } from "./rng";

function stroke(over: Partial<StrokeObject> = {}): StrokeObject {
  return {
    id: newObjectId(),
    kind: "stroke",
    anchor: { x: D.fromBigInt(3n, 1000), y: D.fromBigInt(-5n, -1000) },
    unit: -7,
    z: 1,
    opacity: 1,
    attachmentTargetId: null,
    points: [0, 0, 10.5, 3.25, 20, -4],
    width: 2,
    color: "#1f2329",
    ...over,
  };
}

function image(over: Partial<ImageObject> = {}): ImageObject {
  return {
    id: newObjectId(),
    kind: "image",
    anchor: { x: D.ZERO, y: D.fromNumber(0.5) },
    unit: 0,
    z: 0,
    opacity: 1,
    attachmentTargetId: null,
    assetId: "a".repeat(64),
    w: 800,
    h: 600,
    pixelW: 8,
    pixelH: 6,
    ...over,
  };
}

describe("object model", () => {
  it("serializes losslessly through JSON", () => {
    for (const o of [stroke(), image()] as CanvasObject[]) {
      const back = deserializeObject(JSON.parse(JSON.stringify(serializeObject(o))));
      expect(back).toEqual(o);
    }
  });

  it("rejects corrupt objects instead of storing NaN or unknown links", () => {
    expect(() => validateObject(stroke({ points: [0, NaN] }))).toThrow(InvalidObjectError);
    expect(() => validateObject(stroke({ points: [0] }))).toThrow(InvalidObjectError);
    expect(() => validateObject(stroke({ width: 0 }))).toThrow(InvalidObjectError);
    expect(() => validateObject(stroke({ unit: 1.5 }))).toThrow(InvalidObjectError);
    expect(() => validateObject(stroke({ color: "red" }))).toThrow(InvalidObjectError);
    expect(() => validateObject(stroke({ attachmentTargetId: newObjectId() }))).toThrow(InvalidObjectError);
    expect(() => validateObject(image({ pixelW: 0 }))).toThrow(InvalidObjectError);
    expect(() => validateObject(image({ assetId: "x" }))).toThrow(InvalidObjectError);
    expect(() => deserializeObject({ id: newObjectId(), kind: "blob", ax: "0p0", ay: "0p0" })).toThrow(InvalidObjectError);
  });

  it("includes stroke width in local bounds", () => {
    expect(localBounds(stroke())).toEqual({ minX: -1, minY: -5, maxX: 21, maxY: 4.25 });
  });
});

describe("edit operations", () => {
  it("translates exactly, even by sub-double amounts far from the origin", () => {
    const o = stroke();
    const dx = D.fromBigInt(1n, -2000);
    const moved = translate(o, dx, D.ZERO);
    expect(D.equals(D.sub(moved.anchor.x, o.anchor.x), dx)).toBe(true);
    expect(translate(moved, D.neg(dx), D.ZERO)).toEqual(o);
  });

  it("scales about a fixed point: the fixed point does not move", () => {
    const o = stroke();
    const fixed = localToWorld(o, 20, -4); // last vertex
    const s = scaleAbout(o, fixed, 2.5, 2.5);
    const p = s as StrokeObject;
    const last = localToWorld(p, p.points[4]!, p.points[5]!);
    const err = D.toNumber(D.shift(D.sub(last.x, fixed.x), -p.unit));
    expect(Math.abs(err)).toBeLessThan(1e-12);
    expect((s as StrokeObject).width * 2 ** s.unit).toBeCloseTo(2 * 2.5 * 2 ** o.unit, 12);
  });

  it("keeps local geometry well-conditioned with exact power-of-two renormalization", () => {
    const big = normalizeUnit(stroke({ points: [0, 0, 2 ** 30, 2 ** 29], width: 2 ** 20 })) as StrokeObject;
    expect(big.unit).toBe(-7 + 22);
    expect(big.points).toEqual([0, 0, 2 ** 8, 2 ** 7]);
    const tiny = normalizeUnit(stroke({ points: [0, 0, 2 ** -12, 0], width: 2 ** -14 })) as StrokeObject;
    expect(Math.log2(Math.max(...tiny.points.map(Math.abs)))).toBeGreaterThanOrEqual(0);
    // World geometry is unchanged by renormalization.
    const before = stroke({ points: [0, 0, 2 ** 30, 2 ** 29], width: 2 ** 20 });
    const a = localToWorld(before, 2 ** 30, 2 ** 29);
    const b = localToWorld(big, 2 ** 8, 2 ** 7);
    expect(D.equals(a.x, b.x) && D.equals(a.y, b.y)).toBe(true);
  });

  it("rejects non-positive and non-uniform stroke scales", () => {
    expect(() => scaleAbout(stroke(), { x: D.ZERO, y: D.ZERO }, 0, 0)).toThrow(RangeError);
    expect(() => scaleAbout(stroke(), { x: D.ZERO, y: D.ZERO }, 2, 3)).toThrow(RangeError);
    expect(() => scaleAbout(image(), { x: D.ZERO, y: D.ZERO }, 2, 3)).not.toThrow();
  });
});

describe("document store", () => {
  it("commits, undoes and redoes to exactly the stored objects", () => {
    const doc = new DocumentStore();
    const a = stroke();
    const b = image();
    doc.commit(doc.transaction("add", [a, b]));
    const a2 = translate(a, D.fromNumber(1), D.fromNumber(-1));
    doc.commit(doc.transaction("move", [a2]));
    doc.commit(doc.transaction("delete", [], [b.id]));
    expect(doc.size).toBe(1);
    doc.undo();
    expect(doc.get(b.id)).toBe(b);
    doc.undo();
    expect(doc.get(a.id)).toBe(a);
    doc.redo();
    expect(doc.get(a.id)).toBe(a2);
    expect(doc.canRedo).toBe(true);
    doc.commit(doc.transaction("move again", [translate(a2, D.fromNumber(1), D.ZERO)]));
    expect(doc.canRedo).toBe(false);
  });

  it("validates before mutating: a bad transaction changes nothing", () => {
    const doc = new DocumentStore();
    const a = stroke();
    doc.commit(doc.transaction("add", [a]));
    const rev = doc.revision;
    const bad = { ...a, points: [Infinity, 0] };
    expect(() => doc.commit(doc.transaction("bad", [image(), bad]))).toThrow(InvalidObjectError);
    expect(doc.size).toBe(1);
    expect(doc.get(a.id)).toBe(a);
    expect(doc.revision).toBe(rev);
  });

  it("rejects stale transactions built against an older state", () => {
    const doc = new DocumentStore();
    const a = stroke();
    doc.commit(doc.transaction("add", [a]));
    const stale = doc.transaction("move", [translate(a, D.fromNumber(1), D.ZERO)]);
    doc.commit(doc.transaction("other move", [translate(a, D.fromNumber(2), D.ZERO)]));
    expect(() => doc.commit(stale)).toThrow(/stale/);
  });

  it("orders by z then id", () => {
    const doc = new DocumentStore();
    const objs = [stroke({ z: 3 }), image({ z: 1 }), stroke({ z: 2 })];
    doc.commit(doc.transaction("add", objs));
    expect(doc.ordered().map((o) => o.z)).toEqual([1, 2, 3]);
    expect(doc.topZ()).toBe(3);
  });
});

describe("asset hashing", () => {
  it("portable SHA-256 matches the platform implementation", () => {
    const r = rng(7);
    for (const len of [0, 1, 55, 56, 63, 64, 65, 1000, 4096]) {
      const bytes = new Uint8Array(len).map(() => Math.floor(r() * 256));
      const expected = createHash("sha256").update(bytes).digest("hex");
      const got = Buffer.from(sha256Portable(bytes)).toString("hex");
      expect(got).toBe(expected);
    }
  });
});
