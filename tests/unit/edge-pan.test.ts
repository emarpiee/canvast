import { describe, expect, it } from "vitest";
import { EDGE_PAN_MAX_PX_S, EDGE_PAN_ZONE_PX, edgePanStep } from "../../src/interaction/edge-pan";

describe("edge panning", () => {
  const vp = { width: 1000, height: 800 };
  it("moves nothing away from the edges, faster the nearer, each axis on its own", () => {
    expect(edgePanStep({ x: 500, y: 400 }, vp, 1, 1)).toEqual({ dx: 0, dy: 0 });
    expect(edgePanStep({ x: 0, y: 400 }, vp, 1, 1)).toEqual({ dx: EDGE_PAN_MAX_PX_S, dy: 0 }); // (the left edge: the content moves right)
    expect(edgePanStep({ x: 1000, y: 800 }, vp, 1, 1)).toEqual({ dx: -EDGE_PAN_MAX_PX_S, dy: -EDGE_PAN_MAX_PX_S });
    expect(edgePanStep({ x: EDGE_PAN_ZONE_PX / 2, y: 400 }, vp, 1, 1).dx).toBe(EDGE_PAN_MAX_PX_S / 2);
    expect(edgePanStep({ x: -300, y: 400 }, vp, 1, 1).dx).toBe(EDGE_PAN_MAX_PX_S); // (past the edge: no faster)
  });
  it("scales with the speed and the time, and 0 is off", () => {
    expect(edgePanStep({ x: 0, y: 400 }, vp, 2, 0.5).dx).toBe(EDGE_PAN_MAX_PX_S);
    expect(edgePanStep({ x: 0, y: 400 }, vp, 0, 1).dx).toBe(0);
  });
});
