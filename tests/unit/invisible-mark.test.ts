import { describe, expect, it } from "vitest";
import type { Pixels } from "../../src/doc/invisible-mark";
import { findFrame, frameOf, hideFrame, logoBits, markKey, minPart, openFrame } from "../../src/doc/invisible-mark";

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
  it("a text hidden in only a part of the picture (two tiles each way) is read back, the rest of the picture not drowning it", async () => {
    const key = await markKey("");
    const content = { kind: "text" as const, text: "© Ana Santos, all rights reserved 2026" };
    const side = minPart(content);
    const p = photo(1000, 700, 6);
    hideFrame(p, await frameOf(content, key), "normal", { x0: 300, y0: 150, x1: 300 + side, y1: 150 + side });
    expect(await openFrame(findFrame(p)!, key)).toEqual(content);
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

describe("invisible watermark, other methods", () => {
  /** `p` turned by `deg` about its centre and scaled by `k` (bilinear), as a copy that went through an editor would be. */
  function warp(p: Pixels, deg: number, k: number): Pixels {
    const w = Math.round(p.width * k), h = Math.round(p.height * k), data = new Uint8ClampedArray(w * h * 4);
    const a = (deg * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ux = (x - w / 2) / k, uy = (y - h / 2) / k;
      const sx = c * ux + sn * uy + p.width / 2, sy = -sn * ux + c * uy + p.height / 2;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const g = (xx: number, yy: number, ch: number): number => (xx < 0 || yy < 0 || xx >= p.width || yy >= p.height ? 128 : p.data[(yy * p.width + xx) * 4 + ch]!);
      for (let ch = 0; ch < 3; ch++) data[(y * w + x) * 4 + ch] = g(x0, y0, ch) * (1 - fx) * (1 - fy) + g(x0 + 1, y0, ch) * fx * (1 - fy) + g(x0, y0 + 1, ch) * (1 - fx) * fy + g(x0 + 1, y0 + 1, ch) * fx * fy;
      data[(y * w + x) * 4 + 3] = 255;
    }
    return { width: w, height: h, data };
  }
  /** A copy read the way the app reads one with a template: turned and resized back by what the template says, then its blocks. */
  const readTurned = async (p: Pixels, key: CryptoKey): Promise<string | null> => {
    const { findPilot, undoPilot } = await import("../../src/doc/fourier-mark");
    const pilot = findPilot(p);
    if (!pilot) return null;
    for (const turn of [pilot.turn, pilot.turn + Math.PI]) {
      const f = findFrame(undoPilot(p, turn, pilot.scale));
      const c = f && (await openFrame(f, key));
      if (c?.kind === "text") return c.text;
    }
    return null;
  };
  /** A picture like a photo: smooth shapes and fine grain, from a good random source (a weak one has patterns of its own in the spectrum). */
  function scene(w: number, h: number, seed: number): Pixels {
    let s = seed >>> 0;
    const rnd = (): number => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const G = 16, gw = Math.ceil(w / G) + 2, gh = Math.ceil(h / G) + 2;
    const grid = Array.from({ length: gw * gh * 3 }, () => rnd() * 200 + 25);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = x / G, gy = y / G, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
      for (let c = 0; c < 3; c++) {
        const g = (i: number, j: number): number => grid[(j * gw + i) * 3 + c]!;
        data[(y * w + x) * 4 + c] = g(x0, y0) * (1 - fx) * (1 - fy) + g(x0 + 1, y0) * fx * (1 - fy) + g(x0, y0 + 1) * (1 - fx) * fy + g(x0 + 1, y0 + 1) * fx * fy + (rnd() - 0.5) * 12;
      }
      data[(y * w + x) * 4 + 3] = 255;
    }
    return { width: w, height: h, data };
  }
  it("Fourier template: a copy turned by any angle and resized is turned and resized back by it and read; a picture without one has none", async () => {
    const { findPilot, hidePilot } = await import("../../src/doc/fourier-mark");
    const key = await markKey("pw");
    const p = scene(1000, 700, 2);
    hideFrame(p, await frameOf({ kind: "text", text: "© Ana 2026" }, key), "normal");
    hidePilot(p);
    expect(await readTurned(warp(p, 23, 0.75), key)).toBe("© Ana 2026");
    expect(await readTurned(warp(p, -8, 1.4), key)).toBe("© Ana 2026");
    expect(findPilot(scene(1000, 700, 8))).toBeNull();
  });
  it("LSB: a text in the lowest bits in the plain layout other tools read, a locked one opened only with its password; refused when it does not fit or the picture is see-through", async () => {
    const { hideLsb, lsbBytes, readLsb } = await import("../../src/doc/lsb-mark");
    const key = await markKey("pw");
    const p = photo(200, 100, 3);
    expect(hideLsb(p, await lsbBytes("Hi, this is Ana ✓", null))).toBe(true);
    const first = Array.from({ length: 8 }, (_, k) => p.data[Math.floor(k / 3) * 4 + (k % 3)]! & 1).join("");
    expect(first).toBe("01001000"); // "H", highest bit first, in red, green, blue of the first pixels
    expect(await readLsb(p, key)).toBe("Hi, this is Ana ✓");
    const q = photo(200, 100, 4);
    hideLsb(q, await lsbBytes("secret words", key));
    expect([await readLsb(q, key), await readLsb(q, await markKey(""))]).toEqual(["secret words", "locked"]);
    expect(await readLsb(photo(200, 100, 5), key)).toBeNull();
    expect(hideLsb(photo(10, 10), await lsbBytes("x".repeat(40), null))).toBe(false);
    const glass = photo(50, 50);
    glass.data[3] = 128;
    expect(hideLsb(glass, await lsbBytes("hello", null))).toBe(false);
  });
});
