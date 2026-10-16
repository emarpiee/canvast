import { describe, expect, it } from "vitest";
import { be, plural, were } from "../../src/doc/plural";

describe("counts read right for one and for many (ADR 0086)", () => {
  it("plural, with an irregular form when needed", () => {
    expect(plural(1, "item")).toBe("1 item");
    expect(plural(0, "item")).toBe("0 items");
    expect(plural(2, "canvas", "canvases")).toBe("2 canvases");
    expect(plural(1, "canvas", "canvases")).toBe("1 canvas");
    expect(plural(3, "new board")).toBe("3 new boards");
  });
  it("is and was agree with the count", () => {
    expect(be(1)).toBe("is");
    expect(be(2)).toBe("are");
    expect(were(1)).toBe("was");
    expect(were(0)).toBe("were");
  });
});
