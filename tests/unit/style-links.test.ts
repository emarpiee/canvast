import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { paintedWith } from "../../src/app/actions";
import { linkedUpdates } from "../../src/app/style-sync";
import { DocumentStore } from "../../src/doc/document-store";
import { deserializeObject, newObjectId, serializeObject } from "../../src/doc/model";
import type { ImageObject, PathObject } from "../../src/doc/model";
import { rectSubs } from "../../src/doc/path";
import type { StyleItem } from "../../src/assets/styles";

const path = (extra: Partial<PathObject> = {}): PathObject => ({ id: newObjectId(), kind: "path", anchor: { x: D.ZERO, y: D.ZERO }, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, sub: rectSubs(0, 0, 10, 10), fill: "#112233", stroke: null, width: 2, ...extra });
const colour = (id: string, c: string): StyleItem => ({ id, kind: "colour", name: "wow", at: 0, data: c });

describe("objects that follow a saved colour (ADR 0157)", () => {
  it("applying a style links the part; changing the part by hand unlinks it", () => {
    const linked = paintedWith(path(), { fill: "#ff0000" }, { fill: "s1" }) as PathObject;
    expect(linked.fill).toBe("#ff0000");
    expect(linked.styles).toEqual({ fill: "s1" });
    expect(paintedWith(linked, { fill: "#00ff00" }).styles).toBeUndefined();
    expect(paintedWith(linked, { stroke: "#00ff00" }).styles, "another part leaves the link").toEqual({ fill: "s1" });
  });
  it("a picture has no fill: a style put on its fill changes nothing", () => {
    const pic = { id: "i", kind: "image", anchor: { x: D.ZERO, y: D.ZERO }, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, w: 10, h: 10, hash: "h" } as unknown as ImageObject;
    expect(paintedWith(pic, { fill: "#ff0000" }, { fill: "s1" })).toBe(pic);
  });
  it("a style that changed is put on the objects that follow it, and only on them", () => {
    const doc = new DocumentStore();
    const a = paintedWith(path(), { fill: "#ff0000" }, { fill: "s1" }) as PathObject;
    const b = path({ fill: "#ff0000" }); // the same colour, not linked
    doc.load([a, b]);
    expect(linkedUpdates(doc, [colour("s1", "#ff0000")])).toEqual([]);
    const next = linkedUpdates(doc, [colour("s1", "#0000ff")]) as PathObject[];
    expect(next.map((o) => [o.id, o.fill])).toEqual([[a.id, "#0000ff"]]);
    expect(next[0]!.styles).toEqual({ fill: "s1" });
  });
  it("a style that is gone unlinks the object and keeps its paint", () => {
    const doc = new DocumentStore();
    const a = paintedWith(path(), { stroke: "#ff0000" }, { stroke: "s1" }) as PathObject;
    doc.load([a]);
    const [n] = linkedUpdates(doc, []) as PathObject[];
    expect(n!.stroke).toBe("#ff0000");
    expect(n!.styles).toBeUndefined();
  });
  it("the links are stored and read back", () => {
    const a = paintedWith(path(), { fill: "#ff0000" }, { fill: "s1" }) as PathObject;
    expect(deserializeObject(JSON.parse(JSON.stringify(serializeObject(a)))).styles).toEqual({ fill: "s1" });
  });
  it("undo after an update brings back the old paint with its link; refit is for an empty history only", () => {
    const doc = new DocumentStore();
    const a = paintedWith(path(), { fill: "#ff0000" }, { fill: "s1" }) as PathObject;
    doc.load([a]);
    doc.refit(linkedUpdates(doc, [colour("s1", "#0000ff")]));
    expect((doc.get(a.id) as PathObject).fill).toBe("#0000ff");
    expect(doc.canUndo, "a quiet change leaves nothing to undo").toBe(false);
    doc.commit(doc.transaction("x", linkedUpdates(doc, [colour("s1", "#00ff00")])));
    expect(() => doc.refit(linkedUpdates(doc, [colour("s1", "#ffffff")]))).toThrow();
    doc.undo();
    expect((doc.get(a.id) as PathObject).fill).toBe("#0000ff");
  });
});
