/**
 * A colour picker with no dependencies: OKHSL, OKHSV or OKHCL, as sliders or as a hue ring around a box. It imports only `./colour` and
 * `./style`, so the folder can be copied into another project as it is. Everything it looks like comes from `--cp-*` custom properties
 * (see style.ts and README.md), everything it says from `labels`, and it never touches storage: the host keeps the model, the view and
 * the recent colours if it wants them (onModel, onView, onChange).
 *
 *   const picker = createColourPicker({ value: "#2563eb", onInput: (hex) => preview(hex), onChange: (hex) => save(hex) });
 *   container.append(picker.el);
 *
 * A colour is "#rrggbb". `onInput` fires on every step of a drag or key press, `onChange` once when the gesture ends.
 */
import { MODELS, convert, fromRgb, hexToTriple, parseHex, rgbToHex, toRgb, tripleToHex, type Model, type Triple } from "./colour";
import { ensureStyles } from "./style";

export type View = "sliders" | "wheel";

export interface Labels {
  models: Record<Model, string>;
  views: Record<View, string>;
  /** Names of the three channels per model: [hue, second, third]. */
  channels: Record<Model, readonly [string, string, string]>;
  hue: string;
  box: string;
  hex: string;
  before: string;
  after: string;
  /** Called with the model's channel names, e.g. "Saturation". */
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
  /** Side of the hue ring in CSS px (default 208). */
  size?: number;
  groups?: readonly SwatchGroup[];
  labels?: Partial<Labels>;
  /** The CSS colour to show a stored colour as (a host that maps one colour to a theme colour does it here). */
  display?: (hex: string) => string;
  onInput?: (hex: string) => void;
  onChange?: (hex: string) => void;
  onModel?: (model: Model) => void;
  onView?: (view: View) => void;
  /** Add the stylesheet to the document (default true); a host that includes PICKER_CSS itself passes false. */
  injectStyles?: boolean;
}

export interface ColourPicker {
  readonly el: HTMLElement;
  /** The current colour, "#rrggbb". */
  readonly value: string;
  /** Show a colour from outside (does not fire onInput/onChange). `asOriginal` also makes it the "before" half of the preview. */
  setValue(hex: string, asOriginal?: boolean): void;
  setModel(model: Model): void;
  setView(view: View): void;
  setGroups(groups: readonly SwatchGroup[]): void;
  destroy(): void;
}

const DEFAULT_LABELS: Labels = {
  models: { okhsl: "OKHSL", okhsv: "OKHSV", okhcl: "OKHCL" },
  views: { sliders: "Sliders", wheel: "Wheel" },
  channels: { okhsl: ["Hue", "Saturation", "Lightness"], okhsv: ["Hue", "Saturation", "Value"], okhcl: ["Hue", "Chroma", "Lightness"] },
  hue: "Hue",
  box: "Colour area",
  hex: "Hex colour",
  before: "Before: click to go back to it",
  after: "Now",
  field: (name) => name,
};

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const css = (rgb: readonly number[]): string => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

// What the ring and the hue slider show for each model: hue at a fixed second and third channel.
const HUE_REF: Record<Model, readonly [number, number]> = { okhsl: [0.9, 0.65], okhsv: [0.85, 0.95], okhcl: [0.9, 0.72] };
const RING = 0.1; // the ring's thickness, as a fraction of the size
const GAP = 0.025; // between the ring and the box
const BOX_PX = 80; // the box is painted at this many pixels a side and stretched
const STOPS = 17;

