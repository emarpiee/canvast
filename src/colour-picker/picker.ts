/**
 * A colour picker with no dependencies: OKHSL, OKHSV or OKHCL, in four layouts (a hue ring around a box, a plane with a hue bar,
 * sliders, or the ring with sliders under it), with optional transparency, hex / rgb() / oklch() text, an eyedropper, a contrast
 * readout and colour harmonies. It imports only `./colour` and `./style`, so the folder can be copied into another project as it is.
 * Everything it looks like comes from `--cp-*` custom properties, everything it says from `labels`, and it never touches storage:
 * the host keeps the model, the layout and the recent colours if it wants them (onModel, onView, onFormat, onChange).
 *
 *   const picker = createColourPicker({ value: "#2563eb", alpha: true, onInput: (c) => preview(c), onChange: (c) => save(c) });
 *   container.append(picker.el);
 *
 * A colour is "#rrggbb", or "#rrggbbaa" when `alpha` is on and the colour is not opaque. `onInput` fires on every step of a drag or
 * key press (at most as often as the hands move), `onChange` once when the gesture ends.
 * Speed: see docs/performance.md. Drawing a box costs about 1.4 ms and only when the hue or the model changes; the ring and the
 * slider tracks are CSS gradients, so a drag does no pixel work except the box.
 */
import { copyToClipboard, flashCopied, onLongPress } from "./press";
import {
  HARMONIES,
  MODELS,
  TEXT_FORMATS,
  colourToHex,
  contrastRatio,
  convert,
  formatColour,
  fromRgb,
  paintPlane,
  parseColour,
  rgbToHex,
  toRgb,
  type Colour,
  type Harmony,
  type Model,
  type Rgb,
  type TextFormat,
  type Triple,
} from "./colour";
import { ensureStyles } from "./style";
import { scrubNumbers } from "./scrub";

export type View = "wheel" | "plane" | "sliders" | "mixer";
export const VIEWS: readonly View[] = ["wheel", "plane", "sliders", "mixer"];

export interface Labels {
  models: Record<Model, string>;
  views: Record<View, string>;
  /** Names of the three channels per model: [hue, second, third]. */
  channels: Record<Model, readonly [string, string, string]>;
  formats: Record<TextFormat, string>;
  harmonies: Record<Harmony, string>;
  modelGroup: string;
  layout: string;
  format: string;
  hue: string;
  box: string;
  plane: string;
  alpha: string;
  text: string;
  eyedropper: string;
  before: string;
  after: string;
  /** The grade of a contrast ratio below every WCAG level. */
  fail: string;
  /** The contrast line: "4.52:1", the grade ("AA"), the colour compared with. */
  contrast: (ratio: string, grade: string, against: string) => string;
  /** The name of a field for a screen reader, from the channel's name. */
  field: (name: string) => string;
}

export interface SwatchGroup {
  label: string;
  colours: readonly string[];
}

export interface PickerOptions {
  value?: string;
  model?: Model;
  view?: View;
  /** The layouts the switch offers (default all four). */
  views?: readonly View[];
  /** Offer transparency: a fourth slider, and values like "#2563eb80" (default false: colours are opaque). */
  alpha?: boolean;
  /** How the text field shows the colour (default "hex"); any format is accepted when typing. */
  format?: TextFormat;
  /** A button that picks a colour from the screen, where the browser has the EyeDropper API (default true; hidden where it is missing). */
  eyedropper?: boolean;
  /** Show the WCAG contrast of the colour against this one ("#ffffff"). */
  contrast?: string;
  /** Show these colour harmonies of the current colour, as swatches that follow it. */
  harmony?: readonly Harmony[];
  /** Side of the hue ring in CSS px (default 232); every layout is this wide. */
  size?: number;
  groups?: readonly SwatchGroup[];
  labels?: Partial<Labels>;
  /** The CSS colour to show a stored colour as (a host that maps one colour to a theme colour does it here). */
  display?: (hex: string) => string;
  onInput?: (hex: string) => void;
  onChange?: (hex: string) => void;
  onModel?: (model: Model) => void;
  onView?: (view: View) => void;
  onFormat?: (format: TextFormat) => void;
  /** A swatch was long-pressed, right-clicked or copied with Ctrl/Cmd+C: its colour (`#RRGGBB`) is on the clipboard and was not chosen. */
  onCopy?: (text: string) => void;
  /** Add the stylesheet to the document (default true); a host that includes PICKER_CSS itself passes false. */
  injectStyles?: boolean;
}

