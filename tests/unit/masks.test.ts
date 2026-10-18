import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { FrameSpace } from "../../src/core/frames";
import { buildPayload, instantiate } from "../../src/doc/clipboard";
import { duplicateRecords } from "../../src/doc/duplicate";
import { maskMembers, masksOf } from "../../src/doc/masks";
import type { CanvasObject, StrokeObject } from "../../src/doc/model";
import { deserializeObject, newObjectId, serializeObject, validateObject } from "../../src/doc/model";

const stroke = (z: number, extra: Partial<StrokeObject> = {}): StrokeObject => ({ id: newObjectId(), kind: "stroke", anchor: { x: D.ZERO, y: D.ZERO }, unit: 0, z, opacity: 1, attachmentTargetId: null, points: [0, 0, 10, 4], width: 2, color: "#112233", ...extra });
const MG = newObjectId();
const G = newObjectId();

describe("masks (ADR 0144)", () => {
  it("a mask is the objects of its group that are marked as mask, in paint order", () => {
    const a = stroke(2, { isMask: true, groups: [G, MG] });
    const b = stroke(1, { isMask: true, groups: [G, MG] });
    const cut = stroke(3, { groups: [G], mask: { by: MG, mode: "alpha" } });
    const other = stroke(4, { groups: [MG] }); // in the group but not marked: not part of the mask
    expect(maskMembers([a, b, cut, other], MG).map((o) => o.id)).toEqual([b.id, a.id]);
    expect(masksOf([cut, a])).toEqual([MG]);
  });
  it("the fields are kept by the stored form and refused when wrong", () => {
    const cut = stroke(1, { mask: { by: MG, mode: "luminance", invert: true } });
    const back = deserializeObject(serializeObject(cut)) as StrokeObject;
    expect(back.mask).toEqual(cut.mask);
    expect(deserializeObject(serializeObject(stroke(1, { isMask: true }))).isMask).toBe(true);
    expect(() => validateObject(stroke(1, { mask: { by: "no id", mode: "alpha" } }))).toThrow("bad mask");
    expect(() => validateObject(stroke(1, { mask: { by: MG, mode: "other" as "alpha" } }))).toThrow("bad mask");
    expect(() => validateObject(stroke(1, { isMask: false as unknown as true }))).toThrow("isMask");
  });
  it("copies follow the mask to its new group; a mask copied alone stops being a mask", () => {
    const space = new FrameSpace();
    const mask = stroke(1, { isMask: true, groups: [G, MG] });
    const cut = stroke(2, { groups: [G], mask: { by: MG, mode: "alpha" } });
    const both = instantiate(buildPayload([mask, cut], space.world, 0), space, 0).objects;
    const copyCut = both.find((o) => o.mask)!;
    const copyMask = both.find((o) => o.isMask)!;
    expect(copyCut.mask!.by).not.toBe(MG);
    expect(copyMask.groups).toContain(copyCut.mask!.by);
    const alone = instantiate(buildPayload([mask], space.world, 0), space, 0).objects;
    expect(alone[0]!.isMask).toBeUndefined();
  });
  it("a copied canvas names its own mask group", () => {
    const rec = [serializeObject(stroke(1, { isMask: true, groups: [G, MG] })), serializeObject(stroke(2, { groups: [G], mask: { by: MG, mode: "alpha" } }))];
    const copy = duplicateRecords(rec, (() => { let n = 0; return () => `${"0".repeat(31)}${(n++ % 10).toString()}`; })());
    const cut = copy.find((r) => r["mask"])!;
    const mask = copy.find((r) => r["isMask"])!;
    expect((cut["mask"] as { by: string }).by).not.toBe(MG);
    expect((mask["groups"] as string[]).includes((cut["mask"] as { by: string }).by)).toBe(true);
  });
});
void ({} as CanvasObject);
