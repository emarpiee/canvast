/**
 * Settings and their scopes (ADR 0017, engineering plan §14.40).
 *
 * Every setting is declared once, with its scope, a validated default and
 * when a change takes effect. Stored values are untrusted: anything that
 * fails its validator falls back to the default, so a damaged or hand-edited
 * value can never break the app.
 *
 *   device     this browser only; never exported, never shared. Stored in localStorage.
 *   workspace  shared by the whole workspace and included in its backups. Declared, no backend yet.
 *   board      overrides the workspace value for one board. Declared, no backend yet.
 *
 * Instance-specific state (a video's pause position, an image's adjustments)
 * is not a setting: it lives in the object itself.
 */
import { DOCK_PANEL_IDS } from "./panels";
import { paintFromText } from "../doc/paint";
import type { Tool } from "../app/editor-state";
import { SAMPLE_SIZES } from "../interaction/eyedropper";

export type Scope = "device" | "workspace" | "board";

export interface Def<T> {
  readonly scope: Scope;
  readonly default: T;
  /** The value if `v` is acceptable, otherwise undefined. */
  readonly validate: (v: unknown) => T | undefined;
  /** "restart": the value is read once at start-up. */
  readonly effect: "immediate" | "restart";
}

const oneOf = <T extends string>(...allowed: T[]) => (v: unknown): T | undefined => (allowed.includes(v as T) ? (v as T) : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const range = (lo: number, hi: number) => (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
const letter = (v: unknown): string | undefined => (typeof v === "string" && /^[a-z]$/.test(v) ? v : undefined);
const text = (max: number) => (v: unknown): string | undefined => (typeof v === "string" && v.length <= max ? v : undefined);
const colour = (v: unknown): string | undefined => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);

/** Up to eight "#rrggbb" colours, newest first, written as one comma-separated text. */
const colourList = (v: unknown): string | undefined => (typeof v === "string" && v.length <= 8 * 10 && (v === "" || v.split(",").every((c) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(c))) ? v : undefined);

/** A shape's fill or outline as text: "none", "#rrggbb" / "#rrggbbaa", or a gradient as JSON (doc/paint.ts). */
const paint = (v: unknown): string | undefined => (typeof v === "string" && v.length <= 4000 && paintFromText(v) !== undefined ? v : undefined);

/**
 * The memory tier (Phase 8, ADR 0155): how much decoded-picture memory a device gets by default, from the memory it says it has
 * (`navigator.deviceMemory` in GB, Chromium only; elsewhere the usual 384 MB). A phone with 2 GB or less starts at 128 MB, one with 4 GB at 256 MB.
 * Settings > Performance still changes it.
 */
export function decodedMbFor(gb: number | undefined): "128" | "256" | "384" {
  return gb !== undefined && gb <= 2 ? "128" : gb !== undefined && gb <= 4 ? "256" : "384";
}

export const SETTINGS = {
  "dev.tools": { scope: "device", default: false, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "restart" } as Def<boolean>,
  "storage.autoIndex": { scope: "device", default: true, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "ui.view": { scope: "device", default: "canvas", validate: oneOf("canvas", "assets", "paint"), effect: "restart" } as Def<"canvas" | "assets" | "paint">,
  "pen.color": { scope: "device", default: "#1f2329", validate: colour, effect: "immediate" } as Def<string>,
  // The colour picker (ADR 0098): which colour model and layout it opens in, and the colours picked lately.
  "colour.model": { scope: "device", default: "okhsv", validate: oneOf("okhsl", "okhsv", "okhcl"), effect: "immediate" } as Def<"okhsl" | "okhsv" | "okhcl">,
  "colour.view": { scope: "device", default: "wheel", validate: oneOf("wheel", "plane", "sliders", "mixer"), effect: "immediate" } as Def<"wheel" | "plane" | "sliders" | "mixer">,
  "colour.format": { scope: "device", default: "hex", validate: oneOf("hex", "rgb", "oklch"), effect: "immediate" } as Def<"hex" | "rgb" | "oklch">,
  "colour.recent": { scope: "device", default: "#1f2329,#2563eb,#dc2626,#16a34a", validate: colourList, effect: "immediate" } as Def<string>,
  // Shapes and paths (ADR 0099): what the Shape and Path tools make.
  "shape.kind": { scope: "device", default: "rect", validate: oneOf("rect", "ellipse", "line", "polygon", "star"), effect: "immediate" } as Def<"rect" | "ellipse" | "line" | "polygon" | "star">,
  "shape.fill": { scope: "device", default: "#2563eb", validate: paint, effect: "immediate" } as Def<string>,
  "shape.stroke": { scope: "device", default: "#1f2329", validate: paint, effect: "immediate" } as Def<string>,
  "shape.widthPx": { scope: "device", default: 2, validate: range(0.5, 128), effect: "immediate" } as Def<number>,
  "shape.join": { scope: "device", default: "default", validate: oneOf("default", "miter", "round", "bevel"), effect: "immediate" } as Def<"default" | "miter" | "round" | "bevel">,
  "shape.cap": { scope: "device", default: "round", validate: oneOf("butt", "round", "square"), effect: "immediate" } as Def<"butt" | "round" | "square">,
  "shape.dash": { scope: "device", default: "solid", validate: oneOf("solid", "dashed", "dotted"), effect: "immediate" } as Def<"solid" | "dashed" | "dotted">,
  "shape.initialPaint": { scope: "device", default: true, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "shape.lockRadius": { scope: "device", default: false, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "shape.align": { scope: "device", default: "centre", validate: oneOf("inside", "centre", "outside"), effect: "immediate" } as Def<"inside" | "centre" | "outside">,
  "shape.sides": { scope: "device", default: 6, validate: (v: unknown) => (Number.isInteger(v) && (v as number) >= 3 && (v as number) <= 24 ? (v as number) : undefined), effect: "immediate" } as Def<number>,
  "shape.tips": { scope: "device", default: 5, validate: (v: unknown) => (Number.isInteger(v) && (v as number) >= 3 && (v as number) <= 24 ? (v as number) : undefined), effect: "immediate" } as Def<number>,
  "key.shape": { scope: "device", default: "u", validate: letter, effect: "immediate" } as Def<string>,
  "key.sheet": { scope: "device", default: "c", validate: letter, effect: "immediate" } as Def<string>,
  "key.path": { scope: "device", default: "b", validate: letter, effect: "immediate" } as Def<string>,
  "key.node": { scope: "device", default: "n", validate: letter, effect: "immediate" } as Def<string>,
  "pen.kind": { scope: "device", default: "fine", validate: oneOf("fine", "pencil", "ink", "marker"), effect: "immediate" } as Def<"fine" | "pencil" | "ink" | "marker">,
  "pen.widthPx": { scope: "device", default: 3, validate: range(0.5, 128), effect: "immediate" } as Def<number>,
  "pen.stabilizer.on": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "pen.stabilizer.strength": { scope: "device", default: 50, validate: range(0, 100), effect: "immediate" } as Def<number>,
  "pen.followZoom": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "select.ignoreFilling": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "ui.info": { scope: "device", default: "simple", validate: oneOf("simple", "more", "technical", "hidden"), effect: "immediate" } as Def<"simple" | "more" | "technical" | "hidden">,
  "quality.auto": { scope: "device", default: true, validate: bool, effect: "immediate" } as Def<boolean>,
  "quality.level": { scope: "device", default: "full", validate: oneOf("full", "balanced", "fast"), effect: "immediate" } as Def<"full" | "balanced" | "fast">,
  "cache.decodedMb": { scope: "device", default: decodedMbFor(typeof navigator === "undefined" ? undefined : (navigator as { deviceMemory?: number }).deviceMemory), validate: oneOf("128", "256", "384", "768", "1536"), effect: "immediate" } as Def<"128" | "256" | "384" | "768" | "1536">,
  "panel.autoFold": { scope: "device", default: "off", validate: oneOf("off", "all", "latest"), effect: "immediate" } as Def<"off" | "all" | "latest">,
  "panel.keep": { scope: "device", default: 2, validate: range(1, DOCK_PANEL_IDS.length), effect: "immediate" } as Def<number>,
  "ui.dock": { scope: "device", default: "", validate: (v: unknown) => (typeof v === "string" && v.length <= 8000 ? v : undefined), effect: "immediate" } as Def<string>,
  "ui.stylesOpen": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "ui.tagsOpen": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "ui.bookmarksOpen": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "ui.layersOpen": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "select.alignBox": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "snap.enabled": { scope: "device", default: true, validate: bool, effect: "immediate" } as Def<boolean>,
  "eraser.diameterPx": { scope: "device", default: 16, validate: range(4, 128), effect: "immediate" } as Def<number>,
  "eraser.parts": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  // The Painting view (ADR 0165): the tool, each tool's options (checked against its schema when read, paint/tools.ts), the colour.
  "paint.tool": { scope: "device", default: "brush", validate: oneOf<Tool>("brush", "pencil", "eyedropper", "marquee", "marqueeEllipse", "lassoPoly", "wand", "fill", "gradient", "eraser", "hand", "select", "node", "pen", "shape", "path", "lasso", "text"), effect: "immediate" } as Def<Tool>,
  "paint.tools": { scope: "device", default: {}, validate: (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined), effect: "immediate" } as Def<Record<string, unknown>>,
  "paint.colour": { scope: "device", default: "#1f2329", validate: colour, effect: "immediate" } as Def<string>,
  "paint.symmetry": { scope: "device", default: "off", validate: oneOf("off", "vertical", "horizontal", "dual", "diagonal"), effect: "immediate" } as Def<"off" | "vertical" | "horizontal" | "dual" | "diagonal">,
  "paint.brushView": { scope: "device", default: "list", validate: oneOf("list", "grid"), effect: "immediate" } as Def<"list" | "grid">,
  "eraser.wholeGroups": { scope: "device", default: true, validate: bool, effect: "immediate" } as Def<boolean>,
  "media.volume": { scope: "device", default: 100, validate: (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100 ? (v as number) : undefined), effect: "immediate" } as Def<number>,
  "media.step.video": { scope: "device", default: 3, validate: range(0.1, 600), effect: "immediate" } as Def<number>,
  "media.step.audio": { scope: "device", default: 1, validate: range(0.1, 600), effect: "immediate" } as Def<number>,
  "media.step.gif": { scope: "device", default: 1, validate: (v: unknown) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 1000 ? (v as number) : undefined), effect: "immediate" } as Def<number>,
  "ui.theme": { scope: "device", default: "system", validate: oneOf("system", "light", "dark"), effect: "immediate" } as Def<"system" | "light" | "dark">,
  "key.hand": { scope: "device", default: "h", validate: letter, effect: "immediate" } as Def<string>,
  "key.select": { scope: "device", default: "v", validate: letter, effect: "immediate" } as Def<string>,
  "key.pen": { scope: "device", default: "p", validate: letter, effect: "immediate" } as Def<string>,
  "key.lasso": { scope: "device", default: "l", validate: letter, effect: "immediate" } as Def<string>,
  "key.text": { scope: "device", default: "t", validate: letter, effect: "immediate" } as Def<string>,
  "key.note": { scope: "device", default: "m", validate: letter, effect: "immediate" } as Def<string>,
  "key.eraser": { scope: "device", default: "e", validate: letter, effect: "immediate" } as Def<string>,
  // Stepping the selection between items (ADR 0058, 0072): W A S D by default.
  "key.navUp": { scope: "device", default: "w", validate: letter, effect: "immediate" } as Def<string>,
  "key.navLeft": { scope: "device", default: "a", validate: letter, effect: "immediate" } as Def<string>,
  "key.navDown": { scope: "device", default: "s", validate: letter, effect: "immediate" } as Def<string>,
  "key.navRight": { scope: "device", default: "d", validate: letter, effect: "immediate" } as Def<string>,
  "ui.hueAdaptive": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "ui.hue": { scope: "device", default: 178, validate: range(0, 360), effect: "immediate" } as Def<number>,
  "ui.vivid": { scope: "device", default: 100, validate: range(0, 150), effect: "immediate" } as Def<number>,
  "ui.pattern": { scope: "device", default: "grid", validate: oneOf("grid", "dots", "scale", "none"), effect: "immediate" } as Def<"grid" | "dots" | "scale" | "none">,
  /** The colour behind the canvas as #rrggbb; empty is the app's own (it follows the theme and the hue dials). */
  "ui.background": { scope: "device", default: "", validate: (v: unknown) => (typeof v === "string" && (v === "" || /^#[0-9a-f]{6}$/.test(v)) ? v : undefined), effect: "immediate" } as Def<string>,
  "ui.corners": { scope: "device", default: "round", validate: oneOf("round", "sharp"), effect: "immediate" } as Def<"round" | "sharp">,
  "ui.density": { scope: "device", default: "compact", validate: oneOf("comfortable", "compact", "dense"), effect: "immediate" } as Def<"comfortable" | "compact" | "dense">,
  "assets.edgeWidth": { scope: "device", default: 15, validate: (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 40 ? (v as number) : undefined), effect: "immediate" } as Def<number>,
  "assets.slideSeconds": { scope: "device", default: 5, validate: (v: unknown) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 120 ? (v as number) : undefined), effect: "immediate" } as Def<number>,
  "ui.motion": { scope: "device", default: "system", validate: oneOf("system", "reduce", "subtle", "full"), effect: "immediate" } as Def<"system" | "reduce" | "subtle" | "full">,
  "ui.animSpeed": { scope: "device", default: "normal", validate: oneOf("slow", "normal", "fast"), effect: "immediate" } as Def<"slow" | "normal" | "fast">,
  "ui.hints": { scope: "device", default: "all", validate: oneOf("all", "bar", "off"), effect: "immediate" } as Def<"all" | "bar" | "off">,
  "ui.actions": { scope: "device", default: "bottom", validate: oneOf("bottom", "follow"), effect: "immediate" } as Def<"bottom" | "follow">,
  "ui.names": { scope: "device", default: "all", validate: oneOf("all", "picked", "off"), effect: "immediate" } as Def<"all" | "picked" | "off">,
  "ui.zen": { scope: "device", default: false, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  /** Every shortcut the person changed, as JSON: command id → keys (settings/keymap.ts). Empty: all as they were. */
  "keys.custom": { scope: "device", default: "{}", validate: (v: unknown) => { try { return typeof v === "string" && typeof JSON.parse(v) === "object" ? v : undefined; } catch { return undefined; } }, effect: "immediate" } as Def<string>,
  "key.zen": { scope: "device", default: "z", validate: letter, effect: "immediate" } as Def<string>,
  "arrange.gap": { scope: "device", default: "normal", validate: oneOf("none", "tight", "normal", "wide", "wider"), effect: "immediate" } as Def<"none" | "tight" | "normal" | "wide" | "wider">,
  // Screenshots (ADR 0080).
  "shot.format": { scope: "device", default: "webp", validate: oneOf("webp", "png", "jpeg"), effect: "immediate" } as Def<"webp" | "png" | "jpeg">,
  "shot.quality": { scope: "device", default: 90, validate: range(10, 100), effect: "immediate" } as Def<number>,
  "shot.pattern": { scope: "device", default: true, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "shot.interface": { scope: "device", default: false, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "shot.transparent": { scope: "device", default: false, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "shot.folder": { scope: "device", default: "Screenshots", validate: text(60), effect: "immediate" } as Def<string>,
  "shot.name": { scope: "device", default: "{board}-{canvas}-{ddmmyyyy}-{hhmmss}", validate: text(120), effect: "immediate" } as Def<string>,
  "shot.nameStyle": { scope: "device", default: "snake", validate: oneOf("snake", "kebab", "camel", "pascal", "keep", "underscores"), effect: "immediate" } as Def<"snake" | "kebab" | "camel" | "pascal" | "keep" | "underscores">,
  "shot.tagsCustom": { scope: "device", default: "", validate: text(200), effect: "immediate" } as Def<string>,
  // Edited pictures (ADR 0118): "Make a new picture" of a picture as it looks with its crop and adjustments.
  "edit.format": { scope: "device", default: "png", validate: oneOf("webp", "png", "jpeg"), effect: "immediate" } as Def<"webp" | "png" | "jpeg">,
  "edit.quality": { scope: "device", default: 92, validate: range(10, 100), effect: "immediate" } as Def<number>,
  "edit.folder": { scope: "device", default: "Edited pictures", validate: text(60), effect: "immediate" } as Def<string>,
  "edit.name": { scope: "device", default: "{name}-edited", validate: text(120), effect: "immediate" } as Def<string>,
  "edit.nameStyle": { scope: "device", default: "keep", validate: oneOf("snake", "kebab", "camel", "pascal", "keep", "underscores"), effect: "immediate" } as Def<"snake" | "kebab" | "camel" | "pascal" | "keep" | "underscores">,
  "edit.tagEdited": { scope: "device", default: true, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "edit.tagSource": { scope: "device", default: false, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "edit.tagInherit": { scope: "device", default: true, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "edit.tagsCustom": { scope: "device", default: "", validate: text(200), effect: "immediate" } as Def<string>,
  // Extracted frames (ADR 0081).
  "frame.format": { scope: "device", default: "png", validate: oneOf("webp", "png", "jpeg"), effect: "immediate" } as Def<"webp" | "png" | "jpeg">,
  "frame.quality": { scope: "device", default: 92, validate: range(10, 100), effect: "immediate" } as Def<number>,
  "frame.folder": { scope: "device", default: "Extracted frames", validate: text(60), effect: "immediate" } as Def<string>,
  "frame.name": { scope: "device", default: "{name}-{position}", validate: text(120), effect: "immediate" } as Def<string>,
  "frame.nameStyle": { scope: "device", default: "keep", validate: oneOf("snake", "kebab", "camel", "pascal", "keep", "underscores"), effect: "immediate" } as Def<"snake" | "kebab" | "camel" | "pascal" | "keep" | "underscores">,
  "frame.tagFrame": { scope: "device", default: true, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "frame.tagSource": { scope: "device", default: false, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "frame.tagInherit": { scope: "device", default: false, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "frame.tagsCustom": { scope: "device", default: "", validate: text(200), effect: "immediate" } as Def<string>,
  // What is saved to the library from the canvas, each in a folder and with tags of its own: a picture from Export… (ADR 0147), a pattern made by
  // the Pattern panel (ADR 0162, saved by Export… or as SVG) and picked shapes saved as an SVG.
  "export.folder": { scope: "device", default: "Exports", validate: text(60), effect: "immediate" } as Def<string>,
  "export.tags": { scope: "device", default: "export", validate: text(200), effect: "immediate" } as Def<string>,
  "pattern.folder": { scope: "device", default: "Patterns", validate: text(60), effect: "immediate" } as Def<string>,
  "pattern.tags": { scope: "device", default: "pattern", validate: text(200), effect: "immediate" } as Def<string>,
  "svg.folder": { scope: "device", default: "Shapes", validate: text(60), effect: "immediate" } as Def<string>,
  "svg.tags": { scope: "device", default: "shape", validate: text(200), effect: "immediate" } as Def<string>,
  "frame.place": { scope: "device", default: true, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "shot.tagShot": { scope: "device", default: true, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "shot.tagBoard": { scope: "device", default: false, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "shot.tagCanvas": { scope: "device", default: false, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "shot.tagItems": { scope: "device", default: false, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "shot.copy": { scope: "device", default: false, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "nav.mode": { scope: "device", default: "view", validate: oneOf("view", "anywhere", "layer"), effect: "immediate" } as Def<"view" | "anywhere" | "layer">,
  "nav.arrive": { scope: "device", default: "focus", validate: oneOf("focus", "keep"), effect: "immediate" } as Def<"focus" | "keep">,
  // Camera travel (ADR 0163): how the view moves to a bookmark or a previous view.
  "nav.travel": { scope: "device", default: "fly", validate: oneOf("fly", "near", "cut"), effect: "immediate" } as Def<"fly" | "near" | "cut">,
  "nav.speed": { scope: "device", default: "distance", validate: oneOf("distance", "fixed"), effect: "immediate" } as Def<"distance" | "fixed">,
  "nav.ease": { scope: "device", default: "smooth", validate: oneOf("smooth", "linear", "out"), effect: "immediate" } as Def<"smooth" | "linear" | "out">,
  "nav.maxSeconds": { scope: "device", default: 3, validate: range(0.5, 6), effect: "immediate" } as Def<number>,
  "nav.baseSeconds": { scope: "device", default: 0.5, validate: range(0.1, 3), effect: "immediate" } as Def<number>,
  "nav.respectMotion": { scope: "device", default: true, validate: bool, effect: "immediate" } as Def<boolean>,
  "nav.fade": { scope: "device", default: true, validate: bool, effect: "immediate" } as Def<boolean>,
  "tour.speed": { scope: "device", default: "normal", validate: oneOf("slow", "normal", "fast"), effect: "immediate" } as Def<"slow" | "normal" | "fast">,
  "tour.pause": { scope: "device", default: 0, validate: range(0, 10), effect: "immediate" } as Def<number>,
  "eyedropper.size": { scope: "device", default: 1, validate: (v: unknown) => ((SAMPLE_SIZES as readonly unknown[]).includes(v) ? (v as number) : undefined), effect: "immediate" } as Def<number>,
  "eyedropper.layer": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "lasso.filter": { scope: "device", default: "strokes", validate: oneOf("strokes", "all"), effect: "immediate" } as Def<"strokes" | "all">,
};

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]["default"];

const DEVICE_KEY = "canvast.settings";
const LEGACY_VIEW_KEY = "canvast.view";

export class SettingsStore {
  private readonly values = new Map<string, unknown>();
  private readonly listeners = new Set<(key: SettingKey) => void>();

  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = safeLocalStorage()) {
    let raw: Record<string, unknown> = {};
    try {
      const text = storage?.getItem(DEVICE_KEY);
      const parsed: unknown = text ? JSON.parse(text) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
      // Before settings existed, the last view was stored on its own.
      if (raw["ui.view"] === undefined) {
        const legacy = storage?.getItem(LEGACY_VIEW_KEY);
        if (legacy) raw["ui.view"] = legacy;
      }
    } catch {
      // unreadable or unavailable: defaults
    }
    for (const key of Object.keys(SETTINGS) as SettingKey[]) {
      const v = (SETTINGS[key] as Def<unknown>).validate(raw[key]);
      if (v !== undefined) this.values.set(key, v);
    }
  }

  /** The settings whose value is not the default, as "key = value" (the diagnostic report lists them). */
  changedKeys(): string[] {
    return [...this.values].filter(([k, v]) => v !== (SETTINGS[k as SettingKey] as Def<unknown>).default).map(([k, v]) => `${k} = ${typeof v === "string" && k.startsWith("ui.dock") ? "(layout)" : JSON.stringify(v)}`);
  }

  /** What differs from the defaults, to travel in a backup (ADR 0160). */
  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.values);
  }

  /** The settings of a backup this device has not set itself: a setting changed here is never overridden. Returns how many were taken. */
  restore(from: unknown): number {
    if (!from || typeof from !== "object" || Array.isArray(from)) return 0;
    let n = 0;
    for (const key of Object.keys(SETTINGS) as SettingKey[]) {
      if (this.values.has(key) || !(key in from)) continue;
      const v = (SETTINGS[key] as Def<unknown>).validate((from as Record<string, unknown>)[key]);
      if (v === undefined || v === (SETTINGS[key] as Def<unknown>).default) continue;
      this.values.set(key, v);
      n++;
    }
    if (n) {
      this.save();
      for (const key of Object.keys(SETTINGS) as SettingKey[]) for (const fn of this.listeners) fn(key);
    }
    return n;
  }

  /** How many settings `restore` would take. */
  restorable(from: unknown): number {
    if (!from || typeof from !== "object" || Array.isArray(from)) return 0;
    return (Object.keys(SETTINGS) as SettingKey[]).filter((k) => !this.values.has(k) && k in from && (SETTINGS[k] as Def<unknown>).validate((from as Record<string, unknown>)[k]) !== undefined).length;
  }

  /** Whether a value is stored (not the default): lets a build choose its own default. */
  isSet(key: SettingKey): boolean {
    return this.values.has(key);
  }

  get<K extends SettingKey>(key: K): SettingValue<K> {
    return (this.values.has(key) ? this.values.get(key) : SETTINGS[key].default) as SettingValue<K>;
  }

  /** Set a value. An invalid value is rejected (returns false); an unchanged one is not written. */
  set<K extends SettingKey>(key: K, value: SettingValue<K>): boolean {
    const def = SETTINGS[key] as Def<unknown>;
    if (def.scope !== "device") throw new Error(`setting ${key} has scope "${def.scope}", which has no storage yet`);
    const v = def.validate(value);
    if (v === undefined) return false;
    if (this.get(key) === v) return true;
    this.values.set(key, v);
    this.save();
    for (const fn of this.listeners) fn(key);
    return true;
  }

  /** Back to the default (a stored value is removed). */
  reset(key: SettingKey): void {
    if (!this.values.delete(key)) return;
    this.save();
    for (const fn of this.listeners) fn(key);
  }

  subscribe(fn: (key: SettingKey) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private save(): void {
    try {
      this.storage?.setItem(DEVICE_KEY, JSON.stringify(Object.fromEntries(this.values)));
      this.storage?.removeItem(LEGACY_VIEW_KEY);
    } catch {
      // storage full or blocked: the value stays for this session
    }
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
