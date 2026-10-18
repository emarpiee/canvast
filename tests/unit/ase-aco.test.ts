import { describe, expect, it } from "vitest";
import { labToRgb, parseAse, rgbHex, serializeAse } from "../../src/assets/ase";
import { parseAco, serializeAco } from "../../src/assets/aco";

const cols = [{ c: "#ff0000", name: "Red" }, { c: "#00aa55" }, { c: "#123456", name: "Dark blue" }];

describe("Adobe palettes (v0.18.1)", () => {
  it(".ase: a palette written is read back with its colours and names, and non-RGB colours are converted", () => {
    const back = parseAse(serializeAse("Brand", cols))!;
    expect(back).toHaveLength(1);
    expect(back[0]!.name).toBe("Brand");
    expect(back[0]!.colours.map((c) => c.c)).toEqual(["#ff0000", "#00aa55", "#123456"]);
    expect(back[0]!.colours[0]!.name).toBe("Red");
    expect(parseAse(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12))).toBeNull();
    // Lab: white and black, and a mid grey (D50) stays grey
    expect(rgbHex(...labToRgb(100, 0, 0))).toBe("#ffffff");
    expect(rgbHex(...labToRgb(0, 0, 0))).toBe("#000000");
    const [r, g, b] = labToRgb(53.39, 0, 0);
    expect(Math.abs(r - g) + Math.abs(g - b)).toBeLessThan(0.02);
    expect(r).toBeGreaterThan(0.4);
    expect(r).toBeLessThan(0.55);
  });

  it(".ase with groups and CMYK and gray entries", () => {
    const u16 = (n: number): number[] => [(n >> 8) & 255, n & 255];
    const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
    const f = (x: number): number[] => [...new Uint8Array(new Float32Array([x]).buffer).reverse()];
    const str = (s: string): number[] => [...u16(s.length + 1), ...[...s].flatMap((c) => u16(c.charCodeAt(0))), 0, 0];
    const block = (type: number, body: number[]): number[] => [...u16(type), ...u32(body.length), ...body];
    const entry = (name: string, model: string, vals: number[]): number[] => block(1, [...str(name), ...[...model].map((c) => c.charCodeAt(0)), ...vals.flatMap(f), ...u16(2)]);
    const bytes = Uint8Array.from([0x41, 0x53, 0x45, 0x46, ...u16(1), ...u16(0), ...u32(6), ...block(0xc001, str("Print")), ...entry("Black", "CMYK", [0, 0, 0, 1]), ...entry("Cyan", "CMYK", [1, 0, 0, 0]), ...entry("Mid", "Gray", [0.5]), ...block(0xc002, []), ...entry("Loose", "RGB ", [0, 1, 0])]);
    const p = parseAse(bytes)!;
    expect(p.map((x) => x.name)).toEqual(["Palette", "Print"]);
    expect(p[1]!.colours.map((c) => c.c)).toEqual(["#000000", "#00ffff", "#808080"]);
    expect(p[0]!.colours[0]).toEqual({ c: "#00ff00", name: "Loose" });
  });

  it(".aco: written and read back (names from the version 2 list); other colour spaces are read", () => {
    const back = parseAco(serializeAco(cols), "Mine")!;
    expect(back.name).toBe("Mine");
    expect(back.colours.map((c) => c.c)).toEqual(["#ff0000", "#00aa55", "#123456"]);
    expect(back.colours.map((c) => c.name)).toEqual(["Red", "#00AA55", "Dark blue"]);
    // a version 1 list alone, with an HSB colour (pure red: hue 0, full saturation and brightness) and a gray
    const u16 = (n: number): number[] => [(n >> 8) & 255, n & 255];
    const v1 = Uint8Array.from([...u16(1), ...u16(2), ...u16(1), ...[0, 65535, 65535, 0].flatMap(u16), ...u16(8), ...[10000, 0, 0, 0].flatMap(u16)]);
    expect(parseAco(v1)!.colours.map((c) => c.c)).toEqual(["#ff0000", "#ffffff"]);
    expect(parseAco(Uint8Array.of(9, 9, 9, 9))).toBeNull();
    expect(parseAco(v1.slice(0, 9))).toBeNull();
  });
});
