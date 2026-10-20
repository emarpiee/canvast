import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { DocumentStore } from "../../src/doc/document-store";
import type { PathObject } from "../../src/doc/model";
import { assetOf, deserializeObject, newObjectId, serializeObject, storedAssetOf } from "../../src/doc/model";
import { inkOfPaint, isGradient, solidOf } from "../../src/doc/paint";
import { rectSubs } from "../../src/doc/path";
import { exportSvg } from "../../src/app/svg-export";
import { pdfVectorOf } from "../../src/app/pdf-vector";
import { isTextureValid, layoutOf, nearOrigin, newTexture, sameTexture, withSource } from "../../src/doc/texture";

const H = "a".repeat(64);
describe("texture fills (ADR 0154)", () => {
  it("accepts a picture or objects, and refuses what a document must not hold", () => {
    const pic = newTexture({ kind: "asset", hash: H }, "#102030");
    expect(isTextureValid(pic)).toBe(true);
    expect(isTextureValid(newTexture({ kind: "objects", ids: ["a", "b"] }))).toBe(true);
    expect(isTextureValid({ ...pic, src: { kind: "asset", hash: "nope" } })).toBe(false);
    expect(isTextureValid({ ...pic, src: { kind: "objects", ids: [] } })).toBe(false);
    expect(isTextureValid({ ...newTexture({ kind: "objects", ids: ["a"] }), mode: "fill" }), "objects are always repeated").toBe(false);
    expect(isTextureValid({ ...pic, scale: 0 })).toBe(false);
    expect(isTextureValid({ ...pic, spacing: [-1, 0] })).toBe(false);
    expect(isTextureValid({ ...pic, offset: [NaN, 0] })).toBe(false);
    expect(isTextureValid({ ...pic, avg: "red" })).toBe(false);
    expect(isTextureValid({ ...pic, tile: "round" })).toBe(false);
  });
  it("a source change keeps the placement, and objects become tiled", () => {
    const pic = { ...newTexture({ kind: "asset", hash: H }), mode: "fit" as const, scale: 2 };
    const pat = withSource(pic, { kind: "objects", ids: ["x"] }, "#000000");
    expect([pat.mode, pat.scale, pat.avg]).toEqual(["tile", 2, "#000000"]);
    expect(sameTexture(pic, { ...pic, avg: "#ffffff" })).toBe(true);
    expect(sameTexture(pic, { ...pic, rotation: 5 })).toBe(false);
  });
  it("fill covers the box and fit shows the whole picture, centred, whatever the shapes", () => {
    const box = { w: 200, h: 100 };
    const wide = layoutOf(newTexture({ kind: "asset", hash: H }), box, 4); // 4 : 1 picture in a 2 : 1 box
    expect([wide.tw, wide.th]).toEqual([400, 100]); // the height fills, the width overflows
    expect([wide.ox, wide.oy]).toEqual([-200, -50]);
    const fit = layoutOf({ ...newTexture({ kind: "asset", hash: H }), mode: "fit" }, box, 4);
    expect([fit.tw, fit.th]).toEqual([200, 50]); // all of it, a band across the middle
    const tall = layoutOf(newTexture({ kind: "asset", hash: H }), box, 0.5); // 1 : 2 picture
    expect([tall.tw, tall.th]).toEqual([200, 400]);
    expect(layoutOf({ ...newTexture({ kind: "asset", hash: H }), scale: 2, offset: [0.5, 0] }, box, 2).ox).toBe(-200 + 100); // (twice as big, moved half a box right)
  });
  it("a tile is a share of the box's longer side; spacing, alignment and the hex grids set the cell", () => {
    const box = { w: 400, h: 200 };
    const t = { ...newTexture({ kind: "objects", ids: ["a"] }), spacing: [1, 0.5] as const, align: "end" as const };
    const l = layoutOf(t, box, 2); // 2 : 1 tile
    expect([l.tw, l.th]).toEqual([100, 50]);
    expect([l.cw, l.ch]).toEqual([200, 75]); // a tile of space beside it, half a tile below
    expect(l.tiles).toEqual([[100, 0]]); // at the end of its cell
    expect([l.ox, l.oy]).toEqual([-200, -100]); // the cell starts at the box's top left
    const hexH = layoutOf({ ...t, tile: "hex-h", align: "start" }, box, 2);
    expect([hexH.cw, hexH.ch, hexH.tiles.length]).toEqual([200, 150, 2]);
    expect(hexH.tiles[1]).toEqual([100, 75]); // the second row is half a cell across
    const hexV = layoutOf({ ...t, tile: "hex-v", align: "start" }, box, 2);
    expect([hexV.cw, hexV.ch]).toEqual([400, 75]);
    expect(hexV.tiles[1]).toEqual([200, 37.5]);
  });
  it("a repeated layout can be moved by whole cells near the view without changing where tiles fall", () => {
    const l = layoutOf({ ...newTexture({ kind: "objects", ids: ["a"] }) }, { w: 400, h: 400 }, 1);
    const n = nearOrigin(l, 5000, -3000);
    expect((n.ox - l.ox) % l.cw).toBeCloseTo(0, 9);
    expect((n.oy - l.oy) % l.ch).toBeCloseTo(0, 9);
    expect(Math.abs(n.ox - 5000)).toBeLessThan(l.cw);
    expect(Math.abs(n.oy + 3000)).toBeLessThan(l.ch);
    const single = layoutOf(newTexture({ kind: "asset", hash: H }), { w: 10, h: 10 }, 1);
    expect(nearOrigin(single, 1e6, 1e6), "a picture placed once is not moved").toBe(single);
  });
});

describe("texture fills in the document (ADR 0154)", () => {
  const mk = (fill: unknown): PathObject => ({ id: newObjectId(), kind: "path", anchor: { x: D.ZERO, y: D.ZERO }, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, sub: rectSubs(0, 0, 100, 50), fill: fill as PathObject["fill"], stroke: null, width: 1 });
  const pic = newTexture({ kind: "asset", hash: H }, "#102030");
  it("is stored with its picture's hash where the library looks for it, and read back", () => {
    const s = serializeObject(mk(pic));
    expect(s["assetId"]).toBe(H);
    expect(storedAssetOf(s as Record<string, unknown>)).toBe(H);
    const back = deserializeObject(JSON.parse(JSON.stringify(s)));
    expect((back as PathObject).fill).toEqual(pic);
    expect(assetOf(back)).toBe(H);
    expect(serializeObject(mk(newTexture({ kind: "objects", ids: ["a"] })))["assetId"], "an objects fill uses no picture").toBeUndefined();
  });
  it("is for a fill only, and a broken one is refused", () => {
    expect(() => deserializeObject(JSON.parse(JSON.stringify({ ...serializeObject(mk(null)), fill: { ...pic, scale: -1 } })))).toThrow();
    expect(() => deserializeObject(JSON.parse(JSON.stringify({ ...serializeObject(mk(null)), stroke: pic })))).toThrow();
  });
  it("stands for itself as its average colour where one colour is needed (SVG, swatches, the density preview); a PDF page with one is a picture", () => {
    expect(solidOf(pic)).toBe("#102030");
    expect(inkOfPaint(pic)).toEqual({ rgb: "#102030", alpha: 1 });
    expect(isGradient(pic)).toBe(false);
    const doc = new DocumentStore();
    expect(exportSvg([mk(pic)], doc.space)).toContain('fill="#102030"');
    expect(pdfVectorOf([mk(pic)], doc.space, 100, 50)).toBeNull();
  });
});
