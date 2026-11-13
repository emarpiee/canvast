import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { FrameSpace } from "../../src/core/frames";
import type { CanvasObject, PathObject, SheetLayout } from "../../src/doc/model";
import { deserializeObject, newObjectId, serializeObject } from "../../src/doc/model";
import type { DerivationSource } from "../../src/doc/boolean-group";
import { DEFAULT_LAYOUT, guessLayout, layOutSheet, placeItems, previewLayout, withAutoLayout, type ItemSize } from "../../src/doc/auto-layout";
import { worldBounds } from "../../src/doc/edit-ops";

const space = new FrameSpace();
const at = (x: number, y: number) => ({ x: D.fromNumber(x), y: D.fromNumber(y) });
const rect = (x: number, y: number, w: number, h: number, z: number, extra: Partial<PathObject> = {}): PathObject =>
  ({ id: newObjectId(), kind: "path", anchor: at(x, y), unit: 0, z, opacity: 1, attachmentTargetId: null, sub: [{ n: [0, 0, 0, 0, 0, 0, w, 0, w, 0, w, 0, w, h, w, h, w, h, 0, h, 0, h, 0, h], closed: true }], fill: "#000000", stroke: null, width: 1, ...extra });
const sheet = (x: number, y: number, w: number, h: number, z: number, layout: Partial<SheetLayout> = {}, extra: Partial<PathObject> = {}): PathObject =>
  rect(x, y, w, h, z, { container: { clip: true, layout: { ...DEFAULT_LAYOUT, ...layout } }, ...extra });
const src = (...all: CanvasObject[]): DerivationSource => ({ get: (id) => all.find((o) => o.id === id), all: () => all, space });
const box = (o: CanvasObject): [number, number, number, number] => {
  const b = worldBounds(o);
  return [D.toNumber(b.min.x), D.toNumber(b.min.y), D.toNumber(b.max.x), D.toNumber(b.max.y)];
};
const of = (list: readonly CanvasObject[], o: CanvasObject): CanvasObject => list.find((x) => x.id === o.id) ?? o;
const near = (a: readonly number[], b: readonly number[]): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));

describe("placing items (doc/auto-layout.ts placeItems)", () => {
  const l = (p: Partial<SheetLayout>): SheetLayout => ({ ...DEFAULT_LAYOUT, ...p });
  const two = [{ w: 10, h: 10 }, { w: 20, h: 10 }];
  it("a row and a column, with a gap and padding, hugging their contents", () => {
    const row = placeItems(l({ flow: "row", gap: [5, 0], pad: [1, 2, 3, 4] }), 100, 100, two);
    expect(row.cells.map((c) => [c.x, c.y])).toEqual([[4, 1], [19, 1]]);
    expect([row.w, row.h]).toEqual([41, 14]);
    const col = placeItems(l({ flow: "column", gap: [5, 0], pad: [1, 2, 3, 4] }), 100, 100, two);
    expect(col.cells.map((c) => [c.x, c.y])).toEqual([[4, 1], [4, 16]]);
    expect([col.w, col.h]).toEqual([26, 29]);
  });
  it("a wrap breaks at the width of a sheet that keeps it; a grid has columns and rows as wide and tall as their largest", () => {
    const wrap = placeItems(l({ flow: "wrap", hug: [false, true] }), 30, 5, [{ w: 10, h: 10 }, { w: 20, h: 10 }, { w: 10, h: 10 }]);
    expect(wrap.cells.map((c) => [c.x, c.y])).toEqual([[0, 0], [10, 0], [0, 10]]);
    expect([wrap.w, wrap.h]).toEqual([30, 20]);
    const grid = placeItems(l({ flow: "grid", columns: 2, gap: [2, 3] }), 100, 100, [{ w: 10, h: 10 }, { w: 14, h: 10 }, { w: 10, h: 12 }, { w: 10, h: 10 }]);
    expect(grid.cells.map((c) => [c.x, c.y])).toEqual([[0, 0], [12, 0], [0, 13], [12, 13]]);
    expect([grid.w, grid.h]).toEqual([26, 25]);
  });
  it("in a sheet that keeps its size: items are packed, centred, at the end or spread; aligned across; one that fills takes the room", () => {
    const fixed = (p: Partial<SheetLayout>, items: ItemSize[] = [{ w: 10, h: 10 }]) => placeItems(l({ hug: [false, false], ...p }), 100, 50, items).cells;
    expect(fixed({ justify: "centre" })[0]!.x).toBe(45);
    expect(fixed({ justify: "end" })[0]!.x).toBe(90);
    expect(fixed({ justify: "between" }, [{ w: 10, h: 10 }, { w: 10, h: 10 }]).map((c) => c.x)).toEqual([0, 90]);
    expect(fixed({ align: "end" })[0]!.y).toBe(40);
    expect(fixed({ align: "centre" })[0]!.y).toBe(20);
    const fill = fixed({}, [{ w: 10, h: 10, fill: "x" }, { w: 10, h: 10 }]);
    expect(fill.map((c) => [c.x, c.w])).toEqual([[0, 90], [90, 10]]);
    expect(fixed({}, [{ w: 10, h: 10, fill: "y" }])[0]!.h).toBe(50);
  });
});

