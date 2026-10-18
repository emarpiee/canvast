import { describe, expect, it } from "vitest";
import { HANDLE_CLEAR_PX, clearSpot } from "../../src/interaction/path-edit";

describe("handles are told apart (ADR 0128)", () => {
  it("a handle on another one moves along its own line to the nearest clear place, and stays when it is already clear", () => {
    expect(clearSpot(10, 10, [[1, 0]], [{ x: 300, y: 300 }])).toEqual([10, 10]);
    expect(clearSpot(10, 10, [[1, 0]], [{ x: 10, y: 10 }])).toEqual([10 + HANDLE_CLEAR_PX, 10]);
    // two steps when the first place is taken too, and the other direction when it is the nearer way
    expect(clearSpot(10, 10, [[1, 0]], [{ x: 10, y: 10 }, { x: 10 + HANDLE_CLEAR_PX, y: 10 }])).toEqual([10 + 2 * HANDLE_CLEAR_PX, 10]);
    expect(clearSpot(10, 10, [[1, 0], [-1, 0]], [{ x: 10, y: 10 }, { x: 10 + HANDLE_CLEAR_PX, y: 10 }])).toEqual([10 - HANDLE_CLEAR_PX, 10]);
    // nowhere clear: it stays
    const wall = [-3, -2, -1, 0, 1, 2, 3].map((n) => ({ x: 10 + n * HANDLE_CLEAR_PX, y: 10 }));
    expect(clearSpot(10, 10, [[1, 0], [-1, 0]], wall)).toEqual([10, 10]);
  });
});
