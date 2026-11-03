import { describe, expect, it } from "vitest";
import { EDGE_PAN_MAX_PX_S, EDGE_PAN_ZONE_PX, edgePanStep } from "../../src/interaction/edge-pan";

describe("edge panning", () => {
  const vp = { minX: 0, minY: 0, maxX: 1000, maxY: 800 };
  const at = (x: number, y: number) => ({ minX: x, minY: y, maxX: x, maxY: y });
  it("moves nothing away from the edges, faster the nearer, each axis on its own", () => {
    expect(edgePanStep(at(500, 400), vp, 1, 1)).toEqual({ dx: 0, dy: 0 });
    expect(edgePanStep(at(0, 400), vp, 1, 1)).toEqual({ dx: EDGE_PAN_MAX_PX_S, dy: 0 }); // (the left edge: the content moves right)
    expect(edgePanStep(at(1000, 800), vp, 1, 1)).toEqual({ dx: -EDGE_PAN_MAX_PX_S, dy: -EDGE_PAN_MAX_PX_S });
    expect(edgePanStep(at(EDGE_PAN_ZONE_PX / 2, 400), vp, 1, 1).dx).toBe(EDGE_PAN_MAX_PX_S / 2);
    expect(edgePanStep(at(-300, 400), vp, 1, 1).dx).toBe(EDGE_PAN_MAX_PX_S); // (past the edge: no faster)
  });
  it("goes by the box: its near side, within the area", () => {
    expect(edgePanStep({ minX: 500, minY: 100, maxX: 1000, maxY: 200 }, vp, 1, 1).dx).toBe(-EDGE_PAN_MAX_PX_S);
    expect(edgePanStep(at(900, 400), { ...vp, maxX: 900 }, 1, 1).dx).toBe(-EDGE_PAN_MAX_PX_S); // (a docked panel's edge)
  });
  it("scales with the speed and the time, and 0 is off", () => {
    expect(edgePanStep(at(0, 400), vp, 2, 0.5).dx).toBe(EDGE_PAN_MAX_PX_S);
    expect(edgePanStep(at(0, 400), vp, 0, 1).dx).toBe(0);
  });
});
