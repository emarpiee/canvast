import { describe, expect, it } from "vitest";
import { GifFrames } from "../../src/assets/gif";
import { encodeGif } from "../e2e/gif";

const PAL = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]];
const px = (f: Uint8ClampedArray, w: number, x: number, y: number): number[] => [...f.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];

describe("gif frames", () => {
  it("composes frames with transparency and the three disposal methods, in any access order", () => {
    // 4x2 picture. f0 paints everything red (leave); f1 paints a green 2x1 with transparency index 0 (restore previous);
    // f2 paints blue at one pixel (clear to transparent); f3 paints green at another pixel.
    const gif = encodeGif(4, 2, PAL, [
      { pixels: [1, 1, 1, 1, 1, 1, 1, 1], w: 4, h: 2, delay: 50 },
      { pixels: [2, 0], w: 2, h: 1, x: 1, y: 0, disposal: 3, transparent: 0, delay: 1 },
      { pixels: [3], w: 1, h: 1, x: 3, y: 1, disposal: 2 },
      { pixels: [2], w: 1, h: 1, x: 0, y: 1 },
    ]);
    const g = new GifFrames(gif);
    expect(g.count).toBe(4);
    expect(g.frames.map((f) => f.delay)).toEqual([0.5, 0.1, 0.1, 0.1]); // a delay of 1/100 s is shown for 0.1 s
    expect(g.duration).toBeCloseTo(0.8);
    const R = [255, 0, 0, 255];
    expect(px(g.frame(0), 4, 3, 1)).toEqual(R);
    expect(px(g.frame(1), 4, 1, 0)).toEqual([0, 255, 0, 255]);
    expect(px(g.frame(1), 4, 2, 0)).toEqual(R); // transparent index keeps what was there
    // f1 is restored before f2 is drawn; f2 puts blue at (3,1) over red.
    const f2 = g.frame(2);
    expect(px(f2, 4, 1, 0)).toEqual(R);
    expect(px(f2, 4, 3, 1)).toEqual([0, 0, 255, 255]);
    // f2 is cleared (to transparent) before f3: its pixel disappears, everything else stays red.
    const f3 = g.frame(3);
    expect(px(f3, 4, 3, 1)).toEqual([0, 0, 0, 0]);
    expect(px(f3, 4, 0, 1)).toEqual([0, 255, 0, 255]);
    expect(px(f3, 4, 0, 0)).toEqual(R);
    // Going back, or asking for the same frame twice, gives the same pictures.
    expect(g.frame(1)).toEqual(new GifFrames(gif).frame(1));
    expect(g.frame(3)).toEqual(f3);
    expect(() => g.frame(4)).toThrow();
  });

  it("reads interlaced frames and rows over 255 bytes of data", () => {
    const w = 8;
    const h = 20;
    const pixels = Array.from({ length: w * h }, (_, i) => (Math.floor(i / w) % 3) + 1);
    const g = new GifFrames(encodeGif(w, h, PAL, [{ pixels, w, h, interlaced: true }]));
    const f = g.frame(0);
    for (let y = 0; y < h; y++) expect(px(f, w, 3, y)).toEqual([...PAL[(y % 3) + 1]!, 255]);
  });

  it("decodes real LZW: growing code sizes and table resets over a large patterned frame", () => {
    let seed = 5;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed);
    const w = 200;
    const h = 150;
    // Runs and noise: long matches grow the table past 4096 entries more than once.
    const pixels = Array.from({ length: w * h }, (_, i) => (i % 97 < 60 ? (i >> 3) % 4 : rnd() % 4));
    const f = new GifFrames(encodeGif(w, h, PAL, [{ pixels, w, h }])).frame(0);
    for (let i = 0; i < pixels.length; i += 7) expect([...f.subarray(i * 4, i * 4 + 3)]).toEqual(PAL[pixels[i]!]);
  });

  it("rejects things that are not GIFs", () => {
    expect(() => new GifFrames(new Uint8Array(20))).toThrow();
  });
});
