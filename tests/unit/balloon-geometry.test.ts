import { describe, expect, it } from "vitest";
import { BODIES, balloonDragged, balloonHandlePoints, balloonLook, balloonOutline, balloonSubs, newBalloon, validLook, withBalloonLook, scaledBalloon, validBalloon, type Box } from "../../src/doc/balloon-geometry";

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
    expect(balloonHandlePoints(box, s).map((h) => h.part)).toEqual(["move", "size", "tip"]);
  });
  it("handles: the width grows with its foot, the base moves round the body, the depth stays in range", () => {
    const s = newBalloon(box);
    const wide = balloonDragged(box, s, "foot", 0, [40, 200]);
    expect(wide.tails[0]!.width).toBeGreaterThan(s.tails[0]!.width);
    expect(balloonDragged(box, s, "base", 0, [200, 100]).tails[0]!.angle).not.toBe(s.tails[0]!.angle);
    const c = { ...s, body: "cloud" };
    expect(balloonDragged(box, c, "body", -1, [100, 1e6]).depth).toBeLessThanOrEqual(60);
  });
  it("a locked base stays when the tip moves, a following one goes with it; the bend leaves the middle width as it is", () => {
    const s = newBalloon(box);
    const baseOf = (q: typeof s): readonly number[] => balloonOutline(box, q).marks[0]!.base;
    const far: [number, number] = [320, 60];
    expect(baseOf(balloonDragged(box, s, "tip", 0, far))).toEqual(baseOf(s));
    const free = { ...s, tails: [{ ...s.tails[0]!, follow: true as const }] };
    expect(baseOf(balloonDragged(box, free, "tip", 0, far))).not.toEqual(baseOf(free));
    const gap = (bend: number): number => {
      const m = balloonOutline(box, { ...s, tails: [{ ...s.tails[0]!, kind: "curved", bend }] }).marks[0]!;
      return Math.hypot(m.bellyAt[0] - m.bendAt[0], m.bellyAt[1] - m.bendAt[1]);
    };
    expect(gap(60)).toBeCloseTo(gap(0), 9);
  });
  it("a round tip leaves the point, a double line adds one outline, a look carries over", () => {
    const s = newBalloon(box);
    const tip = s.tails[0]!.tip;
    const rounded = { ...s, tails: [{ ...s.tails[0]!, tipRound: 50 }] };
    expect(balloonOutline(box, rounded).pts.some(([x, y]) => x === tip[0] && y === tip[1])).toBe(false);
    expect(balloonSubs(box, { ...s, double: 10 }).length).toBe(2);
    const look = balloonLook({ ...s, body: "cloud" });
    expect(validLook(look)).toEqual(look);
    expect(withBalloonLook(s, look).body).toBe("cloud");
    expect(validLook({ body: "nope" })).toBeNull();
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
