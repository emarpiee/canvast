/**
 * Brush presets (ADR 0169): named brushes of the engine, kept for the whole library like the saved styles (the `meta` store, key
 * "brushes"), in groups and folders as the Brushes panel shows them. A preset's brush is the engine's own JSON; every bitmap in it (a
 * sampled tip, the dual brush's tip, a texture) is a stored tile that names its samples by their SHA-256, kept in `paintTiles` with the
 * painted tiles, so the list stays small however big the tips are. `BRUSH_SECTIONS` is the Brush Settings panel: one schema over the
 * engine's settings that builds the panel and reads and writes the brush.
 */
import type { Setting } from "../gen";
import { TOOLS, type ToolId, type Values } from "./tools";

export type Brush = Record<string, unknown>;

/** What picking a preset brings besides its tip and sections (the engine's `captures`). */
export interface Captures {
  /** Its size; off: the tool keeps its own. */
  readonly size: boolean;
  /** Its opacity, flow and pressure switches; off: the tool keeps its own. */
  readonly toolSettings: boolean;
}

export interface BrushPreset {
  readonly id: string;
  readonly name: string;
  /** The group it is listed under: "General", or the name of the file it was imported from. */
  readonly group: string;
  /** Folders inside the group, outermost first (an imported file's own). */
  readonly folder: readonly string[];
  readonly brush: Brush;
  readonly captures: Captures;
}

export const MAX_BRUSHES = 2000;
export const MAX_BRUSH_NAME = 60;
/** The most a brush's JSON may take (its bitmaps are stored outside it; previews are small). */
export const MAX_BRUSH_JSON = 64 * 1024;

const ID_RE = /^[0-9a-f]{32}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const name = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, MAX_BRUSH_NAME) : "");

/** A brush as stored (an engine brush, its bitmaps stored outside it), or null. The engine checks the rest when it is used. */
export function cleanBrush(v: unknown): Brush | null {
  if (!isObj(v)) return null;
  try {
    if (JSON.stringify(v).length > MAX_BRUSH_JSON) return null;
  } catch {
    return null;
  }
  return stored(v).every((t) => HASH_RE.test(String(t["key"]))) ? v : null;
}

/** What was stored (anything) as the list of presets: the sound ones, in order. */
export function cleanBrushes(raw: unknown): BrushPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: BrushPreset[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, MAX_BRUSHES) as unknown[]) {
    if (!isObj(r) || typeof r["id"] !== "string" || !ID_RE.test(r["id"]) || seen.has(r["id"]) || !name(r["name"])) continue;
    const brush = cleanBrush(r["brush"]);
    if (!brush) continue;
    const c = isObj(r["captures"]) ? r["captures"] : {};
    seen.add(r["id"]);
    out.push({
      id: r["id"],
      name: name(r["name"]),
      group: name(r["group"]) || "General",
      folder: Array.isArray(r["folder"]) ? r["folder"].slice(0, 8).map(name).filter(Boolean) : [],
      brush,
      captures: { size: c["size"] !== false, toolSettings: c["toolSettings"] !== false },
    });
  }
  return out;
}

/** The stored tiles of a brush (its tip, the dual brush's tip, its texture's pattern): `{ key, width, height, preview }`. */
function stored(b: Brush): Array<Record<string, unknown>> {
  const at = (v: unknown): Record<string, unknown> | null => (isObj(v) && isObj(v["stored"]) ? v["stored"] : null);
  const dual = isObj(b["dualBrush"]) ? b["dualBrush"]["tip"] : undefined;
  const tex = isObj(b["texture"]) ? b["texture"]["pattern"] : undefined;
  return [at(b["tip"]), at(dual), at(tex)].filter((t): t is Record<string, unknown> => t !== null);
}

/** Every bitmap the presets name (tips, dual tips, textures), once each, as stored (`{ key, width, height, preview }`): what a tip or a
 *  texture can be chosen from. */
export function presetBitmaps(ps: readonly BrushPreset[]): Array<Record<string, unknown>> {
  const seen = new Map<string, Record<string, unknown>>();
  for (const p of ps) for (const t of stored(p.brush)) if (!seen.has(String(t["key"]))) seen.set(String(t["key"]), t);
  return [...seen.values()];
}

/** The bitmaps a brush names (their hashes), with their sizes. */
export function tipsOf(b: Brush): Array<{ key: string; w: number; h: number }> {
  return stored(b).map((t) => ({ key: String(t["key"]), w: Number(t["width"]), h: Number(t["height"]) }));
}

