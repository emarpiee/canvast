// A 3D model's line art from its own edges: the outline (where the surface turns away), the creases (where two faces meet at an angle) and,
// if asked, the edges behind, each seen or hidden by the model's own faces; tones from the light as hatching or dots; a hand-drawn wobble.
// What it gives is exact lines in the picture's pixels, the same for the view, a card, the lines placed on a canvas and an SVG file.
// No three.js here: it runs in a worker over plain arrays.

/** A model's triangles where they stand in the scene (posed, turned up): three numbers a corner, three corners a face. */
export interface EdgeMesh {
  pos: Float32Array;
  faces: Uint32Array;
}

export type ToneKind = "none" | "hatch" | "crosshatch" | "halftone" | "stipple";

/** What to draw and how it is seen. Sizes are in the picture's pixels. */
export interface InkSpec {
  w: number;
  h: number;
  /** The camera: its view matrix and its projection, column by column (as three.js keeps them). */
  view: readonly number[];
  proj: readonly number[];
  persp: boolean;
  /** Where the camera is, and the way from the model to it (a flat lens looks along one way). */
  camPos: readonly [number, number, number];
  camDir: readonly [number, number, number];
  near: number;
  /** Coarser while the view moves. */
  quick: boolean;
  outline: boolean;
  outlineWidth: number;
  creases: boolean;
  creaseWidth: number;
  /** Degrees: faces meeting at a sharper turn than this make a crease. */
  creaseAngle: number;
  hidden: boolean;
  tones: ToneKind;
  toneSpacing: number;
  /** 1 as the light falls; more darkens. */
  toneStrength: number;
  toneWidth: number;
  /** Degrees. */
  toneAngle: number;
  /** How far a hand-drawn line strays, in pixels. */
  sketch: number;
  /** 0–1: how much the far lines fade. */
  fade: number;
  /** Near lines thicker, far ones thinner. */
  weight: boolean;
  /** Toward each light, and its strength (1: full light on a face turned to it). */
  lights: ReadonlyArray<{ dir: readonly [number, number, number]; power: number }>;
  ambient: number;
  /** The faces in sight as triangles, for a fill under the lines. */
  fill: boolean;
}

export type InkRole = "contour" | "crease" | "hidden" | "tone";

/** Lines of one look: polylines, one after another (`ends`: where each ends, in points). */
export interface InkGroup {
  role: InkRole;
  width: number;
  opacity: number;
  pts: Float32Array;
  ends: Uint32Array;
}

export interface Drawing {
  w: number;
  h: number;
  groups: InkGroup[];
  /** Dots of tone: x, y, radius. */
  dots: Float32Array;
  /** Faces in sight: x, y three times each, all turning one way. */
  fill: Float32Array;
}

interface Topology {
  /** Per edge: its two corners (indices), its faces (the second -1 at an open edge). */
  edges: Int32Array;
  /** Per edge: the cosine of the turn between its faces (-1 at an open edge). */
  turn: Float32Array;
  /** Per face: its normal. */
  normals: Float32Array;
}

