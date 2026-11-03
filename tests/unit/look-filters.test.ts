import { describe, expect, it } from "vitest";
import { dateSpan, parseFilter, parseSeconds, type Extra } from "../../src/assets/filters";
import { colourName, hamming, lookOf, similarGroups } from "../../src/assets/look";
import { propValues, sortListed, type ListedEntry } from "../../src/assets/library-match";

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
    expect(t("is:thumbed")).toBe(false);
    expect(t("is:thumbed", item, { ...extra, thumbed: true })).toBe(true);
    expect(t("is:unthumbed")).toBe(true);
    expect(t("is:filed")).toBe(true);
    expect(t("is:missing", { present: false })).toBe(true);
    expect(parseFilter("is:nonsense")).toBeNull();
    expect(t("kind:video")).toBe(true);
    expect(t("kind:font", { name: "a.ttf", type: "font/ttf", card: true })).toBe(true);
    expect(t("kind:file", { name: "a.zip", type: "application/zip", card: true })).toBe(true);
    expect(t("kind:note", { name: "Plan.md", type: "text/markdown", card: true })).toBe(true);
    expect(t("kind:note", { name: "Plan.note.html", type: "text/html", card: true })).toBe(true);
    expect(t("kind:note", { name: "a.pdf", type: "application/pdf", card: true })).toBe(false);
    expect(t("kind:document", { name: "a.pdf", type: "application/pdf", card: true })).toBe(true);
    expect(t("kind:3d", { name: "head.glb", type: "model/gltf-binary", card: true })).toBe(true);
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
  it("property: and description: read as field: and note: do, and compare dates, numbers and each item of a list", () => {
    const of = (word: string, value: string, key = "x"): unknown => parseFilter(word)!.test({ pixelW: 1, pixelH: 1, size: 1 }, null, { hidden: false, favorite: false, tags: 0, folders: [], note: "about it", fields: [{ key, value }], on: () => [], duration: () => null });
    expect(of("description:about", "")).toBe(true);
    expect(of("property:x=web", "web")).toBe(true);
    // Dates: after a month is after its last day; a time in it is in it.
    expect(of("property:x>2025-01", "2025-02-01t10:00")).toBe(true);
    expect(of("field:x>2025-01", "2025-01-31")).toBe(false);
    expect(of("property:x>=2025-01", "2025-01-31")).toBe(true);
    expect(of("property:x<2025", "2024-09-03t01:47")).toBe(true);
    expect(of("property:x<2025", "2025-01-01")).toBe(false);
    // Numbers, and what is neither is no match for them.
    expect(of("property:x>=4", "4")).toBe(true);
    expect(of("property:x>10", "9")).toBe(false);
    expect(of("property:x>4", "words")).toBe(false);
    expect(of("property:x>2025", "2024")).toBe(false);
    expect(of("property:x>2025", "2026")).toBe(true);
    // Words by the alphabet; any item of a list.
    expect(of("property:x>m", "zebra")).toBe(true);
    expect(of("property:x>=4", "1, 5")).toBe(true);
    expect(of("property:x>=4", "1, 2")).toBe(false);
  });
  it("sorts by a property as what it says; what lacks it comes last, either way", () => {
    const row = (hash: string, value?: string): ListedEntry => ({ hash, name: hash, type: "", size: 0, pixelW: 1, pixelH: 1, importedAt: 0, state: "active", present: true, instances: 0, canvases: 0, canvasIds: [], ...(value === undefined ? {} : { fields: [{ key: "Rank", value }] }) }) as unknown as ListedEntry;
    const order = (reversed: boolean): string[] => sortListed([row("a", "10"), row("b", "9"), row("none"), row("c", "2024-01-01")], "prop:rank", reversed, [], new Intl.Collator()).map((e) => e.hash);
    expect(order(false)).toEqual(["b", "a", "c", "none"]);
    expect(order(true)).toEqual(["c", "a", "b", "none"]);
    expect(propValues([row("a", "x, y"), row("b", "y"), row("c", "many\nlines")], "rank")).toEqual(["y", "x"]);
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