describe("masonry, justified rows, tracks, spans and limits (ADR 0193)", () => {
  const l = (p: Partial<SheetLayout>): SheetLayout => ({ ...DEFAULT_LAYOUT, ...p });
  const r = (cs: readonly { x: number; y: number; w: number; h: number }[]) => cs.map((c) => [c.x, c.y, c.w, c.h].map((v) => Math.round(v * 100) / 100));
  it("masonry: columns of one width share the sheet's, each item made that wide in its shape and put in the shortest column", () => {
    const m = placeItems(l({ flow: "masonry", columns: 2, gap: [10, 5], hug: [false, true] }), 50, 10, [{ w: 10, h: 10 }, { w: 10, h: 20 }, { w: 10, h: 10 }]);
    expect(r(m.cells)).toEqual([[0, 0, 20, 20], [30, 0, 20, 40], [0, 25, 20, 20]]);
    expect([m.w, m.h]).toEqual([50, 45]);
  });
  it("justified rows: a row fills the width at one height; the last keeps the height aimed at", () => {
    const j = placeItems(l({ flow: "justified", gap: [10, 10], rowHeight: 10, hug: [false, true] }), 100, 10, [{ w: 20, h: 10 }, { w: 40, h: 10 }, { w: 30, h: 10 }, { w: 20, h: 20 }]);
    const k = 80 / 90;
    expect(r(j.cells)).toEqual(r([{ x: 0, y: 0, w: 20 * k, h: 10 * k }, { x: 20 * k + 10, y: 0, w: 40 * k, h: 10 * k }, { x: 60 * k + 20, y: 0, w: 30 * k, h: 10 * k }, { x: 0, y: 10 * k + 10, w: 10, h: 10 }]));
  });
  it("grid tracks: a set size, a share of the room left, one as large as what is in it; a share is never smaller than what is in it", () => {
    const g = placeItems(l({ flow: "grid", cols: [{ size: "fixed", v: 30 }, { size: "fr", v: 1 }, { size: "hug" }], hug: [false, true] }), 100, 10, [{ w: 10, h: 10 }, { w: 10, h: 10 }, { w: 10, h: 10 }]);
    expect(g.cells.map((c) => c.x)).toEqual([0, 30, 90]);
    const held = placeItems(l({ flow: "grid", cols: [{ size: "fr" }, { size: "fr" }], hug: [false, true] }), 40, 10, [{ w: 50, h: 10 }, { w: 10, h: 10 }]);
    expect(held.cells.map((c) => c.x)).toEqual([0, 50]);
  });
  it("spans: an item over two columns takes them both (widening them, as it is wider than they are) and the next ones flow under it", () => {
    const g = placeItems(l({ flow: "grid", columns: 2, gap: [2, 2] }), 100, 100, [{ w: 30, h: 10, span: [2, 1] }, { w: 10, h: 10 }, { w: 10, h: 10, fill: "x" }]);
    expect(r(g.cells)).toEqual([[0, 0, 30, 10], [0, 12, 10, 10], [16, 12, 14, 10]]);
  });
  it("columns when none are set: by count, as before; by shape, a board about as wide as tall, or one that fills a sheet whose size is set (ADR 0195)", () => {
    const tall = Array.from({ length: 13 }, () => ({ w: 10, h: 17 })), wide = Array.from({ length: 13 }, () => ({ w: 10, h: 6 }));
    const cols = (p: Partial<SheetLayout>, items: ItemSize[], W = 100, H = 100) => new Set(placeItems(l(p), W, H, items).cells.map((c) => Math.round(c.x * 100))).size;
    expect(cols({ flow: "masonry" }, tall)).toBe(4);
    expect(cols({ flow: "masonry", columnsBy: "shape" }, tall)).toBe(5);
    expect(cols({ flow: "masonry", columnsBy: "shape" }, wide)).toBe(3);
    expect(cols({ flow: "masonry", columnsBy: "shape", hug: [false, false] }, tall, 160, 90)).toBe(6);
    expect(cols({ flow: "masonry", columnsBy: "shape", hug: [false, false] }, tall, 71, 100)).toBe(4);
    expect(cols({ flow: "grid" }, tall)).toBe(4);
    expect(cols({ flow: "grid", columnsBy: "shape" }, tall)).toBe(5);
    expect(cols({ flow: "grid", columnsBy: "shape", columns: 2 }, tall)).toBe(2);
  });
  it("limits: a filling item stops at its most share of the room, the rest stays free", () => {
    const f = placeItems(l({ flow: "row", hug: [false, false] }), 100, 20, [{ w: 10, h: 10, fill: "x", max: [0.5, 0] }, { w: 10, h: 10 }]);
    expect(f.cells.map((c) => [c.x, c.w])).toEqual([[0, 50], [50, 10]]);
    const lo = placeItems(l({ flow: "row", hug: [false, false] }), 100, 20, [{ w: 10, h: 10, fill: "y", min: [0, 0.8] }]);
    expect(lo.cells[0]!.h).toBe(20);
  });
});

