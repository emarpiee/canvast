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

/**
 * What a tool does with the pointer: paint with the engine (erasing or not), move the view, or work on the layers that hold canvas objects
 * (vector-tools.ts).
 */
export type ToolAction = { readonly paint: true; readonly erase: boolean } | { readonly paint: false; readonly vector?: true };

export interface ToolDef {
  readonly label: string;
  /** A key of `ICONS` (ui/icons.ts). */
  readonly icon: string;
  /** The letter that picks it. */
  readonly key: string;
  readonly hint: string;
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
  brush: { label: "Brush", icon: "paintbrush", key: "B", hint: "Paint on the picked layer · [ ] size · Alt-click a colour · Shift-click a straight line", action: { paint: true, erase: false }, options: BRUSH },
  eraser: { label: "Eraser", icon: "eraser", key: "E", hint: "Take paint away from the picked layer · [ ] size", action: { paint: true, erase: true }, options: BRUSH },
  hand: { label: "Hand", icon: "hand", key: "H", hint: "Drag to move the view (Space held does it with any tool) · wheel to zoom", action: { paint: false }, options: [] },
  move: { label: "Move", icon: "moveTool", key: "V", hint: "Drag the picked shape, text or picture layer to move it, a handle to resize it (Shift keeps its proportions)", action: { paint: false, vector: true }, options: [] },
  shape: {
    label: "Shape", icon: "shapeTool", key: "U", hint: "Drag to draw a shape on a layer of its own (Shift: a square or circle)", action: { paint: false, vector: true },
    options: [
      { key: "shape", label: "Shape", kind: "choice", def: "rect", choices: [["rect", "Rectangle"], ["ellipse", "Ellipse"], ["polygon", "Polygon"], ["star", "Star"], ["line", "Line"]], hint: "The kind of shape" },
      { key: "sides", label: "Sides", kind: "number", min: 3, max: 24, step: 1, def: 6, hint: "Sides of a polygon", when: ["shape", "polygon"] },
      { key: "points", label: "Points", kind: "number", min: 3, max: 24, step: 1, def: 5, hint: "Points of a star", when: ["shape", "star"] },
      { key: "fill", label: "Fill", kind: "paint", def: "", none: "No fill", hint: "Fill: the paint colour, a colour, a gradient or a texture" },
      { key: "outline", label: "Outline", kind: "paint", def: "none", none: "No outline", hint: "Outline: the paint colour, a colour or a gradient" },
      { key: "width", label: "Width", kind: "number", min: 0, max: 500, step: 1, def: 4, unit: "px", hint: "Outline width in page pixels" },
    ],
  },
  text: { label: "Text", icon: "type", key: "T", hint: "Click to place a text on a layer of its own; click the picked text layer to change its words", action: { paint: false, vector: true }, options: [{ key: "size", label: "Size", kind: "number", min: 4, max: 2000, step: 1, def: 64, unit: "px", hint: "Text size in page pixels" }] },
  node: { label: "Edit nodes", icon: "nodeTool", key: "N", hint: "Drag a node or a handle of the picked shape layer · click its outline to add a node · Alt-click a node: smooth or corner · Delete removes the picked node", action: { paint: false, vector: true }, options: [] },
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

/** The tool a key picks, if any. */
export const toolForKey = (key: string): ToolId | undefined => TOOL_IDS.find((t) => TOOLS[t].key === key.toUpperCase());