/** Joins corners at one place (a file often has each face's corners apart) and finds each edge's two faces. */
function topology(m: EdgeMesh): Topology {
  const { pos, faces } = m;
  const nFaces = faces.length / 3;
  const normals = new Float32Array(faces.length);
  for (let f = 0; f < nFaces; f++) {
    const a = faces[f * 3]! * 3, b = faces[f * 3 + 1]! * 3, c = faces[f * 3 + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z);
    if (l > 0) normals.set([x / l, y / l, z / l], f * 3);
  }
  // (a model is a unit across here: a millionth of it is one place)
  const weld = new Map<string, number>(), ids = new Uint32Array(pos.length / 3);
  for (let i = 0; i < ids.length; i++) {
    const key = `${Math.round(pos[i * 3]! * 1e6)},${Math.round(pos[i * 3 + 1]! * 1e6)},${Math.round(pos[i * 3 + 2]! * 1e6)}`;
    let id = weld.get(key);
    if (id === undefined) weld.set(key, (id = i));
    ids[i] = id;
  }
  const seen = new Map<number, number>(), edges: number[] = [], count = ids.length;
  for (let f = 0; f < nFaces; f++) {
    if (!normals[f * 3] && !normals[f * 3 + 1] && !normals[f * 3 + 2]) continue; // (a face with no area)
    for (let k = 0; k < 3; k++) {
      let a = ids[faces[f * 3 + k]!]!, b = ids[faces[f * 3 + ((k + 1) % 3)]!]!;
      if (a === b) continue;
      if (a > b) [a, b] = [b, a];
      const key = a * count + b, at = seen.get(key);
      if (at === undefined) {
        seen.set(key, edges.length);
        edges.push(a, b, f, -1);
      } else if (edges[at + 3] === -1) edges[at + 3] = f;
    }
  }
  const turn = new Float32Array(edges.length / 4);
  for (let e = 0; e < edges.length; e += 4) {
    const f1 = edges[e + 2]! * 3, f2 = edges[e + 3]!;
    turn[e / 4] = f2 < 0 ? -1 : Math.max(-1, Math.min(1, normals[f1]! * normals[f2 * 3]! + normals[f1 + 1]! * normals[f2 * 3 + 1]! + normals[f1 + 2]! * normals[f2 * 3 + 2]!));
  }
  return { edges: Int32Array.from(edges), turn, normals };
}

/** One straight piece of a line, before it is joined to the next. */
interface Piece {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  role: InkRole;
  /** 0 far … 1 near. */
  near: number;
  width: number;
}

/** A model's edges made ready once; each look of it is then drawn by `draw`. */
export class EdgeModel {
  private topo: Topology | null = null;
  constructor(private readonly mesh: EdgeMesh) {}

