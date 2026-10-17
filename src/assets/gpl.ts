/**
 * GIMP palettes, `.gpl` (ADR 0122): "GIMP Palette", "Name: ...", optionally "Columns: n", "#" comments, then one colour a line:
 * red green blue (0 to 255) and an optional name. Krita and Inkscape read and write them too. Pure.
 */
export interface PaletteColour {
  readonly c: string;
  readonly name?: string | undefined;
}

export const MAX_PALETTE = 256;
const hex = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");

export function parseGpl(text: string, fallbackName = "Palette"): { name: string; colours: PaletteColour[] } | null {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "GIMP Palette") return null;
  let name = fallbackName;
  const colours: PaletteColour[] = [];
  for (const raw of lines.slice(1)) {
    const l = raw.trim();
    if (!l || l.startsWith("#")) continue;
    if (/^name\s*:/i.test(l)) name = l.slice(l.indexOf(":") + 1).trim() || fallbackName;
    else if (/^columns\s*:/i.test(l)) continue;
    else {
      const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+(.*))?$/.exec(l);
      if (!m) continue;
      const label = m[4]?.trim();
      if (colours.length < MAX_PALETTE) colours.push({ c: `#${hex(+m[1]!)}${hex(+m[2]!)}${hex(+m[3]!)}`, ...(label ? { name: label.slice(0, 40) } : {}) });
    }
  }
  return colours.length ? { name, colours } : null;
}

export function serializeGpl(name: string, colours: readonly PaletteColour[]): string {
  const rows = colours.map((p) => {
    const n = parseInt(p.c.slice(1, 7), 16);
    return `${String((n >> 16) & 255).padStart(3)} ${String((n >> 8) & 255).padStart(3)} ${String(n & 255).padStart(3)}\t${p.name || p.c.slice(0, 7).toUpperCase()}`;
  });
  return `GIMP Palette\nName: ${name.replace(/[\r\n]+/g, " ")}\nColumns: 8\n#\n${rows.join("\n")}\n`;
}
