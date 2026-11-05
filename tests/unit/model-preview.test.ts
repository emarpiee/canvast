import { describe, expect, it } from "vitest";
import { ZERO } from "../../src/core/dyadic";
import { deserializeObject, newObjectId, rasterKey, serializeObject } from "../../src/doc/model";
import type { ImageObject } from "../../src/doc/model";

describe("a card's preview", () => {
  it("survives a copy or a save, and its picture is the object's own", () => {
    const o = { id: newObjectId(), kind: "image", assetId: "ab".repeat(32), anchor: { x: ZERO, y: ZERO }, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, w: 3, h: 4, pixelW: 300, pixelH: 400, preview: "2" } as unknown as ImageObject;
    const back = deserializeObject(serializeObject(o)) as ImageObject;
    expect(back.preview).toBe("2");
    expect(rasterKey(back)).toBe(`${"ab".repeat(32)}#p300x400#v2`);
  });
});