  draw(s: InkSpec): Drawing {
    const topo = (this.topo ??= topology(this.mesh));
    const { pos, faces } = this.mesh;
    const w = Math.max(1, Math.round(s.w)), h = Math.max(1, Math.round(s.h));
    const nV = pos.length / 3, nF = faces.length / 3;
    // Each corner on the picture: x, y, and how far (along the camera).
    const sx = new Float32Array(nV), sy = new Float32Array(nV), dist = new Float32Array(nV);
    const V = s.view, P = s.proj;
    let dMin = Infinity, dMax = -Infinity;
    for (let i = 0; i < nV; i++) {
      const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
      const vx = V[0]! * x + V[4]! * y + V[8]! * z + V[12]!, vy = V[1]! * x + V[5]! * y + V[9]! * z + V[13]!, vz = V[2]! * x + V[6]! * y + V[10]! * z + V[14]!;
      const cx = P[0]! * vx + P[4]! * vy + P[8]! * vz + P[12]!, cy = P[1]! * vx + P[5]! * vy + P[9]! * vz + P[13]!, cw = P[3]! * vx + P[7]! * vy + P[11]! * vz + P[15]!;
      const d = -vz;
      dist[i] = d;
      if (d > s.near) {
        sx[i] = ((cx / cw) * 0.5 + 0.5) * w;
        sy[i] = (0.5 - (cy / cw) * 0.5) * h;
        if (d < dMin) dMin = d;
        if (d > dMax) dMax = d;
      }
    }
    // Closeness, which goes straight across the picture: 1 / distance through a lens, minus the distance on a flat one. More is nearer.
    const close = (d: number): number => (s.persp ? 1 / d : -d);
    const distOf = (c: number): number => (s.persp ? 1 / c : -c);
    // The faces drawn into a buffer of which face is nearest at each pixel.
    const owner = new Int32Array(w * h).fill(-1), depth = new Float32Array(w * h).fill(-Infinity);
    /** -1 or 1: which way a face turns on the picture; 0: edge-on, behind the camera or not drawn. */
    const side = new Int8Array(nF);
    for (let f = 0; f < nF; f++) {
      const ia = faces[f * 3]!, ib = faces[f * 3 + 1]!, ic = faces[f * 3 + 2]!;
      if (dist[ia]! <= s.near || dist[ib]! <= s.near || dist[ic]! <= s.near) continue;
      const ax = sx[ia]!, ay = sy[ia]!, bx = sx[ib]!, by = sy[ib]!, cx = sx[ic]!, cy = sy[ic]!;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      // (which way it turns, however small: by the rim of a round form, small in the picture, the faces are slivers)
      side[f] = area < -1e-6 ? -1 : area > 1e-6 ? 1 : 0;
      if (Math.abs(area) < (s.quick ? 0.35 : 0.01)) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
      if (x0 > x1 || y0 > y1) continue;
      const za = close(dist[ia]!), zb = close(dist[ib]!), zc = close(dist[ic]!);
      // Its share of each corner at a point, which goes straight across: a row is a run between where the shares start and stop.
      const inv = 1 / area, du = (by - cy) * inv, dv = (cy - ay) * inv, dt = -du - dv, uy = (cx - bx) * inv, vy = (ax - cx) * inv;
      let rowU = ((bx - x0) * (cy - y0) - (by - y0) * (cx - x0)) * inv, rowV = ((cx - x0) * (ay - y0) - (cy - y0) * (ax - x0)) * inv;
      const dz = du * (za - zc) + dv * (zb - zc);
      for (let y = y0; y <= y1; y++, rowU += uy, rowV += vy) {
        let lo = 0, hi = x1 - x0;
        const rowT = 1 - rowU - rowV;
        const span = (k: number, d: number): boolean => {
          if (Math.abs(d) < 1e-14) return k >= -1e-5;
          if (d > 0) lo = Math.max(lo, (-1e-5 - k) / d);
          else hi = Math.min(hi, (-1e-5 - k) / d);
          return true;
        };
        if (!span(rowU, du) || !span(rowV, dv) || !span(rowT, dt)) continue;
        const first = Math.ceil(lo), last = Math.floor(hi);
        if (first > last) continue;
        let z = rowU * (za - zc) + rowV * (zb - zc) + zc + first * dz, q = y * w + x0 + first;
        for (let x = first; x <= last; x++, q++, z += dz) {
          if (z <= depth[q]!) continue;
          depth[q] = z;
          owner[q] = f;
        }
      }
    }
    const nearOf = (d: number): number => (dMax > dMin ? 1 - (d - dMin) / (dMax - dMin) : 1);
    const pieces: Piece[] = [];
    // An edge this much behind what is drawn there is still seen: a little of the model (a unit across), and two pixels' worth of depth
    // where it lies (by the rim of a round form, the faces next to it come nearer than the rim within a pixel or two).
    const pxWorld = 2 / (Math.abs(P[5]!) * h);
    /** How much of the model a pixel spans, as far as `d`. */
    const pxAt = (d: number): number => (s.persp ? d * pxWorld : pxWorld);
    const slackAt = (d: number): number => 0.003 + 2 * pxAt(d);
    const cosCrease = Math.cos((s.creaseAngle * Math.PI) / 180);
    const E = topo.edges;
    for (let e = 0; e < E.length; e += 4) {
      const a = E[e]!, b = E[e + 1]!, f1 = E[e + 2]!, f2 = E[e + 3]!;
      const v1 = side[f1]!, v2 = f2 < 0 ? 0 : side[f2]!;
      if (!v1 && !v2) continue;
      const contour = !v1 || !v2 || v1 !== v2;
      if (contour ? !s.outline : !s.creases || topo.turn[e / 4]! >= cosCrease) continue;
      if (dist[a]! <= s.near || dist[b]! <= s.near) continue;
      const x0 = sx[a]!, y0 = sy[a]!, dx = sx[b]! - x0, dy = sy[b]! - y0;
      // Only the part on the picture.
      let lo = 0, hi = 1, inside = true;
      for (const [p, q] of [[-dx, x0], [dx, w - 1 - x0], [-dy, y0], [dy, h - 1 - y0]] as const) {
        if (Math.abs(p) < 1e-12) {
          if (q < 0) inside = false;
        } else if (p < 0) lo = Math.max(lo, q / p);
        else hi = Math.min(hi, q / p);
      }
      if (!inside || lo > hi) continue;
      const za = close(dist[a]!), zb = close(dist[b]!), length = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil((length * (hi - lo)) / (s.quick ? 1.5 : 0.7)));
      const role: InkRole = contour ? "contour" : "crease", near = nearOf((dist[a]! + dist[b]!) / 2);
      // Something nearer than the edge over a point beside it (not its own faces).
      const ux = -dy / (length || 1), uy = dx / (length || 1);
      const coveredAt = (px: number, py: number, d: number): boolean => {
        const ix = Math.round(px), iy = Math.round(py);
        if (ix < 0 || ix >= w || iy < 0 || iy >= h) return false;
        const o = owner[iy * w + ix]!;
        return o >= 0 && o !== f1 && o !== f2 && distOf(depth[iy * w + ix]!) < d - slackAt(d);
      };
      let runStart = lo, runSeen: boolean | null = null;
      const flush = (end: number): void => {
        if (runSeen === null || end - runStart < 1e-9 || (!runSeen && !s.hidden)) return;
        pieces.push({ x0: x0 + dx * runStart, y0: y0 + dy * runStart, x1: x0 + dx * end, y1: y0 + dy * end, role: runSeen ? role : "hidden", near, width: 0 });
      };
      for (let k = 0; k < steps; k++) {
        const t = lo + ((hi - lo) * (k + 0.5)) / steps;
        const x = Math.max(0, Math.min(w - 1, Math.round(x0 + dx * t))), y = Math.max(0, Math.min(h - 1, Math.round(y0 + dy * t))), q = y * w + x;
        const o = owner[q]!;
        const d = distOf(za + (zb - za) * t);
        let seen = o === f1 || o === f2 || d <= (o < 0 ? Infinity : distOf(depth[q]!)) + slackAt(d);
        // An outline a little behind what covers it is the edge of what is seen when, just outside it on one side or the other, nothing nearer
        // covers it. (By the rim of a round form, the faces next to it come nearer than the rim within a pixel, and its own faces are slivers
        // that cover none; an outline a whole form behind, as a box's back seen face on, stays hidden.)
        if (!seen && contour && d - distOf(depth[q]!) < 0.1 + 20 * pxAt(d)) {
          const ex = x0 + dx * t, ey = y0 + dy * t;
          seen = !coveredAt(ex + ux * 1.5, ey + uy * 1.5, d) || !coveredAt(ex - ux * 1.5, ey - uy * 1.5, d);
        }
        // (seen at a slant, the edge's own face can fall on the next pixel)
        for (let oy = -1; oy <= 1 && !seen; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const id = owner[ny * w + nx];
            if (id === f1 || id === f2) {
              seen = true;
              break;
            }
          }
        if (runSeen === null) runSeen = seen;
        else if (seen !== runSeen) {
          const at = lo + ((hi - lo) * k) / steps;
          flush(at);
          runStart = at;
          runSeen = seen;
        }
      }
      flush(hi);
    }
    const lines = this.decorate(s, pieces);
    const toneOut = s.tones === "none" ? { pieces: [] as Piece[], dots: [] as number[] } : this.tones(s, w, h, owner, nF);
    const fill: number[] = [];
    if (s.fill) {
      const shown = new Uint8Array(nF);
      for (const o of owner) if (o >= 0) shown[o] = 1;
      for (let f = 0; f < nF; f++) {
        if (!shown[f]) continue;
        const ia = faces[f * 3]!, ib = faces[f * 3 + 1]!, ic = faces[f * 3 + 2]!;
        const [b, c] = side[f]! < 0 ? [ic, ib] : [ib, ic];
        fill.push(sx[ia]!, sy[ia]!, sx[b]!, sy[b]!, sx[c]!, sy[c]!);
      }
    }
    return { w, h, groups: joined([...toneOut.pieces, ...lines], s), dots: Float32Array.from(toneOut.dots), fill: Float32Array.from(fill) };
  }

  /** Tones of the light as lines or dots, where the faces in sight are dark. */
  private tones(s: InkSpec, w: number, h: number, owner: Int32Array, nF: number): { pieces: Piece[]; dots: number[] } {
    const N = this.topo!.normals, faces = this.mesh.faces, pos = this.mesh.pos;
    const dark = new Float32Array(nF);
    for (let f = 0; f < nF; f++) {
      let nx = N[f * 3]!, ny = N[f * 3 + 1]!, nz = N[f * 3 + 2]!;
      // (a face is lit on the side the camera sees)
      const a = faces[f * 3]! * 3;
      const tx = s.persp ? s.camPos[0] - pos[a]! : s.camDir[0], ty = s.persp ? s.camPos[1] - pos[a + 1]! : s.camDir[1], tz = s.persp ? s.camPos[2] - pos[a + 2]! : s.camDir[2];
      if (nx * tx + ny * ty + nz * tz < 0) (nx = -nx), (ny = -ny), (nz = -nz);
      let lit = s.ambient;
      for (const l of s.lights) lit += l.power * Math.max(0, nx * l.dir[0] + ny * l.dir[1] + nz * l.dir[2]);
      dark[f] = Math.max(0, Math.min(1, (1 - lit) * s.toneStrength));
    }
    const darkAt = (x: number, y: number): number => {
      const ix = Math.round(x), iy = Math.round(y);
      if (ix < 0 || ix >= w || iy < 0 || iy >= h) return -1;
      const f = owner[iy * w + ix]!;
      return f < 0 ? -1 : dark[f]!;
    };
    const spacing = Math.max(1, s.toneSpacing * (s.quick ? 1.25 : 1));
    const pieces: Piece[] = [], dots: number[] = [];
    const hash = (n: number): number => {
      const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    if (s.tones === "halftone" || s.tones === "stipple") {
      for (let row = 0, y = spacing / 2; y < h; y += spacing, row++)
        for (let col = 0, x = spacing / 2 + ((row % 2) * spacing) / 2; x < w; x += spacing, col++) {
          let px = x, py = y;
          if (s.tones === "stipple") {
            px += (hash(row * 997 + col) - 0.5) * spacing * 0.7;
            py += (hash(row * 997 + col + 12345) - 0.5) * spacing * 0.7;
          }
          const d = darkAt(px, py);
          if (d < 0.06 || (s.tones === "stipple" && hash(row * 997 + col + 54321) > d)) continue;
          dots.push(px, py, s.tones === "halftone" ? spacing * 0.44 * Math.sqrt(d) : Math.max(0.45, s.toneWidth * 0.7));
        }
      return { pieces, dots };
    }
    const diagonal = Math.hypot(w, h), passes = s.tones === "crosshatch" ? 3 : 1, step = s.quick ? 2 : 1;
    for (let pass = 0; pass < passes; pass++) {
      const angle = ((s.toneAngle + (pass === 1 ? 90 : pass === 2 ? 45 : 0)) * Math.PI) / 180, dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy, ny = dx;
      const threshold = pass === 0 ? 0.16 : pass === 1 ? 0.47 : 0.76;
      for (let offset = -diagonal; offset <= diagonal; offset += spacing) {
        let start: number | null = null, total = 0, count = 0;
        const flush = (t: number): void => {
          if (start !== null && t - start >= 1) {
            const d = total / Math.max(1, count);
            pieces.push({ x0: w / 2 + dx * start + nx * offset, y0: h / 2 + dy * start + ny * offset, x1: w / 2 + dx * t + nx * offset, y1: h / 2 + dy * t + ny * offset, role: "tone", near: 1, width: s.toneWidth * (0.45 + d * 0.8) });
          }
          start = null;
          total = count = 0;
        };
        for (let t = -diagonal; t <= diagonal; t += step) {
          const d = darkAt(w / 2 + dx * t + nx * offset, h / 2 + dy * t + ny * offset);
          if (d >= threshold) {
            if (start === null) start = t;
            total += d;
            count++;
          } else flush(t - step * 0.5);
        }
        flush(diagonal);
      }
    }
    return { pieces, dots };
  }

  /** Widths from how near, and a hand-drawn line's wobble. */
  private decorate(s: InkSpec, pieces: Piece[]): Piece[] {
    const out: Piece[] = [];
    for (const p of pieces) {
      const base = p.role === "contour" ? s.outlineWidth : p.role === "crease" ? s.creaseWidth : Math.min(s.outlineWidth, s.creaseWidth);
      const width = base * (s.weight ? 0.65 + p.near * 0.7 : 1);
      const dx = p.x1 - p.x0, dy = p.y1 - p.y0, len = Math.hypot(dx, dy);
      if (!s.sketch || p.role === "hidden" || len < 1e-6) {
        out.push({ ...p, width });
        continue;
      }
      const n = Math.max(1, Math.ceil(len / 12)), nx = -dy / len, ny = dx / len;
      const at = (t: number): [number, number] => {
        const x = p.x0 + dx * t, y = p.y0 + dy * t, phase = x * 0.055 + y * 0.071, off = s.sketch * (Math.sin(phase) + 0.35 * Math.sin(phase * 2.63));
        return [x + nx * off, y + ny * off];
      };
      let prev = at(0);
      for (let k = 1; k <= n; k++) {
        const next = at(k / n);
        out.push({ ...p, x0: prev[0], y0: prev[1], x1: next[0], y1: next[1], width });
        prev = next;
      }
    }
    return out;
  }
}

