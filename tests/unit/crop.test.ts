import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { cropEdges, uncrop } from "../../src/doc/crop";
import type { ImageObject } from "../../src/doc/model";
import { deserializeObject, newObjectId, serializeObject } from "../../src/doc/model";

const img = (extra: Partial<ImageObject> = {}): ImageObject => ({ id: newObjectId(), kind: "image", anchor: { x: D.fromNumber(10), y: D.fromNumber(20) }, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, assetId: "a".repeat(64), w: 200, h: 100, pixelW: 400, pixelH: 200, ...extra });
const at = (o: ImageObject): [number, number] => [D.toNumber(o.anchor.x), D.toNumber(o.anchor.y)];

describe("cropping a picture (ADR 0118)", () => {
  it("cutting in keeps what is left where it is: the box shrinks to the window and its corner moves with the cut", () => {
    const c = cropEdges(img(), 50, 10, 20, 0);
    expect(c.crop).toEqual({ x: 100, y: 20, w: 400 - 100 - 40, h: 200 - 20 });
    expect([c.w, c.h]).toEqual([130, 90]);
    expect(at(c)).toEqual([60, 30]); // 10 + 50, 20 + 10
  });
  it("pulling back out brings the source back, and a whole pixel is the least that moves", () => {
    const c = cropEdges(img(), 50, 0, 0, 0);
    const back = cropEdges(c, -50, 0, 0, 0);
    expect(back.crop).toBeUndefined();
    expect([back.w, back.h]).toEqual([200, 100]);
    expect(at(back)).toEqual([10, 20]);
    const o = img();
    expect(cropEdges(o, 0.2, 0, 0, 0)).toBe(o); // less than half a source pixel: nothing
  });
  it("cannot go past the source or below a pixel", () => {
    expect(cropEdges(img(), -30, 0, 0, 0).crop).toBeUndefined();
    const tiny = cropEdges(img(), 500, 0, 500, 0);
    expect(tiny.crop!.w).toBe(1);
    expect(tiny.crop!.x).toBeLessThanOrEqual(399);
  });
  it("is undone by uncrop, from any window, and is saved and read back", () => {
    const c = cropEdges(cropEdges(img(), 40, 12, 30, 8), 10, 0, 0, 6);
    const u = uncrop(c);
    expect(u.crop).toBeUndefined();
    expect([u.w, u.h]).toEqual([200, 100]);
    expect(at(u)[0]).toBeCloseTo(10, 9);
    expect(at(u)[1]).toBeCloseTo(20, 9);
    expect((deserializeObject(serializeObject(c)) as ImageObject).crop).toEqual(c.crop);
    expect(() => deserializeObject({ ...serializeObject(c), crop: { x: 0, y: 0, w: 401, h: 1 } })).toThrow();
  });
});