export interface ColourPicker {
  readonly el: HTMLElement;
  /** The current colour, "#rrggbb" or "#rrggbbaa". */
  readonly value: string;
  /** Show a colour from outside (does not fire onInput/onChange). `asOriginal` also makes it the "before" half of the preview. */
  setValue(text: string, asOriginal?: boolean): void;
  setModel(model: Model): void;
  setView(view: View): void;
  setFormat(format: TextFormat): void;
  setGroups(groups: readonly SwatchGroup[]): void;
  destroy(): void;
}

const DEFAULT_LABELS: Labels = {
  models: { okhsl: "OKHSL", okhsv: "OKHSV", okhcl: "OKHCL" },
  views: { wheel: "Ring and box", plane: "Plane and bar", sliders: "Sliders", mixer: "Ring and sliders" },
  channels: { okhsl: ["Hue", "Saturation", "Lightness"], okhsv: ["Hue", "Saturation", "Value"], okhcl: ["Hue", "Chroma", "Lightness"] },
  formats: { hex: "HEX", rgb: "RGB", oklch: "OKLCH" },
  harmonies: { complementary: "Complement", split: "Split", triad: "Triad", analogous: "Analogous", tetrad: "Tetrad" },
  modelGroup: "Colour model",
  layout: "Layout",
  format: "Text format",
  hue: "Hue",
  box: "Colour area",
  plane: "Colour plane",
  alpha: "Opacity",
  text: "Colour",
  eyedropper: "Pick a colour from the screen",
  before: "Before: click to go back to it",
  after: "Now",
  fail: "Fail",
  contrast: (ratio, grade, against) => `Contrast with ${against}: ${ratio}:1 ${grade}`,
  field: (name) => name,
};

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const css = (rgb: readonly number[]): string => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

// What the ring and the hue slider show for each model: hue at a fixed second and third channel.
const HUE_REF: Record<Model, readonly [number, number]> = { okhsl: [0.9, 0.65], okhsv: [0.85, 0.95], okhcl: [0.9, 0.72] };
const RING = 0.1; // the ring's thickness, as a fraction of the size
const GAP = 0.025; // between the ring and the box
const BOX_PX = 80; // the ring's box is painted at this many pixels a side and stretched
const PLANE_W = 104; // the plane is painted at this size and stretched
const PLANE_H = 64;
const PLANE_RATIO = 0.62; // its height as a fraction of its width
const STOPS = 13;
const RING_STEP = 4; // degrees between the ring's gradient stops

const EYE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12"/><path d="m18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z"/><path d="m2 22 .414-.414"/></svg>';

const grade = (r: number, fail: string): string => (r >= 7 ? "AAA" : r >= 4.5 ? "AA" : r >= 3 ? "AA large" : fail);