export function createColourPicker(options: PickerOptions = {}): ColourPicker {
  if (options.injectStyles !== false) ensureStyles();
  const L: Labels = { ...DEFAULT_LABELS, ...options.labels };
  const size = options.size ?? 208;
  const display = options.display ?? ((h: string) => h);

  let model: Model = options.model ?? "okhsv";
  let view: View = options.view ?? "wheel";
  let groups = options.groups ?? [];
  let tri: Triple = { h: 200, s: 0.7, x: 0.7 };
  let original = "#000000";
  let hex = "#000000";
  let emitted = "";
  let committed = "";
  let destroyed = false;

  const start = parseHex(options.value ?? "#2563eb") ?? [37, 99, 235];
  hex = rgbToHex(start);
  original = hex;
  tri = fromRgb(model, start[0], start[1], start[2], 200);

  const root = document.createElement("div");
  root.className = "cp";
  root.style.setProperty("--cp-size", `${size}px`);
  root.dataset["view"] = view;

  const ch = (): readonly [string, string, string] => L.channels[model];
  root.innerHTML = `
    <div class="cp-bar">
      <div class="cp-seg" role="radiogroup" aria-label="Colour model" data-seg="model">${MODELS.map((m) => `<button type="button" role="radio" data-model="${m}">${esc(L.models[m])}</button>`).join("")}</div>
      <div class="cp-seg" role="radiogroup" aria-label="Picker" data-seg="view">${(["sliders", "wheel"] as const).map((v) => `<button type="button" role="radio" data-view="${v}">${esc(L.views[v])}</button>`).join("")}</div>
    </div>
    <div class="cp-wheel" data-wheel>
      <canvas class="cp-ring" data-ring></canvas>
      <canvas class="cp-box" data-box width="${BOX_PX}" height="${BOX_PX}"></canvas>
      <div class="cp-area" data-area tabindex="0" role="application" aria-roledescription="${esc(L.box)}" aria-label="${esc(L.box)}"></div>
      <div class="cp-hue" data-hue tabindex="0" role="slider" aria-label="${esc(L.hue)}" aria-valuemin="0" aria-valuemax="360"></div>
      <span class="cp-thumb" data-hue-thumb></span>
      <span class="cp-thumb" data-area-thumb></span>
    </div>
    <div class="cp-fields">${[0, 1, 2]
      .map((i) => `<div class="cp-field" data-row="${i}"><label data-label="${i}"></label><input type="range" class="cp-slider" data-slider="${i}" min="0" max="${i === 0 ? 360 : 100}" step="1"><input type="number" class="cp-num" data-num="${i}" min="0" max="${i === 0 ? 360 : 100}" step="1" inputmode="numeric"></div>`)
      .join("")}
    </div>
    <div class="cp-value">
      <div class="cp-preview"><button type="button" class="cp-before" data-before title="${esc(L.before)}" aria-label="${esc(L.before)}"></button><span class="cp-after" title="${esc(L.after)}"></span></div>
      <label class="cp-hex"><span aria-hidden="true">#</span><input type="text" data-hex maxlength="7" spellcheck="false" autocomplete="off" aria-label="${esc(L.hex)}"></label>
    </div>
    <div class="cp-groups" data-groups></div>`;

  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const wheel = q<HTMLElement>("[data-wheel]");
  const ring = q<HTMLCanvasElement>("[data-ring]");
  const box = q<HTMLCanvasElement>("[data-box]");
  const area = q<HTMLElement>("[data-area]");
  const hueEl = q<HTMLElement>("[data-hue]");
  const hueThumb = q<HTMLElement>("[data-hue-thumb]");
  const areaThumb = q<HTMLElement>("[data-area-thumb]");
  const sliders = [0, 1, 2].map((i) => q<HTMLInputElement>(`[data-slider="${i}"]`));
  const nums = [0, 1, 2].map((i) => q<HTMLInputElement>(`[data-num="${i}"]`));
  const labels = [0, 1, 2].map((i) => q<HTMLLabelElement>(`[data-label="${i}"]`));
  const hexInput = q<HTMLInputElement>("[data-hex]");
  const beforeBtn = q<HTMLButtonElement>("[data-before]");
  const afterEl = q<HTMLElement>(".cp-after");
  const groupsEl = q<HTMLElement>("[data-groups]");

  // ---- Geometry: the box is the square inside the ring ------------------------------------------------------------------------
  const boxSide = (): number => Math.floor((0.5 - RING - GAP) * 2 * Math.SQRT1_2 * size);
  const place = (): void => {
    const side = boxSide();
    const off = (size - side) / 2;
    for (const el of [box, area]) {
      el.style.left = `${off}px`;
      el.style.top = `${off}px`;
      el.style.width = `${side}px`;
      el.style.height = `${side}px`;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ring.width = ring.height = Math.round(size * dpr);
    paintRing();
  };

  function paintRing(): void {
    const n = ring.width;
    const ctx = ring.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(n, n);
    const c = n / 2;
    const rOut = c;
    const rIn = c * (1 - RING * 2);
    const [s, x] = HUE_REF[model];
    const cache = new Map<number, readonly number[]>();
    for (let py = 0; py < n; py++) {
      for (let px = 0; px < n; px++) {
        const dx = px + 0.5 - c;
        const dy = py + 0.5 - c;
        const d = Math.hypot(dx, dy);
        if (d > rOut || d < rIn) continue;
        const h = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360);
        let rgb = cache.get(h);
        if (!rgb) cache.set(h, (rgb = toRgb(model, h, s, x)));
        const i = (py * n + px) * 4;
        // a one pixel soft edge on both sides
        const edge = Math.min(1, rOut - d, d - rIn);
        img.data[i] = rgb[0]!;
        img.data[i + 1] = rgb[1]!;
        img.data[i + 2] = rgb[2]!;
        img.data[i + 3] = edge >= 1 ? 255 : Math.round(clamp(edge, 0, 1) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  let boxFrame = 0;
  let boxKey = "";
  function paintBox(): void {
    boxFrame = 0;
    const key = `${model}:${Math.round(tri.h * 4)}`;
    if (key === boxKey) return;
    boxKey = key;
    const ctx = box.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(BOX_PX, BOX_PX);
    for (let py = 0; py < BOX_PX; py++) {
      for (let px = 0; px < BOX_PX; px++) {
        const rgb = toRgb(model, tri.h, px / (BOX_PX - 1), 1 - py / (BOX_PX - 1));
        const i = (py * BOX_PX + px) * 4;
        img.data[i] = rgb[0]!;
        img.data[i + 1] = rgb[1]!;
        img.data[i + 2] = rgb[2]!;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const scheduleBox = (): void => {
    if (!boxFrame) boxFrame = requestAnimationFrame(paintBox);
  };

  // ---- Showing the state -----------------------------------------------------------------------------------------------------
  const track = (i: number): string => {
    const stops: string[] = [];
    for (let k = 0; k < STOPS; k++) {
      const t = k / (STOPS - 1);
      const rgb = i === 0 ? toRgb(model, t * 360, HUE_REF[model][0], HUE_REF[model][1]) : i === 1 ? toRgb(model, tri.h, t, tri.x) : toRgb(model, tri.h, tri.s, t);
      stops.push(`${css(rgb)} ${Math.round(t * 100)}%`);
    }
    return `linear-gradient(to right, ${stops.join(", ")})`;
  };

  function show(skip?: HTMLElement): void {
    hex = tripleToHex(model, tri);
    const shown = display(hex);
    const names = ch();
    const values = [tri.h, tri.s * 100, tri.x * 100];
    for (let i = 0; i < 3; i++) {
      labels[i]!.textContent = names[i]![0]!;
      labels[i]!.title = names[i]!;
      labels[i]!.htmlFor = view === "wheel" ? `` : sliders[i]!.id;
      sliders[i]!.setAttribute("aria-label", L.field(names[i]!));
      nums[i]!.setAttribute("aria-label", L.field(names[i]!));
      sliders[i]!.value = String(Math.round(values[i]!));
      if (document.activeElement !== nums[i]) nums[i]!.value = String(Math.round(values[i]!));
      sliders[i]!.style.setProperty("--cp-track", track(i));
      sliders[i]!.style.setProperty("--cp-thumb-fill", shown);
    }
    if (skip !== hexInput) hexInput.value = hex.slice(1).toUpperCase();
    afterEl.style.background = shown;
    beforeBtn.style.background = display(original);
    root.style.setProperty("--cp-current", shown);

    const rad = (tri.h * Math.PI) / 180;
    const rMid = (0.5 - RING / 2) * size;
    hueThumb.style.left = `${size / 2 + Math.cos(rad) * rMid}px`;
    hueThumb.style.top = `${size / 2 + Math.sin(rad) * rMid}px`;
    hueThumb.style.background = css(toRgb(model, tri.h, HUE_REF[model][0], HUE_REF[model][1]));
    const side = boxSide();
    const off = (size - side) / 2;
    areaThumb.style.left = `${off + tri.s * side}px`;
    areaThumb.style.top = `${off + (1 - tri.x) * side}px`;
    areaThumb.style.background = shown;
    hueEl.setAttribute("aria-valuenow", String(Math.round(tri.h)));
    hueEl.setAttribute("aria-valuetext", `${Math.round(tri.h)}°`);
    area.setAttribute("aria-valuetext", `${names[1]} ${Math.round(tri.s * 100)}%, ${names[2]} ${Math.round(tri.x * 100)}%`);
    scheduleBox();
    for (const b of root.querySelectorAll<HTMLElement>("[data-model]")) b.setAttribute("aria-checked", String(b.dataset["model"] === model));
    for (const b of root.querySelectorAll<HTMLElement>("[data-view]")) b.setAttribute("aria-checked", String(b.dataset["view"] === view));
    for (const b of groupsEl.querySelectorAll<HTMLElement>("[data-c]")) b.classList.toggle("is-on", b.dataset["c"] === hex);
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
  function setHex(h: string, skip?: HTMLElement): boolean {
    const t = hexToTriple(model, h, tri.h);
    if (!t) return false;
    tri = t;
    input(skip);
    return true;
  }

  // ---- Pointer and key handling ----------------------------------------------------------------------------------------------
  type Mode = "hue" | "area";
  let mode: Mode | null = null;
  const apply = (e: PointerEvent): void => {
    const r = wheel.getBoundingClientRect();
    if (mode === "hue") {
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      setTriple({ h: ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360 });
    } else if (mode === "area") {
      const a = area.getBoundingClientRect();
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
    wheel.setPointerCapture(e.pointerId);
    (mode === "hue" ? hueEl : area).focus({ preventScroll: true });
    e.preventDefault();
    apply(e);
  });
  wheel.addEventListener("pointermove", (e) => {
    if (mode) apply(e);
  });
  const end = (): void => {
    if (!mode) return;
    mode = null;
    commit();
  };
  wheel.addEventListener("pointerup", end);
  wheel.addEventListener("pointercancel", end);

  const step = (e: KeyboardEvent, unit: number): number => (e.shiftKey ? unit * 10 : e.altKey ? unit / 10 : unit);
  hueEl.addEventListener("keydown", (e) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "PageUp" ? 15 : e.key === "PageDown" ? -15 : 0;
    if (!dir) return;
    e.preventDefault();
    setTriple({ h: (tri.h + dir * (Math.abs(dir) === 15 ? 1 : step(e, 1)) + 360) % 360 });
    commit();
  });
  area.addEventListener("keydown", (e) => {
    const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const dy = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    const u = step(e, 0.01);
    setTriple({ s: tri.s + dx * u, x: tri.x + dy * u });
    commit();
  });

  sliders.forEach((s, i) => {
    s.addEventListener("input", () => setTriple(i === 0 ? { h: Number(s.value) } : i === 1 ? { s: Number(s.value) / 100 } : { x: Number(s.value) / 100 }));
    s.addEventListener("change", commit);
  });
  nums.forEach((n, i) => {
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
  });

  hexInput.addEventListener("input", () => {
    const v = hexInput.value.trim();
    if (/^[0-9a-f]{6}$/i.test(v) || /^[0-9a-f]{3}$/i.test(v)) setHex(v, hexInput);
  });
  hexInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (setHex(hexInput.value)) commit();
      else show();
    }
  });
  hexInput.addEventListener("blur", () => {
    if (!setHex(hexInput.value)) show();
    else commit();
  });

  beforeBtn.addEventListener("click", () => {
    if (setHex(original)) commit();
  });
  groupsEl.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-c]");
    if (b && setHex(b.dataset["c"]!)) commit();
  });

  const setModel = (m: Model, notify = false): void => {
    if (m === model) return;
    tri = convert(model, m, tri);
    model = m;
    boxKey = "";
    paintRing();
    show();
    if (notify) options.onModel?.(m);
  };
  const setView = (v: View, notify = false): void => {
    if (v === view) return;
    view = v;
    root.dataset["view"] = v;
    show();
    if (notify) options.onView?.(v);
  };
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-model], [data-view]");
    if (!b) return;
    if (b.dataset["model"]) setModel(b.dataset["model"] as Model, true);
    else setView(b.dataset["view"] as View, true);
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

  place();
  renderGroups();
  show();
  emitted = committed = hex;

  return {
    el: root,
    get value() {
      return hex;
    },
    setValue(h, asOriginal = false) {
      const rgb = parseHex(h);
      if (!rgb) return;
      const next = rgbToHex(rgb);
      if (asOriginal) original = next;
      if (next !== hex) {
        tri = fromRgb(model, rgb[0], rgb[1], rgb[2], tri.h);
        emitted = next;
      }
      committed = next;
      show();
    },
    setModel: (m) => setModel(m),
    setView: (v) => setView(v),
    setGroups(g) {
      groups = g;
      renderGroups();
      show();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (boxFrame) cancelAnimationFrame(boxFrame);
      root.remove();
    },
  };
}

export { MODELS, type Model } from "./colour";
