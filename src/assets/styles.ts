/**
 * Styles (ADR 0120): the looks the user saves to use again, kept together in the library. One list of named items; what an item *is* is
 * decided by its kind, and a kind is one entry of `STYLE_KINDS` (how to check its data, how to say it in a line, what colour dot to show).
 * To add a kind (a colour palette, a stroke, a text style...) add one object there and offer a way to save and apply it; the storage, the
 * sidebar card of the Assets view (rows, rename, delete) and the unknown-kind safety need nothing more.
 */
import type { Adjust } from "../doc/adjust";
import { ADJUSTMENTS, cleanAdjust, layersOf } from "../doc/adjust";
import type { Gradient } from "../doc/paint";
import { isColour, isGradient, isPaint } from "../doc/paint";
import type { PaletteColour } from "./gpl";
import { MAX_PALETTE } from "./gpl";
import { cleanLook } from "../text/text-style";
import type { TextLook } from "../text/text-style";

export interface StyleItem {
  readonly id: string;
  /** One of `STYLE_KINDS`' ids. An item of a kind this version does not know is kept as it is (a newer version made it) and not shown. */
  readonly kind: string;
  readonly name: string;
  /** When it was saved (ms). */
  readonly at: number;
  /** The kind's own data; `StyleKind.validate` says what it must be. */
  readonly data: unknown;
}

export interface StyleKind {
  readonly id: string;
  /** "Adjustment": one of them, for a name or a button. */
  readonly label: string;
  /** "Adjustments": the heading of its list in the Styles card. */
  readonly plural: string;
  /** What the empty list says. */
  readonly empty: string;
  /** The data when it is what this kind keeps, else null. The result is what is stored. */
  validate(data: unknown): unknown | null;
  /** One short line about the data. */
  summary(data: unknown): string;
  /** How to show it on its card: a bar of CSS background (a gradient) or a row of colours (a colour, a palette). */
  look?(data: unknown): StyleLook;
}

export interface StyleLook {
  readonly bar?: string;
  readonly swatches?: readonly string[];
}

const signed = (v: number): string => (v > 0 ? `+${v}` : `${v}`.replace("-", "−"));

export const ADJUSTMENT_KIND: StyleKind = {
  id: "adjustment",
  label: "Adjustment",
  plural: "Adjustments",
  empty: "None yet. Save one from the Adjust panel.",
  validate: (d) => (d && typeof d === "object" ? (cleanAdjust(d as Adjust) ?? null) : null),
  summary: (d) => {
    const a = d as Adjust;
    const parts = [...(a.map ? [`Gradient map ${a.map.amount}%`] : []), ...(a.levels ? ["Levels"] : []), ...(a.curves ? ["Curves"] : []), ...(a.next ? [`${layersOf(a).length} layers`] : []), ...ADJUSTMENTS.filter((s) => a[s.key]).map((s) => `${s.label} ${signed(a[s.key]!)}`)];
    return parts.length > 3 ? `${parts.slice(0, 3).join(", ")} and ${parts.length - 3} more` : parts.join(", ");
  },
};

export const COLOUR_KIND: StyleKind = {
  id: "colour",
  label: "Colour",
  plural: "Colours",
  empty: "None yet. Save one from the colour picker.",
  validate: (d) => (isColour(d) ? d.toLowerCase() : null),
  summary: (d) => String(d).toUpperCase(),
  look: (d) => ({ swatches: [String(d)] }),
};

/** A gradient as a CSS `linear-gradient` along its stops (for a card or a button). */
export const gradientCss = (g: Gradient): string => `linear-gradient(90deg, ${g.stops.map((s) => `${s.c} ${Math.round(s.o * 1000) / 10}%`).join(", ")})`;

export const GRADIENT_KIND: StyleKind = {
  id: "gradient",
  label: "Gradient",
  plural: "Gradients",
  empty: "None yet. Save one from the fill or outline picker, or import a .ggr file.",
  validate: (d) => (isPaint(d) && isGradient(d) ? d : null),
  summary: (d) => {
    const g = d as Gradient;
    return `${g.type === "linear" ? "Linear" : "Radial"} · ${g.stops.length} stops`;
  },
  look: (d) => ({ bar: gradientCss(d as Gradient) }),
};

export interface PaletteData {
  readonly colours: readonly PaletteColour[];
}

export const PALETTE_KIND: StyleKind = {
  id: "palette",
  label: "Palette",
  plural: "Palettes",
  empty: "None yet. Make one from the selection or a picture, or import a .gpl file.",
  validate: (d) => {
    const list = (d as { colours?: unknown } | null)?.colours;
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_PALETTE) return null;
    const colours: PaletteColour[] = [];
    for (const c of list as Array<Record<string, unknown>>) {
      if (!c || !isColour(c["c"])) return null;
      const name = typeof c["name"] === "string" ? c["name"].trim().slice(0, 40) : "";
      colours.push({ c: (c["c"] as string).toLowerCase(), ...(name ? { name } : {}) });
    }
    return { colours } satisfies PaletteData;
  },
  summary: (d) => {
    const n = (d as PaletteData).colours.length;
    return `${n} colour${n === 1 ? "" : "s"}`;
  },
  look: (d) => ({ swatches: (d as PaletteData).colours.map((c) => c.c) }),
};

