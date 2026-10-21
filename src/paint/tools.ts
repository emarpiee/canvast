/**
 * The Painting view's tools (ADR 0165). Each tool is an entry: its name, icon, key, hint and its options as a schema. The schema builds
 * the options bar, checks a stored value, and, for the tools that paint, becomes the engine's brush (`brushOf`), so a new tool or a new
 * option is one entry here, not a new bar or a new reader.
 */
import { paintFromText } from "../doc/paint";

export type OptionSpec =
  | { readonly key: string; readonly label: string; readonly kind: "number"; readonly min: number; readonly max: number; readonly step: number; readonly def: number; readonly unit?: string; readonly hint: string; readonly percent?: true; /** Shown only when another option has this value. */ readonly when?: readonly [string, string] }
  | { readonly key: string; readonly label: string; readonly kind: "switch"; readonly def: boolean; readonly hint: string }
  | { readonly key: string; readonly label: string; readonly kind: "choice"; readonly def: string; readonly choices: ReadonlyArray<readonly [string, string]>; readonly hint: string }
  /** A paint (the canvas's: colour, gradient, texture), stored as text (doc/paint.ts paintToText); "" is the paint colour of the view, "none" none. */
  | { readonly key: string; readonly label: string; readonly kind: "paint"; readonly def: string; readonly none: string; readonly hint: string };

export type Values = Readonly<Record<string, number | boolean | string>>;

/** What a painting tool does with the pointer: paint with the engine, or erase. (Every other tool of the rail is the canvas's, ADR 0168.) */
export type ToolAction = { readonly paint: true; readonly erase: boolean };

export interface ToolDef {
  readonly label: string;
  readonly action: ToolAction;
  readonly options: readonly OptionSpec[];
}

/** The brush's options, the same for every tool that paints (each tool keeps its own values). */
const BRUSH: readonly OptionSpec[] = [
  { key: "size", label: "Size", kind: "number", min: 1, max: 1000, step: 1, def: 24, unit: "px", hint: "Brush diameter in page pixels ([ and ] change it)" },
  { key: "hardness", label: "Hard", kind: "number", min: 0, max: 100, step: 1, def: 80, percent: true, hint: "Hardness: 0 fades from the middle, 100 is a hard edge" },
  { key: "opacity", label: "Opacity", kind: "number", min: 1, max: 100, step: 1, def: 100, percent: true, hint: "The most one stroke covers, however often it passes over a place" },
  { key: "flow", label: "Flow", kind: "number", min: 1, max: 100, step: 1, def: 100, percent: true, hint: "How much each dab adds: a low flow builds up within the stroke's opacity" },
  { key: "spacing", label: "Spacing", kind: "number", min: 1, max: 200, step: 1, def: 10, percent: true, hint: "Space between dabs, in per cent of the size" },
  { key: "pressureSize", label: "Pressure size", kind: "switch", def: true, hint: "A pen's pressure changes the size" },
  { key: "pressureOpacity", label: "Pressure opacity", kind: "switch", def: false, hint: "A pen's pressure changes the opacity" },
];

export const TOOLS = {
  brush: { label: "Brush", action: { paint: true, erase: false }, options: BRUSH },
  eraser: { label: "Eraser", action: { paint: true, erase: true }, options: BRUSH },
} as const satisfies Record<string, ToolDef>;

export type ToolId = keyof typeof TOOLS;
export const TOOL_IDS = Object.keys(TOOLS) as ToolId[];

/** A tool's values: what was stored, each checked against the schema (out of range, missing or of the wrong type: the default). */
export function valuesOf(tool: ToolId, stored: unknown): Record<string, number | boolean | string> {
  const raw = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const out: Record<string, number | boolean | string> = {};
  for (const o of TOOLS[tool].options as readonly OptionSpec[]) {
    const v = raw[o.key];
    out[o.key] =
      o.kind === "number" ? (typeof v === "number" && Number.isFinite(v) ? Math.min(o.max, Math.max(o.min, v)) : o.def)
      : o.kind === "switch" ? (typeof v === "boolean" ? v : o.def)
      : o.kind === "choice" ? (o.choices.some(([c]) => c === v) ? (v as string) : o.def)
      : typeof v === "string" && v.length <= 20000 && (v === "" || paintFromText(v) !== undefined) ? v : o.def;
  }
  return out;
}

/** "#rrggbb" as the engine's colour (0..1). */
const rgb = (hex: string): [number, number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).concat(1) as [number, number, number, number];

/** The engine's brush (its JSON) for a painting tool's values and colour. */
export function brushOf(tool: ToolId, v: Values, colour: string): object {
  const a = TOOLS[tool].action;
  const pct = (k: string): number => Number(v[k]) / 100;
  return { size: Number(v["size"]), hardness: pct("hardness"), opacity: pct("opacity"), flow: pct("flow"), spacing: pct("spacing"), pressureSize: v["pressureSize"] === true, pressureOpacity: v["pressureOpacity"] === true, color: rgb(colour), erase: a.paint && a.erase };
}


