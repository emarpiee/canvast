// A 3D view's line art as real lines: what the view draws (a mask of its lines) followed along their middles, so what is placed is what is seen.
// No three.js here: it runs in a worker over plain arrays.

export interface TraceInput {
  /** 1 where a line is, row by row from the top. */
  mask: Uint8Array;
  w: number;
  h: number;
  /** Lines shorter than this go, in pixels. */
  shortest: number;
  /** How far a simplified line may stray, in pixels. */
  simplify: number;
  /** The most lines kept, the longest first. */
  most: number;
}

export interface LinesResult {
  lines: number[][];
  /** Lines left out by `most`. */
  dropped: number;
}

/** Thins a mask to lines one pixel wide, in place (Zhang-Suen), looking only at what is still on a line's edge. */
function thin(mask: Uint8Array, w: number, h: number): void {
  // (no pixel on the border: a neighbour is always there to read)
  for (let x = 0; x < w; x++) mask[x] = mask[(h - 1) * w + x] = 0;
  for (let y = 0; y < h; y++) mask[y * w] = mask[y * w + w - 1] = 0;
  let live: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) live.push(i);
  const around = [-w, -w + 1, 1, w + 1, w, w - 1, -1, -w - 1]; // P2..P9, clockwise from above
  for (let changed = true; changed; ) {
    changed = false;
    for (const step of [0, 1]) {
      const gone: number[] = [];
      for (const i of live) {
        if (!mask[i]) continue;
        let neighbours = 0, turns = 0;
        for (let k = 0; k < 8; k++) {
          const on = mask[i + around[k]!]!, next = mask[i + around[(k + 1) % 8]!]!;
          neighbours += on;
          if (!on && next) turns++;
        }
        if (neighbours < 2 || neighbours > 6 || turns !== 1) continue;
        const n = mask[i + around[0]!]!, e = mask[i + around[2]!]!, s = mask[i + around[4]!]!, west = mask[i + around[6]!]!;
        if (step === 0 ? n * e * s === 0 && e * s * west === 0 : n * e * west === 0 && n * s * west === 0) gone.push(i);
      }
      for (const i of gone) mask[i] = 0;
      if (gone.length) changed = true;
    }
    live = live.filter((i) => mask[i]);
  }
}

/** Douglas-Peucker: fewer points, none straying more than `tol`. */
function simplified(line: readonly number[], tol: number): number[] {
  const n = line.length / 2;
  if (n < 3) return [...line];
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = line[a * 2]!, ay = line[a * 2 + 1]!, dx = line[b * 2]! - ax, dy = line[b * 2 + 1]! - ay, len = Math.hypot(dx, dy);
    let far = -1, most = tol;
    for (let i = a + 1; i < b; i++) {
      // (a closed line starts and ends at one place: how far from it, or all of it would go)
      const d = len ? Math.abs((line[i * 2]! - ax) * dy - (line[i * 2 + 1]! - ay) * dx) / len : Math.hypot(line[i * 2]! - ax, line[i * 2 + 1]! - ay);
      if (d > most) (most = d), (far = i);
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(line[i * 2]!, line[i * 2 + 1]!);
  return out;
}

/** Follows a mask's lines, from their ends, then what is left (closed ones). A crossing ends the lines that meet there. */
export function traceLines(i: TraceInput): LinesResult {
  const { w, h } = i, mask = i.mask;
  thin(mask, w, h);
  const around = [-w, 1, w, -1, -w + 1, w + 1, w - 1, -w - 1]; // (straight neighbours first: a line goes on straight when it can)
  const degree = (p: number): number => {
    let n = 0;
    for (const d of around) if (mask[p + d]) n++;
    return n;
  };
  const used = new Uint8Array(mask.length);
  const all: Array<{ line: number[]; len: number }> = [];
  const follow = (start: number): void => {
    const line = [start % w, Math.floor(start / w)];
    used[start] = 1;
    let len = 0, p = start;
    for (;;) {
      const next = around.map((d) => p + d).find((q) => mask[q] && !used[q]);
      if (next === undefined) break;
      used[next] = 1;
      len += Math.hypot((next % w) - (p % w), Math.floor(next / w) - Math.floor(p / w));
      line.push(next % w, Math.floor(next / w));
      p = next;
    }
    // (a closed line comes back beside where it began)
    if (line.length > 8 && around.some((d) => p + d === start)) {
      line.push(line[0]!, line[1]!);
      len += 1;
    }
    if (len >= i.shortest && line.length >= 4) all.push({ line: simplified(line, i.simplify), len });
  };
  for (let p = 0; p < mask.length; p++) if (mask[p] && !used[p] && degree(p) === 1) follow(p);
  for (let p = 0; p < mask.length; p++) if (mask[p] && !used[p]) follow(p);
  all.sort((a, b) => b.len - a.len);
  return { lines: all.slice(0, i.most).map((l) => l.line), dropped: Math.max(0, all.length - i.most) };
}

/** Lines as an SVG drawing, in paths of at most `perPath` lines (a path of the app holds so many). */
export function linesSvg(lines: readonly (readonly number[])[], w: number, h: number, colour: string, width: number, perPath = 4000, pointsPerPath = 60_000): string {
  const paths: string[] = [];
  const flush = (d: string[]): void => void paths.push(`<path d="${d.join("")}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`);
  let d: string[] = [], points = 0;
  for (const l of lines) {
    if (d.length >= perPath || points + l.length / 2 > pointsPerPath) {
      flush(d);
      d = [];
      points = 0;
    }
    const at = (j: number): string => `${Math.round(l[j]! * 100) / 100} ${Math.round(l[j + 1]! * 100) / 100}`;
    let one = `M${at(0)}`;
    for (let j = 2; j < l.length; j += 2) one += `L${at(j)}`;
    d.push(one);
    points += l.length / 2;
  }
  if (d.length) flush(d);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${paths.join("")}</svg>`;
}
