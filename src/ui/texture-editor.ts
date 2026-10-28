/**
 * The controls of a texture fill (ADR 0154), shown in the paint chooser under Image and Objects: where the source comes from, how it lies
 * in the shape, and (when it is repeated) on what grid. Both kinds share every control; the source row and the Mode choice are the only
 * differences. The fields are one table, so each is made and read the same way.
 */
import { esc } from "./format";
import { scrubNumbers } from "../colour-picker/scrub";
import { ICONS } from "./icons";
import type { TextureMode, TextureSource, TexturePaint, TextureVary, TileAlign, TileType } from "../doc/texture";
import { MAX_SCALE, MAX_SPACING, MAX_VARY_JITTER, MAX_VARY_ROTATION, MAX_VARY_SIZE, MAX_VARY_SKIP, MIN_SCALE, TEXTURE_MODES, TILE_ALIGNS, TILE_TYPES, noVary } from "../doc/texture";

/** What the app gives the editor: the person's choices on the canvas and in files, and words for a source. */
export interface TextureHooks {
  /** Wait for a click on the canvas: a picture (`image`) or the objects under the pointer (`objects`). null: cancelled. */
  pickSource(kind: "image" | "objects"): Promise<TextureSource | null>;
  /** Choose one of the pictures already in the library (a panel beside `anchor`). null: none was chosen. */
  chooseFromLibrary(anchor: HTMLElement): Promise<TextureSource | null>;
  /** A picture file put in the library. null: it could not be. */
  importFile(file: File): Promise<TextureSource | null>;
  /** The average colour of a source (for the swatches and the density preview). */
  avg(src: TextureSource): string;
  /** A few words for a source ("Picture sunset.png", "3 objects"). */
  describe(src: TextureSource): string;
}

let hooks: TextureHooks | null = null;
export const setTextureHooks = (h: TextureHooks | null): void => {
  hooks = h;
};
export const textureHooks = (): TextureHooks | null => hooks;

const LABEL: Record<TextureMode, string> = { fill: "Fill", fit: "Fit", crop: "Crop", tile: "Tile" };
const TILE_LABEL: Record<TileType, string> = { rect: "Grid", "hex-h": "Brick rows", "hex-v": "Brick columns" };
const ALIGN_LABEL: Record<TileAlign, string> = { start: "Start", center: "Centre", end: "End" };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

interface Field {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly tiled?: true;
  /** Shown for objects only (a picture has one piece: nothing to choose between). */
  readonly objects?: true;
  get(t: TexturePaint): number;
  set(t: TexturePaint, v: number): TexturePaint;
}

/** Vary (ADR 0173): the values of the texture, or none varied yet. */
const varyOf = (t: TexturePaint): TextureVary => t.vary ?? noVary();
const withVary = (t: TexturePaint, patch: Partial<TextureVary>): TexturePaint => ({ ...t, vary: { ...varyOf(t), ...patch } });
const SEED_MAX = 2 ** 31 - 1;
const newSeed = (): number => 1 + Math.floor(Math.random() * (SEED_MAX - 1));

