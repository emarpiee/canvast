import { describe, expect, it } from "vitest";
import { linesSvg, traceLines } from "../../src/assets/model-lines";

const W = 60, H = 60;
/** A mask with what `on` says. */
const maskOf = (on: (x: number, y: number) => boolean): Uint8Array => {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = on(x, y) ? 1 : 0;
  return m;
};
const trace = (on: (x: number, y: number) => boolean, over = {}) => traceLines({ mask: maskOf(on), w: W, h: H, shortest: 0, simplify: 0.8, most: 1000, ...over });

describe("the lines of a 3D view, followed from what it shows", () => {
  it("a thick line becomes one line along its middle, with few points", () => {
    const { lines } = trace((x, y) => x >= 10 && x <= 50 && y >= 28 && y <= 32);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.length).toBeLessThan(12);
    const ys = lines[0]!.filter((_, i) => i % 2 === 1);
    for (const y of ys) expect(Math.abs(y - 30)).toBeLessThanOrEqual(2);
  });
  it("a ring stays one closed line: it does not collapse when simplified", () => {
    const { lines } = trace((x, y) => { const r = Math.hypot(x - 30, y - 30); return r >= 18 && r <= 21; });
    expect(lines).toHaveLength(1);
    const l = lines[0]!;
    expect(l.length).toBeGreaterThan(10);
    expect(Math.hypot(l[0]! - l.at(-2)!, l[1]! - l.at(-1)!)).toBeLessThanOrEqual(2);
    const xs = l.filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(30);
  });
  it("nothing stays nothing; short ones go; it keeps the longest and says how many went", () => {
    expect(trace(() => false).lines).toHaveLength(0);
    const two = (x: number, y: number): boolean => (y === 10 && x >= 5 && x <= 50) || (y === 40 && x >= 5 && x <= 10);
    expect(trace(two).lines).toHaveLength(2);
    expect(trace(two, { shortest: 20 }).lines).toHaveLength(1);
    const kept = trace(two, { most: 1 });
    expect(kept.lines).toHaveLength(1);
    expect(kept.dropped).toBe(1);
    expect(kept.lines[0]!.filter((_, i) => i % 2 === 0).at(-1)).toBeGreaterThan(40);
  });
  it("makes real paths, split when one would hold too many", () => {
    const svg = linesSvg([[0, 0, 10, 10], [5, 5, 6, 6]], 20, 20, "#111111", 2, 1);
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toContain('d="M0 0L10 10"');
    expect(svg).toContain('stroke-width="2"');
  });
});
