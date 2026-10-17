import type { AlignChoice, CapChoice, JoinChoice } from "../doc/stroke-look";
import { createColourPicker, type ColourPicker, type SwatchGroup } from "../colour-picker/picker";
import { createGradientEditor, type GradientValue } from "../colour-picker/gradient";
import type { Gradient, Paint } from "../doc/paint";
import { angleOf, asKind, gradientFrom, isGradient, linearAt } from "../doc/paint";
import { rgbToHex, toRgb } from "../colour-picker/colour";
import { DEFAULT_INK, swatchBackground } from "../render/ink";
import type { SettingsStore } from "../settings/settings";
import { placeMenu } from "./more-menu";

/**
 * The app's one colour picker (ADR 0098): the standalone picker in `src/colour-picker/`, in a popover under the button that opened it.
 * The picker itself knows nothing of the app; this file adds what is the app's: where the popover goes and how it closes, the colour
 * model and layout it opens in (device settings), the colours picked lately, and the default ink that follows the theme.
 */
const RECENT_MAX = 6;

let store: SettingsStore | null = null;
/** Give the picker the settings it keeps its model, layout and recent colours in (once, at start-up). */
export function initColourPopover(settings: SettingsStore): void {
  store = settings;
}

/** The colours picked lately, newest first (starts with the four pen colours). */
export function recentColours(): string[] {
  const text = store?.get("colour.recent") ?? "";
  return text ? text.split(",") : [];
}

/** Put a colour first in the recent list. */
export function rememberColour(hex: string): void {
  if (!store) return;
  const h = hex.toLowerCase();
  store.set("colour.recent", [h, ...recentColours().filter((c) => c !== h)].slice(0, RECENT_MAX).join(","));
}

/** The palette offered under the picker: the theme's ink, twelve evenly spaced hues, then greys, all made with the picker's own model. */
function presets(): string[] {
  const hues = Array.from({ length: 12 }, (_, i) => rgbToHex(toRgb("okhsl", i * 30 + 15, 0.85, 0.62)));
  const greys = [0.12, 0.3, 0.5, 0.72, 0.9, 1].map((l) => rgbToHex(toRgb("okhsl", 0, 0, l)));
  return [DEFAULT_INK, ...hues, ...greys];
}

export interface ColourPopoverOptions {
  /** Names the popover for a screen reader ("Pen colour"). */
  name: string;
  value: string;
  /** Every step of a drag or key press. */
  onInput(hex: string): void;
  /** Once, when a gesture ends or a swatch is chosen (the colour is also added to the recent list). */
  onChange?(hex: string): void;
  /** Offer transparency (the colour may be "#rrggbbaa"). */
  alpha?: boolean;
  /** A toggle above the picker for "no colour" (no fill, no outline): choosing any colour switches it off. */
  none?: { label: string; active: boolean; set(on: boolean): void };
  /** The popover closed (Escape, a press elsewhere, another popover). */
  onClose?(): void;
}

/** Under the button, or above it when that fits better; when neither fits, under it with a scroll (never over the button). */
function place(pop: HTMLElement, anchor: HTMLElement): void {
  pop.style.maxHeight = "";
  placeMenu(pop, anchor);
  const a = anchor.getBoundingClientRect();
  const m = pop.getBoundingClientRect();
  if (m.top < a.bottom && m.bottom > a.top) {
    const top = a.bottom + 4;
    pop.style.top = `${parseFloat(pop.style.top) + (top - m.top)}px`;
    pop.style.maxHeight = `${window.innerHeight - top - 8}px`;
  }
}

let open: { pop: HTMLElement; anchor: HTMLElement; picker: { destroy(): void }; onClose: (() => void) | undefined } | null = null;

export function closeColourPopover(refocus = false): void {
  if (!open) return;
  const { pop, anchor, picker, onClose } = open;
  open = null;
  picker.destroy();
  pop.remove();
  anchor.setAttribute("aria-expanded", "false");
  onClose?.();
  if (refocus && anchor.isConnected) anchor.focus();
}

