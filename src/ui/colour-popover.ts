import { createColourPicker, type ColourPicker, type SwatchGroup } from "../colour-picker/picker";
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

let open: { pop: HTMLElement; anchor: HTMLElement; picker: ColourPicker } | null = null;

export function closeColourPopover(refocus = false): void {
  if (!open) return;
  const { pop, anchor, picker } = open;
  open = null;
  picker.destroy();
  pop.remove();
  anchor.setAttribute("aria-expanded", "false");
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
    groups: groups(),
    display: swatchBackground,
    onInput: o.onInput,
    onChange: (hex) => {
      rememberColour(hex);
      o.onChange?.(hex);
      picker.setGroups(groups());
    },
    onModel: (m) => void store?.set("colour.model", m),
    onView: (v) => {
      void store?.set("colour.view", v);
      place(pop, anchor); // the two layouts differ in height
    },
  });
  const pop = document.createElement("div");
  pop.className = "colour-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", o.name);
  pop.append(picker.el);
  document.body.appendChild(pop);
  place(pop, anchor);
  anchor.setAttribute("aria-expanded", "true");
  open = { pop, anchor, picker };
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
