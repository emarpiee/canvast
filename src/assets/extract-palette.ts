/**
 * The main colours of a picture (ADR 0122): median cut on its pixels. Opaque-enough pixels only; the result is ordered from the most to the
 * least common box, each colour the average of its box. Pure (RGBA bytes in, hex out), so it is unit-tested apart.
 */
export function extractPalette(rgba: Uint8ClampedArray | Uint8Array, count: number): string[] {
  const px: number[][] = [];
  const step = Math.max(1, Math.floor(rgba.length / 4 / 20000)); // at most about 20,000 pixels looked at
  for (let i = 0; i < rgba.length; i += 4 * step) if (rgba[i + 3]! >= 128) px.push([rgba[i]!, rgba[i + 1]!, rgba[i + 2]!]);
  if (!px.length || count < 1) return [];
  let boxes: number[][][] = [px];
  while (boxes.length < count) {
    // split the box with the widest spread on its widest channel, at the median
    let best = -1, bestSpread = 0, bestCh = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const p of b) {
          lo = Math.min(lo, p[ch]!);
          hi = Math.max(hi, p[ch]!);
        }
        if (hi - lo > bestSpread) [best, bestSpread, bestCh] = [i, hi - lo, ch];
      }
    });
    if (best < 0) break;
    const b = boxes[best]!.sort((x, y) => x[bestCh]! - y[bestCh]!);
    // the median, moved to the nearest place where the value changes, so equal pixels are never split apart
    let mid = -1;
    for (let i = 1; i < b.length; i++) if (b[i]![bestCh]! !== b[i - 1]![bestCh]! && (mid < 0 || Math.abs(i - b.length / 2) < Math.abs(mid - b.length / 2))) mid = i;
    boxes.splice(best, 1, b.slice(0, mid), b.slice(mid));
  }
  boxes = boxes.filter((b) => b.length).sort((a, b) => b.length - a.length);
  return boxes.map((b) => {
    const avg = [0, 1, 2].map((ch) => Math.round(b.reduce((s, p) => s + p[ch]!, 0) / b.length));
    return `#${avg.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  });
}
