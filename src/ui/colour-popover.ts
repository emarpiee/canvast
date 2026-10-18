import type { AlignChoice, CapChoice, DashChoice, JoinChoice } from "../doc/stroke-look";
import { createColourPicker, type ColourPicker, type SwatchGroup } from "../colour-picker/picker";
import { createGradientEditor, type GradientValue } from "../colour-picker/gradient";
import type { Gradient, Paint } from "../doc/paint";
import { angleOf, asKind, gradientFrom, isGradient, linearAt } from "../doc/paint";
import { rgbToHex, toRgb } from "../colour-picker/colour";
import { esc } from "./format";
import { gradientCss } from "../assets/styles";
import { ICONS } from "./icons";
import { liveNumber } from "./live";
import { scrubNumbers } from "../colour-picker/scrub";
import { ADJUSTMENTS, MAX_CURVE_POINTS, MAX_LAYERS, cleanAdjust, curveFn, layersOf } from "../doc/adjust";
import type { Adjust, AdjustKey, Channel } from "../doc/adjust";
import type { GradientStop } from "../doc/paint";
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

/** A second picker panel that floats beside the open one (the gradient editor of the Adjust panel's gradient map): it closes with it. */
let child: { pop: HTMLElement; destroy(): void } | null = null;

function closeChild(): void {
  if (!child) return;
  const { pop, destroy } = child;
  child = null;
  destroy();
  pop.remove();
}

/** Close the floating gradient editor of the Adjust panel (the panel was rebuilt or closed). */
export const closeAdjustChild = (): void => closeChild();

export function closeColourPopover(refocus = false): void {
  closeChild();
  if (!open) return;
  const { pop, anchor, picker, onClose } = open;
  open = null;
  picker.destroy();
  pop.remove();
  anchor.setAttribute("aria-expanded", "false");
  onClose?.();
  if (refocus && anchor.isConnected) anchor.focus();
}

/** The saved colours of the library's Styles (ADR 0120): the colours now, and saving one. Set by the app. */
export interface ColourStyleHooks {
  colours(): string[];
  save(hex: string): void;
  gradients(): Array<{ name: string; gradient: Gradient }>;
  saveGradient(g: Gradient): void;
}
let styleHooks: ColourStyleHooks | null = null;
export function setColourStyles(h: ColourStyleHooks | null): void {
  styleHooks = h;
}

/** The swatches under a picker: the colours picked lately, the saved ones (when there are any), the presets. */
function swatchGroups(): SwatchGroup[] {
  const saved = styleHooks?.colours() ?? [];
  return [{ label: "Recent", colours: recentColours() }, ...(saved.length ? [{ label: "Saved", colours: saved }] : []), { label: "Presets", colours: presets() }];
}

/** A small "Save colour" button: the colour as it is now goes to the Styles of the library. */
function saveColourButton(hex: () => string, after: () => void): HTMLButtonElement | null {
  if (!styleHooks) return null;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "colour-save";
  b.textContent = "Save colour";
  b.title = "Keep this colour in the Styles of the library";
  b.addEventListener("click", () => {
    styleHooks?.save(hex());
    after();
  });
  return b;
}

/** Under a gradient editor: the saved gradients as bars to pick one, and a button to save this one (Styles, ADR 0122). */
function gradientStyles(now: () => Gradient, use: (g: Gradient) => void): HTMLElement {
  const box = document.createElement("div");
  box.className = "gradient-styles";
  const saved = styleHooks?.gradients() ?? [];
  box.innerHTML = `${saved.length ? `<div class="gradient-chips" role="group" aria-label="Saved gradients">${saved.map((s, i) => `<button type="button" class="gradient-chip" data-saved="${i}" title="${esc(s.name)}" aria-label="Use the gradient ${esc(s.name)}" style="background-image:${gradientCss(s.gradient)}"></button>`).join("")}</div>` : ""}<button type="button" class="colour-save" data-save-gradient title="Keep this gradient in the Styles">Save gradient</button>`;
  box.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const chip = t.closest<HTMLElement>("[data-saved]");
    if (chip) {
      const g = saved[Number(chip.dataset["saved"])]?.gradient;
      if (g) use(g);
    } else if (t.closest("[data-save-gradient]")) {
      styleHooks?.saveGradient(now());
      t.closest<HTMLElement>("[data-save-gradient]")!.textContent = "Saved";
    }
  });
  return box;
}

