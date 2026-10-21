import type { Setting } from "../gen";
import { openColourPopover } from "./colour-popover";
import { esc } from "./format";
import { ICONS } from "./icons";
import { liveNumber } from "./live";

/**
 * One row of a panel built from a settings schema (`Setting`: range, toggle, choice, colour), shared by every such panel (the Pattern
 * panel's generators, the Brush Settings sections) so each kind of setting looks and behaves the same everywhere.
 */
export function settingRow(s: Setting, v: number | string | boolean, id: string, extra = ""): string {
  if (s.t === "range") return `<div class="adj-row" data-k="${esc(s.k)}"><label class="adj-label" for="${esc(id)}">${esc(s.label)}${extra}</label><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" aria-label="${esc(s.label)}"><input type="number" class="adj-num" id="${esc(id)}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" aria-label="${esc(s.label)} value"></div>`;
  if (s.t === "toggle") return `<div class="adj-row pg-line" data-k="${esc(s.k)}"><label class="pg-check"><input type="checkbox"${v ? " checked" : ""}> <span>${esc(s.label)}</span>${extra}</label></div>`;
  if (s.t === "choice") return `<div class="adj-row pg-line" data-k="${esc(s.k)}"><span class="adj-label">${esc(s.label)}${extra}</span><div class="adj-layers pg-seg" role="group" aria-label="${esc(s.label)}">${s.opts.map(([o, l]) => `<button type="button" data-v="${esc(o)}" aria-pressed="${o === v}">${esc(l)}</button>`).join("")}</div></div>`;
  const none = v === "";
  return `<div class="adj-row pg-line" data-k="${esc(s.k)}"><span class="adj-label">${esc(s.label)}${extra}</span><div class="pg-colour"><button type="button" class="pg-swatch" data-swatch aria-label="${esc(s.label)} colour"></button><code>${none ? "none" : String(v).toUpperCase()}</code>${s.hide ? `<button type="button" class="pg-eye" data-eye aria-pressed="${!none}" aria-label="Show ${esc(s.label)}" title="${none ? "Show" : "Hide"} ${esc(s.label.toLowerCase())}">${none ? ICONS.eyeOff : ICONS.eye}</button>` : ""}</div></div>`;
}

/** Make a row built by `settingRow` work: `get` reads the setting's value, `set` is told each change. */
export function wireSettingRow(r: HTMLElement, s: Setting, get: () => number | string | boolean, set: (v: number | string | boolean) => void): void {
  if (s.t === "range") {
    const range = r.querySelector<HTMLInputElement>("input[type=range]")!, num = r.querySelector<HTMLInputElement>("input[type=number]")!;
    range.addEventListener("input", () => { num.value = range.value; set(Number(range.value)); });
    liveNumber(num, (x) => { range.value = String(x); set(Math.min(s.max, Math.max(s.min, x))); });
  } else if (s.t === "toggle") r.querySelector("input")!.addEventListener("change", (e) => set((e.target as HTMLInputElement).checked));
  else if (s.t === "choice") r.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-v]");
    if (!b) return;
    for (const o of r.querySelectorAll("[data-v]")) o.setAttribute("aria-pressed", String(o === b));
    set(b.dataset["v"]!);
  });
  else {
    const sw = r.querySelector<HTMLElement>("[data-swatch]")!, code = r.querySelector("code")!;
    let last = (get() as string) || s.def;
    const paint = (): void => {
      const c = get() as string;
      sw.style.background = c || last;
      sw.classList.toggle("is-none", c === "");
      code.textContent = c ? c.toUpperCase() : "none";
      const eye = r.querySelector<HTMLElement>("[data-eye]");
      if (eye) { eye.setAttribute("aria-pressed", String(c !== "")); eye.innerHTML = c ? ICONS.eye : ICONS.eyeOff; }
    };
    paint();
    sw.addEventListener("click", () => openColourPopover(sw, { name: s.label, value: last, onInput: (h) => { last = h.slice(0, 7); set(last); paint(); } }));
    r.querySelector("[data-eye]")?.addEventListener("click", () => { set(get() === "" ? last : ""); paint(); });
  }
}
