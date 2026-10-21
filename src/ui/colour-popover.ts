import type { AlignChoice, CapChoice, DashChoice, JoinChoice } from "../doc/stroke-look";
import { NOTE_CARD, NOTE_COLOURS } from "../text/text-style";
import type { Arrow } from "../doc/path";
import { createColourPicker, type ColourPicker, type SwatchGroup } from "../colour-picker/picker";
import { copyToClipboard, flashCopied, onLongPress } from "../colour-picker/press";
import { cssOfPaint } from "../app/css-paint";
import { createGradientEditor, type GradientValue } from "../colour-picker/gradient";
import type { Gradient, Paint } from "../doc/paint";
import { angleOf, asKind, gradientFrom, isGradient, linearAt, solidOf } from "../doc/paint";
import { isTexture, newTexture, withSource } from "../doc/texture";
import type { TexturePaint } from "../doc/texture";
import { createTextureEditor, textureHooks } from "./texture-editor";
import { esc } from "./format";
import { gradientCss } from "../assets/styles";
import { ICONS } from "./icons";
import { liveNumber } from "./live";
import { scrubNumbers } from "../colour-picker/scrub";
import { ADJUSTMENTS, MAX_LAYERS, SHADOW_START, cleanAdjust, layersOf } from "../doc/adjust";
import { curveCanvas, wireCurve } from "./curve-editor";
import type { Adjust, AdjustKey, Channel } from "../doc/adjust";
import type { GradientStop } from "../doc/paint";
import { swatchBackground } from "../render/ink";
import type { SettingsStore } from "../settings/settings";
import { clearRect, MENU_GAP, placeMenu } from "./more-menu";

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
  const a = clearRect(anchor);
  const m = pop.getBoundingClientRect();
  if (m.top < a.bottom && m.bottom > a.top) {
    const top = a.bottom + MENU_GAP;
    pop.style.top = `${parseFloat(pop.style.top) + (top - m.top)}px`;
    pop.style.maxHeight = `${window.innerHeight - top - 8}px`;
  }
}

/** A texture's source is being picked on the canvas (ADR 0154): a press there is the pick, not a press outside, so the chooser stays. */
let picking = false;
export const holdColourPopover = (on: boolean): void => {
  // (released a moment later: the press that ended the pick is still on its way to the document, and is not a press outside)
  if (on) picking = true;
  else setTimeout(() => (picking = false));
};

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
  save(hex: string): Promise<void>;
  gradients(): Array<{ name: string; gradient: Gradient }>;
  saveGradient(g: Gradient): Promise<void>;
  /** Open the Gradients of the Styles panel (all the saved ones, with their names). */
  showGradients(): void;
}
let styleHooks: ColourStyleHooks | null = null;
export function setColourStyles(h: ColourStyleHooks | null): void {
  styleHooks = h;
}

/** The swatches under a picker: the colours picked lately and the saved ones (when there are any); nothing made up. */
function swatchGroups(): SwatchGroup[] {
  const saved = styleHooks?.colours() ?? [];
  return [{ label: "Recent colours", colours: recentColours() }, ...(saved.length ? [{ label: "Saved colours", colours: saved }] : [])];
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
    void Promise.resolve(styleHooks?.save(hex())).then(after); // (the list is drawn again once the colour is in it)
  });
  return b;
}