/** Pieces joined end to end into lines, one group for each look (a role, a width and how faded, in small steps). */
function joined(pieces: Piece[], s: InkSpec): InkGroup[] {
  const byLook = new Map<string, { role: InkRole; width: number; opacity: number; list: Piece[] }>();
  for (const p of pieces) {
    const width = Math.round(p.width * 20) / 20;
    const opacity = p.role === "hidden" || p.role === "tone" || !s.fade ? 1 : Math.round((1 - s.fade * (1 - p.near) * 0.85) * 20) / 20;
    const key = `${p.role}|${width}|${opacity}`;
    let g = byLook.get(key);
    if (!g) byLook.set(key, (g = { role: p.role, width, opacity, list: [] }));
    g.list.push(p);
  }
  const ORDER: Record<InkRole, number> = { tone: 0, hidden: 1, crease: 2, contour: 3 };
  return [...byLook.values()].sort((a, b) => ORDER[a.role] - ORDER[b.role] || a.width - b.width).map((g) => ({ role: g.role, width: g.width, opacity: g.opacity, ...chain(g.list, g.role === "contour" || g.role === "crease" ? Math.max(1.5, g.width * 1.2) : 0) }));
}

/**
 * Pieces that meet end to end become one line; ends nearer than `gap` pixels are joined too (an outline of a coarse model dips behind its
 * own surface for a pixel here and there: joined, it does not read as dashes).
 */
