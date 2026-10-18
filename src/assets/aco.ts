/**
 * Adobe colour swatches, `.aco` (ADR 0133): a version-1 list (colour space and four 16-bit values per colour), then usually a version-2
 * list of the same colours with their names. RGB, HSB, CMYK, Lab and Gray are read (the others skipped); the names come from version 2.
 * Pure.
 */
import { labToRgb, rgbHex } from "./ase";
import { MAX_PALETTE } from "./gpl";
import type { PaletteColour } from "./gpl";

const hsbToRgb = (h: number, s: number, v: number): [number, number, number] => {
  const f = (n: number): number => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
};

function colourOf(space: number, w: readonly number[]): string | null {
  const [a = 0, b = 0, c = 0, d = 0] = w;
  if (space === 0) return rgbHex(a / 65535, b / 65535, c / 65535);
  if (space === 1) return rgbHex(...hsbToRgb(a / 65535, b / 65535, c / 65535));
  if (space === 2) return rgbHex((1 - (65535 - a) / 65535) * (1 - (65535 - d) / 65535), (1 - (65535 - b) / 65535) * (1 - (65535 - d) / 65535), (1 - (65535 - c) / 65535) * (1 - (65535 - d) / 65535));
  if (space === 7) return rgbHex(...labToRgb(a / 100, ((b << 16) >> 16) / 100, ((c << 16) >> 16) / 100));
  if (space === 8) return rgbHex(a / 10000, a / 10000, a / 10000);
  return null;
}

export function parseAco(bytes: Uint8Array, fallbackName = "Palette"): { name: string; colours: PaletteColour[] } | null {
  if (bytes.length < 4) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint16(0) !== 1 && v.getUint16(0) !== 2) return null;
  const read = (at: number, version: number): { colours: PaletteColour[]; end: number } | null => {
    if (at + 4 > bytes.length || v.getUint16(at) !== version) return null;
    const n = v.getUint16(at + 2);
    let p = at + 4;
    const colours: PaletteColour[] = [];
    for (let i = 0; i < n; i++) {
      if (p + 10 > bytes.length) return null;
      const c = colourOf(v.getUint16(p), [v.getUint16(p + 2), v.getUint16(p + 4), v.getUint16(p + 6), v.getUint16(p + 8)]);
      p += 10;
      let name = "";
      if (version === 2) {
        if (p + 4 > bytes.length) return null;
        const chars = v.getUint16(p + 2);
        p += 4;
        if (p + 2 * chars > bytes.length) return null;
        for (let k = 0; k < chars; k++) {
          const ch = v.getUint16(p + 2 * k);
          if (ch) name += String.fromCharCode(ch);
        }
        p += 2 * chars;
      }
      if (c) colours.push({ c, ...(name ? { name: name.slice(0, 40) } : {}) });
    }
    return { colours, end: p };
  };
  const first = read(0, 1);
  if (!first) return null;
  const second = read(first.end, 2);
  const colours = (second && second.colours.length ? second.colours : first.colours).slice(0, MAX_PALETTE);
  return colours.length ? { name: fallbackName, colours } : null;
}

export function serializeAco(colours: readonly PaletteColour[]): Uint8Array {
  const u16 = (n: number): number[] => [(n >> 8) & 255, n & 255];
  const body = (version: number): number[] => [
    ...u16(version),
    ...u16(colours.length),
    ...colours.flatMap((c) => {
      const n = parseInt(c.c.slice(1, 7), 16);
      const v = [0, ...[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x * 257), 0];
      const name = version === 2 ? [...u16(0), ...u16((c.name || c.c.slice(0, 7).toUpperCase()).length + 1), ...[...(c.name || c.c.slice(0, 7).toUpperCase())].flatMap((ch) => u16(ch.charCodeAt(0))), 0, 0] : [];
      return [...v.flatMap(u16), ...name];
    }),
  ];
  return Uint8Array.from([...body(1), ...body(2)]);
}
