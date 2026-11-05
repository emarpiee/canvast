import { describe, expect, it } from "vitest";
import { spreadFor } from "../../src/app/actions";
import * as D from "../../src/core/dyadic";

const item = (x: number, y: number, was: number, now: number) => ({ mx: D.fromNumber(x), my: D.fromNumber(y), was: { w: was, h: was }, now: { w: now, h: now } });

describe("spreadFor", () => {
  it("does not move what has room to grow", () => {
    expect(spreadFor([item(0, 0, 10, 20), item(100, 0, 10, 20)])).toBeCloseTo(1.1, 5); // (gap 90, sizes 20: 110 between the middles)
    expect(spreadFor([item(0, 0, 100, 100), item(200, 0, 10, 10)])).toBe(1);
  });
  it("is set by the pair that needs it, not by the item that grows most", () => {
    // A tiny one grows sixfold far from the others: only what it takes to keep its gap, not 6.
    expect(spreadFor([item(0, 0, 10, 60), item(1000, 0, 60, 60)])).toBeLessThan(1.1);
  });
  it("keeps the gap on the easier side, and leaves an overlap alone", () => {
    expect(spreadFor([item(0, 0, 10, 40), item(100, 100, 10, 40)])).toBeCloseTo(1.3, 5);
    expect(spreadFor([item(0, 0, 100, 400), item(10, 10, 100, 400)])).toBe(1);
  });
  it("never draws closer", () => {
    expect(spreadFor([item(0, 0, 100, 10), item(200, 0, 100, 10)])).toBe(1);
  });
});
