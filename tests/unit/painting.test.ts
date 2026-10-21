import { describe, expect, it } from "vitest";
import { LAYER_KINDS, clipBaseOf, fromPx, newPage, nextName, stackOf, toPx, validLayer, validPainting, type Layer } from "../../src/paint/model";
import { History, inverse } from "../../src/paint/history";
import { TOOLS, brushOf, toolForKey, valuesOf } from "../../src/paint/tools";
import { clampCamera, fitCamera, toPage, zoomAt } from "../../src/paint/camera";
import { deflate, hashOf, inflate, isEmpty, TILE_BYTES } from "../../src/paint/codec";

const H = "a".repeat(64);
const layer = (id: string, z: number, more: Partial<Layer> = {}): Layer => ({ ...LAYER_KINDS.raster.fresh({ paintingId: "p", id, pageId: "pg", z, opacity: 1 }), name: id, ...more }) as Layer;

describe("painting model (ADR 0165)", () => {
  it("checks records: a page in px within the limits, a layer's flags and tile names", () => {
    expect(validPainting({ id: "p", workspaceId: "w", name: "P", pages: [newPage()], created: 1, modified: 1 })).toBe(true);
    expect(validPainting({ id: "p", workspaceId: "w", name: "P", pages: [newPage({ w: 9000 })], created: 1, modified: 1 })).toBe(false);
    expect(validLayer(layer("a", 1, { tiles: { "0,1": H } }))).toBe(true);
    expect(validLayer(layer("a", 1, { tiles: { "x": H } }))).toBe(false);
    expect(validLayer({ ...layer("a", 1), hidden: false })).toBe(false);
  });

  it("a clipped layer is cut by the nearest layer under it that is not clipped (several share one base)", () => {
    const s = stackOf([layer("top", 4, { clipBelow: true }), layer("base", 1), layer("mid", 2, { clipBelow: true })], "pg");
    expect(s.map((l) => l.id)).toEqual(["base", "mid", "top"]);
    expect(clipBaseOf(s, 2)?.id).toBe("base");
    expect(clipBaseOf(s, 0)).toBeUndefined();
  });

  it("names the next one after the highest number, and turns physical units into px at the DPI", () => {
    expect(nextName("Layer", ["Layer 1", "Layer 7", "Other 9"])).toBe("Layer 8");
    expect(toPx(210, "mm", 300)).toBeCloseTo(2480.3, 1);
    expect(fromPx(toPx(3.5, "in", 150), "in", 150)).toBeCloseTo(3.5);
  });
});

describe("painting history", () => {
  it("undo applies the inverse (reverse order, before and after swapped) and redo the step again", () => {
    const a = layer("a", 1), b = layer("a", 1, { tiles: { "0,0": H } });
    const h = new History();
    h.push({ label: "Paint", ops: [{ store: "layer", before: a, after: b }, { store: "layer", before: null, after: layer("n", 2) }] });
    const u = h.undo()!;
    expect(u.ops.map((o) => [o.before?.id ?? null, o.after?.id ?? null])).toEqual([["n", null], ["a", "a"]]);
    expect(u.ops[1]!.after).toBe(a);
    expect(h.redo()!.ops[0]!.after).toBe(b);
    expect(inverse(inverse(u)).ops).toEqual(u.ops);
    expect([...h.roots()]).toEqual([H]); // (the tile a step can bring back is kept by the GC)
  });
});

describe("painting tools", () => {
  it("each tool's values are checked against its schema, and become the engine's brush", () => {
    expect(valuesOf("brush", { size: 5000, flow: "x" })).toMatchObject({ size: 1000, flow: 100 });
    const b = brushOf("eraser", valuesOf("eraser", { size: 40, hardness: 50 }), "#ff8000") as Record<string, unknown>;
    expect(b).toMatchObject({ size: 40, hardness: 0.5, erase: true });
    expect(b["color"]).toEqual([1, 128 / 255, 0, 1]);
    expect(toolForKey("e")).toBe("eraser");
    expect(Object.values(TOOLS).every((t) => t.key.length === 1)).toBe(true);
  });
});

describe("painting camera", () => {
  const page = { w: 2000, h: 1000 }, view = { w: 1000, h: 800 };
  it("fits the page with a margin, zooms about a point that stays put, and keeps the page in view", () => {
    const f = fitCamera(page, view);
    expect(f.scale).toBeCloseTo((1000 - 64) / 2000);
    const z = zoomAt(f, 4, 300, 400, page, view);
    expect(toPage(z, 300, 400)[0]).toBeCloseTo(toPage(f, 300, 400)[0]);
    expect(zoomAt(f, 1e9, 0, 0, page, view).scale).toBe(64);
    const far = clampCamera({ ...f, x: -1e6 }, page, view);
    expect(far.x + page.w * far.scale).toBeGreaterThanOrEqual(Math.min(view.w / 4, page.w * far.scale) - 1e-9);
  });
});

describe("painting tiles", () => {
  it("are stored exactly (deflated RGBA) and named by the hash of their pixels", async () => {
    const px = new Uint8Array(TILE_BYTES);
    expect(isEmpty(px)).toBe(true);
    px[3] = 1;
    px[1000] = 77;
    const back = await inflate(await deflate(px));
    expect(back).toEqual(px);
    expect(await hashOf(back!)).toBe(await hashOf(px));
    expect(await inflate(new Blob(["not a tile"]))).toBeNull();
  });
});