function chain(list: Piece[], gap: number): { pts: Float32Array; ends: Uint32Array } {
  const cell = Math.max(gap, 1 / 16);
  const keyOf = (cx: number, cy: number): number => cx * 1_048_576 + cy;
  const at = new Map<number, number[]>();
  const add = (x: number, y: number, i: number): void => {
    const k = keyOf(Math.floor(x / cell), Math.floor(y / cell));
    const l = at.get(k);
    if (l) l.push(i);
    else at.set(k, [i]);
  };
  list.forEach((p, i) => (add(p.x0, p.y0, i), add(p.x1, p.y1, i)));
  const used = new Uint8Array(list.length);
  const pts: number[] = [], ends: number[] = [];
  /** The nearest piece with an end by a point: its far end last. */
  const nextFrom = (x: number, y: number): number[] | null => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let best = -1, flip = false, most = gap > 1 / 16 ? gap : 1 / 16;
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const k of at.get(keyOf(cx + i, cy + j)) ?? []) {
          if (used[k]) continue;
          const q = list[k]!, d0 = Math.hypot(q.x0 - x, q.y0 - y), d1 = Math.hypot(q.x1 - x, q.y1 - y);
          if (Math.min(d0, d1) < most) [best, flip, most] = [k, d1 < d0, Math.min(d0, d1)];
        }
    if (best < 0) return null;
    used[best] = 1;
    const q = list[best]!;
    const [nx, ny, fx, fy] = flip ? [q.x1, q.y1, q.x0, q.y0] : [q.x0, q.y0, q.x1, q.y1];
    return most > 1e-3 ? [nx, ny, fx, fy] : [fx, fy];
  };
  for (let i = 0; i < list.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const p = list[i]!;
    const fwd: number[] = [p.x0, p.y0, p.x1, p.y1];
    for (let n = nextFrom(p.x1, p.y1); n; n = nextFrom(fwd[fwd.length - 2]!, fwd[fwd.length - 1]!)) fwd.push(...n);
    const back: number[] = [];
    for (let n = nextFrom(p.x0, p.y0); n; n = nextFrom(back[back.length - 2]!, back[back.length - 1]!)) back.push(...n);
    for (let j = back.length - 2; j >= 0; j -= 2) pts.push(back[j]!, back[j + 1]!);
    pts.push(...fwd);
    ends.push(pts.length / 2);
  }
  return { pts: Float32Array.from(pts), ends: Uint32Array.from(ends) };
}

