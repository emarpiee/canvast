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
const colour = (v: unknown): string | undefined => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);

export const SETTINGS = {
  "ui.view": { scope: "device", default: "canvas", validate: oneOf("canvas", "assets"), effect: "restart" } as Def<"canvas" | "assets">,
  "pen.color": { scope: "device", default: "#1f2329", validate: colour, effect: "immediate" } as Def<string>,
  "pen.kind": { scope: "device", default: "fine", validate: oneOf("fine", "pencil", "ink", "marker"), effect: "immediate" } as Def<"fine" | "pencil" | "ink" | "marker">,
  "pen.widthPx": { scope: "device", default: 3, validate: range(0.5, 128), effect: "immediate" } as Def<number>,
  "pen.stabilizer.on": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "pen.stabilizer.strength": { scope: "device", default: 50, validate: range(0, 100), effect: "immediate" } as Def<number>,
  "pen.followZoom": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "select.ignoreFilling": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "ui.fps": { scope: "device", default: false, validate: bool, effect: "immediate" } as Def<boolean>,
  "quality.auto": { scope: "device", default: true, validate: bool, effect: "immediate" } as Def<boolean>,
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