export function createColourPicker(options: PickerOptions = {}): ColourPicker {
  if (options.injectStyles !== false) ensureStyles();
  const L: Labels = { ...DEFAULT_LABELS, ...options.labels };
  const size = options.size ?? 232;
  const display = options.display ?? ((h: string) => h);
  const useAlpha = options.alpha === true;
  const views = (options.views?.length ? options.views : VIEWS).filter((v) => VIEWS.includes(v));
  const harmony = options.harmony ?? [];
  const contrastWith = options.contrast ? parseColour(options.contrast) : null;
  const eye = options.eyedropper !== false && typeof window !== "undefined" && "EyeDropper" in window;

  let model: Model = options.model ?? "okhsv";
  let view: View = views.includes(options.view ?? "wheel") ? (options.view ?? "wheel") : views[0]!;
  let format: TextFormat = options.format ?? "hex";
  let groups = options.groups ?? [];
  let tri: Triple = { h: 200, s: 0.7, x: 0.7 };
  let alpha = 1;
  let original = "#000000";
  let hex = "#000000";
  let emitted = "";
  let committed = "";
  let destroyed = false;

  const start = parseColour(options.value ?? "#2563eb") ?? { rgb: [37, 99, 235] as Rgb, alpha: 1 };
  alpha = useAlpha ? start.alpha : 1;
  hex = colourToHex({ rgb: start.rgb, alpha });
  original = hex;
  tri = fromRgb(model, start.rgb[0], start.rgb[1], start.rgb[2], 200);

  const root = document.createElement("div");
  root.className = "cp";
  root.style.setProperty("--cp-size", `${size}px`);
  root.dataset["view"] = view;
  root.dataset["alpha"] = String(useAlpha);

  const row = (i: number): string =>
    `<div class="cp-field" data-row="${i}"><label data-label="${i}"></label><input type="range" class="cp-slider" data-slider="${i}" min="0" max="${i === 0 ? 360 : 100}" step="1"><input type="number" class="cp-num" data-num="${i}" min="0" max="${i === 0 ? 360 : 100}" step="1" inputmode="numeric"></div>`;
  root.innerHTML = `
    <div class="cp-bar">
      <div class="cp-seg" role="radiogroup" aria-label="${esc(L.modelGroup)}">${MODELS.map((m) => `<button type="button" role="radio" data-model="${m}">${esc(L.models[m])}</button>`).join("")}</div>
      <div class="cp-row">
        <select class="cp-select cp-view" data-view-select aria-label="${esc(L.layout)}">${views.map((v) => `<option value="${v}">${esc(L.views[v])}</option>`).join("")}</select>
        ${eye ? `<button type="button" class="cp-tool" data-eye title="${esc(L.eyedropper)}" aria-label="${esc(L.eyedropper)}">${EYE}</button>` : ""}
      </div>
    </div>
    <div class="cp-wheel" data-wheel>
      <div class="cp-ring" data-ring></div>
      <canvas class="cp-box" data-box width="${BOX_PX}" height="${BOX_PX}"></canvas>
      <div class="cp-area" data-area tabindex="0" role="application" aria-roledescription="${esc(L.box)}" aria-label="${esc(L.box)}"></div>
      <div class="cp-hue" data-hue tabindex="0" role="slider" aria-label="${esc(L.hue)}" aria-valuemin="0" aria-valuemax="360"></div>
      <span class="cp-thumb" data-hue-thumb></span>
      <span class="cp-thumb" data-area-thumb></span>
    </div>
    <div class="cp-plane" data-plane>
      <canvas class="cp-plane-box" data-plane-box width="${PLANE_W}" height="${PLANE_H}"></canvas>
      <div class="cp-area" data-plane-area tabindex="0" role="application" aria-roledescription="${esc(L.plane)}" aria-label="${esc(L.plane)}"></div>
      <span class="cp-thumb" data-plane-thumb></span>
    </div>
    <div class="cp-fields">${[0, 1, 2].map(row).join("")}</div>
    <div class="cp-nums">${[0, 1, 2].map((i) => `<label class="cp-numcell"><span data-nlabel="${i}"></span><input type="number" class="cp-num" data-strip="${i}" min="0" max="${i === 0 ? 360 : 100}" step="1" inputmode="numeric"></label>`).join("")}</div>
    <div class="cp-field cp-alpha"><label data-alpha-label title="${esc(L.alpha)}">A</label><input type="range" class="cp-slider" data-alpha-slider min="0" max="100" step="1" aria-label="${esc(L.alpha)}"><input type="number" class="cp-num" data-alpha-num min="0" max="100" step="1" inputmode="numeric" aria-label="${esc(L.alpha)}"></div>
    <div class="cp-value">
      <div class="cp-preview"><button type="button" class="cp-before" data-before title="${esc(L.before)}" aria-label="${esc(L.before)}"></button><span class="cp-after" title="${esc(L.after)}"></span></div>
      <label class="cp-hex"><span data-hash aria-hidden="true">#</span><input type="text" data-hex spellcheck="false" autocomplete="off" aria-label="${esc(L.text)}"></label>
      <select class="cp-select cp-fmt" data-format aria-label="${esc(L.format)}">${TEXT_FORMATS.map((f) => `<option value="${f}">${esc(L.formats[f])}</option>`).join("")}</select>
    </div>
    <div class="cp-contrast" data-contrast></div>
    <div class="cp-groups" data-harmony></div>
    <div class="cp-groups" data-groups></div>`;

  scrubNumbers(root);
  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const wheel = q<HTMLElement>("[data-wheel]");
  const ring = q<HTMLElement>("[data-ring]");
  const box = q<HTMLCanvasElement>("[data-box]");
  const area = q<HTMLElement>("[data-area]");
  const hueEl = q<HTMLElement>("[data-hue]");
  const hueThumb = q<HTMLElement>("[data-hue-thumb]");
  const areaThumb = q<HTMLElement>("[data-area-thumb]");
  const plane = q<HTMLElement>("[data-plane]");
  const planeBox = q<HTMLCanvasElement>("[data-plane-box]");
  const planeArea = q<HTMLElement>("[data-plane-area]");
  const planeThumb = q<HTMLElement>("[data-plane-thumb]");
  const sliders = [0, 1, 2].map((i) => q<HTMLInputElement>(`[data-slider="${i}"]`));
  const rowNums = [0, 1, 2].map((i) => q<HTMLInputElement>(`[data-num="${i}"]`));
  const stripNums = [0, 1, 2].map((i) => q<HTMLInputElement>(`[data-strip="${i}"]`));
  const labels = [0, 1, 2].map((i) => q<HTMLLabelElement>(`[data-label="${i}"]`));
  const stripLabels = [0, 1, 2].map((i) => q<HTMLElement>(`[data-nlabel="${i}"]`));
  const alphaSlider = q<HTMLInputElement>("[data-alpha-slider]");
  const alphaNum = q<HTMLInputElement>("[data-alpha-num]");
  const hexInput = q<HTMLInputElement>("[data-hex]");
  const hash = q<HTMLElement>("[data-hash]");
  const formatSel = q<HTMLSelectElement>("[data-format]");
  const viewSel = q<HTMLSelectElement>("[data-view-select]");
  const beforeBtn = q<HTMLButtonElement>("[data-before]");
  const afterEl = q<HTMLElement>(".cp-after");
  const contrastEl = q<HTMLElement>("[data-contrast]");
  const harmonyEl = q<HTMLElement>("[data-harmony]");
  const groupsEl = q<HTMLElement>("[data-groups]");

  // ---- Geometry --------------------------------------------------------------------------------------------------------------
  const boxSide = (): number => Math.floor((0.5 - RING - GAP) * 2 * Math.SQRT1_2 * size);
  const planeH = (): number => Math.round(size * PLANE_RATIO);
  const place = (): void => {
    const side = boxSide();
    const off = (size - side) / 2;
    for (const el of [box, area]) {
      el.style.left = `${off}px`;
      el.style.top = `${off}px`;
      el.style.width = `${side}px`;
      el.style.height = `${side}px`;
    }
    plane.style.height = `${planeH()}px`;
    paintRing();
  };

  /** The ring is one CSS conic gradient: crisp at any pixel ratio and nothing to paint when the hue moves. */
  function paintRing(): void {
    const [s, x] = HUE_REF[model];
    const stops: string[] = [];
    for (let h = 0; h <= 360; h += RING_STEP) stops.push(`${css(toRgb(model, h, s, x))} ${h}deg`);
    ring.style.background = `conic-gradient(from 90deg, ${stops.join(", ")})`;
  }

  // The boxes are painted by paintPlane into one reused buffer; only when the hue (to a quarter degree) or the model changed.
  const boxData = new ImageData(BOX_PX, BOX_PX);
  const planeData = new ImageData(PLANE_W, PLANE_H);
  let boxFrame = 0;
  let boxKey = "";
  function paintBoxes(): void {
    boxFrame = 0;
    const key = `${model}:${Math.round(tri.h * 4)}:${view}`;
    if (key === boxKey) return;
    boxKey = key;
    const active = view === "plane" ? planeBox : box;
    const data = view === "plane" ? planeData : boxData;
    paintPlane(model, tri.h, data.width, data.height, data.data);
    active.getContext("2d")?.putImageData(data, 0, 0);
  }
  const scheduleBox = (): void => {
    if (!boxFrame) boxFrame = requestAnimationFrame(paintBoxes);
  };

  // ---- Showing the state -----------------------------------------------------------------------------------------------------
  const tracks = ["", "", "", ""];
  const setTrack = (i: number, el: HTMLInputElement, value: string): void => {
    if (tracks[i] === value) return;
    tracks[i] = value;
    el.style.setProperty("--cp-track", value);
  };
  const ramp = (at: (t: number) => Rgb): string => {
    const stops: string[] = [];
    for (let k = 0; k < STOPS; k++) {
      const t = k / (STOPS - 1);
      stops.push(`${css(at(t))} ${Math.round(t * 100)}%`);
    }
    return `linear-gradient(to right, ${stops.join(", ")})`;
  };

  const colour = (): Colour => ({ rgb: toRgb(model, tri.h, tri.s, tri.x), alpha });

  /** What changes only with the model: the channel names, the ring. */
  function showModel(): void {
    const names = L.channels[model];
    for (let i = 0; i < 3; i++) {
      labels[i]!.textContent = stripLabels[i]!.textContent = names[i]![0]!;
      labels[i]!.title = names[i]!;
      for (const el of [sliders[i]!, rowNums[i]!, stripNums[i]!]) el.setAttribute("aria-label", L.field(names[i]!));
    }
    for (const b of root.querySelectorAll<HTMLElement>("[data-model]")) b.setAttribute("aria-checked", String(b.dataset["model"] === model));
    tracks.fill("");
  }

  function show(skip?: HTMLElement): void {
    const c = colour();
    hex = useAlpha ? colourToHex(c) : rgbToHex(c.rgb);
    const shown = display(hex);
    const solid = css(c.rgb);
    const values = [tri.h, tri.s * 100, tri.x * 100];
    const rgbHex = rgbToHex(c.rgb);
    for (let i = 0; i < 3; i++) {
      const v = String(Math.round(values[i]!));
      sliders[i]!.value = v;
      if (document.activeElement !== rowNums[i]) rowNums[i]!.value = v;
      if (document.activeElement !== stripNums[i]) stripNums[i]!.value = v;
      sliders[i]!.style.setProperty("--cp-thumb-fill", solid);
    }
    // A track is rewritten only when what it shows changed (the hue track with the model; the others with the other channels).
    setTrack(0, sliders[0]!, ramp((t) => toRgb(model, t * 360, HUE_REF[model][0], HUE_REF[model][1])));
    setTrack(1, sliders[1]!, ramp((t) => toRgb(model, tri.h, t, tri.x)));
    setTrack(2, sliders[2]!, ramp((t) => toRgb(model, tri.h, tri.s, t)));
    if (useAlpha) {
      const a = String(Math.round(alpha * 100));
      alphaSlider.value = a;
      if (document.activeElement !== alphaNum) alphaNum.value = a;
      setTrack(3, alphaSlider, `linear-gradient(to right, rgba(${c.rgb[0]},${c.rgb[1]},${c.rgb[2]},0), ${solid}), var(--cp-check)`);
      alphaSlider.style.setProperty("--cp-thumb-fill", shown);
    }
    if (skip !== hexInput) {
      const text = formatColour(c.alpha < 1 && !useAlpha ? { rgb: c.rgb, alpha: 1 } : c, format);
      hexInput.value = format === "hex" ? text.slice(1).toUpperCase() : text;
    }
    afterEl.style.background = shown;
    beforeBtn.style.background = display(original);
    root.style.setProperty("--cp-current", shown);

    const rad = (tri.h * Math.PI) / 180;
    const rMid = (0.5 - RING / 2) * size;
    hueThumb.style.transform = `translate(${size / 2 + Math.cos(rad) * rMid}px, ${size / 2 + Math.sin(rad) * rMid}px)`;
    hueThumb.style.background = css(toRgb(model, tri.h, HUE_REF[model][0], HUE_REF[model][1]));
    const side = boxSide();
    const off = (size - side) / 2;
    areaThumb.style.transform = `translate(${off + tri.s * side}px, ${off + (1 - tri.x) * side}px)`;
    areaThumb.style.background = solid;
    planeThumb.style.transform = `translate(${tri.s * size}px, ${(1 - tri.x) * planeH()}px)`;
    planeThumb.style.background = solid;
    hueEl.setAttribute("aria-valuenow", String(Math.round(tri.h)));
    hueEl.setAttribute("aria-valuetext", `${Math.round(tri.h)}°`);
    const names = L.channels[model];
    const text = `${names[1]} ${Math.round(tri.s * 100)}%, ${names[2]} ${Math.round(tri.x * 100)}%`;
    area.setAttribute("aria-valuetext", text);
    planeArea.setAttribute("aria-valuetext", text);
    scheduleBox();
    for (const b of groupsEl.querySelectorAll<HTMLElement>("[data-c]")) b.classList.toggle("is-on", b.dataset["c"] === hex);
    if (contrastWith) {
      const bg = contrastWith.rgb;
      const over: Rgb = [0, 1, 2].map((i) => Math.round(c.rgb[i]! * alpha + bg[i]! * (1 - alpha))) as unknown as Rgb;
      const r = contrastRatio(over, bg);
      contrastEl.textContent = L.contrast((Math.round(r * 100) / 100).toString(), grade(r, L.fail), rgbToHex(bg));
    }
    if (harmony.length) scheduleHarmony(rgbHex);
  }

  let harmonyFrame = 0;
  function scheduleHarmony(base: string): void {
    if (harmonyFrame) return;
    harmonyFrame = requestAnimationFrame(() => {
      harmonyFrame = 0;
      const rgb = parseColour(base)!.rgb;
      const t = fromRgb("okhcl", rgb[0], rgb[1], rgb[2], tri.h);
      const wanted = harmony.map((k) => ({ k, colours: HARMONIES[k].map((d) => rgbToHex(toRgb("okhcl", t.h + d, t.s, t.x))) }));
      if (harmonyEl.childElementCount !== wanted.length) {
        harmonyEl.innerHTML = wanted.map((w) => `<div class="cp-group" data-k="${w.k}"><div class="cp-group-h">${esc(L.harmonies[w.k])}</div><div class="cp-swatches"></div></div>`).join("");
      }
      wanted.forEach((w, gi) => {
        const wrap = harmonyEl.children[gi]!.querySelector(".cp-swatches")!;
        const all = [base, ...w.colours];
        while (wrap.childElementCount < all.length) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "cp-swatch";
          wrap.append(b);
        }
        all.forEach((c, i) => {
          const b = wrap.children[i] as HTMLElement;
          b.dataset["c"] = c;
          b.title = b.ariaLabel = c.toUpperCase();
          b.style.background = display(c);
        });
      });
    });
  }

  function renderGroups(): void {
    groupsEl.innerHTML = groups
      .filter((g) => g.colours.length)
      .map(
        (g) => `<div class="cp-group"><div class="cp-group-h">${esc(g.label)}</div><div class="cp-swatches">${g.colours
          .map((c) => `<button type="button" class="cp-swatch" data-c="${esc(c.toLowerCase())}" title="${esc(c.toUpperCase())}" aria-label="${esc(c.toUpperCase())}" style="background:${esc(display(c.toLowerCase()))}"></button>`)
          .join("")}</div></div>`,
      )
      .join("");
  }

  // ---- Changing the colour ---------------------------------------------------------------------------------------------------
  function input(skip?: HTMLElement): void {
    show(skip);
    if (hex !== emitted) {
      emitted = hex;
      options.onInput?.(hex);
    }
  }
  function commit(): void {
    if (hex === committed) return;
    committed = hex;
    options.onChange?.(hex);
  }
  const setTriple = (t: Partial<Triple>, skip?: HTMLElement): void => {
    tri = { h: clamp(t.h ?? tri.h, 0, 360), s: clamp(t.s ?? tri.s, 0, 1), x: clamp(t.x ?? tri.x, 0, 1) };
    if (tri.h === 360) tri.h = 0;
    input(skip);
  };
  const setAlpha = (a: number, skip?: HTMLElement): void => {
    alpha = clamp(a, 0, 1);
    input(skip);
  };
  function setText(text: string, skip?: HTMLElement): boolean {
    const c = parseColour(text);
    if (!c) return false;
    tri = fromRgb(model, c.rgb[0], c.rgb[1], c.rgb[2], tri.h);
    if (useAlpha && !/^#?[0-9a-f]{3}$|^#?[0-9a-f]{6}$/i.test(text.trim())) alpha = c.alpha;
    input(skip);
    return true;
  }

  // ---- Pointer and key handling ----------------------------------------------------------------------------------------------
  type Mode = "hue" | "area";
  let mode: Mode | null = null;
  let activeArea: HTMLElement = area;
  const apply = (e: PointerEvent): void => {
    if (mode === "hue") {
      const r = wheel.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      setTriple({ h: ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360 });
    } else if (mode === "area") {
      const a = activeArea.getBoundingClientRect();
      setTriple({ s: (e.clientX - a.left) / a.width, x: 1 - (e.clientY - a.top) / a.height });
    }
  };
  wheel.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const r = wheel.getBoundingClientRect();
    const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    const a = area.getBoundingClientRect();
    const inBox = e.clientX >= a.left && e.clientX <= a.right && e.clientY >= a.top && e.clientY <= a.bottom;
    // The ring is the outer 10%; the grab zone reaches into the gap, so a thin ring is easy to hit.
    mode = inBox ? "area" : d >= (0.5 - RING - GAP) * r.width ? "hue" : null;
    if (!mode) return;
    activeArea = area;
    wheel.setPointerCapture(e.pointerId);
    (mode === "hue" ? hueEl : area).focus({ preventScroll: true });
    e.preventDefault();
    apply(e);
  });
  plane.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    mode = "area";
    activeArea = planeArea;
    plane.setPointerCapture(e.pointerId);
    planeArea.focus({ preventScroll: true });
    e.preventDefault();
    apply(e);
  });
  for (const el of [wheel, plane]) {
    el.addEventListener("pointermove", (e) => {
      if (mode) apply(e);
    });
    const end = (): void => {
      if (!mode) return;
      mode = null;
      commit();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  const step = (e: KeyboardEvent, unit: number): number => (e.shiftKey ? unit * 10 : e.altKey ? unit / 10 : unit);
  hueEl.addEventListener("keydown", (e) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "PageUp" ? 15 : e.key === "PageDown" ? -15 : 0;
    if (!dir) return;
    e.preventDefault();
    setTriple({ h: (tri.h + dir * (Math.abs(dir) === 15 ? 1 : step(e, 1)) + 360) % 360 });
    commit();
  });
  for (const el of [area, planeArea]) {
    el.addEventListener("keydown", (e) => {
      const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      const dy = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
      if (!dx && !dy) return;
      e.preventDefault();
      const u = step(e, 0.01);
      setTriple({ s: tri.s + dx * u, x: tri.x + dy * u });
      commit();
    });
  }

  sliders.forEach((s, i) => {
    s.addEventListener("input", () => setTriple(i === 0 ? { h: Number(s.value) } : i === 1 ? { s: Number(s.value) / 100 } : { x: Number(s.value) / 100 }));
    s.addEventListener("change", commit);
  });
  [rowNums, stripNums].forEach((set) =>
    set.forEach((n, i) => {
      n.addEventListener("input", () => {
        const v = Number(n.value);
        if (n.value === "" || !Number.isFinite(v)) return;
        setTriple(i === 0 ? { h: v % 360 } : i === 1 ? { s: v / 100 } : { x: v / 100 }, n);
      });
      n.addEventListener("change", () => {
        show();
        commit();
      });
      n.addEventListener("blur", () => show());
    }),
  );
  alphaSlider.addEventListener("input", () => setAlpha(Number(alphaSlider.value) / 100));
  alphaSlider.addEventListener("change", commit);
  alphaNum.addEventListener("input", () => {
    if (alphaNum.value !== "" && Number.isFinite(Number(alphaNum.value))) setAlpha(Number(alphaNum.value) / 100, alphaNum);
  });
  alphaNum.addEventListener("change", () => {
    show();
    commit();
  });

  hexInput.addEventListener("input", () => {
    const v = hexInput.value.trim();
    if (v && parseColour(format === "hex" && /^[0-9a-f]+$/i.test(v) ? `#${v}` : v)) setText(v, hexInput);
  });
  // The # is in front of the field, not in it: a copy of the whole value takes it along, a paste leaves it out.
  const whole = (): boolean => hexInput.selectionStart === 0 && hexInput.selectionEnd === hexInput.value.length && /^[0-9a-f]+$/i.test(hexInput.value);
  for (const kind of ["copy", "cut"] as const)
    hexInput.addEventListener(kind, (e) => {
      if (format !== "hex" || !whole()) return;
      e.clipboardData?.setData("text/plain", `#${hexInput.value.toUpperCase()}`);
      e.preventDefault();
      if (kind === "cut") {
        hexInput.value = "";
        hexInput.dispatchEvent(new Event("input"));
      }
    });
  hexInput.addEventListener("paste", (e) => {
    const text = (e.clipboardData?.getData("text/plain") ?? "").trim();
    if (format !== "hex" || !/^#[0-9a-f]{3,8}$/i.test(text)) return;
    e.preventDefault();
    hexInput.setRangeText(text.slice(1).toUpperCase(), hexInput.selectionStart ?? 0, hexInput.selectionEnd ?? 0, "end");
    hexInput.dispatchEvent(new Event("input"));
  });
  hexInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (setText(hexInput.value)) commit();
      else show();
    }
  });
  hexInput.addEventListener("blur", () => {
    if (!setText(hexInput.value)) show();
    else commit();
  });
  const syncFormat = (): void => {
    formatSel.value = format;
    root.dataset["format"] = format;
    hash.hidden = format !== "hex";
    hexInput.classList.toggle("is-long", format !== "hex");
  };
  formatSel.addEventListener("change", () => {
    format = formatSel.value as TextFormat;
    syncFormat();
    show();
    options.onFormat?.(format);
  });

  beforeBtn.addEventListener("click", () => {
    if (setText(original)) commit();
  });
  const pickSwatch = (e: Event): void => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-c]");
    if (b && setText(b.dataset["c"]!)) commit();
  };
  // A swatch is copied (as #RRGGBB) by a long press, a right click or Ctrl/Cmd+C, and is not chosen.
  for (const area of [groupsEl, harmonyEl])
    onLongPress(area, "[data-c]", (b) => {
      const text = `#${b.dataset["c"]!.replace("#", "").toUpperCase()}`;
      void copyToClipboard(text).then((ok) => {
        if (!ok) return;
        flashCopied(b);
        options.onCopy?.(text);
      });
    });
  groupsEl.addEventListener("click", pickSwatch);
  harmonyEl.addEventListener("click", pickSwatch);
  root.querySelector("[data-eye]")?.addEventListener("click", async () => {
    try {
      const r = await new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper().open();
      if (!destroyed && setText(r.sRGBHex)) commit();
    } catch {
      // closed without a pick
    }
  });

  const setModel = (m: Model, notify = false): void => {
    if (m === model) return;
    tri = convert(model, m, tri);
    model = m;
    boxKey = "";
    paintRing();
    showModel();
    show();
    if (notify) options.onModel?.(m);
  };
  const setView = (v: View, notify = false): void => {
    if (v === view || !views.includes(v)) return;
    view = v;
    root.dataset["view"] = v;
    viewSel.value = v;
    boxKey = "";
    show();
    if (notify) options.onView?.(v);
  };
  viewSel.addEventListener("change", () => setView(viewSel.value as View, true));
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-model]");
    if (b) setModel(b.dataset["model"] as Model, true);
  });
  root.addEventListener("keydown", (e) => {
    const seg = (e.target as HTMLElement).closest<HTMLElement>(".cp-seg");
    if (!seg || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    const btns = [...seg.querySelectorAll<HTMLElement>("button")];
    const next = btns[(btns.indexOf(e.target as HTMLElement) + (e.key === "ArrowRight" ? 1 : -1) + btns.length) % btns.length]!;
    e.preventDefault();
    next.click();
    next.focus();
  });

  // Unique ids so a slider's label can name it.
  const uid = `cp${Math.random().toString(36).slice(2, 8)}`;
  sliders.forEach((s, i) => (s.id = `${uid}-s${i}`));
  labels.forEach((l, i) => (l.htmlFor = `${uid}-s${i}`));
  alphaSlider.id = `${uid}-a`;
  q<HTMLLabelElement>("[data-alpha-label]").htmlFor = alphaSlider.id;

  place();
  renderGroups();
  syncFormat();
  viewSel.value = view;
  showModel();
  show();
  emitted = committed = hex;

  return {
    el: root,
    get value() {
      return hex;
    },
    setValue(text, asOriginal = false) {
      const c = parseColour(text);
      if (!c) return;
      const next = colourToHex({ rgb: c.rgb, alpha: useAlpha ? c.alpha : 1 });
      if (asOriginal) original = next;
      if (next !== hex) {
        tri = fromRgb(model, c.rgb[0], c.rgb[1], c.rgb[2], tri.h);
        alpha = useAlpha ? c.alpha : 1;
        emitted = next;
      }
      committed = next;
      show();
    },
    setModel: (m) => setModel(m),
    setView: (v) => setView(v),
    setFormat(f) {
      format = f;
      syncFormat();
      show();
    },
    setGroups(g) {
      groups = g;
      renderGroups();
      show();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (boxFrame) cancelAnimationFrame(boxFrame);
      if (harmonyFrame) cancelAnimationFrame(harmonyFrame);
      root.remove();
    },
  };
}

export { MODELS, TEXT_FORMATS, type Model, type TextFormat, type Harmony } from "./colour";
