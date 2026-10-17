import { describe, expect, it } from "vitest";
import { parseGgr, serializeGgr } from "../../src/assets/ggr";
import { parseGpl, serializeGpl } from "../../src/assets/gpl";
import { extractPalette } from "../../src/assets/extract-palette";
import { isPaint } from "../../src/doc/paint";
import type { Gradient } from "../../src/doc/paint";

const GGR = `GIMP Gradient
Name: Sunset
2
0.000000 0.250000 0.500000 1.000000 0.000000 0.000000 1.000000 0.000000 1.000000 0.000000 1.000000 0 0 0 0
0.500000 0.750000 1.000000 0.000000 1.000000 0.000000 1.000000 0.000000 0.000000 1.000000 0.500000 1 0 0 0
`;

describe("GIMP gradients, .ggr (ADR 0122)", () => {
  it("reads segments into stops: plain blends exactly, curved ones as extra stops", () => {
    const r = parseGgr(GGR)!;
    expect(r.name).toBe("Sunset");
    expect(isPaint(r.gradient)).toBe(true);
    const s = r.gradient.stops;
    expect(s[0]).toEqual({ o: 0, c: "#ff0000" });
    expect(s.some((x) => x.o === 0.5 && x.c === "#00ff00")).toBe(true);
    expect(s.at(-1)).toEqual({ o: 1, c: "#0000ff80" });
    expect(s.length).toBeGreaterThan(3); // the second segment is curved and the first has its middle off centre
    expect(r.notes.join()).toMatch(/curved/);
  });

  it("refuses what is not a gradient file", () => {
    expect(parseGgr("hello")).toBeNull();
    expect(parseGgr("GIMP Gradient\nName: x\nzero\n")).toBeNull();
    expect(parseGgr("GIMP Gradient\nName: x\n1\n0 1 2\n")).toBeNull();
  });

  it("writes a file it reads back to the same stops", () => {
    const g: Gradient = { type: "linear", x0: 0, y0: 0, x1: 1, y1: 0, stops: [{ o: 0.2, c: "#102030" }, { o: 0.6, c: "#a0b0c0" }, { o: 1, c: "#ff000080" }] };
    const back = parseGgr(serializeGgr("Round trip", g))!;
    expect(back.name).toBe("Round trip");
    expect(back.gradient.stops).toEqual([{ o: 0, c: "#102030" }, { o: 0.2, c: "#102030" }, { o: 0.6, c: "#a0b0c0" }, { o: 1, c: "#ff000080" }]);
  });

  it("keeps a hard edge and samples a gradient of too many segments", () => {
    const hard = parseGgr("GIMP Gradient\nName: h\n2\n0 0.25 0.5 1 0 0 1 1 0 0 1 0 0 0 0\n0.5 0.75 1 0 0 1 1 0 0 1 1 0 0 0 0\n")!;
    expect(hard.gradient.stops.filter((s) => s.o === 0.5).map((s) => s.c)).toEqual(["#ff0000", "#0000ff"]);
    const n = 80;
    const rows = Array.from({ length: n }, (_, i) => `${i / n} ${(i + 0.5) / n} ${(i + 1) / n} ${i / n} 0 0 1 ${(i + 1) / n} 0 0 1 0 0 0 0`);
    const many = parseGgr(`GIMP Gradient\nName: m\n${n}\n${rows.join("\n")}\n`)!;
    expect(many.gradient.stops.length).toBeLessThanOrEqual(32);
    expect(many.notes.join()).toMatch(/sampled/);
  });

  it("hue blends go round the right way", () => {
    const up = parseGgr("GIMP Gradient\nName: u\n1\n0 0.5 1 1 0 0 1 0 0 1 1 0 1 0 0\n")!; // red to blue, HSV counter-clockwise: through yellow, green, cyan
    expect(up.gradient.stops.some((s) => s.c.slice(1, 3) !== "ff" && s.c.slice(3, 5) === "ff")).toBe(true);
  });
});

describe("GIMP palettes, .gpl and picture palettes (ADR 0122)", () => {
  it("reads and writes colours with names", () => {
    const text = serializeGpl("Brand", [{ c: "#ff8800", name: "Orange" }, { c: "#102030" }]);
    expect(text).toContain("GIMP Palette");
    const back = parseGpl(text)!;
    expect(back.name).toBe("Brand");
    expect(back.colours).toEqual([{ c: "#ff8800", name: "Orange" }, { c: "#102030", name: "#102030" }]);
    expect(parseGpl("nope")).toBeNull();
    expect(parseGpl("GIMP Palette\nName: e\n#\n")).toBeNull();
  });

  it("finds the main colours of pixels, most common first", () => {
    const px = new Uint8ClampedArray(4 * 100);
    for (let i = 0; i < 100; i++) px.set(i < 70 ? [255, 0, 0, 255] : i < 90 ? [0, 0, 255, 255] : [0, 255, 0, 0], i * 4);
    expect(extractPalette(px, 3)).toEqual(["#ff0000", "#0000ff"]); // (the transparent ones are left out)
    expect(extractPalette(new Uint8ClampedArray(0), 4)).toEqual([]);
  });
});
