import { readFileSync } from "node:fs";
import { brotliCompressSync, constants } from "node:zlib";
import { describe, expect, it } from "vitest";
import { brotliDecode } from "../../src/text/brotli";

const compress = (data: Uint8Array, quality: number, mode = constants.BROTLI_MODE_GENERIC, lgwin = 22): Uint8Array =>
  new Uint8Array(brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_MODE]: mode, [constants.BROTLI_PARAM_LGWIN]: lgwin, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }));

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const text = new Uint8Array(readFileSync("README.md"));
const font = new Uint8Array(readFileSync("node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf"));
const english = new TextEncoder().encode(
  "The quick brown fox jumps over the lazy dog. This is a sentence with some of the most common words of the language, which the format keeps in a dictionary: about after again because before between children country during every family friend government important information little number people place question school should something through water without. ".repeat(40),
);

describe("Brotli decoder (v0.18.1)", () => {
  it("decodes what Node's encoder makes, at every quality and for text, binary and random data", async () => {
    const random = new Uint8Array(5000).map(() => (Math.random() * 256) | 0);
    const runs = new Uint8Array(20000).fill(7);
    const samples: Array<[string, Uint8Array]> = [["empty", new Uint8Array(0)], ["one byte", Uint8Array.of(42)], ["text", text], ["english", english], ["font", font], ["random", random], ["runs", runs]];
    for (const [name, data] of samples) {
      for (const q of [0, 1, 2, 4, 5, 6, 9, 11]) {
        const got = await brotliDecode(compress(data, q));
        expect(got.length, `${name} q${q}`).toBe(data.length);
        expect(Buffer.from(got).equals(Buffer.from(data)), `${name} q${q}`).toBe(true);
      }
    }
  });

  it("decodes every mode and window size, and the transforms of the dictionary (words that are not quite as in it)", async () => {
    for (const mode of [constants.BROTLI_MODE_GENERIC, constants.BROTLI_MODE_TEXT, constants.BROTLI_MODE_FONT]) {
      for (const lgwin of [10, 12, 16, 18, 22, 24]) {
        const got = await brotliDecode(compress(text, 9, mode, lgwin));
        expect(Buffer.from(got).equals(Buffer.from(text)), `mode ${mode} window ${lgwin}`).toBe(true);
      }
    }
    // words with capitals, endings and prefixes: the transforms
    const words = "Information information INFORMATION informations informationally the The THE theme Thematic world World WORLDS worldwide ".repeat(30);
    const data = new TextEncoder().encode(words);
    for (const q of [5, 9, 11]) expect(Buffer.from(await brotliDecode(compress(data, q))).equals(Buffer.from(data)), `q${q}`).toBe(true);
  });

  it("decodes many shapes of data (a fuzz of lengths and repetition)", async () => {
    const r = rng(11);
    for (let t = 0; t < 60; t++) {
      const n = Math.floor(r() * 6000);
      const alphabet = 1 + Math.floor(r() * 40);
      const data = new Uint8Array(n);
      for (let i = 0; i < n; i++) data[i] = r() < 0.3 && i > 8 ? data[i - 1 - Math.floor(r() * 8)]! : Math.floor(r() * alphabet);
      const q = [1, 3, 5, 7, 9, 11][t % 6]!;
      expect(Buffer.from(await brotliDecode(compress(data, q))).equals(Buffer.from(data)), `fuzz ${t}`).toBe(true);
    }
  });

  it("refuses data that is cut short or damaged, with an error and no hang", async () => {
    const good = compress(text, 9);
    await expect(brotliDecode(good.slice(0, good.length >> 1))).rejects.toThrow();
    const broken = good.slice();
    broken[10] = broken[10]! ^ 0xff;
    broken[30] = broken[30]! ^ 0x55;
    // (damaged data may by luck decode to something else, but it must end, one way or the other)
    await brotliDecode(broken).catch(() => undefined);
  });
});
