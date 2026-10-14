import { describe, expect, it } from "vitest";
import { SNAP_PX, bestSnap } from "../../src/interaction/snap";

describe("bestSnap", () => {
  it("picks the closest pair of lines within the threshold, and nothing farther", () => {
    const targets = [[100, 150, 200], [400, 450, 500]] as const;
    expect(bestSnap([103, 160, 230], targets)).toMatchObject({ source: 0, target: 0, line: 0, dist: 3 });
    expect(bestSnap([300, 330, 399], targets)).toMatchObject({ source: 2, target: 1, line: 0, dist: 1 });
    expect(bestSnap([300, 330, 360], targets)).toBeNull();
    expect(bestSnap([100 + SNAP_PX + 0.5, 1000, 2000], targets)).toBeNull();
  });
});