/** How the lines are painted: what does not change where they are. */
export interface InkStyle {
  contour: string;
  crease: string;
  hidden: string;
  /** 0–1. */
  hiddenOpacity: number;
  /** Pixels. */
  hiddenDash: number;
  tone: string;
  /** The fill under the lines, or none. */
  fill?: string | undefined;
}

const colourOf = (role: InkRole, st: InkStyle): string => (role === "contour" ? st.contour : role === "crease" ? st.crease : role === "hidden" ? st.hidden : st.tone);

/** Paints a drawing on a 2D canvas (scaled as its context is). */
export function paintInk(g: CanvasRenderingContext2D, d: Drawing, st: InkStyle): void {
  g.save();
  g.lineCap = g.lineJoin = "round";
  if (st.fill && d.fill.length) {
    g.fillStyle = st.fill;
    g.beginPath();
    for (let i = 0; i < d.fill.length; i += 6) {
      g.moveTo(d.fill[i]!, d.fill[i + 1]!);
      g.lineTo(d.fill[i + 2]!, d.fill[i + 3]!);
      g.lineTo(d.fill[i + 4]!, d.fill[i + 5]!);
      g.closePath();
    }
    g.fill();
  }
  const paintGroup = (gr: InkGroup): void => {
    g.strokeStyle = colourOf(gr.role, st);
    g.lineWidth = gr.width;
    g.globalAlpha = gr.role === "hidden" ? st.hiddenOpacity : gr.opacity;
    g.setLineDash(gr.role === "hidden" ? [st.hiddenDash, st.hiddenDash * 0.65] : []);
    g.beginPath();
    let from = 0;
    for (const end of gr.ends) {
      g.moveTo(gr.pts[from * 2]!, gr.pts[from * 2 + 1]!);
      for (let j = from + 1; j < end; j++) g.lineTo(gr.pts[j * 2]!, gr.pts[j * 2 + 1]!);
      from = end;
    }
    g.stroke();
  };
  for (const gr of d.groups) if (gr.role === "tone") paintGroup(gr);
  if (d.dots.length) {
    g.globalAlpha = 1;
    g.fillStyle = st.tone;
    g.beginPath();
    for (let i = 0; i < d.dots.length; i += 3) {
      g.moveTo(d.dots[i]! + d.dots[i + 2]!, d.dots[i + 1]!);
      g.arc(d.dots[i]!, d.dots[i + 1]!, d.dots[i + 2]!, 0, Math.PI * 2);
    }
    g.fill();
  }
  for (const gr of d.groups) if (gr.role !== "tone") paintGroup(gr);
  g.restore();
}

