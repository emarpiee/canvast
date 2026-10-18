/**
 * A gradient editor with no dependencies: a bar showing the gradient with a handle for each stop (drag to move, click the bar to add one,
 * Delete to remove), linear or radial, the angle or the centre and radius, a reverse button, and the colour picker of this package for the
 * selected stop (transparency included). It imports only files of this folder.
 *
 *   const g = createGradientEditor({ value: { type: "linear", angle: 90, stops: [{ offset: 0, colour: "#2563eb" }, { offset: 1, colour: "#2563eb00" }] },
 *                                    onInput: (v) => preview(v), onChange: (v) => save(v) });
 *   container.append(g.el);
 *
 * The value is plain data: `type`, `angle` (degrees, linear: 0 runs left to right, 90 top to bottom), `cx`, `cy` and `r` (radial, as fractions
 * of the box the gradient is on), and `stops` (offsets from 0 to 1, in order, with a colour "#rrggbb" or "#rrggbbaa" each). What the angle or
 * the centre means on a shape is the host's business.
 */
import { createColourPicker, type ColourPicker, type Labels as PickerLabels, type PickerOptions } from "./picker";
import { ensureStyles } from "./style";
import { scrubNumbers } from "./scrub";

export interface GradientStopValue {
  offset: number;
  colour: string;
}

export interface GradientValue {
  /** "angular" goes round the centre (`cx`, `cy`), the first stop at `angle` degrees; the host places it (the switch below offers only the other two). */
  type: "linear" | "radial" | "angular";
  angle: number;
  cx: number;
  cy: number;
  r: number;
  stops: GradientStopValue[];
}

export interface GradientLabels {
  linear: string;
  radial: string;
  bar: string;
  stop: (n: number, of: number) => string;
  position: string;
  angle: string;
  centreX: string;
  centreY: string;
  radius: string;
  reverse: string;
  remove: string;
}

export interface GradientEditorOptions {
  value?: GradientValue;
  /** Options for the colour picker of the selected stop (model, view, format, groups, labels, size, display, …). Transparency is on. */
  picker?: Omit<PickerOptions, "value" | "alpha" | "onInput" | "onChange" | "injectStyles">;
  labels?: Partial<GradientLabels>;
  /** Show the Linear / Radial switch (default true). A host that chooses the kind elsewhere turns it off. */
  typeSwitch?: boolean;
  /** Fewest and most stops (default 2 and 16). */
  minStops?: number;
  maxStops?: number;
  onInput?: (value: GradientValue) => void;
  onChange?: (value: GradientValue) => void;
  injectStyles?: boolean;
}

export interface GradientEditor {
  readonly el: HTMLElement;
  readonly value: GradientValue;
  /** Show a gradient from outside (does not fire onInput/onChange). */
  setValue(value: GradientValue): void;
  destroy(): void;
}

const DEFAULT_LABELS: GradientLabels = {
  linear: "Linear",
  radial: "Radial",
  bar: "Gradient stops: click to add one",
  stop: (n, of) => `Stop ${n} of ${of}`,
  position: "Position",
  angle: "Angle",
  centreX: "Centre X",
  centreY: "Centre Y",
  radius: "Radius",
  reverse: "Reverse the stops",
  remove: "Remove the stop",
};

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

const rgba = (c: string): [number, number, number, number] => {
  const n = parseInt(c.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, c.length === 9 ? parseInt(c.slice(7), 16) / 255 : 1];
};
const hex = (c: readonly number[]): string => `#${[c[0]!, c[1]!, c[2]!].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")}${c[3]! < 1 ? Math.round(c[3]! * 255).toString(16).padStart(2, "0") : ""}`;

