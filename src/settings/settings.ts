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
const colour = (v: unknown): string | undefined => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);

export const SETTINGS = {
  "dev.tools": { scope: "device", default: false, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "restart" } as Def<boolean>,
  "ui.view": { scope: "device", default: "canvas", validate: oneOf("canvas", "assets"), effect: "restart" } as Def<"canvas" | "assets">,
  "pen.color": { scope: "device", default: "#1f2329", validate: colour, effect: "immediate" } as Def<string>,
  "pen.kind": { scope: "device", default: "fine", validate: oneOf("fine", "pencil", "ink", "marker"), effect: "immediate" } as Def<"fine" | "pencil" | "ink" | "marker">,
  "pen.widthPx": { scope: "device", default: 3, validate: range(0.5, 128), effect: "immediate" } as Def<number>,
  "pen.stabilizer.on": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "pen.stabilizer.strength": { scope: "device", default: 50, validate: range(0, 100), effect: "immediate" } as Def<number>,
  "pen.followZoom": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "select.ignoreFilling": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "ui.info": { scope: "device", default: "simple", validate: oneOf("simple", "more", "technical", "hidden"), effect: "immediate" } as Def<"simple" | "more" | "technical" | "hidden">,
  "quality.auto": { scope: "device", default: true, validate: bool, effect: "immediate" } as Def<boolean>,
  "ui.tagsOpen": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "ui.bookmarksOpen": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "ui.layersOpen": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "select.alignBox": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "snap.enabled": { scope: "device", default: true, validate: bool, effect: "immediate" } as Def<boolean>,
  "eraser.diameterPx": { scope: "device", default: 16, validate: range(4, 128), effect: "immediate" } as Def<number>,
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
  "key.eraser": { scope: "device", default: "e", validate: letter, effect: "immediate" } as Def<string>,
  // Stepping the selection between items (ADR 0058, 0072): W A S D by default.
  "key.navUp": { scope: "device", default: "w", validate: letter, effect: "immediate" } as Def<string>,
  "key.navLeft": { scope: "device", default: "a", validate: letter, effect: "immediate" } as Def<string>,
  "key.navDown": { scope: "device", default: "s", validate: letter, effect: "immediate" } as Def<string>,
  "key.navRight": { scope: "device", default: "d", validate: letter, effect: "immediate" } as Def<string>,
  "ui.hue": { scope: "device", default: 178, validate: range(0, 360), effect: "immediate" } as Def<number>,
  "ui.vivid": { scope: "device", default: 100, validate: range(0, 150), effect: "immediate" } as Def<number>,
  "ui.pattern": { scope: "device", default: "grid", validate: oneOf("grid", "dots", "scale", "none"), effect: "immediate" } as Def<"grid" | "dots" | "scale" | "none">,
  "ui.density": { scope: "device", default: "compact", validate: oneOf("comfortable", "compact"), effect: "immediate" } as Def<"comfortable" | "compact">,
  "assets.edgeWidth": { scope: "device", default: 15, validate: (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 40 ? (v as number) : undefined), effect: "immediate" } as Def<number>,
  "assets.slideSeconds": { scope: "device", default: 5, validate: (v: unknown) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 120 ? (v as number) : undefined), effect: "immediate" } as Def<number>,
  "ui.textScale": { scope: "device", default: "100", validate: oneOf("90", "100", "115", "130", "150"), effect: "immediate" } as Def<"90" | "100" | "115" | "130" | "150">,
  "ui.contrast": { scope: "device", default: "normal", validate: oneOf("normal", "high"), effect: "immediate" } as Def<"normal" | "high">,
  "ui.motion": { scope: "device", default: "system", validate: oneOf("system", "reduce", "full"), effect: "immediate" } as Def<"system" | "reduce" | "full">,
  "ui.zen": { scope: "device", default: false, validate: (v: unknown) => (typeof v === "boolean" ? v : undefined), effect: "immediate" } as Def<boolean>,
  "key.zen": { scope: "device", default: "z", validate: letter, effect: "immediate" } as Def<string>,
  "arrange.gap": { scope: "device", default: "normal", validate: oneOf("none", "tight", "normal", "wide", "wider"), effect: "immediate" } as Def<"none" | "tight" | "normal" | "wide" | "wider">,
  "nav.mode": { scope: "device", default: "view", validate: oneOf("view", "anywhere", "layer"), effect: "immediate" } as Def<"view" | "anywhere" | "layer">,
  "nav.arrive": { scope: "device", default: "focus", validate: oneOf("focus", "keep"), effect: "immediate" } as Def<"focus" | "keep">,
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
