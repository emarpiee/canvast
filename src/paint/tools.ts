/**
 * The Painting view's tools (ADR 0165). Each tool is an entry: its name, icon, key, hint and its options as a schema. The schema builds
 * the options bar, checks a stored value, and, for the tools that paint, becomes the engine's brush (`brushOf` in brushes.ts), so a new tool or a new
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
export type ToolAction = { readonly paint: true; readonly erase: boolean; /** No anti-aliasing: every pixel is covered or not (the Pencil). */ readonly aliased?: true };

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
  { key: "spacing", label: "Spacing", kind: "number", min: 1, max: 1000, step: 1, def: 10, percent: true, hint: "Space between dabs, in per cent of the size" },
  { key: "pressureSize", label: "Pressure size", kind: "switch", def: true, hint: "A pen's pressure changes the size" },
  { key: "pressureOpacity", label: "Pressure opacity", kind: "switch", def: false, hint: "A pen's pressure changes the opacity" },
];

/** The Pencil's: the brush's without what an aliased tip has no use for (hardness, spacing), one pixel wide at first, and Auto erase. */
const PENCIL: readonly OptionSpec[] = [
  ...BRUSH.filter((o) => o.key !== "hardness" && o.key !== "spacing").map((o): OptionSpec => (o.key === "size" && o.kind === "number" ? { ...o, def: 1 } : o.key === "pressureSize" && o.kind === "switch" ? { ...o, def: false } : o)),
  { key: "autoErase", label: "Auto erase", kind: "switch", def: false, hint: "A stroke that starts on the paint colour erases instead" },
];

export const TOOLS = {
  brush: { label: "Brush", action: { paint: true, erase: false }, options: BRUSH },
  pencil: { label: "Pencil", action: { paint: true, erase: false, aliased: true }, options: PENCIL },
  eraser: { label: "Eraser", action: { paint: true, erase: true }, options: BRUSH },
} as const satisfies Record<string, ToolDef>;

export type ToolId = keyof typeof TOOLS;
export const TOOL_IDS = Object.keys(TOOLS) as ToolId[];

/**
 * The selection tools' options (the marquees, the lassos and the magic wand share them; `wand` ones are the wand's alone). The mode is how
 * a new selection joins the one there is; Shift (add), Alt (take away) and both (intersect) at the press choose one for that press.
 */
export const SELECT_OPTIONS: ReadonlyArray<OptionSpec & { readonly wand?: true }> = [
  { key: "mode", label: "Mode", kind: "choice", def: "new", choices: [["new", "New"], ["add", "Add"], ["subtract", "Subtract"], ["intersect", "Intersect"]], hint: "How a new selection joins the one there is (at the press, Shift adds, Alt takes away, both intersect)" },
  { key: "feather", label: "Feather", kind: "number", min: 0, max: 250, step: 1, def: 0, unit: "px", hint: "Soften the new selection's edge over this many page pixels" },
  { key: "tolerance", label: "Tolerance", kind: "number", min: 0, max: 255, step: 1, def: 32, hint: "How far from the colour clicked a pixel may be and still be selected (0 to 255 on each channel)", wand: true },
  { key: "contiguous", label: "Contiguous", kind: "switch", def: true, hint: "Only the pixels joined to the one clicked; off: every such pixel on the page", wand: true },
  { key: "allLayers", label: "All layers", kind: "switch", def: false, hint: "Look at the page as it looks; off: at the picked layer alone", wand: true },
];

/** The fill bucket's options: what it fills is the region of about the colour clicked, as the magic wand finds it. */
export const FILL_OPTIONS: readonly OptionSpec[] = [
  { key: "tolerance", label: "Tolerance", kind: "number", min: 0, max: 255, step: 1, def: 32, hint: "How far from the colour clicked a pixel may be and still be filled (0 to 255 on each channel)" },
  { key: "contiguous", label: "Contiguous", kind: "switch", def: true, hint: "Only the pixels joined to the one clicked; off: every such pixel on the page" },
  { key: "allLayers", label: "All layers", kind: "switch", def: false, hint: "Find the region on the page as it looks; off: on the picked layer alone" },
  { key: "opacity", label: "Opacity", kind: "number", min: 1, max: 100, step: 1, def: 100, percent: true, hint: "How much the fill covers" },
];

/** The gradient tool's options: from the paint colour to clear, along the line dragged. */
export const GRADIENT_OPTIONS: readonly OptionSpec[] = [
  { key: "shape", label: "Shape", kind: "choice", def: "linear", choices: [["linear", "Linear"], ["radial", "Radial"], ["angle", "Angle"]], hint: "Along the line, round its start, or round its start by the angle" },
  { key: "reverse", label: "Reverse", kind: "switch", def: false, hint: "From clear to the paint colour" },
  { key: "opacity", label: "Opacity", kind: "number", min: 1, max: 100, step: 1, def: 100, percent: true, hint: "How much the gradient covers where it is strongest" },
];

/** A tool's values: what was stored, each checked against the schema (out of range, missing or of the wrong type: the default). */
export function valuesOf(tool: ToolId, stored: unknown): Record<string, number | boolean | string> {
  return valuesFor(TOOLS[tool].options, stored);
}

/** Values of any option schema (a painting tool's, the selection tools'), checked as `valuesOf` checks them. */
export function valuesFor(options: readonly OptionSpec[], stored: unknown): Record<string, number | boolean | string> {
  const raw = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const out: Record<string, number | boolean | string> = {};
  for (const o of options) {
    const v = raw[o.key];
    out[o.key] =
      o.kind === "number" ? (typeof v === "number" && Number.isFinite(v) ? Math.min(o.max, Math.max(o.min, v)) : o.def)
      : o.kind === "switch" ? (typeof v === "boolean" ? v : o.def)
      : o.kind === "choice" ? (o.choices.some(([c]) => c === v) ? (v as string) : o.def)
      : typeof v === "string" && v.length <= 20000 && (v === "" || paintFromText(v) !== undefined) ? v : o.def;
  }
  return out;
}
