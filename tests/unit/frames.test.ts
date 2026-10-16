import { describe, expect, it } from "vitest";
import { framePosition } from "../../src/app/frames";

describe("extracted frame position (ADR 0081)", () => {
  it("a video's time and a GIF's frame", () => {
    expect(framePosition("0:03 / 1:20")).toBe("0m03s");
    expect(framePosition("12:45 / 59:00")).toBe("12m45s");
    expect(framePosition("1:02:03 / 2:00:00")).toBe("1h02m03s");
    expect(framePosition("Frame 12 / 40")).toBe("frame12");
    expect(framePosition("???")).toBe("frame");
  });
});
