// Line art of a 3D model as real lines: from its triangles and one view, the outer outlines and the creases that show, joined into lines in the picture's pixels.
// No three.js here: it runs in a worker over plain arrays.

export interface LinesInput {
  /** x, y, z of each triangle's three corners, in the world. */
  position: Float32Array;
  /** The camera's projection × view, column by column. */
  viewProj: readonly number[];
  /** The camera's place. */
  camera: readonly [number, number, number];
  /** A flat lens: the direction it looks along, else null. */
  flatDir: readonly [number, number, number] | null;
  w: number;
  h: number;
  /** The depth seen at each pixel (0 near, 1 far), the first row at the top; null: nothing hides anything. */
  depth: Float32Array | null;
  /** Between two faces turned to the viewer, a line where they meet at more than this, in degrees. */
  creaseDeg: number;
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

/** Corners at the same place are one corner: a table of them, open addressed (a Map of millions would cost far more). */
function cornersOf(p: Float32Array): Int32Array {
  const n = p.length / 3;
  let size = 16;
  while (size < n * 2) size *= 2;
  const mask = size - 1, table = new Int32Array(size).fill(-1), out = new Int32Array(n);
  let span = 0;
  for (let i = 0; i < p.length; i++) span = Math.max(span, Math.abs(p[i]!));
  const q = 1e6 / (span || 1);
  for (let i = 0; i < n; i++) {
    const x = Math.round(p[i * 3]! * q), y = Math.round(p[i * 3 + 1]! * q), z = Math.round(p[i * 3 + 2]! * q);
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    for (;;) {
      const at = table[h]!;
      if (at < 0) {
        table[h] = i;
        out[i] = i;
        break;
      }
      if (Math.round(p[at * 3]! * q) === x && Math.round(p[at * 3 + 1]! * q) === y && Math.round(p[at * 3 + 2]! * q) === z) {
        out[i] = at;
        break;
      }
      h = (h + 1) & mask;
    }
  }
  return out;
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

export function extractLines(i: LinesInput): LinesResult {
  const p = i.position, tris = Math.floor(p.length / 9), m = i.viewProj;
  const ids = cornersOf(p);
  // Each triangle's normal and whether it faces the viewer.
  const nx = new Float32Array(tris), ny = new Float32Array(tris), nz = new Float32Array(tris), front = new Uint8Array(tris);
  for (let t = 0; t < tris; t++) {
    const a = t * 9;
    const ux = p[a + 3]! - p[a]!, uy = p[a + 4]! - p[a + 1]!, uz = p[a + 5]! - p[a + 2]!, vx = p[a + 6]! - p[a]!, vy = p[a + 7]! - p[a + 1]!, vz = p[a + 8]! - p[a + 2]!;
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1;
    nx[t] = x / l;
    ny[t] = y / l;
    nz[t] = z / l;
    const dx = i.flatDir ? -i.flatDir[0] : i.camera[0] - p[a]!, dy = i.flatDir ? -i.flatDir[1] : i.camera[1] - p[a + 1]!, dz = i.flatDir ? -i.flatDir[2] : i.camera[2] - p[a + 2]!;
    front[t] = x * dx + y * dy + z * dz > 0 ? 1 : 0;
  }
  // Each edge and the two triangles beside it, open addressed.
  let size = 16;
  while (size < tris * 4) size *= 2;
  const mask = size - 1, ea = new Int32Array(size).fill(-1), eb = new Int32Array(size), t1 = new Int32Array(size), t2 = new Int32Array(size).fill(-1);
  for (let t = 0; t < tris; t++) {
    for (let c = 0; c < 3; c++) {
      const u = ids[t * 3 + c]!, v = ids[t * 3 + (c + 1) % 3]!;
      if (u === v) continue;
      const a = Math.min(u, v), b = Math.max(u, v);
      let h = (Math.imul(a, 2654435761) ^ Math.imul(b, 40503)) & mask;
      while (ea[h]! >= 0 && !(ea[h] === a && eb[h] === b)) h = (h + 1) & mask;
      if (ea[h]! < 0) {
        ea[h] = a;
        eb[h] = b;
        t1[h] = t;
      } else if (t2[h]! < 0) t2[h] = t;
    }
  }
  const cosCrease = Math.cos((i.creaseDeg * Math.PI) / 180);
  const project = (c: number): [number, number, number, number] => {
    const x = p[c * 3]!, y = p[c * 3 + 1]!, z = p[c * 3 + 2]!;
    const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
    const px = (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w, py = (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w, pz = (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w;
    return [((px + 1) / 2) * i.w, ((1 - py) / 2) * i.h, (pz + 1) / 2, w];
  };
  /** Whether a place in the picture shows: nothing nearer stands before it (the deepest of a small square, since a line lies on the very surface it borders). */
  const shows = (x: number, y: number, z: number): boolean => {
    if (x < 0 || y < 0 || x >= i.w || y >= i.h) return false;
    if (!i.depth) return true;
    let deepest = 0;
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        const qx = Math.floor(x) + ox, qy = Math.floor(y) + oy;
        if (qx >= 0 && qy >= 0 && qx < i.w && qy < i.h) deepest = Math.max(deepest, i.depth[qy * i.w + qx]!);
      }
    return z <= deepest + 0.0004;
  };
  // The pieces that show, as segments in pixels.
  const segs: number[] = [];
  for (let h = 0; h < size; h++) {
    if (ea[h]! < 0) continue;
    const f1 = front[t1[h]!]!, other = t2[h]!, f2 = other >= 0 ? front[other]! : 0;
    let wanted = false;
    if (other < 0) wanted = f1 === 1; // an open edge
    else if (f1 !== f2) wanted = true; // the outline as seen from here
    else if (f1 && f2) wanted = nx[t1[h]!]! * nx[other]! + ny[t1[h]!]! * ny[other]! + nz[t1[h]!]! * nz[other]! < cosCrease; // a crease
    if (!wanted) continue;
    const a = project(ea[h]!), b = project(eb[h]!);
    if (a[3] <= 0 || b[3] <= 0) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.min(4096, Math.ceil(len / 2)));
    let run = -1;
    for (let s = 0; s <= steps; s++) {
      const k = s / steps;
      const ok = shows(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
      if (ok && run < 0) run = s;
      if ((!ok || s === steps) && run >= 0) {
        const end = ok ? s : s - 1;
        if (end > run) segs.push(a[0] + ((b[0] - a[0]) * run) / steps, a[1] + ((b[1] - a[1]) * run) / steps, a[0] + ((b[0] - a[0]) * end) / steps, a[1] + ((b[1] - a[1]) * end) / steps);
        run = -1;
      }
    }
  }
  // Segments that meet become lines.
  const count = segs.length / 4, ends = new Map<string, number[]>();
  const keyOf = (x: number, y: number): string => `${Math.round(x * 4)},${Math.round(y * 4)}`;
  for (let s = 0; s < count; s++) {
    for (const e of [0, 2]) {
      const k = keyOf(segs[s * 4 + e]!, segs[s * 4 + e + 1]!);
      const at = ends.get(k);
      if (at) at.push(s);
      else ends.set(k, [s]);
    }
  }
  const used = new Uint8Array(count);
  const walk = (x0: number, y0: number, out: number[]): void => {
    let x = x0, y = y0;
    for (;;) {
      const next = ends.get(keyOf(x, y))?.find((s) => !used[s]);
      if (next === undefined) return;
      used[next] = 1;
      const a = keyOf(segs[next * 4]!, segs[next * 4 + 1]!) === keyOf(x, y);
      x = segs[next * 4 + (a ? 2 : 0)]!;
      y = segs[next * 4 + (a ? 3 : 1)]!;
      out.push(x, y);
    }
  };
  const all: Array<{ line: number[]; len: number }> = [];
  for (let s = 0; s < count; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const forward: number[] = [segs[s * 4 + 2]!, segs[s * 4 + 3]!];
    walk(forward[0]!, forward[1]!, forward);
    const back: number[] = [segs[s * 4]!, segs[s * 4 + 1]!];
    walk(back[0]!, back[1]!, back);
    const line: number[] = [];
    for (let j = back.length - 2; j >= 0; j -= 2) line.push(back[j]!, back[j + 1]!);
    line.push(...forward);
    let len = 0;
    for (let j = 2; j < line.length; j += 2) len += Math.hypot(line[j]! - line[j - 2]!, line[j + 1]! - line[j - 1]!);
    if (len >= i.shortest) all.push({ line: simplified(line, i.simplify), len });
  }
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
