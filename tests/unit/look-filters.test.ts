import { describe, expect, it } from "vitest";
import { dateSpan, parseFilter, parseSeconds, type Extra } from "../../src/assets/filters";
import { colourName, hamming, lookOf, similarGroups } from "../../src/assets/look";

const grid = (f: (x: number, y: number) => [number, number, number, number], n = 32): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.set(f(x, y), (y * n + x) * 4);
  return out;
};

describe("colours of a picture (ADR 0114)", () => {
  it("takes the colour that fills most of it, and names twelve of them", () => {
    const blueish = lookOf(grid((x) => (x < 24 ? [37, 99, 235, 255] : [255, 0, 0, 255])));
    expect(colourName(blueish.colour)).toBe("blue");
    expect(colourName([200, 30, 30])).toBe("red");
    expect(colourName([20, 20, 20])).toBe("black");
    expect(colourName([245, 245, 245])).toBe("white");
    expect(colourName([128, 128, 128])).toBe("grey");
    expect(colourName([140, 90, 40])).toBe("brown");
    expect(colourName([250, 200, 210])).toBe("pink");
    expect(colourName([40, 160, 70])).toBe("green");
  });
  it("counts see-through pixels as nothing: a clear picture is white", () => {
    expect(colourName(lookOf(grid(() => [0, 0, 0, 0])).colour)).toBe("white");
  });
});

describe("near-duplicates (ADR 0114)", () => {
  const ramp = (bright: number, shift = 0): Uint8ClampedArray => grid((x, y) => [Math.min(255, ((x + shift) * 8 + bright) | 0), (y * 8) | 0, 90, 255]);
  it("the same picture lightened, or a little shifted, is a few bits away; a different one is far", () => {
    const a = lookOf(ramp(0));
    expect(hamming(a.dhash, lookOf(ramp(25)).dhash)).toBeLessThanOrEqual(6);
    const other = lookOf(grid((x, y) => (((x >> 2) + (y >> 2)) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255])));
    expect(hamming(a.dhash, other.dhash)).toBeGreaterThan(12);
    expect(hamming(a.dhash, a.dhash)).toBe(0);
  });
});

describe("search words that filter (ADR 0114)", () => {
  const img = { pixelW: 1920, pixelH: 1080, size: 3 * 1024 ** 2 };
  const t = (w: string, s = img) => parseFilter(w)!.test(s, undefined);
  it("compare sizes, pixels, file size, ratio and orientation", () => {
    expect(t("width>1000")).toBe(true);
    expect(t("w<1000")).toBe(false);
    expect(t("height>=1080")).toBe(true);
    expect(t("pixels>2mp")).toBe(true);
    expect(t("pixels>3mp")).toBe(false);
    expect(t("size<5mb")).toBe(true);
    expect(t("size>500kb")).toBe(true);
    expect(t("ratio:16x9")).toBe(true);
    expect(t("ratio:4x3")).toBe(false);
    expect(t("orientation:landscape")).toBe(true);
    expect(t("orientation:portrait", { pixelW: 100, pixelH: 300, size: 1 })).toBe(true);
    expect(t("orientation:square", { pixelW: 500, pixelH: 502, size: 1 })).toBe(true);
  });
  it("leave ordinary words and the dot and hash forms alone; a colour word waits for the picture's look", () => {
    expect(parseFilter("cat")).toBeNull();
    expect(parseFilter("width>big")).toBeNull();
    expect(parseFilter("#tag")).toBeNull();
    const c = parseFilter("colour:blue")!;
    expect(c.needsLook).toBe(true);
    expect(c.test(img, undefined)).toBe("unknown");
    expect(c.test(img, { colour: [37, 99, 235], dhash: "0".repeat(16) })).toBe(true);
    expect(c.test(img, { colour: [255, 0, 0], dhash: "0".repeat(16) })).toBe(false);
    expect(parseFilter("colour:#2563eb")!.test(img, { colour: [40, 100, 230], dhash: "0".repeat(16) })).toBe(true);
  });
});