/** The brush with each "#n" key (what the engine names the bitmaps it took out) replaced by that bitmap's hash. */
export function withKeys(b: Brush, hashes: readonly string[]): Brush {
  const copy = structuredClone(b);
  for (const t of stored(copy)) {
    const m = /^#(\d+)$/.exec(String(t["key"]));
    if (m) t["key"] = hashes[Number(m[1])];
  }
  return copy;
}

// ---- the tool's brush: the options bar's values over the brush of the picked preset -------------------------------------------------

/** The options bar's values that are the brush's own top-level settings, and how the bar shows them (per cent: ×100). */
const FLAT: ReadonlyArray<readonly [string, number]> = [["size", 1], ["hardness", 100], ["spacing", 100], ["opacity", 100], ["flow", 100], ["pressureSize", 1], ["pressureOpacity", 1]];
const TOOL_KEYS = new Set(["opacity", "flow", "pressureSize", "pressureOpacity"]);

/** The options bar's values a preset brings when picked over the tool's `current` values. */
export function pickedValues(p: BrushPreset, current: Values): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = { ...current };
  for (const [k, scale] of FLAT) {
    const v = p.brush[k];
    if ((k === "size" && !p.captures.size) || (TOOL_KEYS.has(k) && !p.captures.toolSettings) || v === undefined) continue;
    out[k] = typeof v === "number" ? Math.round(v * scale * 100) / 100 : v === true;
  }
  return out;
}

/**
 * The brush of a preset picked while `current` is the tool's brush (the engine's `picked_over`): Smoothing stays the tool's, a protected
 * texture keeps its pattern and scale, every section `current` pins (its `locks`) stays as it is, and the pins carry over.
 */
export function pickedBrush(preset: Brush, current: Brush): Brush {
  const out: Brush = { ...preset };
  const keep = (k: string): void => {
    if (current[k] === undefined) delete out[k]; // (the engine's default, as the tool has it)
    else out[k] = current[k];
  };
  const ct = current["texture"], pt = preset["texture"];
  if (current["protectTexture"] === true && isObj(ct) && ct["enabled"] === true && isObj(pt) && pt["enabled"] === true) {
    out["texture"] = { ...pt, pattern: ct["pattern"], scale: ct["scale"] };
    out["protectTexture"] = true;
  }
  keep("smoothing");
  const locks = isObj(current["locks"]) ? current["locks"] : {};
  for (const [lock, keys] of Object.entries(LOCKED)) if (locks[lock] === true) keys.forEach(keep);
  keep("locks");
  return out;
}

/** The engine's section locks and the brush settings each keeps. */
const LOCKED: Readonly<Record<string, readonly string[]>> = {
  shapeDynamics: ["shapeDynamics"], scattering: ["scattering"], texture: ["texture"], dualBrush: ["dualBrush"], colorDynamics: ["colorDynamics"],
  transfer: ["transfer"], pose: ["pose"], noise: ["noise"], wetEdges: ["wetEdges"], buildUp: ["buildUp", "buildUpRate"], protectTexture: ["protectTexture"],
};
/** The lock of a Brush Settings section (its switch's first key), or undefined when picking a preset never changes it or always does. */
export function lockOf(sec: BrushSection): string | undefined {
  const k = sec.on?.split(".")[0];
  return k && k in LOCKED ? k : undefined;
}

/** The brush a tool paints with, as the engine reads it: the tool's brush, its options bar's values, the colour, and whether it erases. */
export function brushOf(tool: ToolId, v: Values, brush: Brush, colour: string): Brush {
  const out: Brush = { ...brush };
  for (const [k, scale] of FLAT) if (k in v) out[k] = typeof v[k] === "number" ? Number(v[k]) / scale : v[k] === true; // (a tool without an option keeps its brush's)
  if ("aliased" in TOOLS[tool].action) out["aliased"] = true;
  out["color"] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16) / 255).concat(1);
  out["erase"] = TOOLS[tool].action.erase;
  return out;
}

// ---- Brush Settings: one schema over the engine's settings ------------------------------------------------------------------------

/** A setting of the panel: `k` is the path in the engine's brush ("shapeDynamics.size.jitter"); a number is shown × `scale`. */
export type BrushSetting = Setting & { readonly scale?: number };

export interface BrushSection {
  readonly title: string;
  /** The switch that turns the whole section on ("shapeDynamics.enabled"), shown in its heading. */
  readonly on?: string;
  /** A picture it is made from, chosen from the presets' bitmaps (or the engine's procedural patterns): the brush's path to it. */
  readonly pick?: "tip" | "texture.pattern";
  readonly items: readonly BrushSetting[];
}

