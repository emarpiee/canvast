/**
 * The choices of the Export dialog, and export presets (saved styles of the kind "export"): plain data and how it is checked, with nothing of the
 * page, so the library and the desktop app can read a preset too.
 */
import type { Background } from "./export-render";
import type { ShotFormat } from "./screenshot";
import { DPIS, MAX_SIDE, UNITS } from "./export-size";
import type { Unit } from "./export-size";

export type Format = ShotFormat | "svg" | "pdf";
export type Action = "download" | "copy" | "library";
export type PadUnit = "px" | "%";
export interface Prefs {
  unit: Unit;
  dpi: number;
  format: Format;
  quality: number;
  bg: Background;
  /** Room around what is exported, in px of the file or % of its longer side. */
  pad: number;
  padUnit: PadUnit;
  /** What Enter and Export again do. */
  action: Action;
}
export const DEFAULTS: Prefs = { unit: "px", dpi: 300, format: "png", quality: 92, bg: "transparent", pad: 0, padUnit: "px", action: "download" };
export const HEX = /^#[0-9a-f]{6}$/i;
export const cleanBg = (v: unknown): Background => (v === "white" || v === "black" || v === "transparent" ? v : typeof v === "string" && HEX.test(v) ? (v.toLowerCase() as Background) : DEFAULTS.bg);


export function loadPrefsFrom(raw: Partial<Record<keyof Prefs, unknown>>): Prefs {
  {
    return {
      unit: UNITS.includes(raw.unit as Unit) ? (raw.unit as Unit) : DEFAULTS.unit,
      dpi: DPIS.includes(Number(raw.dpi)) ? Number(raw.dpi) : DEFAULTS.dpi,
      format: raw.format === "png" || raw.format === "webp" || raw.format === "jpeg" || raw.format === "svg" || raw.format === "pdf" ? raw.format : DEFAULTS.format,
      quality: Math.min(100, Math.max(10, Number(raw.quality) || DEFAULTS.quality)),
      bg: cleanBg(raw.bg),
      pad: Math.min(1000, Math.max(0, Number(raw.pad) || 0)),
      padUnit: raw.padUnit === "%" ? "%" : "px",
      action: raw.action === "copy" || raw.action === "library" ? raw.action : "download",
    };
  }
}

/** What an export preset keeps (a saved style of the kind "export"): the choices, and a size as a width or as times its size on screen. */
export interface ExportPreset {
  readonly format: Format;
  readonly quality: number;
  readonly bg: Background;
  readonly unit: Unit;
  readonly dpi: number;
  readonly pad: number;
  readonly padUnit: PadUnit;
  readonly size: { readonly w: number } | { readonly k: number } | null;
}
/** An export preset from stored data, or null. */
export function cleanExportPreset(d: unknown): ExportPreset | null {
  const r = d as Partial<Record<keyof ExportPreset, unknown>> | null;
  if (!r || typeof r !== "object") return null;
  const p = loadPrefsFrom(r);
  const z = r.size as { w?: unknown; k?: unknown } | null | undefined;
  const size = z && Number(z.k) > 0 && Number(z.k) <= 16 ? { k: Number(z.k) } : z && Number(z.w) >= 1 && Number(z.w) <= MAX_SIDE ? { w: Math.round(Number(z.w)) } : null;
  return { format: p.format, quality: p.quality, bg: p.bg, unit: p.unit, dpi: p.dpi, pad: p.pad, padUnit: p.padUnit, size };
}
/** One line about a preset. */
export const exportPresetSummary = (p: ExportPreset): string =>
  [p.format.toUpperCase(), p.size ? ("k" in p.size ? `${p.size.k}× on screen` : `${p.size.w} px wide`) : "", p.pad ? `padding ${p.pad} ${p.padUnit}` : "", p.bg === "transparent" ? "" : p.bg].filter(Boolean).join(" · ");