describe("groups of look-alikes (ADR 0114)", () => {
  it("joins pictures a few bits apart, also through a chain, and leaves the rest out", () => {
    const flip = (hex: string, bits: number[]): string => {
      const b = [...hex].map((c) => parseInt(c, 16).toString(2).padStart(4, "0")).join("").split("");
      for (const k of bits) b[k] = b[k] === "0" ? "1" : "0";
      return b.join("").match(/.{4}/g)!.map((x) => parseInt(x, 2).toString(16)).join("");
    };
    const base = "a3c5e1f0123456ff";
    const groups = similarGroups([
      { id: "a", dhash: base },
      { id: "b", dhash: flip(base, [1, 20, 40]) },
      { id: "c", dhash: flip(base, [1, 20, 40, 5, 33, 60]) }, // 3 bits from b, 6 from a: joined through b
      { id: "far", dhash: "5c3a1e0fedcba900" },
      { id: "x", dhash: "0123456789abcdef" },
      { id: "y", dhash: flip("0123456789abcdef", [63]) },
    ]);
    expect(groups.map((g) => [...g].sort())).toEqual([["a", "b", "c"], ["x", "y"]]);
  });
});

describe("library keywords", () => {
  const now = new Date(2026, 9, 29, 15, 0).getTime();
  const item = { pixelW: 10, pixelH: 10, size: 1, name: "clip.mp4", type: "video/mp4", importedAt: new Date(2026, 9, 28, 9).getTime(), instances: 3, canvases: 2, present: true };
  const extra: Extra = { hidden: false, favorite: true, tags: 0, folders: ["refs", "faces"], note: "from the museum", fields: [{ key: "source", value: "web" }], on: () => ["moodboard", "work"], duration: () => 95 };
  const t = (w: string, s: object = item, x: Extra | undefined = extra) => parseFilter(w, now)!.test({ ...item, ...s }, undefined, x);
  it("is:, kind:, uses> and canvases>", () => {
    expect(t("is:favourite")).toBe(true);
    expect(t("is:used")).toBe(true);
    expect(t("is:unused")).toBe(false);
    expect(t("is:untagged")).toBe(true);
    expect(t("is:filed")).toBe(true);
    expect(t("is:missing", { present: false })).toBe(true);
    expect(parseFilter("is:nonsense")).toBeNull();
    expect(t("kind:video")).toBe(true);
    expect(t("kind:font", { name: "a.ttf", type: "font/ttf", card: true })).toBe(true);
    expect(t("kind:file", { name: "a.zip", type: "application/zip", card: true })).toBe(true);
    expect(t("uses>2")).toBe(true);
    expect(t("uses:0")).toBe(false);
    expect(t("canvases<2")).toBe(false);
  });
  it("date: names a day, month, year or a recent span; > and < are after and before it", () => {
    expect(t("date:2026-10")).toBe(true);
    expect(t("date:2026-10-28")).toBe(true);
    expect(t("date:yesterday")).toBe(true);
    expect(t("date:today")).toBe(false);
    expect(t("date:week")).toBe(true);
    expect(t("date>2026-10-27")).toBe(true);
    expect(t("date>2026-10-28")).toBe(false);
    expect(t("date>=2026-10-28")).toBe(true);
    expect(t("date<2026")).toBe(false);
    expect(dateSpan("2026-13", now)).toBeNull();
  });
  it("on:, folder:, note: and field: read the item's places and words", () => {
    expect(t("on:mood")).toBe(true);
    expect(t("on:sketch")).toBe(false);
    expect(t("folder:face")).toBe(true);
    expect(t("note:museum")).toBe(true);
    expect(t("field:source")).toBe(true);
    expect(t("field:source=web")).toBe(true);
    expect(t("field:source=book")).toBe(false);
  });
  it("duration> compares seconds and waits while the length is unknown", () => {
    expect(parseSeconds("1:30")).toBe(90);
    expect(parseSeconds("2m")).toBe(120);
    expect(parseSeconds("500ms")).toBe(0.5);
    expect(t("duration>1m")).toBe(true);
    expect(t("duration<1:30")).toBe(false);
    expect(t("duration>1m", {}, { ...extra, duration: () => undefined })).toBe("unknown");
    expect(t("duration>1m", {}, { ...extra, duration: () => null })).toBe(false);
    expect(parseFilter("duration>1m")!.needsDuration).toBe(true);
  });
});
