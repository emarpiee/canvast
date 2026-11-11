/**
 * The names and sizes of exported files, as plain functions (the Export dialog, presets and tests use them): file names from a name pattern
 * (`doc/name-pattern.ts`, the same rule as the Library's Rename) with Export's own tokens ({w} {h} {canvas} {format}), cleaned by the shared
 * file-name rules and never two alike; the size of each of several things by a rule; and the extra versions of each file (2×, 3×, SVG).
 */
import { cleanName, freeNameIn } from "../doc/file-names";
import { fillPattern } from "../doc/name-pattern";

/** Export's own tokens, beside the shared ones of every name pattern. */
export const EXPORT_TOKENS: ReadonlyArray<{ token: string; what: string }> = [
  { token: "{w}", what: "its width in px" },
  { token: "{h}", what: "its height in px" },
  { token: "{canvas}", what: "the canvas's name" },
  { token: "{format}", what: "png, pdf …" },
];
/** What a name pattern is when none is chosen. */
export const DEFAULT_PATTERN = "{name}";
/** Name patterns offered before any is saved. */
export const BUILT_IN_PATTERNS: readonly string[] = ["{name}", "###-{name}", "{name}-{w}x{h}", "{canvas}-###", "{name}-{date:YYYYMMDD}"];
export const MAX_PATTERN = 120;

/** A name pattern from stored data (a saved style of the kind "exportname", a setting), or null. */
export function cleanNamePattern(d: unknown): { pattern: string } | null {
  const p = typeof d === "string" ? d : (d as { pattern?: unknown } | null)?.pattern;
  if (typeof p !== "string") return null;
  const t = p.trim().slice(0, MAX_PATTERN);
  return t ? { pattern: t } : null;
}

export interface NameParts {
  readonly name: string;
  /** Its number (`#`): its place among the files plus the first number, less one. */
  readonly n: number;
  readonly w: number;
  readonly h: number;
  readonly canvas: string;
  readonly format: string;
  /** What `{date}` is. */
  readonly date: Date;
}

/** A name without the extension of the file it came from ("pumpkin.svg" → "pumpkin"), so {name} never carries two extensions. */
export const withoutExtension = (name: string): string => name.replace(/\.[a-z0-9]{1,5}$/i, "") || name;

/** The pattern filled in and made a valid file name by the shared rules (no extension); an empty result falls back to the item's name. */
export function nameFrom(pattern: string, p: NameParts): string {
  const filled = fillPattern(pattern || DEFAULT_PATTERN, { name: withoutExtension(p.name), number: p.n, date: p.date, values: { w: String(p.w), h: String(p.h), canvas: p.canvas, format: p.format } });
  return cleanName(filled, "kept", cleanName(withoutExtension(p.name), "kept", "export"));
}

/** These file names made all different, case aside (a second "skull.png" becomes "skull-2.png"), in the order given. */
export function uniqueNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((n) => freeNameIn(taken, n));
}

/** How each of several things is sized: all as wide, as tall, the same longest side, or a scale of its size on the canvas. */
export type SizeRule = "width" | "height" | "long" | "scale";
export const SIZE_RULES: ReadonlyArray<readonly [SizeRule, string, string]> = [
  ["width", "Same width", "Each as wide as this; its height from its own shape"],
  ["height", "Same height", "Each as tall as this; its width from its own shape"],
  ["long", "Longest side", "Each one's longer side this long"],
  ["scale", "Scale", "Each at this many times its size on the canvas: big things stay bigger"],
];
export const cleanSizeRule = (v: unknown): SizeRule => (v === "height" || v === "long" || v === "scale" ? v : "width");

/** The pixels of a thing of shape `ratio` (width ÷ height) by a rule: `v` is the width, height or longest side, or the scale with `world` its size on the canvas. */
export function sizeByRule(rule: SizeRule, v: number, ratio: number, world?: { w: number; h: number } | null): { w: number; h: number } {
  const r = ratio > 0 && Number.isFinite(ratio) ? ratio : 1;
  if (rule === "scale" && world && world.w > 0 && world.h > 0) return { w: world.w * v, h: world.h * v };
  if (rule === "height") return { w: v * r, h: v };
  if (rule === "long") return r >= 1 ? { w: v, h: v / r } : { w: v * r, h: v };
  return { w: v, h: v / r };
}

/** The extra versions of each file: bigger copies (named @2x, @3x) and, for vectors, an SVG. */
export type Variant = "2x" | "3x" | "svg";
export const VARIANTS: ReadonlyArray<readonly [Variant, string, string]> = [
  ["2x", "@2x", "A copy twice as big, named …@2x"],
  ["3x", "@3x", "A copy three times as big, named …@3x"],
  ["svg", "SVG", "The vectors as an SVG beside each picture"],
];
export const cleanVariants = (v: unknown): Variant[] => (Array.isArray(v) ? VARIANTS.map(([k]) => k).filter((k) => v.includes(k)) : []);
/** A variant's scale (1 for the SVG, which is the same size). */
export const variantScale = (v: Variant): number => (v === "2x" ? 2 : v === "3x" ? 3 : 1);
/** The name of a variant's file: the stem with its suffix, and its own extension. */
export const variantName = (stem: string, v: Variant, ext: string): string => (v === "svg" ? `${stem}.svg` : `${stem}@${v}.${ext}`);
