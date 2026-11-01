import { describe, expect, it } from "vitest";
import type { Pixels } from "../../src/doc/invisible-mark";
import { findFrame, frameOf, hideFrame, logoBits, markKey, openFrame } from "../../src/doc/invisible-mark";

/** A picture with some texture (a mark hides in detail), the same every run. */
function photo(w: number, h: number, seed = 1): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  const rnd = (): number => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, n = rnd() * 30;
    data[i] = 90 + 60 * Math.sin(x / 23) + n;
    data[i + 1] = 110 + 50 * Math.cos(y / 17) + n;
    data[i + 2] = 130 + 40 * Math.sin((x + y) / 31) + n;
    data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}
const crop = (p: Pixels, x0: number, y0: number, w: number, h: number): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) data.set(p.data.subarray(((y0 + y) * p.width + x0) * 4, ((y0 + y) * p.width + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, data };
};

describe("invisible watermark", () => {
  it("a text is hidden and read back, from a crop off the 8-pixel grid with noise added; the right password opens it, a wrong one does not", async () => {
    const key = await markKey("secret");
    const p = photo(400, 300);
    const psnr = hideFrame(p, await frameOf({ kind: "text", text: "© Ana 2026 ✓" }, key), "normal");
    expect(psnr).toBeGreaterThan(38); // (hard to see)
    const part = crop(p, 13, 5, 300, 220);
    let s = 7;
    for (let i = 0; i < part.data.length; i++) if (i % 4 !== 3) part.data[i] = part.data[i]! + (((s = (s * 69069 + 1) >>> 0) % 7) - 3);
    const found = findFrame(part);
    expect(found?.kind).toBe("text");
    expect(found!.agree).toBeGreaterThan(0.8);
    expect(await openFrame(found!, key)).toEqual({ kind: "text", text: "© Ana 2026 ✓" });
    expect(await openFrame(found!, await markKey(""))).toBeNull();
  });
  it("a logo is hidden in a part of the picture and read back; a picture without a mark gives nothing", async () => {
    const key = await markKey("");
    const logo = photo(64, 64, 5);
    const bits = logoBits(logo);
    const p = photo(420, 420, 9);
    hideFrame(p, await frameOf({ kind: "logo", bits }, key), "strong", { x0: 0, y0: 0, x1: 420, y1: 300 });
    const found = findFrame(p);
    expect(found?.kind).toBe("logo");
    expect(await openFrame(found!, key)).toEqual({ kind: "logo", bits });
    expect(findFrame(photo(420, 420, 3))).toBeNull();
  });
  it("holds a text of up to 64 bytes (a longer one takes a bigger tile), and refuses a longer one", async () => {
    const key = await markKey("");
    const long = "A".repeat(40) + "é".repeat(12); // (64 bytes: é takes two)
    const p = photo(400, 300, 4);
    hideFrame(p, await frameOf({ kind: "text", text: long }, key), "normal");
    expect(await openFrame(findFrame(p)!, key)).toEqual({ kind: "text", text: long });
    await expect(frameOf({ kind: "text", text: "x".repeat(65) }, key)).rejects.toThrow();
  });
});

describe("invisible watermark in a text", () => {
  it("is hidden between the words without changing what is seen, read back after a copy, opened only with its password, and replaced by a new one", async () => {
    const { markText, readText, unmarked } = await import("../../src/doc/text-mark");
    const key = await markKey("pw");
    const text = "The quick brown fox jumps over the lazy dog.";
    const marked = await markText(text, "© Bo", key);
    expect(unmarked(marked)).toBe(text);
    expect(marked.length).toBeGreaterThan(text.length);
    expect(await readText(`copied: ${marked} (end)`, key)).toEqual({ found: "yes", words: "© Bo" });
    expect(await readText(marked, await markKey(""))).toEqual({ found: "locked" });
    expect(await readText(text, key)).toEqual({ found: "no" });
    const again = await markText(marked, "second", key);
    expect(await readText(again, key)).toEqual({ found: "yes", words: "second" });
    expect(await readText(await markText("nospaces", "x", key), key)).toEqual({ found: "yes", words: "x" });
  });
});
