import { describe, expect, it } from "vitest";
import { HANDLE_CLEAR_PX, clearSpot } from "../../src/interaction/path-edit";

describe("handles are told apart (ADR 0128)", () => {
  it("a handle on another one moves along its own line to the nearest clear place, and stays when it is already clear", () => {
    expect(clearSpot(10, 10, [[1, 0]], [{ x: 300, y: 300 }])).toEqual([10, 10]);
    expect(clearSpot(10, 10, [[1, 0]], [{ x: 10, y: 10 }])).toEqual([10 + HANDLE_CLEAR_PX, 10]);
    // two steps when the first place is taken too, and the other direction when it is the nearer way
    expect(clearSpot(10, 10, [[1, 0]], [{ x: 10, y: 10 }, { x: 10 + HANDLE_CLEAR_PX, y: 10 }])).toEqual([10 + 2 * HANDLE_CLEAR_PX, 10]);
    expect(clearSpot(10, 10, [[1, 0], [-1, 0]], [{ x: 10, y: 10 }, { x: 10 + HANDLE_CLEAR_PX, y: 10 }])).toEqual([10 - HANDLE_CLEAR_PX, 10]);
    // three or more handles in one spot: it goes on as far as six steps
    const wall = [-3, -2, -1, 0, 1, 2, 3].map((n) => ({ x: 10 + n * HANDLE_CLEAR_PX, y: 10 }));
    expect(clearSpot(10, 10, [[1, 0], [-1, 0]], wall)).toEqual([10 + 4 * HANDLE_CLEAR_PX, 10]);
    // nowhere clear: it takes the place farthest from the others, and stays when none is better
    expect(clearSpot(10, 10, [[1, 0]], [-1, 0, 1, 2, 3, 4, 5, 6].map((n) => ({ x: 10 + n * HANDLE_CLEAR_PX, y: 10 })))).toEqual([10, 10]);
    expect(clearSpot(10, 10, [[1, 0]], [{ x: 10, y: 10 }, { x: 10 + 1.5 * HANDLE_CLEAR_PX, y: 10 }, { x: 10 + 2.5 * HANDLE_CLEAR_PX, y: 10 }, { x: 10 + 3.5 * HANDLE_CLEAR_PX, y: 10 }, { x: 10 + 4.5 * HANDLE_CLEAR_PX, y: 10 }, { x: 10 + 5.5 * HANDLE_CLEAR_PX, y: 10 }, { x: 10 + 6.5 * HANDLE_CLEAR_PX, y: 10 }])).toEqual([10 + HANDLE_CLEAR_PX, 10]);
  });
});
