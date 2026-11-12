import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import type { PathObject } from "../../src/doc/model";
import { InvalidObjectError, canBeBackdrop, deserializeObject, newObjectId, serializeObject, validateObject } from "../../src/doc/model";

const shape = (extra: Partial<PathObject> = {}): PathObject =>
  ({ id: newObjectId(), kind: "path", anchor: { x: D.fromNumber(0), y: D.fromNumber(0) }, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, sub: [{ n: [0, 0, 0, 0, 0, 0, 10, 0, 10, 0, 10, 0, 10, 10, 10, 10, 10, 10, 0, 10, 0, 10, 0, 10], closed: true }], fill: null, stroke: null, width: 1, ...extra });

describe("adjustment shapes (ADR 0188): any shape but a path", () => {
  it("a shape made with a shape tool can be one; a path, a line and a sheet cannot", () => {
    for (const k of ["rect", "ellipse", "polygon", "star", "balloon"] as const) expect(canBeBackdrop(shape({ shape: k })), k).toBe(true);
    expect(canBeBackdrop(shape())).toBe(false);
    expect(canBeBackdrop(shape({ shape: "line" }))).toBe(false);
    expect(canBeBackdrop(shape({ shape: "rect", container: { clip: true } }))).toBe(false);
  });

  it("is refused on anything that cannot be one, and kept through saving", () => {
    expect(() => validateObject(shape({ backdrop: true }))).toThrow(InvalidObjectError);
    expect(() => validateObject(shape({ shape: "line", backdrop: true }))).toThrow(InvalidObjectError);
    const ok = shape({ shape: "ellipse", backdrop: true, adjust: { blur: 100 } });
    expect(() => validateObject(ok)).not.toThrow();
    expect((deserializeObject(JSON.parse(JSON.stringify(serializeObject(ok)))) as PathObject).backdrop).toBe(true);
  });
});