const pct = (k: string, label: string, max = 100, min = 0): BrushSetting => ({ k, label, t: "range", min, max, step: 1, def: 0, scale: 100 });
const num = (k: string, label: string, min: number, max: number, step = 1): BrushSetting => ({ k, label, t: "range", min, max, step, def: min });
const tog = (k: string, label: string): BrushSetting => ({ k, label, t: "toggle", def: false });
const CONTROLS: ReadonlyArray<readonly [string, string]> = [["off", "Off"], ["fade", "Fade"], ["penPressure", "Pressure"], ["penTilt", "Tilt"], ["stylusWheel", "Wheel"], ["rotation", "Rotation"]];
const ANGLE_CONTROLS = [...CONTROLS, ["initialDirection", "First direction"], ["direction", "Direction"]] as const;
const MASK_MODES: ReadonlyArray<readonly [string, string]> = [["multiply", "Multiply"], ["subtract", "Subtract"], ["darken", "Darken"], ["overlay", "Overlay"], ["colorDodge", "Colour dodge"], ["colorBurn", "Colour burn"], ["linearBurn", "Linear burn"], ["hardMix", "Hard mix"], ["linearHeight", "Linear height"], ["height", "Height"]];
/** The engine's brush blend modes (its names), Photoshop's menu order. */
const BRUSH_MODES: ReadonlyArray<readonly [string, string]> = ["Normal", "Dissolve", "Darken", "Multiply", "ColorBurn", "LinearBurn", "DarkerColor", "Lighten", "Screen", "ColorDodge", "LinearDodge", "LighterColor", "Overlay", "SoftLight", "HardLight", "VividLight", "LinearLight", "PinLight", "HardMix", "Difference", "Exclusion", "Subtract", "Divide", "Hue", "Saturation", "Color", "Luminosity"].map((m) => [m, m.replace(/(?<=.)([A-Z])/g, " $1").replace("Color", "Colour").replace(/ ([A-Z])/g, (_, c: string) => ` ${c.toLowerCase()}`)] as const);
/** The engine's procedural texture patterns. */
export const PATTERN_STYLES: ReadonlyArray<readonly [string, string]> = [["noise", "Noise"], ["canvas", "Canvas"], ["paper", "Paper"], ["dots", "Dots"]];
/** A dynamic setting of the engine: its jitter, what controls it, and (when it has one) the least it may go down to. */
const dyn = (k: string, label: string, opts: { min?: string; controls?: ReadonlyArray<readonly [string, string]>; max?: number } = {}): BrushSetting[] => [
  pct(`${k}.jitter`, `${label} jitter`, opts.max ?? 100),
  { k: `${k}.control`, label: `${label} control`, t: "choice", opts: opts.controls ?? CONTROLS, def: "off" },
  ...(opts.min ? [pct(`${k}.minimum`, opts.min)] : []),
];

