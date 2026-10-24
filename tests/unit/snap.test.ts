import { describe, expect, it } from "vitest";
import { SNAP_PX, bestSnap } from "../../src/interaction/snap";
import { bestEdgeSnap, bestFlushSnap, bestPointSnap, closestOnSeg, snapTargets } from "../../src/interaction/snap-points";

describe("bestSnap", () => {
  it("picks the closest pair of lines within the threshold, and nothing farther", () => {
    const targets = [[100, 150, 200], [400, 450, 500]] as const;
    expect(bestSnap([103, 160, 230], targets)).toMatchObject({ source: 0, target: 0, line: 0, dist: 3 });
    expect(bestSnap([300, 330, 399], targets)).toMatchObject({ source: 2, target: 1, line: 0, dist: 1 });
    expect(bestSnap([300, 330, 360], targets)).toBeNull();
    expect(bestSnap([100 + SNAP_PX + 0.5, 1000, 2000], targets)).toBeNull();
  });
});

describe("snapping to the shapes themselves (ADR 0171)", () => {
  // A hexagon-like outline: corners, two straight sides and a long diagonal that crosses many grid cells.
  const t = snapTargets([100, 100, 200, 100, 250, 187], [[100, 100, 200, 100], [200, 100, 250, 187], [0, 0, 1000, 600]], new Set([0, 1, 2]));

  it("a moving corner goes to the closest corner, within the threshold only, whichever corner of the selection is closest", () => {
    expect(bestPointSnap([500, 500, 203, 98], t)).toMatchObject({ source: 1, target: 1 });
    expect(bestPointSnap([200 + SNAP_PX + 1, 100], t)).toBeNull();
    expect(bestPointSnap([-5, -5, 2000, 2000], t)).toBeNull(); // (outside every indexed cell)
  });

  it("a corner goes onto the closest point of a side, also far along a long side (found through every cell it crosses)", () => {
    const e = bestEdgeSnap([150, 104], t)!;
    expect([e.dx, e.dy]).toEqual([0, -4]);
    const far = bestEdgeSnap([900, 545], t)!; // (on the diagonal y = 0.6x the closest point is near x = 903)
    expect(far.dist).toBeLessThan(SNAP_PX);
    const [x, y] = [900 + far.dx, 545 + far.dy];
    expect(closestOnSeg([0, 0, 1000, 600], x, y).dist).toBeLessThan(1e-9);
    expect(bestEdgeSnap([150, 120], t)).toBeNull();
  });

  it("a nearly parallel straight side lies flush, moving along the normal only; a side at an angle or not facing it does not", () => {
    const f = bestFlushSnap([[120, 103, 180, 103.5]], t)!; // (about 0.5° off)
    expect(f.dx).toBeCloseTo(0, 9);
    expect(f.dy).toBeCloseTo(-3.25, 9);
    expect(bestFlushSnap([[120, 103, 180, 130]], t)).toBeNull(); // (24° off)
    const lone = snapTargets([], [[100, 100, 200, 100]], new Set([0]));
    expect(bestFlushSnap([[300, 103, 360, 103]], lone)).toBeNull(); // (beside it, not facing it)
    expect(bestFlushSnap([[120, 103, 180, 103]], snapTargets([], [[100, 100, 200, 100]]))).toBeNull(); // (a curve's piece cannot lie flush)
  });
});