/** The number fields, in the order shown: percentages of the natural size, the box or the tile; the rotation in degrees. */
const FIELDS: readonly Field[] = [
  { key: "scale", label: "Scale %", min: MIN_SCALE * 100, max: MAX_SCALE * 100, step: 1, get: (t) => t.scale * 100, set: (t, v) => ({ ...t, scale: clamp(v / 100, MIN_SCALE, MAX_SCALE) }) },
  { key: "rotation", label: "Rotation °", min: -360, max: 360, step: 1, get: (t) => t.rotation, set: (t, v) => ({ ...t, rotation: clamp(v, -360, 360) }) },
  { key: "ox", label: "Offset X %", min: -1000, max: 1000, step: 1, get: (t) => t.offset[0] * 100, set: (t, v) => ({ ...t, offset: [clamp(v / 100, -1000, 1000), t.offset[1]] }) },
  { key: "oy", label: "Offset Y %", min: -1000, max: 1000, step: 1, get: (t) => t.offset[1] * 100, set: (t, v) => ({ ...t, offset: [t.offset[0], clamp(v / 100, -1000, 1000)] }) },
  { key: "sx", label: "Space across %", min: 0, max: MAX_SPACING * 100, step: 1, tiled: true, get: (t) => t.spacing[0] * 100, set: (t, v) => ({ ...t, spacing: [clamp(v / 100, 0, MAX_SPACING), t.spacing[1]] }) },
  { key: "sy", label: "Space down %", min: 0, max: MAX_SPACING * 100, step: 1, tiled: true, get: (t) => t.spacing[1] * 100, set: (t, v) => ({ ...t, spacing: [t.spacing[0], clamp(v / 100, 0, MAX_SPACING)] }) },
];
/** Vary each copy (ADR 0173): shown under the grid, when the texture is repeated. */
const VARY_FIELDS: readonly Field[] = [
  { key: "vrot", label: "Turn ± °", min: 0, max: MAX_VARY_ROTATION, step: 1, tiled: true, get: (t) => varyOf(t).rotation, set: (t, v) => withVary(t, { rotation: clamp(v, 0, MAX_VARY_ROTATION) }) },
  { key: "vstep", label: "Turn steps °", min: 0, max: 180, step: 1, tiled: true, get: (t) => varyOf(t).rotStep, set: (t, v) => withVary(t, { rotStep: clamp(v, 0, 180) }) },
  { key: "vsize", label: "Size ± %", min: 0, max: MAX_VARY_SIZE * 100, step: 1, tiled: true, get: (t) => varyOf(t).size * 100, set: (t, v) => withVary(t, { size: clamp(v / 100, 0, MAX_VARY_SIZE) }) },
  { key: "vjit", label: "Place ± %", min: 0, max: MAX_VARY_JITTER * 100, step: 1, tiled: true, get: (t) => varyOf(t).jitter * 100, set: (t, v) => withVary(t, { jitter: clamp(v / 100, 0, MAX_VARY_JITTER) }) },
  { key: "vskip", label: "Leave out %", min: 0, max: MAX_VARY_SKIP * 100, step: 1, tiled: true, get: (t) => varyOf(t).skip * 100, set: (t, v) => withVary(t, { skip: clamp(v / 100, 0, MAX_VARY_SKIP) }) },
  { key: "vseed", label: "Seed", min: 1, max: SEED_MAX, step: 1, tiled: true, get: (t) => varyOf(t).seed, set: (t, v) => withVary(t, { seed: clamp(Math.round(v), 1, SEED_MAX) }) },
];
const NUMBERS = [...FIELDS, ...VARY_FIELDS];

interface Choice {
  readonly key: string;
  readonly label: string;
  readonly items: ReadonlyArray<readonly [string, string]>;
  readonly tiled?: true;
  readonly objects?: true;
  /** Shown for a picture only. */
  readonly image?: true;
  get(t: TexturePaint): string;
  set(t: TexturePaint, v: string): TexturePaint;
}
const CHOICES: readonly Choice[] = [
  { key: "mode", label: "Mode", image: true, items: TEXTURE_MODES.map((m) => [m, LABEL[m]] as const), get: (t) => t.mode, set: (t, v) => ({ ...t, mode: v as TextureMode }) },
  { key: "tile", label: "Grid", tiled: true, items: TILE_TYPES.map((m) => [m, TILE_LABEL[m]] as const), get: (t) => t.tile, set: (t, v) => ({ ...t, tile: v as TileType }) },
  { key: "align", label: "Align", tiled: true, items: TILE_ALIGNS.map((m) => [m, ALIGN_LABEL[m]] as const), get: (t) => t.align, set: (t, v) => ({ ...t, align: v as TileAlign }) },
];
const VARY_CHOICES: readonly Choice[] = [
  { key: "veach", label: "Copies of", tiled: true, objects: true, items: [["each", "Each object"], ["all", "The arrangement"]], get: (t) => (t.vary && !t.vary.each ? "all" : "each"), set: (t, v) => withVary(t, { each: v === "each" }) },
  { key: "vorder", label: "Order", tiled: true, objects: true, items: [["sequence", "In turn"], ["shuffle", "Shuffled"]], get: (t) => varyOf(t).order, set: (t, v) => withVary(t, { order: v === "shuffle" ? "shuffle" : "sequence" }) },
  { key: "vflip", label: "Mirror some", tiled: true, items: [["no", "No"], ["yes", "Yes"]], get: (t) => (varyOf(t).flip ? "yes" : "no"), set: (t, v) => withVary(t, { flip: v === "yes" }) },
];
const SELECTS = [...CHOICES, ...VARY_CHOICES];