export const TEXT_KIND: StyleKind = {
  id: "text",
  label: "Text style",
  plural: "Text styles",
  empty: "None yet. Save one from a text.",
  validate: (d) => cleanLook(d),
  summary: (d) => {
    const l = d as TextLook;
    return [l.sizePx !== undefined ? `${Math.round(l.sizePx * 10) / 10} px` : "", l.align && l.align !== "left" ? l.align : "", l.lineHeight !== undefined ? `line ${l.lineHeight}` : "", l.tracking ? `letters ${Math.round(l.tracking * 100)}%` : ""].filter(Boolean).join(" · ") || "Default";
  },
  look: (d) => ({ swatches: (d as TextLook).color ? [(d as TextLook).color!] : [] }),
};

// Stroke styles come here as one more kind (ADR 0120).
export const STYLE_KINDS: readonly StyleKind[] = [ADJUSTMENT_KIND, GRADIENT_KIND, COLOUR_KIND, PALETTE_KIND, TEXT_KIND];

export const kindById = (id: string): StyleKind | undefined => STYLE_KINDS.find((k) => k.id === id);

export const MAX_STYLES = 500;
export const MAX_STYLE_NAME = 60;

const ID_RE = /^[0-9a-f]{32}$/;

/** What was stored (anything, maybe from another version or hand-edited) as a list of styles: the sound ones, kept in order. */
export function cleanStyles(raw: unknown): StyleItem[] {
  if (!Array.isArray(raw)) return [];
  const out: StyleItem[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, MAX_STYLES) as Array<Record<string, unknown>>) {
    if (!r || typeof r !== "object" || typeof r["id"] !== "string" || !ID_RE.test(r["id"]) || seen.has(r["id"])) continue;
    if (typeof r["kind"] !== "string" || typeof r["name"] !== "string" || !r["name"].trim()) continue;
    const kind = kindById(r["kind"]);
    const data = kind ? kind.validate(r["data"]) : r["data"]; // (an unknown kind is kept untouched)
    if (data === null || data === undefined) continue;
    seen.add(r["id"]);
    out.push({ id: r["id"], kind: r["kind"], name: r["name"].trim().slice(0, MAX_STYLE_NAME), at: typeof r["at"] === "number" && Number.isFinite(r["at"]) ? r["at"] : 0, data });
  }
  return out;
}

/** The saved styles, in memory, saved through `persist` after every change. */
export class StyleLibrary {
  private list: StyleItem[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly persist: (items: readonly StyleItem[]) => Promise<void>, private readonly newId: () => string) {}

  get items(): readonly StyleItem[] {
    return this.list;
  }

  /** The items of a kind, oldest first. */
  of(kind: string): StyleItem[] {
    return this.list.filter((s) => s.kind === kind);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Replace the list with what was stored (nothing is written back). */
  load(raw: unknown): void {
    this.list = cleanStyles(raw);
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private async set(next: StyleItem[]): Promise<void> {
    const before = this.list;
    this.list = next;
    this.emit();
    try {
      await this.persist(next);
    } catch {
      this.list = before; // not stored (a read-only tab, a storage error): not kept on screen either
      this.emit();
    }
  }

  /** A free name for a new style of a kind: "Adjustment 3". */
  nextName(kind: string): string {
    const k = kindById(kind);
    const word = k?.label ?? "Style";
    const used = new Set(this.of(kind).map((s) => s.name.toLowerCase()));
    for (let n = this.of(kind).length + 1; ; n++) if (!used.has(`${word} ${n}`.toLowerCase())) return `${word} ${n}`;
  }

  /** Save data as a new style. Null: it is not data of that kind, or the library is full. */
  async add(kind: string, name: string, data: unknown): Promise<StyleItem | null> {
    const k = kindById(kind);
    const clean = k?.validate(data);
    if (!k || clean === null || clean === undefined || this.list.length >= MAX_STYLES) return null;
    const item: StyleItem = { id: this.newId(), kind, name: name.trim().slice(0, MAX_STYLE_NAME) || this.nextName(kind), at: Date.now(), data: clean };
    await this.set([...this.list, item]);
    return item;
  }

  /** Replace the data of a style (a palette edited, a colour changed); not data of its kind: nothing happens. */
  async update(id: string, data: unknown): Promise<boolean> {
    const item = this.list.find((s) => s.id === id);
    const clean = item && kindById(item.kind)?.validate(data);
    if (!item || clean === null || clean === undefined) return false;
    await this.set(this.list.map((s) => (s.id === id ? { ...s, data: clean } : s)));
    return true;
  }

  /** A copy of a style right after it, named "… copy". */
  async duplicate(id: string): Promise<StyleItem | null> {
    const i = this.list.findIndex((s) => s.id === id);
    if (i < 0 || this.list.length >= MAX_STYLES) return null;
    const s = this.list[i]!;
    const copy: StyleItem = { ...s, id: this.newId(), name: `${s.name} copy`.slice(0, MAX_STYLE_NAME), at: Date.now() };
    await this.set([...this.list.slice(0, i + 1), copy, ...this.list.slice(i + 1)]);
    return copy;
  }

  async rename(id: string, name: string): Promise<void> {
    const n = name.trim().slice(0, MAX_STYLE_NAME);
    if (n) await this.set(this.list.map((s) => (s.id === id ? { ...s, name: n } : s)));
  }

  async remove(id: string): Promise<void> {
    await this.set(this.list.filter((s) => s.id !== id));
  }
}
