import { describe, expect, it } from "vitest";
import { cleanNamePattern, nameFrom, sizeByRule, uniqueNames, variantName } from "../../src/app/export-names";

const parts = { name: "pumpkin", n: 3, count: 12, w: 1080, h: 720, canvas: "Halloween set", format: "png", date: "2026-11-11" };

describe("export names", () => {
  it("fills every token, numbers padded to the count, and cleans what a file cannot hold", () => {
    expect(nameFrom("{n}-{name}-{w}x{h}", parts)).toBe("03-pumpkin-1080x720");
    expect(nameFrom("{canvas} {date} {format}", parts)).toBe("Halloween set 2026-11-11 png");
    expect(nameFrom("{name}: final?", parts)).not.toMatch(/[:?]/);
    expect(nameFrom("", parts)).toBe("pumpkin");
    expect(nameFrom("{unknown}", parts)).toBe("{unknown}");
  });
  it("makes names unique, case aside, keeping the extension", () => {
    expect(uniqueNames(["skull.png", "Skull.png", "skull.png", "candy.png"])).toEqual(["skull.png", "Skull-2.png", "skull-3.png", "candy.png"]);
  });
  it("sizes by width, height, longest side or scale of the canvas size", () => {
    expect(sizeByRule("width", 100, 2)).toEqual({ w: 100, h: 50 });
    expect(sizeByRule("height", 100, 2)).toEqual({ w: 200, h: 100 });
    expect(sizeByRule("long", 100, 0.5)).toEqual({ w: 50, h: 100 });
    expect(sizeByRule("scale", 2, 1, { w: 40, h: 30 })).toEqual({ w: 80, h: 60 });
  });
  it("names variants and checks stored patterns", () => {
    expect(variantName("icon", "2x", "png")).toBe("icon@2x.png");
    expect(variantName("icon", "svg", "png")).toBe("icon.svg");
    expect(cleanNamePattern({ pattern: "  {n}-{name} " })).toEqual({ pattern: "{n}-{name}" });
    expect(cleanNamePattern({ pattern: "" })).toBeNull();
  });
});
