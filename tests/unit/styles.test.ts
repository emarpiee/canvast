import { describe, expect, it } from "vitest";
import { ADJUSTMENT_KIND, COLOUR_KIND, GRADIENT_KIND, PALETTE_KIND, STYLE_KINDS, StyleLibrary, cleanStyles, kindById } from "../../src/assets/styles";
import type { StyleItem } from "../../src/assets/styles";

const id = (n: number): string => n.toString(16).padStart(32, "0");
const lib = () => {
  const saved: StyleItem[][] = [];
  let n = 0;
  const l = new StyleLibrary(async (items) => void saved.push([...items]), () => id(++n));
  return { l, saved };
};

describe("styles (ADR 0120)", () => {
  it("has one registry: each kind says how to check, say and show its data", () => {
    expect(STYLE_KINDS.map((k) => k.id)).toEqual(["adjustment", "gradient", "colour", "palette"]);
    expect(kindById("adjustment")).toBe(ADJUSTMENT_KIND);
    expect(ADJUSTMENT_KIND.validate({ exposure: 20.4, blur: 0, grain: 500 })).toEqual({ exposure: 20, grain: 100 });
    expect(ADJUSTMENT_KIND.validate({ exposure: 0 })).toBeNull();
    expect(ADJUSTMENT_KIND.summary({ exposure: 20, contrast: -10, tint: 5, blur: 4, grain: 9 })).toBe("Exposure +20, Contrast −10, Tint +5 and 2 more");
    expect(COLOUR_KIND.validate("#2563EB")).toBe("#2563eb");
    expect(COLOUR_KIND.validate("blue")).toBeNull();
    expect(COLOUR_KIND.look!("#2563eb")).toEqual({ swatches: ["#2563eb"] });
  });

  it("saves, names, renames and removes, writing the list every time", async () => {
    const { l, saved } = lib();
    const a = await l.add("adjustment", "", { exposure: 30 });
    expect(a!.name).toBe("Adjustment 1");
    const b = await l.add("adjustment", "  Warm  ", { temperature: 40 });
    expect(b!.name).toBe("Warm");
    expect((await l.add("adjustment", "x", {}))).toBeNull(); // nothing to save
    expect((await l.add("colour", "", "nope"))).toBeNull();
    await l.add("colour", "Sky", "#2563eb");
    expect(l.of("adjustment").map((s) => s.name)).toEqual(["Adjustment 1", "Warm"]);
    await l.rename(a!.id, "Bright");
    await l.remove(b!.id);
    expect(l.items.map((s) => s.name)).toEqual(["Bright", "Sky"]);
    expect(saved.length).toBe(5);
    expect(l.nextName("adjustment")).toBe("Adjustment 2");
  });

  it("a write that fails is not kept on screen either", async () => {
    const l = new StyleLibrary(async () => { throw new Error("read-only"); }, () => id(1));
    await l.add("colour", "a", "#112233");
    expect(l.items).toEqual([]);
  });

  it("reads back only what is sound, keeps a kind it does not know, and never trusts a stored shape", () => {
    const ok = { id: id(1), kind: "adjustment", name: "A", at: 5, data: { exposure: 5 } };
    const future = { id: id(2), kind: "stroke-style", name: "Pal", at: 6, data: { colours: ["#000000"] } };
    const cleaned = cleanStyles([ok, future, { ...ok, id: id(3), data: { exposure: 0 } }, { ...ok, id: "x" }, { ...ok, name: "  " }, { ...ok, id: id(1) }, null, "junk"]);
    expect(cleaned.map((s) => s.id)).toEqual([id(1), id(2)]);
    expect(cleanStyles("not a list")).toEqual([]);
  });

  it("keeps gradients and palettes, checks them, shows them and edits them in place", async () => {
    const g = { type: "linear", x0: 0, y0: 0.5, x1: 1, y1: 0.5, stops: [{ o: 0, c: "#ff0000" }, { o: 1, c: "#0000ff" }] };
    expect(GRADIENT_KIND.validate(g)).toEqual(g);
    expect(GRADIENT_KIND.validate("#ff0000")).toBeNull();
    expect(GRADIENT_KIND.validate({ ...g, stops: [g.stops[0]] })).toBeNull();
    expect(GRADIENT_KIND.summary(g)).toBe("Linear · 2 stops");
    expect(GRADIENT_KIND.look!(g).bar).toBe("linear-gradient(90deg, #ff0000 0%, #0000ff 100%)");
    expect(PALETTE_KIND.validate({ colours: [{ c: "#FF8800", name: " Orange " }, { c: "#102030" }] })).toEqual({ colours: [{ c: "#ff8800", name: "Orange" }, { c: "#102030" }] });
    expect(PALETTE_KIND.validate({ colours: [] })).toBeNull();
    expect(PALETTE_KIND.validate({ colours: [{ c: "red" }] })).toBeNull();
    expect(PALETTE_KIND.summary({ colours: [{ c: "#000000" }] })).toBe("1 colour");
    const { l } = lib();
    const p = (await l.add("palette", "Brand", { colours: [{ c: "#ff8800" }] }))!;
    expect(await l.update(p.id, { colours: [{ c: "#ff8800" }, { c: "#00ff00", name: "Green" }] })).toBe(true);
    expect(await l.update(p.id, { colours: "no" })).toBe(false);
    expect((l.items[0]!.data as { colours: unknown[] }).colours).toHaveLength(2);
    const copy = (await l.duplicate(p.id))!;
    expect(copy.name).toBe("Brand copy");
    expect(l.items.map((s) => s.name)).toEqual(["Brand", "Brand copy"]);
  });
});