/** Open the picker under `anchor`; a second press on the same button closes it. */
export function openColourPopover(anchor: HTMLElement, o: ColourPopoverOptions): void {
  if (open && open.anchor === anchor) return closeColourPopover(true);
  closeColourPopover();
  installCloseRules();
  const groups = swatchGroups;
  let lastHex = o.value;
  const picker = createColourPicker({
    value: o.value,
    model: store?.get("colour.model") ?? "okhsv",
    view: store?.get("colour.view") ?? "wheel",
    format: store?.get("colour.format") ?? "hex",
    groups: groups(),
    display: swatchBackground,
    alpha: o.alpha === true,
    onInput: (hex) => {
      lastHex = hex;
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
  const saveBtn = saveColourButton(() => lastHex, () => picker.setGroups(groups()));
  if (saveBtn) pop.append(saveBtn);
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
      if (e.key === "Escape" && child) {
        e.preventDefault();
        e.stopPropagation();
        closeChild();
      } else if (e.key === "Escape" && open) {
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

/** The options of a colour picker inside a gradient editor, as the paint chooser gives them (the person's model, view and format are kept). */
function editorPicker(relayout: () => void) {
  return {
    model: store?.get("colour.model") ?? "okhsv",
    view: store?.get("colour.view") ?? "wheel",
    format: store?.get("colour.format") ?? "hex",
    groups: swatchGroups(),
    display: swatchBackground,
    onModel: (m: "okhsl" | "okhsv" | "okhcl") => void store?.set("colour.model", m),
    onFormat: (f: "hex" | "rgb" | "oklch") => void store?.set("colour.format", f),
    onView: (v: "wheel" | "plane" | "sliders" | "mixer") => {
      void store?.set("colour.view", v);
      relayout();
    },
  } as const;
}

export interface GradientPopoverOptions {
  name: string;
  gradient: Gradient;
  /** Once, when a gesture ends (a stop moved, a colour chosen, the kind changed). */
  onChange(g: Gradient): void;
  onClose?(): void;
}

/** A gradient editor of its own under `anchor` (to edit a saved gradient): stops, colours, angle, Linear or Radial. */
export function openGradientPopover(anchor: HTMLElement, o: GradientPopoverOptions): void {
  if (open && open.anchor === anchor) return closeColourPopover(true);
  closeColourPopover();
  installCloseRules();
  let g = o.gradient;
  const pop = document.createElement("div");
  pop.className = "colour-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", o.name);
  const ed = createGradientEditor({
    value: gradientToValue(g),
    picker: editorPicker(() => place(pop, anchor)),
    typeSwitch: true,
    onInput: (v) => (g = gradientFromValue(g, v)),
    onChange: (v) => o.onChange((g = gradientFromValue(g, v))),
  });
  pop.append(ed.el);
  document.body.appendChild(pop);
  place(pop, anchor);
  anchor.setAttribute("aria-expanded", "true");
  open = { pop, anchor, picker: ed, onClose: o.onClose };
}

export interface ChildGradientOptions {
  name: string;
  stops: readonly GradientStop[];
  onInput(stops: readonly GradientStop[]): void;
  onChange(stops: readonly GradientStop[]): void;
  /** Keep this gradient in the Styles. */
  onSave(stops: readonly GradientStop[]): void;
}

/** The floating gradient editor beside the open popover `parent`: the same picker panel as everywhere, not a copy inside another panel. */
function openChildGradient(parent: HTMLElement, o: ChildGradientOptions): void {
  closeChild();
  let g: Gradient = { type: "linear", x0: 0, y0: 0.5, x1: 1, y1: 0.5, stops: o.stops };
  const pop = document.createElement("div");
  pop.className = "colour-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", o.name);
  const ed = createGradientEditor({
    value: gradientToValue(g),
    picker: editorPicker(() => put()),
    typeSwitch: false,
    onInput: (v) => {
      g = gradientFromValue(g, v);
      o.onInput(g.stops);
    },
    onChange: (v) => {
      g = gradientFromValue(g, v);
      o.onChange(g.stops);
    },
  });
  const save = document.createElement("button");
  save.type = "button";
  save.className = "colour-save";
  save.textContent = "Save gradient";
  save.title = "Keep this gradient in the Styles";
  save.addEventListener("click", () => {
    o.onSave(g.stops);
    save.textContent = "Saved";
  });
  pop.append(ed.el, save);
  document.body.appendChild(pop);
  const put = (): void => {
    const p = parent.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const right = p.right + 8;
    const left = right + w <= window.innerWidth - 8 ? right : Math.max(8, p.left - 8 - w);
    pop.style.position = "fixed";
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(Math.max(8, Math.min(p.top, window.innerHeight - h - 8)))}px`;
    pop.style.maxHeight = `${window.innerHeight - 16}px`;
  };
  put();
  child = { pop, destroy: () => ed.destroy() };
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
  /** The kinds of paint offered (default: all four). A text's fill has no None; a text's outline has only None and Colour. */
  modes?: ReadonlyArray<"none" | "solid" | "linear" | "radial">;
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
  const groups = swatchGroups;
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
  const offered = o.modes ?? (["none", "solid", "linear", "radial"] as const);
  modes.innerHTML = offered.map((m) => `<button type="button" role="radio" data-mode="${m}"${m === "none" ? ' class="colour-none"' : ""}>${label[m]}</button>`).join("");
  const body = document.createElement("div");
  body.className = "paint-body";
  if (offered.length === 1) pop.append(body);
  else pop.append(modes, body);

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
      body.append(gradientStyles(() => paint as Gradient, (g) => {
        o.onInput((paint = g));
        settle(paint);
        mount();
        place(pop, anchor);
      }));
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
      const saveBtn = saveColourButton(() => solid, () => picker.setGroups(groups()));
      if (saveBtn) body.append(saveBtn);
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
  dash: DashChoice;
  /** Every sub-path is closed: the outline can sit inside or outside the edge, and corners matter more than ends. */
  closed: boolean;
  /** The width changed: `final` false while it is being typed or dragged (show it), true once it is settled (store it). */
  onWidth(px: number, final: boolean): void;
  onStyle(patch: { join?: JoinChoice; cap?: CapChoice; align?: AlignChoice; dash?: DashChoice }): void;
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
    `<div class="op-row"><label class="op-label" for="op-width">Width</label><input id="op-width" class="op-width" type="number" min="0" step="0.5" inputmode="decimal" value="${o.widthPx === null ? "" : String(Math.round(o.widthPx * 100) / 100)}"><span class="op-unit">px</span></div>` +
    choices("align", "Position", [["inside", "Inside", "Inside: the whole width is inside the edge"], ["centre", "Centre", "Centre: half on each side of the edge"], ["outside", "Outside", "Outside: the whole width is outside the edge"]] as const, o.align, !o.closed) +
    choices("join", "Corners", [["miter", "Sharp", "Sharp corners"], ["round", "Round", "Round corners"], ["bevel", "Cut", "Cut (bevelled) corners"]] as const, o.join) +
    choices("dash", "Line", [["solid", "Solid", "A solid line"], ["dashed", "Dashed", "Dashes (three widths long, two apart)"], ["dotted", "Dotted", "Dots (round ends)"]] as const, o.dash) +
    choices("cap", "Ends", [["butt", "Flat", "Flat ends, cut at the last node"], ["round", "Round", "Round ends"], ["square", "Square", "Square ends, reaching half the width past the last node"]] as const, o.cap) +
    (o.closed ? "" : `<p class="op-note">An open line is always centred on its path.</p>`);
  scrubNumbers(pop);
  const width = pop.querySelector<HTMLInputElement>(".op-width")!;
  liveNumber(width, (v, final) => v >= 0 && o.onWidth(v, final));
  pop.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[role=radio]");
    if (!b || b.disabled) return;
    const group = b.closest("[role=radiogroup]")!;
    for (const x of group.querySelectorAll("button")) x.setAttribute("aria-checked", String(x === b));
    const d = b.dataset;
    if (d["align"]) o.onStyle({ align: d["align"] as AlignChoice });
    else if (d["join"]) o.onStyle({ join: d["join"] as JoinChoice });
    else if (d["cap"]) o.onStyle({ cap: d["cap"] as CapChoice });
    else if (d["dash"]) o.onStyle({ dash: d["dash"] as DashChoice });
  });
  document.body.appendChild(pop);
  place(pop, anchor);
  anchor.setAttribute("aria-expanded", "true");
  open = { pop, anchor, picker: { destroy() {} }, onClose: o.onClose };
  (pop.querySelector<HTMLElement>("[role=radio][aria-checked=true]:not(:disabled)") ?? width).focus();
}

// ---- Paragraph and box options of a text (ADR 0130) ----------------------------------------------------------------------------

export interface TextBoxOptions {
  paraGap: number;
  indent: number;
  caps: "upper" | "lower" | "title" | "small" | null;
  maxLines: number | null;
  /** The set height in px at this zoom, or null for as tall as the words. */
  heightPx: number | null;
  valign: "top" | "middle" | "bottom";
  /** `final` false while a number is being typed or dragged (show it), true once it is settled (store it). */
  onChange(patch: { paraGap?: number; indent?: number; caps?: TextBoxOptions["caps"]; maxLines?: number | null; heightPx?: number | null; valign?: TextBoxOptions["valign"] }, final: boolean): void;
  onClose?(): void;
}

/** Space between paragraphs, first-line indent, case, a line limit, and a set height with where the words sit in it. */
export function openTextBoxPopover(anchor: HTMLElement, o: TextBoxOptions): void {
  if (open && open.anchor === anchor) return closeColourPopover(true);
  closeColourPopover();
  installCloseRules();
  const pop = document.createElement("div");
  pop.className = "colour-pop outline-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Paragraph and box options");
  const num = (key: string, label: string, value: string, unit: string, min: number, step: string): string =>
    `<div class="op-row"><label class="op-label" for="tb-${key}">${label}</label><input id="tb-${key}" class="op-width" data-field="${key}" type="number" min="${min}" step="${step}" inputmode="decimal" value="${value}"><span class="op-unit">${unit}</span></div>`;
  const choices = (key: string, label: string, items: ReadonlyArray<[string, string, string]>, value: string): string =>
    `<div class="op-row"><span class="op-label" id="tb-${key}">${label}</span><div class="paint-modes op-choices" role="radiogroup" aria-labelledby="tb-${key}">${items
      .map(([v, text, tip]) => `<button type="button" role="radio" data-${key}="${v}" aria-checked="${v === value}" title="${tip}">${text}</button>`)
      .join("")}</div></div>`;
  pop.innerHTML =
    num("paraGap", "Paragraph space", String(Math.round(o.paraGap * 100) / 100), "em", 0, "0.05") +
    num("indent", "First line in", String(Math.round(o.indent * 100) / 100), "em", 0, "0.1") +
    choices("caps", "Case", [["none", "Aa", "As typed"], ["upper", "AA", "UPPER CASE"], ["lower", "aa", "lower case"], ["title", "Ab", "Title Case: every word starts with a capital"], ["small", "Sc", "Small caps: lower case letters as smaller capitals"]], o.caps ?? "none") +
    num("maxLines", "Most lines", o.maxLines === null ? "0" : String(o.maxLines), "0 = all", 0, "1") +
    num("heightPx", "Height", o.heightPx === null ? "0" : String(Math.round(o.heightPx * 100) / 100), "px, 0 = auto", 0, "any") +
    choices("valign", "Words sit", [["top", "Top", "At the top of the height"], ["middle", "Middle", "In the middle of the height"], ["bottom", "Bottom", "At the bottom of the height"]], o.valign);
  scrubNumbers(pop);
  for (const input of pop.querySelectorAll<HTMLInputElement>("input[data-field]")) {
    const key = input.dataset["field"]!;
    liveNumber(input, (v, final) => {
      if (!(v >= 0)) return;
      if (key === "maxLines") o.onChange({ maxLines: v >= 1 ? Math.round(v) : null }, final);
      else if (key === "heightPx") o.onChange({ heightPx: v > 0 ? v : null }, final);
      else if (key === "paraGap") o.onChange({ paraGap: v }, final);
      else o.onChange({ indent: v }, final);
    });
  }
  pop.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[role=radio]");
    if (!b) return;
    for (const x of b.closest("[role=radiogroup]")!.querySelectorAll("button")) x.setAttribute("aria-checked", String(x === b));
    if (b.dataset["caps"]) o.onChange({ caps: b.dataset["caps"] === "none" ? null : (b.dataset["caps"] as TextBoxOptions["caps"]) }, true);
    else o.onChange({ valign: b.dataset["valign"] as TextBoxOptions["valign"] }, true);
  });
  document.body.appendChild(pop);
  place(pop, anchor);
  anchor.setAttribute("aria-expanded", "true");
  open = { pop, anchor, picker: { destroy() {} }, onClose: o.onClose };
  pop.querySelector<HTMLElement>("input")!.focus();
}

// ---- Font options of a text (ADR 0132) --------------------------------------------------------------------------------------------

export interface FontOptions {
  /** The font's name and style, for the heading. */
  family: string;
  style: string;
  kerning: boolean;
  /** The features of the font that can be offered, with the words that name them, and which are on. */
  features: ReadonlyArray<{ tag: string; label: string; on: boolean }>;
  /** The axes of a variable font, each with its value now. */
  axes: ReadonlyArray<{ tag: string; name: string; min: number; def: number; max: number; value: number }>;
  onChange(patch: { kerning?: boolean; features?: string[]; axes?: Record<string, number> | null }, final: boolean): void;
  onClose?(): void;
}

/** Kerning, OpenType features and the axes of a variable font. */
export function openFontOptionsPopover(anchor: HTMLElement, o: FontOptions): void {
  if (open && open.anchor === anchor) return closeColourPopover(true);
  closeColourPopover();
  installCloseRules();
  const pop = document.createElement("div");
  pop.className = "colour-pop outline-pop font-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Font options");
  const on = new Set(o.features.filter((f) => f.on).map((f) => f.tag));
  const values = Object.fromEntries(o.axes.map((a) => [a.tag, a.value]));
  pop.innerHTML =
    `<p class="op-note">${esc(o.family)} ${esc(o.style)}</p>` +
    `<label class="op-row font-switch"><span class="op-label">Kerning</span><input type="checkbox" data-kerning${o.kerning ? " checked" : ""} aria-label="Kerning: the font's own spacing of letter pairs"></label>` +
    o.features.map((f) => `<label class="op-row font-switch"><span class="op-label">${esc(f.label)}</span><input type="checkbox" data-feature="${esc(f.tag)}"${f.on ? " checked" : ""} aria-label="${esc(f.label)}"></label>`).join("") +
    o.axes.map((a) => `<div class="op-row"><label class="op-label" for="fo-${esc(a.tag)}">${esc(a.name)}</label><input id="fo-${esc(a.tag)}" class="op-width" data-axis="${esc(a.tag)}" type="number" min="${a.min}" max="${a.max}" step="any" inputmode="decimal" value="${Math.round(a.value * 100) / 100}"><input type="range" data-axis-range="${esc(a.tag)}" min="${a.min}" max="${a.max}" step="any" value="${a.value}" aria-label="${esc(a.name)} slider"></div>`).join("") +
    (o.axes.length === 0 && o.features.length === 0 ? `<p class="op-note">This font has no features or axes to set beyond kerning.</p>` : "");
  const axesNow = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const a of o.axes) if (values[a.tag] !== a.def) out[a.tag] = values[a.tag]!;
    return out;
  };
  pop.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset["kerning"] !== undefined) o.onChange({ kerning: t.checked }, true);
    else if (t.dataset["feature"]) {
      if (t.checked) on.add(t.dataset["feature"]);
      else on.delete(t.dataset["feature"]);
      o.onChange({ features: [...on] }, true);
    }
  });
  for (const a of o.axes) {
    const num = pop.querySelector<HTMLInputElement>(`input[data-axis="${a.tag}"]`)!;
    const range = pop.querySelector<HTMLInputElement>(`input[data-axis-range="${a.tag}"]`)!;
    const set = (v: number, final: boolean): void => {
      values[a.tag] = Math.min(a.max, Math.max(a.min, v));
      range.value = String(values[a.tag]);
      o.onChange({ axes: axesNow() }, final);
    };
    liveNumber(num, (v, final) => set(v, final));
    range.addEventListener("input", () => {
      num.value = String(Math.round(Number(range.value) * 100) / 100);
      set(Number(range.value), false);
    });
    range.addEventListener("change", () => set(Number(range.value), true));
  }
  document.body.appendChild(pop);
  place(pop, anchor);
  anchor.setAttribute("aria-expanded", "true");
  open = { pop, anchor, picker: { destroy() {} }, onClose: o.onClose };
  pop.querySelector<HTMLElement>("input")!.focus();
}

// ---- Adjust: the non-destructive adjustments of a picture (ADR 0118) -------------------------------------------------------------

export interface AdjustOptions {
  /** The numbers now (those of the first picked picture). */
  adjust: Adjust;
  /** Stills are adjusted pixel by pixel; video and GIF through a filter (every adjustment too, but sharpen and grain can slow playback of a big video). */
  stills: boolean;
  count: number;
  /** Every step of a slider: the adjustments to show now (not stored). */
  onInput(a: Adjust): void;
  /** The saved adjustments (Styles in the library, ADR 0120): the list now, and saving the numbers as a new one. */
  styles: { save(name: string, a: Adjust): Promise<void>; gradients(): Array<{ name: string; stops: readonly GradientStop[] }>; saveGradient(stops: readonly GradientStop[]): Promise<void> };
  /** Open the Styles panel, where saved adjustments are applied. */
  onStyles(): void;
  /** A slider is let go, a number typed, or Reset pressed: store them. */
  onChange(a: Adjust, label: string): void;
  onClose?(): void;
}

const DEFAULT_MAP: readonly GradientStop[] = [{ o: 0, c: "#1e1b4b" }, { o: 1, c: "#f59e0b" }];

/** Fill `host` (the body of the Adjust panel) with the adjustment controls for the picked pictures (ADR 0118; a dock panel, ADR 0123). Call again to show other pictures. */
export function buildAdjustPanel(host: HTMLElement, o: AdjustOptions): { current(): Adjust } {
  // The panel works on one layer of a stack at a time; changing layer builds it again for that layer.
  let inner: { current(): Adjust } = buildAdjustLayer(host, o, 0, (adjust, layer) => {
    inner = buildAdjustLayer(host, { ...o, adjust }, layer, go);
  });
  const go = (adjust: Adjust, layer: number): void => {
    inner = buildAdjustLayer(host, { ...o, adjust }, layer, go);
  };
  return { current: () => inner.current() };
}

function buildAdjustLayer(host: HTMLElement, o: AdjustOptions, layerAt: number, go: (adjust: Adjust, layer: number) => void): { current(): Adjust } {
  closeChild();
  const layers = layersOf(o.adjust).map((l) => {
    const { next: _n, ...one } = l;
    return one as Adjust;
  });
  if (!layers.length) layers.push({});
  const idx = Math.max(0, Math.min(layerAt, layers.length - 1));
  /** The whole stack with the layer being edited as it is now. */
  const compose = (cur: Adjust): Adjust => layers.reduceRight<Adjust | undefined>((next, l, i) => ({ ...(i === idx ? cur : l), ...(next ? { next } : {}) }), undefined)!;
  const pop = document.createElement("div");
  pop.className = "adjust-pop";
  host.replaceChildren(pop);
  const rows = ADJUSTMENTS;
  let cur: Adjust = { ...layers[idx]! };
  const emitInput = (): void => o.onInput(compose(cur));
  const emitChange = (label: string): void => o.onChange(compose(cur), label);
  const GROUPS: Array<[string, readonly AdjustKey[]]> = [
    ["Light", ["exposure", "contrast", "highlights", "shadows"]],
    ["Colour", ["temperature", "tint", "saturation", "vibrance", "red", "green", "blue"]],
    ["Detail", ["blur", "sharpen", "grain"]],
  ];
  const row = (s: (typeof rows)[number]): string =>
    `<div class="adj-row${cur[s.key] ? " is-changed" : ""}" data-adj-row="${s.key}"><label class="adj-label" for="adj-${s.key}" title="Double-click to reset ${s.label}">${s.label}</label><input type="range" id="adj-${s.key}" data-adj="${s.key}" min="${s.min}" max="100" step="1" value="${cur[s.key] ?? 0}" aria-label="${s.label}"><input type="number" class="adj-num" data-adj-num="${s.key}" min="${s.min}" max="100" step="1" value="${cur[s.key] ?? 0}" aria-label="${s.label} (number)"></div>`;
  const saved = o.styles.gradients();
  const sameStops = (a: readonly GradientStop[], b: readonly GradientStop[]): boolean => JSON.stringify(a) === JSON.stringify(b);
  const mapIndex = (): string => (!cur.map ? "" : String(saved.findIndex((g) => sameStops(g.stops, cur.map!.stops)))).replace("-1", "keep");
  const mapSection = (): string =>
    `<section class="adj-group" aria-label="Gradient map"><h4>Gradient map</h4><div class="adj-map"><select data-adj-map aria-label="Gradient map: a saved gradient that the brightness of the picture is mapped onto"><option value="">None</option><option value="custom">Make a custom gradient…</option><option value="keep" hidden>Custom gradient</option>${saved.map((g, i) => `<option value="${i}">${esc(g.name)}</option>`).join("")}</select><span class="adj-map-bar" data-map-bar></span><button type="button" class="adj-map-edit" data-map-edit hidden>Edit the gradient</button></div><div class="adj-row" data-map-amount-row${cur.map ? "" : " hidden"}><label class="adj-label" for="adj-map-amount">Amount</label><input type="range" id="adj-map-amount" data-map-amount min="1" max="100" step="1" value="${cur.map?.amount ?? 100}" aria-label="Gradient map amount"><output class="adj-map-out" data-map-out>${cur.map?.amount ?? 100}</output></div>${saved.length ? "" : `<p class="op-note">Save a gradient from the fill or outline picker to use it here.</p>`}</section>`;
  const CH: Array<[Channel, string]> = [["master", "All"], ["r", "Red"], ["g", "Green"], ["b", "Blue"]];
  const chSelect = (name: string): string => `<select data-${name} aria-label="${name === "lv-ch" ? "Levels" : "Curve"}: which channel">${CH.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`;
  const layerTabs = `<div class="adj-layers" role="group" aria-label="Layers of adjustments">${layers.map((_, i) => `<button type="button" data-layer="${i}" aria-pressed="${i === idx}">${i + 1}</button>`).join("")}${layers.length < MAX_LAYERS ? `<button type="button" data-layer-add aria-label="Add a layer of adjustments after this one" title="Add a layer: its numbers are applied to the result of the one before">+</button>` : ""}${layers.length > 1 ? `<button type="button" data-layer-del aria-label="Remove this layer" title="Remove this layer">${ICONS.x}</button>` : ""}</div>`;
  const levelsSection = `<section class="adj-group" aria-label="Levels"><h4>Levels</h4><div class="adj-row">${chSelect("lv-ch")}</div><div class="adj-row" data-lv-row><label class="adj-label">Black</label><input type="number" class="adj-num" data-lv="black" min="0" max="254" step="1" aria-label="Levels: black point"><label class="adj-label">White</label><input type="number" class="adj-num" data-lv="white" min="1" max="255" step="1" aria-label="Levels: white point"><label class="adj-label">Gamma</label><input type="number" class="adj-num" data-lv="gamma" min="0.1" max="5" step="0.05" aria-label="Levels: gamma"></div></section>`;
  const curvesSection = `<section class="adj-group" aria-label="Curves"><h4>Curves</h4><div class="adj-row">${chSelect("cv-ch")}<button type="button" data-cv-reset>Reset curve</button></div><canvas class="adj-curve" data-curve width="192" height="192" tabindex="0" role="application" aria-label="Curve: drag a point, click to add one, double-click a point to remove it. With the keyboard: [ and ] choose a point, arrows move it, Delete removes it"></canvas></section>`;
  pop.innerHTML =
    layerTabs +
    `<header class="adj-head"><h3>Adjust</h3><span class="adj-note">${o.count > 1 ? `Shows the first of ${o.count} pictures; applies to all.` : "The original is not changed."}</span><button type="button" class="adj-reset" data-adj-reset>Reset</button></header>` +
    GROUPS.map(([name, keys]) => `<section class="adj-group" aria-label="${name}"><h4>${name}</h4>${keys.map((k) => row(rows.find((r) => r.key === k)!)).join("")}</section>`).join("") +
    mapSection() +
    levelsSection +
    curvesSection +
    (o.stills ? "" : `<p class="op-note">Sharpen and grain can slow the playback of a big video.</p>`) +
    `<footer class="adj-foot"><div class="adj-save"><input type="text" class="adj-name" data-adj-name maxlength="60" placeholder="Name to save these as" autocomplete="off" spellcheck="false" aria-label="Name of the adjustment to save"><button type="button" data-adj-save>Save</button></div><button type="button" class="adj-open" data-adj-open>${ICONS.swatchBook}<span>Saved adjustments</span></button></footer>`;
  scrubNumbers(pop);
  const mapSelect = pop.querySelector<HTMLSelectElement>("[data-adj-map]")!;
  const mapBar = pop.querySelector<HTMLElement>("[data-map-bar]")!;
  const mapRow = pop.querySelector<HTMLElement>("[data-map-amount-row]")!;
  const closeEditor = (): void => closeChild();
  const openEditor = (): void => {
    if (!cur.map) return;
    openChildGradient(pop, {
      name: "Gradient map: gradient",
      stops: cur.map.stops,
      onInput: (stops) => {
        cur = { ...cur, map: { stops, amount: cur.map?.amount ?? 100 } };
        mapBar.style.backgroundImage = gradientCss({ type: "linear", x0: 0, y0: 0, x1: 1, y1: 0, stops });
        if (!frame) frame = requestAnimationFrame(() => {
          frame = 0;
          emitInput();
        });
      },
      onChange: (stops) => {
        cur = { ...cur, map: { stops, amount: cur.map?.amount ?? 100 } };
        mapSelect.value = mapIndex();
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        emitChange("Adjust picture");
      },
      onSave: (stops) => void o.styles.saveGradient(stops),
    });
  };
  const syncMap = (): void => {
    mapSelect.value = mapIndex();
    mapBar.style.backgroundImage = cur.map ? gradientCss({ type: "linear", x0: 0, y0: 0, x1: 1, y1: 0, stops: cur.map.stops }) : "";
    mapBar.hidden = !cur.map;
    mapRow.hidden = !cur.map;
    mapEdit.hidden = !cur.map;
    if (!cur.map) closeEditor();
  };
  const mapEdit = pop.querySelector<HTMLElement>("[data-map-edit]")!;
  mapEdit.addEventListener("click", openEditor);
  syncMap();
  let frame = 0;
  const set = (key: AdjustKey, v: number): void => {
    cur = { ...cur, [key]: v };
    const r = pop.querySelector<HTMLInputElement>(`[data-adj="${key}"]`)!, n = pop.querySelector<HTMLInputElement>(`[data-adj-num="${key}"]`)!;
    r.value = String(v);
    n.value = String(v);
    r.closest(".adj-row")!.classList.toggle("is-changed", v !== 0);
  };
  pop.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    const key = (t.dataset["adj"] ?? t.dataset["adjNum"]) as AdjustKey | undefined;
    if (!key || t.value === "" || !Number.isFinite(Number(t.value))) return;
    set(key, Number(t.value));
    // one preview a frame, the latest numbers (a fast drag makes many more input events than a screen can show)
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      emitInput();
    });
  });
  const setMap = (m: Adjust["map"]): void => {
    const { map: _m, ...rest } = cur;
    cur = m ? { ...rest, map: m } : rest;
    syncMap();
  };
  mapSelect.addEventListener("change", () => {
    const v = mapSelect.value;
    if (v === "keep") return;
    closeEditor();
    const g = v === "" ? undefined : v === "custom" ? { stops: cur.map?.stops ?? DEFAULT_MAP } : saved[Number(v)];
    setMap(g ? { stops: g.stops, amount: cur.map?.amount ?? 100 } : undefined);
    if (v === "custom") {
      mapSelect.value = "keep";
      requestAnimationFrame(openEditor); // (after the panel has taken its place, so the editor floats beside it)
    }
    mapOut.textContent = String(cur.map?.amount ?? 100);
    emitChange("Adjust picture");
  });
  const mapAmount = pop.querySelector<HTMLInputElement>("[data-map-amount]")!;
  const mapOut = pop.querySelector<HTMLElement>("[data-map-out]")!;
  mapAmount.addEventListener("input", () => {
    if (!cur.map) return;
    setMap({ stops: cur.map.stops, amount: Number(mapAmount.value) });
    mapOut.textContent = mapAmount.value;
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      emitInput();
    });
  });
  mapAmount.addEventListener("change", () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    emitChange("Adjust picture");
  });
  pop.addEventListener("dblclick", (e) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>("[data-adj-row]")?.dataset["adjRow"] as AdjustKey | undefined;
    if (!key || !cur[key]) return;
    set(key, 0);
    const { [key]: _gone, ...rest } = cur;
    cur = rest;
    emitChange("Adjust picture");
  });
  pop.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset["adj"] || t.dataset["adjNum"]) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      emitChange("Adjust picture");
    }
  });
  pop.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.hasAttribute("data-adj-open")) {
      o.onStyles();
    } else if (b.hasAttribute("data-adj-save")) {
      const name = pop.querySelector<HTMLInputElement>("[data-adj-name]")!;
      void o.styles.save(name.value, cur).then(() => {
        name.value = "";
        name.placeholder = "Saved. See it in Styles";
      });
    } else if (b.hasAttribute("data-adj-reset")) {
      for (const s of rows) set(s.key, 0);
      cur = {};
      syncMap();
      syncLevels();
      drawCurve();
      emitChange("Reset adjustments");
    } else if (b.dataset["layer"] !== undefined) go(compose(cur), Number(b.dataset["layer"]));
    else if (b.hasAttribute("data-layer-add")) {
      // a new, empty layer after the last (kept only once it changes something)
      const withNew = (a: Adjust): Adjust => (a.next ? { ...a, next: withNew(a.next) } : { ...a, next: {} });
      go(withNew(compose(cur)), layers.length);
    }
    else if (b.hasAttribute("data-layer-del")) {
      const rest = layers.filter((_, i) => i !== idx);
      const whole = rest.reduceRight<Adjust | undefined>((next, l) => ({ ...l, ...(next ? { next } : {}) }), undefined) ?? {};
      o.onChange(whole, "Remove adjustment layer");
      go(whole, Math.max(0, idx - 1));
    }
  });

  // ---- levels (ADR 0136) -------------------------------------------------------------------------------------------------------
  let lvCh: Channel = "master";
  const lvInput = (k: "black" | "white" | "gamma"): HTMLInputElement => pop.querySelector<HTMLInputElement>(`[data-lv="${k}"]`)!;
  const syncLevels = (): void => {
    const l = cur.levels?.[lvCh];
    lvInput("black").value = String(l?.black ?? 0);
    lvInput("white").value = String(l?.white ?? 255);
    lvInput("gamma").value = String(l?.gamma ?? 1);
  };
  pop.querySelector<HTMLSelectElement>("[data-lv-ch]")!.addEventListener("change", (e) => {
    lvCh = (e.target as HTMLSelectElement).value as Channel;
    syncLevels();
  });
  for (const k of ["black", "white", "gamma"] as const) {
    lvInput(k).addEventListener("input", () => {
      const v = Number(lvInput(k).value);
      if (!Number.isFinite(v) || lvInput(k).value === "") return;
      cur = { ...cur, levels: { ...cur.levels, [lvCh]: { ...cur.levels?.[lvCh], [k]: v } } };
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        emitInput();
      });
    });
    lvInput(k).addEventListener("change", () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      emitChange("Adjust picture");
      const clean = cleanAdjust(cur);
      cur = { ...cur, ...(clean?.levels ? { levels: clean.levels } : { levels: undefined }) } as Adjust;
      syncLevels();
    });
  }
  syncLevels();

  // ---- curves (ADR 0136) -------------------------------------------------------------------------------------------------------
  let cvCh: Channel = "master";
  let picked = -1;
  const cv = pop.querySelector<HTMLCanvasElement>("[data-curve]")!;
  const SIZE = 192, PAD = 6;
  const toXY = (x: number, y: number): [number, number] => [PAD + (x / 255) * (SIZE - 2 * PAD), SIZE - PAD - (y / 255) * (SIZE - 2 * PAD)];
  const fromXY = (px: number, py: number): [number, number] => [Math.max(0, Math.min(255, Math.round(((px - PAD) / (SIZE - 2 * PAD)) * 255))), Math.max(0, Math.min(255, Math.round(((SIZE - PAD - py) / (SIZE - 2 * PAD)) * 255)))];
  const points = (): Array<[number, number]> => (cur.curves?.[cvCh] ? cur.curves[cvCh]!.map((p) => [p[0], p[1]] as [number, number]) : [[0, 0], [255, 255]]);
  const setPoints = (pts: Array<[number, number]>): void => {
    pts.sort((a, b) => a[0] - b[0]);
    cur = { ...cur, curves: { ...cur.curves, [cvCh]: pts } };
  };
  const drawCurve = (): void => {
    const g = cv.getContext("2d")!;
    const css = getComputedStyle(cv);
    g.clearRect(0, 0, SIZE, SIZE);
    g.strokeStyle = css.getPropertyValue("--hud-border") || "#888";
    g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const [x, y] = toXY((i * 255) / 4, (i * 255) / 4);
      g.beginPath();
      g.moveTo(x, PAD);
      g.lineTo(x, SIZE - PAD);
      g.moveTo(PAD, y);
      g.lineTo(SIZE - PAD, y);
      g.stroke();
    }
    const pts = points();
    const f = curveFn(pts);
    g.strokeStyle = css.getPropertyValue("--hud-accent") || "#0a7";
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= 255; x += 3) {
      const [px, py] = toXY(x, f(x));
      if (x === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    g.fillStyle = css.getPropertyValue("--hud-fg") || "#222";
    pts.forEach(([x, y], i) => {
      const [px, py] = toXY(x, y);
      g.beginPath();
      g.arc(px, py, i === picked ? 5 : 3.5, 0, 7);
      g.fill();
    });
  };
  const hit = (px: number, py: number): number => points().findIndex(([x, y]) => Math.hypot(toXY(x, y)[0] - px, toXY(x, y)[1] - py) <= 8);
  const local = (e: PointerEvent): [number, number] => {
    const r = cv.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE];
  };
  const curveInput = (): void => {
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      emitInput();
    });
  };
  cv.addEventListener("pointerdown", (e) => {
    const [px, py] = local(e);
    let i = hit(px, py);
    if (i < 0) {
      const pts = points();
      if (pts.length >= MAX_CURVE_POINTS) return;
      pts.push(fromXY(px, py));
      setPoints(pts);
      i = points().findIndex(([x, y]) => (x === fromXY(px, py)[0] && y === fromXY(px, py)[1]));
      curveInput();
    }
    picked = i;
    cv.setPointerCapture(e.pointerId);
    cv.focus();
    drawCurve();
  });
  cv.addEventListener("pointermove", (e) => {
    if (picked < 0 || !(e.buttons & 1)) return;
    const pts = points();
    const [x, y] = fromXY(...local(e));
    // between its neighbours (points stay in order) and anywhere up and down
    const lo = picked > 0 ? pts[picked - 1]![0] + 1 : 0, hi = picked < pts.length - 1 ? pts[picked + 1]![0] - 1 : 255;
    pts[picked] = [Math.max(lo, Math.min(hi, x)), y];
    setPoints(pts);
    drawCurve();
    curveInput();
  });
  cv.addEventListener("pointerup", () => {
    if (picked < 0) return;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    emitChange("Adjust picture");
  });
  cv.addEventListener("dblclick", (e) => {
    const i = hit(...local(e as unknown as PointerEvent));
    const pts = points();
    if (i < 0 || pts.length <= 2) return;
    pts.splice(i, 1);
    picked = -1;
    setPoints(pts);
    drawCurve();
    emitChange("Adjust picture");
  });
  cv.addEventListener("keydown", (e) => {
    const pts = points();
    if (e.key === "[" || e.key === "]") {
      picked = (picked + (e.key === "]" ? 1 : -1) + pts.length) % pts.length;
    } else if (picked >= 0 && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      const step = e.shiftKey ? 10 : 1;
      const [x, y] = pts[picked]!;
      pts[picked] = [Math.max(0, Math.min(255, x + (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0))), Math.max(0, Math.min(255, y + (e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0)))];
      setPoints(pts);
      emitChange("Adjust picture");
    } else if ((e.key === "Delete" || e.key === "Backspace") && picked >= 0 && pts.length > 2) {
      pts.splice(picked, 1);
      picked = -1;
      setPoints(pts);
      emitChange("Adjust picture");
    } else return;
    e.preventDefault();
    drawCurve();
  });
  pop.querySelector<HTMLSelectElement>("[data-cv-ch]")!.addEventListener("change", (e) => {
    cvCh = (e.target as HTMLSelectElement).value as Channel;
    picked = -1;
    drawCurve();
  });
  pop.querySelector<HTMLElement>("[data-cv-reset]")!.addEventListener("click", () => {
    const { [cvCh]: _gone, ...rest } = cur.curves ?? {};
    cur = { ...cur, curves: Object.keys(rest).length ? rest : undefined } as Adjust;
    picked = -1;
    drawCurve();
    emitChange("Adjust picture");
  });
  drawCurve();
  return { current: () => compose(cur) };
}