export const BRUSH_SECTIONS: readonly BrushSection[] = [
  { title: "Tip", pick: "tip", items: [{ k: "mode", label: "Mode", t: "choice", opts: BRUSH_MODES, def: "Normal" }, num("size", "Size", 1, 1000), pct("hardness", "Hardness"), pct("spacing", "Spacing", 1000, 1), tog("spacingEnabled", "Spacing on"), num("angle", "Angle", -180, 180), pct("roundness", "Roundness"), tog("flipX", "Flip X"), tog("flipY", "Flip Y")] },
  { title: "Shape dynamics", on: "shapeDynamics.enabled", items: [...dyn("shapeDynamics.size", "Size", { min: "Minimum size" }), pct("shapeDynamics.tiltScale", "Tilt scale", 200), ...dyn("shapeDynamics.angle", "Angle", { controls: ANGLE_CONTROLS }), ...dyn("shapeDynamics.roundness", "Roundness", { min: "Minimum roundness" }), tog("shapeDynamics.flipXJitter", "Flip X jitter"), tog("shapeDynamics.flipYJitter", "Flip Y jitter"), tog("shapeDynamics.brushProjection", "Brush projection")] },
  { title: "Scattering", on: "scattering.enabled", items: [...dyn("scattering.scatter", "Scatter", { max: 1000 }), tog("scattering.bothAxes", "Both axes"), num("scattering.count", "Count", 1, 16), ...dyn("scattering.countJitter", "Count")] },
  { title: "Texture", on: "texture.enabled", pick: "texture.pattern", items: [pct("texture.scale", "Scale", 1000, 1), pct("texture.brightness", "Brightness", 100, -100), pct("texture.contrast", "Contrast", 100, -100), tog("texture.invert", "Invert"), tog("texture.eachTip", "Each tip"), { k: "texture.mode", label: "Mode", t: "choice", opts: MASK_MODES, def: "multiply" }, pct("texture.depth", "Depth"), ...dyn("texture.depthJitter", "Depth", { min: "Minimum depth" })] },
  { title: "Dual brush", on: "dualBrush.enabled", items: [{ k: "dualBrush.mode", label: "Mode", t: "choice", opts: MASK_MODES, def: "multiply" }, num("dualBrush.size", "Size", 1, 1000), pct("dualBrush.hardness", "Hardness"), pct("dualBrush.roundness", "Roundness"), num("dualBrush.angle", "Angle", -180, 180), pct("dualBrush.spacing", "Spacing", 1000, 1), pct("dualBrush.scatter", "Scatter", 1000), tog("dualBrush.bothAxes", "Both axes"), num("dualBrush.count", "Count", 1, 16), tog("dualBrush.flip", "Flip")] },
  { title: "Colour dynamics", on: "colorDynamics.enabled", items: [tog("colorDynamics.perTip", "Each tip"), ...dyn("colorDynamics.fgBg", "Colour to white"), pct("colorDynamics.hueJitter", "Hue jitter"), pct("colorDynamics.saturationJitter", "Saturation jitter"), pct("colorDynamics.brightnessJitter", "Brightness jitter"), pct("colorDynamics.purity", "Purity", 100, -100)] },
  { title: "Transfer", on: "transfer.enabled", items: [...dyn("transfer.opacity", "Opacity", { min: "Minimum opacity" }), ...dyn("transfer.flow", "Flow", { min: "Minimum flow" })] },
  { title: "Pose", on: "pose.enabled", items: [num("pose.tiltX", "Tilt X", -90, 90), num("pose.tiltY", "Tilt Y", -90, 90), num("pose.rotation", "Rotation", 0, 360), pct("pose.pressure", "Pressure"), tog("pose.overrideTilt", "Override tilt"), tog("pose.overrideRotation", "Override rotation"), tog("pose.overridePressure", "Override pressure")] },
  { title: "Noise", on: "noise", items: [] },
  { title: "Wet edges", on: "wetEdges", items: [] },
  { title: "Build-up", on: "buildUp", items: [num("buildUpRate", "Rate (per second)", 1, 100)] },
  { title: "Smoothing", on: "smoothing.enabled", items: [pct("smoothing.amount", "Amount"), tog("smoothing.pulledString", "Pulled string"), tog("smoothing.catchUp", "Catch up"), tog("smoothing.catchUpOnEnd", "Catch up at the end")] },
];

/** The value at a path of a brush, or undefined. */
export function getPath(b: Brush, path: string): unknown {
  let v: unknown = b;
  for (const p of path.split(".")) v = isObj(v) ? v[p] : undefined;
  return v;
}

/** A copy of the brush with the value at a path (the objects on the way made as needed; the engine fills what they leave out). */
export function setPath(b: Brush, path: string, value: unknown): Brush {
  const [head, ...rest] = path.split(".");
  if (!rest.length) return { ...b, [head!]: value };
  return { ...b, [head!]: setPath(isObj(b[head!]) ? (b[head!] as Brush) : {}, rest.join("."), value) };
}

/** A setting's value as the panel shows it (× its scale, rounded), from the brush; undefined when the brush has no such setting. */
export function shown(s: BrushSetting, b: Brush): number | string | boolean | undefined {
  const v = getPath(b, s.k);
  if (s.t === "range") return typeof v === "number" ? Math.round(v * (s.scale ?? 1) * 100) / 100 : undefined;
  if (s.t === "toggle") return typeof v === "boolean" ? v : undefined;
  return typeof v === "string" ? v : undefined;
}

/** The engine's value for what the panel shows. */
export const engineValue = (s: BrushSetting, v: number | string | boolean): unknown => (s.t === "range" ? Number(v) / (s.scale ?? 1) : v);

/** Whether a path is one of the options bar's values (kept with the tool, not in its brush). */
export const isFlat = (path: string): boolean => FLAT.some(([k]) => k === path);
export const flatScale = (path: string): number => FLAT.find(([k]) => k === path)?.[1] ?? 1;
