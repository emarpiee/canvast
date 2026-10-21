import { describe, expect, it } from "vitest";
import { LAYER_KINDS, clipBaseOf, fromPx, newPage, nextName, stackOf, toPx, validLayer, validPainting, type Layer } from "../../src/paint/model";
import { History, inverse } from "../../src/paint/history";
import { readFileSync } from "node:fs";
import { valuesOf } from "../../src/paint/tools";
import { BRUSH_SECTIONS, brushOf, cleanBrushes, lockOf, pickedBrush, engineValue, getPath, pickedValues, setPath, shown, tipsOf, withKeys, type BrushPreset } from "../../src/paint/brushes";
import { toolForKey } from "../../src/settings/shortcuts";
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
    const b = brushOf("eraser", valuesOf("eraser", { size: 40, hardness: 50 }), { size: 3, scattering: { enabled: true } }, "#ff8000");
    expect(b).toMatchObject({ size: 40, hardness: 0.5, erase: true, scattering: { enabled: true } }); // (the bar's values over the tool's brush)
    expect(b["color"]).toEqual([1, 128 / 255, 0, 1]);
    // one keymap for both views (ADR 0168): a key bound twice belongs to the command of the view it is pressed in
    expect([toolForKey("b", "paint"), toolForKey("b", "canvas"), toolForKey("e", "paint"), toolForKey("e", "canvas")]).toEqual(["brush", "path", "eraser", "eraser"]);
  });
});

describe("brush presets (ADR 0169)", () => {
  const K = "b".repeat(64);
  const tip = { stored: { key: K, width: 40, height: 20, preview: { width: 2, height: 1, data: "AAAAAA==" } } };
  it("keep what checks: ids, names, a brush whose bitmaps are named by hash; the rest is left out", () => {
    const ok = { id: "c".repeat(32), name: " Chalk ", brush: { size: 30, tip }, captures: { size: false } };
    const list = cleanBrushes([ok, { ...ok }, { ...ok, id: "d".repeat(32), brush: { tip: { stored: { ...tip.stored, key: "#0" } } } }, { id: "e".repeat(32), name: "", brush: {} }, null]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Chalk", group: "General", folder: [], captures: { size: false, toolSettings: true } });
    expect(tipsOf(list[0]!.brush)).toEqual([{ key: K, w: 40, h: 20 }]);
    expect(tipsOf(withKeys({ tip: { stored: { ...tip.stored, key: "#0" } }, texture: { pattern: { stored: { ...tip.stored, key: "#1" } } } }, [K, "f".repeat(64)])).map((t) => t.key)).toEqual([K, "f".repeat(64)]);
  });
  it("picking a preset brings its size and tool settings only when it captured them", () => {
    const p: BrushPreset = { id: "c".repeat(32), name: "P", group: "G", folder: [], brush: { size: 50, hardness: 0.25, opacity: 0.5, pressureSize: false }, captures: { size: false, toolSettings: true } };
    expect(pickedValues(p, valuesOf("brush", { size: 10 }))).toMatchObject({ size: 10, hardness: 25, opacity: 50, pressureSize: false });
    // Its sections, except the ones the tool pins, its smoothing, and a protected texture's pattern and scale.
    const cur = { smoothing: { amount: 0.5 }, transfer: { enabled: true }, buildUp: true, locks: { transfer: true, buildUp: true }, protectTexture: true, texture: { enabled: true, pattern: "mine", scale: 2 } };
    const preset = { size: 50, transfer: { enabled: false }, scattering: { enabled: true }, buildUp: false, buildUpRate: 9, texture: { enabled: true, pattern: "its", scale: 1, depth: 0.3 } };
    expect(pickedBrush(preset, cur)).toEqual({ size: 50, scattering: { enabled: true }, transfer: { enabled: true }, buildUp: true, smoothing: { amount: 0.5 }, locks: cur.locks, protectTexture: true, texture: { enabled: true, pattern: "mine", scale: 2, depth: 0.3 } });
  });
  it("a setting is read and written at its path, in the panel's units", () => {
    const s = BRUSH_SECTIONS.flatMap((x) => x.items).find((x) => x.k === "shapeDynamics.size.jitter")!;
    const b = setPath({ shapeDynamics: { enabled: true } }, s.k, engineValue(s, 40));
    expect(b).toEqual({ shapeDynamics: { enabled: true, size: { jitter: 0.4 } } });
    expect(shown(s, b)).toBe(40);
    expect(shown(s, {})).toBeUndefined();
  });
  it("every Brush Settings path is a setting of the engine's brush (its default JSON), of the kind the panel shows", async () => {
    const { instance } = await WebAssembly.instantiate(readFileSync("engine/out/brush.wasm"), {});
    const e = instance.exports as unknown as { memory: WebAssembly.Memory; brush_default(): number; out_ptr(): number; out_len(): number };
    e.brush_default();
    const def = JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer, e.out_ptr(), e.out_len())));
    for (const sec of BRUSH_SECTIONS) {
      if (sec.on) expect(typeof getPath(def, sec.on), sec.on).toBe("boolean");
      if (lockOf(sec)) expect(typeof getPath(def, `locks.${lockOf(sec)}`), sec.title).toBe("boolean");
      for (const s of sec.items) expect(typeof getPath(def, s.k), s.k).toBe(s.t === "range" ? "number" : s.t === "toggle" ? "boolean" : "string");
    }
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
