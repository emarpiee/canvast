import { describe, expect, it } from "vitest";
import { facesOf } from "../../src/doc/faces";
import { ellipseSubs, geometryBounds, rectSubs } from "../../src/doc/path";

const reg = (subs: ReturnType<typeof rectSubs>) => ({ subs, evenodd: false });

describe("regions of overlapping shapes", () => {
  it("two overlapping rectangles make three regions: each alone and where they overlap", () => {
    const f = facesOf([reg(rectSubs(0, 0, 100, 100)), reg(rectSubs(50, 50, 100, 100))])!;
    expect(f.map((x) => x.inside.join("+")).sort()).toEqual(["0", "0+1", "1"]);
    const both = f.find((x) => x.inside.length === 2)!;
    const b = geometryBounds(both.subs);
    for (const [got, want] of [[b.minX, 50], [b.minY, 50], [b.maxX, 100], [b.maxY, 100]] as const) expect(got).toBeCloseTo(want, 6);
    const only0 = f.find((x) => x.inside.join() === "0")!;
    expect(geometryBounds(only0.subs)).toMatchObject({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
  });
  it("shapes that do not touch are each their own region; a shape inside another leaves a ring and a core", () => {
    expect(facesOf([reg(rectSubs(0, 0, 10, 10)), reg(rectSubs(100, 0, 10, 10))])!.map((x) => x.inside.join()).sort()).toEqual(["0", "1"]);
    const f = facesOf([reg(rectSubs(0, 0, 100, 100)), reg(rectSubs(25, 25, 50, 50))])!;
    expect(f.map((x) => x.inside.join("+")).sort()).toEqual(["0", "0+1"]);
    expect(f.find((x) => x.inside.join() === "0")!.subs.length, "the outer one has a hole").toBe(2);
  });
  it("three circles make the seven regions of a Venn diagram", () => {
    const f = facesOf([reg(ellipseSubs(0, 0, 100, 100)), reg(ellipseSubs(60, 0, 100, 100)), reg(ellipseSubs(30, 50, 100, 100))]);
    expect(f?.length).toBe(7);
  });
  it("refuses one shape or too many", () => {
    expect(facesOf([reg(rectSubs(0, 0, 1, 1))])).toBeNull();
    expect(facesOf(Array.from({ length: 7 }, (_, i) => reg(rectSubs(i, 0, 5, 5))))).toBeNull();
  });
});
