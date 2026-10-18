/**
 * Adobe Swatch Exchange, `.ase` (ADR 0133): "ASEF", a version, a count, and blocks: a group start (0xC001) names a palette, a colour
 * entry (0x0001) has a name and a colour in RGB, CMYK, Lab or Gray (floats, big endian), a group end (0xC002) closes it. Colours that are
 * not RGB are converted to sRGB (CMYK the plain way, Lab by D50 to sRGB). Pure.
 */
import { MAX_PALETTE } from "./gpl";
import type { PaletteColour } from "./gpl";

const hex = (v: number): string => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, "0");
export const rgbHex = (r: number, g: number, b: number): string => `#${hex(r)}${hex(g)}${hex(b)}`;

/** CIE Lab (D50, L 0 to 100) to sRGB, each channel 0 to 1. */
export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t: number): number => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const X = 0.9642 * inv(fx), Y = inv(fy), Z = 0.8249 * inv(fz); // D50 white
  const lin = [3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z, -0.9787684 * X + 1.9161415 * Y + 0.033454 * Z, 0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z];
  const enc = (c: number): number => Math.max(0, Math.min(1, c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055));
  return [enc(lin[0]!), enc(lin[1]!), enc(lin[2]!)];
}

const cmykToRgb = (c: number, m: number, y: number, k: number): [number, number, number] => [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];

const utf16 = (v: DataView, at: number, chars: number): string => {
  let s = "";
  for (let i = 0; i < chars; i++) {
    const c = v.getUint16(at + 2 * i);
    if (c) s += String.fromCharCode(c);
  }
  return s;
};

export function parseAse(bytes: Uint8Array, fallbackName = "Palette"): Array<{ name: string; colours: PaletteColour[] }> | null {
  if (bytes.length < 12 || String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) !== "ASEF") return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const blocks = v.getUint32(8);
  const groups: Array<{ name: string; colours: PaletteColour[] }> = [];
  let cur: { name: string; colours: PaletteColour[] } | null = null;
  const loose: PaletteColour[] = [];
  let p = 12;
  for (let b = 0; b < blocks && p + 6 <= bytes.length; b++) {
    const type = v.getUint16(p);
    const len = v.getUint32(p + 2);
    const at = p + 6;
    if (at + len > bytes.length) return null;
    if (type === 0xc001) {
      const n = v.getUint16(at);
      cur = { name: utf16(v, at + 2, n).slice(0, 60) || fallbackName, colours: [] };
      groups.push(cur);
    } else if (type === 0xc002) cur = null;
    else if (type === 0x0001) {
      const n = v.getUint16(at);
      const name = utf16(v, at + 2, n).slice(0, 40);
      const m = at + 2 + 2 * n;
      const model = String.fromCharCode(bytes[m]!, bytes[m + 1]!, bytes[m + 2]!, bytes[m + 3]!);
      const f = (i: number): number => v.getFloat32(m + 4 + 4 * i);
      let rgb: [number, number, number] | null = null;
      if (model === "RGB ") rgb = [f(0), f(1), f(2)];
      else if (model === "CMYK") rgb = cmykToRgb(f(0), f(1), f(2), f(3));
      else if (model === "LAB ") rgb = labToRgb(f(0) * 100, f(1), f(2));
      else if (model === "Gray") rgb = [f(0), f(0), f(0)];
      if (rgb) (cur?.colours ?? loose).push({ c: rgbHex(...rgb), ...(name ? { name } : {}) });
    }
    p = at + len;
  }
  if (loose.length) groups.unshift({ name: fallbackName, colours: loose });
  const out = groups.filter((g) => g.colours.length).map((g) => ({ name: g.name, colours: g.colours.slice(0, MAX_PALETTE) }));
  return out.length ? out : null;
}

export function serializeAse(name: string, colours: readonly PaletteColour[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const u16 = (n: number): number[] => [(n >> 8) & 255, n & 255];
  const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const str = (s: string): number[] => [...u16(s.length + 1), ...[...s].flatMap((c) => u16(c.charCodeAt(0))), 0, 0];
  const block = (type: number, body: number[]): void => void parts.push(Uint8Array.from([...u16(type), ...u32(body.length), ...body]));
  block(0xc001, str(name));
  for (const c of colours) {
    const n = parseInt(c.c.slice(1, 7), 16);
    const f = (x: number): number[] => [...new Uint8Array(new Float32Array([x / 255]).buffer).reverse()];
    block(0x0001, [...str(c.name || c.c.slice(0, 7).toUpperCase()), ...[..."RGB "].map((ch) => ch.charCodeAt(0)), ...f((n >> 16) & 255), ...f((n >> 8) & 255), ...f(n & 255), ...u16(2)]);
  }
  block(0xc002, []);
  const head = Uint8Array.from([0x41, 0x53, 0x45, 0x46, ...u16(1), ...u16(0), ...u32(colours.length + 2)]);
  const out = new Uint8Array(head.length + parts.reduce((m, x) => m + x.length, 0));
  out.set(head);
  let at = head.length;
  for (const x of parts) {
    out.set(x, at);
    at += x.length;
  }
  return out;
}