/** Open the picker under `anchor`; a second press on the same button closes it. */
export function openColourPopover(anchor: HTMLElement, o: ColourPopoverOptions): void {
  if (open && open.anchor === anchor) return closeColourPopover(true);
  closeColourPopover();
  installCloseRules();
  const groups = (): SwatchGroup[] => [
    { label: "Recent", colours: recentColours() },
    { label: "Presets", colours: presets() },
  ];
  const picker = createColourPicker({
    value: o.value,
    model: store?.get("colour.model") ?? "okhsv",
    view: store?.get("colour.view") ?? "wheel",
    format: store?.get("colour.format") ?? "hex",
    groups: groups(),
    display: swatchBackground,
    alpha: o.alpha === true,
    onInput: (hex) => {
      if (none?.classList.contains("is-on")) {
        o.none!.set(false);
        none.classList.remove("is-on");
        none.setAttribute("aria-pressed", "false");
      }
      o.onInput(hex);
    },
    onChange: (hex) => {
      rememberColour(hex);
      o.onChange?.(hex);
      picker.setGroups(groups());
    },
    onModel: (m) => void store?.set("colour.model", m),
    onFormat: (f) => void store?.set("colour.format", f),
    onView: (v) => {
      void store?.set("colour.view", v);
      place(pop, anchor); // the two layouts differ in height
    },
  });
  const pop = document.createElement("div");
  pop.className = "colour-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", o.name);
  // "No colour": a toggle above the picker (a fill or an outline can be left off).
  let none: HTMLButtonElement | null = null;
  if (o.none) {
    none = document.createElement("button");
    none.type = "button";
    none.className = "colour-none";
    none.textContent = o.none.label;
    none.setAttribute("aria-pressed", String(o.none.active));
    none.classList.toggle("is-on", o.none.active);
    none.addEventListener("click", () => {
      const on = !none!.classList.contains("is-on");
      none!.classList.toggle("is-on", on);
      none!.setAttribute("aria-pressed", String(on));
      o.none!.set(on);
    });
    pop.append(none);
  }
  pop.append(picker.el);
  document.body.appendChild(pop);
  place(pop, anchor);
  anchor.setAttribute("aria-expanded", "true");
  open = { pop, anchor, picker, onClose: o.onClose };
  picker.el.querySelector<HTMLElement>("[role=radio][aria-checked=true]")?.focus();
}

let installed = false;
function installCloseRules(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as HTMLElement;
    if (open && !t.closest(".colour-pop") && !open.anchor.contains(t)) closeColourPopover();
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        e.stopPropagation();
        closeColourPopover(true);
      }
    },
    true,
  );
  window.addEventListener("resize", () => closeColourPopover());
}


// ---- Fill and outline: none, a colour, or a gradient (ADR 0100) --------------------------------------------------------------------

/** The gradient as the editor of the package takes it: an angle, or a centre and radius. */
export function gradientToValue(g: Gradient): GradientValue {
  const stops = g.stops.map((s) => ({ offset: s.o, colour: s.c }));
  return g.type === "linear" ? { type: "linear", angle: angleOf(g), cx: 0.5, cy: 0.5, r: 0.5, stops } : { type: "radial", angle: 0, cx: g.cx, cy: g.cy, r: g.r, stops };
}

/**
 * The gradient for an edited value. The shape of the gradient the person placed on the canvas is kept (an end dragged off the middle, a
 * radial centre) unless the editor changed it; the stops always follow the editor.
 */
export function gradientFromValue(prev: Gradient, v: GradientValue): Gradient {
  const stops = v.stops.map((s) => ({ o: s.offset, c: s.colour }));
  if (v.type === "linear") {
    const kept = prev.type === "linear" && Math.abs(angleOf(prev) - v.angle) < 0.5 ? prev : null;
    return kept ? { ...kept, stops } : linearAt(v.angle, stops);
  }
  const kept = prev.type === "radial" && Math.abs(prev.cx - v.cx) < 0.005 && Math.abs(prev.cy - v.cy) < 0.005 && Math.abs(prev.r - v.r) < 0.005 ? prev : null;
  return kept ? { ...kept, stops } : { type: "radial", cx: v.cx, cy: v.cy, r: v.r, stops };
}

export interface PaintPopoverOptions {
  /** Names the popover for a screen reader ("Fill"). */
  name: string;
  paint: Paint | null;
  /** The label of the "none" choice ("No fill", "No outline"). */
  noneLabel: string;
  /** Every step while a colour or a stop is dragged, and when the kind of paint is changed. */
  onInput(paint: Paint | null): void;
  /** Once, when a gesture ends or the kind changes. */
  onChange(paint: Paint | null): void;
  onClose?(): void;
}

