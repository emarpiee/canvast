import { describe, expect, it } from "vitest";
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
  it("adds nothing when the shape is as it was, or the change has no path", () => {
    expect(withShapeTexts(src(path(0, 10), text), [path(0, 10)], []).map((o) => o.id)).toEqual(["s"]);
    expect(withShapeTexts(src(path(0, 10), text), [text], []).map((o) => o.id)).toEqual(["t"]);
  });
});
