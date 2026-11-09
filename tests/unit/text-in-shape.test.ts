import { describe, expect, it } from "vitest";
import { scaleAbout } from "../../src/doc/edit-ops";
import { withShapeTexts } from "../../src/doc/text-in-shape";
import type { DerivationSource } from "../../src/doc/boolean-group";
import type { CanvasObject } from "../../src/doc/model";
import * as D from "../../src/core/dyadic";

const at = (x: number) => ({ x: D.fromNumber(x), y: D.fromNumber(0) });
const square = (w: number) => ({ n: [0, 0, 0, 0, 0, 0, w, 0, w, 0, w, 0, w, w, w, w, w, w, 0, w, 0, w, 0, w], closed: true });
const path = (x: number, w: number) => ({ id: "s", kind: "path", anchor: at(x), unit: 0, sub: [square(w)] }) as unknown as CanvasObject;
const text = { id: "t", kind: "text", anchor: at(0), unit: 0, w: 10, inShape: { n: square(10).n, closed: true, shape: "s" } } as unknown as CanvasObject;
const src = (...all: CanvasObject[]): DerivationSource => ({ get: (id) => all.find((o) => o.id === id), all: () => all, space: {} as DerivationSource["space"] });

describe("a text inside a shape", () => {
  it("follows the shape in the same transaction, keeping an alignment of none (left, top)", () => {
    const out = withShapeTexts(src(path(0, 10), text), [path(50, 20)], []);
    const t = out.find((o) => o.id === "t") as Extract<CanvasObject, { kind: "text" }>;
    expect(t.w).toBe(20);
    expect(D.toNumber(t.anchor.x)).toBe(50);
    expect(t.align).toBeUndefined();
    expect(t.valign).toBeUndefined();
  });
  it("is plain words again when its shape is deleted", () => {
    const t = withShapeTexts(src(path(0, 10), text), [], ["s"]).find((o) => o.id === "t") as Extract<CanvasObject, { kind: "text" }>;
    expect(t.inShape).toBeUndefined();
    expect(t.w).toBe(10);
  });
  it("adds nothing when the shape is as it was, or the change has no path", () => {
    expect(withShapeTexts(src(path(0, 10), text), [path(0, 10)], []).map((o) => o.id)).toEqual(["s"]);
    expect(withShapeTexts(src(path(0, 10), text), [text], []).map((o) => o.id)).toEqual(["t"]);
  });
});

describe("a text along a path", () => {
  const line = { id: "s", kind: "path", anchor: at(5), unit: 0, sub: [{ n: [0, 0, 0, 0, 0, 0, 30, 0, 30, 0, 30, 0], closed: false }] } as unknown as CanvasObject;
  const onIt = { id: "t", kind: "text", anchor: at(0), unit: 0, w: 10, size: 2, onPath: { n: [5, 0, 5, 0, 5, 0, 35, 0, 35, 0, 35, 0], closed: false, path: "s" } } as unknown as CanvasObject;
  it("follows its path, and is plain when the path is deleted", () => {
    const moved = { ...line, anchor: at(9) } as CanvasObject;
    const t = withShapeTexts(src(line, onIt), [moved], []).find((o) => o.id === "t") as Extract<CanvasObject, { kind: "text" }>;
    expect(t.onPath!.n[0]).toBe(9);
    const plain = withShapeTexts(src(line, onIt), [], ["s"]).find((o) => o.id === "t") as Extract<CanvasObject, { kind: "text" }>;
    expect(plain.onPath).toBeUndefined();
  });
});

describe("a text's box made wider or narrower", () => {
  const t = { id: "t", kind: "text", anchor: at(10), unit: 0, w: 100, size: 20, autoWidth: true } as unknown as CanvasObject;
  const fixed = { x: D.fromNumber(10), y: D.fromNumber(0) };
  it("keeps its size, leaves auto width, and stays at least a letter wide", () => {
    const wide = scaleAbout(t, fixed, 2, 1) as Extract<CanvasObject, { kind: "text" }>;
    expect([wide.w, wide.size, wide.autoWidth]).toEqual([200, 20, undefined]);
    expect((scaleAbout(t, fixed, 0.001, 1) as Extract<CanvasObject, { kind: "text" }>).w).toBe(20);
  });
});