/** Numbers short enough for a file. */
const n2 = (v: number): string => String(Math.round(v * 100) / 100);

/** One SVG element, or several when a path would hold more lines than the app keeps in one (each is then a path to edit). */
function chunkedPaths(lines: Iterable<string>, attrs: string, perPath = 4000, charsPerPath = 1_200_000): string {
  const out: string[] = [];
  let d: string[] = [], chars = 0;
  const flush = (): void => {
    if (d.length) out.push(`<path d="${d.join("")}"${attrs}/>`);
    d = [];
    chars = 0;
  };
  for (const one of lines) {
    if (d.length >= perPath || chars + one.length > charsPerPath) flush();
    d.push(one);
    chars += one.length;
  }
  flush();
  return out.join("");
}

/** A drawing as an SVG file: the fill, the tones, the hidden edges, the creases and the outline, each in its own group. `raster`: a picture under it all (the model as drawn). Mirrored: flipped across. */
export function inkSvg(d: Drawing, st: InkStyle, o: { background?: string | undefined; raster?: string | undefined; mirror?: boolean | undefined; perPath?: number } = {}): string {
  const X = (x: number): string => n2(o.mirror ? d.w - x : x);
  const Y = n2;
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.w} ${d.h}" width="${d.w}" height="${d.h}">`];
  if (o.background) parts.push(`<rect width="${d.w}" height="${d.h}" fill="${o.background}"/>`);
  if (o.raster) parts.push(`<image href="${o.raster}" width="${d.w}" height="${d.h}"${o.mirror ? ` transform="matrix(-1 0 0 1 ${d.w} 0)"` : ""}/>`);
  if (st.fill && d.fill.length) {
    const tris = function* (): Generator<string> {
      for (let i = 0; i < d.fill.length; i += 6) yield `M${X(d.fill[i]!)} ${Y(d.fill[i + 1]!)}L${X(d.fill[i + 2]!)} ${Y(d.fill[i + 3]!)}L${X(d.fill[i + 4]!)} ${Y(d.fill[i + 5]!)}Z`;
    };
    parts.push(`<g id="fill">${chunkedPaths(tris(), ` fill="${st.fill}" stroke="none"`)}</g>`);
  }
  const polylines = function* (gr: InkGroup): Generator<string> {
    let from = 0;
    for (const end of gr.ends) {
      let one = `M${X(gr.pts[from * 2]!)} ${Y(gr.pts[from * 2 + 1]!)}`;
      for (let j = from + 1; j < end; j++) one += `L${X(gr.pts[j * 2]!)} ${Y(gr.pts[j * 2 + 1]!)}`;
      yield one;
      from = end;
    }
  };
  const group = (role: InkRole, id: string): void => {
    const gs = d.groups.filter((g) => g.role === role);
    if (!gs.length) return;
    const dash = role === "hidden" ? ` opacity="${n2(st.hiddenOpacity)}" stroke-dasharray="${n2(st.hiddenDash)} ${n2(st.hiddenDash * 0.65)}"` : "";
    parts.push(`<g id="${id}" fill="none" stroke="${colourOf(role, st)}" stroke-linecap="round" stroke-linejoin="round"${dash}>`);
    for (const g of gs) parts.push(chunkedPaths(polylines(g), ` stroke-width="${n2(g.width)}"${g.opacity < 1 ? ` opacity="${n2(g.opacity)}"` : ""}`, o.perPath));
    parts.push("</g>");
  };
  group("tone", "tones");
  if (d.dots.length) {
    const dots = function* (): Generator<string> {
      for (let i = 0; i < d.dots.length; i += 3) {
        const r = d.dots[i + 2]!;
        yield `M${X(d.dots[i]! - r)} ${Y(d.dots[i + 1]!)}a${n2(r)} ${n2(r)} 0 1 0 ${n2(2 * r)} 0a${n2(r)} ${n2(r)} 0 1 0 ${n2(-2 * r)} 0Z`;
      }
    };
    parts.push(`<g id="dots">${chunkedPaths(dots(), ` fill="${st.tone}" stroke="none"`)}</g>`);
  }
  group("hidden", "hidden-edges");
  group("crease", "creases");
  group("contour", "outline");
  parts.push("</svg>");
  return parts.join("");
}

/** Lines of one look (the picture method's traced lines) as a drawing. */
export function drawingOfLines(lines: readonly (readonly number[])[], w: number, h: number, width: number): Drawing {
  const pts: number[] = [], ends: number[] = [];
  for (const l of lines) {
    for (const v of l) pts.push(v);
    ends.push(pts.length / 2);
  }
  return { w, h, groups: lines.length ? [{ role: "contour", width, opacity: 1, pts: Float32Array.from(pts), ends: Uint32Array.from(ends) }] : [], dots: new Float32Array(), fill: new Float32Array() };
}

/** How many lines a drawing holds. */
export const lineCount = (d: Drawing): number => d.groups.reduce((n, g) => n + g.ends.length, 0) + d.dots.length / 3;
