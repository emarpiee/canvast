import type { Setting } from "../gen/types";
import { openColourPopover } from "./colour-popover";
import { esc } from "./format";
import { ICONS } from "./icons";
import { liveNumber } from "./live";

/** One setting's value. */
export type SettingValue = number | string | boolean;

/**
 * The rows of settings of a panel, whatever they set (a pattern's, a 3D view's): a range and its number, a tick, a choice or a colour. `extra` goes beside
 * its name (a lock). Double-click on the name or the range: its usual value.
 */
export function settingRowHtml(s: Setting, v: SettingValue, extra = ""): string {
  if (s.t === "range") return `<div class="adj-row" data-k="${s.k}"><label class="adj-label" for="pg-n-${s.k}">${esc(s.label)}${extra}</label><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" aria-label="${esc(s.label)}"><input type="number" class="adj-num" id="pg-n-${s.k}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" aria-label="${esc(s.label)} value"></div>`;
  if (s.t === "toggle") return `<div class="adj-row pg-line" data-k="${s.k}"><label class="pg-check"><input type="checkbox"${v ? " checked" : ""}> <span>${esc(s.label)}</span>${extra}</label></div>`;
  if (s.t === "choice") return `<div class="adj-row pg-line" data-k="${s.k}"><span class="adj-label">${esc(s.label)}${extra}</span><div class="adj-layers pg-seg" role="group" aria-label="${esc(s.label)}">${s.opts.map(([o, l]) => `<button type="button" data-v="${o}" aria-pressed="${o === v}">${esc(l)}</button>`).join("")}</div></div>`;
  const none = v === "";
  return `<div class="adj-row pg-line" data-k="${s.k}"><span class="adj-label">${esc(s.label)}${extra}</span><div class="pg-colour"><button type="button" class="pg-swatch" data-swatch aria-label="${esc(s.label)} colour"></button><code>${none ? "none" : String(v).toUpperCase()}</code>${s.hide ? `<button type="button" class="pg-eye" data-eye aria-pressed="${!none}" aria-label="Show ${esc(s.label)}" title="${none ? "Show" : "Hide"} ${esc(s.label.toLowerCase())}">${none ? ICONS.eyeOff : ICONS.eye}</button>` : ""}</div></div>`;
}

/** Makes a row work. `get` reads a value now, `set` changes it; `reset` is its double-click. */
export function bindSettingRow(r: HTMLElement, s: Setting, get: (k: string) => SettingValue, set: (k: string, v: SettingValue) => void, reset: () => void): void {
  r.querySelector(".adj-label, .pg-check")?.setAttribute("title", "Double-click to reset");
  r.addEventListener("dblclick", (e) => {
    const on = e.target as HTMLElement;
    if (on.closest("[data-lock]") || !on.closest(".adj-label, .pg-check, input[type=range]")) return;
    reset();
  });
  if (s.t === "range") {
    const range = r.querySelector<HTMLInputElement>("input[type=range]")!, num = r.querySelector<HTMLInputElement>("input[type=number]")!;
    range.addEventListener("input", () => { num.value = range.value; set(s.k, Number(range.value)); });
    liveNumber(num, (x) => { range.value = String(x); set(s.k, Math.min(s.max, Math.max(s.min, x))); });
  } else if (s.t === "toggle") r.querySelector("input")!.addEventListener("change", (e) => set(s.k, (e.target as HTMLInputElement).checked));
  else if (s.t === "choice") r.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-v]");
    if (!b) return;
    for (const o of r.querySelectorAll("[data-v]")) o.setAttribute("aria-pressed", String(o === b));
    set(s.k, b.dataset["v"]!);
  });
  else {
    const sw = r.querySelector<HTMLElement>("[data-swatch]")!, code = r.querySelector("code")!;
    let last = (get(s.k) as string) || s.shown || s.def;
    const paint = (): void => {
      const c = get(s.k) as string;
      sw.style.background = c || last;
      sw.classList.toggle("is-none", c === "");
      code.textContent = c ? c.toUpperCase() : "none";
      const eye = r.querySelector<HTMLElement>("[data-eye]");
      if (eye) { eye.setAttribute("aria-pressed", String(c !== "")); eye.innerHTML = c ? ICONS.eye : ICONS.eyeOff; }
    };
    paint();
    sw.addEventListener("click", () => openColourPopover(sw, { name: s.label, value: last, onInput: (h) => { last = h.slice(0, 7); set(s.k, last); paint(); } }));
    r.querySelector("[data-eye]")?.addEventListener("click", () => { set(s.k, get(s.k) === "" ? last : ""); paint(); });
  }
}
