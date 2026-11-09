import { describe, expect, it } from "vitest";
import { BODIES, balloonDragged, balloonHandlePoints, balloonOutline, newBalloon, scaledBalloon, validBalloon, type Box } from "../../src/doc/balloon-geometry";

const box: Box = [0, 0, 200, 100];
describe("speech balloon geometry", () => {
  it("every body makes one outline that reaches the tail tip, and the same one again", () => {
    for (const [body] of BODIES) {
      const s = { ...newBalloon(box), body };
      const a = balloonOutline(box, s);
      expect(a.pts.some(([x, y]) => x === s.tails[0]!.tip[0] && y === s.tails[0]!.tip[1]), body).toBe(true);
      expect(balloonOutline(box, s).pts, body).toEqual(a.pts);
    }
  });
  it("a tip inside the body has no tail, only its handle", () => {
    const s = balloonDragged(box, newBalloon(box), "tip", 0, [100, 50]);
    expect(balloonOutline(box, s).marks[0]).toBeNull();
    expect(balloonHandlePoints(box, s).map((h) => h.part)).toEqual(["tip"]);
  });
  it("handles: the width grows with its foot, the base moves round the body, the depth stays in range", () => {
    const s = newBalloon(box);
    const wide = balloonDragged(box, s, "foot", 0, [40, 200]);
    expect(wide.tails[0]!.width).toBeGreaterThan(s.tails[0]!.width);
    expect(balloonDragged(box, s, "base", 0, [200, 100]).tails[0]!.shift).not.toBe(0);
    const c = { ...s, body: "cloud" };
    expect(balloonDragged(box, c, "body", -1, [100, 1e6]).depth).toBeLessThanOrEqual(60);
  });
  it("scaling moves the tip and a flip mirrors the bend; a bad balloon is refused", () => {
    const s = newBalloon(box);
    const f = scaledBalloon({ ...s, tails: [{ ...s.tails[0]!, bend: 30 }] }, -2, 2);
    expect(f.tails[0]!.tip[0]).toBe(s.tails[0]!.tip[0] * -2);
    expect(f.tails[0]!.bend).toBe(-30);
    expect(validBalloon(s)).toBe(true);
    expect(validBalloon({ ...s, body: "nope" })).toBe(false);
    expect(validBalloon({ ...s, tails: [{ ...s.tails[0]!, tip: [NaN, 0] }] })).toBe(false);
  });
});
