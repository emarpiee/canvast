/**
 * The controls of a texture fill (ADR 0154), shown in the paint chooser under Image and Objects: where the source comes from, how it lies
 * in the shape, and (when it is repeated) on what grid. Both kinds share every control; the source row and the Mode choice are the only
 * differences. The fields are one table, so each is made and read the same way.
 */
import { esc } from "./format";
import { scrubNumbers } from "../colour-picker/scrub";
import { ICONS } from "./icons";
import type { TextureMode, TextureSource, TexturePaint, TileAlign, TileType } from "../doc/texture";
import { MAX_SCALE, MAX_SPACING, MIN_SCALE, TEXTURE_MODES, TILE_ALIGNS, TILE_TYPES } from "../doc/texture";

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
  get(t: TexturePaint): number;
  set(t: TexturePaint, v: number): TexturePaint;
}

/** The number fields, in the order shown: percentages of the natural size, the box or the tile; the rotation in degrees. */
const FIELDS: readonly Field[] = [
  { key: "scale", label: "Scale %", min: MIN_SCALE * 100, max: MAX_SCALE * 100, step: 1, get: (t) => t.scale * 100, set: (t, v) => ({ ...t, scale: clamp(v / 100, MIN_SCALE, MAX_SCALE) }) },
  { key: "rotation", label: "Rotation °", min: -360, max: 360, step: 1, get: (t) => t.rotation, set: (t, v) => ({ ...t, rotation: clamp(v, -360, 360) }) },
  { key: "ox", label: "Offset X %", min: -1000, max: 1000, step: 1, get: (t) => t.offset[0] * 100, set: (t, v) => ({ ...t, offset: [clamp(v / 100, -1000, 1000), t.offset[1]] }) },
  { key: "oy", label: "Offset Y %", min: -1000, max: 1000, step: 1, get: (t) => t.offset[1] * 100, set: (t, v) => ({ ...t, offset: [t.offset[0], clamp(v / 100, -1000, 1000)] }) },
  { key: "sx", label: "Space across %", min: 0, max: MAX_SPACING * 100, step: 1, tiled: true, get: (t) => t.spacing[0] * 100, set: (t, v) => ({ ...t, spacing: [clamp(v / 100, 0, MAX_SPACING), t.spacing[1]] }) },
  { key: "sy", label: "Space down %", min: 0, max: MAX_SPACING * 100, step: 1, tiled: true, get: (t) => t.spacing[1] * 100, set: (t, v) => ({ ...t, spacing: [t.spacing[0], clamp(v / 100, 0, MAX_SPACING)] }) },
];

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
  const rows = FIELDS.map((f) => `<div class="adj-row" data-tex-row="${f.key}"${f.tiled ? " data-tiled" : ""}><label class="adj-label" for="tex-${f.key}">${f.label}</label><span></span><input type="number" class="adj-num" id="tex-${f.key}" data-tex-num="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" aria-label="${f.label}"></div>`).join("");
  const select = (key: string, label: string, items: ReadonlyArray<readonly [string, string]>): string =>
    `<div class="adj-row" data-tex-row="${key}"${key === "mode" ? "" : " data-tiled"}><label class="adj-label" for="tex-${key}">${label}</label><select id="tex-${key}" data-tex-sel="${key}" aria-label="${label}">${items.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select><span></span></div>`;
  el.innerHTML = `
    <div class="tex-source">
      ${o.kind === "image" ? `<button type="button" class="colour-save is-first" data-tex-lib>Choose from the library…</button>` : ""}
      <button type="button" class="colour-save" data-tex-pick>${o.kind === "image" ? "Pick a picture on the canvas" : "Pick the objects on the canvas"}</button>
      ${o.kind === "image" ? `<button type="button" class="colour-save" data-tex-file>Choose a file…</button><input type="file" accept="image/*" hidden data-tex-input>` : ""}
      <p class="op-note" data-tex-note role="status"></p>
    </div>
    <div class="tex-fields">
      <div class="tex-random"><button type="button" class="colour-save" data-tex-random title="Randomize the options: scale, turn, place, space and grid">${ICONS.dice5}<span>Randomize</span></button></div>
      ${o.kind === "image" ? select("mode", "Mode", TEXTURE_MODES.map((m) => [m, LABEL[m]] as const)) : ""}
      ${rows}
      ${select("tile", "Grid", TILE_TYPES.map((m) => [m, TILE_LABEL[m]] as const))}
      ${select("align", "Align", TILE_ALIGNS.map((m) => [m, ALIGN_LABEL[m]] as const))}
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
    for (const f of FIELDS) {
      const i = q<HTMLInputElement>(`[data-tex-num="${f.key}"]`);
      if (document.activeElement !== i) i.value = String(Math.round(f.get(t) * 100) / 100);
    }
    const sel = (k: string): HTMLSelectElement | null => el.querySelector<HTMLSelectElement>(`[data-tex-sel="${k}"]`);
    if (sel("mode")) sel("mode")!.value = t.mode;
    sel("tile")!.value = t.tile;
    sel("align")!.value = t.align;
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
      },
      true,
    );
  });
  const change = (next: TexturePaint, final: boolean): void => {
    t = next;
    sync();
    (final ? o.onChange : o.onInput)(next);
  };
  el.addEventListener("input", (e) => {
    const i = (e.target as HTMLElement).closest<HTMLInputElement>("[data-tex-num]");
    const f = i && FIELDS.find((x) => x.key === i.dataset["texNum"]);
    if (t && f && i.value !== "" && Number.isFinite(Number(i.value))) change(f.set(t, Number(i.value)), false);
  });
  el.addEventListener("change", (e) => {
    const target = e.target as HTMLElement;
    const i = target.closest<HTMLInputElement>("[data-tex-num]");
    const s = target.closest<HTMLSelectElement>("[data-tex-sel]");
    if (!t) return;
    if (i) {
      const f = FIELDS.find((x) => x.key === i.dataset["texNum"])!;
      if (i.value === "" || !Number.isFinite(Number(i.value))) return sync();
      change(f.set(t, Number(i.value)), true);
    } else if (s) {
      const v = s.value;
      change(s.dataset["texSel"] === "mode" ? { ...t, mode: v as TextureMode } : s.dataset["texSel"] === "tile" ? { ...t, tile: v as TileType } : { ...t, align: v as TileAlign }, true);
    }
  });
  sync();
  return { el, destroy: () => el.remove() };
}