describe("laying out a sheet (layOutSheet, withAutoLayout)", () => {
  it("puts the items in a row, front first, with the gap, and the sheet hugs them from its top-left corner", () => {
    const s = sheet(0, 0, 100, 100, 0, { flow: "row", gap: [10, 0] });
    const a = rect(50, 40, 20, 10, 2, { parent: s.id }), b = rect(5, 70, 30, 20, 1, { parent: s.id });
    const out = layOutSheet(s as never, [s, a, b], space);
    near(box(of(out, a)), [0, 0, 20, 10]);
    near(box(of(out, b)), [30, 0, 60, 20]);
    near(box(of(out, s)), [0, 0, 60, 20]);
  });
  it("a thing dropped on the sheet takes the place it is dropped at, and the stacking order follows", () => {
    const s = sheet(0, 0, 60, 20, 0, { flow: "row", gap: [10, 0] });
    const a = rect(0, 0, 20, 10, 2, { parent: s.id }), b = rect(30, 0, 20, 10, 1, { parent: s.id });
    const moved = { ...b, anchor: at(-50, 0) } as CanvasObject; // (dragged left of a)
    const out = withAutoLayout(src(s, a, b), [moved], []);
    near(box(of(out, b)), [0, 0, 20, 10]);
    near(box(of(out, a)), [30, 0, 50, 10]);
    expect(of(out, b).z).toBe(2);
    expect(of(out, a).z).toBe(1);
  });
  it("the whole sheet moved keeps its order; a sheet resized by hand stops hugging on that axis; a hidden or free thing is left alone", () => {
    const s = sheet(0, 0, 50, 10, 0, { flow: "row", gap: [10, 0] });
    const a = rect(0, 0, 20, 10, 2, { parent: s.id }), b = rect(30, 0, 20, 10, 1, { parent: s.id });
    const shift = (o: CanvasObject): CanvasObject => ({ ...o, anchor: at(D.toNumber(o.anchor.x) + 100, D.toNumber(o.anchor.y) + 5) });
    const movedAll = withAutoLayout(src(s, a, b), [shift(s), shift(a), shift(b)], []);
    near(box(of(movedAll, a)), [100, 5, 120, 15]);
    near(box(of(movedAll, b)), [130, 5, 150, 15]);
    const wider = withAutoLayout(src(s, a, b), [{ ...rect(0, 0, 80, 10, 0), id: s.id, container: s.container! }], []);
    expect((of(wider, s) as PathObject).container!.layout!.hug).toEqual([false, true]);
    const hidden = rect(40, 40, 5, 5, 3, { parent: s.id, hidden: true }), free = rect(40, 40, 5, 5, 4, { parent: s.id, inLayout: { free: true } });
    const out = withAutoLayout(src(s, a, b, hidden, free), [{ ...a, fill: "#ff0000" } as CanvasObject], []);
    expect(out.find((o) => o.id === hidden.id)).toBeUndefined();
    expect(out.find((o) => o.id === free.id)).toBeUndefined();
  });
  it("a sheet that hugs inside a sheet that hugs: something added to the inner one grows both, in one go", () => {
    const outer = sheet(0, 0, 40, 10, 0, { flow: "row", gap: [5, 0] });
    const beside = rect(15, 0, 25, 10, 1, { parent: outer.id }), inner = sheet(0, 0, 10, 10, 2, { flow: "row", gap: [0, 0] }, { parent: outer.id });
    const x = rect(0, 0, 10, 10, 3, { parent: inner.id });
    const added = rect(0, 0, 10, 10, 4, { parent: inner.id });
    const out = withAutoLayout(src(outer, inner, x, beside), [added], []);
    near(box(of(out, inner)), [0, 0, 20, 10]);
    near(box(of(out, beside)), [25, 0, 50, 10]);
    near(box(of(out, outer)), [0, 0, 50, 10]);
  });
  it("a thing that fills takes the room, and what is on an inner sheet that fills follows it by its pins", () => {
    const s = sheet(0, 0, 100, 30, 0, { flow: "row", gap: [0, 0], hug: [false, false] });
    const inner = sheet(0, 0, 20, 10, 1, { flow: "row" }, { parent: s.id, inLayout: { fill: "x" } });
    const on = rect(0, 0, 20, 10, 2, { parent: inner.id, constraint: { h: "both", v: "top" } }), other = rect(50, 0, 20, 10, 3, { parent: s.id });
    const out = withAutoLayout(src(s, inner, on, other), [{ ...other, fill: "#ff0000" } as CanvasObject], []);
    near(box(of(out, other)), [0, 0, 20, 10]);
    near(box(of(out, inner)), [20, 0, 100, 10]);
    near(box(of(out, on)), [20, 0, 100, 10]);
  });
});