/** The colour of a list of stops at an offset, blended premultiplied as a browser does. */
function colourAt(stops: readonly GradientStopValue[], t: number): string {
  if (t <= stops[0]!.offset) return stops[0]!.colour;
  const last = stops[stops.length - 1]!;
  if (t >= last.offset) return last.colour;
  let i = 1;
  while (stops[i]!.offset < t) i++;
  const a = stops[i - 1]!;
  const b = stops[i]!;
  const k = b.offset === a.offset ? 1 : (t - a.offset) / (b.offset - a.offset);
  const ca = rgba(a.colour);
  const cb = rgba(b.colour);
  const al = ca[3] + (cb[3] - ca[3]) * k;
  if (al <= 0) return hex([ca[0], ca[1], ca[2], 0]);
  const mix = (x: number, y: number): number => (x * ca[3] + (y * cb[3] - x * ca[3]) * k) / al;
  return hex([mix(ca[0], cb[0]), mix(ca[1], cb[1]), mix(ca[2], cb[2]), al]);
}

export function createGradientEditor(options: GradientEditorOptions = {}): GradientEditor {
  if (options.injectStyles !== false) ensureStyles();
  const L: GradientLabels = { ...DEFAULT_LABELS, ...options.labels };
  const minStops = options.minStops ?? 2;
  const maxStops = options.maxStops ?? 16;
  const start = options.value ?? { type: "linear", angle: 90, cx: 0.5, cy: 0.5, r: 0.5, stops: [{ offset: 0, colour: "#2563eb" }, { offset: 1, colour: "#2563eb00" }] };
  let v: GradientValue = { ...start, stops: start.stops.map((s) => ({ ...s })) };
  let sel = v.stops[0]!;
  let destroyed = false;

  const root = document.createElement("div");
  root.className = "cp cg";
  root.dataset["type"] = v.type;
  // As wide as the picker below it (a host that only embeds the editor gets the same width).
  root.style.setProperty("--cp-size", `${options.picker?.size ?? 208}px`);
  root.innerHTML = `
    <div class="cp-seg" role="radiogroup" data-typeswitch aria-label="${esc(L.linear)} / ${esc(L.radial)}">
      <button type="button" role="radio" data-gtype="linear">${esc(L.linear)}</button>
      <button type="button" role="radio" data-gtype="radial">${esc(L.radial)}</button>
    </div>
    <div class="cg-bar" data-bar aria-label="${esc(L.bar)}"><div class="cg-track" data-track></div></div>
    <div class="cg-row">
      <label class="cg-field">${esc(L.position)} <input type="number" class="cp-num" data-pos min="0" max="100" step="1" inputmode="numeric" aria-label="${esc(L.position)} %"></label>
      <button type="button" class="cp-tool cg-text" data-reverse title="${esc(L.reverse)}" aria-label="${esc(L.reverse)}">⇄</button>
      <button type="button" class="cp-tool cg-text" data-remove title="${esc(L.remove)}" aria-label="${esc(L.remove)}">−</button>
    </div>
    <div class="cg-row cg-linear"><label class="cg-field">${esc(L.angle)} <input type="number" class="cp-num" data-angle min="0" max="360" step="1" inputmode="numeric" aria-label="${esc(L.angle)}"></label></div>
    <div class="cg-row cg-radial">
      <label class="cg-field">${esc(L.centreX)} <input type="number" class="cp-num" data-cx min="-100" max="200" step="1" inputmode="numeric" aria-label="${esc(L.centreX)} %"></label>
      <label class="cg-field">${esc(L.centreY)} <input type="number" class="cp-num" data-cy min="-100" max="200" step="1" inputmode="numeric" aria-label="${esc(L.centreY)} %"></label>
      <label class="cg-field cg-r">${esc(L.radius)} <input type="number" class="cp-num" data-r min="1" max="400" step="1" inputmode="numeric" aria-label="${esc(L.radius)} %"></label>
    </div>
    <div data-picker></div>`;
  scrubNumbers(root);
  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const bar = q<HTMLElement>("[data-bar]");
  const track = q<HTMLElement>("[data-track]");
  const pos = q<HTMLInputElement>("[data-pos]");
  const angle = q<HTMLInputElement>("[data-angle]");
  const cx = q<HTMLInputElement>("[data-cx]");
  const cy = q<HTMLInputElement>("[data-cy]");
  const rad = q<HTMLInputElement>("[data-r]");
  const removeBtn = q<HTMLButtonElement>("[data-remove]");
  q("[data-typeswitch]").hidden = options.typeSwitch === false;

  let picker: ColourPicker | null = null;
  const pickerHost = q<HTMLElement>("[data-picker]");
  const mountPicker = (): void => {
    picker?.destroy();
    picker = createColourPicker({
      ...(options.picker ?? {}),
      value: sel.colour,
      alpha: true,
      injectStyles: false,
      onInput: (h) => {
        sel.colour = h;
        show();
        options.onInput?.(snapshot());
      },
      onChange: () => options.onChange?.(snapshot()),
    });
    pickerHost.replaceChildren(picker.el);
  };

  const snapshot = (): GradientValue => ({ ...v, stops: v.stops.map((s) => ({ ...s })) });
  const css = (): string => `linear-gradient(to right, ${v.stops.map((s) => `${s.colour} ${Math.round(s.offset * 1000) / 10}%`).join(", ")})`;

  function show(): void {
    root.dataset["type"] = v.type;
    for (const b of root.querySelectorAll<HTMLElement>("[data-gtype]")) b.setAttribute("aria-checked", String(b.dataset["gtype"] === v.type));
    track.style.background = `${css()}, var(--cp-check)`;
    // one handle per stop, reused
    while (bar.querySelectorAll(".cg-stop").length < v.stops.length) {
      const h = document.createElement("button");
      h.type = "button";
      h.className = "cg-stop";
      h.setAttribute("role", "slider");
      h.setAttribute("aria-valuemin", "0");
      h.setAttribute("aria-valuemax", "100");
      bar.append(h);
    }
    const handles = [...bar.querySelectorAll<HTMLElement>(".cg-stop")];
    handles.forEach((h, i) => {
      const s = v.stops[i];
      h.hidden = !s;
      if (!s) return;
      h.style.left = `${s.offset * 100}%`;
      h.style.setProperty("--cg-stop", s.colour);
      h.classList.toggle("is-on", s === sel);
      h.setAttribute("aria-label", L.stop(i + 1, v.stops.length));
      h.setAttribute("aria-valuenow", String(Math.round(s.offset * 100)));
      h.dataset["i"] = String(i);
    });
    if (document.activeElement !== pos) pos.value = String(Math.round(sel.offset * 1000) / 10);
    if (document.activeElement !== angle) angle.value = String(Math.round(v.angle));
    if (document.activeElement !== cx) cx.value = String(Math.round(v.cx * 100));
    if (document.activeElement !== cy) cy.value = String(Math.round(v.cy * 100));
    if (document.activeElement !== rad) rad.value = String(Math.round(v.r * 100));
    removeBtn.disabled = v.stops.length <= minStops;
  }

  const input = (): void => {
    show();
    options.onInput?.(snapshot());
  };
  const change = (): void => options.onChange?.(snapshot());
  const sort = (): void => void v.stops.sort((a, b) => a.offset - b.offset);
  const select = (s: GradientStopValue, remount = true): void => {
    sel = s;
    if (remount) picker?.setValue(s.colour);
    show();
  };

  // ---- the bar: handles drag, the bar adds
  let drag: GradientStopValue | null = null;
  const offsetAt = (e: PointerEvent): number => {
    const r = bar.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1);
  };
  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const h = (e.target as HTMLElement).closest<HTMLElement>(".cg-stop");
    if (h) {
      drag = v.stops[Number(h.dataset["i"])]!;
      select(drag);
    } else if (v.stops.length < maxStops) {
      const o = offsetAt(e);
      const s = { offset: o, colour: colourAt(v.stops, o) };
      v.stops.push(s);
      sort();
      drag = s;
      select(s);
      options.onInput?.(snapshot());
    } else return;
    bar.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  bar.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.offset = offsetAt(e);
    sort();
    input();
  });
  const end = (): void => {
    if (!drag) return;
    drag = null;
    change();
  };
  bar.addEventListener("pointerup", end);
  bar.addEventListener("pointercancel", end);
  bar.addEventListener("keydown", (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>(".cg-stop");
    if (!h) return;
    const s = v.stops[Number(h.dataset["i"])]!;
    if (e.key === "Delete" || e.key === "Backspace") {
      removeStop(s);
      e.preventDefault();
      return;
    }
    const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (e.key === "Home" || e.key === "End" || d) {
      e.preventDefault();
      s.offset = e.key === "Home" ? 0 : e.key === "End" ? 1 : clamp(s.offset + d * (e.shiftKey ? 0.1 : 0.01), 0, 1);
      sort();
      select(s, false);
      options.onInput?.(snapshot());
      change();
      bar.querySelector<HTMLElement>(`.cg-stop[data-i="${v.stops.indexOf(s)}"]`)?.focus();
    }
  });
  bar.addEventListener("focusin", (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>(".cg-stop");
    if (h && v.stops[Number(h.dataset["i"])] !== sel) select(v.stops[Number(h.dataset["i"])]!);
  });

  function removeStop(s: GradientStopValue): void {
    if (v.stops.length <= minStops) return;
    const at = v.stops.indexOf(s);
    v.stops.splice(at, 1);
    select(v.stops[Math.min(at, v.stops.length - 1)]!);
    options.onInput?.(snapshot());
    change();
  }
  removeBtn.addEventListener("click", () => removeStop(sel));
  q("[data-reverse]").addEventListener("click", () => {
    const was = 1 - sel.offset;
    v.stops = v.stops.map((s) => ({ offset: 1 - s.offset, colour: s.colour })).reverse();
    select(v.stops.find((s) => Math.abs(s.offset - was) < 1e-9) ?? v.stops[0]!);
    options.onInput?.(snapshot());
    change();
  });

  // ---- fields
  const field = (el: HTMLInputElement, set: (n: number) => void): void => {
    el.addEventListener("input", () => {
      const n = Number(el.value);
      if (el.value === "" || !Number.isFinite(n)) return;
      set(n);
      input();
    });
    el.addEventListener("change", () => {
      show();
      change();
    });
  };
  field(pos, (n) => {
    sel.offset = clamp(n / 100, 0, 1);
    sort();
  });
  field(angle, (n) => (v.angle = ((n % 360) + 360) % 360));
  field(cx, (n) => (v.cx = n / 100));
  field(cy, (n) => (v.cy = n / 100));
  field(rad, (n) => (v.r = Math.max(0.01, n / 100)));
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-gtype]");
    if (!b || b.dataset["gtype"] === v.type) return;
    v.type = b.dataset["gtype"] as "linear" | "radial";
    input();
    change();
  });
  root.addEventListener("keydown", (e) => {
    const seg = (e.target as HTMLElement).closest<HTMLElement>(".cp-seg");
    if (!seg || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    e.preventDefault();
    const other = seg.querySelector<HTMLElement>(`[data-gtype]:not([data-gtype="${v.type}"])`)!;
    other.click();
    other.focus();
  });

  mountPicker();
  show();

  return {
    el: root,
    get value() {
      return snapshot();
    },
    setValue(value) {
      v = { ...value, stops: value.stops.map((s) => ({ ...s })) };
      sel = v.stops.find((s) => s.colour === sel.colour && Math.abs(s.offset - sel.offset) < 1e-9) ?? v.stops[0]!;
      picker?.setValue(sel.colour);
      show();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      picker?.destroy();
      root.remove();
    },
  };
}

export type { PickerLabels };
