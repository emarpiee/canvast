import { extOf } from "./file-kind";
import { FILE_CARD_H, FILE_CARD_W, makeFileCard } from "./card";

/** Triangles as a flat list of x,y,z (nine numbers each). */
export function parseModel(bytes: Uint8Array, ext: string): Float32Array | null {
  const MAX = 400_000; // triangles kept for the preview; the file itself is stored whole
  if (ext === "obj") {
    const v: number[] = [];
    const t: number[] = [];
    for (const line of new TextDecoder().decode(bytes).split("\n")) {
      const p = line.trim().split(/\s+/);
      if (p[0] === "v") v.push(+p[1]!, +p[2]!, +p[3]!);
      else if (p[0] === "f" && p.length >= 4) {
        const ix = p.slice(1).map((s) => {
          const n = parseInt(s, 10);
          return (n < 0 ? v.length / 3 + n : n - 1) * 3;
        });
        for (let i = 1; i + 1 < ix.length && t.length < MAX * 9; i++) for (const k of [ix[0]!, ix[i]!, ix[i + 1]!]) t.push(v[k]!, v[k + 1]!, v[k + 2]!);
      }
    }
    return t.length && t.every(Number.isFinite) ? new Float32Array(t) : null;
  }
  if (ext !== "stl") return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  if (n > 0 && 84 + n * 50 === bytes.byteLength) {
    const out = new Float32Array(Math.min(n, MAX) * 9);
    for (let i = 0; i < out.length / 9; i++) for (let j = 0; j < 9; j++) out[i * 9 + j] = dv.getFloat32(84 + i * 50 + 12 + j * 4, true);
    return out.every(Number.isFinite) ? out : null;
  }
  const t: number[] = [];
  for (const m of new TextDecoder().decode(bytes).matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) t.push(+m[1]!, +m[2]!, +m[3]!);
  t.length = Math.min(t.length - (t.length % 9), MAX * 9);
  return t.length && t.every(Number.isFinite) ? new Float32Array(t) : null;
}

/** The model seen from a fixed three-quarter view, flat-shaded, far triangles first. */
function drawModel(x: CanvasRenderingContext2D, tri: Float32Array, W: number, H: number): void {
  const ca = Math.cos(0.6), sa = Math.sin(0.6), cb = Math.cos(0.5), sb = Math.sin(0.5);
  const n = tri.length / 3;
  const p = new Float32Array(tri.length); // x, y on screen, depth
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  const c = [0, 0, 0];
  for (let i = 0; i < tri.length; i++) c[i % 3]! += tri[i]! / n;
  for (let i = 0; i < n; i++) {
    const X = tri[i * 3]! - c[0]!, Y = tri[i * 3 + 1]! - c[1]!, Z = tri[i * 3 + 2]! - c[2]!;
    const x1 = X * ca + Y * sa, y1 = -X * sa + Y * ca;
    const px = x1, py = Z * cb - y1 * sb, pz = Z * sb + y1 * cb;
    p[i * 3] = px; p[i * 3 + 1] = py; p[i * 3 + 2] = pz;
    lo = [Math.min(lo[0]!, px), Math.min(lo[1]!, py)];
    hi = [Math.max(hi[0]!, px), Math.max(hi[1]!, py)];
  }
  const k = Math.min((W * 0.7) / (hi[0]! - lo[0]! || 1), (H * 0.6) / (hi[1]! - lo[1]! || 1));
  const ox = W / 2 - ((lo[0]! + hi[0]!) / 2) * k, oy = H * 0.46 + ((lo[1]! + hi[1]!) / 2) * k;
  const order = Array.from({ length: n / 3 }, (_, i) => i).sort((a, b) => (p[a * 9 + 2]! + p[a * 9 + 5]! + p[a * 9 + 8]!) - (p[b * 9 + 2]! + p[b * 9 + 5]! + p[b * 9 + 8]!));
  for (const t of order.length > 20000 ? order.filter((_, i) => i % Math.ceil(order.length / 20000) === 0) : order) {
    const b = t * 9;
    const ux = p[b + 3]! - p[b]!, uy = p[b + 4]! - p[b + 1]!, uz = p[b + 5]! - p[b + 2]!;
    const vx = p[b + 6]! - p[b]!, vy = p[b + 7]! - p[b + 1]!, vz = p[b + 8]! - p[b + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    const lit = 0.35 + 0.6 * Math.abs((nx * -0.3 + ny * -0.5 + nz * 0.8) / l);
    x.fillStyle = x.strokeStyle = `oklch(${(0.35 + lit * 0.5).toFixed(3)} 0 0)`;
    x.beginPath();
    x.moveTo(ox + p[b]! * k, oy - p[b + 1]! * k);
    x.lineTo(ox + p[b + 3]! * k, oy - p[b + 4]! * k);
    x.lineTo(ox + p[b + 6]! * k, oy - p[b + 7]! * k);
    x.closePath();
    x.fill();
    x.stroke();
  }
}

/** Page count of a PDF, by counting page objects (an unusual file may say nothing: null). */
export function pdfPages(bytes: Uint8Array): number | null {
  const n = new TextDecoder("latin1").decode(bytes).match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  return n > 0 ? n : null;
}

/** The card of a file, with what can be drawn from its bytes: a 3D model's shape, a PDF's page count. Never fails: the plain card is the fallback. */
export async function makeFileCardFrom(name: string, chip: string, bytes: Uint8Array): Promise<ImageBitmap> {
  const card = await makeFileCard(chip);
  const ext = extOf(name);
  try {
    const tri = parseModel(bytes, ext);
    const pages = ext === "pdf" ? pdfPages(bytes) : null;
    if (!tri && pages === null) return card;
    const c = document.createElement("canvas");
    c.width = FILE_CARD_W;
    c.height = FILE_CARD_H;
    const x = c.getContext("2d")!;
    if (tri) {
      x.fillStyle = "oklch(0.3 0 0)";
      x.fillRect(0, 0, c.width, c.height);
      x.lineJoin = "round";
      x.lineWidth = 0.6;
      drawModel(x, tri, c.width, c.height);
      x.fillStyle = "oklch(0.8 0 0)";
      x.font = "14px system-ui, sans-serif";
      x.textAlign = "center";
      x.fillText(`${chip} · ${(tri.length / 9).toLocaleString("en")} triangles`, c.width / 2, c.height - 16);
    } else {
      x.drawImage(card, 0, 0);
      x.fillStyle = "oklch(0.8 0 0)";
      x.font = "14px system-ui, sans-serif";
      x.textAlign = "center";
      x.fillText(`${pages} page${pages === 1 ? "" : "s"}`, c.width / 2, c.height - 16);
    }
    card.close();
    return await createImageBitmap(c);
  } catch {
    return card;
  }
}