/** Under a gradient editor: the saved gradients as bars to pick one, and a button to save this one (Styles, ADR 0122). */
function gradientStyles(now: () => Gradient, use: (g: Gradient) => void, stop: () => string, after?: () => void): HTMLElement {
  const box = document.createElement("div");
  box.className = "gradient-styles";
  let saved = styleHooks?.gradients() ?? [];
  const render = (): void => {
    saved = styleHooks?.gradients() ?? [];
    box.innerHTML = `${saved.length ? `<div class="cp-group"><div class="cp-group-h">Saved gradients<button type="button" class="gradient-show" data-show-gradients title="Open the Gradients of the Styles panel">Show all</button></div><div class="gradient-chips" role="group" aria-label="Saved gradients">${saved.map((s, i) => `<button type="button" class="gradient-chip" data-saved="${i}" title="${esc(s.name)}" aria-label="Use the gradient ${esc(s.name)}" style="background-image:${gradientCss(s.gradient)}"></button>`).join("")}</div></div>` : ""}<button type="button" class="colour-save" data-save-gradient title="Keep this gradient in the Styles">Save gradient</button><button type="button" class="colour-save" data-save-stop title="Keep the colour of the picked stop in the Styles, as a colour of its own">Save colour of this stop</button>`;
  };
  render();
  // A saved gradient is copied as CSS by a long press, a right click or Ctrl/Cmd+C, and is not used.
  onLongPress(box, "[data-saved]", (chip) => {
    const g = saved[Number(chip.dataset["saved"])]?.gradient;
    const css = g ? cssOfPaint(g) : null;
    if (css) void copyToClipboard(css).then((ok) => ok && flashCopied(chip));
  });
  box.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const chip = t.closest<HTMLElement>("[data-saved]");
    if (t.closest("[data-save-stop]")) {
      void Promise.resolve(styleHooks?.save(stop().slice(0, 7))).then(() => {
        render();
        box.querySelector<HTMLElement>("[data-save-stop]")!.textContent = "Saved";
        after?.();
      });
    } else if (t.closest("[data-show-gradients]")) styleHooks?.showGradients();
    else if (chip) {
      const g = saved[Number(chip.dataset["saved"])]?.gradient;
      if (g) use(g);
    } else if (t.closest("[data-save-gradient]")) {
      void Promise.resolve(styleHooks?.saveGradient(now())).then(() => {
        render(); // (the new one is in the list of saved gradients, at its end: shown)
        box.querySelector<HTMLElement>("[data-save-gradient]")!.textContent = "Saved";
        const list = box.querySelector<HTMLElement>(".gradient-chips");
        if (list) list.scrollTop = list.scrollHeight;
        after?.();
      });
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
    if (open && !picking && !t.closest(".colour-pop") && !open.anchor.contains(t)) closeColourPopover();
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && picking) return; // (the pick takes it: it ends the pick, not the chooser)
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
  return g.type === "linear" ? { type: "linear", angle: angleOf(g), cx: 0.5, cy: 0.5, r: 0.5, stops } : g.type === "angular" ? { type: "angular", angle: g.angle, cx: g.cx, cy: g.cy, r: 0.5, stops } : { type: "radial", angle: 0, cx: g.cx, cy: g.cy, r: g.r, stops };
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
  if (v.type === "angular") {
    const kept = prev.type === "angular" && Math.abs(prev.cx - v.cx) < 0.005 && Math.abs(prev.cy - v.cy) < 0.005 && Math.abs(prev.angle - v.angle) < 0.5 ? prev : null;
    return kept ? { ...kept, stops } : { type: "angular", cx: v.cx, cy: v.cy, angle: v.angle % 360, stops };
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
  /** A gradient or a colour was saved to the Styles from the editor (the lists that show the saved gradients are made again). */
  onSaved?(): void;
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
  // the same saved gradients, "Show all", Save gradient and Save colour of this stop as the chooser of a fill has
  const gradientNow = (): Gradient => ({ ...g, stops: g.stops });
  pop.append(
    ed.el,
    gradientStyles(
      gradientNow,
      (chosen) => {
        g = { ...g, stops: chosen.stops };
        ed.setValue(gradientToValue(g));
        o.onInput(g.stops);
        o.onChange(g.stops);
      },
      () => ed.selectedColour,
      () => o.onSaved?.(),
    ),
  );
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
  modes?: ReadonlyArray<Mode>;
}

/** `image` and `objects` are the textures of a fill (ADR 0154); offered only where the list says so. */
type Mode = "none" | "solid" | "linear" | "radial" | "angular" | "image" | "objects";

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
  let solid = paint === null ? "#2563eb" : solidOf(paint);
  /** Image or Objects chosen before a source is: the controls show, the paint stays what it was until there is a source. */
  let draft: "image" | "objects" | null = null;
  const modeOf = (): Mode => (draft ? draft : paint === null ? "none" : isTexture(paint) ? (paint.src.kind === "asset" ? "image" : "objects") : isGradient(paint) ? paint.type : "solid");
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
  const offered = (o.modes ?? (["none", "solid", "linear", "radial", "angular"] as const)).filter((m) => (m !== "image" && m !== "objects") || textureHooks());
  const ICON: Record<Mode, string> = { none: ICONS.paintNone, solid: ICONS.paintSolid, linear: ICONS.paintLinear, radial: ICONS.paintRadial, angular: ICONS.paintAngular, image: ICONS.paintImage, objects: ICONS.paintObjects };
  const NAME: Record<Mode, string> = { none: o.noneLabel, solid: "Colour", linear: "Linear gradient", radial: "Radial gradient", angular: "Angular gradient", image: "Image", objects: "Objects" };
  // icons, not words (the name is the tooltip and the accessible name); the row scrolls when there are more kinds than room
  modes.innerHTML = offered.map((m) => `<button type="button" role="radio" data-mode="${m}"${m === "none" ? ' class="colour-none"' : ""} aria-label="${esc(NAME[m])}" title="${esc(NAME[m])}">${ICON[m]}</button>`).join("");
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
    if (draft || isTexture(paint)) {
      const kind = draft ?? (modeOf() as "image" | "objects");
      const ed = createTextureEditor({
        kind,
        value: isTexture(paint) && (paint.src.kind === "asset") === (kind === "image") ? paint : null,
        onSource: (src, avg) => {
          const tex = isTexture(paint) && (paint.src.kind === "asset") === (kind === "image") ? withSource(paint, src, avg) : newTexture(src, avg);
          draft = null;
          o.onInput((paint = tex));
          settle(paint);
          mount();
          place(pop, anchor);
        },
        onInput: (t: TexturePaint) => o.onInput((paint = t)),
        onChange: (t: TexturePaint) => settle((paint = t)),
        onResize: () => place(pop, anchor),
      });
      body.append(ed.el);
      current = ed;
    } else if (paint === null) {
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
      }, () => ed.selectedColour));
      current = ed;
    } else {
      const picker = createColourPicker({
        ...pickerOptions,
        value: solid,
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
    if (m === "image" || m === "objects") {
      // (no source yet: the controls show, and the paint is what it was until one is chosen)
      draft = m;
      mount();
      place(pop, anchor);
      return;
    }
    draft = null;
    if (paint !== null) solid = solidOf(paint);
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
  /** Dash length, gap and start in widths of the outline (null: not a dashed selection, the fields are left out). */
  dashNumbers?: { len: number; gap: number; offset: number } | null;
  onDashNumbers?(n: { len?: number; gap?: number; offset?: number }): void;
  /** The angle (degrees) below which a sharp corner is cut to a bevel; null: not offered. */
  miterAngle?: number | null;
  onMiterAngle?(deg: number | null): void;
  /** The arrow heads at the two ends of an open path (null: nothing picked that has an open outline). */
  arrows?: { start: Arrow | "none"; end: Arrow | "none" } | null;
  onArrows?(patch: { start?: Arrow | "none"; end?: Arrow | "none" }): void;
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
    (o.miterAngle != null ? `<div class="op-row" data-miter-row${o.join === "miter" ? "" : " hidden"}><label class="op-label" for="op-miter">Cut below</label><input id="op-miter" class="op-num" data-miter type="number" min="1" max="90" step="1" inputmode="decimal" value="${o.miterAngle}"><span class="op-unit">° corners</span></div>` : "") +
    choices("dash", "Line", [["solid", "Solid", "A solid line"], ["dashed", "Dashed", "Dashes (three widths long, two apart)"], ["dotted", "Dotted", "Dots (round ends)"]] as const, o.dash) +
    (o.dashNumbers ? [["len", "Dash", o.dashNumbers.len, "0"], ["gap", "Gap", o.dashNumbers.gap, "0"], ["offset", "Start", o.dashNumbers.offset, ""]].map(([k, l, v, min]) => `<div class="op-row" data-dash-row${o.dash === "solid" ? " hidden" : ""}><label class="op-label" for="op-d-${k}">${l}</label><input id="op-d-${k}" class="op-num" data-dash="${k}" type="number"${min !== "" ? ` min="${min}"` : ""} step="0.25" inputmode="decimal" value="${Math.round(Number(v) * 1000) / 1000}"><span class="op-unit">widths</span></div>`).join("") : "") +
    choices("cap", "Ends", [["butt", "Flat", "Flat ends, cut at the last node"], ["round", "Round", "Round ends"], ["square", "Square", "Square ends, reaching half the width past the last node"]] as const, o.cap) +
    (o.arrows ? (["start", "end"] as const).map((k) => choices(`arrow-${k}`, k === "start" ? "Start" : "End", [["none", "None", "No arrow head"], ["triangle", "Solid", "A solid triangle"], ["open", "Open", "Two lines"], ["dot", "Dot", "A dot"]] as const, o.arrows![k])).join("") : "") +
    (o.closed ? "" : `<p class="op-note">An open line is always centred on its path.</p>`);
  scrubNumbers(pop);
  const width = pop.querySelector<HTMLInputElement>(".op-width")!;
  liveNumber(width, (v, final) => v >= 0 && o.onWidth(v, final));
  const miter = pop.querySelector<HTMLInputElement>("[data-miter]");
  if (miter) liveNumber(miter, (v, final) => final && v >= 1 && v <= 90 && o.onMiterAngle?.(v));
  for (const f of pop.querySelectorAll<HTMLInputElement>("[data-dash]")) liveNumber(f, (v, final) => final && o.onDashNumbers?.({ [f.dataset["dash"]!]: v }));
  pop.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[role=radio]");
    if (!b || b.disabled) return;
    const group = b.closest("[role=radiogroup]")!;
    for (const x of group.querySelectorAll("button")) x.setAttribute("aria-checked", String(x === b));
    const d = b.dataset;
    if (d["arrowStart"] !== undefined) o.onArrows?.({ start: d["arrowStart"] as Arrow | "none" });
    else if (d["arrowEnd"] !== undefined) o.onArrows?.({ end: d["arrowEnd"] as Arrow | "none" });
    else if (d["align"]) o.onStyle({ align: d["align"] as AlignChoice });
    else if (d["join"]) {
      o.onStyle({ join: d["join"] as JoinChoice });
      for (const r of pop.querySelectorAll<HTMLElement>("[data-miter-row]")) r.hidden = d["join"] !== "miter";
    }
    else if (d["cap"]) o.onStyle({ cap: d["cap"] as CapChoice });
    else if (d["dash"]) {
      o.onStyle({ dash: d["dash"] as DashChoice });
      const preset = d["dash"] === "dotted" ? [0, 2] : [3, 2];
      for (const r of pop.querySelectorAll<HTMLElement>("[data-dash-row]")) r.hidden = d["dash"] === "solid";
      for (const [i, k] of ["len", "gap", "offset"].entries()) {
        const f = pop.querySelector<HTMLInputElement>(`[data-dash="${k}"]`);
        if (f) f.value = String(preset[i] ?? 0);
      }
    }
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
  /** The card behind the words (a note): colour, space round the words and rounding in em; null = none. */
  card: { fill: string; pad: number; radius: number } | null;
  /** `final` false while a number is being typed or dragged (show it), true once it is settled (store it). */
  onChange(patch: { paraGap?: number; indent?: number; caps?: TextBoxOptions["caps"]; maxLines?: number | null; heightPx?: number | null; valign?: TextBoxOptions["valign"]; card?: TextBoxOptions["card"] }, final: boolean): void;
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
    choices("valign", "Words sit", [["top", "Top", "At the top of the height"], ["middle", "Middle", "In the middle of the height"], ["bottom", "Bottom", "At the bottom of the height"]], o.valign) +
    `<div class="op-row"><span class="op-label" id="tb-card">Card</span><div class="paint-modes op-choices note-colours" role="radiogroup" aria-labelledby="tb-card"><button type="button" role="radio" data-card="none" aria-checked="${o.card === null}" title="No card behind the words">None</button>${NOTE_COLOURS.map((c) => `<button type="button" role="radio" class="note-colour" data-card="${c.fill}" aria-checked="${o.card?.fill === c.fill}" aria-label="${c.name} card" title="${c.name} card" style="background:${c.fill}"></button>`).join("")}</div></div>` +
    num("cardPad", "Card space", String(Math.round((o.card?.pad ?? NOTE_CARD.pad) * 100) / 100), "em", 0, "0.05") +
    num("cardRadius", "Card rounding", String(Math.round((o.card?.radius ?? NOTE_CARD.radius) * 100) / 100), "em", 0, "0.05");
  let card = o.card;
  scrubNumbers(pop);
  for (const input of pop.querySelectorAll<HTMLInputElement>("input[data-field]")) {
    const key = input.dataset["field"]!;
    liveNumber(input, (v, final) => {
      if (!(v >= 0)) return;
      if (key === "cardPad" || key === "cardRadius") {
        if (!card) return;
        card = { ...card, [key === "cardPad" ? "pad" : "radius"]: v };
        o.onChange({ card }, final);
      } else if (key === "maxLines") o.onChange({ maxLines: v >= 1 ? Math.round(v) : null }, final);
      else if (key === "heightPx") o.onChange({ heightPx: v > 0 ? v : null }, final);
      else if (key === "paraGap") o.onChange({ paraGap: v }, final);
      else o.onChange({ indent: v }, final);
    });
  }
  pop.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[role=radio]");
    if (!b) return;
    for (const x of b.closest("[role=radiogroup]")!.querySelectorAll("button")) x.setAttribute("aria-checked", String(x === b));
    if (b.dataset["card"]) {
      const fill = b.dataset["card"];
      const field = (k: string): number => Number(pop.querySelector<HTMLInputElement>(`[data-field="${k}"]`)?.value) || 0;
      card = fill === "none" ? null : { fill, pad: field("cardPad"), radius: field("cardRadius") };
      o.onChange({ card }, true);
    } else if (b.dataset["caps"]) o.onChange({ caps: b.dataset["caps"] === "none" ? null : (b.dataset["caps"] as TextBoxOptions["caps"]) }, true);
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
  /** Where the layer tabs and the save row go when the panel keeps them in place above and below the numbers (ui/panel.ts); without them they stay in the list. */
  subHost?: HTMLElement;
  footHost?: HTMLElement;
  /** The numbers now (those of the first picked picture). */
  adjust: Adjust;
  /** Stills are adjusted pixel by pixel; video and GIF through a filter (every adjustment too, but sharpen and grain can slow playback of a big video). */
  stills: boolean;
  count: number;
  /** Every step of a slider: the adjustments to show now (not stored). */
  onInput(a: Adjust): void;
  /** The saved adjustments (Styles in the library, ADR 0120): the list now, and saving the numbers as a new one. */
  styles: { save(name: string, a: Adjust): Promise<void>; gradients(): Array<{ name: string; stops: readonly GradientStop[] }> };
  /** Open the Styles panel, where saved adjustments are applied. */
  onStyles(): void;
  /** A slider is let go, a number typed, or Reset pressed: store them. */
  onChange(a: Adjust, label: string): void;
  onClose?(): void;
}

const DEFAULT_MAP: readonly GradientStop[] = [{ o: 0, c: "#1e1b4b" }, { o: 1, c: "#f59e0b" }];

/** Fill `host` (the body of the Adjust panel) with the adjustment controls for the picked pictures (ADR 0118; a dock panel, ADR 0123). Call again to show other pictures. */
export function buildAdjustPanel(host: HTMLElement, o: AdjustOptions): { current(): Adjust; reset(): void } {
  // The panel works on one layer of a stack at a time; changing layer builds it again for that layer.
  let inner: { current(): Adjust; reset(): void } = buildAdjustLayer(host, o, 0, (adjust, layer) => {
    inner = buildAdjustLayer(host, { ...o, adjust }, layer, go);
  });
  const go = (adjust: Adjust, layer: number): void => {
    inner = buildAdjustLayer(host, { ...o, adjust }, layer, go);
  };
  return { current: () => inner.current(), reset: () => inner.reset() };
}

function buildAdjustLayer(host: HTMLElement, o: AdjustOptions, layerAt: number, go: (adjust: Adjust, layer: number) => void): { current(): Adjust; reset(): void } {
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
  const emitInput = (): void => {
    syncResets();
    o.onInput(compose(cur));
  };
  const emitChange = (label: string): void => {
    syncResets();
    o.onChange(compose(cur), label);
  };
  const GROUPS: Array<[string, readonly AdjustKey[]]> = [
    ["Light", ["exposure", "contrast", "highlights", "shadows"]],
    ["Colour", ["temperature", "tint", "saturation", "vibrance", "red", "green", "blue"]],
    ["Detail", ["blur", "sharpen", "grain"]],
    ["Drop shadow", ["dropOpacity", "dropX", "dropY", "dropBlur", "dropSpread"]],
    ["Inner shadow", ["innerOpacity", "innerX", "innerY", "innerBlur", "innerSpread"]],
  ];
  /** The colour of a shadow: a row under its numbers. */
  const SHADOW_COLOUR: Record<string, "dropColor" | "innerColor"> = { "Drop shadow": "dropColor", "Inner shadow": "innerColor" };
  const colourRow = (name: string): string => {
    const k = SHADOW_COLOUR[name];
    return k ? `<div class="adj-row"><label class="adj-label" for="adj-${k}">Colour</label><input type="color" id="adj-${k}" data-adj-colour="${k}" value="${(cur[k] ?? "#000000").slice(0, 7)}" aria-label="${name} colour"></div>` : "";
  };
  /** What each group holds, so its Reset can take it all off (a shadow's colour with it). */
  const GROUP_FIELDS: Record<string, readonly (keyof Adjust)[]> = {
    ...Object.fromEntries(GROUPS.map(([name, keys]) => [name, [...keys, ...(SHADOW_COLOUR[name] ? [SHADOW_COLOUR[name]!] : [])]])),
    "Gradient map": ["map"],
    Levels: ["levels"],
    Curves: ["curves"],
  };
  const groupChanged = (name: string): boolean => GROUP_FIELDS[name]!.some((k) => (typeof cur[k] === "number" ? cur[k] !== 0 : k === "dropColor" || k === "innerColor" ? false : !!cur[k]));
  /** The heading of a group, with the button that puts the whole group back. */
  const head = (name: string): string => `<div class="adj-group-head"><h4>${name}</h4><button type="button" class="layer-btn adj-reset" data-group-reset="${name}" aria-label="Reset ${name.toLowerCase()}" title="Reset ${name.toLowerCase()}" ${groupChanged(name) ? "" : "disabled"}>${ICONS.listRestart}</button></div>`;
  const syncResets = (): void => {
    for (const b of pop.querySelectorAll<HTMLButtonElement>("[data-group-reset]")) b.disabled = !groupChanged(b.dataset["groupReset"]!);
  };
  const row = (s: (typeof rows)[number]): string =>
    `<div class="adj-row${cur[s.key] ? " is-changed" : ""}" data-adj-row="${s.key}"><label class="adj-label" for="adj-num-${s.key}" title="Double-click to reset ${s.label}">${s.label}</label><input type="range" id="adj-${s.key}" data-adj="${s.key}" min="${s.min}" max="100" step="1" value="${cur[s.key] ?? 0}" aria-label="${s.label}"><input type="number" class="adj-num" id="adj-num-${s.key}" data-adj-num="${s.key}" min="${s.min}" max="100" step="1" value="${cur[s.key] ?? 0}" aria-label="${s.label} (number)"></div>`;
  let saved = o.styles.gradients();
  const sameStops = (a: readonly GradientStop[], b: readonly GradientStop[]): boolean => JSON.stringify(a) === JSON.stringify(b);
  const mapIndex = (): string => (!cur.map ? "" : String(saved.findIndex((g) => sameStops(g.stops, cur.map!.stops)))).replace("-1", "keep");
  const mapOptions = (): string => saved.map((g, i) => `<option value="${i}">${esc(g.name)}</option>`).join("");
  const mapSection = (): string =>
    `<section class="adj-group" aria-label="Gradient map">${head("Gradient map")}<div class="adj-map"><select data-adj-map aria-label="Gradient map: a saved gradient that the brightness of the picture is mapped onto"><option value="">None</option><option value="custom">Make a custom gradient…</option><option value="keep" hidden>Custom gradient</option>${mapOptions()}</select><span class="adj-map-bar" data-map-bar></span><button type="button" class="adj-map-edit" data-map-edit hidden>Edit the gradient</button></div><div class="adj-row" data-map-amount-row${cur.map ? "" : " hidden"}><label class="adj-label" for="adj-map-amount">Amount</label><input type="range" id="adj-map-amount" data-map-amount min="1" max="100" step="1" value="${cur.map?.amount ?? 100}" aria-label="Gradient map amount"><output class="adj-map-out" data-map-out>${cur.map?.amount ?? 100}</output></div>${saved.length ? "" : `<p class="op-note">Save a gradient from the fill or outline picker to use it here.</p>`}</section>`;
  const CH: Array<[Channel, string]> = [["master", "All"], ["r", "Red"], ["g", "Green"], ["b", "Blue"]];
  const chSelect = (name: string): string => `<select data-${name} aria-label="${name === "lv-ch" ? "Levels" : "Curve"}: which channel">${CH.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`;
  const layerTabs = `<div class="adj-layers" role="group" aria-label="Layers of adjustments">${layers.map((_, i) => `<button type="button" data-layer="${i}" aria-pressed="${i === idx}">${i + 1}</button>`).join("")}${layers.length < MAX_LAYERS ? `<button type="button" data-layer-add aria-label="Add a layer of adjustments after this one" title="Add a layer: its numbers are applied to the result of the one before">+</button>` : ""}${layers.length > 1 ? `<button type="button" data-layer-del aria-label="Remove this layer" title="Remove this layer">${ICONS.x}</button>` : ""}</div>`;
  const levelsSection = `<section class="adj-group" aria-label="Levels">${head("Levels")}<div class="adj-row">${chSelect("lv-ch")}</div><div class="adj-row" data-lv-row><label class="adj-label" for="adj-lv-black">Black point</label><input type="number" class="adj-num" id="adj-lv-black" data-lv="black" min="0" max="254" step="1" aria-label="Levels: black point"><label class="adj-label" for="adj-lv-white">White point</label><input type="number" class="adj-num" id="adj-lv-white" data-lv="white" min="1" max="255" step="1" aria-label="Levels: white point"><label class="adj-label" for="adj-lv-gamma">Gamma</label><input type="number" class="adj-num" id="adj-lv-gamma" data-lv="gamma" min="0.1" max="5" step="0.05" aria-label="Levels: gamma"></div></section>`;
  const curvesSection = `<section class="adj-group" aria-label="Curves">${head("Curves")}<div class="adj-row">${chSelect("cv-ch")}<button type="button" data-cv-reset>Reset curve</button></div>${curveCanvas("Curve")}</section>`;
  pop.innerHTML =
    layerTabs +
    `<header class="adj-head"><span class="adj-note">${o.count > 1 ? `Shows the first of ${o.count} pictures; applies to all.` : "The original is not changed."}</span></header>` +
    GROUPS.map(([name, keys]) => `<section class="adj-group" aria-label="${name}">${head(name)}${keys.map((k) => row(rows.find((r) => r.key === k)!)).join("")}${colourRow(name)}</section>`).join("") +
    mapSection() +
    levelsSection +
    curvesSection +
    (o.stills ? "" : `<p class="op-note">Sharpen and grain can slow the playback of a big video.</p>`) +
    `<footer class="adj-foot"><div class="adj-save"><input type="text" class="adj-name" data-adj-name maxlength="60" placeholder="Name to save these as" autocomplete="off" spellcheck="false" aria-label="Name of the adjustment to save"><button type="button" class="layer-btn" data-adj-save aria-label="Save" title="Save these adjustments in the Styles panel">${ICONS.save}</button></div><button type="button" class="adj-open" data-adj-open>${ICONS.swatchBook}<span>Saved adjustments</span></button></footer>`;
  scrubNumbers(pop);
  if (o.subHost) o.subHost.replaceChildren(pop.querySelector(".adj-layers")!);
  if (o.footHost) o.footHost.replaceChildren(pop.querySelector(".adj-foot")!);
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
        schedulePreview();
      },
      onChange: (stops) => {
        cur = { ...cur, map: { stops, amount: cur.map?.amount ?? 100 } };
        mapSelect.value = mapIndex();
        cancelPreview();
        emitChange("Adjust picture");
      },
      onSaved: () => {
        // a gradient was saved from the floating editor: the list of this select has it too (and the map is that gradient)
        saved = o.styles.gradients();
        for (const opt of [...mapSelect.options].filter((x) => /^\d+$/.test(x.value))) opt.remove();
        mapSelect.insertAdjacentHTML("beforeend", mapOptions());
        mapSelect.value = mapIndex();
      },
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
  let pending = false;
  /** Preview the numbers now (the first change of a burst must not wait: a panel built again in that frame would lose it), then at most once a frame with the latest. */
  const schedulePreview = (): void => {
    if (frame) {
      pending = true;
      return;
    }
    emitInput();
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (pending) {
        pending = false;
        emitInput();
      }
    });
  };
  const cancelPreview = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pending = false;
  };
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
    const first = (key === "dropOpacity" || key === "innerOpacity") && !cur[key] && Number(t.value) > 0 && !cur[key.replace("Opacity", "X") as AdjustKey] && !cur[key.replace("Opacity", "Y") as AdjustKey] && !cur[key.replace("Opacity", "Blur") as AdjustKey];
    set(key, Number(t.value));
    // a shadow turned on for the first time starts as a soft one a little below, not a hard one right behind
    if (first) for (const [part, v] of Object.entries(SHADOW_START)) if (v) set(key.replace("Opacity", part) as AdjustKey, v);
    // one preview a frame, the latest numbers (a fast drag makes many more input events than a screen can show)
    schedulePreview();
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
    schedulePreview();
  });
  mapAmount.addEventListener("change", () => {
    cancelPreview();
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
  pop.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    const k = t.dataset["adjColour"] as "dropColor" | "innerColor" | undefined;
    if (!k) return;
    cur = { ...cur, [k]: t.value };
    schedulePreview();
  });
  pop.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset["adjColour"]) {
      cancelPreview();
      emitChange("Adjust picture");
      return;
    }
    if (t.dataset["adj"] || t.dataset["adjNum"]) {
      cancelPreview();
      emitChange("Adjust picture");
    }
  });
  const onClick = (e: Event): void => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.dataset["groupReset"]) {
      const name = b.dataset["groupReset"];
      const gone = new Set<string>(GROUP_FIELDS[name]!);
      cur = Object.fromEntries(Object.entries(cur).filter(([k]) => !gone.has(k))) as Adjust;
      o.onChange(compose(cur), `Reset ${name.toLowerCase()}`);
      go(compose(cur), idx); // (the panel is built again, so every slider, curve and gradient shows it)
    } else if (b.hasAttribute("data-adj-open")) {
      o.onStyles();
    } else if (b.hasAttribute("data-adj-save")) {
      const name = (o.footHost ?? pop).querySelector<HTMLInputElement>("[data-adj-name]")!;
      void o.styles.save(name.value, cur).then(() => {
        name.value = "";
        name.placeholder = "Saved. See it in Styles";
      });
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
  };
  for (const h of [pop, o.subHost, o.footHost]) if (h) h.onclick = onClick; // (replaced, not added, each time the layer is built again)

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
      schedulePreview();
    });
    lvInput(k).addEventListener("change", () => {
      cancelPreview();
      emitChange("Adjust picture");
      const clean = cleanAdjust(cur);
      cur = { ...cur, ...(clean?.levels ? { levels: clean.levels } : { levels: undefined }) } as Adjust;
      syncLevels();
    });
  }
  syncLevels();

  // ---- curves (ADR 0136) -------------------------------------------------------------------------------------------------------
  let cvCh: Channel = "master";
  const curve = wireCurve(pop.querySelector<HTMLCanvasElement>("[data-curve]")!, {
    points: () => (cur.curves?.[cvCh] ? cur.curves[cvCh]!.map((p) => [p[0], p[1]] as [number, number]) : [[0, 0], [255, 255]]),
    set: (pts) => { cur = { ...cur, curves: { ...cur.curves, [cvCh]: pts } }; },
    input: schedulePreview,
    commit: () => { cancelPreview(); emitChange("Adjust picture"); },
  });
  const drawCurve = curve.draw;
  pop.querySelector<HTMLSelectElement>("[data-cv-ch]")!.addEventListener("change", (e) => {
    cvCh = (e.target as HTMLSelectElement).value as Channel;
    curve.unpick();
    drawCurve();
  });
  pop.querySelector<HTMLElement>("[data-cv-reset]")!.addEventListener("click", () => {
    const { [cvCh]: _gone, ...rest } = cur.curves ?? {};
    cur = { ...cur, curves: Object.keys(rest).length ? rest : undefined } as Adjust;
    curve.unpick();
    drawCurve();
    emitChange("Adjust picture");
  });
  /** Every slider, the gradient map, the levels and the curves of this layer back to nothing (the panel's Reset button). */
  const reset = (): void => {
    for (const s of rows) set(s.key, 0);
    cur = {};
    syncMap();
    syncLevels();
    drawCurve();
    emitChange("Reset adjustments");
  };
  return { current: () => compose(cur), reset };
}