type Mode = "none" | "solid" | "linear" | "radial";

/** Open the paint chooser under `anchor`: None, Solid, Linear or Radial, with the colour picker or the gradient editor below. */
export function openPaintPopover(anchor: HTMLElement, o: PaintPopoverOptions): void {
  if (open && open.anchor === anchor) return closeColourPopover(true);
  closeColourPopover();
  installCloseRules();
  let paint = o.paint;
  let committed = JSON.stringify(paint);
  const settle = (p: Paint | null): void => {
    committed = JSON.stringify(p);
    o.onChange(p);
  };
  let solid = typeof paint === "string" ? paint : isGradient(paint) ? paint.stops[0]!.c : "#2563eb";
  const modeOf = (): Mode => (paint === null ? "none" : isGradient(paint) ? paint.type : "solid");
  const groups = (): SwatchGroup[] => [
    { label: "Recent", colours: recentColours() },
    { label: "Presets", colours: presets() },
  ];
  const pickerOptions = {
    model: store?.get("colour.model") ?? "okhsv",
    view: store?.get("colour.view") ?? "wheel",
    format: store?.get("colour.format") ?? "hex",
    groups: groups(),
    display: swatchBackground,
    onModel: (m: "okhsl" | "okhsv" | "okhcl") => void store?.set("colour.model", m),
    onFormat: (f: "hex" | "rgb" | "oklch") => void store?.set("colour.format", f),
    onView: (v: "wheel" | "plane" | "sliders" | "mixer") => {
      void store?.set("colour.view", v);
      place(pop, anchor);
    },
  } as const;

  const pop = document.createElement("div");
  pop.className = "colour-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", o.name);
  const modes = document.createElement("div");
  modes.className = "paint-modes";
  modes.setAttribute("role", "radiogroup");
  modes.setAttribute("aria-label", `${o.name}: kind of paint`);
  const label: Record<Mode, string> = { none: o.noneLabel, solid: "Colour", linear: "Linear", radial: "Radial" };
  modes.innerHTML = (["none", "solid", "linear", "radial"] as const).map((m) => `<button type="button" role="radio" data-mode="${m}"${m === "none" ? ' class="colour-none"' : ""}>${label[m]}</button>`).join("");
  const body = document.createElement("div");
  body.className = "paint-body";
  pop.append(modes, body);

  let current: { destroy(): void } | null = null;
  const mount = (): void => {
    current?.destroy();
    current = null;
    body.replaceChildren();
    for (const b of modes.querySelectorAll<HTMLElement>("[data-mode]")) b.setAttribute("aria-checked", String(b.dataset["mode"] === modeOf()));
    if (paint === null) {
      const note = document.createElement("div");
      note.className = "paint-none";
      note.textContent = o.noneLabel;
      body.append(note);
    } else if (isGradient(paint)) {
      const g = paint;
      const ed = createGradientEditor({
        value: gradientToValue(g),
        picker: pickerOptions,
        typeSwitch: false, // the chooser above already has Linear and Radial
        onInput: (v) => o.onInput((paint = gradientFromValue(paint as Gradient, v))),
        onChange: (v) => settle((paint = gradientFromValue(paint as Gradient, v))),
      });
      body.append(ed.el);
      current = ed;
    } else {
      const picker = createColourPicker({
        ...pickerOptions,
        value: paint,
        alpha: true,
        onInput: (hex) => o.onInput((paint = solid = hex)),
        onChange: (hex) => {
          rememberColour(hex);
          settle((paint = solid = hex));
          picker.setGroups(groups());
        },
      });
      body.append(picker.el);
      current = picker;
    }
  };
  modes.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-mode]");
    if (!b || b.dataset["mode"] === modeOf()) return;
    const m = b.dataset["mode"] as Mode;
    if (isGradient(paint)) solid = paint.stops[0]!.c;
    paint = m === "none" ? null : m === "solid" ? solid : isGradient(paint) ? asKind(paint, m) : gradientFrom(solid, m);
    mount();
    place(pop, anchor);
    o.onInput(paint);
    settle(paint);
  });
  mount();
  document.body.appendChild(pop);
  place(pop, anchor);
  anchor.setAttribute("aria-expanded", "true");
  // Closing keeps what was last shown: a number typed in a field is only "changed" on Enter or leaving it.
  const onClose = (): void => {
    if (JSON.stringify(paint) !== committed) o.onChange(paint);
    o.onClose?.();
  };
  open = { pop, anchor, picker: { destroy: () => current?.destroy() }, onClose };
  modes.querySelector<HTMLElement>("[aria-checked=true]")?.focus();
}