describe("a sort rule and live reflow (ADR 0193)", () => {
  it("a sort rule orders the items whatever their stacking: largest first", () => {
    const s = sheet(0, 0, 100, 100, 0, { flow: "row", gap: [0, 0], sort: "size" });
    const small = rect(0, 0, 10, 10, 2, { parent: s.id }), big = rect(10, 0, 30, 30, 1, { parent: s.id });
    const out = layOutSheet(s as never, [s, small, big], space);
    near(box(of(out, big)), [0, 0, 30, 30]);
    near(box(of(out, small)), [30, 0, 40, 10]);
  });
  it("a date order: the pictures whose files came into the library last first, those with no date after them", () => {
    const s = sheet(0, 0, 100, 100, 0, { flow: "row", gap: [0, 0], sort: "date" });
    const pic = (x: number, z: number, added?: number): CanvasObject => ({ id: newObjectId(), kind: "image", assetId: "a".repeat(64), anchor: at(x, 0), unit: 0, z, opacity: 1, attachmentTargetId: null, w: 10, h: 10, pixelW: 10, pixelH: 10, parent: s.id, ...(added !== undefined ? { added } : {}) } as CanvasObject);
    const old = pic(0, 3, 1000), none = pic(10, 2), recent = pic(20, 1, 5000);
    const out = layOutSheet(s as never, [s, old, none, recent], space);
    expect([recent, old, none].map((o) => box(of(out, o))[0])).toEqual([0, 10, 20]);
  });
  it("while one is dragged, the others make room as a drop there would, and the dragged one is left to the pointer; dragged off, its place closes", () => {
    const s = sheet(0, 0, 60, 20, 0, { flow: "row", gap: [10, 0] });
    const a = rect(0, 0, 20, 10, 2, { parent: s.id }), b = rect(30, 0, 20, 10, 1, { parent: s.id });
    // (b's middle dragged to x 5, on the sheet, before a's middle at 10)
    const shown = previewLayout(src(s, a, b), new Map([[b.id, { ...b, anchor: at(-5, 0) } as CanvasObject]]));
    expect(shown.find((o) => o.id === b.id)).toBeUndefined();
    near(box(of(shown, a)), [30, 0, 50, 10]);
    const off = previewLayout(src(s, a, b), new Map([[a.id, { ...a, anchor: at(500, 500) } as CanvasObject]]));
    near(box(of(off, b)), [0, 0, 20, 10]);
    near(box(of(off, s)), [0, 0, 20, 10]);
  });
});