export interface TextureEditorOptions {
  kind: "image" | "objects";
  /** The texture now; null while no source has been chosen yet. */
  value: TexturePaint | null;
  /** A source was chosen (and `avg` is its average colour): the first texture, or the same one with another source. */
  onSource(src: TextureSource, avg: string): void;
  /** Every step while a number is typed, and once when it is settled. */
  onInput(t: TexturePaint): void;
  onChange(t: TexturePaint): void;
  /** The size changed (a source row appeared): the popover is put in place again. */
  onResize?(): void;
}

/** The editor as an element; `destroy` takes it down. */
export function createTextureEditor(o: TextureEditorOptions): { el: HTMLElement; destroy(): void } {
  const el = document.createElement("div");
  el.className = "tex-editor";
  let t = o.value;
  const shows = (f: { tiled?: true; objects?: true; image?: true }): boolean => (!f.objects || o.kind === "objects") && (!f.image || o.kind === "image");
  const number = (f: Field, extra = ""): string =>
    shows(f) ? `<div class="adj-row" data-tex-row="${f.key}"${f.tiled ? " data-tiled" : ""}><label class="adj-label" for="tex-${f.key}">${f.label}</label>${extra || "<span></span>"}<input type="number" class="adj-num" id="tex-${f.key}" data-tex-num="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" aria-label="${f.label}"></div>` : "";
  const select = (c: Choice): string =>
    shows(c) ? `<div class="adj-row" data-tex-row="${c.key}"${c.tiled ? " data-tiled" : ""}><label class="adj-label" for="tex-${c.key}">${c.label}</label><select id="tex-${c.key}" data-tex-sel="${c.key}" aria-label="${c.label}">${c.items.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select><span></span></div>` : "";
  const vary = [VARY_CHOICES[0]!, ...VARY_FIELDS.slice(0, -1)].map((f) => ("items" in f ? select(f) : number(f))).join("") + select(VARY_CHOICES[1]!) + select(VARY_CHOICES[2]!)
    + number(VARY_FIELDS.at(-1)!, `<button type="button" class="tex-newseed" data-tex-newseed aria-label="New seed" title="New seed: the same settings, other copies">${ICONS.shuffle}</button>`);
  el.innerHTML = `
    <div class="tex-source">
      ${o.kind === "image" ? `<button type="button" class="colour-save is-first" data-tex-lib>Choose from the library…</button>` : ""}
      <button type="button" class="colour-save" data-tex-pick>${o.kind === "image" ? "Select a picture on the canvas" : "Select the objects on the canvas"}</button>
      ${o.kind === "image" ? `<button type="button" class="colour-save" data-tex-file>Choose a file…</button><input type="file" accept="image/*" hidden data-tex-input>` : ""}
      <p class="op-note" data-tex-note role="status"></p>
    </div>
    <div class="tex-fields">
      <div class="tex-random"><button type="button" class="colour-save" data-tex-random title="Randomize the options: scale, turn, place, space, grid and how each copy varies">${ICONS.dice5}<span>Randomize</span></button></div>
      ${select(CHOICES[0]!)}
      ${FIELDS.map((f) => number(f)).join("")}
      ${select(CHOICES[1]!)}
      ${select(CHOICES[2]!)}
      <p class="tex-vary-title" data-tiled>Vary each copy</p>
      ${vary}
    </div>`;
  const q = <T extends HTMLElement>(s: string): T => el.querySelector<T>(s)!;
  scrubNumbers(el); // (drag a name to change its number, as everywhere)
  const note = q("[data-tex-note]");
  const sync = (): void => {
    q(".tex-fields").hidden = !t;
    note.textContent = t ? (hooks?.describe(t.src) ?? "") : o.kind === "image" ? "Choose a picture to fill the shape with." : "Choose the objects to repeat over the shape.";
    if (!t) return;
    const tiled = t.mode === "tile";
    for (const r of el.querySelectorAll<HTMLElement>("[data-tiled]")) r.hidden = !tiled;
    for (const f of NUMBERS) {
      const i = el.querySelector<HTMLInputElement>(`[data-tex-num="${f.key}"]`);
      if (i && document.activeElement !== i) i.value = String(Math.round(f.get(t) * 100) / 100);
    }
    for (const c of SELECTS) {
      const s = el.querySelector<HTMLSelectElement>(`[data-tex-sel="${c.key}"]`);
      if (s) s.value = c.get(t);
    }
    // the order is a choice only between several objects copied one by one
    const order = el.querySelector<HTMLElement>('[data-tex-row="vorder"]');
    if (order && tiled) order.hidden = !varyOf(t).each;
    o.onResize?.();
  };
  const take = async (pick: Promise<TextureSource | null>): Promise<void> => {
    const src = await pick;
    if (!src || !hooks) return;
    const avg = hooks.avg(src);
    t = t ? { ...t, src, avg, mode: src.kind === "objects" ? "tile" : t.mode } : null;
    o.onSource(src, avg);
  };
  q("[data-tex-pick]").addEventListener("click", () => void take(hooks!.pickSource(o.kind)));
  el.querySelector<HTMLElement>("[data-tex-lib]")?.addEventListener("click", (e) => void take(hooks!.chooseFromLibrary(e.currentTarget as HTMLElement)));
  const file = el.querySelector<HTMLInputElement>("[data-tex-input]");
  el.querySelector("[data-tex-file]")?.addEventListener("click", () => file!.click());
  file?.addEventListener("change", () => {
    const f = file.files?.[0];
    if (f) void take(hooks!.importFile(f));
    file.value = "";
  });
  // Randomize: any mode (a picture), scale, turn, place, space, grid and align; one undo step.
  const pickOf = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;
  const between = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);
  q("[data-tex-random]").addEventListener("click", () => {
    if (!t) return;
    const mode: TextureMode = o.kind === "image" ? pickOf(TEXTURE_MODES) : "tile";
    const tiled = mode === "tile";
    change(
      {
        ...t,
        mode,
        scale: clamp(Math.round(between(tiled ? 0.2 : 1, tiled ? 2.5 : 2) * 100) / 100, MIN_SCALE, MAX_SCALE),
        rotation: Math.round(between(-180, 180)),
        offset: [Math.round(between(-0.5, 0.5) * 100) / 100, Math.round(between(-0.5, 0.5) * 100) / 100],
        tile: tiled ? pickOf(TILE_TYPES) : t.tile,
        spacing: tiled ? [Math.round(between(0, 0.6) * 100) / 100, Math.round(between(0, 0.6) * 100) / 100] : t.spacing,
        align: tiled ? pickOf(TILE_ALIGNS) : t.align,
        ...(tiled ? { vary: { ...varyOf(t), rotation: pickOf([0, 15, 45, 180]), size: pickOf([0, 0.2, 0.4]), jitter: pickOf([0, 0.1, 0.3]), skip: pickOf([0, 0, 0.2]), flip: Math.random() < 0.3, order: pickOf(["sequence", "shuffle"] as const), seed: newSeed() } } : {}),
      },
      true,
    );
  });
  q("[data-tex-newseed]")?.addEventListener("click", () => {
    if (t) change(withVary(t, { seed: newSeed() }), true);
  });
  const change = (next: TexturePaint, final: boolean): void => {
    t = next;
    sync();
    (final ? o.onChange : o.onInput)(next);
  };
  el.addEventListener("input", (e) => {
    const i = (e.target as HTMLElement).closest<HTMLInputElement>("[data-tex-num]");
    const f = i && NUMBERS.find((x) => x.key === i.dataset["texNum"]);
    if (t && f && i.value !== "" && Number.isFinite(Number(i.value))) change(f.set(t, Number(i.value)), false);
  });
  el.addEventListener("change", (e) => {
    const target = e.target as HTMLElement;
    const i = target.closest<HTMLInputElement>("[data-tex-num]");
    const s = target.closest<HTMLSelectElement>("[data-tex-sel]");
    if (!t) return;
    if (i) {
      const f = NUMBERS.find((x) => x.key === i.dataset["texNum"])!;
      if (i.value === "" || !Number.isFinite(Number(i.value))) return sync();
      change(f.set(t, Number(i.value)), true);
    } else if (s) {
      const c = SELECTS.find((x) => x.key === s.dataset["texSel"]);
      if (c) change(c.set(t, s.value), true);
    }
  });
  sync();
  return { el, destroy: () => el.remove() };
}