// ---- Outline options: width, position, corners, ends (ADR 0104) ---------------------------------------------------------------------

export interface OutlineOptions {
  /** Width in screen px at this zoom (null: the object cannot be measured now, the field is left empty). */
  widthPx: number | null;
  join: JoinChoice;
  cap: CapChoice;
  align: AlignChoice;
  /** Every sub-path is closed: the outline can sit inside or outside the edge, and corners matter more than ends. */
  closed: boolean;
  onWidth(px: number): void;
  onStyle(patch: { join?: JoinChoice; cap?: CapChoice; align?: AlignChoice }): void;
  onClose?(): void;
}

/** The Outline options under `anchor`: how wide, on which side of the edge, how its corners and ends look. */
export function openOutlinePopover(anchor: HTMLElement, o: OutlineOptions): void {
  if (open && open.anchor === anchor) return closeColourPopover(true);
  closeColourPopover();
  installCloseRules();
  const pop = document.createElement("div");
  pop.className = "colour-pop outline-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Outline options");
  const choices = <T extends string>(key: string, label: string, items: ReadonlyArray<[T, string, string]>, value: T, disabled = false): string =>
    `<div class="op-row"><span class="op-label" id="op-${key}">${label}</span><div class="paint-modes op-choices" role="radiogroup" aria-labelledby="op-${key}">${items
      .map(([v, text, tip]) => `<button type="button" role="radio" data-${key}="${v}" aria-checked="${v === value}" title="${tip}"${disabled ? " disabled" : ""}>${text}</button>`)
      .join("")}</div></div>`;
  pop.innerHTML =
    `<div class="op-row"><label class="op-label" for="op-width">Width</label><input id="op-width" class="op-width" type="number" min="0.1" step="0.5" inputmode="decimal" value="${o.widthPx === null ? "" : String(Math.round(o.widthPx * 100) / 100)}"><span class="op-unit">px</span></div>` +
    choices("align", "Position", [["inside", "Inside", "Inside: the whole width is inside the edge"], ["centre", "Centre", "Centre: half on each side of the edge"], ["outside", "Outside", "Outside: the whole width is outside the edge"]] as const, o.align, !o.closed) +
    choices("join", "Corners", [["miter", "Sharp", "Sharp corners"], ["round", "Round", "Round corners"], ["bevel", "Cut", "Cut (bevelled) corners"]] as const, o.join) +
    choices("cap", "Ends", [["butt", "Flat", "Flat ends, cut at the last node"], ["round", "Round", "Round ends"], ["square", "Square", "Square ends, reaching half the width past the last node"]] as const, o.cap) +
    (o.closed ? "" : `<p class="op-note">An open line is always centred on its path.</p>`);
  const width = pop.querySelector<HTMLInputElement>(".op-width")!;
  width.addEventListener("change", () => {
    const v = Number(width.value);
    if (v > 0) o.onWidth(v);
  });
  pop.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[role=radio]");
    if (!b || b.disabled) return;
    const group = b.closest("[role=radiogroup]")!;
    for (const x of group.querySelectorAll("button")) x.setAttribute("aria-checked", String(x === b));
    const d = b.dataset;
    if (d["align"]) o.onStyle({ align: d["align"] as AlignChoice });
    else if (d["join"]) o.onStyle({ join: d["join"] as JoinChoice });
    else if (d["cap"]) o.onStyle({ cap: d["cap"] as CapChoice });
  });
  document.body.appendChild(pop);
  place(pop, anchor);
  anchor.setAttribute("aria-expanded", "true");
  open = { pop, anchor, picker: { destroy() {} }, onClose: o.onClose };
  (pop.querySelector<HTMLElement>("[role=radio][aria-checked=true]:not(:disabled)") ?? width).focus();
}