describe("kept when stored or copied", () => {
  it("how a thing takes part in a layout (fill, free, span, limits) and a picture's library date survive the round trip", () => {
    const s = sheet(0, 0, 100, 100, 0, { flow: "grid", columnsBy: "shape" });
    const r = rect(0, 0, 10, 10, 1, { parent: s.id, inLayout: { fill: "x", span: [2, 1], min: [0.1, 0], max: [0.5, 0] } });
    expect(deserializeObject(serializeObject(r)).inLayout).toEqual({ fill: "x", span: [2, 1], min: [0.1, 0], max: [0.5, 0] });
    expect((deserializeObject(serializeObject(s)) as PathObject).container!.layout!.columnsBy).toBe("shape");
    const pic = { id: newObjectId(), kind: "image", assetId: "a".repeat(64), anchor: at(0, 0), unit: 0, z: 2, opacity: 1, attachmentTargetId: null, w: 10, h: 10, pixelW: 10, pixelH: 10, added: 1234 } as CanvasObject;
    expect((deserializeObject(serializeObject(pic)) as CanvasObject & { added?: number }).added).toBe(1234);
  });
});

describe("reading a layout from where things are (guessLayout)", () => {
  it("a row with its usual gap and the room to the edge; a grid with its columns", () => {
    const s = rect(0, 0, 100, 40, 0, { container: { clip: true } }) as PathObject & { container: { clip: boolean } };
    const row = [rect(10, 10, 20, 20, 1, { parent: s.id }), rect(35, 10, 20, 20, 2, { parent: s.id }), rect(60, 10, 20, 20, 3, { parent: s.id })];
    const g = guessLayout(s, [s, ...row], space);
    expect([g.flow, g.gap, g.pad, g.hug]).toEqual(["row", [5, 0], [10, 20, 10, 10], [false, false]]);
    const grid = [rect(0, 0, 10, 10, 1, { parent: s.id }), rect(20, 0, 10, 10, 2, { parent: s.id }), rect(0, 20, 10, 10, 3, { parent: s.id }), rect(20, 20, 10, 10, 4, { parent: s.id })];
    const gg = guessLayout(s, [s, ...grid], space, [true, true]);
    expect([gg.flow, gg.columns, gg.gap, gg.hug]).toEqual(["grid", 2, [10, 10], [true, true]]);
  });
});
