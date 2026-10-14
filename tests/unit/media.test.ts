import { describe, expect, it } from "vitest";
import { formatTime, stepTime } from "../../src/doc/media";

describe("media steps", () => {
  it("stays inside the media and stops at an end unless repeating", () => {
    expect(stepTime(4, 3, 10, false)).toBe(7);
    expect(stepTime(8, 3, 10, false)).toBe(10);
    expect(stepTime(1, -3, 10, false)).toBe(0);
    expect(stepTime(8, 3, 10, true)).toBe(1);
    expect(stepTime(1, -3, 10, true)).toBe(8);
    expect(stepTime(0, 25, 10, true)).toBe(5);
    expect(stepTime(5, 1, 0, true)).toBe(0); // unknown length
  });

  it("formats positions", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(75.9)).toBe("1:15");
    expect(formatTime(3725)).toBe("1:02:05");
  });
});
